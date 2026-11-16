/* =============================================================================
 * 排程引擎 · 文旅导览智能体
 * -----------------------------------------------------------------------------
 * 设计原则：本文件不含任何城市的专属地理知识。
 *   · 车程      Haversine 直线距离 × 路网系数 ÷ 分段时速，不再维护车程矩阵
 *   · 片区      直接读景点的 district 字段，不再人工划区
 *   · 用餐      按坐标就近检索餐饮 POI，不再按区县人工写死
 *   · 阈值      全部改为「当日可用时长的占比」，与地图尺度无关
 * 换城市只需替换 data/*.js 的数据包，本文件零改动。
 * ========================================================================== */

(function (global) {
  'use strict';

  /* ---------- 常量 ---------- */
  var R = 6371;               // 地球半径 km
  var ROAD_FACTOR = 1.35;     // 直线 → 路网里程的经验系数
  var LUNCH = 60;             // 午餐时长
  var LUNCH_AT = 12 * 60;     // 午餐基准时刻 12:00
  /* 午餐最晚可接受的时刻 13:30。与「13:30 之后才出发的一天视为已吃过」用的是同一条线：
     既然 13:30 之后连插都不插，那么反过来说 13:30 之前吃到饭都是合理的。
     超过它才值得把一段游览从中间切开——见 timeline() 里的切分分支。 */
  var LUNCH_LATE = 13 * 60 + 30;
  /* 午餐最早可接受的时刻 11:00。早于此不插午餐，也是自检里那条规则的判据。 */
  var LUNCH_EARLY = 11 * 60;
  /* 「不切开、游览结束后再吃」这条兜底路径的最晚起点 14:30 = LUNCH_LATE + LUNCH。
     与切分用的 13:30 是同一条线的两端：13:30 之前吃得上都算合理，13:30 起还能
     再宽限一顿饭的时长。越过 14:30 就不再插入「午餐」——实测出发时刻在 10:00–13:00
     之间、且切分被闭园时间挡住时，兜底会把午餐插到 15:00 以后（最晚 17:46），
     那已经不是午饭，不如不插，让用户自己安排。 */
  var LUNCH_MAX = LUNCH_LATE + LUNCH;
  /* 游览被午餐切开时，前后两段各自不得少于 45 分钟：
     少于这个时长的一段不值得为它跑进跑出，不如整段走完再吃。 */
  var SPLIT_MIN = 45;
  var EVENING = 90;           // 晚间自由活动时长
  var NIGHT_CAP = 22 * 60 + 30; // 夜间活动必须结束的时刻 22:30

  /* ---------- 出行方式估算的参数 ----------
   * 只给一个口径：**门到门耗时** —— 从出发到抵达，把候车、找车位这些真实成本算进去，
   * 否则「自驾 9 分钟」永远赢，而现实里你还得绕两圈找车位。
   * 全是经验值，不是实时数据，也不承诺准确；所以界面必须把构成一起显示出来
   * （自驾写「车程 9 + 停车 6」），让人一眼看出这是估算而不是导航结论。
   *
   *   步行 4.8 km/h      正常成人步速区间 4.5–5.0 的中值
   *   骑行 12 km/h       共享单车含等红灯；银川地势平，不按体力上限算
   *   公交 18 km/h       城市公交平均运营速度（含停站），不是路况最高速
   *   候车 12 分         发车间隔 10–15 分取半，加两端步行接驳
   *   取还车 4 分        找车、扫码、落锁，实测很难少于 3 分钟
   *   停车 市区 6 / 其他 3  老城车位紧张，郊区景区基本即到即停
   */
  var WALK_KPH = 4.8, BIKE_KPH = 12, TRANSIT_KPH = 18;
  /* 方式适用范围：超出就没必要列出来（4 km 走路、20 km 骑车都不是正常选择）；
     3 km 以内也不列公交 —— 等车比走过去还久，列出来只会让那张卡片变噪音。
     路网 40 km 是公交的上限：再远就是跨县跨市，班次与线路没有一概而论的余地，
     与其给一个看起来精确的错数，不如只留自驾。 */
  var WALK_MAX_KM = 3, BIKE_MAX_KM = 8;
  var TRANSIT_MIN_ROAD_KM = 3, TRANSIT_MAX_ROAD_KM = 40;
  var BIKE_FETCH = 4, TRANSIT_WAIT = 12, PARK_URBAN = 6, PARK_OTHER = 3;

  var PACE = {
    relax:  { s: 9 * 60,      e: 18 * 60,      label: '轻松' },
    normal: { s: 8 * 60 + 30, e: 19 * 60,      label: '标准' },
    tight:  { s: 8 * 60,      e: 20 * 60,      label: '紧凑' },
    /* 「夜间」只给「已在路上」用：晚上打开时把收工时间推到 23:00，
       否则一过 19:00 就什么也排不出来。夜游仍有 22:30 的硬上限。 */
    late:   { s: 8 * 60,      e: 23 * 60,      label: '夜间' }
  };

  /* 单日最多安排几个白天景点 */
  var MAX_SPOTS_PER_DAY = 4;

  /* ---------- 开放时间解析与时间窗校验 ----------
   * 数据包里的 open 是给人读的字符串（"09:00-17:00（周一闭馆）"），而动态重排要用
   * 它回答「现在赶过去还进得去吗、最晚几点必须出来」，所以先把常见的 7 种写法解析成
   * 结构化字段。解析不出来的一律当作「不限时段」——宁可少拦，不可误拦真实可去的点。
   */
  var MAX_WAIT  = 60;    // 开门前最多等这么久，等更久就不安排
  var MIN_VISIT = 50;    // 最短游览时长，压缩游览的下限
  var MIN_SHARE = 0.6;   // 压缩后至少保留建议停留的这个比例

  function fmtHM(m) {
    var h = Math.floor(m / 60) % 24, mm = Math.round(m % 60);
    return (h < 10 ? '0' : '') + h + ':' + (mm < 10 ? '0' : '') + mm;
  }

  var OPEN_CACHE = {};
  var WEEKDAY = { '日': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6 };
  var WEEKDAY_CN = '一二三四五六日';

  /* 星期几的中文写法：0=周日 … 6=周六。闭馆日、攻略提示、免票日共用同一份换算，
     避免同一件事在三个地方各写一遍（写歪了就会三处不一致）。 */
  function dowChar(d) {
    return WEEKDAY_CN.charAt(d === 0 ? 6 : d - 1);
  }

  function parseOpen(str) {
    var s = String(str == null ? '' : str);
    if (OPEN_CACHE[s]) return OPEN_CACHE[s];
    var o = {
      raw: s, allDay: false, start: null, end: null,
      lastEntry: null, closedWeekdays: [], needReserve: false, note: ''
    };
    if (/全天/.test(s) && !/\d{1,2}:\d{2}/.test(s)) o.allDay = true;

    var m = s.match(/(\d{1,2}):(\d{2})\s*[-—~－至]\s*(\d{1,2}):(\d{2})/);
    if (m) {
      o.start = (+m[1]) * 60 + (+m[2]);
      o.end = (+m[3]) * 60 + (+m[4]);
      if (o.end <= o.start) o.end += 24 * 60;     // 跨零点，如「17:00-24:00」
    }
    var le = s.match(/(\d{1,2}):(\d{2})\s*停止入园/);
    if (le) o.lastEntry = (+le[1]) * 60 + (+le[2]);

    var re = /周([一二三四五六日])闭馆/g, hit;
    while ((hit = re.exec(s))) {
      if (o.closedWeekdays.indexOf(WEEKDAY[hit[1]]) < 0) o.closedWeekdays.push(WEEKDAY[hit[1]]);
    }
    if (/需预约/.test(s)) o.needReserve = true;

    var notes = [];
    (s.match(/[（(][^（）()]*[)）]/g) || []).forEach(function (p) {
      var inner = p.replace(/^[（(]|[)）]$/g, '')
        .replace(/\d{1,2}:\d{2}\s*停止入园/g, '')
        .replace(/周[一二三四五六日]闭馆/g, '')
        .replace(/需预约/g, '')
        .replace(/^[，,、\s]+|[，,、\s]+$/g, '');
      if (inner) notes.push(inner);
    });
    o.note = notes.join('；');
    OPEN_CACHE[s] = o;
    return o;
  }

  /**
   * 到达时刻还进得去吗。[arriveAt] 为当日分钟数，[dow] 为 0(周日)–6(周六)，可为空。
   * 返回 { ok, stay, wait, trimmed, why, detail }
   *   stay   实际可用游览时长（不足建议停留时压缩，但不低于 MIN_VISIT）
   *   wait   开园前到达需要等的分钟数（超过 MAX_WAIT 视为去不了）
   *   why    closedToday / pastEntry / tooLate / beforeOpen
   * 只有这四种情况判为去不了，其余都尽量给出一个可行方案。
   */
  function fitsWindow(a, arriveAt, dow) {
    var o = parseOpen(a.open);
    if (o.closedWeekdays.length && dow != null && o.closedWeekdays.indexOf(dow) >= 0) {
      return { ok: false, why: 'closedToday', detail: '逢周' + dowChar(dow) + '闭馆' };
    }
    if (o.allDay || o.start == null || o.end == null) return { ok: true, stay: a.stay, wait: 0 };

    var wait = arriveAt < o.start ? o.start - arriveAt : 0;
    if (wait > MAX_WAIT) {
      return { ok: false, why: 'beforeOpen', detail: fmtHM(o.start) + ' 才开门，需等 ' + wait + ' 分钟' };
    }
    var t0 = arriveAt + wait;
    if (o.lastEntry != null && t0 > o.lastEntry) {
      return { ok: false, why: 'pastEntry', detail: '已过停止入园时间 ' + fmtHM(o.lastEntry) };
    }
    var avail = o.end - t0;
    var minNeed = Math.max(MIN_VISIT, Math.round(a.stay * MIN_SHARE));
    if (avail < minNeed) {
      return { ok: false, why: 'tooLate', detail: '闭园前仅剩 ' + Math.max(0, avail) + ' 分钟，不足最短游览 ' + minNeed + ' 分钟' };
    }
    if (avail < a.stay) {
      return { ok: true, stay: avail, wait: wait, trimmed: true, detail: '闭园前剩 ' + avail + ' 分钟，游览压缩' };
    }
    return { ok: true, stay: a.stay, wait: wait };
  }

  /* 排程侧的窗口判定：在 fitsWindow（景区自己的开放时间）之上再叠加「今日剩余时间」。
     光满足闭园时间还不够——用户说了「今天走到 19:00」，就不该排一个逛到 20:30 的点。
     剩余时间不足建议停留时按剩余时间压缩，但不得低于 MIN_VISIT。
     动态重排与候选列表共用这一个判定，两处口径因此必然一致。 */
  function planFits(a, arriveAt, Wd) {
    var fp = fitsWindow(a, arriveAt, Wd.dow);
    if (!fp.ok) return fp;
    var room = Wd.e - (arriveAt + (fp.wait || 0));
    if (room < MIN_VISIT) {
      return { ok: false, why: 'tooLate', detail: '今日剩余时间仅 ' + Math.max(0, room) + ' 分钟' };
    }
    if (room < fp.stay) {
      return { ok: true, stay: room, wait: fp.wait || 0, trimmed: true, detail: '今日时间不足，游览压缩到 ' + room + ' 分钟' };
    }
    return fp;
  }

  /* ---------- 基础数学 ---------- */
  function toRad(d) { return d * Math.PI / 180; }

  function haversineKm(a, b) {
    var dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  /**
   * 两点间车程（分钟）。
   * 市区建成区内按城市拥堵时速（8km 内 20km/h，超过 28km/h）；
   * 驶出市区按两端较慢一侧的典型时速（山路 44-48、乡道 32、干道 50-58）。
   */
  function driveMin(a, b) {
    if (!a || !b) return 0;
    if (a.id && b.id && a.id === b.id) return 0;
    var km = haversineKm(a, b);
    var core = a.urban === true && b.urban === true;
    var kph = core
      ? (km < 8 ? 25 : 30)      // 建成区内拥堵时速
      : Math.min(a.roadKph || 58, b.roadKph || 58);
    return Math.max(5, Math.round(km * ROAD_FACTOR / kph * 60));
  }

  /**
   * 两点之间各出行方式的门到门耗时。
   *   a / b 可以是景点，也可以是住宿驻点 —— 两者都带 lng/lat/urban/roadKph/id。
   * 返回 { km, roadKm, urban, items:[{k,name,min,note}], best, bestMin }
   *   items 按耗时升序，并列时按「步行 > 骑行 > 公交 > 自驾」定序（零随机，可复现）。
   * 自驾的纯车程直接调用 driveMin()，与时间轴里那行「车程 N 分」同源 ——
   * 界面上的数不能和行程表打架，这一条写进了 test/map.js。
   */
  function legModes(a, b) {
    if (!a || !b) return null;
    var km = haversineKm(a, b);
    var roadKm = km * ROAD_FACTOR;
    var urban = a.urban === true && b.urban === true;
    var items = [];

    if (km <= WALK_MAX_KM) {
      items.push({
        k: 'walk', name: '步行',
        min: Math.round(km / WALK_KPH * 60),
        note: '按 ' + WALK_KPH + ' km/h'
      });
    }
    if (km <= BIKE_MAX_KM) {
      /* 单车可走支路与绿道，绕行系数比机动车小 */
      items.push({
        k: 'bike', name: '骑行',
        min: BIKE_FETCH + Math.round(km * 1.15 / BIKE_KPH * 60),
        note: '共享单车，含取还车 ' + BIKE_FETCH + ' 分'
      });
    }
    if (roadKm >= TRANSIT_MIN_ROAD_KM && roadKm <= TRANSIT_MAX_ROAD_KM) {
      items.push({
        k: 'transit', name: '公交',
        min: TRANSIT_WAIT + Math.round(roadKm / TRANSIT_KPH * 60),
        note: '含候车与接驳 ' + TRANSIT_WAIT + ' 分'
      });
    }
    var drive = driveMin(a, b);
    var park = urban ? PARK_URBAN : PARK_OTHER;
    items.push({
      k: 'drive', name: '自驾',
      min: drive + park,
      note: '车程 ' + drive + ' 分 + 停车 ' + park + ' 分',
      driveMin: drive
    });

    /* 并列时按插入顺序取先者 —— 同样时长优先少花力气的那种 */
    var seq = {};
    items.forEach(function (it, i) { seq[it.k] = i; });
    items.sort(function (x, y) { return (x.min - y.min) || (seq[x.k] - seq[y.k]); });

    return {
      km: Math.round(km * 10) / 10,
      roadKm: Math.round(roadKm * 10) / 10,
      urban: urban,
      items: items,
      best: items[0].k,
      bestMin: items[0].min
    };
  }

  /* ---------- 坐标系转换 ----------
   * 浏览器 navigator.geolocation 返回的是 WGS-84（GPS 原始坐标），而国内所有
   * 地图服务与本地图的数据包都使用 GCJ-02。不转换会漂移 300–500 米，典型现象
   * 是「定位到马路对面的小区」。这里用公开的偏移算法做 WGS-84 → GCJ-02，
   * 精度约 1–2 米，足够行程规划使用，且不依赖任何地图 API。
   */
  var GCJ_A = 6378245.0, GCJ_EE = 0.00669342162296594323;

  function outOfChina(lng, lat) {
    return !(lng > 73.66 && lng < 135.05 && lat > 3.86 && lat < 53.55);
  }

  function tLat(x, y) {
    var r = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
    r += (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3;
    r += (20 * Math.sin(y * Math.PI) + 40 * Math.sin(y / 3 * Math.PI)) * 2 / 3;
    r += (160 * Math.sin(y / 12 * Math.PI) + 320 * Math.sin(y * Math.PI / 30)) * 2 / 3;
    return r;
  }

  function tLng(x, y) {
    var r = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
    r += (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3;
    r += (20 * Math.sin(x * Math.PI) + 40 * Math.sin(x / 3 * Math.PI)) * 2 / 3;
    r += (150 * Math.sin(x / 12 * Math.PI) + 300 * Math.sin(x / 30 * Math.PI)) * 2 / 3;
    return r;
  }

  function wgs84ToGcj02(lng, lat) {
    if (outOfChina(lng, lat)) return { lng: lng, lat: lat, converted: false };
    var dLat = tLat(lng - 105, lat - 35);
    var dLng = tLng(lng - 105, lat - 35);
    var radLat = lat / 180 * Math.PI;
    var magic = Math.sin(radLat);
    magic = 1 - GCJ_EE * magic * magic;
    var sqrtMagic = Math.sqrt(magic);
    dLat = (dLat * 180) / ((GCJ_A * (1 - GCJ_EE)) / (magic * sqrtMagic) * Math.PI);
    dLng = (dLng * 180) / (GCJ_A / sqrtMagic * Math.cos(radLat) * Math.PI);
    return { lng: +(lng + dLng).toFixed(6), lat: +(lat + dLat).toFixed(6), converted: true };
  }

  /* ---------- 偏好匹配 ---------- */
  function matchScore(a, prefs) {
    if (!prefs || !prefs.length) return 0;
    var n = 0;
    for (var i = 0; i < a.tags.length; i++) {
      if (prefs.indexOf(a.tags[i]) >= 0) n++;
    }
    return n;
  }

  /* ---------- 确定性终止比较器 ----------
   * 打分、停留时长、车程全部打平时，用 id 字典序收敛。这样结果只取决于
   * 「数据内容」，不取决于「数据文件里的书写顺序」。
   * 注：JS 自 ES2019 起保证 sort 稳定，但那只是「保留输入顺序」——输入顺序
   * 本身会随数据文件维护而变化，所以不能拿它当最终裁决。
   * 实测（_order.js）：不补这一层时，把景点数组打乱重排会让 4 组条件里的
   * 3 组行程发生变化，其中一组连去的景点都换了。
   */
  function tieId(x, y) {
    var a = (x && (x.id || x.name)) || '';
    var b = (y && (y.id || y.name)) || '';
    return a < b ? -1 : a > b ? 1 : 0;
  }

  /* ---------- 就近餐饮 ---------- */
  function nearestEat(city, pt) {
    if (!city.eats || !city.eats.length) return null;
    var sorted = city.eats
      .map(function (e) { return { e: e, d: haversineKm(e, pt) }; })
      .sort(function (x, y) { return (x.d - y.d) || tieId(x.e, y.e); });
    var same = null;
    for (var i = 0; i < sorted.length; i++) {
      if (sorted[i].e.district === pt.district && sorted[i].d <= 20) { same = sorted[i]; break; }
    }
    return (same || sorted[0]).e;
  }

  /* ---------- 区县排序：决定今天主打哪个区县 ----------
   * 取该区县「得分最高的前 N 个」求加权和，而不是文件里的前 N 条——否则数据
   * 文件中排在前面的区县会白捡并列分，排序结果取决于书写顺序而非偏好匹配。
   * 未去过的区县优先：多日行程先把每个区县覆盖一遍，再回头补第二遍，
   * 否则景点多的区县会靠"剩余存量"反复压过还没去过的区县。
   *
   * 身份维度（role，三值）：同样一份数据，三类人要的推荐恰好相反——
   *   first  第一次来（默认）  挂牌景区是出行决策的依据。3 天行程理应先把
   *     5A/4A 覆盖掉，否则「来银川三天没去西夏陵」比绕路更糟。
   *   repeat 多次来   招牌景点早年看过，权重压到 4A/5A 之下：3A 与没评级的
   *     新鲜点位上来。但不压到 0——外地二次游客仍然认牌子，只是不再头号。
   *   local  本地   4A/5A 是本地人年轻时就去过的地方，无评级与 3A 才是
   *     「没听说过的新鲜点位」，权重反过来加。
   * 权重全部由景点已有的 level 字段推导，不为身份新增任何数据字段——换一座
   * 城市，只要数据包标了 level，三套取向同时成立。
   */
  var ROLE_FIRST = 'first', ROLE_REPEAT = 'repeat', ROLE_LOCAL = 'local';

  /* 归一化身份：认 'first' / 'repeat' / 'local'，也认旧的布尔 local
     （true=local、false/不传=first）——老调用点不会静默变成另一套推荐。 */
  function normRole(role) {
    if (role === true) return ROLE_LOCAL;
    if (role === ROLE_REPEAT || role === ROLE_LOCAL) return role;
    return ROLE_FIRST;
  }

  function levelBonus(a, role) {
    var lv = a.level;
    if (role === ROLE_LOCAL) return !lv ? 2 : (lv === '3A' ? 1 : lv === 'AA' ? 0.5 : 0);
    if (role === ROLE_REPEAT) {
      return !lv || lv === '3A' || lv === 'AA' ? 1.5
        : lv === '4A' ? 0.75 : lv === '5A' ? 0.5 : 0;
    }
    return lv === '5A' ? 3 : lv === '4A' ? 1.5 : lv === '3A' ? 0.75 : lv === 'AA' ? 0.25 : 0;
  }

  function rankDistricts(pool, used, visited, origin, cap, role) {
    var byD = {}, order = [];
    for (var i = 0; i < pool.length; i++) {
      var a = pool[i];
      if (used.has(a.id)) continue;
      if (!byD[a.district]) { byD[a.district] = []; order.push(a.district); }
      byD[a.district].push(a);
    }
    return order.map(function (d) {
      var list = byD[d].slice().sort(function (x, y) {
        return (y._score - x._score) || (y.stay - x.stay) || tieId(x, y);
      });
      var sum = 0, best = 0;
      var top = list.slice(0, MAX_SPOTS_PER_DAY);
      top.forEach(function (a) {
        sum += a._score * 2 + 1 + levelBonus(a, role);
        if (a._score > best) best = a._score;
      });
      /* 可达性折扣：驻点会随用户住宿位置移动，所以不能只看偏好得分。
         若某区县离驻点越远，它的得分要按比例打折——否则会出现「住镇北堡、
         第一天先跑 107 分钟到黄河东岸」这种只看分数不看代价的安排。
         折扣最多 55%，保留偏好仍是主要因素、距离只做修正。 */
      var near = Infinity;
      for (var j = 0; j < list.length; j++) {
        var t = driveMin(origin, list[j]);
        if (t < near) near = t;
      }
      var reach = (cap && isFinite(near)) ? Math.min(1, near / cap.MAX_FIRST) : 0;
      return {
        district: d, sum: sum, best: best, n: list.length,
        near: near, seen: visited[d] === true,
        score: sum * (1 - 0.55 * reach)
      };
    }).sort(function (x, y) {
      return ((x.seen ? 1 : 0) - (y.seen ? 1 : 0)) ||
             (y.score - x.score) || (y.sum - x.sum) ||
             (y.best - x.best) || (y.n - x.n) ||
             (x.district < y.district ? -1 : x.district > y.district ? 1 : 0);
    });
  }

  /* ---------- 组装某一天 ----------
   * Wd = { s: 当日开始时刻, e: 当日结束时刻, dow: 星期几 }。动态重排时首日的 s 就是
   * 「现在几点」，因此同一天的可用时长会随当前时刻缩短，阈值也随之收紧。
   * 每个点位放入前都要过一遍 fitsWindow：此刻赶到还进得去、且闭园前走得完。
   */
  function buildDay(seat, pool, used, Wd, city, cap) {
    var prim = pool
      .filter(function (a) { return a.district === seat.district && !used.has(a.id); })
      .sort(function (x, y) { return (y._score - x._score) || (y.stay - x.stay) || tieId(x, y); });
    if (!prim.length) return null;

    /* 锚点取「得分最高、驻点到得了、且此刻到达还进得去」的那一个。原来直接取
       prim[0]，一旦它超出单点车程上限就整区放弃——但同区往往有更近的点可以去。 */
    var anchor = null, anchorPlan = null;
    for (var k = 0; k < prim.length; k++) {
      var ta = driveMin(city.base, prim[k]);
      if (ta > cap.MAX_FIRST) continue;
      var fa = planFits(prim[k], Wd.s + ta, Wd);
      if (!fa.ok) continue;
      anchor = prim[k];
      anchorPlan = { travelMin: ta, stay: fa.stay, wait: fa.wait || 0, trimmed: !!fa.trimmed };
      break;
    }
    if (!anchor) return null;

    /* 已过饭点才出发的一天不会再插午餐，预算是同步的，这里也不预留午餐时间——
       否则排程会白留 60 分钟，导致下午出发的行程明显偏空。 */
    var addLunch = Wd.lunch === false ? 0 : LUNCH;

    var items = [{
      a: anchor, travelMin: anchorPlan.travelMin,
      stay: anchorPlan.stay, wait: anchorPlan.wait, trimmed: anchorPlan.trimmed
    }];
    var taken = {};
    taken[anchor.id] = true;
    var cur = Wd.s + anchorPlan.travelMin + anchorPlan.wait + anchorPlan.stay + addLunch;

    function last() { return items[items.length - 1].a; }

    /** 从候选池里按「偏好匹配优先、其次更近」逐点扩展 */
    function extend(list, sameOnly, hopLimit) {
      while (items.length < MAX_SPOTS_PER_DAY) {
        var best = null, bestT = Infinity, bestPlan = null;
        for (var i = 0; i < list.length; i++) {
          var a = list[i];
          if (taken[a.id] || used.has(a.id)) continue;
          if (sameOnly && a.district !== seat.district) continue;
          if (!sameOnly && a.district === seat.district) continue;
          var t = driveMin(last(), a);
          if (t > hopLimit) continue;
          var fp = planFits(a, cur + t, Wd);
          if (!fp.ok) continue;
          /* 打分相同时取更近的；若「打分 + 车程」都相同，则用 id 收敛，
             否则会退化成「谁在数据文件里写在前面就选谁」。 */
          var better = !best || a._score > best._score ||
                       (a._score === best._score && t < bestT) ||
                       (a._score === best._score && t === bestT && tieId(a, best) < 0);
          if (better) {
            best = a; bestT = t;
            bestPlan = { stay: fp.stay, wait: fp.wait || 0, trimmed: !!fp.trimmed };
          }
        }
        if (!best) break;
        cur += bestT + bestPlan.wait + bestPlan.stay;
        items.push({
          a: best, travelMin: bestT,
          stay: bestPlan.stay, wait: bestPlan.wait, trimmed: bestPlan.trimmed
        });
        taken[best.id] = true;
      }
    }

    /* 阶段 A：把主区玩透 */
    extend(prim, true, cap.MAX_HOP);
    /* 阶段 B：时间有余，就近溢出到邻区 */
    if (items.length < MAX_SPOTS_PER_DAY) extend(pool, false, cap.SPILL_MAX);

    return {
      items: items,
      endAt: cur,
      lastPt: last()
    };
  }

  /* ---------- 夜游点 ----------
   * 优先用「专供夜游」的点（slot:night），只有当它们都不合适时，才动用
   * 「白天夜里都能去」的点（slot:both）。否则 both 类型的点会被别的区县当晚
   * 游消耗掉，导致它自己所属区县排不出一整天的行程。
   * 返回 { a, stay, wait }（而不是直接返回景点），这样夜间点的实际游览时长
   * 也能被开放时间压缩，并与白天点位一样如实反映到时间轴上。
   */
  function pickNight(pool, used, lastPt, curAt, city, dow, capAt) {
    var hardCap = capAt == null ? NIGHT_CAP : capAt;
    var avail = pool.filter(function (a) { return !used.has(a.id); });

    function tryPick(list) {
      var candid = list
        .map(function (a) {
          var go = driveMin(lastPt, a), back = driveMin(a, city.base);
          return { a: a, go: go, back: back, fp: fitsWindow(a, curAt + go, dow) };
        })
        .filter(function (c) { return c.go <= 45 && c.fp.ok; })
        .sort(function (x, y) {
          return (y.a._score - x.a._score) || ((x.go + x.back) - (y.go + y.back)) || tieId(x.a, y.a);
        });
      for (var i = 0; i < candid.length; i++) {
        var c = candid[i];
        if (curAt + c.go + c.fp.wait + c.fp.stay + c.back <= hardCap) {
          return { a: c.a, stay: c.fp.stay, wait: c.fp.wait || 0 };
        }
      }
      return null;
    }

    var pure = avail.filter(function (a) { return a.slot === 'night'; });
    var flex = avail.filter(function (a) { return a.slot !== 'night'; });
    return tryPick(pure) || tryPick(flex);
  }

  /* ---------- 住宿驻点 → 引擎 base ----------
   * 住宿驻点可以来自数据包（用户选片区），也可以来自浏览器定位或手输坐标。
   * urban 决定市区拥堵时速，若来源未标注就按「距市区景点是否在 6 公里内」推断。
   */
  function inferUrban(city, pt) {
    if (!city || !city.attractions) return false;
    for (var i = 0; i < city.attractions.length; i++) {
      var a = city.attractions[i];
      if (a.urban && haversineKm(a, pt) < 6) return true;
    }
    return false;
  }

  function toBase(lodging, city) {
    if (!lodging) return city ? city.base : null;
    var pt = {
      id: 'base', name: lodging.name || '行程驻点',
      district: lodging.district || '', lng: lodging.lng, lat: lodging.lat
    };
    var urban = typeof lodging.urban === 'boolean' ? lodging.urban : inferUrban(city, pt);
    pt.urban = urban;
    pt.roadKph = lodging.roadKph || (urban ? 58 : 54);
    return pt;
  }

  /* ---------- 就近检索：从某点出发按车程取最近的若干净景点
   * 两个用途：① 驻点可达性预检 ② 驻点过远时给出「那附近能去哪」的候选
   */
  function nearestFrom(pool, from, used, n) {
    var list = pool
      .filter(function (a) { return !used || !used.has(a.id); })
      .map(function (a) { return { a: a, min: driveMin(from, a) }; })
      .sort(function (x, y) { return (x.min - y.min) || (y.a.stay - x.a.stay) || tieId(x.a, y.a); });
    return {
      min: list.length ? list[0].min : Infinity,
      list: n ? list.slice(0, n) : list
    };
  }

  /* ---------- 派生「当日可用时段」与阈值 ----------
   * 动态重排时首日从 opts.startAt（=现在几点）起算，可用时长随之缩短，因此
   * 三个距离阈值也跟着按「实际剩余时长」推导，而不是按节奏档位的固定值。
   * 同时设下限，避免傍晚打开时阈值被压成 0、连近处都排不进去。
   */
  function deriveCaps(W, first) {
    var budget = Math.max(60, W.e - first);
    return {
      budget: budget,
      MAX_FIRST: Math.max(45, Math.min(150, Math.round(budget * 0.26))),  // 单点最远车程
      MAX_HOP:   Math.max(20, Math.min(55,  Math.round(budget * 0.10))),  // 同日内段间最大车程
      SPILL_MAX: Math.max(15, Math.min(50,  Math.round(budget * 0.085)))  // 溢出到邻区的最大车程
    };
  }

  function copyCity(city, base) {
    if (!base) return city;
    var c = {};
    for (var k in city) if (Object.prototype.hasOwnProperty.call(city, k)) c[k] = city[k];
    c.base = base;
    return c;
  }

  /* ---------- 「现在还能去哪」 ----------
   * 动态重排的诊断视图：把候选池里每个点按「从驻点出发、此刻到达、还进不进得去」
   * 逐条判定，分成「能去」「去不了」两组，并给出各自的原因。
   * 纯函数：驻点、当前时刻、星期、已去过、偏好、节奏固定则输出固定。
   * 与 plan() 共用 fitsWindow 与 deriveCaps，因此两边的判断口径必然一致。
   */
  function dayCandidates(city, opts) {
    var W = PACE[opts.pace] || PACE.normal;
    var startAt = opts.startAt == null ? W.s : Math.max(0, Math.min(24 * 60, opts.startAt));
    var dow = opts.dayOfWeek == null ? null : ((opts.dayOfWeek % 7) + 7) % 7;
    var cap = deriveCaps(W, startAt);
    /* 与 plan() 用同一个 Wd 结构，因此「能去」的判断口径与行程排程完全一致 */
    var Wd = { s: startAt, e: W.e, dow: dow, lunch: startAt < LUNCH_LATE };
    var ctx = copyCity(city, opts.base);
    var seen = {};
    (opts.visitedIds || []).forEach(function (id) { seen[id] = true; });

    var items = ctx.attractions.map(function (a) {
      var score = matchScore(a, opts.prefs);
      if (seen[a.id]) {
        return { a: a, score: score, ok: false, reason: 'visited', detail: '今天已经去过' };
      }
      var drive = driveMin(ctx.base, a);
      var arriveAt = startAt + drive;
      var rec = { a: a, score: score, drive: drive, arriveAt: arriveAt };
      if (drive > cap.MAX_FIRST) {
        rec.ok = false;
        rec.reason = 'far';
        rec.detail = '车程 ' + drive + ' 分钟，超出当下的可达上限 ' + cap.MAX_FIRST + ' 分钟';
        return rec;
      }
      var fp = planFits(a, arriveAt, Wd);
      rec.openInfo = parseOpen(a.open);
      rec.reserve = rec.openInfo.needReserve;
      if (!fp.ok) {
        rec.ok = false; rec.reason = fp.why; rec.detail = fp.detail;
        return rec;
      }
      rec.ok = true;
      rec.stay = fp.stay;
      rec.wait = fp.wait || 0;
      rec.trimmed = !!fp.trimmed;
      rec.detail = fp.detail || '';
      return rec;
    });

    /* 能去的排前面；同组内先按偏好匹配、再按车程由近及远 */
    items.sort(function (x, y) {
      return ((x.ok ? 0 : 1) - (y.ok ? 0 : 1)) || (y.score - x.score) ||
             ((x.drive == null ? 9999 : x.drive) - (y.drive == null ? 9999 : y.drive)) ||
             tieId(x.a, y.a);
    });

    return {
      base: ctx.base, startAt: startAt, dow: dow, W: W, cap: cap, items: items,
      ok: items.filter(function (x) { return x.ok; }),
      blocked: items.filter(function (x) { return !x.ok && x.reason !== 'visited'; }),
      visited: items.filter(function (x) { return x.reason === 'visited'; })
    };
  }

  /* ---------- 主入口 ----------
   * opts 新增三个可选项（不传则行为与原来完全一致）：
   *   startAt      首日从几点开始（分钟数）。动态重排时就是「现在几点」。
   *   dayOfWeek    首日的星期（0=周日…6=周六）。用于「周一闭馆」这类判断；
   *                第 n 天自动取 (dayOfWeek + n) % 7。
   *   visitedIds   已经去过的景点 id。只影响「不再重复安排」，不改变其余逻辑。
   *   role         用户对银川的熟悉程度：'first' 第一次来（默认，挂牌景区优先）、
   *                'repeat' 多次来（招牌景区权重下调，3A/没评级的新鲜点位上浮）、
   *                'local' 本地（反过来，无评级/3A 优先）。界面上的问法是玩法取向，
   *                答案归一成这三档。只影响「主打哪个区县」的排序，
   *                不改动任何点位的开闭园、时长与车程口径。
   *                另认旧的布尔 local（true=local、false=first）。
   */
  function plan(city, opts) {
    var role = normRole(opts.role !== undefined ? opts.role : opts.local);
    var W = PACE[opts.pace] || PACE.normal;
    var first = opts.startAt == null ? W.s : Math.max(0, Math.min(24 * 60, opts.startAt));
    var dow0 = opts.dayOfWeek == null ? null : ((opts.dayOfWeek % 7) + 7) % 7;
    var cap = deriveCaps(W, first);

    /* 行程驻点：默认用数据包的 base，可由 opts.base 覆盖（用户选定的住宿位置，
       或浏览器定位结果）。覆盖之后引擎其余部分无需感知——所有车程都从
       city.base 推导，所以换驻点即等价于换一条行程，一行都不用改算法。 */
    var ctx = copyCity(city, opts.base);

    var all = ctx.attractions.map(function (a) {
      var o = {};
      for (var k in a) if (Object.prototype.hasOwnProperty.call(a, k)) o[k] = a[k];
      o._score = matchScore(a, opts.prefs);
      return o;
    });
    var dayPool = all.filter(function (a) { return a.slot !== 'night'; });
    var nightPool = all.filter(function (a) { return a.slot === 'night' || a.slot === 'both'; });

    var used = {};
    var visited = {};
    var usedSet = {
      has: function (id) { return used[id] === true; },
      add: function (id) { used[id] = true; }
    };
    /* 已经去过的点直接视为「本趟不可再用」，从而不会被重复排进行程 */
    (opts.visitedIds || []).forEach(function (id) { used[id] = true; });

    /* 说明：不再用「最近景点是否超上限」做一次性预检就下结论——那样会漏掉
       「第一天能排、后面几天排不上」的情况（例如人已到中卫，去青铜峡只要
       126 分钟仍能排一天，于是头一天有内容、后面几天静默空白）。改为逐日
       记录排不出的原因，最后统一汇总成 notice。 */
    var days = [];
    for (var d = 0; d < opts.days; d++) {
      var dayStart = d === 0 ? first : W.s;
      var Wd = {
        s: dayStart,
        e: W.e,
        dow: dow0 == null ? null : (dow0 + d) % 7,
        lunch: dayStart < LUNCH_LATE,      // 13:30 之后才出发的一天不再插午餐
        /* 夜游与晚间自由活动的硬性收尾时刻。
           经典规划（无 startAt）沿用 22:30，此时 W.e 表示「白天游览结束」，
           晚间安排是额外附赠的；而「已在路上」模式用户明确说了今天玩到几点，
           就以此为准——否则会出现「收工 19:00，却安排了一场 22:20 结束的夜游」。 */
        nightCap: opts.startAt == null ? NIGHT_CAP : Math.min(NIGHT_CAP, W.e)
      };

      /* 起点已经晚于当日结束时刻（例如「现在 21:00」而收工时间设成 19:00），
         此时任何安排都无从谈起，直接按时间窗原因留空并给出提示。 */
      if (Wd.s >= Wd.e) {
        days.push({
          items: [], night: null, district: null, startAt: Wd.s, dow: Wd.dow, lunch: Wd.lunch, nightCap: Wd.nightCap,
          reason: 'window'
        });
        continue;
      }

      var ranked = rankDistricts(dayPool, usedSet, visited, ctx.base, cap, role);
      var built = null;
      for (var r = 0; r < ranked.length; r++) {
        built = buildDay(ranked[r], dayPool, usedSet, Wd, ctx, cap);
        if (built && built.items.length) break;
        built = null;
      }
      if (!built) {
        /* 排不出的原因分三类，给用户的建议完全不同，所以要分开判定：
             too-far   连车程都够不着（驻点超出数据包服务范围）
             window    车程够得着，但此刻到达全都关门了/赶不上停止入园/剩余时间不够
             exhausted 点位还有、时间也够，但偏好或供给已被排完 */
        var reachable = 0, fits = 0, earlyOnly = 0, lateOnly = 0;
        for (var q = 0; q < dayPool.length; q++) {
          var pa = dayPool[q];
          if (usedSet.has(pa.id)) continue;
          var pt = driveMin(ctx.base, pa);
          if (pt > cap.MAX_FIRST) continue;
          reachable++;
          var pf = planFits(pa, Wd.s + pt, Wd);
          if (pf.ok) fits++;
          else if (pf.why === 'beforeOpen') earlyOnly++;
          else lateOnly++;
        }
        /* 「还没开门」与「已经关门/来不及」是两种完全不同的困境：前者该把时间往后调，
           后者该把收工时间往后调或改早时间。因此单独标记 early，供上层给出对的建议。 */
        days.push({
          items: [], night: null, district: null, startAt: Wd.s, dow: Wd.dow, lunch: Wd.lunch, nightCap: Wd.nightCap,
          reason: reachable === 0 ? 'too-far' : (fits === 0 ? 'window' : 'exhausted'),
          early: fits === 0 && earlyOnly > 0 && lateOnly === 0
        });
        continue;
      }

      visited[built.items[0].a.district] = true;
      built.items.forEach(function (it) { usedSet.add(it.a.id); });

      var npick = pickNight(nightPool, usedSet, built.lastPt, built.endAt, ctx, Wd.dow, Wd.nightCap);
      if (npick) usedSet.add(npick.a.id);

      days.push({
        items: built.items,
        night: npick ? npick.a : null,
        nightMeta: npick,
        district: built.items[0].a.district,
        startAt: Wd.s,
        dow: Wd.dow,
        lunch: Wd.lunch,
        nightCap: Wd.nightCap,
        reached: Object.keys(used).length
      });
    }

    /* 汇总「排不出」的原因：可达性限制（驻点太远）、时间窗限制（太晚了）、
       供给限制（偏好过窄或点位已排完）三回事，给用户的建议也不同。 */
    var tooFar = 0, exhausted = 0, windowed = 0, earlyDays = 0, builtDays = 0;
    days.forEach(function (dy) {
      if (dy.items.length) { builtDays++; return; }
      if (dy.reason === 'too-far') tooFar++;
      else if (dy.reason === 'window') { windowed++; if (dy.early) earlyDays++; }
      else exhausted++;
    });

    var notice = null;
    var emptyDays = tooFar + windowed + exhausted;
    if (emptyDays) {
      var cand = nearestFrom(dayPool, ctx.base, usedSet, 3);
      var kind;
      if (builtDays === 0) {
        kind = tooFar ? 'too-far'
          : (!windowed ? 'none-left'
            : (earlyDays === windowed ? 'too-early' : 'too-late'));
      } else {
        kind = 'partial';
      }
      notice = {
        kind: kind,
        originName: ctx.base.name,
        originDistrict: ctx.base.district || '—',
        limit: cap.MAX_FIRST,
        nearest: cand.min,
        emptyDays: emptyDays,
        startAt: first,
        tooFar: tooFar, windowed: windowed, exhausted: exhausted, earlyDays: earlyDays,
        candidates: cand.list
      };
    }
    return { days: days, W: W, cap: cap, city: ctx, notice: notice, startAt: first, dayOfWeek: dow0 };
  }

  /* ---------- 时间轴：把一天的点位展开成分钟级事件流 ----------
   * 起始时刻取 day.startAt（动态重排时就是「现在几点」），而不是节奏档位的固定值。
   * 到达后若尚未开园，插入一段 wait 事件；游览时长用排程时算好的 it.stay，
   * 保证时间轴与排程结果一致（含闭园前的压缩游览）。
   * 另有一条：午后才开始的一天默认已用过午餐，不再插入「午餐」，
   * 否则会在 14:45 弹出一顿午饭。
   *
   * 一次游览最多对应两条 visit 事件，且只在这一个条件下发生：不切开就要过 LUNCH_LATE
   * 才吃得上饭。此时前段标 break、后段标 cont，两段是同一次游览的两半，
   * 时长之和等于 total。界面必须把两段读回一行——否则同一天会出现同一处景点两行，
   * 读起来就是「重复推荐」。
   */
  function timeline(city, day, W) {
    var ev = [];
    var cur = day.startAt != null ? day.startAt : W.s;
    /* 是否安排午餐与排程侧同源：day.lunch 由 plan() 决定（13:30 之后出发即视为已吃过）。
       没有该字段时（例如手工构造的 day）按起始时刻推断。 */
    var wantLunch = day.lunch === undefined ? (cur < LUNCH_LATE) : day.lunch !== false;
    /* 当天夜间安排的硬性收尾时刻：经典规划为 22:30，「已在路上」模式取用户的收工时间 */
    var dayCap = day.nightCap === undefined ? NIGHT_CAP : day.nightCap;
    var lunch = false, prev = city.base;

    day.items.forEach(function (it) {
      var a = it.a;
      var t = driveMin(prev, a);
      cur += t;
      ev.push({
        k: 'travel', from: prev.id === city.base.id ? city.base.name : prev.name,
        to: a.name, min: t, at: cur
      });

      var wait = it.wait || 0;
      if (wait > 0) {
        ev.push({ k: 'wait', at: cur, min: wait, name: a.name, openAt: parseOpen(a.open).start });
        cur += wait;
      }

      var remain = it.stay != null ? it.stay : a.stay;
      var endAt = cur + remain;

      /* 是否切开，要同时满足四条，缺一条就不切：
         ① 不切就得过 LUNCH_LATE 才吃得上饭（否则是白跑一趟，见常量处的说明）；
         ② 前后两段都不少于 SPLIT_MIN；
         ③ 切开会把这一站的占用整体拉长一顿饭 —— 拉长之后仍要在闭园前结束。
         少了第 ③ 条就会出现「为了吃午饭，17:00 闭园的景区被排到 17:17 才离开」
         这种自相矛盾的行程（实测扫出 210 处），而闭园时间本来是排程已经校验过的硬约束；
         ④ 切点本身仍要落在 LUNCH_MAX 之前。出发时刻偏晚（12:00–13:30）又碰上长车程时，
           切点会被 cur + SPLIT_MIN 推到 14:30 以后，那时插「午餐」同样不合理。 */
      var op = parseOpen(a.open);
      var closeAt = (op.allDay || op.end == null || op.end > 24 * 60) ? Infinity : op.end;
      var splitAt = Math.min(Math.max(LUNCH_AT, cur + SPLIT_MIN), endAt - SPLIT_MIN);

      if (lunch || !wantLunch) {
        ev.push({ k: 'visit', a: a, from: cur, to: endAt, stay: remain });
        cur = endAt;
      } else if (endAt > LUNCH_LATE && remain >= 2 * SPLIT_MIN && cur + remain + LUNCH <= closeAt &&
                 splitAt <= LUNCH_MAX) {
        /* 走到这个点结束才吃饭，就已经过 13:30 了 —— 这时才值得把午餐切进游览中途。
           门槛不是「跨过 12:00」：那样会出现「到 12:45 就能玩完、却偏要 12:00 出去吃一趟再回来」
           的行程，等于把一次游览拆成两次。门槛设在「不吃就太晚」这条线上，
           切分才是净收益（实测：门槛 12:45 时有 13.8% 的到访被切开，13:30 时降到 8.0%）。
           切点不早于 12:00，且前后两段都不少于 SPLIT_MIN。
           两段是同一次游览被午餐切开的，不是去了两次：前段带 break 标记、后段带 cont 标记，
           界面据此把两段读回一行。 */
        var afterLunch = remain - (splitAt - cur);
        var eatAt = nearestEat(city, a);
        ev.push({
          k: 'visit', a: a, from: cur, to: splitAt, stay: splitAt - cur, total: remain,
          break: { at: splitAt, min: LUNCH, back: splitAt + LUNCH, place: eatAt }
        });
        ev.push({ k: 'meal', kind: '午餐', at: splitAt, min: LUNCH, place: eatAt, inVisit: true });
        lunch = true;
        cur = splitAt + LUNCH;
        ev.push({
          k: 'visit', a: a, from: cur, to: cur + afterLunch,
          stay: afterLunch, total: remain, cont: true
        });
        cur += afterLunch;
      } else {
        ev.push({ k: 'visit', a: a, from: cur, to: endAt, stay: remain });
        cur = endAt;
        /* 只有在 12:00 之后、且还赶得上吃才插；早于 12:00 留给下一个点（避免 10:50 吃午饭），
           晚于 LUNCH_MAX（14:30）则说明这一天出发太晚、又被闭园挡住了切分，
           此时再插一顿「午餐」只会显示成 15:00 以后的午饭，不如不插。 */
        if (endAt >= LUNCH_AT && endAt <= LUNCH_MAX) {
          ev.push({ k: 'meal', kind: '午餐', at: cur, min: LUNCH, place: nearestEat(city, a) });
          cur += LUNCH; lunch = true;
        }
      }
      prev = a;
    });

    /* 全天行程都在 12:00 前结束时的兜底（午后出发的一天不补午餐）。
       但兜底本身也要守两条线：不早于 LUNCH_EARLY、不晚于 LUNCH_MAX——
       一天 10:49 就走完了再插一顿 10:49 的午饭不合常理；反过来，行程已经
       走到 15:00 以后再补一顿「午餐」同样不合常理，两者都是自检会拦的。 */
    if (!lunch && wantLunch && day.items.length && cur >= LUNCH_EARLY && cur <= LUNCH_MAX) {
      ev.push({ k: 'meal', kind: '午餐', at: cur, min: LUNCH, place: nearestEat(city, prev) });
      cur += LUNCH;
    }

    var night = day.night, nmeta = day.nightMeta;
    if (night) {
      var go = driveMin(prev, night);
      var back = driveMin(night, city.base);
      var nStay = nmeta && nmeta.stay != null ? nmeta.stay : night.stay;
      var nWait = (nmeta && nmeta.wait) || 0;
      if (cur + go + nWait + nStay + back > dayCap) night = null;
      else {
        ev.push({ k: 'travel', from: prev.name, to: night.name, min: go, at: cur + go, evening: true });
        cur += go;
        if (nWait > 0) {
          ev.push({ k: 'wait', at: cur, min: nWait, name: night.name, openAt: parseOpen(night.open).start, evening: true });
          cur += nWait;
        }
        ev.push({ k: 'visit', a: night, from: cur, to: cur + nStay, stay: nStay, evening: true });
        cur += nStay;
        ev.push({ k: 'travel', from: night.name, to: city.base.name, min: back, at: cur + back, evening: true, ret: true });
        cur += back;
        prev = night;
      }
    }

    if (!night) {
      var b = driveMin(prev, city.base);
      if (b > 0) {
        /* ret 标记「回驻点」那一段：时间轴上它和普通转场长得一样，
           但读者要能一眼看出这一天在此收尾（不是又要去一个地方）。
           任何界面都别靠「to === 驻点名」去猜 —— 驻点名可改，标记不可改。 */
        ev.push({ k: 'travel', from: prev.name, to: city.base.name, min: b, at: cur + b, ret: true });
        cur += b;
      }
      /* 已经太晚就不再安排「晚间自由活动」，避免出现 23:30 还在晚间活动 */
      if (cur + EVENING <= dayCap) {
        var e = nearestEat(city, city.base);   // 此时已回到驻点，晚餐按驻点就近推荐
        ev.push({ k: 'evening', at: cur, min: EVENING, place: e ? e.name : '市区夜市' });
        cur += EVENING;
      }
    }

    return { ev: ev, end: cur, nightOn: night };
  }

  /* ---------- 统计 ---------- */
  function summarize(city, built) {
    var tickets = 0, spots = 0, travel = 0;
    built.forEach(function (b) {
      b.d.items.forEach(function (it) { tickets += it.a.ticket; spots += 1; });
      if (b.tl.nightOn) { tickets += b.tl.nightOn.ticket; spots += 1; }
      b.tl.ev.forEach(function (e) { if (e.k === 'travel') travel += e.min; });
    });
    return { tickets: tickets, spots: spots, travel: travel };
  }

  /* ---------- 多数据包合并：这就是「换数据包即扩展」的实现 ---------- */
  function buildCity(packIds) {
    var packs = (packIds || [])
      .map(function (id) { return global.CITY_DATA && global.CITY_DATA[id]; })
      .filter(Boolean);
    if (!packs.length) return null;
    var main = packs[0];
    var city = {
      id: packIds.join('+'),
      name: packs.map(function (p) { return p.name; }).join(' + '),
      coordSystem: main.coordSystem,
      districts: {},
      attractions: [],
      eats: [],
      base: main.base
    };
    packs.forEach(function (p) {
      var d = p.districts || {};
      for (var k in d) if (Object.prototype.hasOwnProperty.call(d, k)) city.districts[k] = d[k];
      city.attractions = city.attractions.concat(p.attractions || []);
      city.eats = city.eats.concat(p.eats || []);
    });
    return city;
  }

  /* ==========================================================================
   * 景点攻略卡（结果页点景点名时展开的内容）
   * --------------------------------------------------------------------------
   * 全部来自数据包字段与坐标推导，不引入任何外部文案库：
   *   背景 / 看点    ← spot.bg、spot.hl（看点按顿号拆成条目）
   *   出行提示       ← parseOpen(spot.open) 的结构化结果（闭馆日、停止入园、需预约、季节备注）
   *   从驻地过去     ← driveMin(city.base, spot)
   *   上一站 / 下一站 ← 调用方传入的本次行程上下文 ctx（界面从时间轴取，保证与用户看到的一致）
   *   同片区顺路     ← 同区县优先 + 车程由近及远
   *   就近用餐       ← city.eats 同区县优先 + 车程由近及远
   * 纯函数：不读时间、不读随机数、不改入参；所有并列一律交给 tieId 裁决，
   * 因此同一输入必得同一输出，可像排程一样被独立验证（见 test/spot-guide.js）。
   * ========================================================================== */
  var GUIDE_NEAR_MIN = 45;    // 「顺路可一起安排」的车程上限（分钟）
  var GUIDE_NEAR_RELAX = 75;  // 上限内不足两个时放宽到此值，避免山区点位孤立无推荐

  /* 分钟数转口语化文本，用于攻略里的说明句 */
  function minText(min) {
    if (min == null) return '—';
    if (min < 60) return min + ' 分钟';
    var h = Math.floor(min / 60), m = min % 60;
    return m ? h + ' 小时 ' + m + ' 分钟' : h + ' 小时';
  }

  /* 「看点」字段用顿号分隔，拆成条目便于排版 */
  function splitPoints(str) {
    return String(str == null ? '' : str)
      .split(/[、；;]/)
      .map(function (t) { return t.replace(/^[\s，,。；、]+|[\s，,。；、]+$/g, ''); })
      .filter(function (t) { return !!t; });
  }

  function slotText(slot) {
    return slot === 'night' ? '以夜间体验为主'
      : slot === 'both' ? '白天、夜晚均可'
      : '白天游览';
  }

  /* 同区县优先、其次车程近。同区县优先是因为「顺路」在国内旅游语境下就是同一片区串点 */
  function cmpSameDistrict(origin) {
    return function (x, y) {
      var sx = x.district === origin.district ? 0 : 1;
      var sy = y.district === origin.district ? 0 : 1;
      return (sx - sy) || (x.min - y.min) || tieId(x.o, y.o);
    };
  }

  function guideNearby(city, spot, limit) {
    var pool = (city.attractions || []).filter(function (a) { return a.id !== spot.id; });
    function rank(cap) {
      return pool
        .map(function (a) { return { o: a, district: a.district, min: driveMin(spot, a) }; })
        .filter(function (x) { return x.min <= cap; })
        .sort(cmpSameDistrict(spot));
    }
    var list = rank(GUIDE_NEAR_MIN);
    if (list.length < 2) list = rank(GUIDE_NEAR_RELAX);
    return list.slice(0, limit || 3);
  }

  function guideEats(city, spot, limit) {
    return (city.eats || [])
      /* 景点本身就是吃饭的地方时（夜市、美食街），别把它推荐给自己 */
      .filter(function (e) { return e.name !== spot.name; })
      .map(function (e) { return { o: e, district: e.district, min: driveMin(spot, e) }; })
      .sort(cmpSameDistrict(spot))
      .slice(0, limit || 3);
  }

  /* ==========================================================================
   * 免票政策（数据包可选字段 spot.free）
   * --------------------------------------------------------------------------
   * 数据包按「适用日期区间 + 星期几」分时段登记，引擎只负责拼句与展示：
   *   不判断当前落在哪个时段——引擎没有日期输入（零时间依赖的硬约束）；
   *   不据此改预算——人均门票仍按全价口径累加，读者自己对照日期。
   * 因此这里全是纯字符串拼装，同一输入必得同一输出。
   * ========================================================================== */

  /* [1, 3] → '每周一、周三'（与闭馆日提示同一套写法，一处换算两处复用） */
  function dowListText(dows) {
    return '每' + dows.map(function (d) { return '周' + dowChar(d); }).join('、');
  }

  /* 政策全文形如「适用区间 每周X；…，优惠对象（除外情形）」——由数据包的
     periods / scope / except 拼出。区间或星期缺失的段直接跳过，
     一段都不剩时返回空串——调用方据此整行不显示，而不是摆一句空话。 */
  function freePolicyText(free) {
    if (!free || !free.periods || !free.periods.length) return '';
    var body = free.periods.map(function (p) {
      var dows = (p.dows || []).filter(function (d) { return d >= 0 && d <= 6; });
      if (!p.range || !dows.length) return '';
      return p.range + ' ' + dowListText(dows);
    }).filter(Boolean).join('；');
    if (!body) return '';
    return body + (free.scope ? '，' + free.scope : '') +
      (free.except ? '（' + free.except + '）' : '');
  }

  /* 时间轴上的短标签：全部时段的星期并集，'周一/周三免首道门票'。
     精确到哪个时段免哪几天由攻略卡讲，标签只负责让人知道「这天不一定得付全价」。 */
  function freeTagText(free) {
    if (!free || !free.periods) return '';
    var seen = {};
    free.periods.forEach(function (p) {
      (p.dows || []).forEach(function (d) { if (d >= 0 && d <= 6) seen[d] = true; });
    });
    var dows = Object.keys(seen).map(Number).sort(function (x, y) { return x - y; });
    return dows.length
      ? dows.map(function (d) { return '周' + dowChar(d); }).join('/') + '免首道门票'
      : '';
  }

  /* 出行提示：逐条由数据推导，不写死任何结论 */
  function guideTips(spot, o, ctx) {
    var tips = [];
    if (o.closedWeekdays.length) {
      tips.push(o.closedWeekdays.map(function (d) {
        return '周' + dowChar(d);
      }).join('、') + '闭馆，安排到访日时要避开这几天。');
    }
    if (o.lastEntry != null) {
      tips.push('每天 ' + fmtHM(o.lastEntry) + ' 停止入园，务必在此之前抵达，否则当天进不去。');
    }
    if (o.needReserve) {
      tips.push('需提前预约，建议出发前一天电话或公众号确认名额。');
    }
    if (o.allDay) {
      tips.push('全天开放，不受开闭园时刻限制，适合作为行程里的机动点。');
    } else if (o.start != null && o.end != null) {
      /* end 跨过 24:00（如 17:00-24:00 解析成 1440）时写成「次日」，否则倒排时间会被误读 */
      var endTxt = o.end >= 24 * 60 ? '次日 ' + fmtHM(o.end) + '（跨零点）' : fmtHM(o.end);
      tips.push('开放 ' + fmtHM(o.start) + '–' + endTxt +
        '；倒排时间以「' + fmtHM(o.start) + ' 后入园、' + fmtHM(o.end) + ' 前离园」为准。');
    }
    if (o.note) tips.push('数据包备注：' + o.note + '。');
    if (spot.slot === 'night') tips.push('以夜间体验为主，放在晚餐之后更合适，白天到访观感会打折。');
    if (spot.slot === 'both') tips.push('白天与夜晚是两种观感，可任选一段安排。');
    if (spot.stay >= 150) tips.push('建议留足 ' + minText(spot.stay) + '，当天不宜再排第二个同等体量的点位。');
    else if (spot.stay <= 90) tips.push('停留较短（' + spot.stay + ' 分钟），适合与同片区点位串成半天。');
    if (spot.level === '5A') tips.push('国家 5A 级景区，节假日人流集中，建议开园即到或午后错峰。');
    if (spot.ticket === 0) tips.push('免费开放，无需购票，可直接作为顺路一站。');
    if (spot.free) {
      var ft = freePolicyText(spot.free);
      if (ft) tips.push('门票有免费日：' + ft + '；行程日期灵活的话，值得先把这几天圈出来。');
    }
    if (ctx.trimmed && ctx.visit) {
      tips.push('本次行程里停留被压缩到 ' + ctx.visit.stay + ' 分钟（数据包建议 ' + spot.stay +
        ' 分钟）；想走全可减少当天点位或把出发时间提前。');
    }
    if (ctx.visited) tips.push('这一处今天已经去过，行程不会再排它。');
    return tips;
  }

  function spotGuide(city, spot, ctx) {
    ctx = ctx || {};
    if (!city || !spot) return null;
    var o = parseOpen(spot.open);
    var inPlan = ctx.inPlanIds || {};
    var base = city.base || { name: '' };

    var facts = [
      ['门票', spot.ticket ? '¥' + spot.ticket + ' / 人（参考）' : '免费'],
      ['开放时间', spot.open],
      ['建议停留', minText(spot.stay)],
      ['游览类型', slotText(spot.slot)],
      ['景区等级', spot.level ? '国家 ' + spot.level + ' 级' : '暂未评级'],
      ['坐标', Number(spot.lng).toFixed(4) + ', ' + Number(spot.lat).toFixed(4) +
        '（' + (city.coordSystem || 'GCJ-02') + ' 近似值）']
    ];
    /* 免票政策单独一行、紧挨门票：先看到价格，紧接着看到「什么时候不用付全价」。
       文本由 freePolicyText 从数据包拼出，引擎不认识这座城市，也不判断今天是否免票。 */
    if (spot.free) {
      var ft = freePolicyText(spot.free);
      if (ft) facts.splice(1, 0, ['门票优惠', ft]);
    }

    return {
      id: spot.id,
      name: spot.name,
      level: spot.level || '',
      district: spot.district,
      districtLabel: (city.districts && city.districts[spot.district]) || spot.district,
      tags: (spot.tags || []).slice(),
      /* 视觉品类：数据包给的字段，引擎只负责原样带出来，不认识它是什么意思。
         界面据此取 data/cats.js 里的配色与插画——换城市照样成立。 */
      cat: spot.cat || '',
      slot: spot.slot,
      slotText: slotText(spot.slot),
      bg: spot.bg,
      points: splitPoints(spot.hl),
      facts: facts,
      tips: guideTips(spot, o, ctx),
      visit: ctx.visit || null,
      fromBase: {
        name: base.name,
        min: driveMin(base, spot),
        km: +haversineKm(base, spot).toFixed(1)
      },
      prev: ctx.prev || null,
      next: ctx.next || null,
      nearby: guideNearby(city, spot, 3).map(function (x) {
        return {
          id: x.o.id, name: x.o.name, level: x.o.level || '',
          district: x.o.district, same: x.o.district === spot.district,
          min: x.min, tags: (x.o.tags || []).slice(0, 2), inPlan: !!inPlan[x.o.id]
        };
      }),
      eats: guideEats(city, spot, 3).map(function (x) {
        return {
          name: x.o.name, note: x.o.note || '',
          district: x.o.district, same: x.o.district === spot.district, min: x.min
        };
      })
    };
  }

  /* ---------- 自检：跑一组硬性约束，供测试脚本调用 ---------- */
  function selfCheck(city, days, W) {
    var problems = [];
    /* 数据层体检：免票政策登记得对不对，要比排程结果更早被发现。
       写错的代价是界面上出现一句他自己都不知道在说什么的政策。 */
    (city.attractions || []).forEach(function (a) {
      if (!a.free) return;
      if (!a.free.periods || !a.free.periods.length) {
        problems.push('景点 ' + a.name + ' 登记了免票政策却没给时段');
        return;
      }
      a.free.periods.forEach(function (p) {
        if (!p.range) problems.push('景点 ' + a.name + ' 的免票时段缺少日期区间');
        var dows = p.dows || [];
        if (!dows.length) {
          problems.push('景点 ' + a.name + ' 的免票时段 ' + (p.range || '?') + ' 没给星期几');
        }
        dows.forEach(function (d) {
          if (!(d >= 0 && d <= 6)) problems.push('景点 ' + a.name + ' 的免票日 ' + d + ' 不是 0–6');
        });
      });
    });
    days.forEach(function (d, i) {
      var tl = timeline(city, d, W);
      tl.ev.forEach(function (e) {
        if (e.k === 'visit') {
          var cur = parseOpen(e.a.open);
          if (e.to > 23 * 60) {
            problems.push('Day' + (i + 1) + ' 景点结束超过 23:00：' + e.a.name);
          }
          if (cur.closedWeekdays.length && d.dow != null && cur.closedWeekdays.indexOf(d.dow) >= 0) {
            problems.push('Day' + (i + 1) + ' 安排在闭馆日：' + e.a.name);
          }
          if (!cur.allDay && cur.start != null && e.from < cur.start) {
            problems.push('Day' + (i + 1) + ' 早于开园时间入园：' + e.a.name);
          }
          if (cur.lastEntry != null && e.from > cur.lastEntry) {
            problems.push('Day' + (i + 1) + ' 晚于停止入园时间：' + e.a.name);
          }
          /* 与 fitsWindow 的口径交叉验证：排程算出的游览时长必须在闭园前放得下 */
          if (e.stay != null && !cur.allDay && cur.end != null && cur.end < 24 * 60 &&
              e.from + e.stay > cur.end) {
            problems.push('Day' + (i + 1) + ' 闭园前游不完：' + e.a.name +
              '（需 ' + e.stay + ' 分钟，' + e.from + ' 入园 / 闭园 ' + cur.end + '）');
          }
        }
        if (e.k === 'meal' && e.at < LUNCH_EARLY) {
          problems.push('Day' + (i + 1) + ' 午餐早于 11:00：' + (e.place && e.place.name));
        }
        if (e.k === 'meal' && e.at > LUNCH_MAX) {
          problems.push('Day' + (i + 1) + ' 午餐晚于 14:30：' + (e.place && e.place.name) +
            '（' + fmtHM(e.at) + '）');
        }
      });

      /* 切分后的自洽性：被午餐切开的一次游览必须恰好两段，且「同一处景点一天出现两次」
         这条绝不能过——那是用户在结果页一眼就能看到、却最难自己解释的错误。 */
      var seenVisit = {}, opened = null;
      tl.ev.forEach(function (e) {
        if (e.k !== 'visit') return;
        if (e.cont) {
          if (!opened || opened.a.id !== e.a.id) {
            problems.push('Day' + (i + 1) + ' 出现没有前段的「午后续游」：' + e.a.name);
          } else {
            if (opened.stay + e.stay !== opened.total) {
              problems.push('Day' + (i + 1) + ' 切分后两段之和 ≠ 总时长：' + e.a.name);
            }
            if (opened.stay < SPLIT_MIN || e.stay < SPLIT_MIN) {
              problems.push('Day' + (i + 1) + ' 切分后有一段不足 ' + SPLIT_MIN + ' 分钟：' + e.a.name);
            }
            if (opened.break.back !== e.from) {
              problems.push('Day' + (i + 1) + ' 午餐后回到该点的时间与后段开始不符：' + e.a.name);
            }
            /* 切开把这一站的占用拉长了一顿饭，闭园前必须仍然走得完 */
            var oc = parseOpen(e.a.open);
            var ocEnd = (oc.allDay || oc.end == null || oc.end > 24 * 60) ? Infinity : oc.end;
            if (opened.break.back + e.stay > ocEnd) {
              problems.push('Day' + (i + 1) + ' 切开后越过闭园时间：' + e.a.name);
            }
          }
          opened = null;
          return;
        }
        if (seenVisit[e.a.id]) {
          problems.push('Day' + (i + 1) + ' 同一景点被安排了两段互不相连的游览：' + e.a.name);
        }
        seenVisit[e.a.id] = true;
        if (opened) {
          problems.push('Day' + (i + 1) + ' 上一个被切开的游览没有后段：' + opened.a.name);
          opened = null;
        }
        if (e.break) {
          if (e.break.at < LUNCH_AT) {
            problems.push('Day' + (i + 1) + ' 午餐切点早于 12:00：' + e.a.name);
          }
          if (e.total == null || e.total <= e.stay) {
            problems.push('Day' + (i + 1) + ' 切开的游览缺少总时长：' + e.a.name);
          }
          opened = e;
        } else if (e.total != null) {
          problems.push('Day' + (i + 1) + ' 没有切分的游览却带了总时长：' + e.a.name);
        }
      });
      if (opened) problems.push('Day' + (i + 1) + ' 被切开的游览缺少后段：' + opened.a.name);

      if (tl.nightOn && tl.end > NIGHT_CAP) {
        problems.push('Day' + (i + 1) + ' 夜间活动超过 22:30');
      }
      if (!d.items.length && !d.reason) {
        problems.push('Day' + (i + 1) + ' 未安排任何景点，且未说明原因');
      }
    });
    return problems;
  }

  global.Engine = {
    haversineKm: haversineKm,
    driveMin: driveMin,
    legModes: legModes,
    wgs84ToGcj02: wgs84ToGcj02,
    matchScore: matchScore,
    nearestEat: nearestEat,
    nearestFrom: nearestFrom,
    spotGuide: spotGuide,
    freePolicyText: freePolicyText,
    freeTagText: freeTagText,
    minText: minText,
    splitPoints: splitPoints,
    toBase: toBase,
    inferUrban: inferUrban,
    /* 开放时间与时间窗：动态重排的判据，导出以便独立验证 */
    parseOpen: parseOpen,
    fitsWindow: fitsWindow,
    fmtHM: fmtHM,
    plan: plan,
    normRole: normRole,
    ROLE_FIRST: ROLE_FIRST, ROLE_REPEAT: ROLE_REPEAT, ROLE_LOCAL: ROLE_LOCAL,
    dayCandidates: dayCandidates,
    timeline: timeline,
    summarize: summarize,
    buildCity: buildCity,
    selfCheck: selfCheck,
    PACE: PACE,
    ROAD_FACTOR: ROAD_FACTOR,
    /* 出行方式估算的口径，导出供界面显示与测试校验 */
    LEG: {
      WALK_KPH: WALK_KPH, BIKE_KPH: BIKE_KPH, TRANSIT_KPH: TRANSIT_KPH,
      WALK_MAX_KM: WALK_MAX_KM, BIKE_MAX_KM: BIKE_MAX_KM,
      TRANSIT_MIN_ROAD_KM: TRANSIT_MIN_ROAD_KM, TRANSIT_MAX_ROAD_KM: TRANSIT_MAX_ROAD_KM,
      BIKE_FETCH: BIKE_FETCH, TRANSIT_WAIT: TRANSIT_WAIT,
      PARK_URBAN: PARK_URBAN, PARK_OTHER: PARK_OTHER
    },
    NIGHT_CAP: NIGHT_CAP,
    /* 用餐口径：12:00 是基准，11:00 与 13:30 是「再早就没必要、再晚就不合理」的两条界线 */
    LUNCH: LUNCH,
    LUNCH_AT: LUNCH_AT,
    LUNCH_EARLY: LUNCH_EARLY,
    LUNCH_LATE: LUNCH_LATE,
    LUNCH_MAX: LUNCH_MAX,
    SPLIT_MIN: SPLIT_MIN,
    MAX_SPOTS_PER_DAY: MAX_SPOTS_PER_DAY,
    MAX_WAIT: MAX_WAIT,
    MIN_VISIT: MIN_VISIT,
    MIN_SHARE: MIN_SHARE,
    GUIDE_NEAR_MIN: GUIDE_NEAR_MIN,
    GUIDE_NEAR_RELAX: GUIDE_NEAR_RELAX
  };
})(typeof window !== 'undefined' ? window : globalThis);

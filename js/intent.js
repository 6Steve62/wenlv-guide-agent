/* =============================================================================
 * js/intent.js —— 自然语言 → 结构化槽位（智能体层 · 解析器）
 *
 * 定位：这是智能体的「耳朵」。它把用户的一句话变成引擎认识的参数
 *       （days / role / prefs / pace / scope / lodging / startAt / visited），
 *       一个字都不碰排程——排程仍然只由 Engine.plan() 完成。
 *
 * 三条硬约束（与工程其他部分同一条纪律）：
 *   ① 零 DOM、零时间读取、零随机数：纯函数，入参出参都是普通对象，
 *      因此可以整文件单测，也不会破坏「整页 DOM 逐字节可复现」。
 *      当前时刻由调用方经 ctx.now 传入（app.js 里只有它读过一次系统时间）。
 *   ② 不认识任何城市：景点名 / 住宿名 / 合法偏好全部由 ctx 注入，
 *      本文件只有语言层面的同义词（「三天」「轻松点」「不去」）。
 *      换一座城市只换 ctx，解析器一行不改——test/intent.js 用一份
 *      假城市数据证明这件事。
 *   ③ 槽位取值与向导表单共用同一套：parse() 吐出的 value 必须能直接
 *      塞进 Engine.plan() 的 opts。这是「对话层不改变排程结果」的前提，
 *      test/dialogue.js 用逐字节比对锁死。
 *
 * 与 LLM 的关系：LLM 适配器将来也输出本文件定义的这份结构，所以它是
 * 可替换的一层，不是另一套口径。
 *
 * 设计取舍：宁可少认，不可认错。认错会悄悄改变排程结果（破坏 ③），
 * 少认只是多问一句。所以「想吃夜市」只点亮「美食体验」，不擅自把
 * 收工时间改成 23:00——那是引擎该决定的事。
 * ========================================================================== */
(function () {
  'use strict';

  var VERSION = '1.0.0';

  /* ---------- 槽位定义 ----------
   * order 是「缺哪个问哪个」的提问顺序，与向导步骤顺序一致；
   * ask 是兜底问句——界面侧会传向导原标题进来覆盖（见 askFor），
   * 保证对话里听到的问法和表单里看到的是同一句。 */
  var SLOTS = {
    days:    { label: '天数',     ask: '打算玩几天？' },
    role:    { label: '熟悉程度', ask: '您是第一次来、多次来，还是本地？' },
    prefs:   { label: '兴趣',     ask: '想看什么、玩什么？' },
    pace:    { label: '节奏',     ask: '每天想怎么安排？' },
    scope:   { label: '范围',     ask: '范围走多大？' },
    lodging: { label: '住宿',     ask: '住哪一带？' },
    startAt: { label: '出发时间', ask: '现在几点？' },
    visited: { label: '已去过',   ask: '今天已经去过哪些？' }
  };
  /* 两种流程各自必填的槽位（顺序即提问顺序）：
     plan 出行计划——天数起头、住宿收尾，与 STEPS_PLAN 同序；
     now  已在路上——位置与时刻起头，visited 是可选项不占位。 */
  var FLOW_ORDER = {
    plan: ['days', 'role', 'prefs', 'pace', 'scope', 'lodging'],
    now:  ['lodging', 'startAt', 'prefs', 'pace']
  };

  /* ---------- 数字与时间的小工具 ---------- */
  var CN_DIGIT = { '零': 0, '〇': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };

  /* 中文数字 → 整数。支持 3 / 三 / 十二 / 二十 / 二十五 / 十五（分钟也要用）。 */
  function cnNum(s) {
    if (s == null) return null;
    var t = String(s).replace(/\s/g, '');
    if (/^[0-9]+$/.test(t)) return parseInt(t, 10);
    if (t === '十') return 10;
    var m = /^十([一二三四五六七八九])$/.exec(t);
    if (m) return 10 + CN_DIGIT[m[1]];
    m = /^([一二三四五六七八九])十([一二三四五六七八九])?$/.exec(t);
    if (m) return CN_DIGIT[m[1]] * 10 + (m[2] ? CN_DIGIT[m[2]] : 0);
    if (Object.prototype.hasOwnProperty.call(CN_DIGIT, t)) return CN_DIGIT[t];
    return null;
  }

  /* 分钟数 → 'HH:MM'。与 app.js 的 hm() 同一口径（此处独立实现，避免反向依赖）。 */
  function hmText(min) {
    var m = Math.max(0, Math.min(24 * 60 - 1, Math.round(min)));
    var h = Math.floor(m / 60), k = m % 60;
    return (h < 10 ? '0' : '') + h + ':' + (k < 10 ? '0' : '') + k;
  }

  /* 全角数字/冒号 → 半角，连续空白压成一个空格。中文分词用不到，但数字要用。 */
  function toHalf(s) {
    var t = String(s == null ? '' : s), out = '';
    for (var i = 0; i < t.length; i++) {
      var c = t.charCodeAt(i);
      if (c >= 0xFF10 && c <= 0xFF19) out += String.fromCharCode(c - 0xFEE0);
      else if (c === 0xFF1A) out += ':';
      else out += t.charAt(i);
    }
    return out.replace(/\s+/g, ' ').trim();
  }

  function spaces(n) { var s = ''; for (var i = 0; i < n; i++) s += ' '; return s; }

  /* ---------- 词表（语言层，不含任何城市信息） ---------- */

  /* 节假日字面 → 天数。用户只说「五一去」没提天数时按小长假 3 天起算，
     并在回显里说明这是默认值，不是用户说过的。 */
  var DAY_WORDS = { '周末': 2, '小长假': 3, '五一': 3, '国庆': 3, '清明': 3, '端午': 3, '中秋': 3, '元旦': 3 };

  /* 身份三档。顺序即优先级：「没来过」必须压过「来过」，
     「本地」必须压过「多次」—— tiers 里先命中的赢。 */
  var ROLE_TIERS = [
    ['first',  ['第一次', '初次', '首次', '头一回', '头一次', '没来过', '新来', '第一次到']],
    ['local',  ['本地', '土著', '本地人', '当地人', '老家', '长住', '家住', '我就住', '土生土长']],
    ['repeat', ['第二次', '再次', '又来', '多次', '来过', '之前来', '以前来', '回头客', '熟门熟路']]
  ];

  /* 节奏。刻意不收「多安排 / 多看」这类泛词——「多安排点博物馆」是兴趣
     加强，不是要把一天排满；排满是引擎按停留时长与车程决定的事。 */
  var PACE_TIERS = [
    ['relax',  ['轻松点', '轻松些', '轻松一点', '慢点', '慢一些', '别太累', '不要太累', '不赶', '别赶', '早收工', '早点回', '别安排太满', '悠闲', '慢节奏', '松一点']],
    ['tight',  ['紧凑', '排满', '赶一点', '赶些', '密集', '充实', '多看几个', '能多看', '别留遗憾', '晚收工', '玩到晚']],
    ['late',   ['夜游', '晚上逛', '深夜', '玩到很晚', '凌晨', '半夜', '通宵', '越夜越']],
    ['normal', ['正常', '标准', '适中', '不紧不慢', '普通', '刚好']]
  ];

  /* 范围。景点名触发的「想跑远点」走数据驱动（ctx.nearbySpots），
     这里只放纯语言词——换个城市，词表一行不改。 */
  var SCOPE_TIERS = [
    ['with', ['周边', '近郊', '远一点', '远些', '跑远', '隔壁市', '邻市']],
    ['city', ['市区', '城里', '城内', '不想跑远', '别跑远', '就近', '只在市区', '近一点', '附近就行']]
  ];

  /* 兴趣别名。键是向导里的合法标签值（ctx.prefs 过滤后生效），
     标签本身也是合法说法（用户可以直接打「人文历史」）。
     城市专属词（如本地帝陵名）由调用方合进 ctx.prefWords，不进默认表——
     默认表只放跨城市也说得通的词。 */
  var PREF_WORDS = {
    '人文历史': ['历史', '人文', '古迹', '帝陵', '王陵', '古墓', '岩画', '古城', '石窟', '壁画', '遗址', '考古', '庙宇', '古塔'],
    '自然风光': ['自然', '山水', '风光', '风景', '湿地', '公园', '沙漠', '草原', '河湖', '湖泊', '花海', '登山', '爬山', '徒步'],
    '摄影出片': ['摄影', '拍照', '出片', '打卡', '旅拍', '无人机', '日落', '夕阳', '落日', '写真'],
    '亲子友好': ['亲子', '孩子', '小孩', '带娃', '遛娃', '宝宝', '儿童', '全家', '一家人'],
    '美食体验': ['美食', '好吃', '小吃', '夜市', '餐厅', '手抓', '羊肉', '搓条', '逛吃', '吃货', '特色餐'],
    '酒庄品鉴': ['酒庄', '葡萄酒', '红酒', '品酒', '葡萄'],
    '科普研学': ['科普', '研学', '博物馆', '地质', '生态', '长知识', '涨知识'],
    '红色研学': ['红色', '爱国', '军事', '军博', '长征', '革命'],
    '轻松休闲': ['休闲', '散步', '漫步', '放松', '闲逛', '慢生活', '花园', '遛弯']
  };

  /* 时刻词 → 默认小时。只说「下午」不说几点时按这个起算。 */
  var TIME_PERIOD = { '凌晨': 0, '早上': 7, '早晨': 7, '上午': 9, '中午': 12, '午后': 13, '下午': 13, '傍晚': 17, '晚上': 19, '夜里': 21, '夜间': 21 };

  /* 住宿匹配的前置提示词：没有这些词，一座山的名字是景点不是住处。
     否则「想去爬山」会被误判成改驻地。 */
  var LODGING_CUE = /(住|住在|入住|酒店|宾馆|民宿|客栈|位置|出发点|从|待在|窝在)$/;
  /* 景点名前缀的「去过 / 不去」提示词，回看 6 个字。 */
  var VISITED_CUE = /(去过|看过了|逛过了|去过了|玩过|去完|看完|逛完|去了|看过)$/;
  var AVOID_CUE = /(不去|不想去|别去|不去了|不逛了|跳过|别安排|不想看|不看|排除|避开|免了)$/;
  /* 同义的「后置」说法（「某陵去过了」），往景点名后看 4 个字。 */
  var VISITED_AFTER = /^(去过了|看过了|逛过了|去过了|玩过|去完|看完|逛完|去了|看过)/;
  var AVOID_AFTER = /^(不去|不想去|别去|不去了|不逛了|跳过|别安排|不想看|不看|排除|避开|免了)/;

  var DEFAULT_LABELS = {
    role: { first: '第一次来', repeat: '多次来', local: '我是本地人' },
    pace: { relax: '轻松', normal: '标准', tight: '紧凑', late: '夜间' },
    scope: { city: '只在市区', with: '含周边' }
  };

  /* ---------- 数据驱动的别名派生 ---------- */

  /* 名称分段：'鼓楼 · 解放街' → ['鼓楼', '解放街']；括号内容单独成段。 */
  function segments(s) {
    return String(s == null ? '' : s)
      .split(/[·、,，/／|;；\s]+/)
      .map(function (x) { return x.replace(/^[（(]+|[）)]+$/g, '').trim(); })
      .filter(function (x) { return x.length >= 2; });
  }

  /* 住宿别名：整名 + 名称分段 + 分组分段（去掉与区县同名的段——
     那一个走区县兜底分支，不当普通别名，否则同区五处住宿会为它打架）
     + 去掉泛用后缀的前缀（'南门广场' → 还认「南门」）。 */
  var LOD_SUFFIX = ['商圈', '广场', '周边', '方向', '门口', '小镇', '县城', '市区', '景区', '旁边', '创意区', '工业园', '文化城', '老城区', '东岸', '北段', '山脚', '高铁站'];
  function lodgingAliases(l) {
    var set = {};
    function add(x) { if (x && x.length >= 2) set[x] = true; }
    add(l.name);
    segments(l.name).forEach(function (seg) {
      add(seg);
      LOD_SUFFIX.forEach(function (suf) {
        if (seg.length > suf.length && seg.slice(-suf.length) === suf) add(seg.slice(0, seg.length - suf.length));
      });
    });
    segments(l.group || '').forEach(function (g) { if (g !== l.district) add(g); });
    return Object.keys(set);
  }

  /* 景点别名：整名 + 分段 + 前 2/3 字前缀 + 后 2/3 字后缀
     （'某国家森林公园（某沟口）' → 还认山名、沟口；'某岩画' → 还认「岩画」）。
     后缀只取末 2/3 字，且跳过通用词尾（公园 / 景区 / 广场 …），
     否则「公园」会命中全部公园类景区，把本该点亮的偏好词也吃掉。 */
  var SPOT_TAIL_STOP = ['公园', '景区', '广场', '博物', '遗址', '陵园', '陵墓', '故里', '小镇', '街区', '中心', '基地', '展馆', '乐园', '水镇', '湖区', '度假', '风情', '影视', '温泉', '峡谷'];
  function spotAliases(s) {
    var set = {};
    function add(x) { if (x && x.length >= 2) set[x] = true; }
    add(s.name);
    segments(s.name).forEach(function (seg) {
      add(seg);
      for (var n = 2; n <= 3; n++) if (seg.length >= n + 1) add(seg.slice(0, n));
    });
    [2, 3].forEach(function (n) {
      if (s.name.length >= n + 1) {
        var suf = s.name.slice(-n);
        if (SPOT_TAIL_STOP.indexOf(suf) < 0) add(suf);
      }
    });
    return Object.keys(set).sort(function (a, b) { return b.length - a.length; });
  }

  function defaultPrefWords(list) {
    var out = {};
    (list || Object.keys(PREF_WORDS)).forEach(function (v) {
      if (Object.prototype.hasOwnProperty.call(PREF_WORDS, v)) out[v] = PREF_WORDS[v].slice();
    });
    return out;
  }

  /* ---------- 各槽位抽取器 ----------
   * 统一返回 { value, note, span: [起, 止] } 或 null；parse() 拿到后把
   * span 从待扫描文本里抠掉（替换为等长空格，索引不变），后面的规则就
   * 看不见它——「住西夏万达」不会顺手点亮「人文历史」。 */

  function findDays(work) {
    var m = /(周末|小长假|五一|国庆|清明|端午|中秋|元旦)/.exec(work);
    if (m) {
      var n0 = DAY_WORDS[m[1]];
      return { value: n0, note: '没提具体天数，按' + m[1] + ' ' + n0 + ' 天算', span: [m.index, m.index + m[1].length] };
    }
    /* 模糊量词：「一两天」「两三天」——保守取小的那个，别替用户下决心。 */
    m = /(一两|两三|三四|四五|五六|七八)\s*(天|日)/.exec(work);
    if (m) {
      return finishDays(CN_DIGIT[m[1].charAt(0)], m.index, m[0].length,
        '「' + m[1] + '天」没定论，先按 ' + CN_DIGIT[m[1].charAt(0)] + ' 天排，之后可以改');
    }
    /* 「10月18日」是日期不是时长：数字后面紧跟「月」的不要。 */
    m = /([0-9]+|[一二两三四五六七八九十]{1,3})\s*(天|日)/.exec(work);
    if (m && !/月$/.test(work.slice(0, m.index))) {
      var n = cnNum(m[1]);
      if (n != null) return finishDays(n, m.index, m[0].length, '');
    }
    m = /([0-9]+|[一二两三四五六七八九十]{1,3})\s*晚/.exec(work);
    if (m) {
      var k = cnNum(m[1]);
      if (k != null) return finishDays(k + 1, m.index, m[0].length, '按「' + k + ' 晚」折算成 ' + (k + 1) + ' 天');
    }
    return null;
  }
  function finishDays(n, i, len, note) {
    var extra = note || '';
    if (n > 8) { extra = (extra ? extra + '；' : '') + '最多排 8 天，先按 8 天算'; n = 8; }
    if (n < 1) { extra = (extra ? extra + '；' : '') + '至少排 1 天，先按 1 天算'; n = 1; }
    return { value: n, note: extra, span: [i, i + len] };
  }

  function findRole(work) {
    for (var t = 0; t < ROLE_TIERS.length; t++) {
      var words = ROLE_TIERS[t][1];
      for (var i = 0; i < words.length; i++) {
        var at = work.indexOf(words[i]);
        if (at >= 0) return { value: ROLE_TIERS[t][0], note: '', span: [at, at + words[i].length] };
      }
    }
    return null;
  }

  function findPace(work) {
    for (var t = 0; t < PACE_TIERS.length; t++) {
      var words = PACE_TIERS[t][1];
      for (var i = 0; i < words.length; i++) {
        var at = work.indexOf(words[i]);
        if (at >= 0) return { value: PACE_TIERS[t][0], note: '', span: [at, at + words[i].length] };
      }
    }
    return null;
  }

  function findScope(work, ctx) {
    for (var t = 0; t < SCOPE_TIERS.length; t++) {
      var words = SCOPE_TIERS[t][1];
      for (var i = 0; i < words.length; i++) {
        var at = work.indexOf(words[i]);
        if (at >= 0) return { value: SCOPE_TIERS[t][0], note: '', span: [at, at + words[i].length] };
      }
    }
    /* 数据驱动的一路：用户直接点了周边数据包里的景点名（「想去某湖」），
       等价于想把范围放开。景点名从 ctx.nearbySpots 来，解析器不认识
       任何具体的城市周边——换城市只换那份清单。 */
    var near = (ctx.nearbySpots || []).filter(function (s) { return s && s.name; });
    var best = null;
    for (var j = 0; j < near.length; j++) {
      var aliases = spotAliases(near[j]);
      for (var k = 0; k < aliases.length; k++) {
        var a = aliases[k], nt = work.indexOf(a);
        if (nt < 0) continue;
        if (!best || a.length > best.len) best = { name: near[j].name, a: a, at: nt, len: a.length };
      }
    }
    if (best) {
      return {
        value: 'with',
        note: '提到了周边的' + best.name + '，把范围放到含周边',
        span: [best.at, best.at + best.len]
      };
    }
    return null;
  }

  function findTime(work, ctx) {
    if (ctx.now != null) {
      var m0 = /(现在|即刻|马上|当下)/.exec(work);
      if (m0) return { value: ctx.now, note: '按当前时刻起算', span: [m0.index, m0.index + m0[0].length] };
    }
    var m = /(凌晨|早上|早晨|上午|中午|午后|下午|傍晚|晚上|夜里|夜间)?\s*([0-9]+|[一二两三四五六七八九十]{1,3})\s*点\s*(半|[0-9]+|[一二两三四五六七八九十]{1,3})?/.exec(work);
    if (!m) return null;
    var h = cnNum(m[2]);
    if (h == null || h > 24) return null;
    var min = 0;
    if (m[3] === '半') min = 30;
    else if (m[3] != null) { var mm = cnNum(m[3]); min = mm == null ? 0 : mm; }
    var period = m[1] || '';
    if ((period === '下午' || period === '傍晚' || period === '晚上' || period === '夜里' || period === '夜间' || period === '午后') && h < 12) h += 12;
    if (period === '中午' && h < 6) h += 12;
    var total = h * 60 + min;
    if (total > 24 * 60 - 1) return null;
    return { value: total, note: period ? '按「' + period + ' ' + hmText(total) + '」理解' : '', span: [m.index, m.index + m[0].length] };
  }

  /* 住宿：别名最长者优先；命中要带前置提示词。区县单独兜底——
     同区有多个住宿点时取默认值，并在回显里说明「先按某处排」。 */
  function matchLodging(work, ctx) {
    var lods = (ctx.lodgings || []).filter(function (l) { return l && l.id; });
    if (!lods.length) return null;
    var best = null;
    for (var i = 0; i < lods.length; i++) {
      var aliases = lodgingAliases(lods[i]);
      for (var j = 0; j < aliases.length; j++) {
        var a = aliases[j], at = work.indexOf(a);
        if (at < 0) continue;
        if (!LODGING_CUE.test(work.slice(Math.max(0, at - 6), at))) continue;
        /* 别名一样长时：先看是不是该区默认驻点，再按 id 字典序收敛——
           与引擎的 tieId() 同一立场：结果只取决于数据内容，不取决于
           调用方传进来的数组顺序，也不靠「碰巧第一个」。 */
        var better = !best ||
          a.length > best.len ||
          (a.length === best.len && !!lods[i].isDefault !== !!best.l.isDefault && !!lods[i].isDefault) ||
          (a.length === best.len && !!lods[i].isDefault === !!best.l.isDefault && lods[i].id < best.l.id);
        if (better) best = { l: lods[i], a: a, at: at, len: a.length };
      }
    }
    if (best) return { value: best.l.id, name: best.l.name, note: '', span: [best.at, best.at + best.len] };
    for (var k = 0; k < lods.length; k++) {
      var d = lods[k].district;
      if (!d) continue;
      var dt = work.indexOf(d);
      if (dt < 0) continue;
      if (!LODGING_CUE.test(work.slice(Math.max(0, dt - 6), dt))) continue;
      var same = lods.filter(function (x) { return x.district === d; });
      var pick = same.filter(function (x) { return x.isDefault; })[0] || same[0];
      return {
        value: pick.id, name: pick.name,
        note: d + '有 ' + same.length + ' 个住宿点，先按「' + pick.name + '」排',
        span: [dt, dt + d.length]
      };
    }
    return null;
  }

  /* 景点提及：只在有「去过 / 不去」提示词时才产生槽位，
     否则一句「想去某座山爬山」什么也不改（排程是引擎的事）。
     提示词可以在景点名前面（「去过某陵」）也可以在后面（「某陵去过了」）。
     返回的 cutSpans 只含带提示词的命中，供 parse() 抠掉。 */
  function matchSpots(work, ctx) {
    var visited = [], avoid = [];
    var spots = (ctx.spots || []).filter(function (s) { return s && s.id && s.name; });
    for (var i = 0; i < spots.length; i++) {
      var aliases = spotAliases(spots[i]);
      for (var j = 0; j < aliases.length; j++) {
        var a = aliases[j], from = 0, at;
        for (;;) {
          at = work.indexOf(a, from);
          if (at < 0) break;
          from = at + a.length;
          var before = work.slice(Math.max(0, at - 6), at);
          var after = work.slice(at + a.length, at + a.length + 4);
          /* 避让优先：同一个名字前面带「不去」、后面带「去过了」时按避让算。 */
          if (AVOID_CUE.test(before) || AVOID_AFTER.test(after)) {
            avoid.push({ id: spots[i].id, name: spots[i].name, span: [at, at + a.length] });
          } else if (VISITED_CUE.test(before) || VISITED_AFTER.test(after)) {
            visited.push({ id: spots[i].id, name: spots[i].name, span: [at, at + a.length] });
          }
        }
      }
    }
    /* 去重跨景点：多个景点共用一段前缀（「某河」）时，只保留名字最长的
       那个——「不去某军事文化博览园」只该避开这一个，不是把某河边
       三个景区全避了。同一景点内部，长别名吃掉短前缀。 */
    var all = visited.concat(avoid);
    var kept = all.filter(function (x) {
      return !all.some(function (y) {
        return y !== x && y.span[1] - y.span[0] > x.span[1] - x.span[0] &&
          y.span[0] <= x.span[0] && y.span[1] >= x.span[1];
      });
    });
    visited = kept.filter(function (x) { return visited.indexOf(x) >= 0; });
    avoid = kept.filter(function (x) { return avoid.indexOf(x) >= 0; });
    var cutSpans = [];
    visited.concat(avoid).forEach(function (x) { cutSpans.push(x.span); });
    return { visited: visited, avoid: avoid, cutSpans: cutSpans };
  }

  /* 兴趣：别名长的先扫（「人文历史」整词压过「历史」），命中即抠掉，
     同一个 span 不会被第二个别名重复点亮。否定词（「不想看博物馆」）
     进 drop 不进 add。被景点名 / 住宿名整个包住的命中一律忽略——
     「某军事文化博览园」里的「某河」不算想看自然风光。 */
  function findPrefs(work, ctx, skipSpans) {
    var table = ctx.prefWords || defaultPrefWords(ctx.prefs || []);
    var pairs = [];
    Object.keys(table).forEach(function (v) {
      pairs.push({ w: v, v: v });
      (table[v] || []).forEach(function (w) { pairs.push({ w: w, v: v }); });
    });
    pairs.sort(function (a, b) { return b.w.length - a.w.length; });
    var add = {}, drop = {}, w = work;
    function inSkip(i, len) {
      for (var s = 0; s < skipSpans.length; s++) {
        /* 景点名整段出现时，里面的片段（「某军事文化博览园」里的「军事」）
           都算被这个名字包住——等长也算（偏好词恰好等于景点名时本就该避让）。
           住宿跨度不进 skipSpans，所以「博物馆 · 文化城」不会挡住「想看博物馆」。 */
        if (skipSpans[s][1] - skipSpans[s][0] >= len &&
          skipSpans[s][0] <= i && skipSpans[s][1] >= i + len) return true;
      }
      return false;
    }
    pairs.forEach(function (p) {
      var from = 0;
      for (;;) {
        var i = w.indexOf(p.w, from);
        if (i < 0) break;
        from = i + p.w.length;
        if (inSkip(i, p.w.length)) continue;
        var before = w.slice(Math.max(0, i - 5), i);
        var neg = /(不想看|不想去|不要|别|去掉|排除|跳过|不看|不想要|免了)$/.test(before);
        if (neg) drop[p.v] = true; else add[p.v] = true;
        w = w.slice(0, i) + spaces(p.w.length) + w.slice(i + p.w.length);
        from = i;
      }
    });
    var order = (ctx.prefs && ctx.prefs.length) ? ctx.prefs : Object.keys(PREF_WORDS);
    return {
      add: order.filter(function (v) { return add[v]; }),
      drop: order.filter(function (v) { return drop[v]; }),
      work: w
    };
  }
  /* ---------- 整句意图分类 ---------- */
  /* 确认词整句判定：「步行街」里的「行」不能算答应。 */
  function isConfirm(raw) {
    return /^(好|行|嗯|嗯嗯|好的|好啊|行吧|可以|可以了|没问题|就这样|就这样吧|生成|开始|出发|搞定|确认|嗯呢|ok|OK)[。！!，,~\s]*$/.test(raw);
  }
  function isGreet(raw) {
    return /^(你好|您好|老师好|同学们好|在吗|在么|嗨|hello|hi|HELP|帮助)/i.test(raw) ||
      /(你能做什么|介绍一下你|你是做什么的|有何功能|怎么用)/.test(raw);
  }
  function isRestart(raw) {
    return /(重新|重来|换一批|再来一版|重选|从头)/.test(raw);
  }

  /* ---------- 主入口 ---------- */
  function parse(text, ctx) {
    ctx = ctx || {};
    var raw = toHalf(text);
    var out = { action: 'unknown', slots: {}, heard: [], notes: [], echo: raw };
    if (!raw) return out;

    if (isGreet(raw)) { out.action = 'greet'; return out; }
    if (isRestart(raw)) { out.action = 'restart'; return out; }
    if (isConfirm(raw)) { out.action = 'confirm'; return out; }

    var work = raw;
    function cut(span) { work = work.slice(0, span[0]) + spaces(span[1] - span[0]) + work.slice(span[1]); }

    var slots = out.slots;

    /* ① 天数（先扫：后面很多词都带数字） */
    var d = findDays(work);
    if (d) { slots.days = d.value; if (d.note) out.notes.push(d.note); cut(d.span); }

    /* ② 身份 */
    var r = findRole(work);
    if (r) { slots.role = r.value; cut(r.span); }

    /* ③ 住宿（数据驱动，带提示词） */
    var lod = matchLodging(work, ctx);
    if (lod) { slots.lodging = lod.value; slots._lodgingName = lod.name; if (lod.note) out.notes.push(lod.note); cut(lod.span); }

    /* ④ 景点提及（去过 / 不去） */
    var sp = matchSpots(work, ctx);
    if (sp.visited.length) {
      slots.visited = sp.visited.map(function (x) { return x.id; });
      slots._visitedNames = sp.visited.map(function (x) { return x.name; });
    }
    if (sp.avoid.length) {
      slots.avoid = sp.avoid.map(function (x) { return x.id; });
      slots._avoidNames = sp.avoid.map(function (x) { return x.name; });
    }
    sp.cutSpans.forEach(cut);

    /* ⑤ 出发时刻 */
    var t = findTime(work, ctx);
    if (t) { slots.startAt = t.value; if (t.note) out.notes.push(t.note); cut(t.span); }

    /* ⑥ 范围 */
    var sc = findScope(work, ctx);
    if (sc) { slots.scope = sc.value; if (sc.note) out.notes.push(sc.note); cut(sc.span); }

    /* ⑦ 节奏 */
    var p = findPace(work);
    if (p) { slots.pace = p.value; cut(p.span); }

    /* ⑧ 兴趣（最后扫：别名最多，且要避开「带提示词的景点片段」——
       去过 / 不去的景点不再同时点亮话题；普通话题词照常。住宿名不拦。 */
    var skip = sp.cutSpans;
    var pf = findPrefs(work, ctx, skip);
    if (pf.add.length) slots.prefs = pf.add;
    if (pf.drop.length) { slots.prefsDrop = pf.drop; }

    /* ⑨ 只要有槽位就是一次有效填充；否则按没听懂处理 */
    var keys = Object.keys(slots).filter(function (k) { return k.charAt(0) !== '_'; });
    out.action = keys.length ? 'fill' : 'unknown';

    /* 回显：让人看见「我听懂了什么」 */
    if (slots.days != null) out.heard.push(slots.days + ' 天');
    if (slots.role) out.heard.push(describe('role', slots.role, ctx));
    if (slots.prefs && slots.prefs.length) out.heard.push(slots.prefs.join('、'));
    if (slots.prefsDrop && slots.prefsDrop.length) out.heard.push('去掉 ' + slots.prefsDrop.join('、'));
    if (slots.pace) out.heard.push(describe('pace', slots.pace, ctx));
    if (slots.scope) out.heard.push(describe('scope', slots.scope, ctx));
    if (slots.lodging) out.heard.push('住' + (slots._lodgingName || slots.lodging));
    if (slots.startAt != null) out.heard.push(hmText(slots.startAt) + ' 出发');
    if (slots._visitedNames) out.heard.push('去过 ' + slots._visitedNames.join('、'));
    if (slots._avoidNames) out.heard.push('避开 ' + slots._avoidNames.join('、'));
    return out;
  }

  /* ---------- 状态侧工具 ---------- */

  function isEmptySlot(v, k) {
    if (k === 'prefs') return !v || !v.length;
    return v == null || v === '';
  }

  /* 缺哪个槽位问哪个——顺序即 FLOW_ORDER，与向导步骤同序。 */
  function missing(state, flow) {
    var order = FLOW_ORDER[flow] || FLOW_ORDER.plan;
    return order.filter(function (k) { return isEmptySlot(state[k], k); });
  }

  /* 问句：界面传进来的向导原标题优先，保证对话与表单同一句问法。 */
  function askFor(key, ctx) {
    var ask = ctx && ctx.ask;
    return (ask && ask[key]) || SLOTS[key].ask;
  }

  /* 对话状态 → 引擎 opts。字段名与 app.js 的 runOnce() 逐字段一致；
     role 的默认值口径（'first'）也与 runOnce 相同。 */
  function toEngineOpts(state) {
    var o = {};
    if (state.days != null) o.days = state.days;
    if (state.prefs && state.prefs.length) o.prefs = state.prefs.slice();
    if (state.pace) o.pace = state.pace;
    o.role = state.role || 'first';
    return o;
  }

  function describe(key, value, ctx) {
    ctx = ctx || {};
    var L = ctx.labels || {};
    if (key === 'days') return value + ' 天';
    if (key === 'role') return (L.role || DEFAULT_LABELS.role)[value] || value;
    if (key === 'pace') return (L.pace || DEFAULT_LABELS.pace)[value] || value;
    if (key === 'scope') return (L.scope || DEFAULT_LABELS.scope)[value] || value;
    if (key === 'prefs') return (value || []).join('、') || '不限';
    if (key === 'lodging') {
      var lods = ctx.lodgings || [];
      for (var i = 0; i < lods.length; i++) if (lods[i].id === value) return lods[i].name;
      return value;
    }
    if (key === 'startAt') return hmText(value);
    return value == null ? '' : String(value);
  }

  /* 一句话回显当前状态：「3 天 · 第一次来 · 人文历史 · 轻松」 */
  function describeState(state, flow, ctx) {
    var parts = [];
    (FLOW_ORDER[flow] || FLOW_ORDER.plan).forEach(function (k) {
      var v = state[k];
      if (isEmptySlot(v, k)) return;
      var t = describe(k, v, ctx);
      if (t) parts.push(t);
    });
    return parts.join(' · ');
  }

  window.Intent = {
    VERSION: VERSION,
    SLOTS: SLOTS,
    FLOW_ORDER: FLOW_ORDER,
    parse: parse,
    missing: missing,
    isEmptySlot: isEmptySlot,
    askFor: askFor,
    describe: describe,
    describeState: describeState,
    toEngineOpts: toEngineOpts,
    defaultPrefWords: defaultPrefWords,
    hmText: hmText
  };
})();

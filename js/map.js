/* =============================================================================
 * 离线地图渲染 · js/map.js
 * -----------------------------------------------------------------------------
 * 把「行程」画成一张图。全程不进网络：底图来自 data/basemap.js，点位来自
 * 引擎返回的 plan，除此之外不请求任何东西 —— 断网、file:// 双击、单文件版
 * 三种情况下表现完全一致。
 *
 * 三条硬约束（与引擎同源）
 *   1. 零随机：同一份 plan + 同一个画布尺寸 → 逐字节相同的 SVG。里程卡的
 *      动效、点击、resize 都不会改变输出。
 *   2. 不读时间：这里不出现 Date / new Date / performance.now。
 *   3. 不依赖 DOM：本文件只做纯计算并返回字符串，因此 test/map.js 能在 node
 *      里直接跑（DOM 桩都不需要）。挂载与事件绑定留给 js/app.js。
 *
 * 投影为什么是这个投影
 *   银川市域经度跨度约 0.9°、纬度跨度约 1.0°，尺度小到 Web Mercator 与
 *   等距圆柱的差异肉眼不可辨；后者少一层对数，也少一堆浮点运算，且更容易
 *   在测试里校验往返精度。经度必须乘 cos(参考纬度) 才是实际距离 —— 在
 *   38.35°N 处 1° 经度只有 87 km，不折算就会把东西方向拉宽 1.27 倍。
 *
 * 视框为什么按画布比例反算
 *   如果固定地理范围（比如整个银川市域），市区行程的点会挤成一小团；
 *   如果只按点位包围盒，容器比例一变就得留白或拉伸变形。所以这里取
 *   「点位包围盒」→「按容器宽高比外扩到刚好填满」→「不足最小跨度时再放大到
 *   最小跨度」。三步行下来：永远填满、永不变形、市区行程也能看到两侧的
 *   贺兰山与黄河（这正是读者判断方位的锚）。
 * ========================================================================== */

(function (global) {
  'use strict';

  /* 一天一个颜色。8 天是向导上限，色相按 45° 均分后再按产品调性微调，
     统一压到中低饱和，避免地图变成色板。 */
  var DAY_COLORS = [
    '#1C4A66', /* 1 靛 —— 第一天最常出现，用最沉的一档 */
    '#B23A28', /* 2 朱 */
    '#6B7A3A', /* 3 橄榄 */
    '#7A4A6B', /* 4 紫褐 */
    '#2E6C8A', /* 5 青 */
    '#8A5A12', /* 6 赭 */
    '#4A5B8C', /* 7 灰蓝 */
    '#5C6B62'  /* 8 灰绿 */
  ];

  /* 视框至少要有这么大（纬度度数）。约 29 km —— 小于它就失去了「能看出
     相对方位」的意义，会放成一张只有几个点的空白图。 */
  var MIN_SPAN_LAT = 0.26;

  /* 1 度纬度 ≈ 111.32 km。只用于把「河宽多少米」折算成像素。 */
  var KM_PER_DEG = 111.32;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function round(n, d) {
    var p = Math.pow(10, d == null ? 1 : d);
    return Math.round(n * p) / p;
  }

  /* ---------------------------------------------------------------------------
   * 投影：经纬度 → 平面（单位「等效度」，y 轴向下）
   * ------------------------------------------------------------------------- */
  function project(lng, lat, refLat) {
    var kx = Math.cos(refLat * Math.PI / 180);
    return [lng * kx, -lat];
  }

  /* 视框：包围盒 → 按宽高比外扩 → 不足最小跨度则整体放大 */
  function fitBox(b, aspect, minSpan) {
    var cx = (b.x0 + b.x1) / 2;
    var cy = (b.y0 + b.y1) / 2;
    var w = b.x1 - b.x0;
    var h = b.y1 - b.y0;

    if (h < minSpan) h = minSpan;
    if (w < minSpan * aspect) w = minSpan * aspect;

    if (w / h > aspect) h = w / aspect;
    else w = h * aspect;

    return { x0: cx - w / 2, y0: cy - h / 2, w: w, h: h };
  }

  /* 视框里若一条河、一道山脊的落点都没有，底图就退化成一片空白，
     读者失去唯一的方向锚。此时以 12% 步长向外撑，撑到框内出现自然地物
     为止，最多撑到 maxSpan。只在小范围行程（如单日、市区内）时触发。 */
  function growToGeom(bm, box, refLat, aspect, maxSpan) {
    var anchors = [];
    (bm.ridges || []).forEach(function (r) {
      r.line.forEach(function (p) { anchors.push(project(p[0], p[1], refLat)); });
    });
    (bm.rivers || []).forEach(function (r) {
      r.line.forEach(function (p) { anchors.push(project(p[0], p[1], refLat)); });
    });
    (bm.lakes || []).forEach(function (l) {
      l.ring.forEach(function (p) { anchors.push(project(p[0], p[1], refLat)); });
    });
    if (!anchors.length) return box;

    function hit(b) {
      for (var i = 0; i < anchors.length; i++) {
        var p = anchors[i];
        if (p[0] >= b.x0 && p[0] <= b.x0 + b.w && p[1] >= b.y0 && p[1] <= b.y0 + b.h) return true;
      }
      return false;
    }

    var cur = box, guard = 0;
    while (!hit(cur) && cur.h < maxSpan && guard++ < 12) {
      var cx = cur.x0 + cur.w / 2, cy = cur.y0 + cur.h / 2;
      var w = cur.w * 1.24, h = cur.h * 1.24;
      if (w / h > aspect) h = w / aspect; else w = h * aspect;
      cur = { x0: cx - w / 2, y0: cy - h / 2, w: w, h: h };
    }
    return cur;
  }

  /* 折线按弧长均匀取样，用于沿山脊摆山形符号 */  function samplePolyline(line, n) {
    var segs = [], total = 0, i;
    for (i = 1; i < line.length; i++) {
      var dx = line[i][0] - line[i - 1][0], dy = line[i][1] - line[i - 1][1];
      var d = Math.sqrt(dx * dx + dy * dy);
      segs.push(d);
      total += d;
    }
    var out = [], at = 0, si = 0;
    for (i = 0; i < n; i++) {
      var want = total * (i + 0.5) / n;
      while (si < segs.length - 1 && at + segs[si] < want) { at += segs[si]; si++; }
      var t = segs[si] ? (want - at) / segs[si] : 0;
      var a = line[si], b = line[si + 1] || line[si];
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t,
                Math.atan2(b[1] - a[1], b[0] - a[0])]);
    }
    return out;
  }

  /* 同一天内像素距离过近的点，按固定顺序做微小扇形错开。
     银川市区里博物馆、文化中心、宝湖彼此只隔两三公里，在整市范围的图上
     必然叠成一坨；错开最多 11px，只为让序号能逐个看清。真实坐标不变，
     所以图例与角落说明里都写明「密集处已做微小错开」。
     偏移表写死而不是算出来的角度，是为了保证同一份行程永远得到同一张图。 */
  var OVERLAP_OFFSETS = [
    [0, 0], [12, -7], [-12, -7], [12, 8], [-12, 8],
    [0, -17], [0, 17], [17, 1], [-17, 1], [17, -12], [-17, -12],
    [20, 10], [-20, 10]
  ];
  var OVERLAP_MIN = 18;

  function deconflict(list, pxFn, W, H, reserved) {
    /* 全局避让，不分天：市区里不同天的点位往往落在几百米内
       （Day1 的承天寺塔与 Day3 的宁夏博物馆相距不到 5 km），
       若按天分组，两组各自避让、彼此照样重叠。
       reserved 是驻点位置：它不移动，但要占位，让景点节点绕开它 ——
       否则驻点的虚线环会被第一个景点结点压住，图上就看不出「从哪出发」。 */
    var used = [];
    if (reserved) used.push([reserved[0], reserved[1]]);
    return list.map(function (s) {
      var c = pxFn(s.spot.lng, s.spot.lat);
      var off = OVERLAP_OFFSETS[0];
      for (var k = 0; k < OVERLAP_OFFSETS.length; k++) {
        var cand = OVERLAP_OFFSETS[k];
        var hit = false;
        for (var u = 0; u < used.length; u++) {
          var dx = c[0] + cand[0] - used[u][0];
          var dy = c[1] + cand[1] - used[u][1];
          if (dx * dx + dy * dy < OVERLAP_MIN * OVERLAP_MIN) { hit = true; break; }
        }
        off = cand;
        if (!hit) break;
      }
      var x = Math.max(12, Math.min(W - 12, c[0] + off[0]));
      var y = Math.max(12, Math.min(H - 24, c[1] + off[1]));
      used.push([x, y]);
      return { day: s.day, order: s.order, spot: s.spot, color: s.color, x: x, y: y, real: c };
    });
  }

  /* 比例尺刻度：只能取整齐的公里数，不能取「恰好 100 px」。
     制图规范里比例尺要能被读成整数公里，否则读者无法用它量距离。 */
  var SCALE_STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200];

  /* 从整齐刻度里挑一个，使它的像素长度落在 56–140 px 之间：
     太短读不出、太长会撞到图上的点位。 */
  function pickScaleBar(pxPerKm) {
    var i;
    for (i = 0; i < SCALE_STEPS.length; i++) {
      if (SCALE_STEPS[i] * pxPerKm >= 56) {
        return { km: SCALE_STEPS[i], px: SCALE_STEPS[i] * pxPerKm };
      }
    }
    var last = SCALE_STEPS[SCALE_STEPS.length - 1];
    return { km: last, px: last * pxPerKm };
  }

  /* 地标与已画出的行程站点撞在一起时应当让位：
     同一个地方既被标成「第 3 站」又被标成「鼓楼」，读者会以为是两个地点。
     用像素距离判断（13 px 约等于一个节点的直径加一点余量）。 */
  function tooClose(spots, x, y, min) {
    for (var i = 0; i < spots.length; i++) {
      var dx = spots[i].x - x, dy = spots[i].y - y;
      if (dx * dx + dy * dy < min * min) return true;
    }
    return false;
  }

  /* 两点地面距离（km）。只用于判断「这个地名与驻点是不是同一处」——
     这件事不该跟着视框缩放走：换个取景范围，同一个地方还是同一个地方。
     按像素判会在窄视框里让位、宽视框里又不让位，同一份数据出现两种图。 */
  function kmBetween(a, b) {
    var dx = (a.lng - b.lng) * Math.cos((a.lat + b.lat) / 2 * Math.PI / 180) * 111.32;
    var dy = (a.lat - b.lat) * 111.32;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /* 估一段文字的像素宽度：中文按一个字宽、ASCII 按 0.55 个。
     只用于「标签会不会越界 / 会不会撞上节点」的判断，不追求精确 ——
     取整偏大一点，宁可让位也别压线。 */
  function textWidth(s, size) {
    var w = 0;
    for (var i = 0; i < s.length; i++) {
      w += s.charCodeAt(i) > 0x2e80 ? size : size * 0.55;
    }
    return w;
  }

  /* 出发位置的标注该写在哪一边。
     驻点几乎总在市区最密处，右边紧挨着就是第 1 站，所以不能死写右边：
     按「右 → 左 → 上 → 下」试一遍，取第一个既不越界、也不压住节点的方向；
     四个方向都被占（市区中心确实会发生）就选「离最近节点最远」的那一侧 ——
     总比固定写右边强，那里往往正是站点点最挤的地方。
     偏移量按指针符号的尺寸算：水滴尖端在锚点、圆顶到 -22.6（含白描边 -24.3），
     所以「上」要退到 -29 —— 早先这里是 -13，那时符号还是 19.6 px 的方块。 */
  function baseLabelPos(px0, drawn, W, H, w) {
    var pad = 8;
    var cand = [
      [14, 3.6, 'start'],
      [-14, 3.6, 'end'],
      [0, -29, 'middle'],
      [0, 21, 'middle']
    ];
    var best = null, bestD = -1;
    for (var k = 0; k < cand.length; k++) {
      var off = cand[k], anchor = off[2];
      var x = px0[0] + off[0], y = px0[1] + off[1];
      var left = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
      if (left < pad || left + w > W - pad) continue;
      if (y < pad + 10 || y > H - pad - 2) continue;
      var cx = x + (anchor === 'start' ? w / 2 : anchor === 'end' ? -w / 2 : 0);
      var cy = y - 3.6;
      var dmin = Infinity;
      for (var i = 0; i < drawn.length; i++) {
        var dx = cx - drawn[i].x, dy = cy - drawn[i].y;
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d < dmin) dmin = d;
      }
      var need = w / 2 + 11;
      if (dmin >= need) return { x: x, y: y, anchor: anchor };
      if (dmin > bestD) { bestD = dmin; best = { x: x, y: y, anchor: anchor }; }
    }
    return best || { x: px0[0] + 14, y: px0[1] + 3.6, anchor: 'start' };
  }

  /* 二次贝塞尔弧线。用弧线不用折线，是因为两者在视觉上必须能区分开：
     真实道路不会这么圆滑，所以没人会把弧线误读成实际路径。 */
  function arcPath(a, b) {
    var mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    var dx = b[0] - a[0], dy = b[1] - a[1];
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var bow = Math.min(len * 0.13, 20); /* 弯曲幅度随距离增长但设上限 */
    var cx = mx - (dy / len) * bow;
    var cy = my + (dx / len) * bow;
    return 'M' + round(a[0]) + ' ' + round(a[1]) +
           'Q' + round(cx) + ' ' + round(cy) + ' ' + round(b[0]) + ' ' + round(b[1]);
  }

  /* 从引擎的某一天里取出「要去的地方」，按到访顺序。
     只读 d.items[*].a：不读 tl.ev —— 午餐切分会让同一个景点在 tl.ev 里
     出现两条 visit 事件（前段 + 续游），照 tl.ev 画会得到重叠的双点。 */
  function stopsOf(day) {
    var out = [];
    if (!day || !day.items) return out;
    day.items.forEach(function (it) {
      var a = it && it.a;
      if (!a || a.lng == null || a.lat == null) return;
      out.push(a);
    });
    return out;
  }

  /* ---------------------------------------------------------------------------
   * 主入口
   *   opt.basemap    data/basemap.js 的对象
   *   opt.built      界面层组装好的 [{ d: 当天计划, tl: 时间轴 }]（与 renderDays 同源）
   *   opt.city       生效后的 city（用于区县中文名）
   *   opt.base       驻点（可空）
   *   opt.baseLabel  出发位置的文字（空串 = 只画符号不写字），如「行程起点」「当前位置」。
   *                  语义由调用方决定：本文件不知道用户是不是已经在路上。
   *   opt.width / opt.height  画布尺寸（像素）
   *   opt.activeDay  只高亮某一天（0 基）；null = 全部
   *   opt.legInfo    (from, to) → { km, roadKm, items, best, bestMin }，可空。
   *                  由调用方注入（界面传 Engine.legModes），本文件不依赖引擎。
   * 返回 { svg, legend, box, scale, scaleBar, stops, legs, width, height }
   *
   * 为什么接收 built 而不是 plan：built 里的 tl 已经由调用方算过一次，
   * 再让地图内部调一次 Engine.timeline() 既浪费又可能因为两处口径漂移而
   * 出现「图上点与时间轴对不上」。同一份输入，只算一次。
   * ------------------------------------------------------------------------- */
  function render(opt) {
    var bm = opt.basemap;
    var built = opt.built || [];
    var city = opt.city || {};
    var W = opt.width || 900;
    var active = (opt.activeDay == null ? null : opt.activeDay);
    var refLat = bm.refLat;

    /* ---- 1. 行程点位（先算，视框要围住它们） ---- */
    var days = built.map(function (b, i) {
      var d = b && b.d;
      var pts = stopsOf(d);
      /* 夜游：tl.nightOn 是额外加的一个点位，不在 items 里 */
      var night = b && b.tl && b.tl.nightOn;
      if (night && night.lng != null) pts.push(night);
      return {
        idx: i,
        district: d && d.district ? (city.districts[d.district] || d.district) : '',
        color: DAY_COLORS[i % DAY_COLORS.length],
        pts: pts
      };
    });

    var stops = [];
    var i, j;
    for (i = 0; i < days.length; i++) {
      for (j = 0; j < days[i].pts.length; j++) {
        stops.push({ day: i, order: j, spot: days[i].pts[j], color: days[i].color });
      }
    }

    /* ---- 2. 包围盒只围「行程 + 驻点」----
       一开始我把底图的所有控制点也算进来，结果视框被撑成整个市域，
       三天的点全挤在右半边一小块里（实测点位集中在 x=410–575）。
       底图的作用是背景与方位参照，不该决定取景范围 —— 它只在下面
       第 3 步「补偿扩展」时作为兜底出现。 */
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    function put(lng, lat) {
      var p = project(lng, lat, refLat);
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
    stops.forEach(function (s) {
      /* 单看某一天时只围这天的点位：这样点图例后地图会收紧放大，
         市区那几天终于能看清每一站；「全部」时才按整体取景。 */
      if (active != null && s.day !== active) return;
      put(s.spot.lng, s.spot.lat);
    });
    if (active != null && !isFinite(minX)) {
      stops.forEach(function (s) { put(s.spot.lng, s.spot.lat); });
    }
    if (opt.base && opt.base.lng != null) put(opt.base.lng, opt.base.lat);

    if (!isFinite(minX)) {
      var fb = (bm.places && bm.places[0]) || { lng: 106.28, lat: 38.47 };
      put(fb.lng, fb.lat);
    }

    /* ---- 3. 高度自适应 ----
       在「点位必须全部落在框内」这条硬约束下，宽画布遇到竖长行程就必然在
       左右留下大片空白 —— 这不是参数没调好，是几何决定的。所以不硬撑成
       16:9，而是让画布高度跟着内容的自然比例走，再夹在 [400, 680]：
       太矮则点位挤在一起，太高则一张图占掉整屏。 */
    var spanW = maxX - minX;
    var spanH = maxY - minY;
    var H = opt.height;
    if (!H) {
      if (!(spanW > 0)) spanW = spanH > 0 ? spanH : MIN_SPAN_LAT;
      if (!(spanH > 0)) spanH = MIN_SPAN_LAT;
      var naturalH = (W * 0.91) * (spanH / spanW) / 0.85;
      H = Math.round(Math.max(400, Math.min(540, naturalH)));
    }

    /* ---- 4. 视框：按画布比例外扩，不足最小跨度则放大 ---- */
    var padX = Math.round(W * 0.045);
    var padY = Math.round(H * 0.075);
    var availW = W - padX * 2;
    var availH = H - padY * 2;
    var box = fitBox({ x0: minX, x1: maxX, y0: minY, y1: maxY }, availW / availH, MIN_SPAN_LAT);

    /* ---- 4b. 补偿扩展：框里一个自然地物都没有时，向最近的地物撑开 ---- */
    box = growToGeom(bm, box, refLat, availW / availH, MIN_SPAN_LAT * 3);
    var scale = availW / box.w;

    function px(lng, lat) {
      var p = project(lng, lat, refLat);
      return [padX + (p[0] - box.x0) * scale, padY + (p[1] - box.y0) * scale];
    }
    function pxRaw(p) {
      return [padX + (p[0] - box.x0) * scale, padY + (p[1] - box.y0) * scale];
    }

    var out = [];
    out.push('<svg class="mv" viewBox="0 0 ' + W + ' ' + H + '" width="100%" ' +
      'height="' + H + '" role="img" aria-labelledby="mvTitle mvDesc" ' +
      'preserveAspectRatio="xMidYMid meet">');
    out.push('<title id="mvTitle">行程示意地图</title>');
    out.push('<desc id="mvDesc">' +
      esc('按天分色的行程走向图。底图地物为手绘近似，行程连线为示意弧线，不沿真实道路，不可用于导航。') +
      '</desc>');

    /* 裁剪：视框外的底图不参与绘制 */
    out.push('<defs><clipPath id="mvClip"><rect x="0" y="0" width="' + W + '" height="' + H + '"/></clipPath></defs>');
    out.push('<g clip-path="url(#mvClip)">');

    /* ---- 5. 底图：建成区（最底层，只作淡底，避免中间大片留白） ---- */
    (bm.urbanAreas || []).forEach(function (u) {
      var pts = u.ring.map(function (p) { return px(p[0], p[1]); });
      var d = 'M' + pts.map(function (p) { return round(p[0]) + ' ' + round(p[1]); }).join('L') + 'Z';
      out.push('<path class="mv-urban" d="' + d + '" fill="#D8D1BE" fill-opacity=".26" stroke="#D8D1BE" stroke-opacity=".18" stroke-width="7" stroke-linejoin="round"/>');
    });

    /* ---- 5b. 底图：区域名 ----
       贺兰山与黄河之间那大片平原，行程若只在市区就完全是空的。
       补一个稀疏字距的地貌区名，读者立刻知道「这一片是什么」——
       而且它不需要画任何一条可能画错的边界线。 */
    (bm.regions || []).forEach(function (rg) {
      var c = px(rg.lng, rg.lat);
      var tf = rg.rotate
        ? ' transform="rotate(' + rg.rotate + ' ' + round(c[0]) + ' ' + round(c[1]) + ')"'
        : '';
      out.push('<text class="mv-region" x="' + round(c[0]) + '" y="' + round(c[1]) +
        '" text-anchor="middle" font-size="' + (rg.size || 14) + '"' + tf + '>' +
        esc(rg.name) + '</text>');
    });

    /* ---- 6. 底图：山 ---- */
    (bm.ridges || []).forEach(function (r) {
      var pts = r.line.map(function (p) { return px(p[0], p[1]); });
      var d = 'M' + pts.map(function (p) { return round(p[0]) + ' ' + round(p[1]); }).join('L');
      /* 山体：沿脊线一条较宽的淡带，压在山形符号下面，形成体积感 */
      out.push('<path class="mv-ridge-band" d="' + d + '" fill="none" ' +
        'stroke="#A79C86" stroke-opacity=".15" stroke-width="' + round(Math.max(12, 19)) + '" ' +
        'stroke-linecap="round" stroke-linejoin="round"/>');
      out.push('<path class="mv-ridge-line" d="' + d + '" fill="none" ' +
        'stroke="#8C8271" stroke-opacity=".55" stroke-width="1.2" ' +
        'stroke-dasharray="5 4" stroke-linejoin="round"/>');

      /* 山形符号：沿脊线均匀取样，每个三角朝向与脊线切向垂直 */
      var marks = samplePolyline(r.line, 10);
      marks.forEach(function (m, k) {
        var c = px(m[0], m[1]);
        var s = 4.8 + (k % 3) * 1.3; /* 确定性的轻微错落，不引入随机 */
        out.push('<path class="mv-peak" d="M' + round(c[0] - s) + ' ' + round(c[1] + s * 0.7) +
          'L' + round(c[0]) + ' ' + round(c[1] - s * 0.8) +
          'L' + round(c[0] + s) + ' ' + round(c[1] + s * 0.7) + 'Z" ' +
          'fill="#F1EDE3" fill-opacity=".72" stroke="#786D5A" stroke-opacity=".55" stroke-width="1.15" ' +
          'stroke-linejoin="round"/>');
      });

      /* 山名。数据里一直有 label / labelAt，但早期渲染漏了这一层 ——
         图上只有一排小三角、没有名字，读者得靠猜才知道那是贺兰山。 */
      if (r.label && r.labelAt) {
        var rc = px(r.labelAt[0], r.labelAt[1]);
        out.push('<text class="mv-rlabel ridge" x="' + round(rc[0]) + '" y="' + round(rc[1]) + '"' +
          (r.labelAnchor ? ' text-anchor="' + r.labelAnchor + '"' : '') + '>' +
          esc(r.label) + '</text>');
      }
    });

    /* ---- 7. 底图：湖 ---- */
    (bm.lakes || []).forEach(function (l) {
      var pts = l.ring.map(function (p) { return px(p[0], p[1]); });
      var d = 'M' + pts.map(function (p) { return round(p[0]) + ' ' + round(p[1]); }).join('L') + 'Z';
      out.push('<path class="mv-lake" d="' + d + '" fill="#8FB4C6" fill-opacity=".34" ' +
        'stroke="#6E97AC" stroke-opacity=".55" stroke-width="1"/>');
      if (pts.length) {
        var cx = pts.reduce(function (s, p) { return s + p[0]; }, 0) / pts.length;
        var cy = pts.reduce(function (s, p) { return s + p[1]; }, 0) / pts.length;
        out.push('<text class="mv-wlabel" x="' + round(cx) + '" y="' + round(cy + 3) +
          '" text-anchor="middle">' + esc(l.name) + '</text>');
      }
    });

    /* ---- 8. 底图：黄河 ---- */
    (bm.rivers || []).forEach(function (r) {
      var pts = r.line.map(function (p) { return px(p[0], p[1]); });
      var d = 'M' + pts.map(function (p) { return round(p[0]) + ' ' + round(p[1]); }).join('L');
      /* 河宽按米折算：放大时河自然变宽，与真实地图的观感一致 */
      var wpx = Math.max(2.4, (r.widthM || 400) * scale / (KM_PER_DEG * 1000));
      out.push('<path class="mv-river" d="' + d + '" fill="none" stroke="#5C8FAE" ' +
        'stroke-opacity=".38" stroke-width="' + round(wpx + 4) + '" stroke-linecap="round" stroke-linejoin="round"/>');
      out.push('<path class="mv-river" d="' + d + '" fill="none" stroke="#7FAFC8" ' +
        'stroke-opacity=".85" stroke-width="' + round(wpx) + '" stroke-linecap="round" stroke-linejoin="round"/>');

      /* 河名沿河道方向旋转：横平竖直地压在一条斜河上，读者看不出它标的是哪条河。
         角度按投影后的线段算（经度已乘 cos，不做这一步会偏 20° 以上）。 */
      if (r.label && r.labelAt) {
        var lc = px(r.labelAt[0], r.labelAt[1]);
        var ang = 0, bd = Infinity, q;
        for (q = 1; q < pts.length; q++) {
          var mx = (pts[q - 1][0] + pts[q][0]) / 2, my = (pts[q - 1][1] + pts[q][1]) / 2;
          var dd = (mx - lc[0]) * (mx - lc[0]) + (my - lc[1]) * (my - lc[1]);
          if (dd < bd) {
            bd = dd;
            ang = Math.atan2(pts[q][1] - pts[q - 1][1], pts[q][0] - pts[q - 1][0]) * 180 / Math.PI;
          }
        }
        while (ang > 90) ang -= 180;
        while (ang < -90) ang += 180;
        out.push('<text class="mv-rlabel river" x="' + round(lc[0]) + '" y="' + round(lc[1]) +
          '" text-anchor="middle" transform="rotate(' + round(ang) + ' ' + round(lc[0]) + ' ' +
          round(lc[1]) + ')">' + esc(r.label) + '</text>');
      }
    });

    /* ---- 9. 行程连线（画在点位下面）----
       连线端点必须与错开后的圆心重合，否则密集区域会出现「线断在点旁边」。
       所以先把绘制坐标算出来，连线与节点共用同一份。

       每条线同时产出一份「行程信息」：从哪到哪、直线多远、各方式多久。
       数值由调用方注入的 legInfo 算（Engine.legModes）—— 图只负责画，
       但数值必须来自引擎，否则图上写的车程会和行程表里那一行对不上。 */
    var basePx = (opt.base && opt.base.lng != null) ? px(opt.base.lng, opt.base.lat) : null;
    var drawn = deconflict(stops, px, W, H, basePx);
    var posOf = {};
    drawn.forEach(function (s) { posOf[s.day + ':' + s.order] = [s.x, s.y]; });

    var legInfo = opt.legInfo || null;
    var legs = [];
    var hits = [];

    function pushLeg(day, order, from, to, p1, p2, fromBase, toBase) {
      var i = legs.length;
      var info = legInfo ? legInfo(from, to) : null;
      var fname = (from && from.name) || '';
      var tname = (to && to.name) || '';
      legs.push({
        idx: i, day: day.idx, order: order, fromBase: !!fromBase, toBase: !!toBase,
        fromId: (from && from.id) || '', fromName: fname,
        toId: (to && to.id) || '', toName: tname,
        x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1],
        km: info ? info.km : null,
        roadKm: info ? info.roadKm : null,
        items: info ? info.items : null,
        best: info ? info.best : null,
        bestMin: info ? info.bestMin : null,
        label: toBase ? '第 ' + order + ' 站 → 返回驻点'
             : (fromBase ? '从' + fname + '出发' : '第 ' + order + ' → ' + (order + 1) + ' 站')
      });
      return i;
    }

    function hitPath(i, d) {
      return '<path class="mv-leg-hit" data-leg="' + i + '" d="' + d + '" fill="none" ' +
        'stroke="transparent" stroke-width="15" stroke-linecap="round" ' +
        'tabindex="0" role="button" aria-label="' + esc(legs[i].label) + '"/>';
    }

    days.forEach(function (day) {
      /* 单天视图下别的天一律不画：视野已收紧到这一天，它们的点多半在框外，
         剩下的线头只会变成噪点。要看全局就再点一次图例回到「全部」。 */
      if (active != null && active !== day.idx) return;
      var on = (active == null || active === day.idx);
      var op = on ? 1 : 0.16;
      var chain = day.pts.map(function (s, k) {
        return posOf[day.idx + ':' + k] || px(s.lng, s.lat);
      });
      var k, i, d;
      if (basePx && chain.length) {
        d = arcPath(basePx, chain[0]);
        i = pushLeg(day, 0, opt.base, day.pts[0], basePx, chain[0], true);
        out.push('<path class="mv-leg mv-leg-base" data-leg="' + i + '" d="' + d +
          '" fill="none" stroke="' + day.color + '" stroke-opacity="' + round(op * 0.75) +
          '" stroke-width="1.4" stroke-dasharray="4 3"/>');
        hits.push(hitPath(i, d));
      }
      for (k = 1; k < chain.length; k++) {
        d = arcPath(chain[k - 1], chain[k]);
        i = pushLeg(day, k, day.pts[k - 1], day.pts[k], chain[k - 1], chain[k], false);
        out.push('<path class="mv-leg" data-day="' + day.idx + '" data-leg="' + i + '" d="' + d +
          '" fill="none" stroke="' + day.color + '" stroke-opacity="' + round(op * 0.9) +
          '" stroke-width="' + (on ? 1.8 : 1.2) + '" stroke-linecap="round"/>');
        hits.push(hitPath(i, d));
      }
      /* 末段：最后一站 → 驻点。
         缺了这一段，每天在图上都是一条张开的线头，读完只会问「晚上怎么回去」——
         而排程里这段路其实一直在（见 Engine.timeline 末尾那次回程），
         只是图上没画，等于把已经算过的时间藏起来了。
         它与出发段是同一件事的两头，所以用同一种虚线、同一种透明度：
         一头一尾两道虚线，一天就读成一个往返，而不是一串单程。
         末站就在驻点 0.5 km 内时不画（同一天里去了楼下的地方，没有回程可言）。 */
      var tail = day.pts.length ? day.pts[day.pts.length - 1] : null;
      if (basePx && tail && kmBetween(tail, opt.base) >= 0.5) {
        var tailPx = chain[chain.length - 1];
        d = arcPath(tailPx, basePx);
        i = pushLeg(day, chain.length, tail, opt.base, tailPx, basePx, false, true);
        out.push('<path class="mv-leg mv-leg-ret" data-day="' + day.idx + '" data-leg="' + i + '" d="' + d +
          '" fill="none" stroke="' + day.color + '" stroke-opacity="' + round(op * 0.75) +
          '" stroke-width="1.4" stroke-dasharray="4 3" stroke-linecap="round"/>');
        hits.push(hitPath(i, d));
      }
    });
    /* 命中区统一压在连线之上、节点之下：细到 1.8px 的弧线根本点不中，
       需要一条透明的粗路径来接鼠标，但又不能盖住节点（节点是开攻略卡的入口）。 */
    out.push(hits.join(''));

    /* ---- 10. 出发位置（定位指针） ----
       形状本身就是图例：景点是彩色圆、城镇是双圈、地标是三角／飞机／方框，
       出发位置是**定位指针**（上圆下尖的水滴）。选这个形状不是为了好看：
       尖端落在驻点的精确坐标上，「这是一个位置」比一个方块说得准；
       圆头朝上，文字也顺势往上找位置。它同样不会被读成景点 ——
       圆景点是实心彩圆带序号，水滴带尖，两种形状没有中间态。
       早先画的是白底虚线圆环，问题是它和景点节点太像 —— 驻点与第 1 站
       常常只隔几百米，读者会看成两个景点。之后改成实心墨方，用户反馈
       「全黑不好看」，才落到指针。
       颜色用赭金 #8C5B16：**品牌蓝 #175E9E 与「贺兰山岳」类的 tint #185FA5
       几乎同色**，蓝指针会和蓝色景点圆混在一起；赭金与题字同族、和 11 类
       tint 都不撞，形状又唯一。位置指针在地图产品里默认是蓝色，这里不能照搬。
       **必须不透明**：驻点常与「兴庆区」这类行政中心的双圈重合，
       留一点透明度就会把底下的白底灰环透上来，像指针里多了个镜头。
       白描边代替原先那块白底：同样压得住湖面、河道与彩色连线，还跟着形状走。
       文字另外画（见 12d）：它要压在地名之上，所以不能在这里落地。 */
    var baseTag = '';
    var baseTagPos = null;
    var bLabel = opt.baseLabel || '';
    if (basePx) {
      var bx = round(basePx[0]), by = round(basePx[1]);
      var bName = (opt.base && opt.base.name) || '';
      /* 水滴：尖端在 (bx, by)，圆心 (bx, by-15)、半径 7.6，圆顶到 by-22.6。
         两段三次贝塞尔从尖端切到圆的左右极点，再用一段 180° 的弧收顶。
         切线手算过：尖端到圆心 15、半径 7.6，切点在 (±6.55, -11.1) 附近，
         控制点取 (±2.4, -5) 与 (±7.6, -9.4)，视觉上与切线吻合。 */
      var pin = 'M' + bx + ' ' + by +
        'C' + round(bx - 2.4) + ' ' + round(by - 5) +
        ' ' + round(bx - 7.6) + ' ' + round(by - 9.4) +
        ' ' + round(bx - 7.6) + ' ' + round(by - 15) +
        'A7.6 7.6 0 1 1 ' + round(bx + 7.6) + ' ' + round(by - 15) +
        'C' + round(bx + 7.6) + ' ' + round(by - 9.4) +
        ' ' + round(bx + 2.4) + ' ' + round(by - 5) +
        ' ' + bx + ' ' + by + 'Z';
      out.push('<g class="mv-base">' +
        '<title>' + esc((bLabel || '出发位置') + (bName ? ' · ' + bName : '')) + '</title>' +
        '<path d="' + pin + '" fill="#8C5B16" stroke="#FBFAF5" stroke-width="3.4" ' +
        'stroke-linejoin="round"/>' +
        '<circle cx="' + bx + '" cy="' + round(by - 15) + '" r="2.9" fill="#FBFAF5"/>' +
        '</g>');
      if (bLabel) {
        var lp = baseLabelPos(basePx, drawn, W, H, textWidth(bLabel, 10.5) + 2);
        baseTagPos = lp;
        baseTag = '<text class="mv-blabel" x="' + round(lp.x) + '" y="' + round(lp.y) + '"' +
          (lp.anchor === 'start' ? '' : ' text-anchor="' + lp.anchor + '"') +
          '>' + esc(bLabel) + '</text>';
      }
    }

    /* ---- 11. 行程节点 ---- */
    drawn.forEach(function (s) {
      if (active != null && active !== s.day) return;
      var on = (active == null || active === s.day);
      var op = on ? 1 : 0.28;
      var label = 'Day ' + (s.day + 1) + ' · 第 ' + (s.order + 1) + ' 站 · ' + s.spot.name;
      out.push('<g class="mv-stop" data-day="' + s.day + '" data-order="' + s.order +
        '" data-spot="' + esc(s.spot.id || '') + '" opacity="' + op + '">' +
        '<title>' + esc(label) + '</title>' +
        '<circle cx="' + round(s.x) + '" cy="' + round(s.y) + '" r="7.6" fill="#FFFFFF" fill-opacity=".92"/>' +
        '<circle cx="' + round(s.x) + '" cy="' + round(s.y) + '" r="5.6" fill="' + s.color + '" ' +
        'stroke="#FFFFFF" stroke-width="1.3"/>' +
        '<text class="mv-ord" x="' + round(s.x) + '" y="' + round(s.y + 2.7) + '" ' +
        'text-anchor="middle">' + (s.order + 1) + '</text>' +
        '</g>');
    });

    /* ---- 12. 底图：地名（最上层：压在点位上也读得清） ----
       行政中心用「双圈」（外空心环 + 内实心点），这是制图惯例：
       一眼就能与普通地名、与行程的彩色站点区分开。
       但驻点常常正落在某个行政中心的点位上（新华街商圈 = 兴庆区中心）：
       这一点整个让给出发位置 —— 双圈叠在方框里像方框中间多了个镜头，
       名字也会和「行程起点」叠在同一处，两个信息互相看不清。 */
    (bm.places || []).forEach(function (p) {
      var c = px(p.lng, p.lat);
      /* 1 km 内算同一处：新华街商圈与「兴庆区」的点只差 0.55 km */
      if (opt.base && opt.base.lng != null && kmBetween(p, opt.base) < 1) return;
      if (p.kind === 'admin') {
        out.push('<g class="mv-place">' +
          '<circle cx="' + round(c[0]) + '" cy="' + round(c[1]) + '" r="3.7" fill="#FFFFFF" fill-opacity=".82"/>' +
          '<circle cx="' + round(c[0]) + '" cy="' + round(c[1]) + '" r="3.2" fill="none" ' +
          'stroke="#5C5A52" stroke-opacity=".85" stroke-width="1"/>' +
          '<circle cx="' + round(c[0]) + '" cy="' + round(c[1]) + '" r="1.2" fill="#5C5A52" fill-opacity=".9"/>' +
          '</g>');
      } else {
        out.push('<circle class="mv-placedot" cx="' + round(c[0]) + '" cy="' + round(c[1]) +
          '" r="1.7" fill="#8B8981" fill-opacity=".7"/>');
      }
      out.push('<text class="mv-plabel' + (p.rank === 2 ? ' big' : '') + '" x="' + round(c[0] + (p.dx || 0)) +
        '" y="' + round(c[1] + (p.dy == null ? 4 : p.dy)) + '"' +
        (p.anchor ? ' text-anchor="' + p.anchor + '"' : '') + '>' + esc(p.name) + '</text>');
    });

    /* ---- 12b. 地标 ----
       只画「不在景点表里」的城市锚点（见 data/basemap.js 的说明）。
       与当前视图里的行程站点撞上就让位 —— 同一个地方既标成「第 3 站」
       又标成「鼓楼」，读者会以为是两个地点。 */
    var visibleStops = drawn.filter(function (s) { return active == null || s.day === active; });
    (bm.landmarks || []).forEach(function (lm) {
      var c = px(lm.lng, lm.lat);
      /* 与行程站点撞上时：符号让位（不画），但文字保留并往外再推一截。
         不能整个跳过 —— 鼓楼、凤凰碑都在老城 1 km 内，而那一带正是行程
         站点最密的地方，全跳过等于把最有辨识度的两个地名抹掉了。 */
      var clash = tooClose(visibleStops, c[0], c[1], 15);
      var k = clash ? 1.9 : 1;
      var x = round(c[0]), y = round(c[1]);
      var sym = '';
      if (!clash) {
      if (lm.kind === 'peak') {
        /* 山峰：比山脊符号大一号的实心三角，白色填充保证压在脊线上也看得见 */
        sym = '<path d="M' + round(c[0] - 4.8) + ' ' + round(c[1] + 2.8) +
          'L' + x + ' ' + round(c[1] - 3.6) +
          'L' + round(c[0] + 4.8) + ' ' + round(c[1] + 2.8) + 'Z" ' +
          'fill="#FFFFFF" fill-opacity=".86" stroke="#5E5443" stroke-width="1.25" stroke-linejoin="round"/>';
      } else if (lm.kind === 'air') {
        /* 机场：俯视飞机（机身 + 两翼 + 尾翼）。用三条线而不是字符 ✈，
           是因为字符要依赖字体，换台机器就可能变成方框。 */
        sym = '<path d="M' + x + ' ' + round(c[1] - 4.2) + 'L' + x + ' ' + round(c[1] + 4.2) +
          'M' + round(c[0] - 3.8) + ' ' + round(c[1] - 0.8) + 'L' + round(c[0] + 3.8) + ' ' + round(c[1] - 0.8) +
          'M' + round(c[0] - 2.1) + ' ' + round(c[1] + 3) + 'L' + round(c[0] + 2.1) + ' ' + round(c[1] + 3) +
          '" fill="none" stroke="#3E586B" stroke-width="1.5" stroke-linecap="round"/>';
      } else if (lm.kind === 'rail') {
        /* 车站：方框 + 两道横线，铁路图例里最常见的画法 */
        sym = '<rect x="' + round(c[0] - 3.5) + '" y="' + round(c[1] - 3.5) + '" width="7" height="7" rx="1" ' +
          'fill="#FFFFFF" fill-opacity=".9" stroke="#3B3A34" stroke-width="1.1"/>' +
          '<path d="M' + round(c[0] - 3.5) + ' ' + round(c[1] - 1) + 'L' + round(c[0] + 3.5) + ' ' + round(c[1] - 1) +
          'M' + round(c[0] - 3.5) + ' ' + round(c[1] + 1.4) + 'L' + round(c[0] + 3.5) + ' ' + round(c[1] + 1.4) +
          '" stroke="#3B3A34" stroke-width=".85"/>';
      } else if (lm.kind === 'nature') {
        /* 保护地：空心小环。不填色 = 它不是「一个点」，与城市地标的实心点区分开 */
        sym = '<circle cx="' + x + '" cy="' + y + '" r="2.9" fill="#FFFFFF" fill-opacity=".72" ' +
          'stroke="#5B7052" stroke-width="1.2"/>';
      } else {
        sym = '<circle cx="' + x + '" cy="' + y + '" r="3" fill="#4A4842" fill-opacity=".85" ' +
          'stroke="#FFFFFF" stroke-width="1.1"/>';
      }
      }
      out.push('<g class="mv-lm mv-lm-' + esc(lm.kind) + '">' +
        '<title>' + esc(lm.name + (lm.note ? ' ' + lm.note : '')) + '</title>' + sym +
        '<text class="mv-lmlabel" x="' + round(c[0] + (lm.dx || 0) * k) + '" y="' +
        round(c[1] + (lm.dy == null ? 4 : lm.dy) * k) + '"' +
        (lm.anchor ? ' text-anchor="' + lm.anchor + '"' : '') + '>' + esc(lm.name) +
        (lm.note ? '<tspan class="mv-lmnote" dx="3">' + esc(lm.note) + '</tspan>' : '') +
        '</text></g>');
    });

    /* ---- 12c. 比例尺（左下）与指北针（右上） ----
       这两个是地图的「最低配置」：没有比例尺，读者无法判断两点实际相隔多远；
       没有指北针，无法确认图上是不是正北朝上。行程连线本身是示意弧线，
       但点与点之间的方位和距离是真的，所以比例尺不是装饰。 */
    var sb = pickScaleBar(scale / KM_PER_DEG);
    var sbX = padX + 2, sbY = H - 27;
    out.push('<g class="mv-scale">' +
      '<path d="M' + sbX + ' ' + sbY + 'L' + round(sbX + sb.px) + ' ' + sbY +
      '" stroke="#5C5A52" stroke-opacity=".75" stroke-width="1.1"/>' +
      '<path d="M' + sbX + ' ' + round(sbY - 3.6) + 'L' + sbX + ' ' + round(sbY + 3.6) +
      'M' + round(sbX + sb.px) + ' ' + round(sbY - 3.6) + 'L' + round(sbX + sb.px) + ' ' + round(sbY + 3.6) +
      '" stroke="#5C5A52" stroke-opacity=".75" stroke-width="1.1"/>' +
      '<text class="mv-scaletxt" x="' + round(sbX + sb.px / 2) + '" y="' + round(sbY - 5.5) +
      '" text-anchor="middle">' + sb.km + ' km</text>' +
      '</g>');

    var nX = W - 24, nY = 26;
    out.push('<g class="mv-north">' +
      '<path d="M' + nX + ' ' + round(nY - 11) + 'L' + round(nX - 4.2) + ' ' + round(nY + 5.5) +
      'L' + nX + ' ' + round(nY + 2) + 'L' + round(nX + 4.2) + ' ' + round(nY + 5.5) + 'Z" ' +
      'fill="#5C5A52" fill-opacity=".78"/>' +
      '<text class="mv-northtxt" x="' + nX + '" y="' + round(nY + 17) + '" text-anchor="middle">N</text>' +
      '</g>');

    /* ---- 12d. 出发位置的文字 ----
       放在地名与地标之后：驻点多在市区，周围正是一圈地名，标签被压住就白加了。
       它有白色描边兜底，压住一个灰色地名也仍然读得清。 */
    if (baseTag) out.push(baseTag);

    out.push('</g>');

    /* ---- 13. 角落说明。地图必须自己说清它不是导航图，不能只写在文档里 ---- */
    out.push('<text class="mv-foot" x="' + (W - 8) + '" y="' + (H - 7) +
      '" text-anchor="end">示意底图 · 连线不沿道路 · 密集处已微调 · 不可导航</text>');

    out.push('</svg>');

    /* ---- 14. 图例（HTML，交给 app.js 挂载） ---- */
    var legend = days.map(function (day) {
      var on = (active == null || active === day.idx);
      return '<button type="button" class="mv-lg' + (on ? ' on' : '') + '" data-day="' + day.idx + '">' +
        '<i style="background:' + day.color + '"></i>' +
        '<b>Day ' + (day.idx + 1) + '</b>' +
        '<span>' + esc(day.district || '—') + ' · ' + day.pts.length + ' 站</span>' +
        '</button>';
    }).join('');

    return {
      svg: out.join(''),
      legend: legend,
      box: box,
      scale: scale,
      /* 比例尺的公里数与像素长度：测试要核对它与 scale 自洽，
         否则图上写着「10 km」、实际量出来却是 14 km，比不画更糟。 */
      scaleBar: { km: sb.km, px: sb.px },
      /* 连线清单：界面层拿它做悬停/点击的信息卡，测试拿它核对数值口径 */
      legs: legs,
      stops: drawn.map(function (s) {
        return {
          day: s.day, order: s.order, id: s.spot.id, name: s.spot.name,
          x: s.x, y: s.y,           /* 实际绘制位置（密集处已错开） */
          rx: s.real[0], ry: s.real[1],  /* 真实投影位置，供测试核对错开幅度 */
          lng: s.spot.lng, lat: s.spot.lat
        };
      }),
      /* 出发位置：符号中心与文字落点。测试要核对标签在画布内、且写得进图。 */
      base: basePx ? {
        x: basePx[0], y: basePx[1], label: bLabel,
        tag: baseTagPos ? { x: baseTagPos.x, y: baseTagPos.y, anchor: baseTagPos.anchor } : null
      } : null,
      width: W,
      height: H
    };
  }

  global.MapView = {
    DAY_COLORS: DAY_COLORS,
    MIN_SPAN_LAT: MIN_SPAN_LAT,
    project: project,
    fitBox: fitBox,
    stopsOf: stopsOf,
    render: render
  };

})(typeof window !== 'undefined' ? window : global);

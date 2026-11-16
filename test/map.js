/* =============================================================================
 * 离线地图验证 · 文旅导览智能体
 *
 * 这张图是本作品唯一一处「自己造地理数据」的地方，因此最需要被锁住 ——
 * 底图画歪了不会报错，只会让评委觉得「这城市的山河怎么长得不对」。
 *
 * 这个脚本锁六件事：
 *   ① 投影与视框在数学上成立（比例不变形、点不会被裁到框外、单点也不会除零）
 *   ② 底图与真实数据自洽：黄河类景区都在河道 5 km 内、贺兰山类都在山脊 8 km 内、
 *      四处湖景就在自己那片湖面上 —— 这一组是「底图不是随手画的」的证据
 *   ③ 输出确定性：同一份行程渲染两次逐字节相同（与引擎的零随机约束同源）
 *   ④ 零外部依赖：SVG 里没有 http(s)、没有 <image>、没有 base64、没有 url()
 *   ⑤ 交互状态正确：单看某天只画那天、视野收紧；密集点位错开但幅度有上限
 *   ⑥ 渲染是只读的：不许改动传进来的 built / 底图数据
 *
 * 运行：node test/map.js   （路径按 __dirname 解析，可在任意目录下跑）
 * ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
global.window = global;

['data/yinchuan.js', 'data/nearby.js', 'data/lodging.js', 'data/basemap.js',
 'js/engine.js', 'js/map.js'].forEach(f => {
  eval(fs.readFileSync(path.join(ROOT, f), 'utf8'));
});

const BM = window.BASE_MAP;
const MV = window.MapView;
const PACKS = window.CITY_DATA;

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  —  ' + detail : '')); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  —  ' + detail : '')); }
}
function head(t) { console.log('\n' + t); }

/* ---------- 地理小工具：把经纬度折算成公里平面，算点到线 / 到多边形的距离 ---------- */
const K_LAT = 111.32;
const K_LNG = 111.32 * Math.cos(38.35 * Math.PI / 180);
function km(p) { return [p[0] * K_LNG, p[1] * K_LAT]; }
function segKm(p, a, b) {
  const P = km(p), A = km(a), B = km(b);
  const dx = B[0] - A[0], dy = B[1] - A[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((P[0] - A[0]) * dx + (P[1] - A[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(P[0] - (A[0] + dx * t), P[1] - (A[1] + dy * t));
}
function lineKm(p, line) {
  let m = Infinity;
  for (let i = 1; i < line.length; i++) m = Math.min(m, segKm(p, line[i - 1], line[i]));
  return m;
}
/* 点到闭合环的距离：在环上取最小，且落在环内记 0 */
function ringKm(p, ring) {
  let m = Infinity;
  for (let i = 0; i < ring.length; i++) {
    m = Math.min(m, segKm(p, ring[i], ring[(i + 1) % ring.length]));
  }
  /* 射线法判内外 */
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if ((yi > p[1]) !== (yj > p[1]) &&
        p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside ? 0 : m;
}

/* ---------- 用真实入口跑一份行程 ---------- */
function build(opts, packIds) {
  const city = Engine.buildCity(packIds || ['yinchuan', 'nearby']);
  const r = Engine.plan(city, opts);
  const use = r.city || city;
  const built = r.days.map(d => ({ d: d, tl: Engine.timeline(use, d, r.W) }));
  return { city: use, r: r, built: built };
}
function draw(o, w) {
  return MV.render({
    basemap: BM,
    built: o.built,
    city: o.city,
    base: o.base || o.city.base,
    width: w || 880,
    activeDay: o.activeDay === undefined ? null : o.activeDay,
    legInfo: Engine.legModes          /* 与界面层同一份口径 */
  });
}

const ALL = (PACKS.yinchuan.attractions || []).concat(PACKS.nearby.attractions || []);

/* =========================================================================
 * 一、投影与视框
 * ======================================================================= */
head('一、投影与视框');

{
  const a = MV.project(106.28, 38.47, 38.35);
  const b = MV.project(106.29, 38.47, 38.35);
  ok('纬度取反（屏幕 y 向下）', a[1] === -38.47, 'y = ' + a[1]);
  ok('经度按参考纬度做余弦折算', Math.abs(b[0] - a[0] - 0.01 * Math.cos(38.35 * Math.PI / 180)) < 1e-12,
    'Δx = ' + (b[0] - a[0]).toFixed(6) + '，cos38.35° = ' + Math.cos(38.35 * Math.PI / 180).toFixed(5));
  ok('1° 经度在银川只有约 0.78° 纬度的长度', b[0] - a[0] < 0.01, '不折算会把东西向拉宽 1.27 倍');

  const box = MV.fitBox({ x0: 0, x1: 1, y0: 0, y1: 1 }, 2, 0.26);
  ok('视框比例等于给定宽高比', Math.abs(box.w / box.h - 2) < 1e-9, box.w.toFixed(4) + ' / ' + box.h.toFixed(4));
  ok('视框包含原包围盒', box.x0 <= 0 && box.y0 <= 0 && box.x0 + box.w >= 1 && box.y0 + box.h >= 1);
  ok('视框中心不变', Math.abs(box.x0 + box.w / 2 - 0.5) < 1e-9 && Math.abs(box.y0 + box.h / 2 - 0.5) < 1e-9);

  const tiny = MV.fitBox({ x0: 5, x1: 5, y0: 5, y1: 5 }, 1.6, 0.26);
  ok('单点包围盒不会除零', isFinite(tiny.w) && isFinite(tiny.h) && tiny.w > 0 && tiny.h > 0,
    tiny.w.toFixed(2) + ' × ' + tiny.h.toFixed(2));
  ok('单点包围盒被撑到最小跨度', Math.round(tiny.h * 1000) / 1000 === 0.26, 'h = ' + tiny.h.toFixed(3));
}

/* =========================================================================
 * 二、底图与真实数据自洽
 * ======================================================================= */
head('二、底图与真实数据自洽（底图不是随手画的）');

{
  const river = BM.rivers[0].line;
  const ridge = BM.ridges[0].line;

  const rivers = ALL.filter(a => a.cat === 'river');
  const badRiver = rivers.map(a => [a.name, lineKm([a.lng, a.lat], river)]).filter(x => x[1] > 5);
  ok('黄河类景区都在河道 5 km 内', rivers.length >= 4 && badRiver.length === 0,
    rivers.length + ' 处，最远 ' + Math.max.apply(null, rivers.map(a => lineKm([a.lng, a.lat], river))).toFixed(1) + ' km' +
    (badRiver.length ? '；越界：' + badRiver.map(x => x[0] + ' ' + x[1].toFixed(1) + 'km').join('、') : ''));

  const mts = ALL.filter(a => a.cat === 'mountain');
  /* 东麓景区：经度在西侧、且不在青铜峡（那里靠的是牛首山，不是贺兰山） */
  const foothill = ALL.filter(a => a.lng < 106.05 && a.cat !== 'mountain' && a.district !== '青铜峡市');
  const badMts = mts.concat(foothill).map(a => [a.name, lineKm([a.lng, a.lat], ridge)]).filter(x => x[1] > 8);
  ok('贺兰山类与东麓景区都在山脊 8 km 内', mts.length + foothill.length >= 10 && badMts.length === 0,
    mts.length + ' 处山类 + ' + foothill.length + ' 处山麓，最远 ' +
    Math.max.apply(null, mts.concat(foothill).map(a => lineKm([a.lng, a.lat], ridge))).toFixed(1) + ' km' +
    (badMts.length ? '；越界：' + badMts.map(x => x[0] + ' ' + x[1].toFixed(1) + 'km').join('、') : ''));

  /* 画的四处湖都能对上一个同名景区 */
  const lakePairs = [['阅海', 'yh'], ['鸣翠湖', 'mch'], ['宋澄湖', 'sch'], ['长流水', 'cls']];
  const badLake = [];
  lakePairs.forEach(p => {
    const ring = BM.lakes.filter(l => l.name === p[0])[0];
    const spot = ALL.filter(a => a.id === p[1])[0];
    if (!ring || !spot) { badLake.push(p[0] + ' 缺数据'); return; }
    const d = ringKm([spot.lng, spot.lat], ring.ring);
    if (d > 3) badLake.push(p[0] + ' ' + d.toFixed(1) + 'km');
  });
  ok('四处湖景就落在同名湖面上（3 km 内）', badLake.length === 0, badLake.join('、') || '阅海 / 鸣翠湖 / 宋澄湖 / 长流水');

  /* 所有底图坐标都落在银川视域，且数据不缺 */
  const pts = [];
  BM.ridges.forEach(r => r.line.forEach(p => pts.push(p)));
  BM.rivers.forEach(r => r.line.forEach(p => pts.push(p)));
  BM.lakes.forEach(l => l.ring.forEach(p => pts.push(p)));
  BM.urbanAreas.forEach(u => u.ring.forEach(p => pts.push(p)));
  BM.places.forEach(p => pts.push([p.lng, p.lat]));
  const outside = pts.filter(p => p[0] < 105.7 || p[0] > 106.8 || p[1] < 37.75 || p[1] > 38.95);
  ok('底图坐标全部落在银川市域视域内', outside.length === 0,
    pts.length + ' 个控制点' + (outside.length ? '，越界 ' + outside.length + ' 个' : ''));

  ok('折线要素点数足够（≥5）',
    BM.ridges.every(r => r.line.length >= 5) && BM.rivers.every(r => r.line.length >= 5),
    '山脊 ' + BM.ridges[0].line.length + ' 点 / 黄河 ' + BM.rivers[0].line.length + ' 点');
  ok('湖泊多为闭合多边形（≥4 点）', BM.lakes.every(l => l.ring.length >= 4),
    BM.lakes.length + ' 处湖');
  ok('未绘制任何行政区域界线', BM.ridges.length + BM.rivers.length > 0 &&
    !Object.keys(BM).some(k => /boundar|border|admin/i.test(k)),
    '底图字段：' + Object.keys(BM).join(', '));
}

/* =========================================================================
 * 三、渲染输出
 * ======================================================================= */
head('三、渲染输出：确定性、零外部依赖、点位不越界');

const MAIN = build({ days: 3, prefs: ['自然风光', '人文历史'], pace: 'normal', scope: 'with' });
{
  const m1 = draw(MAIN);
  const m2 = draw(MAIN);
  ok('同一份行程渲染两次逐字节相同', m1.svg === m2.svg,
    Buffer.byteLength(m1.svg, 'utf8') + ' 字节');

  ok('SVG 不含 http(s) 引用', !/https?:\/\//i.test(m1.svg), '断网与 file:// 下表现一致');
  ok('SVG 不含 <image> / base64 / 外部 url()',
    !/<image/i.test(m1.svg) && !/base64/i.test(m1.svg) && !/url\(\s*['"]?(?!#)/i.test(m1.svg),
    '只有内联 path / circle / text');
  ok('引用只指向自己的 clipPath', (m1.svg.match(/url\([^)]*\)/g) || []).every(u => /^url\(#mvClip\)$/.test(u)),
    (m1.svg.match(/url\([^)]*\)/g) || []).join(' '));

  ok('节点数等于行程点位总数', m1.stops.length === MAIN.built.reduce(
    (n, b) => n + b.d.items.length + (b.tl.nightOn ? 1 : 0), 0),
    m1.stops.length + ' 个节点');
  ok('每个节点的 data-spot 都能对回景点 id',
    m1.stops.every(s => s.id && ALL.concat(PACKS.yinchuan.eateries || [], PACKS.nearby.eateries || [])
      .some(a => a.id === s.id)),
    '含夜游点位：' + m1.stops.filter(s => !/^e-/.test(s.id)).length + ' 个景区');

  /* 绘制坐标必须在画布内（错开与 clamp 之后） */
  const out = m1.stops.filter(s => s.x < 0 || s.x > m1.width || s.y < 0 || s.y > m1.height);
  ok('所有节点都在画布内', out.length === 0,
    out.length ? out.map(s => s.name + ' @' + Math.round(s.x) + ',' + Math.round(s.y)).join('、')
               : '画布 ' + m1.width + '×' + m1.height);

  /* 真实投影点必须落在视框内（视框是给「内容」留的，不是给错开后的点留的）。
     容差 1e-9：极值点（最北/最南那一处）恰好压在框边上，浮点求和会差最后一位。 */
  const kx = Math.cos(BM.refLat * Math.PI / 180);
  const EPS = 1e-9;
  const offBox = m1.stops.filter(s => {
    const px = s.lng * kx, py = -s.lat;
    return px < m1.box.x0 - EPS || px > m1.box.x0 + m1.box.w + EPS ||
           py < m1.box.y0 - EPS || py > m1.box.y0 + m1.box.h + EPS;
  });
  ok('所有点位的真实坐标都被视框围住', offBox.length === 0,
    offBox.length ? offBox.map(s => s.name).join('、') : '视框 ' + m1.box.w.toFixed(3) + '×' + m1.box.h.toFixed(3) + ' 等效度');

  /* 错开幅度有上限（否则就成「位置随便放」了） */
  const worst = m1.stops.map(s => Math.hypot(s.x - s.rx, s.y - s.ry)).sort((a, b) => b - a)[0];
  ok('密集点位错开幅度不超过 18 px', worst <= 18, '最大偏移 ' + worst.toFixed(1) + ' px');

  /* 错开后不应还有两个点粘在一起 */
  let minGap = Infinity;
  for (let i = 0; i < m1.stops.length; i++) {
    for (let j = i + 1; j < m1.stops.length; j++) {
      const a = m1.stops[i], b = m1.stops[j];
      minGap = Math.min(minGap, Math.hypot(a.x - b.x, a.y - b.y));
    }
  }
  ok('任意两个节点的绘制位置不重叠（≥11 px）', minGap >= 11, '最近两点 ' + minGap.toFixed(1) + ' px');
}

/* =========================================================================
 * 四、交互状态
 * ======================================================================= */
head('四、交互状态：单看某天');

{
  const allSvg = draw(MAIN).svg;
  const d0 = MV.render({ basemap: BM, built: MAIN.built, city: MAIN.city, base: MAIN.city.base, width: 880, activeDay: 0 });
  const onlyDay1 = /data-day="1"/.test(d0.svg) === false && /data-day="2"/.test(d0.svg) === false;
  ok('单看第 1 天时，其余天的节点与连线都不画', onlyDay1,
    '节点数与图例另外核对');

  const n0 = (d0.svg.match(/class="mv-stop"/g) || []).length;
  const nAll = (allSvg.match(/class="mv-stop"/g) || []).length;
  ok('单天视图的节点数等于该天站数', n0 === MAIN.built[0].d.items.length + (MAIN.built[0].tl.nightOn ? 1 : 0),
    '单天 ' + n0 + ' 个 / 全部 ' + nAll + ' 个');
  ok('单天视图视野不大于全部视图', d0.box.w <= draw(MAIN).box.w + 1e-9 && d0.box.h <= draw(MAIN).box.h + 1e-9,
    d0.box.w.toFixed(3) + ' vs ' + draw(MAIN).box.w.toFixed(3));

  ok('图例天数与行程天数一致',
    (draw(MAIN).legend.match(/data-day="/g) || []).length === MAIN.built.length,
    MAIN.built.length + ' 天');
  ok('8 天内每天配色不重复', new Set(MV.DAY_COLORS.slice(0, 8)).size === 8,
    MV.DAY_COLORS.slice(0, 8).join(' '));
}

/* =========================================================================
 * 五、边界情形
 * ======================================================================= */
head('五、边界情形');

{
  /* 空行程：排不出来时不应抛错，也不该画出一张假图 */
  const empty = MV.render({ basemap: BM, built: [], city: { districts: {} }, base: null, width: 880 });
  ok('空行程不抛错、返回空图例', typeof empty.svg === 'string' && empty.svg.indexOf('<svg') === 0 && empty.legend === '',
    Buffer.byteLength(empty.svg, 'utf8') + ' 字节，只有底图');

  /* 单日行程 */
  const one = build({ days: 1, prefs: ['自然风光'], pace: 'relax', scope: 'city' });
  const m1 = draw(one);
  ok('单日行程能正常渲染', m1.stops.length > 0 && /class="mv-stop"/.test(m1.svg),
    m1.stops.length + ' 站，画布 ' + m1.width + '×' + m1.height);

  /* 八天满配：节点最多、最容易挤爆 */
  const eight = build({ days: 8, prefs: ['自然风光', '人文历史', '亲子友好', '美食体验', '摄影出片', '科普研学'], pace: 'tight', scope: 'with' });
  const m8 = draw(eight);
  const out8 = m8.stops.filter(s => s.x < 0 || s.x > m8.width || s.y < 0 || s.y > m8.height);
  ok('8 天满配行程的点也不越界', out8.length === 0,
    m8.stops.length + ' 站，画布 ' + m8.width + '×' + m8.height);
  ok('8 天时高度夹在上限内', m8.height <= 540 && m8.height >= 400, 'H = ' + m8.height);

  /* 窄屏：手机宽度不应把高度撑到整屏 */
  const narrow = MV.render({ basemap: BM, built: MAIN.built, city: MAIN.city, base: MAIN.city.base, width: 300 });
  ok('窄屏（300 px）仍取到合理高度', narrow.height >= 400 && narrow.height <= 540,
    narrow.width + '×' + narrow.height + '（比例 ' + (narrow.width / narrow.height).toFixed(2) + '）');

  /* 单点行程：只有一个景点时视框不能塌成一个点 */
  const oneSpot = { d: { district: '兴庆区', items: [{ a: ALL[0] }] }, tl: { ev: [], nightOn: null } };
  const ms = MV.render({ basemap: BM, built: [oneSpot], city: MAIN.city, base: null, width: 880 });
  ok('只有一个点时不塌缩（靠最小跨度兜底）', ms.box.h >= MV.MIN_SPAN_LAT - 1e-9 && isFinite(ms.scale),
    'h = ' + ms.box.h.toFixed(3) + '，最小 ' + MV.MIN_SPAN_LAT);
}

/* =========================================================================
 * 六、渲染只读
 * ======================================================================= */
head('六、渲染只读：不改动引擎输出与底图数据');

{
  const before = JSON.stringify(MAIN.built);
  const bmBefore = JSON.stringify(BM);
  draw(MAIN);
  MV.render({ basemap: BM, built: MAIN.built, city: MAIN.city, base: MAIN.city.base, width: 880, activeDay: 0 });
  ok('渲染不修改 built（时间轴与点位原样）', JSON.stringify(MAIN.built) === before);
  ok('渲染不修改底图数据', JSON.stringify(BM) === bmBefore);

  /* 顺序无关：把 built 顺序打乱再渲染，图例天的内容跟着走，但不报错 */
  const rev = MAIN.built.slice().reverse();
  const mr = MV.render({ basemap: BM, built: rev, city: MAIN.city, base: MAIN.city.base, width: 880 });
  ok('built 顺序变化不会崩溃', mr.stops.length === MAIN.built.reduce((n, b) => n + b.d.items.length + (b.tl.nightOn ? 1 : 0), 0),
    mr.stops.length + ' 个节点');
}

/* =========================================================================
 * 七、注记层：地标 / 区域名 / 比例尺 / 指北针
 * ======================================================================= */
head('七、注记层：地标不重复景点、比例尺自洽');

{
  const lms = BM.landmarks || [];
  const spotNames = new Set(ALL.map(a => a.name));
  const placeNames = new Set((BM.places || []).map(p => p.name));

  ok('地标数量在 2–8 之间（少了没有参照，多了变噪声）',
    lms.length >= 2 && lms.length <= 8, lms.length + ' 个');

  const badCoord = lms.filter(l => !(l.lng > 105.5 && l.lng < 107 && l.lat > 37.7 && l.lat < 39.1));
  ok('地标坐标落在银川市域内（防小数写错一位）', badCoord.length === 0,
    badCoord.map(l => l.name).join('、') || '全部合法');

  /* 硬规则：地标一旦与景点同名，同一个地方会被标两遍（行程节点一次、
     底图一次），读图的人会以为是两个地点。这条拦住将来加数据时的撞车。 */
  const dupSpot = lms.filter(l => spotNames.has(l.name));
  ok('地标不与景点重名', dupSpot.length === 0, dupSpot.map(l => l.name).join('、') || '无重复');

  const dupPlace = lms.filter(l => placeNames.has(l.name));
  ok('地标不与地名点重名', dupPlace.length === 0, dupPlace.map(l => l.name).join('、') || '无重复');

  const KNOWN = ['city', 'rail', 'air', 'peak', 'nature'];
  const badKind = lms.filter(l => KNOWN.indexOf(l.kind) < 0);
  ok('地标类型都在已知枚举内', badKind.length === 0, badKind.map(l => l.name).join('、') || '合法');

  const rgs = BM.regions || [];
  ok('区域名坐标合法', rgs.every(r => isFinite(r.lng) && isFinite(r.lat)), rgs.length + ' 个');

  /* 比例尺必须与 scale 自洽：图上写着「10 km」、量出来却是 14 km，
     比不画比例尺更糟 —— 它是在主动提供错误信息。 */
  const m = draw(MAIN);
  const pxPerKm = m.scale / K_LAT;
  const sb = m.scaleBar;
  ok('比例尺存在且取整数公里', !!sb && sb.km > 0, sb ? sb.km + ' km' : '缺失');
  ok('比例尺像素长度与 scale 自洽', Math.abs(sb.km * pxPerKm - sb.px) < 0.6,
    '标 ' + sb.km + ' km → 应 ' + (sb.km * pxPerKm).toFixed(1) + ' px，实 ' + sb.px.toFixed(1) + ' px');
  ok('比例尺长度落在可读区间（56–150 px）', sb.px >= 56 && sb.px <= 150, sb.px.toFixed(1) + ' px');

  ok('输出含指北针', m.svg.indexOf('mv-north') >= 0);
  ok('输出含比例尺刻度文字', m.svg.indexOf('mv-scaletxt') >= 0);
  ok('输出含山河名（贺兰山 / 黄河）', m.svg.indexOf('mv-rlabel') >= 0);

  /* 单天视图也不能丢这两样：视野收紧后比例尺会变，但必须仍在可读区间 */
  const m1 = draw(Object.assign({}, MAIN, { activeDay: 0 }));
  ok('单天视图仍带比例尺与指北针',
    m1.scaleBar.px >= 56 && m1.svg.indexOf('mv-north') >= 0,
    m1.scaleBar.km + ' km / ' + m1.scaleBar.px.toFixed(1) + ' px');
}


/* =========================================================================
 * 八、连线行程信息：多远 · 各方式多久
 *   这一组锁的是「卡片上的数」与「行程表里的数」是同一份口径 ——
 *   两处各算一套、于是图上写 12 分、时间轴写 15 分，是最容易发生也最难发现的事故。
 * ======================================================================= */
head('八、连线行程信息：距离与各方式耗时');

{
  const L = Engine.LEG;
  const m = draw(MAIN);
  const legs = m.legs;

  const byId = {};
  ALL.forEach(a => { byId[a.id] = a; });
  const base = MAIN.city.base || {};
  if (base.id) byId[base.id] = base;

  ok('每条连线都带行程信息', legs.length > 0 && legs.every(l => l.items && l.items.length > 0),
    legs.length + ' 段');
  /* 段数 = 站点数 + 天数：每站一段「怎么到这站」，每天再各多一段「末站怎么回驻点」。
     少了回程那一笔，图上每天都是一条张开的线头（见第十节）。 */
  ok('段数 = 站点数 + 天数（每天多一段回程）', legs.length === m.stops.length + MAIN.built.length,
    legs.length + ' 段 / ' + m.stops.length + ' 站 + ' + MAIN.built.length + ' 天');

  /* 端点必须能在真实数据里找到，否则卡片上的「从哪到哪」会是空字符串 */
  const miss = legs.filter(l => !byId[l.fromId] || !byId[l.toId]);
  ok('每段两端都能追溯到真实点位（含驻点与夜游点）', miss.length === 0,
    miss.length ? miss.map(l => l.fromId + '→' + l.toId).join('、') : '对位正常');

  const badKm = legs.filter(l =>
    Math.abs(l.km - Engine.haversineKm(byId[l.fromId], byId[l.toId])) > 0.06);
  ok('直线距离与 haversine 一致（±0.06 km，四舍五入到 0.1）', badKm.length === 0,
    '最长一段 ' + Math.max.apply(null, legs.map(l => l.km)).toFixed(1) + ' km');

  const badRoad = legs.filter(l => Math.abs(l.roadKm - l.km * Engine.ROAD_FACTOR) > 0.2);
  ok('路网里程 = 直线 × 路网系数 ' + Engine.ROAD_FACTOR, badRoad.length === 0);

  /* 关键一致性：卡片上的「车程 N 分」必须等于时间轴里那一行 */
  let maxDrift = 0;
  const drift = legs.filter(l => {
    const d = l.items.filter(x => x.k === 'drive')[0];
    if (!d) return true;
    const diff = Math.abs(d.driveMin - Engine.driveMin(byId[l.fromId], byId[l.toId]));
    if (diff > maxDrift) maxDrift = diff;
    return diff !== 0;
  });
  ok('自驾纯车程与 Engine.driveMin 完全一致（图上与行程表同源）', drift.length === 0,
    '最大偏差 ' + maxDrift + ' 分');

  /* 各方式的耗时公式与适用区间 —— 用常量表达，改参数不会误报，改公式一定报。
     注意：判据用**未取整**的原始距离，不能用卡片上那两位小数 ——
     否则量的是「显示值」而不是「算出来的值」，误差会被四舍五入藏起来。 */
  const pick = (l, k) => l.items.filter(x => x.k === k)[0];
  const raw = l => Engine.haversineKm(byId[l.fromId], byId[l.toId]);

  const badWalk = legs.filter(l => {
    const it = pick(l, 'walk'), km0 = raw(l);
    if (km0 > L.WALK_MAX_KM) return !!it;
    return !it || it.min !== Math.round(km0 / L.WALK_KPH * 60);
  });
  ok('步行：只在 ' + L.WALK_MAX_KM + ' km 内出现，耗时 = 距离 ÷ ' + L.WALK_KPH + ' km/h',
    badWalk.length === 0);

  const badBike = legs.filter(l => {
    const it = pick(l, 'bike'), km0 = raw(l);
    if (km0 > L.BIKE_MAX_KM) return !!it;
    return !it || it.min !== L.BIKE_FETCH + Math.round(km0 * 1.15 / L.BIKE_KPH * 60);
  });
  ok('骑行：只在 ' + L.BIKE_MAX_KM + ' km 内出现，含取还车 ' + L.BIKE_FETCH + ' 分', badBike.length === 0);

  const badBus = legs.filter(l => {
    const it = pick(l, 'transit'), road0 = raw(l) * Engine.ROAD_FACTOR;
    const inRange = road0 >= L.TRANSIT_MIN_ROAD_KM && road0 <= L.TRANSIT_MAX_ROAD_KM;
    if (!inRange) return !!it;
    return !it || it.min !== L.TRANSIT_WAIT + Math.round(road0 / L.TRANSIT_KPH * 60);
  });
  ok('公交：只在路网 ' + L.TRANSIT_MIN_ROAD_KM + '–' + L.TRANSIT_MAX_ROAD_KM + ' km 内出现（太近等车比走路久）',
    badBus.length === 0);

  const badPark = legs.filter(l => {
    const it = pick(l, 'drive');
    const park = it.min - it.driveMin;
    return park !== (l.items.length && byId[l.fromId].urban === true && byId[l.toId].urban === true
      ? L.PARK_URBAN : L.PARK_OTHER);
  });
  ok('自驾耗时 = 车程 + 停车（市区 ' + L.PARK_URBAN + ' / 其他 ' + L.PARK_OTHER + ' 分）', badPark.length === 0);

  ok('每一步都带口径说明（卡片靠它解释构成）',
    legs.every(l => l.items.every(it => it.note && it.note.length > 3)));

  const unsorted = legs.filter(l => l.items.some((x, i) => i > 0 && x.min < l.items[i - 1].min));
  ok('各方式按耗时升序', unsorted.length === 0);

  const badBest = legs.filter(l => l.best !== l.items[0].k || l.bestMin !== l.items[0].min);
  ok('推荐 = 耗时最短的那一种', badBest.length === 0,
    '多数段推荐自驾，市区近距离段推荐步行（' +
      legs.filter(l => l.best !== 'drive').map(l => l.best).join('、') + '）');

  /* 交集处的取舍：400 m 内骑行要取还车，反而不如走过去 —— 这条规则也得锁住 */
  const near = { id: 'x', name: '甲', lng: 106.2810, lat: 38.4700, urban: true, roadKph: 58 };
  const near2 = { id: 'y', name: '乙', lng: 106.2772, lat: 38.4680, urban: true, roadKph: 58 };
  const nm = Engine.legModes(near, near2);
  ok('400 m 内推荐步行（取还车比走路还久）', nm.best === 'walk', nm.km + ' km → ' + nm.best);

  /* 远距离不该出现公交：银川公交覆盖不到 25 km 外的景区，列出来等于误导 */
  const far = { id: 'z', name: '丙', lng: 106.3650, lat: 38.8200, urban: false, roadKph: 58 };
  const fm = Engine.legModes(near, far);
  ok('超远段不列公交（路网 ' + fm.roadKm + ' km）', !fm.items.some(x => x.k === 'transit'),
    fm.items.map(x => x.name + ' ' + x.min).join(' / '));

  /* 命中区：1.8 px 的弧线点不中，必须有透明的粗路径接事件 */
  const hitIdx = [];
  const re = /class="mv-leg-hit" data-leg="(\d+)"/g;
  let mm;
  while ((mm = re.exec(m.svg))) hitIdx.push(+mm[1]);
  ok('每条连线都有一条透明命中路径', hitIdx.length === legs.length, hitIdx.length + ' 条');
  ok('命中路径下标与 legs 一一对位', hitIdx.every((v, i) => v === i));
  ok('命中路径是透明粗描边（不遮图，只接鼠标）',
    /class="mv-leg-hit"[^>]*stroke="transparent" stroke-width="15"/.test(m.svg));

  const m2 = draw(MAIN);
  ok('连线数据两次渲染逐字节一致（含各项耗时）',
    JSON.stringify(m.legs) === JSON.stringify(m2.legs));

  /* stops 里仍保留全部天（视框要按它算），只有连线和节点按 activeDay 过滤 */
  const m1 = draw(Object.assign({}, MAIN, { activeDay: 2 }));
  const day2 = m1.stops.filter(s => s.day === 2).length;
  ok('单天视图只给那一天出连线', m1.legs.length > 0 && m1.legs.every(l => l.day === 2),
    m1.legs.length + ' 段');
  ok('单天视图段数 = 当天站点数 + 1（仍要画回程）', m1.legs.length === day2 + 1,
    m1.legs.length + ' 段 / ' + day2 + ' 站');
}

/* =========================================================================
 * 九、出发位置的标注
 * 图上必须写清「从哪儿出发」：三天的虚线都汇到一个点，不标就成了一个
 * 没人认识的圆点。文字由调用方给 —— 做计划时是「行程起点」，
 * 已经在路上时是「当前位置」，地图本身不懂这个语义。
 * ======================================================================= */
head('九、出发位置的标注');

{
  function TW(s, size) {
    let w = 0;
    for (const ch of s) w += ch.charCodeAt(0) > 0x2e80 ? size : size * 0.55;
    return w;
  }
  const base = MAIN.city.base;
  const R = o => MV.render(Object.assign({
    basemap: BM, built: MAIN.built, city: MAIN.city, base: base,
    width: 880, legInfo: Engine.legModes
  }, o));

  const m = R({ baseLabel: '行程起点' });
  ok('画出出发位置', /class="mv-base"/.test(m.svg));
  /* 符号是「定位指针」——上圆下尖的水滴。选它而不是方块，是因为尖端能落在
     驻点的精确坐标上；颜色用赭金 #8C5B16 而非品牌蓝，是因为蓝与「贺兰山岳」类
     的 tint #185FA5 几乎同色，蓝指针会和蓝色景点圆混。这两条理由都在 map.js §10。 */
  ok('符号是定位指针（水滴形，不是景点那种彩色圆）',
    /class="mv-base"[\s\S]{0,380}?<path d="M[\d.\-]+ [\d.\-]+C[^"]*A7\.6 7\.6 0 1 1[^"]*Z" fill="#8C5B16"/.test(m.svg) &&
    !/class="mv-base"[\s\S]{0,380}?stroke-dasharray/.test(m.svg));
  const mPath = /class="mv-base"[\s\S]*?<path d="M([\d.\-]+) ([\d.\-]+)C/.exec(m.svg);
  ok('指针尖端落在驻点坐标上',
    !!mPath && Math.abs(+mPath[1] - m.base.x) < 1.5 && Math.abs(+mPath[2] - m.base.y) < 1.5,
    mPath ? '尖端 ' + mPath[1] + ',' + mPath[2] + ' / 驻点 ' +
      m.base.x.toFixed(1) + ',' + m.base.y.toFixed(1) : '未找到指针');
  const mDot = /class="mv-base"[\s\S]*?<circle cx="([\d.\-]+)" cy="([\d.\-]+)" r="2\.9" fill="#FBFAF5"/.exec(m.svg);
  ok('圆头中心有白点（定位指针的通用读法）',
    !!mDot && Math.abs(+mDot[2] - (m.base.y - 15)) < 1.5,
    mDot ? '白点 ' + mDot[1] + ',' + mDot[2] : '未找到');
  ok('指针不与景点节点同形（景点是 r=5.6 的彩色圆）',
    !/class="mv-base"[\s\S]{0,380}?<circle[^>]*r="5\.6"/.test(m.svg));
  ok('写出位置文字', /class="mv-blabel"[^>]*>行程起点</.test(m.svg));
  ok('返回值带上出发位置与文字落点', !!m.base && m.base.label === '行程起点' && !!m.base.tag,
    m.base && m.base.tag ? 'x=' + m.base.tag.x + ' y=' + m.base.tag.y + ' ' + m.base.tag.anchor : '—');
  ok('文字落在画布内',
    m.base.tag.x > 8 && m.base.tag.x < m.width - 8 &&
    m.base.tag.y > 10 && m.base.tag.y < m.height - 8,
    m.width + '×' + m.height);

  /* 文字与节点的距离：近到贴住就会被读成一个词，远到跨出半屏又对不上是谁 */
  const tw = TW('行程起点', 10.5) + 2;
  const tag = m.base.tag;
  const tcx = tag.x + (tag.anchor === 'start' ? tw / 2 : tag.anchor === 'end' ? -tw / 2 : 0);
  const tcy = tag.y - 3.6;
  const dmin = Math.min.apply(null, m.stops.map(s => Math.hypot(tcx - s.x, tcy - s.y)));
  ok('文字不会压在站点节点上', dmin > tw / 2 + 4, '最近 ' + dmin.toFixed(1) + ' px');

  ok('文字完全由调用方决定（同一份行程可写「当前位置」）',
    /class="mv-blabel"[^>]*>当前位置</.test(R({ baseLabel: '当前位置' }).svg));
  ok('不传文字时只画符号、不留空标签',
    /class="mv-base"/.test(R({}).svg) && !/mv-blabel/.test(R({}).svg));

  /* 文字落到指针上方时不能压圆顶：水滴含白描边占到锚点 -24.3 */
  const above = m.base.tag.anchor === 'middle' && m.base.tag.y < m.base.y;
  ok('文字不压指针（落到上方时退到圆顶之上）',
    !above || m.base.tag.y + 3 <= m.base.y - 24.3,
    '文字 y=' + m.base.tag.y + ' 圆顶 ' + (m.base.y - 22.6).toFixed(1));

  const none = R({ base: null });
  ok('没有驻点时不画出发位置', !/mv-base/.test(none.svg) && !/mv-blabel/.test(none.svg) && none.base === null);

  /* 驻点落在行政中心点位上时（新华街商圈 = 兴庆区中心，相距 0.55 km），
     那一点整体让位：双圈叠进方框里像多了个镜头，名字也会和位置文字叠在一起。
     判据用地面距离而不是像素 —— 同一处地方换个取景范围还是同一处。 */
  function kmBet(a, b) {
    const dx = (a.lng - b.lng) * Math.cos((a.lat + b.lat) / 2 * Math.PI / 180) * 111.32;
    const dy = (a.lat - b.lat) * 111.32;
    return Math.hypot(dx, dy);
  }
  const dup = BM.places.filter(p => kmBet(p, base) < 1);
  ok('与出发位置重合的城镇点整体让位',
    dup.length > 0 && dup.every(p => m.svg.indexOf(p.name) < 0),
    dup.map(p => p.name + ' ' + kmBet(p, base).toFixed(2) + ' km').join('、') || '无重合点');
  ok('其余地名照旧保留',
    BM.places.filter(p => dup.indexOf(p) < 0).every(p => m.svg.indexOf(p.name) >= 0));

  const d1 = R({ activeDay: 1, baseLabel: '行程起点' });
  ok('单天视图同样标出出发位置',
    /class="mv-base"/.test(d1.svg) && /mv-blabel/.test(d1.svg));

  const narrow = R({ width: 320, baseLabel: '行程起点' });
  ok('窄屏下文字仍在画布内',
    narrow.base.tag.x > 0 && narrow.base.tag.x < narrow.width,
    'x=' + narrow.base.tag.x + ' / ' + narrow.width);

  ok('两次渲染逐字节一致（标注不引入随机量）', R({ baseLabel: '行程起点' }).svg === m.svg);
}

head('十、闭环：末站回驻点');

/* 最早这张图上每天都是一条张开的线头：驻点 → 第 1 站 → … → 末站就断了，
   读者读完会问「晚上怎么回去」。排程里那段路其实一直在（Engine.timeline 末尾
   那次回程，计入当天结束时刻与累计车程），只是图上没画 —— 等于把已经算过的
   时间藏了起来。这一节锁三件事：① 每天必须有一段回程且是最后一段；
   ② 它的起点是当天真正的末站（含夜游点）、终点是驻点；
   ③ 图上那段路与时间轴里那段路同源，不许两处各算一套。 */
{
  const m = draw(MAIN);
  const base = MAIN.city.base;
  const live = MAIN.built.filter(b => b.d.items.length);
  const rets = m.legs.filter(l => l.toBase);

  ok('每个有安排的天都有一段回程', rets.length === live.length,
    rets.length + ' 段 / ' + live.length + ' 天');

  /* 回程必须是当天最后一段：夹在中间就等于「先回家再去下一站」 */
  const notLast = live.filter(b => {
    const i = b.d ? MAIN.built.indexOf(b) : -1;
    const own = m.legs.filter(l => l.day === i);
    return !own.length || !own[own.length - 1].toBase;
  });
  ok('回程是当天最后一段（不在中途插回程）', notLast.length === 0,
    notLast.length ? notLast.length + ' 天不合' : '全部收尾在末段');

  ok('回程的终点是驻点', rets.every(l => l.toId === base.id),
    rets.map(l => l.toName).join('、'));

  /* 末站可能是夜游点（tl.nightOn 不在 d.items 里，但确实是当天最后去的地方） */
  const badFrom = live.filter(b => {
    const i = MAIN.built.indexOf(b);
    const own = m.legs.filter(l => l.day === i && l.toBase)[0];
    const night = b.tl && b.tl.nightOn;
    const want = night ? night.id : b.d.items[b.d.items.length - 1].a.id;
    return !own || own.fromId !== want;
  });
  ok('回程的起点是当天真正的末站（有夜游时就是夜游点）', badFrom.length === 0,
    badFrom.length ? badFrom.length + ' 天起点不对' :
      rets.map(l => l.fromName).join('、'));

  const byId = {};
  ALL.forEach(a => { byId[a.id] = a; });
  byId[base.id] = base;
  const badKm = rets.filter(l =>
    Math.abs(l.km - Engine.haversineKm(byId[l.fromId], byId[l.toId])) > 0.06);
  ok('回程直线距离与 haversine 一致', badKm.length === 0,
    '回程共 ' + rets.reduce((s, l) => s + l.km, 0).toFixed(1) + ' km');

  /* 与时间轴同源：图上回程卡片里那个「纯车程」必须等于时间轴末尾那一段 */
  let drift = 0;
  const badDrift = live.filter(b => {
    const i = MAIN.built.indexOf(b);
    const own = m.legs.filter(l => l.day === i && l.toBase)[0];
    const ev = b.tl.ev.filter(x => x.k === 'travel' && x.ret)[0];
    if (!own || !ev) return true;
    const d = own.items.filter(x => x.k === 'drive')[0];
    if (!d) return true;
    drift = Math.max(drift, Math.abs(d.driveMin - ev.min));
    return d.driveMin !== ev.min;
  });
  ok('回程车程与时间轴末尾那段完全同源', badDrift.length === 0,
    '最大偏差 ' + drift + ' 分');

  ok('时间轴上回程带 ret 标记（界面据此写「返回」而不是「前往」）',
    live.every(b => {
      const e2 = b.tl.ev.filter(x => x.k === 'travel');
      return e2.length && e2[e2.length - 1].ret === true &&
        e2[e2.length - 1].to === base.name;
    }));

  /* 线型：出发段与回程段同为虚线 —— 一头一尾两道虚线，一天才读成一个往返，
     而不是一串单程箭头。若是实线，回程会和「站到站」混成同一种语义。 */
  const dashOf = cls => (m.svg.match(new RegExp('class="mv-leg ' + cls + '"[^>]*stroke-dasharray="([^"]+)"')) || [])[1];
  ok('回程画成虚线，且与出发段同一线型',
    dashOf('mv-leg-ret') && dashOf('mv-leg-ret') === dashOf('mv-leg-base'),
    '出发段 ' + dashOf('mv-leg-base') + ' / 回程 ' + dashOf('mv-leg-ret'));

  /* 回程也要能悬停/点击看耗时：少一条命中路径，那段线就成了死线 */
  ok('回程带透明命中路径（可查看耗时）',
    m.svg.indexOf('data-leg="' + rets[0].idx + '"') >= 0 &&
    new RegExp('class="mv-leg-hit" data-leg="' + rets[0].idx + '"').test(m.svg));

  ok('回程同样受单天视图过滤（点开某天也能看到回程）',
    draw(Object.assign({}, MAIN, { activeDay: 2 })).legs.filter(l => l.toBase).length === 1);

  /* 末站就在驻点门口（0.5 km 内）时不画回程：那不是回程，是同一天里又挪了几十米。
     判据用地面距离而不是像素 —— 与「地名让位」同一条经验，换取景范围不该换结论。 */
  const home = { id: 'nb', name: '楼下的咖啡馆', lng: base.lng + 0.001, lat: base.lat, stay: 60, ticket: 0,
    district: '兴庆区', cat: '人文历史', tags: ['测试'], open: '全天', level: '' };
  const near = MV.render({
    basemap: BM, city: MAIN.city, base: base, width: 880, legInfo: Engine.legModes,
    built: [{ d: { items: [{ a: home }], district: '兴庆区' }, tl: { ev: [], nightOn: null } }]
  });
  ok('末站就在驻点 0.5 km 内时不画回程', near.legs.filter(l => l.toBase).length === 0,
    near.legs.length + ' 段（只余出发段）');
}

console.log('\n' + (fail === 0 ? '全部通过（' + pass + ' 项）' : fail + ' 项未通过：' + pass + ' 通过 / ' + fail + ' 失败'));
process.exit(fail === 0 ? 0 : 1);

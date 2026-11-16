/* =============================================================================
 * 景点攻略卡验证 · 文旅导览智能体
 *
 * 结果页点景点名会打开一张「游玩攻略」，内容由 Engine.spotGuide(city, spot, ctx)
 * 现算。这个脚本回答四个问题：
 *   ① 数据包里每一处景点是否都能生成一张不残缺的攻略卡（无 undefined / NaN）
 *   ② 提示语是否真的读懂了数据（闭馆日、停止入园、需预约、季节备注、夜游…）
 *   ③ 「同片区顺路」「就近用餐」的推荐是否按车程排、是否真的更靠近
 *   ④ 引擎侧是否仍然纯粹：同输入两次逐字节一致，且不读时间、不读随机数
 *
 * 运行：node test/spot-guide.js   （在任意目录下均可，路径按 __dirname 解析）
 * ========================================================================== */
const fs = require('fs');
global.window = global;
['data/yinchuan.js', 'data/nearby.js', 'data/lodging.js', 'js/engine.js']
  .forEach(f => eval(fs.readFileSync(__dirname + '/../' + f, 'utf8')));

const E = global.Engine, LOD = global.CITY_DATA.lodging.lodgings;
const ALL_PREFS = ['人文历史', '自然风光', '摄影出片', '亲子友好', '美食体验', '酒庄品鉴', '科普研学', '红色研学', '轻松休闲'];
const city = E.buildCity(['yinchuan', 'nearby']);
const pick = id => E.toBase(LOD.filter(x => x.id === id)[0], city);
const find = n => city.attractions.filter(a => a.name.indexOf(n) >= 0)[0];

let pass = 0, fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + n + (x ? '   → ' + x : '')); c ? pass++ : fail++; };

/* 界面在打开攻略时会传的上下文：全行程已排点位 + 这一站的实际安排 */
function ctxOf(plan, di, evIdx) {
  const b = plan.built[di], ev = b.tl.ev[evIdx], a = ev.a;
  const inPlanIds = {};
  plan.built.forEach(x => {
    x.d.items.forEach(it => { inPlanIds[it.a.id] = true; });
    if (x.tl.nightOn) inPlanIds[x.tl.nightOn.id] = true;
  });
  const visits = b.tl.ev.filter(x => x.k === 'visit');
  return {
    inPlanIds: inPlanIds,
    trimmed: ev.stay != null && a.stay != null && ev.stay < a.stay,
    visited: false,
    visit: {
      day: di + 1, dayCount: plan.built.length,
      stop: visits.indexOf(ev) + 1, stops: visits.length,
      from: ev.from, to: ev.to, stay: ev.to - ev.from, planned: a.stay,
      evening: !!ev.evening, district: b.d.district
    }
  };
}

/* ================= 1. 覆盖：每一处景点都能出一张完整的卡 ================= */
console.log('=== 1. 数据包 ' + city.attractions.length + ' 处景点逐点生成 ===');
const guides = city.attractions.map(a => E.spotGuide(city, a, {}));
ok('全部景点都返回了攻略对象', guides.every(g => g && g.name), guides.length + ' / ' + city.attractions.length);

const BROKEN = [];
guides.forEach(g => {
  const s = JSON.stringify(g);
  if (/undefined/.test(s)) BROKEN.push(g.name + '：undefined');
  if (/NaN/.test(s)) BROKEN.push(g.name + '：NaN');
  if (!g.bg || !g.bg.length) BROKEN.push(g.name + '：缺背景');
  if (!g.points.length) BROKEN.push(g.name + '：缺看点');
  if (!g.tips.length) BROKEN.push(g.name + '：缺出行提示');
  if (!g.facts.length) BROKEN.push(g.name + '：缺关键信息');
});
ok('卡片内容无 undefined / NaN，且各段落非空', BROKEN.length === 0,
  BROKEN.length ? BROKEN.join('；') : '45 处全部完整');

const hlLoss = guides.filter(g => {
  /* 拆分只应去掉分隔符与句末标点，正文一个字都不能少 */
  const strip = s => String(s).replace(/[、；;。，,\s]/g, '');
  return strip((find(g.name) || {}).hl) !== strip(g.points.join(''));
});
ok('「看点」按顿号拆分后不丢字', hlLoss.length === 0,
  hlLoss.length ? hlLoss.map(g => g.name).join('；') : '45 处逐字一致');

ok('坐标随数据包标注为 GCJ-02', city.coordSystem === 'GCJ-02' && guides[0].facts.some(f => /GCJ-02/.test(f[1])));

/* 品类是「数据包给、引擎原样带出来」的字段：界面靠它取题图与配色，
   所以引擎这一层只要保证不漏、不改写即可（品类本身合不合法见 test/cat-visuals.js） */
const catBad = guides.filter((g, i) => g.cat !== city.attractions[i].cat || !g.cat);
ok('每张卡都原样带出数据包的 cat（引擎不认识它是什么意思，只负责传）',
  catBad.length === 0, catBad.map(g => g.name).join('、') || guides.length + ' 处全部带出');

/* ================= 2. 提示语是否读懂了数据 ================= */
console.log('\n=== 2. 出行提示由 open 字段推导 ===');
function tipOf(name, re) { return E.spotGuide(city, find(name), {}).tips.filter(t => re.test(t)).join(' | '); }

const closed = city.attractions.filter(a => E.parseOpen(a.open).closedWeekdays.length);
ok('闭馆日景点都会提示避开该星期（' + closed.length + ' 处）',
  closed.every(a => {
    const o = E.parseOpen(a.open);
    const day = '周' + '一二三四五六日'.charAt(o.closedWeekdays[0] === 0 ? 6 : o.closedWeekdays[0] - 1);
    return E.spotGuide(city, a, {}).tips.some(t => t.indexOf(day + '闭馆') >= 0);
  }),
  closed.length ? closed[0].name + ' → ' + tipOf(closed[0].name, /闭馆/) : '无');

const lastEntry = city.attractions.filter(a => E.parseOpen(a.open).lastEntry != null);
ok('写了「停止入园」的景点都会提示最晚抵达时刻（' + lastEntry.length + ' 处）',
  lastEntry.every(a => E.spotGuide(city, a, {}).tips.some(t => /停止入园/.test(t))),
  lastEntry.length ? E.fmtHM(E.parseOpen(lastEntry[0].open).lastEntry) : '无');

const reserve = city.attractions.filter(a => E.parseOpen(a.open).needReserve);
ok('写了「需预约」的景点都会提示提前预约（' + reserve.length + ' 处）',
  reserve.every(a => E.spotGuide(city, a, {}).tips.some(t => /预约/.test(t))),
  reserve.map(a => a.name).join('、') || '无');

const noted = city.attractions.filter(a => E.parseOpen(a.open).note);
ok('括号里的备注（花期/夏季等）会原样带出（' + noted.length + ' 处）',
  noted.every(a => {
    const n = E.parseOpen(a.open).note;
    return E.spotGuide(city, a, {}).tips.some(t => t.indexOf(n) >= 0);
  }),
  noted.length ? noted[0].name + ' → ' + E.parseOpen(noted[0].open).note : '无');

const nights = city.attractions.filter(a => a.slot === 'night');
ok('夜游点位标为「以夜间体验为主」（' + nights.length + ' 处）',
  nights.every(a => E.spotGuide(city, a, {}).slotText === '以夜间体验为主'),
  nights.map(a => a.name).join('、'));

const frees = city.attractions.filter(a => !a.ticket);
ok('免费景点在关键信息里写「免费」而非 ¥0（' + frees.length + ' 处）',
  frees.every(a => E.spotGuide(city, a, {}).facts[0][1] === '免费'),
  frees.map(a => a.name).join('、') || '无');

const heavy = city.attractions.filter(a => a.stay >= 150);
ok('大体量点位会提示「当天不宜再排第二个同等体量」',
  heavy.every(a => E.spotGuide(city, a, {}).tips.some(t => /同等体量/.test(t))),
  heavy.length + ' 处');

/* 17:00-24:00 会被解析成 end = 1440（整天分钟数），必须写成「次日 00:00」，
   否则倒排时间会被读成「当天零点前要离园」，行程直接作废 */
const cross = city.attractions.filter(a => E.parseOpen(a.open).end >= 24 * 60);
ok('跨零点的开放时间写成「次日 xx:xx」（' + cross.length + ' 处）',
  cross.every(a => E.spotGuide(city, a, {}).tips.some(t => /次日/.test(t))),
  cross.map(a => a.name + ' · ' + a.open).join('、') || '无');

/* ================= 3. 顺路推荐与就近用餐 ================= */
console.log('\n=== 3. 同片区顺路 / 就近用餐 ===');
const nearBad = [], sameBad = [], eatBad = [], eatSameBad = [];
city.attractions.forEach(a => {
  const g = E.spotGuide(city, a, {});
  if (g.nearby.length > 3) nearBad.push(a.name + '：超过 3 条');
  g.nearby.forEach(n => {
    if (n.min <= 0 || n.min > E.GUIDE_NEAR_RELAX) nearBad.push(a.name + ' → ' + n.name + '：' + n.min + ' 分');
    if (n.name === a.name) nearBad.push(a.name + '：推荐了自己');
  });
  // 只要存在「同区县且 45 分钟内」的点，第一条就必须是同片区的
  const closer = city.attractions.filter(x =>
    x.id !== a.id && x.district === a.district && E.driveMin(a, x) <= 45);
  if (closer.length && g.nearby.length && !g.nearby[0].same) {
    sameBad.push(a.name + ' 首选了外区县：' + g.nearby[0].name);
  }
  if (g.eats.length > 3) eatBad.push(a.name + '：超过 3 家');
  const eatSame = city.eats.filter(e => e.district === a.district);
  if (eatSame.length && g.eats.length && !g.eats[0].same) {
    eatSameBad.push(a.name + '（' + a.district + '）首选了 ' + g.eats[0].district);
  }
});
ok('顺路推荐的条数、车程区间、去重都合理', nearBad.length === 0, nearBad.slice(0, 3).join('；') || '45 处全部合格');
ok('有同片区候选时，顺路推荐第一条必为同片区', sameBad.length === 0, sameBad.slice(0, 3).join('；') || '全部通过');
ok('就近用餐不超过 3 家', eatBad.length === 0, eatBad.slice(0, 3).join('；') || '全部通过');
ok('有同片区餐点时，就近用餐第一条必为同片区', eatSameBad.length === 0, eatSameBad.slice(0, 3).join('；') || '全部通过');

/* 夜市、美食街本身就是吃饭的地方，不能被推荐给自己当「就近用餐」 */
const selfEat = city.attractions.filter(a => city.eats.some(e => e.name === a.name));
ok('本身就是餐饮场所的点位不会把自己列进「就近用餐」（' + selfEat.length + ' 处）',
  selfEat.every(a => E.spotGuide(city, a, {}).eats.every(e => e.name !== a.name)),
  selfEat.length ? selfEat.map(a => a.name).join('、') + ' → ' +
    E.spotGuide(city, selfEat[0], {}).eats.map(e => e.name).join('、') : '无');

/* 车程必须真的随距离单调：把某点的推荐按车程升序检查一遍 */
const resort = find('西夏陵');
const rg = E.spotGuide(city, resort, {});
ok('顺路推荐按车程升序（同片区内部）', rg.nearby.every((n, i) =>
  i === 0 || (rg.nearby[i - 1].same !== n.same) || rg.nearby[i - 1].min <= n.min),
  rg.nearby.map(n => n.name + ' ' + n.min + '分' + (n.same ? '(同片区)' : '')).join(' / '));

ok('顺路推荐不与本点重复，且都给了车程分钟数',
  rg.nearby.every(n => n.name !== resort.name && typeof n.min === 'number' && n.min > 0),
  '西夏陵 → ' + rg.nearby.map(n => n.name).join('、'));

/* ================= 4. 与排程结果对齐 ================= */
console.log('\n=== 4. 与时间轴对齐（界面传入的行程上下文）===');
const plan = (() => {
  const r = E.plan(city, { days: 3, prefs: ALL_PREFS, pace: 'normal', base: pick('lod-xinhua') });
  const use = r.city || city;
  return { city: use, built: r.days.map(d => ({ d: d, tl: E.timeline(use, d, r.W) })) };
})();

let visitChecked = 0, visitBad = [];
plan.built.forEach((b, di) => {
  b.tl.ev.forEach((ev, k) => {
    if (ev.k !== 'visit') return;
    visitChecked++;
    const g = E.spotGuide(plan.city, ev.a, ctxOf(plan, di, k));
    if (!g.visit) visitBad.push(ev.a.name + '：无 visit 上下文');
    else if (g.visit.stay !== ev.to - ev.from) visitBad.push(ev.a.name + '：停留 ' + g.visit.stay + ' ≠ ' + (ev.to - ev.from));
    else if (g.visit.from !== ev.from || g.visit.to !== ev.to) visitBad.push(ev.a.name + '：进出时刻不一致');
    // 提示与「是否被压缩」必须自洽
    const compressed = g.tips.some(t => /被压缩到/.test(t));
    const really = ev.stay != null && ev.a.stay != null && ev.stay < ev.a.stay;
    if (compressed !== really) visitBad.push(ev.a.name + '：压缩提示与事实不符');
  });
});
ok('排程里每一站的停留时长、进出时刻都能原样回填到攻略卡（' + visitChecked + ' 站）',
  visitBad.length === 0, visitBad.slice(0, 3).join('；') || visitChecked + ' 站全部一致');

const firstEv = plan.built[0].tl.ev.filter(e => e.k === 'visit')[0];
const fg = E.spotGuide(plan.city, firstEv.a, ctxOf(plan, 0, plan.built[0].tl.ev.indexOf(firstEv)));
ok('「从驻点过去」与引擎车程一致',
  fg.fromBase.min === E.driveMin(plan.city.base, firstEv.a),
  fg.fromBase.name + ' → ' + fg.name + '：' + fg.fromBase.min + ' 分钟 / ' + fg.fromBase.km + ' 公里');

ok('已在行程中的点位会被标出来',
  fg.nearby.some(n => n.inPlan) || plan.built.every(b => !b.d.items.some(it => it.a.district === firstEv.a.district)),
  fg.nearby.map(n => n.name + (n.inPlan ? '[已在行程]' : '')).join('、') || '（无同片区推荐）');

/* ================= 5. 引擎侧纯粹性 ================= */
console.log('\n=== 5. 纯粹性：同输入必得同一输出 ===');
const spot = find('镇北堡西部影城');
const c1 = { inPlanIds: { xxl: true }, trimmed: true, visit: { stay: 120, planned: 180 } };
const s1 = JSON.stringify(E.spotGuide(city, spot, c1));
const s2 = JSON.stringify(E.spotGuide(city, spot, c1));
ok('同一输入两次调用逐字节一致', s1 === s2, s1.length + ' 字节');

ok('换个被压缩时长 → 结果必变',
  JSON.stringify(E.spotGuide(city, spot, Object.assign({}, c1, { visit: { stay: 60, planned: 180 } }))) !== s1);
ok('标记「今天已去过」→ 结果必变',
  JSON.stringify(E.spotGuide(city, spot, Object.assign({}, c1, { visited: true }))) !== s1);
ok('传入空 ctx 也能出卡（点候选列表里未排入的点位时）',
  !!E.spotGuide(city, spot, undefined) && E.spotGuide(city, spot, undefined).visit === null);
ok('传 null/空值不抛错，返回 null',
  E.spotGuide(null, spot, {}) === null && E.spotGuide(city, null, {}) === null);

const mid = [];
E.spotGuide(city, find('西夏陵'), { inPlanIds: { yb: true } });
city.attractions.slice(0, 5).forEach(a => E.spotGuide(city, a, {}));
if (JSON.stringify(E.spotGuide(city, spot, c1)) !== s1) mid.push('中间插入其它调用后结果改变');
ok('无状态泄漏（中间插别的调用不影响结果）', mid.length === 0);

const SRC = fs.readFileSync(__dirname + '/../js/engine.js', 'utf8');
const fn = SRC.slice(SRC.indexOf('function spotGuide'), SRC.indexOf('function selfCheck'));
ok('spotGuide 不读系统时间', !/Date\.|new Date|Date\.now|performance\.now/.test(fn));
ok('spotGuide 不使用随机数', !/Math\.random/.test(fn));

/* ================= 6. 数据包字段齐备（攻略卡的原料） ================= */
console.log('\n=== 6. 攻略卡依赖的字段齐备 ===');
const LACK = [];
city.attractions.forEach(a => {
  ['id', 'name', 'district', 'lng', 'lat', 'stay', 'open', 'slot', 'tags', 'bg', 'hl'].forEach(f => {
    const v = a[f];
    if (v == null || (typeof v === 'string' && !v.length) || (Array.isArray(v) && !v.length)) {
      LACK.push(a.name + ' 缺 ' + f);
    }
  });
});
ok('45 处景点都具备生成攻略卡所需的全部字段', LACK.length === 0, LACK.slice(0, 5).join('；') || '字段齐备');

console.log('\n' + (fail === 0 ? '✓ 全部通过' : '✗ 有 ' + fail + ' 项未通过') + '（' + pass + ' 项）');
process.exit(fail ? 1 : 0);

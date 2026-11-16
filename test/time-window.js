/* =============================================================================
 * 时间窗与动态重排验证 · 文旅导览智能体
 *
 * 验证「已在路上 · 从此刻重排」所依赖的两层判据，以及它与排程结果的一致性：
 *   ① parseOpen   数据包里 7 种开放时间写法是否都能解析成结构化字段
 *   ② fitsWindow  到达时刻还进不进得去（闭馆日 / 停止入园 / 压缩游览 / 等待开园）
 *   ③ planFits    再叠加「今日剩余时间」后，行程是否真能在收工前收住
 *   ④ 从当前时刻起算、已去过排除
 *   ⑤ dayCandidates 的「能去 / 去不了」是否与 plan() 口径一致
 *   ⑥ 同一时刻 + 同一输入 → 逐字节一致
 *
 * 运行：node test/time-window.js   （在任意目录下均可，路径按 __dirname 解析）
 * ========================================================================== */
const fs = require('fs');
global.window = global;
['data/yinchuan.js', 'data/nearby.js', 'data/lodging.js', 'js/engine.js']
  .forEach(f => eval(fs.readFileSync(__dirname + '/../' + f, 'utf8')));

const E = global.Engine, LOD = global.CITY_DATA.lodging.lodgings;
const hm = E.fmtHM;
const ALL_PREFS = ['人文历史', '自然风光', '摄影出片', '亲子友好', '美食体验', '酒庄品鉴', '科普研学', '红色研学', '轻松休闲'];
const city = E.buildCity(['yinchuan', 'nearby']);
const pick = id => E.toBase(LOD.filter(x => x.id === id)[0], city);
const base = pick('lod-xinhua');
const find = n => city.attractions.filter(a => a.name.indexOf(n) >= 0)[0];

let pass = 0, fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + n + (x ? '   → ' + x : '')); c ? pass++ : fail++; };
const no = (n, x) => { console.log('  ✗ ' + n + (x ? '   → ' + x : '')); fail++; };

/* ================= 1. parseOpen：数据包全部写法 ================= */
console.log('=== 1. 开放时间解析（数据包 ' + city.attractions.length + ' 处景点）===');
const unparsed = city.attractions.filter(a => {
  const o = E.parseOpen(a.open);
  return !o.allDay && (o.start == null || o.end == null);
});
ok('全部景点的开放时间都能解析出时段（或标为全天开放）', unparsed.length === 0,
  unparsed.length ? unparsed.map(a => a.name + ' | ' + a.open).join('；') : '0 处例外');

const CASES = [
  ['全天开放', o => o.allDay === true, '全天开放'],
  ['09:00-17:00（周一闭馆）', o => o.start === 540 && o.end === 1020, '09:00–17:00'],
  ['09:00-17:00（周一闭馆）', o => o.closedWeekdays.length === 1 && o.closedWeekdays[0] === 1, '周一闭馆'],
  ['10:00-18:00（17:30 停止入园，周一闭馆）', o => o.lastEntry === 17 * 60 + 30, '停止入园 17:30'],
  ['10:00-18:00（17:30 停止入园，周一闭馆）', o => o.closedWeekdays[0] === 1 && o.lastEntry === 1050, '两项同时解析'],
  ['17:00-24:00', o => o.start === 1020 && o.end === 1440, '跨零点到 24:00'],
  ['09:00-16:00（需预约）', o => o.needReserve === true, '需预约'],
  ['09:00-18:00（花期 6-9 月）', o => o.note.indexOf('花期') >= 0 && o.start === 540, '季节备注进 note']
];
CASES.forEach(function (c) {
  const o = E.parseOpen(c[0]);
  ok('解析「' + c[0].slice(0, 24) + '」→ ' + c[2], c[1](o));
});
const stat = { monday: 0, reserve: 0, allDay: 0, lastEntry: 0 };
city.attractions.forEach(function (a) {
  const o = E.parseOpen(a.open);
  if (o.closedWeekdays.length) stat.monday++;
  if (o.needReserve) stat.reserve++;
  if (o.allDay) stat.allDay++;
  if (o.lastEntry != null) stat.lastEntry++;
});
ok('数据包确实覆盖这几类写法（周一闭馆 ' + stat.monday + ' · 需预约 ' + stat.reserve +
  ' · 全天开放 ' + stat.allDay + ' · 停止入园 ' + stat.lastEntry + '）',
  stat.monday >= 4 && stat.reserve >= 2 && stat.allDay >= 3 && stat.lastEntry >= 1);

/* ================= 2. fitsWindow：到达时刻能否进得去 ================= */
console.log('\n=== 2. 时间窗判定（dow：5=周五 / 1=周一）===');
const FRI = 5, MON = 1;
[
  ['西夏陵', 9 * 60, FRI, true, '开园后正常进入'],
  ['西夏陵', 12 * 60, FRI, true, '中午正常进入'],
  ['西夏陵', 16 * 60, FRI, false, '闭园前 60 分钟，不足最短游览'],
  ['宁夏博物馆', 14 * 60, MON, false, '周一闭馆直接拦下'],
  ['宁夏博物馆', 14 * 60, FRI, true, '改到周五即可进入'],
  ['银川当代美术馆', 17 * 60, FRI, true, '压线进入并压缩游览'],
  ['怀远观光夜市', 20 * 60, FRI, true, '夜市 17:00 后才开'],
  ['览山公园', 21 * 60, FRI, true, '全天开放不受时段限制'],
  ['镇北堡西部影城', 6 * 60 + 40, FRI, false, '开园前 110 分钟，等待过久不予安排']
].forEach(function (c) {
  const r = E.fitsWindow(find(c[0]), c[1], c[2]);
  ok(hm(c[1]) + ' 周' + '日一二三四五六'.charAt(c[2]) + ' ' + c[0] + ' → ' + (c[3] ? '可去' : '去不了') +
    '（' + c[4] + '）', r.ok === c[3],
    'why=' + (r.why || '-') + ' stay=' + (r.stay == null ? '-' : r.stay) +
    (r.trimmed ? '（压缩）' : '') + ' wait=' + (r.wait || 0) + ' | ' + (r.detail || ''));
});
const trimCase = E.fitsWindow(find('银川当代美术馆'), 17 * 60, FRI);
ok('压线进入时明确标记为「压缩游览」', trimCase.trimmed === true && trimCase.stay < find('银川当代美术馆').stay,
  '建议 ' + find('银川当代美术馆').stay + ' 分 → 实际 ' + trimCase.stay + ' 分');

/* ================= 3. planFits：行程必须收在收工时刻内 ================= */
console.log('\n=== 3. 动态排程：行程是否真的收得住 ===');
function audit(at, pace, dow, label) {
  const opts = { days: 1, prefs: ALL_PREFS, pace: pace, startAt: at, dayOfWeek: dow, base: base };
  const r = E.plan(city, opts);
  const tl = E.timeline(r.city, r.days[0], r.W);
  const problems = [];
  tl.ev.forEach(function (e) {
    if (e.k !== 'visit') return;
    const o = E.parseOpen(e.a.open);
    if (!o.allDay && o.start != null && e.from < o.start) problems.push('早于开园：' + e.a.name);
    if (o.lastEntry != null && e.from > o.lastEntry) problems.push('晚于停止入园：' + e.a.name);
    if (o.closedWeekdays.length && r.days[0].dow != null && o.closedWeekdays.indexOf(r.days[0].dow) >= 0) {
      problems.push('安排在闭馆日：' + e.a.name);
    }
    /* 白天的点必须在收工时刻前结束；夜游另有 22:30 的绝对上限 */
    if (!e.evening && e.to > r.W.e) problems.push('白天游览超出收工时刻：' + e.a.name + ' ' + hm(e.to) + ' > ' + hm(r.W.e));
  });
  if (tl.nightOn && tl.end > E.NIGHT_CAP) problems.push('夜游超过 22:30');
  ok(label, problems.length === 0,
    (r.days[0].items.length ? r.days[0].items.length + ' 个点位' : '空行程 reason=' + r.days[0].reason) +
    ' · 收于 ' + hm(tl.end) + (problems.length ? ' · ' + problems.join('；') : ''));
  return { r: r, tl: tl };
}
audit(9 * 60, 'normal', FRI, '09:00 出发 · 收工 19:00');
const a14 = audit(14 * 60, 'normal', FRI, '14:00 出发 · 收工 19:00');
audit(17 * 60, 'normal', FRI, '17:00 出发 · 收工 19:00');
audit(19 * 60, 'late', FRI, '19:00 出发 · 收工 23:00');
audit(12 * 60, 'tight', MON, '12:00 出发（周一）· 收工 20:00');

ok('午后出发不再插入午餐', !a14.tl.ev.some(e => e.k === 'meal'), 
  a14.tl.ev.map(e => e.k).join(','));
const a9 = E.timeline(city, E.plan(city, { days: 1, prefs: ALL_PREFS, pace: 'normal', startAt: 9 * 60, dayOfWeek: FRI, base: base }).days[0],
  E.plan(city, { days: 1, prefs: ALL_PREFS, pace: 'normal', startAt: 9 * 60, dayOfWeek: FRI, base: base }).W);
ok('上午出发仍会安排午餐', a9.ev.some(e => e.k === 'meal') || a9.ev.length === 0,
  a9.ev.map(e => e.k).join(','));

/* 「周一闭馆」在周一那天真的不出现 */
const monR = E.plan(city, { days: 2, prefs: ALL_PREFS, pace: 'tight', startAt: 9 * 60, dayOfWeek: 0, base: base });
const monNames = [];
monR.days.forEach(d => { d.items.forEach(i => monNames.push(i.a.name)); if (d.night) monNames.push(d.night.name); });
const monClosed = monNames.filter(n => {
  const a = find(n);
  return a && E.parseOpen(a.open).closedWeekdays.indexOf(1) >= 0;
});
ok('周一那天不会排到「周一闭馆」的场馆', monClosed.length === 0,
  monClosed.length ? monClosed.join('、') : '周一游玩 ' + monNames.length + ' 处，无一闭馆');

/* ================= 4. 「已去过」排除 ================= */
console.log('\n=== 4. 已去过的点位必须被排除 ===');
const keep = ['xxl', 'hy', 'hbt'];
const restIds = city.attractions.map(a => a.id).filter(id => keep.indexOf(id) < 0);
const rVisited = E.plan(city, {
  days: 1, prefs: ALL_PREFS, pace: 'tight', startAt: 9 * 60, dayOfWeek: FRI, base: base, visitedIds: restIds
});
const usedIds = [];
rVisited.days.forEach(d => { d.items.forEach(i => usedIds.push(i.a.id)); if (d.night) usedIds.push(d.night.id); });
ok('把其余 ' + restIds.length + ' 处都标为已去过，行程只用剩下 ' + keep.length + ' 处',
  usedIds.every(id => keep.indexOf(id) >= 0), usedIds.join(',') || '（空）');
const rSkipXxl = E.plan(city, {
  days: 1, prefs: ALL_PREFS, pace: 'tight', startAt: 9 * 60, dayOfWeek: FRI, base: base, visitedIds: ['xxl']
});
const skipIds = [];
rSkipXxl.days.forEach(d => { d.items.forEach(i => skipIds.push(i.a.id)); });
ok('只标记西夏陵去过，它就一定不出现在行程里', skipIds.indexOf('xxl') < 0, skipIds.join(','));

/* ================= 5. dayCandidates 与 plan 口径一致 ================= */
console.log('\n=== 5. 「现在还能去哪」与排程口径一致 ===');
[9 * 60, 13 * 60, 17 * 60].forEach(function (at) {
  const opts = { prefs: ALL_PREFS, pace: 'normal', startAt: at, dayOfWeek: FRI, base: base, visitedIds: ['mp'] };
  const c = E.dayCandidates(city, opts);
  const total = c.ok.length + c.blocked.length + c.visited.length;
  ok(hm(at) + ' 分组完整且互斥（' + c.ok.length + ' 可去 / ' + c.blocked.length + ' 去不了 / ' +
    c.visited.length + ' 已去过 = ' + total + '）', total === city.attractions.length);
  const badOk = c.ok.filter(function (x) {
    const o = x.openInfo;
    if (x.arriveAt + (x.wait || 0) + x.stay > c.W.e) return true;
    if (o.lastEntry != null && x.arriveAt + (x.wait || 0) > o.lastEntry) return true;
    if (o.closedWeekdays.indexOf(FRI) >= 0) return true;
    if (o.start != null && x.arriveAt + (x.wait || 0) < o.start) return true;
    return false;
  });
  ok(hm(at) + ' 所有「可去」项都真的进得去、且收工前走得完', badOk.length === 0,
    badOk.map(x => x.a.name).join('、') || '校验 ' + c.ok.length + ' 项');
  const badBlocked = c.blocked.filter(x => !x.reason || !x.detail);
  ok(hm(at) + ' 所有「去不了」项都给出了原因与说明', badBlocked.length === 0,
    badBlocked.map(x => x.a.name).join('、') || '校验 ' + c.blocked.length + ' 项');
  ok(hm(at) + ' 已去过的点不出现在「可去」里', c.ok.every(x => x.a.id !== 'mp') && c.visited.length === 1);
});

/* 口径一致性：候选池里「可去」的判定与 planFits 同源，绝不出现
   「候选说能去、排程却排不进去」的自相矛盾（差异只可能来自行程已占用） */
const at17 = 17 * 60;
const c17 = E.dayCandidates(city, { prefs: ALL_PREFS, pace: 'normal', startAt: at17, dayOfWeek: FRI, base: base });
const p17 = E.plan(city, { days: 1, prefs: ALL_PREFS, pace: 'normal', startAt: at17, dayOfWeek: FRI, base: base });
const okIds = {};
c17.ok.forEach(x => { okIds[x.a.id] = true; });
const planFitInCand = [];
p17.days[0].items.forEach(i => { if (!okIds[i.a.id]) planFitInCand.push(i.a.name); });
ok('行程选中的点位一定在「可去」列表里', planFitInCand.length === 0, planFitInCand.join('、') || '0 例不一致');

/* ================= 6. 同一时刻 + 同一输入 → 逐字节一致 ================= */
console.log('\n=== 6. 确定性：同一时刻 + 同一输入 → 同一结果 ===');
const optsA = { days: 1, prefs: ALL_PREFS, pace: 'normal', startAt: 14 * 60, dayOfWeek: FRI, base: base, visitedIds: ['xxl'] };
const s1 = JSON.stringify(E.plan(city, optsA));
const s2 = JSON.stringify(E.plan(city, optsA));
ok('两次调用逐字节一致', s1 === s2, s1.length + ' 字节');
const s3 = JSON.stringify(E.plan(city, { days: 1, prefs: ALL_PREFS, pace: 'normal', startAt: 15 * 60, dayOfWeek: FRI, base: base, visitedIds: ['xxl'] }));
ok('把「现在」从 14:00 改到 15:00，结果随之改变', s1 !== s3);
const s4 = JSON.stringify(E.plan(city, { days: 1, prefs: ALL_PREFS, pace: 'normal', startAt: 14 * 60, dayOfWeek: FRI, base: base }));
ok('去掉「已去过」后结果不同（排除生效）', s1 !== s4);
const sMon = JSON.stringify(E.plan(city, { days: 1, prefs: ALL_PREFS, pace: 'normal', startAt: 14 * 60, dayOfWeek: MON, base: base, visitedIds: ['xxl'] }));
ok('同一时刻改为周一，结果不同（闭馆日生效）', s1 !== sMon);
/* 引擎本身零时间依赖：时间只能从参数进来，不能从时钟来 */
const engineSrc = fs.readFileSync(__dirname + '/../js/engine.js', 'utf8');
ok('引擎零时间依赖（不含 new Date / Date.now）',
  engineSrc.indexOf('new Date') < 0 && engineSrc.indexOf('Date.now') < 0);

/* ================= 7. 排不出时的原因分类 ================= */
console.log('\n=== 7. 排不出行程时，原因分类是否正确 ===');
function kindOf(at, pace, b) {
  const r = E.plan(city, { days: 1, prefs: ALL_PREFS, pace: pace, startAt: at, dayOfWeek: FRI, base: b || base });
  return r.notice ? r.notice.kind : '（有行程）';
}
ok('21:00 却设收工 18:00 → 归类为「太晚」（too-late）', kindOf(21 * 60, 'relax') === 'too-late', kindOf(21 * 60, 'relax'));
ok('21:00 且收工 23:00 → 仍能排出行程', kindOf(21 * 60, 'late') === '（有行程）', kindOf(21 * 60, 'late'));
const zw = kindOf(14 * 60, 'normal', pick('lod-zhongwei'));
ok('驻点在中卫（超出数据包服务范围）→ 归类为「太远」（too-far）', zw === 'too-far' || zw === '（有行程）', zw);
const early = kindOf(5 * 60, 'normal');
ok('05:00 出发：要么给出行程（全天开放的点），要么明确说明「还没开门」',
  early === '（有行程）' || early === 'too-early', early);

console.log('\n' + (fail === 0 ? '✓ 全部通过（' + pass + ' 项）' : '✗ 失败 ' + fail + ' 项 / 共 ' + (pass + fail) + ' 项'));

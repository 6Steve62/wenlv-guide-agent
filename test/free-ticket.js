/* =============================================================================
 * 免票政策呈现验证 · 文旅导览智能体
 *
 * 西夏陵「对全国游客免首道门票」是分时段的文化惠民政策（人民网宁夏频道 /
 * 宁夏日报 2026-08 报道）：3月1日–10月31日 每周一；11月1日–次年2月28日
 * 每周一、周三；法定节假日除外。用户原话只说了冬季那一档，两个时段都摆出来
 * 才是如实呈现。这个脚本锁住六件事：
 *   ① 数据层：政策登记完整（两段时段、免票对象、除外情形），且只有该景点有
 *   ② 文本拼装：政策全文与报道口径逐字一致；时间轴短标签取全部时段星期并集
 *   ③ 攻略卡：「门票优惠」行紧挨「门票」行，出行提示讲清免费日；无政策不显示
 *   ④ 预算口径：引擎没有日期输入，免票政策绝不改变人均门票与排程结果
 *   ⑤ 引擎纯度：源码里不出现城市专属文案，改数据输出必须跟着变
 *   ⑥ selfCheck 数据体检：政策写错（没时段 / 星期越界）要在排程前就被抓住
 *
 * 运行：node test/free-ticket.js   （在任意目录下均可，路径按 __dirname 解析）
 * ========================================================================== */
const fs = require('fs');
global.window = global;
['data/cats.js', 'data/yinchuan.js', 'data/nearby.js', 'data/lodging.js', 'js/engine.js']
  .forEach(f => eval(fs.readFileSync(__dirname + '/../' + f, 'utf8')));

const E = global.Engine;
const SRC_ENGINE = fs.readFileSync(__dirname + '/../js/engine.js', 'utf8');
const city = E.buildCity(['yinchuan', 'nearby']);
const byId = id => city.attractions.filter(a => a.id === id)[0];
const XXL = byId('xxl');            // 西夏陵：有免票政策
const YB = byId('yb');              // 镇北堡西部影城：全价票，没有免票政策

let pass = 0, fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + n + (x ? '   → ' + x : '')); c ? pass++ : fail++; };

/* ================= 1. 数据层：政策登记完整 ================= */
console.log('=== 1. 数据层：免票政策登记 ===');
const withFree = city.attractions.filter(a => a.free);
ok('只有西夏陵登记了免票政策', withFree.length === 1 && withFree[0].id === 'xxl',
   withFree.map(a => a.name).join('、') || '无');
ok('政策分两个时段（3–10 月仅周一；11–次年 2 月周一、周三）',
  XXL.free.periods.length === 2 &&
  XXL.free.periods[0].range === '3月1日–10月31日' && XXL.free.periods[0].dows.join() === '1' &&
  XXL.free.periods[1].range === '11月1日–次年2月28日' && XXL.free.periods[1].dows.join() === '1,3',
  XXL.free.periods.map(p => p.range + ' ' + p.dows.join('/')).join('；'));
ok('免票对象与除外情形都写明（对全国游客 / 法定节假日除外）',
  XXL.free.scope === '对全国游客免首道门票' && XXL.free.except === '法定节假日除外');
ok('每个时段的星期几都在 0–6（0=周日）',
  XXL.free.periods.every(p => p.dows.length && p.dows.every(d => d >= 0 && d <= 6)));
ok('数据来源注记指向公开报道（不是拍脑袋）',
  /西夏陵免票政策：人民网宁夏频道/.test(fs.readFileSync(__dirname + '/../data/yinchuan.js', 'utf8')));

/* ================= 2. 文本拼装 ================= */
console.log('\n=== 2. 政策文本拼装 ===');
const FULL = '3月1日–10月31日 每周一；11月1日–次年2月28日 每周一、周三，对全国游客免首道门票（法定节假日除外）';
ok('政策全文与报道口径逐字一致', E.freePolicyText(XXL.free) === FULL, E.freePolicyText(XXL.free));
ok('时间轴短标签取全部时段的星期并集', E.freeTagText(XXL.free) === '周一/周三免首道门票',
   E.freeTagText(XXL.free));
ok('没给政策时返回空串（界面据此整行不显示，而不是摆一句空话）',
  E.freePolicyText(null) === '' && E.freePolicyText(undefined) === '' &&
  E.freePolicyText({}) === '' && E.freeTagText(null) === '' && E.freeTagText({ periods: [] }) === '');
ok('残缺时段被跳过，不拼出半句话',
  E.freePolicyText({ periods: [{ range: '3月1日–10月31日', dows: [] }, { range: '11月起', dows: [1] }] }) === '11月起 每周一');
ok('一段都不剩时返回空串', E.freePolicyText({ periods: [{ range: 'x', dows: [] }] }) === '');
ok('缺 scope / except 时不留下孤零零的逗号或括号',
  E.freePolicyText({ periods: [{ range: '11月起', dows: [1] }] }) === '11月起 每周一' &&
  E.freePolicyText({ periods: [{ range: '11月起', dows: [1] }], scope: '免票' }) === '11月起 每周一，免票');

/* ================= 3. 攻略卡：事实行 + 出行提示 ================= */
console.log('\n=== 3. 攻略卡呈现 ===');
const g = E.spotGuide(city, XXL, {});
const rowIdx = g.facts.map(f => f[0]).indexOf('门票优惠');
ok('「门票优惠」行紧挨「门票」行（先看价，紧接着看什么时候不用付）',
  g.facts[0][0] === '门票' && rowIdx === 1);
ok('该行内容就是政策全文', g.facts[1][1] === FULL, g.facts[1][1]);
ok('其余事实行一个没少（开放时间 / 停留 / 类型 / 等级 / 坐标）',
  g.facts.length === 7 && ['开放时间', '建议停留', '游览类型', '景区等级', '坐标'].every(k =>
    g.facts.some(f => f[0] === k)));
ok('出行提示讲清了免费日（含除外情形）',
  g.tips.some(t => t.indexOf('门票有免费日') === 0 && t.indexOf('法定节假日除外') > 0),
  (g.tips.filter(t => t.indexOf('免') >= 0)[0] || '').slice(0, 40) + '…');
const gy = E.spotGuide(city, YB, {});
ok('没有免票政策的景点：不出现「门票优惠」行', gy.facts.every(f => f[0] !== '门票优惠'));
ok('没有免票政策的景点：不冒出免费日提示',
  gy.tips.every(t => t.indexOf('免首道门票') < 0 && t.indexOf('免费日') < 0));

/* ================= 4. 预算口径：政策不改钱、不改排程 ================= */
console.log('\n=== 4. 预算与排程口径 ===');
/* 引擎没有日期输入，读者哪天去它不知道，所以人均门票一律按全价累加；
   免票政策只作为信息呈现。拿「有 / 无 free 字段」各跑一遍同一组条件对比。
   条件取 3 天 + 人文历史/科普研学 + 第一次来——实测这一组排得到西夏陵。 */
function trip() {
  const p = E.plan(city, { days: 3, prefs: ['人文历史', '科普研学'], pace: 'normal', scope: 'with', role: 'first' });
  const use = p.city || city;
  const built = p.days.map(d => ({ d: d, tl: E.timeline(use, d, p.W) }));
  /* free 是本次对比的实验变量，序列化时剔掉，否则「有 / 无」两份 JSON
     差的只是数据本身带不带这个键，不是排程结果。 */
  const canon = JSON.stringify(p, (k, v) => (k === 'free' ? undefined : v));
  return {
    hasXxl: p.days.some(d => d.items.some(i => i.a.id === 'xxl')),
    tickets: E.summarize(use, built).tickets,
    json: canon
  };
}
const A = trip();
const saved = XXL.free;
XXL.free = null;
const B = trip();
XXL.free = saved;
ok('对照组行程里确实排到了西夏陵', A.hasXxl && B.hasXxl);
ok('免票政策不改变人均门票（全价口径累加，读者自己对照日期）', A.tickets === B.tickets,
   '有政策 ¥' + A.tickets + ' / 无政策 ¥' + B.tickets);
ok('免票政策不改变排程结果（逐字节一致）', A.json === B.json);

/* ================= 5. 引擎纯度：不认识这座城市 ================= */
console.log('\n=== 5. 引擎与数据的边界 ===');
/* 断言范围收紧到本次新增的三个函数：全文件里早有「来银川三天没去西夏陵」
   这类解释性注释（说明权重为什么这么设），但免票政策这套机器不许认识任何城市。 */
const FN = SRC_ENGINE.slice(
  SRC_ENGINE.indexOf('function dowListText'),
  SRC_ENGINE.indexOf('function guideTips'));
ok('免票政策函数里没有城市专属文案（景区名 / 除外情形等政策原文）',
  !/西夏陵|法定节假日|全国游客/.test(FN));
ok('政策文本全部来自数据包（改 scope → 输出跟着变）',
  (() => {
    XXL.free.scope = '对全国游客免首道门票';
    const a1 = E.freePolicyText(XXL.free);
    XXL.free.scope = '对所有游客免首道门票';
    const a2 = E.freePolicyText(XXL.free);
    XXL.free.scope = '对全国游客免首道门票';
    return a1 !== a2 && a2.indexOf('对所有游客') > 0;
  })());
ok('纯函数：同一输入两次调用逐字节一致',
  E.freePolicyText(XXL.free) === E.freePolicyText(XXL.free) &&
  JSON.stringify(E.spotGuide(city, XXL, {})) === JSON.stringify(E.spotGuide(city, XXL, {})));

/* ================= 6. selfCheck 数据体检 ================= */
console.log('\n=== 6. selfCheck 数据体检 ===');
const r = E.plan(city, { days: 3, prefs: ['人文历史'], pace: 'normal', scope: 'with', role: 'first' });
ok('登记正确的政策：自检零异常', E.selfCheck(r.city || city, r.days, r.W).length === 0);
function broken(free) {
  XXL.free = free;
  const p = E.selfCheck(r.city || city, r.days, r.W);
  XXL.free = saved;
  return p;
}
ok('登记了政策却没给时段 → 被抓出来',
  broken({ scope: '免票' }).some(x => x.indexOf('没给时段') > 0));
ok('时段缺日期区间 → 被抓出来',
  broken({ periods: [{ dows: [1] }] }).some(x => x.indexOf('缺少日期区间') > 0));
ok('时段没给星期几 → 被抓出来',
  broken({ periods: [{ range: '3月1日起', dows: [] }] }).some(x => x.indexOf('没给星期几') > 0));
ok('免票日越界（7 / -1）→ 被抓出来',
  broken({ periods: [{ range: '3月1日起', dows: [7] }] }).some(x => x.indexOf('不是 0–6') > 0) &&
  broken({ periods: [{ range: '3月1日起', dows: [-1] }] }).some(x => x.indexOf('不是 0–6') > 0));
ok('体检后数据已还原', XXL.free === saved && E.freePolicyText(XXL.free) === FULL);

console.log('\n' + (fail === 0 ? '✓ 全部通过' : '✗ 有 ' + fail + ' 项未通过') + '（' + pass + ' 项）');
process.exit(fail ? 1 : 0);

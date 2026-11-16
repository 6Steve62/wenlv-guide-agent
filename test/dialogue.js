/* =============================================================================
 * 对话层验证 · 文旅导览智能体（智能体层 · test/dialogue.js）
 *
 * 锁的最核心一件事：对话层只是「外壳」，不改变排程结果。
 *   同一组槽位，用话聊攒出来（js/dialogue.js + js/intent.js）和用表单直接设出来
 *   （向导的 S），走的是同一个 window.__APP__.planWith —— 排程输出逐字节一致。
 *
 * 其余锁点：
 *   ① 纯度：emptyState / ingest / planWith 零时间读取、零随机数、零 DOM 依赖
 *      （DOM 只出现在 dialogue.js 的 init 之后，不影响排程）
 *   ② 解析→摄入映射：天数 / 身份 / 偏好增删 / 去过·不去 / 出发时刻 正确并入 state
 *   ③ 多轮与单句等价：一句话说清 vs 分步说清，最终排程一致
 *   ④ 降级：没听懂时不崩、不改 state
 *
 * 运行：node test/dialogue.js
 * ========================================================================== */
const fs = require('fs');
global.window = global;

/* DOM 桩：dialogue.js 的 init 只在 DOMContentLoaded 时跑，这里不会触发；
   但 app.js 加载时要用到 document，照 guide-panel.js 的路子先桩上。 */
function mk(id) {
  const e = {
    id, style: {}, _h: '', textContent: '', className: '', value: '', label: '',
    disabled: false, dataset: {}, children: [], onclick: null, onchange: null,
    appendChild(c) { this.children.push(c); return c; },
    querySelectorAll() { return []; }
  };
  Object.defineProperty(e, 'innerHTML', { get() { return this._h; }, set(v) { this._h = v; this.children.length = 0; } });
  return e;
}
const nodes = {};
global.document = {
  body: mk('body'),
  getElementById(id) { return nodes[id] || (nodes[id] = mk(id)); },
  createElement() { return mk(''); },
  addEventListener() {}
};
Object.defineProperty(global, 'navigator', { configurable: true, value: {} });
global.setTimeout = fn => { fn(); return 0; };
global.__EXPOSE_APP__ = true;   // 让 app.js 挂出 planWith 等内部函数

const ROOT = __dirname + '/../';
['data/cats.js', 'data/yinchuan.js', 'data/nearby.js', 'data/lodging.js', 'js/engine.js', 'js/intent.js', 'js/dialogue.js']
  .forEach(f => eval(fs.readFileSync(ROOT + f, 'utf8')));
eval(fs.readFileSync(ROOT + 'js/app.js', 'utf8'));

const E = global.Engine, I = global.Intent, D = global.Dialogue, APP = global.__APP__;
const city = E.buildCity(['yinchuan', 'nearby']);
const PREF_ALL = APP.PREF_ALL;

let pass = 0, fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + n + (x !== undefined ? '   → ' + x : '')); c ? pass++ : fail++; };

/* 把一句话（或一串话）经由「解析器 → 摄入」攒成 state。
   这里手工构造与 dialogue.init 同口径的 ctx（测试不依赖真实 DOM）。 */
const TEST_CTX = {
  prefs: PREF_ALL,
  prefWords: I.defaultPrefWords(PREF_ALL),
  lodgings: global.CITY_DATA.lodging.lodgings,
  spots: city.attractions.map(a => ({ id: a.id, name: a.name })),
  now: 14 * 60
};
function converse(lines) {
  let st = D.emptyState(PREF_ALL);
  lines.forEach(function (line) {
    st = D.ingest(st, I.parse(line, TEST_CTX), PREF_ALL);
  });
  return st;
}

console.log('\n=== 1. 纯度与确定性 ===');
ok('源码不含时间读取（new Date / Date()）',
  !/new\s+Date\(|Date\.now\(/.test(
    fs.readFileSync(ROOT + 'js/dialogue.js', 'utf8') + fs.readFileSync(ROOT + 'js/intent.js', 'utf8')));
ok('源码不含随机数（Math.random）',
  !/Math\.random/.test(fs.readFileSync(ROOT + 'js/dialogue.js', 'utf8')));
const seed = D.emptyState(PREF_ALL);
const p1 = I.parse('玩三天第一次来喜欢人文历史住新华街', {
  prefs: PREF_ALL, prefWords: I.defaultPrefWords(PREF_ALL),
  lodgings: global.CITY_DATA.lodging.lodgings,
  spots: city.attractions.map(a => ({ id: a.id, name: a.name })), now: 14 * 60
});
const a1 = JSON.stringify(D.ingest(seed, p1, PREF_ALL));
const a2 = JSON.stringify(D.ingest(seed, p1, PREF_ALL));
ok('ingest 确定性：同输入两次逐字节一致', a1 === a2);
const s0 = { days: 3, role: 'first', prefs: ['人文历史'], pace: 'normal', scope: 'with', lodgingId: 'lod-xinhua' };
ok('planWith 确定性：同 state 两次逐字节一致',
  JSON.stringify(APP.planWith(city, s0)) === JSON.stringify(APP.planWith(city, s0)));

console.log('\n=== 2. 解析 → 摄入映射 ===');
ok('「玩三天」→ days=3', converse(['玩三天']).days === 3);
ok('「第一次来」→ role=first', converse(['第一次来']).role === 'first');
ok('「想看人文历史」→ prefs 含「人文历史」',
  converse(['想看人文历史']).prefs.indexOf('人文历史') >= 0);
ok('「不想看人文历史」→ prefs 剔除「人文历史」',
  converse(['想看人文历史', '不想看人文历史']).prefs.indexOf('人文历史') < 0);
ok('「住新华街」→ lodgingId=lod-xinhua', converse(['住新华街']).lodgingId === 'lod-xinhua');
ok('「去过西夏陵」→ visited 含 xxl', converse(['去过西夏陵']).visited.indexOf('xxl') >= 0);
ok('「不去西夏陵」→ avoid 含 xxl', converse(['不去西夏陵']).avoid.indexOf('xxl') >= 0);
ok('「下午两点出发」→ startAt=840', converse(['下午两点出发']).startAt === 14 * 60);

console.log('\n=== 3. 对话层不改变排程结果（核心）===');
/* 真正的契约是「排程输出逐字节一致」，不是中间态逐字节相同：
   表单把 pace/scope 预填成默认值，对话态在没提及时存 null，
   但 planWith 在排程时把两边都展开成同一组默认值，因此输出一致。 */
const planOf = st => JSON.stringify(APP.planWith(city, st));
const eq = (a, b) => planOf(a) === planOf(b);

/* 表单侧 state：用户把同样的值在表单里设出来（含向导预填的 pace/scope 默认值） */
const wizardState = { days: 3, role: 'first', prefs: ['人文历史'], pace: 'normal', scope: 'with', lodgingId: 'lod-xinhua' };

/* 对话侧：一句话说清 */
const chatOneShot = converse(['玩三天，第一次来，喜欢人文历史，住新华街']);
ok('单句对话正确捕获槽位（天数/身份/偏好/住宿）',
  chatOneShot.days === 3 && chatOneShot.role === 'first' &&
  JSON.stringify(chatOneShot.prefs) === '["人文历史"]' && chatOneShot.lodgingId === 'lod-xinhua',
  JSON.stringify(chatOneShot));
ok('→ 排程输出逐字节一致（单句）', eq(chatOneShot, wizardState));

/* 对话侧：分步说清 */
const chatStepwise = converse(['玩三天', '第一次来', '喜欢人文历史', '住新华街']);
ok('分步对话正确捕获槽位',
  chatStepwise.days === 3 && chatStepwise.role === 'first' &&
  JSON.stringify(chatStepwise.prefs) === '["人文历史"]' && chatStepwise.lodgingId === 'lod-xinhua',
  JSON.stringify(chatStepwise));
ok('→ 排程输出逐字节一致（分步）', eq(chatStepwise, wizardState));

/* 完全不给偏好：对话默认「不限」= 表单的 PREF_ALL，排程时都展开成全部 */
const wizardAll = { days: 2, role: 'repeat', prefs: PREF_ALL.slice(), pace: 'normal', scope: 'with', lodgingId: 'lod-nanmen' };
const chatNoPref = converse(['玩两天', '多次来', '住南门']);
ok('未提偏好时对话默认不限，与表单一致',
  chatNoPref.days === 2 && chatNoPref.role === 'repeat' && chatNoPref.lodgingId === 'lod-nanmen' &&
  chatNoPref.prefs.length === 0, JSON.stringify(chatNoPref));
ok('→ 排程输出逐字节一致（不限偏好）', eq(chatNoPref, wizardAll));

console.log('\n=== 4. 降级路径 ===');
const before = JSON.stringify(D.emptyState(PREF_ALL));
const after = D.ingest(D.emptyState(PREF_ALL), I.parse('随便聊点别的', {
  prefs: PREF_ALL, prefWords: I.defaultPrefWords(PREF_ALL),
  lodgings: global.CITY_DATA.lodging.lodgings,
  spots: city.attractions.map(a => ({ id: a.id, name: a.name })), now: 14 * 60
}), PREF_ALL);
ok('没听懂的句子摄入后 state 不变、不抛错', JSON.stringify(after) === before);
ok('对话层与解析器都就绪（window.Dialogue / window.Intent 存在）',
  !!global.Dialogue && !!global.Intent);

console.log('\n========================================');
if (fail) console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
else console.log('全部通过（' + pass + ' 项）');
process.exit(fail ? 1 : 0);

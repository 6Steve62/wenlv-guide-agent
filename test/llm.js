/* =============================================================================
 * 大模型适配器验证 · 文旅导览智能体（智能体层 · test/llm.js）
 *
 * 锁的是「可选前置」这一层，不碰排程（那是 test/dialogue.js 的事）：
 *   ① 默认关闭：没配置 = 零网络请求，parse 直接给规则解析器的结果
 *   ② 只补空、不改已认出的：规则解析器认对的槽位，模型说什么都不动
 *   ③ 模型的输出一律当不可信输入：类型不对 / 越界 / 不在白名单 → 丢那一个字段
 *   ④ 任何失败（超时 / HTTP 错误 / 非 JSON / 网络异常）都静默回落
 *   ⑤ 模型不产出事实也不产出文案：prompt 里不许出现城市专名，回显句在本地拼
 *
 * 运行：node test/llm.js
 * ========================================================================== */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..') + path.sep;
global.window = global;

/* ---------- 桩：localStorage ---------- */
const store = {};
window.localStorage = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; }
};

/* ---------- 桩：定时器 ----------
 * 只记录不执行：超时用例自己决定什么时候触发，避免"超时"与
 * "fetch 正常返回"两条路径互相抢跑。 */
let timers = [];
global.setTimeout = function (fn, ms) { timers.push({ fn: fn, ms: ms }); return timers.length; };
global.clearTimeout = function () {};

/* ---------- 桩：fetch ----------
 * mode 可切换：ok / http500 / pending / throw / badjson */
let fetchMode = 'ok';
let lastRequestBody = null;
let fetchCount = 0;
function makeResp(status, payload) {
  return { ok: status >= 200 && status < 300, status: status, json: () => Promise.resolve(payload) };
}
window.fetch = function (url, opt) {
  fetchCount += 1;
  lastRequestBody = { url: url, body: JSON.parse(opt.body), headers: opt.headers };
  if (fetchMode === 'pending') return new Promise(() => {});
  if (fetchMode === 'throw') return Promise.reject(new Error('Failed to fetch'));
  if (fetchMode === 'http500') return Promise.resolve(makeResp(500, {}));
  if (fetchMode === 'badjson') {
    return Promise.resolve(makeResp(200, { choices: [{ message: { content: '我觉得你想去三个地方玩' } }] }));
  }
  const content = JSON.stringify(window.__NEXT_REPLY__ || {});
  return Promise.resolve(makeResp(200, { choices: [{ message: { content: content } }] }));
};

/* ---------- 加载被测文件 ---------- */
eval(fs.readFileSync(ROOT + 'js/llm.js', 'utf8'));

/* ---------- 断言 ---------- */
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass += 1; console.log('  [OK] ' + name); }
  else { fail += 1; console.log('  [!!] ' + name + (extra ? '  → ' + extra : '')); }
}
function eq(name, a, b) {
  ok(name, JSON.stringify(a) === JSON.stringify(b),
    JSON.stringify(a) + ' ≠ ' + JSON.stringify(b));
}

/* ---------- 夹具 ---------- */
const CFG = { base: 'https://example.test/v1', key: 'test-key-not-a-real-one', model: 'test-model', vendor: 'custom' };

/* 一份**虚构城市**的 ctx：证明本适配器不认识任何真实城市 */
const FAKE = {
  prefs: ['人文历史', '自然风光'],
  lodgings: [{ id: 'l1', name: '测试驻点甲' }],
  spots: [{ id: 's1', name: '测试景点甲' }, { id: 's2', name: '测试景点乙' }],
  nearbySpots: [{ id: 'n1', name: '测试周边丙' }],
  labels: { role: {}, pace: {}, scope: {} }
};

function fb(action, slots) {
  return { action: action || 'unknown', slots: slots || {}, heard: [], notes: [], echo: 'x' };
}
function run(text, ctx, fallback) {
  return new Promise((resolve) => {
    window.LLM.parse(text, ctx, fallback, (p, m) => resolve({ p: p, m: m }));
  });
}
function reset() {
  for (const k in store) delete store[k];
  timers = []; fetchMode = 'ok'; fetchCount = 0; window.__NEXT_REPLY__ = null;
  window.LLM._reset();
}

/* ========================================================================== */
(async function main() {

console.log('\n【一】默认关闭：没有配置就一个字都不发出去');

reset();
ok('未配置时 enabled() 为 false', window.LLM.enabled() === false);
{
  const r = await run('玩三天，住测试驻点甲', FAKE, fb('fill', { days: 3 }));
  ok('未配置时零网络请求', fetchCount === 0, 'fetchCount=' + fetchCount);
  eq('未配置时槽位与规则解析器完全一致', r.p.slots, { days: 3 });
  ok('未配置时 meta.used 为 false', r.m.used === false);
}

reset();
window.LLM.saveCfg(CFG);
ok('三项齐全后 enabled() 为 true', window.LLM.enabled() === true);

reset();
window.LLM.saveCfg({ base: CFG.base, key: '', model: CFG.model });
ok('缺 key 视为关闭', window.LLM.enabled() === false);
reset();
window.LLM.saveCfg({ base: '', key: CFG.key, model: CFG.model });
ok('缺地址视为关闭', window.LLM.enabled() === false);

/* ========================================================================== */
console.log('\n【二】命令类不问模型（省一次往返）');

reset(); window.LLM.saveCfg(CFG);
for (const act of ['greet', 'restart', 'confirm']) {
  const r = await run('随便说点什么', FAKE, fb(act, {}));
  ok('action=' + act + ' 不请求模型', fetchCount === 0, 'fetchCount=' + fetchCount);
  ok('action=' + act + ' 原样返回', r.p.action === act);
}

/* ========================================================================== */
console.log('\n【三】合法返回：只补空，不改已认出的');

reset(); window.LLM.saveCfg(CFG);
window.__NEXT_REPLY__ = { role: 'local', pace: 'relax', prefs: ['自然风光'] };
{
  const r = await run('我本地人，随便逛逛', FAKE, fb('fill', { days: 2 }));
  eq('模型补进来的 role 生效', r.p.slots.role, 'local');
  eq('模型补进来的 pace 生效', r.p.slots.pace, 'relax');
  eq('规则已认出的 days 不被覆盖', r.p.slots.days, 2);
  ok('meta.used 为 true', r.m.used === true);
  ok('meta.filled 只列真正补进去的键',
    r.m.filled.indexOf('days') < 0 && r.m.filled.indexOf('role') >= 0, JSON.stringify(r.m.filled));
  ok('回显句在本地拼（含「模型补全」）', r.p.heard.join('|').indexOf('模型补全') >= 0, r.p.heard.join('|'));
  ok('回显句不含模型自由文本', r.p.heard.join('|').indexOf('随便逛逛') < 0);
}

reset(); window.LLM.saveCfg(CFG);
window.__NEXT_REPLY__ = { role: 'local' };
{
  const r = await run('第一次来，想看看', FAKE, fb('fill', { role: 'first' }));
  eq('规则认出的 role 不被模型改写', r.p.slots.role, 'first');
  ok('没有槽位被补进去时 meta.filled 为空或缺失', !r.m.filled || r.m.filled.length === 0);
}

reset(); window.LLM.saveCfg(CFG);
window.__NEXT_REPLY__ = { days: 3 };
{
  const r = await run('大概想待个三天吧', FAKE, fb('unknown', {}));
  eq('原本 unknown 的句子被模型救回 action=fill', r.p.action, 'fill');
  eq('救回的槽位写进 slots', r.p.slots.days, 3);
}

/* ========================================================================== */
console.log('\n【四】不可信输出：越界 / 类型错 / 不在白名单，逐字段丢弃');

reset(); window.LLM.saveCfg(CFG);
window.__NEXT_REPLY__ = {
  days: 999,
  role: '外星人',
  pace: 'relax',
  lodging: '不存在的驻点',
  prefs: ['人文历史', '量子力学'],
  visited: ['s1', 'zzz'],
  startAt: -5,
  ticket: 0,
  name: '编出来的景点'
};
{
  const r = await run('胡说八道的一句', FAKE, fb('unknown', {}));
  ok('越界天数被丢弃', r.p.slots.days === undefined);
  ok('未知身份被丢弃', r.p.slots.role === undefined);
  eq('合法节奏保留', r.p.slots.pace, 'relax');
  ok('白名单外的住宿被丢弃', r.p.slots.lodging === undefined);
  eq('偏好只留白名单内的那个', r.p.slots.prefs, ['人文历史']);
  eq('去过只留已知景点', r.p.slots.visited, ['s1']);
  ok('越界出发时刻被丢弃', r.p.slots.startAt === undefined);
  ok('门票这类事实字段根本没进 slots', r.p.slots.ticket === undefined);
  ok('未知键不进 slots', r.p.slots.name === undefined);
}

reset(); window.LLM.saveCfg(CFG);
window.__NEXT_REPLY__ = { days: '三天' };
{
  const r = await run('待三天', FAKE, fb('unknown', {}));
  ok('字符串天数（类型错）被丢弃', r.p.slots.days === undefined);
  ok('一个槽位都没拿到时 action 保持 unknown', r.p.action === 'unknown');
}

/* ========================================================================== */
console.log('\n【五】任何失败都静默回落');

reset(); window.LLM.saveCfg(CFG);
fetchMode = 'badjson'; window.__NEXT_REPLY__ = null;
{
  const r = await run('玩三天', FAKE, fb('fill', { days: 3, lodging: 'l1' }));
  eq('非 JSON 时原样返回规则结果', r.p.slots, { days: 3, lodging: 'l1' });
  ok('非 JSON 时 meta 标出原因', r.m.used === false && /JSON/i.test(String(r.m.err)), String(r.m.err));
  ok('诊断信息记下来了（面板会显示）', window.LLM.lastDiag().ok === false);
}

reset(); window.LLM.saveCfg(CFG);
fetchMode = 'http500';
{
  const r = await run('玩三天', FAKE, fb('fill', { days: 3 }));
  eq('HTTP 500 时回落', r.p.slots, { days: 3 });
  ok('诊断含状态码', /500/.test(String(r.m.err)), String(r.m.err));
}

reset(); window.LLM.saveCfg(CFG);
fetchMode = 'throw';
{
  const r = await run('玩三天', FAKE, fb('fill', { days: 3 }));
  eq('网络异常（含 CORS）时回落', r.p.slots, { days: 3 });
  ok('诊断标成 network/CORS', /network|CORS/i.test(String(r.m.err)), String(r.m.err));
}

reset(); window.LLM.saveCfg(CFG);
fetchMode = 'pending';
{
  const p = run('玩三天', FAKE, fb('fill', { days: 3 }));
  timers.filter((t) => t.ms === 2600)[0].fn();
  const r = await p;
  eq('超时后回落', r.p.slots, { days: 3 });
  ok('诊断标成 timeout', r.m.err === 'timeout', String(r.m.err));
}

/* ========================================================================== */
console.log('\n【六】提示词：不认识任何真实城市，事实一律不许碰');

const promptSys = window.LLM.buildPrompt('随便一句', FAKE)[0].content;
ok('prompt 不含真实城市专名', !/银川|贺兰|西夏|黄河|沙湖|青铜峡|镇北堡/.test(promptSys));
ok('prompt 的合法取值来自 ctx（假城市的景点名在里面）', promptSys.indexOf('测试景点甲') >= 0);
ok('prompt 明确禁止输出事实字段', /门票|开放时间/.test(promptSys) && /不要输出/.test(promptSys));
ok('prompt 要求只输出 JSON', /只输出 JSON/.test(promptSys));
ok('prompt 带"宁少认不认错"的异常处理口径', /宁少认|拿不准/.test(promptSys));

const msgs = window.LLM.buildPrompt('玩三天', FAKE);
ok('messages 是 system + user 两条', msgs.length === 2 && msgs[0].role === 'system' && msgs[1].role === 'user');
eq('user 消息就是原句', msgs[1].content, '玩三天');

reset(); window.LLM.saveCfg(CFG);
window.__NEXT_REPLY__ = { days: 2 };
await run('两天', FAKE, fb('unknown', {}));
ok('请求打到 base + /chat/completions', /\/chat\/completions$/.test(lastRequestBody.url), lastRequestBody.url);
ok('请求头带 Bearer key', /^Bearer /.test(lastRequestBody.headers.Authorization));
ok('temperature 固定 0（要结构化，不要发挥）', lastRequestBody.body.temperature === 0);
ok('请求体只有 messages，没把数据包塞进去',
  Object.keys(lastRequestBody.body).sort().join(',') === 'max_tokens,messages,model,stream,temperature',
  Object.keys(lastRequestBody.body).sort().join(','));

/* ========================================================================== */
console.log('\n【七】缓存与围栏剥离');

reset(); window.LLM.saveCfg(CFG);
window.__NEXT_REPLY__ = { days: 2 };
await run('两天', FAKE, fb('unknown', {}));
const c1 = fetchCount;
await run('两天', FAKE, fb('unknown', {}));
ok('同一句话第二次不再请求', fetchCount === c1, 'first=' + c1 + ' now=' + fetchCount);

eq('剥掉 ```json 围栏', window.LLM.extractJson('```json\n{"days":3}\n```'), { days: 3 });
eq('剥掉前后废话只取对象', window.LLM.extractJson('好的：{"days":3} 以上'), { days: 3 });
ok('不是 JSON 时返回 null', window.LLM.extractJson('我觉得三天不错') === null);
ok('空字符串返回 null', window.LLM.extractJson('') === null);

/* ========================================================================== */
console.log('\n【八】纯度与合规：源码里没有密钥，默认不外发');

const src = fs.readFileSync(ROOT + 'js/llm.js', 'utf8');
ok('源码不含形如 sk-xxx 的密钥字面量', !/['"]sk-[A-Za-z0-9]{8,}/.test(src));
ok('源码不含真实平台密钥赋值', !/api[_-]?key\s*[:=]\s*['"][A-Za-z0-9]{16,}/i.test(src));
const sanSrc = src.slice(src.indexOf('function sanitize('), src.indexOf('/* ---------- 提示词'));
ok('sanitize() 零 DOM 依赖', !/document\s*\./.test(sanSrc));
ok('sanitize() 零时间读取', !/Date\s*\.|performance\s*\./.test(sanSrc));
ok('sanitize() 零随机数', !/Math\s*\.random/.test(sanSrc));
ok('sanitize() 零网络调用', !/fetch\s*\(/.test(sanSrc));
ok('只有一条路径会发请求', (src.match(/window\.fetch\s*\(/g) || []).length === 1);

{
  let threw = false;
  try { window.LLM.initPanel(); } catch (e) { threw = true; }
  ok('没有面板节点时 initPanel() 安全返回', threw === false);
}

/* ========================================================================== */
console.log('\n【九】预置端点：页面下拉与实现一一对应，DeepSeek 要关掉思考');

{
  /* 有实现没选项 = 用户选不到；有选项没实现 = 选了不填地址的空壳。两边都得对上。 */
  const page = fs.readFileSync(ROOT + 'index.html', 'utf8');
  const at = page.indexOf('id="llmVendor"');
  const selBlock = page.slice(at, page.indexOf('</select>', at));
  const optVals = [...selBlock.matchAll(/<option value="([a-z]+)"/g)].map((m) => m[1]);
  const keys = Object.keys(window.LLM.ENDPOINTS);

  eq('下拉里的服务商与 ENDPOINTS 完全一致', optVals.slice().sort(), keys.slice().sort());
  ok('下拉里每个服务商都有对应的地址与模型名',
    optVals.every((v) => {
      const e = window.LLM.ENDPOINTS[v];
      return e && (v === 'custom' || (e.base && e.model));
    }));

  const ds = window.LLM.ENDPOINTS.deepseek;
  ok('DeepSeek 的地址是官方端点', /^https:\/\/api\.deepseek\.com(\/v1)?$/.test(ds.base), ds && ds.base);
  eq('DeepSeek 用现行模型名 deepseek-flash', ds.model, 'deepseek-flash');
  ok('没有填已弃用的 deepseek-chat / deepseek-reasoner',
    ds.model !== 'deepseek-chat' && ds.model !== 'deepseek-reasoner');
}

{
  /* DeepSeek 的思考模式默认开启：不关掉就会把 300 个 max_tokens 全灌进 reasoning，
   * 正文为空 + 2.6 秒超时。这条断言防的就是"哪天把这行删了"。 */
  reset();
  window.LLM.saveCfg({ base: 'https://api.deepseek.com/v1', key: 'test-key-not-a-real-one', model: 'deepseek-flash', vendor: 'deepseek' });
  window.__NEXT_REPLY__ = { days: 3 };
  await run('玩三天', FAKE, fb('fill', {}));
  ok('DeepSeek 请求带 thinking=disabled',
    lastRequestBody && lastRequestBody.body.thinking && lastRequestBody.body.thinking.type === 'disabled',
    JSON.stringify(lastRequestBody && lastRequestBody.body.thinking));

  reset();
  window.LLM.saveCfg({ base: 'https://example.test/v1', key: 'test-key-not-a-real-one', model: 'test-model', vendor: 'custom' });
  window.__NEXT_REPLY__ = { days: 3 };
  await run('玩三天', FAKE, fb('fill', {}));
  ok('别家不带 thinking 字段', lastRequestBody && !('thinking' in lastRequestBody.body));
}

/* ========================================================================== */
console.log('\n========================================');
if (fail) console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
else console.log('全部通过（' + pass + ' 项）');

process.exitCode = fail ? 1 : 0;

})();

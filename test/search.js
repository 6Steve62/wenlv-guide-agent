/* =============================================================================
 * 外部检索旁注验证 · 文旅导览智能体（智能体层 · test/search.js）
 *
 * 锁的是"问答旁注"这一层，不碰排程：
 *   ① 默认关闭：没配置 = 零网络请求
 *   ② 只在命中时效词时才查（纯函数判据，正反例都锁）
 *   ③ 检索词由调用方注入城市名，本文件不认识任何城市
 *   ④ 回包一律当不可信输入：非 http(s) 地址丢弃、摘要截断、最多三条
 *   ⑤ 任何失败都收成一行说明，不抛错、不挡正文
 *   ⑥ 旁注只读不写：不产生槽位、不改任何数字
 *
 * 运行：node test/search.js
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

/* ---------- 桩：定时器（只记录，超时用例自己触发，避免抢跑） ---------- */
let timers = [];
global.setTimeout = function (fn, ms) { timers.push({ fn: fn, ms: ms }); return timers.length; };
global.clearTimeout = function () {};

/* ---------- 桩：极简 DOM ----------
 * 只实现 fill() 用到的那几个方法：createElement / appendChild / removeChild /
 * firstChild / className / textContent。够用就行，不引第三方。 */
function El(tag) {
  this.tagName = String(tag || '').toUpperCase();
  this.children = [];
  this.className = '';
  this.textContent = '';
  this.parentNode = null;
}
Object.defineProperty(El.prototype, 'firstChild', {
  get: function () { return this.children.length ? this.children[0] : null; }
});
El.prototype.appendChild = function (c) {
  this.children.push(c); c.parentNode = this; return c;
};
El.prototype.removeChild = function (c) {
  const i = this.children.indexOf(c);
  if (i >= 0) { this.children.splice(i, 1); c.parentNode = null; }
  return c;
};
function walk(el, out) {
  out = out || [];
  if (!el) return out;
  out.push(el);
  for (const c of (el.children || [])) walk(c, out);
  return out;
}
function txt(el) { return walk(el).map((n) => n.textContent || '').join('|'); }

global.document = {
  createElement: (t) => new El(t),
  getElementById: () => null,
  addEventListener: () => {}
};

/* ---------- 桩：fetch ---------- */
let fetchMode = 'ok';
let lastReq = null;
let fetchCount = 0;
window.fetch = function (url, opt) {
  fetchCount += 1;
  lastReq = { url: url, body: JSON.parse(opt.body), headers: opt.headers };
  if (fetchMode === 'pending') return new Promise(() => {});
  if (fetchMode === 'throw') return Promise.reject(new Error('Failed to fetch'));
  if (fetchMode === 'http500') return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
  if (fetchMode === 'empty') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ query: 'x', results: [] }) });
  if (fetchMode === 'junk') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ results: 'nope' }) });
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(window.__NEXT_RESULTS__ || { results: [] }) });
};

/* ---------- 加载被测文件 ---------- */
eval(fs.readFileSync(ROOT + 'js/search.js', 'utf8'));

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

const CFG = { base: 'https://api.tavily.com/search', key: 'tvly-test-not-a-real-key' };
function reset() {
  for (const k in store) delete store[k];
  timers = []; fetchMode = 'ok'; fetchCount = 0; lastReq = null;
  window.__NEXT_RESULTS__ = null;
  window.SEARCH._reset();
}
function run(q, city) {
  return new Promise((resolve) => { window.SEARCH.query(q, (err, items) => resolve({ err, items })); });
}
const RESULTS = {
  results: [
    { title: '关于临时闭园的公告', url: 'https://www.example.gov.cn/a/1', content: '受大风影响，景区今日 14 时起临时闭园，已购票游客可原路退票，恢复时间另行通知；园内所有室外项目暂停，室内展馆正常开放，建议改约明日。' },
    { title: '本周活动安排', url: 'https://news.example.com/b/2', content: '本周末在镇北堡有非遗展演，免费入场，需提前预约。' },
    { title: '', url: 'https://blog.example.org/c/3', content: '一篇不带标题的游记。' },
    { title: '不该出现的第四条', url: 'https://spam.example.net/d/4', content: 'x' },
    { title: '不是网页的地址', url: 'ftp://files.example.com/e', content: 'x' }
  ]
};

/* ========================================================================== */
(async function main() {

console.log('\n【一】默认关闭：没配置就一个字都不发出去');

reset();
ok('未配置时 enabled() 为 false', window.SEARCH.enabled() === false);
{
  const r = await run('今天景区临时闭园了吗');
  ok('未配置时零网络请求', fetchCount === 0, 'fetchCount=' + fetchCount);
  eq('未配置时回调拿到"未配置"', r.err, '未配置');
  eq('未配置时条目为空', r.items, []);
}

/* ========================================================================== */
console.log('\n【二】查不查：只认会变的事');

{
  const yes = ['今天景区临时闭园了吗', '这周有什么活动', '明天下雨吗', '现在还在检修吗', '博物馆需要预约吗', '沙尘大不大'];
  const no = ['玩三天，第一次来，喜欢人文历史', '门票多少钱', '开放时间是几点', '住新华街', '帮我排一个两天行程'];
  ok('时效问题会查（6 例）', yes.every((s) => window.SEARCH.shouldSearch(s) === true),
    yes.filter((s) => !window.SEARCH.shouldSearch(s)).join(' / '));
  ok('排程问题不查（5 例）', no.every((s) => window.SEARCH.shouldSearch(s) === false),
    no.filter((s) => window.SEARCH.shouldSearch(s)).join(' / '));
  ok('太短不查', window.SEARCH.shouldSearch('闭园') === false);
  ok('空串不查', window.SEARCH.shouldSearch('') === false && window.SEARCH.shouldSearch(null) === false);
}

/* ========================================================================== */
console.log('\n【三】检索词：城市名由调用方注入');

eq('注入城市名', window.SEARCH.buildQuery('今天活动', '银川市'), '银川市 今天活动');
eq('句子里已有城市名就不重复加', window.SEARCH.buildQuery('银川市今天活动', '银川市'), '银川市今天活动');
eq('没有城市名就原样', window.SEARCH.buildQuery(' 今天  活动 ', ''), '今天 活动');
ok('超长截断到 60 字', window.SEARCH.buildQuery('临'.repeat(200), '').length === 60);
{
  const src = fs.readFileSync(ROOT + 'js/search.js', 'utf8');
  ok('源码里不含任何城市专名', !/银川|贺兰|西夏|黄河|沙湖|青铜峡/.test(src));
}

/* ========================================================================== */
console.log('\n【四】回包收敛：外面的东西一律当不可信');

{
  const items = window.SEARCH.sanitize(RESULTS);
  eq('最多留三条', items.length, 3);
  eq('丢掉非 http(s) 地址，域名去掉 www', items.map((x) => x.domain), ['example.gov.cn', 'news.example.com', 'blog.example.org']);
  eq('没有标题就用域名顶上', items[2].title, 'blog.example.org');
  {
    const long = window.SEARCH.sanitize({
      results: [{ title: 't', url: 'https://a.example.cn/x', content: '长'.repeat(120) }]
    });
    ok('摘要超 90 字截断', long[0].snippet.length === 91 && long[0].snippet.slice(-1) === '…', long[0].snippet.length);
    ok('短摘要原样保留', window.SEARCH.sanitize({ results: [{ title: 't', url: 'https://a.example.cn/y', content: '短' }] })[0].snippet === '短');
  }
  eq('results 不是数组时给空', window.SEARCH.sanitize({ results: 'nope' }), []);
  eq('空回包给空', window.SEARCH.sanitize(null), []);
}

/* ========================================================================== */
console.log('\n【五】请求：地址、鉴权、载荷');

reset(); window.SEARCH.saveCfg(CFG);
{
  window.__NEXT_RESULTS__ = RESULTS;
  const r = await run('银川市 今天活动', '');
  ok('确实发了一次', fetchCount === 1, 'fetchCount=' + fetchCount);
  eq('打到配置的端点', lastReq.url, CFG.base);
  eq('鉴权用 Bearer', lastReq.headers['Authorization'], 'Bearer ' + CFG.key);
  eq('query 原样进载荷', lastReq.body.query, '银川市 今天活动');
  eq('只要三条结果', lastReq.body.max_results, 3);
  eq('不要它替我们总结', lastReq.body.include_answer, false);
  eq('不拉原始正文（省额度）', lastReq.body.include_raw_content, false);
  ok('成功时无错误', r.err === null || r.err === undefined);
  eq('成功时拿到三条', r.items.length, 3);
}

/* ========================================================================== */
console.log('\n【六】失败一律收成一行说明，不抛错');

reset(); window.SEARCH.saveCfg(CFG);
{
  fetchMode = 'http500';
  const r = await run('今天活动');
  eq('HTTP 错误转成文字', r.err, 'http 500');
  eq('HTTP 错误不放条目', r.items, []);

  reset(); window.SEARCH.saveCfg(CFG); fetchMode = 'throw';
  const r2 = await run('今天活动');
  eq('网络/CORS 失败转成文字', r2.err, 'network/CORS');

  reset(); window.SEARCH.saveCfg(CFG); fetchMode = 'empty';
  const r3 = await run('今天活动');
  eq('没有结果单独说明', r3.err, '没有可用结果');

  reset(); window.SEARCH.saveCfg(CFG); fetchMode = 'junk';
  const r4 = await run('今天活动');
  eq('results 不是数组也不炸', r4.items, []);

  /* 超时：请求挂着不回，专挑 3500 那个定时器手动触发 */
  reset(); window.SEARCH.saveCfg(CFG); fetchMode = 'pending';
  const p = run('今天活动');
  const t = timers.filter((x) => x.ms === 3500)[0];
  ok('设了 3500ms 超时', !!t);
  if (t) t.fn();
  const r5 = await p;
  eq('超时转成文字', r5.err, 'timeout');
  ok('超时不影响后续（诊断已记下）', window.SEARCH.lastDiag().ok === false);
}

/* ========================================================================== */
console.log('\n【七】旁注渲染：只读，不外链 window.opener');

{
  const host = new El('div');
  const node = window.SEARCH.pending(host);
  ok('pending 占位挂得上去', !!node && host.children.length === 1);
  ok('占位就写明"不参与排程"', /不参与排程/.test(txt(node)));

  window.SEARCH.fill(node, window.SEARCH.sanitize(RESULTS), { err: null });
  const all = walk(node);
  const links = all.filter((n) => n.tagName === 'A');
  eq('三条各有一个链接', links.length, 3);
  eq('链接指向原文', links[0].href, 'https://www.example.gov.cn/a/1');
  ok('新窗口打开且断开 opener', links.every((a) => a.target === '_blank' && /noopener/.test(a.rel)));
  ok('标题写明来源与条数', /检索旁注 · 3 条/.test(txt(node)));
  ok('摘要也摆出来了', /临时闭园/.test(txt(node)));
}

{
  const host = new El('div');
  const node = window.SEARCH.pending(host);
  window.SEARCH.fill(node, [], { err: 'timeout' });
  ok('查不到时不假装有结果', /没查到/.test(txt(node)) && /timeout/.test(txt(node)));
  ok('查不到时换成 is-empty 样式', /is-empty/.test(node.className));
  ok('查不到时不产生任何链接', walk(node).filter((n) => n.tagName === 'A').length === 0);
}

/* ========================================================================== */
console.log('\n【八】纯度与合规');

{
  const src = fs.readFileSync(ROOT + 'js/search.js', 'utf8');
  ok('源码不含形如 sk-/tvly- 的密钥字面量', !/['"](sk|tvly)-[A-Za-z0-9]{8,}/.test(src));
  ok('只有一条路径会发请求', (src.match(/window\.fetch\s*\(/g) || []).length === 1);
  const pure = src.slice(src.indexOf('function shouldSearch('), src.indexOf('/* ---------- 回包收敛'));
  ok('shouldSearch/buildQuery 不碰 DOM', !/document\s*\./.test(pure));
  ok('shouldSearch/buildQuery 不读时间', !/Date\s*\.|performance\s*\./.test(pure));
  ok('shouldSearch/buildQuery 零随机', !/Math\s*\.random/.test(pure));

  const page = fs.readFileSync(ROOT + 'index.html', 'utf8');
  ok('页面引了 search.js', /<script src="js\/search\.js"><\/script>/.test(page));
  ok('页面有独立的检索开关', /id="searchWrap"/.test(page) && /id="searchBtn"/.test(page));
  ok('检索面板不复用模型的服务商下拉', !/id="llmVendor"[\s\S]{0,400}tavily/i.test(page));

  let threw = false;
  try { window.SEARCH.initPanel(); } catch (e) { threw = true; }
  ok('没有面板节点时 initPanel() 安全返回', threw === false);
}

/* ========================================================================== */
console.log('\n========================================');
if (fail) console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
else console.log('全部通过（' + pass + ' 项）');

process.exitCode = fail ? 1 : 0;

})();

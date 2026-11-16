/* =============================================================================
 * 启动护栏 · 文旅导览智能体
 *
 * 场景：用户在压缩包资源管理器里直接双击 index.html —— Windows 只把单个文件
 * 解到临时目录，js/ 与 data/ 不在旁边，页面退化成「标题在、向导不渲染」的空壳，
 * 且不给任何解释。单文件兜底版不受影响（自包含），于是呈现出
 * 「index.html 打不开、index-standalone.html 能开」的假故障。
 *
 * 防线：index.html 里一段默认隐藏的 #bootFail 提示 + 页尾一段不依赖定时器的
 * 护栏脚本。只有「引擎没加载」或「向导没渲染」时才显示提示；正常打开时页面上
 * 不存在这段内容（连 class 都不加）。
 *
 * 锁五件事：
 *   ① 提示块存在且默认隐藏（display:none，无 .show）
 *   ② 提示文案给出两条可执行出路（解压整个包 / 用单文件版）
 *   ③ 护栏判据是硬事实：window.Engine 存在 + 向导标题有字
 *   ④ 三种情形各得其所：文件齐→不显示；缺文件→显示；脚本半路报错→显示
 *   ⑤ 护栏不含定时器与时间读取（否则整页 DOM 快照会失配）
 *
 * 运行：node test/boot-guard.js   （在任意目录下均可，路径按 __dirname 解析）
 * ========================================================================== */
'use strict';
const fs = require('fs');
global.window = global;

let pass = 0, fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + n + (x ? '   → ' + x : '')); c ? pass++ : fail++; };
const head = t => console.log('\n' + t);

const ROOT = __dirname + '/../';
const HTML = fs.readFileSync(ROOT + 'index.html', 'utf8');

/* 护栏脚本：index.html 里最后一个 <script> 块（无 src 的那个） */
const scripts = HTML.match(/<script\b[^>]*>([\s\S]*?)<\/script>/g) || [];
const guardBlock = scripts.filter(s => !/\bsrc=/.test(s)).pop() || '';
const guardSrc = (guardBlock.match(/<script\b[^>]*>([\s\S]*?)<\/script>/) || [, ''])[1];

head('=== 1. 提示块：存在、默认隐藏、文案给路 ===');
ok('index.html 里有 #bootFail 提示块', /id="bootFail"/.test(HTML));
ok('默认隐藏（CSS display:none，不是靠 JS 后加）',
  /#bootFail\{display:none/.test(HTML.replace(/\s+/g, ' ')) || /#bootFail\s*\{[^}]*display:\s*none/.test(HTML));
ok('有 .show 显示规则', /#bootFail\.show\{display:block/.test(HTML.replace(/\s+/g, ' ')) ||
  /#bootFail\.show\s*\{[^}]*display:\s*block/.test(HTML));
ok('提示说明了原因（压缩包里直接双击、两个文件夹不在旁边）',
  /压缩包里面直接双击/.test(HTML) && /js\//.test(HTML) && /data\//.test(HTML));
ok('给出第一条出路：先解压整个包', /解压/.test(HTML));
ok('给出第二条出路：用同目录的单文件版', /index-standalone\.html/.test(HTML));
ok('单文件版被说明为「不依赖其他文件」', /不依赖任何其他文件/.test(HTML));
ok('另有 noscript 兜底（JS 被禁用时也有一句话）',
  /<noscript>[\s\S]*?启用 JavaScript[\s\S]*?<\/noscript>/.test(HTML));

head('=== 2. 护栏脚本：判据是硬事实 ===');
ok('护栏脚本存在且是最后一个无 src 的 script', guardSrc.indexOf('bootFail') >= 0);
ok('判据一：window.Engine 必须存在', /typeof window\.Engine !== 'undefined'/.test(guardSrc));
ok('判据二：window.CITY_DATA 必须存在', /!!window\.CITY_DATA/.test(guardSrc));
ok('判据三：向导标题必须有字（app.js 真的渲染过）',
  /getElementById\('qTitle'\)[\s\S]{0,120}textContent\.length > 0/.test(guardSrc));
ok('只在 load 事件后判一次（不轮询）', /addEventListener\('load'/.test(guardSrc) &&
  !/setInterval/.test(guardSrc));
ok('显示时只加一个 class，不重建 DOM', /n\.className = 'show'/.test(guardSrc) ||
  /classNameIndexOf\('show'\) < 0/.test(guardSrc));

head('=== 3. 三种情形各得其所（DOM 桩实跑）===');
function runGuard(setup) {
  /* 每个情形一份干净的桩，避免相互污染 */
  const nodes = {};
  function mk(id) {
    return {
      id, style: {}, _h: '', textContent: '', className: '', value: '',
      disabled: false, dataset: {}, children: [], _attrs: {},
      onclick: null, onchange: null,
      appendChild(c) { this.children.push(c); return c; },
      querySelectorAll() { return []; },
      setAttribute(k, v) { this._attrs[k] = String(v); },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null; }
    };
  }
  const listeners = {};
  const doc = {
    readyState: 'loading',
    getElementById(id) { return nodes[id] || (nodes[id] = mk(id)); },
    createElement() { return mk(''); },
    addEventListener() { }
  };
  const win = { addEventListener: function (ev, fn) { listeners[ev] = fn; } };
  const g = { window: win, document: doc };
  setup(g);
  /* 护栏源码在函数作用域里跑：window/document 都从 g 上取 */
  const fn = new Function('window', 'document', '"use strict";' + guardSrc);
  fn(g.window, g.document);
  if (listeners.load) listeners.load();
  return nodes['bootFail'] ? nodes['bootFail'].className : '(无节点)';
}

const a = runGuard(function (g) { delete g.window.Engine; });
ok('缺文件（Engine 未定义、标题空）→ 显示提示', a === 'show', 'className=' + a);

const b = runGuard(function (g) {
  g.window.Engine = { plan: function () { } };
  g.window.CITY_DATA = { yinchuan: {} };
  g.document.getElementById('qTitle').textContent = '计划玩几天？';
});
ok('文件齐（引擎在、标题有字）→ 不显示', b !== 'show' && b.indexOf('show') < 0, 'className=' + b);

const c = runGuard(function (g) {
  g.window.Engine = { plan: function () { } };      // 引擎加载了
  g.window.CITY_DATA = { yinchuan: {} };
  g.document.getElementById('qTitle').textContent = '';   // 但 app.js 半路报错，没渲染
});
ok('脚本半路报错（引擎在、标题空）→ 也显示', c === 'show', 'className=' + c);

head('=== 4. 不破坏确定性与既有断言 ===');
ok('护栏不含定时器 / 时间读取 / 随机数',
  !/setTimeout|setInterval|Date\.|Math\.random/.test(guardSrc));
ok('页头版式测试关心的词没有混进提示（「赛道」等）',
  HTML.indexOf('赛道') < 0 && HTML.indexOf('作品登记') < 0);

console.log('\n' + '-'.repeat(60));
console.log(pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail === 0 ? 0 : 1);

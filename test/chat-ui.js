/* =============================================================================
 * 对话界面验证 · 文旅导览智能体（智能体层 · test/chat-ui.js）
 *
 * 锁的是「对话界面」这一层，不碰排程（那是 test/dialogue.js 的事）：
 *   ① 助手每条回复都有思考块：先逐行写出依据，写完自动收起成「已思考 · N 步」，
 *      文本保留在 DOM 里（收起不是删除，随时可点开回看）
 *   ② 思考文本由槽位现算：换一句话 / 换一个身份，思考内容跟着变；
 *      且不含城市专名（换数据包不用改 dialogue.js）
 *   ③ 「打印效果」真的在逐字写：过程中能看到不完整的文本，最终文本一字不差
 *   ④ 同一句话两次，消息流 DOM 逐字节相同
 *   ⑤ 表单向导默认不可见（hidden），且页面里不再有任何"切到表单"的入口
 *
 * 运行：node test/chat-ui.js
 * ========================================================================== */
const fs = require('fs');
global.window = global;

/* ---------- DOM 桩 ----------
 * 比 test/dialogue.js 那份多几样：classList / getAttribute / querySelectorAll /
 * scrollIntoView / getBoundingClientRect —— 对话 UI 会用到它们。
 * setTimeout 同步化：打字机因此"瞬间走完"，断言拿到的就是终态。 */
let setTimeoutCount = 0;
global.setTimeout = function (fn) { setTimeoutCount += 1; fn(); return 0; };

function mkNode(tag) {
  const n = {
    tagName: (tag || 'div').toUpperCase(),
    id: '', className: '', _cls: new Set(), _attrs: {}, _h: '',
    textContent: '', children: [], style: {}, dataset: {}, value: '',
    open: false, onclick: null, onchange: null, scrollTop: 0, scrollHeight: 0,
    focus() { this.focused = true; },
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    addEventListener() {},
    removeEventListener() {},
    scrollIntoView() { this.scrolled = true; },
    getBoundingClientRect() { return { top: 0, left: 0, width: 760, height: 40 }; },
    setAttribute(k, v) { this._attrs[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null; },
    querySelectorAll(sel) {
      const want = String(sel).replace(/^\./, '');
      return this.children.filter(c => (c.className || '').split(/\s+/).indexOf(want) >= 0);
    },
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  };
  Object.defineProperty(n, 'classList', {
    get() {
      const self = this;
      return {
        add(c) { if (self._cls.has(c)) return; self._cls.add(c); self.className = (self.className + ' ' + c).trim(); },
        remove(c) { if (!self._cls.has(c)) return; self._cls.delete(c); self.className = self.className.split(/\s+/).filter(x => x && x !== c).join(' '); },
        contains(c) { return self._cls.has(c); }
      };
    }
  });
  Object.defineProperty(n, 'innerHTML', {
    get() { return this._h; },
    set(v) { this._h = v; this.children.length = 0; }
  });
  return n;
}

const nodes = {};
function setNode(id, n) { n.id = id; nodes[id] = n; return n; }
global.document = {
  body: mkNode('body'),
  getElementById(id) { return nodes[id] || setNode(id, mkNode('div')); },
  createElement(t) { return mkNode(t); },
  addEventListener() {},
  querySelectorAll() { return []; }
};
Object.defineProperty(global, 'navigator', { configurable: true, value: {} });
global.matchMedia = function () { return { matches: false }; };   // 不减少动效 → 走逐字路径
global.__EXPOSE_APP__ = true;

const ROOT = __dirname + '/../';
['data/cats.js', 'data/yinchuan.js', 'data/nearby.js', 'data/lodging.js',
 'js/engine.js', 'js/intent.js', 'js/dialogue.js', 'js/app.js']
  .forEach(f => eval(fs.readFileSync(ROOT + f, 'utf8')));

const D = global.Dialogue, I = global.Intent, APP = global.__APP__;

let pass = 0, fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + n + (x !== undefined ? '   → ' + x : '')); c ? pass++ : fail++; };

/* ---------- 搭一屏对话界面 ---------- */
const panel = setNode('chatPanel', mkNode('section'));
const log = setNode('chatLog', mkNode('div'));
const input = setNode('chatInput', mkNode('input'));
const send = setNode('chatSend', mkNode('button'));
const newBtn = setNode('chatNew', mkNode('button'));
const nowChip = setNode('chatNow', mkNode('button'));
setNode('wizardWrap', mkNode('details'));

/* 五枚示例芯片，最后一枚带 data-now（它不发送消息，只切「已在路上」） */
const chipHost = setNode('chatChips', mkNode('div'));
[
  ['玩三天，第一次来，喜欢人文历史，住新华街', null],
  ['两天，带孩子，轻松一点，住金凤区', null],
  ['一天，自然风光，把周边也带上', null],
  ['我是本地人，两天，找点小众的地方', null],
  ['已在银川 · 从此刻重排', '1']
].forEach(([say, now]) => {
  const c = mkNode('button');
  c.className = 'chip';
  c.textContent = say;
  c.setAttribute('data-say', say);
  if (now) c.setAttribute('data-now', now);
  chipHost.appendChild(c);
});

D.init();

/* ---------- 小工具 ---------- */
function dump(n) {                      // 把一个节点子树序列化成可比对的字符串
  const cls = (n.className || '').trim();
  const kids = n.children.map(dump).join('');
  const open = n.open ? ' open' : '';
  return '<' + (n.tagName || 'div') + (cls ? ' class="' + cls + '"' : '') + open + '>'
    + (n.textContent || '') + kids + '</>';
}
function say(text) {
  input.value = text;
  send.onclick();
}
function msgs() { return log.children; }
function thinkOf(m) { return m.children.find(c => c.className === 'think'); }
function answerOf(m) { return m.children.find(c => String(c.className).indexOf('bubble') === 0); }
function linesOf(m) {
  const t = thinkOf(m);
  return t ? t.children.filter(c => c.className === 'think-body')[0].children : [];
}
function labelOf(m) {
  const t = thinkOf(m);
  if (!t) return '';
  const sum = t.children[0];
  return sum.children[1].textContent;
}

console.log('\n=== 对话界面：思考块 / 打字效果 / 表单入口 ===\n');

/* ① 一句话 → 一条用户气泡 + 一条带思考块的助手回复 */
say('玩三天，第一次来，喜欢人文历史，住新华街');
ok('用户消息原样上屏', msgs()[0].textContent === '玩三天，第一次来，喜欢人文历史，住新华街', msgs()[0].textContent);

const m1 = msgs()[1];
ok('助手回复是「思考块 + 回答」的组合', !!thinkOf(m1) && !!answerOf(m1),
  m1.children.map(c => c.className).join(' / '));
ok('思考块逐行写出依据（≥3 行）', linesOf(m1).length >= 3, linesOf(m1).length + ' 行');
ok('思考块写完自动收起', thinkOf(m1).open === false);
ok('收起后标题标出步数', /^已思考 · \d+ 步$/.test(labelOf(m1)), labelOf(m1));
ok('思考文本保留在 DOM 里（收起不是删除）',
  linesOf(m1).map(l => l.textContent).join('').length > 40,
  linesOf(m1).map(l => l.textContent)[0]);
ok('正文完整落在气泡里',
  answerOf(m1).textContent.indexOf('行程已生成') === 0, answerOf(m1).textContent.length + ' 字');

/* ② 思考内容随输入变化，且是"现算"而不是模板 */
const think1 = linesOf(m1).map(l => l.textContent).join('\n');
ok('思考里出现识别到的天数与偏好', /天数 3 天/.test(think1) && /人文历史/.test(think1));
ok('思考里回填引擎的真实产出', /引擎排出 3 天 \d+ 个点位/.test(think1),
  (think1.match(/引擎排出[^\n]*/) || [''])[0]);
ok('思考里标出按身份筛点的口径', /身份「第一次来」/.test(think1));
/* 城市专名只能经 ctx（由数据包与 app.js 的标签注入）出现，源码里不许写死 —— 换城市不改编排层 */
const src = fs.readFileSync(ROOT + 'js/dialogue.js', 'utf8');
const fnSrc = src.slice(src.indexOf('function thinking('), src.indexOf('/* ================= 以下为 UI 部分'));
ok('thinking() 源码里不含城市专名', !/银川|贺兰|西夏|黄河|沙湖|青铜峡/.test(fnSrc));

/* ③ 打字效果：过程中确实出现过"半截"文本 */
ok('打字过程有逐字写入（setTimeout 被调用过多次）', setTimeoutCount > 20, setTimeoutCount + ' 次');
ok('打字结束后光标类被移除', !/typing/.test(answerOf(m1).className) && !/typing/.test(linesOf(m1)[0].className));

/* ④ 同一句话两次，消息流逐字节相同 */
const first = dump(log);
newBtn.onclick();                        // 新对话
ok('「新对话」清空消息流', msgs().length === 0);
say('玩三天，第一次来，喜欢人文历史，住新华街');
ok('同一句话两次，消息流 DOM 逐字节相同', dump(log) === first);

/* ⑤ 缺槽位时先追问，思考里写明还差什么 */
newBtn.onclick();
say('玩两天');
const m2 = msgs()[1];
ok('只给天数时追问住宿', answerOf(m2).textContent.indexOf('住哪儿') >= 0, answerOf(m2).textContent);
ok('追问也带思考块，并写明待补项', /待补：住宿位置/.test(linesOf(m2).map(l => l.textContent).join('')),
  linesOf(m2).map(l => l.textContent)[1]);

/* ⑥ 听不懂：不崩、不改槽位、给出可执行的下一步 */
const before = dump(log);
say('今天天气不错');
const m3 = msgs()[msgs().length - 1];
ok('听不懂时明说，不瞎编', answerOf(m3).textContent.indexOf('没太听懂') >= 0, answerOf(m3).textContent);
ok('听不懂时不改动已攒的槽位', dump(log).indexOf('玩两天') >= 0 && msgs().length === 4);
ok('听不懂的那条也有思考块（说明为什么没听懂）',
  linesOf(m3).length >= 1 && /没有带来新的行程条件/.test(linesOf(m3)[0].textContent),
  linesOf(m3)[0].textContent);

/* ⑦ 输出过程中不接受新消息（忙碌锁）：否则两段逐字输出会交叉写进同一条消息流 */
(function () {
  const queued = [];
  const syncTimeout = global.setTimeout;
  global.setTimeout = fn => { queued.push(fn); return queued.length; };
  try {
    newBtn.onclick();
    input.value = '玩三天，第一次来，住新华街';
    send.onclick();
    ok('交出一轮后未写完时，发送键被置灰', send.disabled === true);
    const half = msgs().length;
    input.value = '再帮我加一天';
    send.onclick();
    ok('忙碌时再发一条不会被塞进消息流', msgs().length === half, msgs().length + ' 条');
    ok('忙碌时输入框里那半句不会被吞掉', input.value === '再帮我加一天');

    /* 走一部分队列：此时应当能看到"半截文本" */
    let steps = 0;
    while (queued.length && steps < 40) { queued.shift()(); steps += 1; }
    const partial = msgs()[msgs().length - 1].children;
    const thinkLine = partial.filter(c => c.className === 'think')[0]
      .children.filter(c => c.className === 'think-body')[0].children;
    ok('逐字过程中文本确实是半截的（不是一次性写完）',
      thinkLine.length === 0 || thinkLine[0].textContent.length < 40,
      thinkLine.length ? (thinkLine[0].textContent.length + ' 字') : '尚未起笔');

    while (queued.length) queued.shift()();
    ok('一轮写完发送键恢复可用', send.disabled === false);
    ok('写完那一刻正文完整', answerOf(msgs()[msgs().length - 1]).textContent.length > 10);
    global.setTimeout = syncTimeout;
  } finally {
    global.setTimeout = syncTimeout;
  }
})();

/* ⑧ 表单向导：默认隐藏，且页面里没有"切到表单"的入口 */
const html = fs.readFileSync(ROOT + 'index.html', 'utf8');
const wrapTag = (html.match(/<details[^>]*id="wizardWrap"[^>]*>/) || [''])[0];
ok('向导折叠区默认带 hidden', /hidden/.test(wrapTag), wrapTag);
ok('页面不再有「表单向导」按钮', !/id="openWizard"/.test(html));
ok('页面不再有「改用六步表单向导」链接', !/chatToForm/.test(html) && !/改用六步表单向导/.test(html));
ok('DOM 里仍保留 #wizard（app.js 与既有脚本的宿主）', /id="wizard"/.test(html));
ok('「已在路上」用芯片进入，不发送消息', !!nowChip.onclick && typeof nowChip.onclick === 'function');
nowChip.onclick();
ok('芯片展开向导切到「已在路上」',
  nodes.wizardWrap.hidden === false && nodes.wizardWrap.open === true);

/* ⑨ 版式：输入区固定在壳底、结果在它上面；结果逐块印出 */
const htmlSrc = fs.readFileSync(ROOT + 'index.html', 'utf8');
ok('滚动容器 .chat-body 存在且可滚动',
  /class="chat-body" id="chatBody"/.test(htmlSrc) && /\.chat-body\{[^}]*overflow-y:auto/.test(htmlSrc));
const iLog = htmlSrc.indexOf('id="chatLog"');
const iStage = htmlSrc.indexOf('id="stage"');
const iDock = htmlSrc.indexOf('class="composer-dock"');
ok('阅读顺序是 消息流 → 结果区 → 输入区', iLog > 0 && iLog < iStage && iStage < iDock,
  [iLog, iStage, iDock].join(' < '));
ok('输入区不再用 sticky 覆盖内容（改为壳内固定）',
  !/\.composer-dock\{[^}]*position:sticky/.test(htmlSrc) && /\.composer-dock\{[^}]*flex:none/.test(htmlSrc));
ok('结果区逐块印出（#result 子块带 inkIn 动画）',
  /#result > \*, #notice > \*, #days > \.day, #dayNav, #mapBox > \*\{[\s\S]*?animation:inkIn/.test(htmlSrc));
ok('低动效环境直接给终态（不截到半成品）',
  /prefers-reduced-motion: reduce[\s\S]{0,400}animation:none/.test(htmlSrc));
ok('结果标题逐字打出的光标样式在位', /#resultTitle\.typing::after/.test(htmlSrc));

/* ⑩ 思考函数本身是纯的：不读时间、不摇色子 */
ok('thinking() 零时间读取', !/Date\s*\.|performance\s*\.|__CLOCK__/.test(fnSrc));
ok('thinking() 零随机数', !/Math\s*\.random/.test(fnSrc));
ok('thinking() 零 DOM 依赖', !/document\s*\./.test(fnSrc));

console.log('\n========================================');
if (fail) console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
else console.log('全部通过（' + pass + ' 项）');
process.exit(fail ? 1 : 0);

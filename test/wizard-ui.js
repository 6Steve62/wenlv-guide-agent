/* =============================================================================
 * 向导交互 · 文旅导览智能体
 *
 * 锁的是一类很容易复发的界面缺陷：**点一下选项，整排卡片被重建**。
 * 重建不会改变任何数据，所以功能看起来是对的，但入场动效会重播：
 *   · 单选（天数 / 节奏 / 范围）→ 先重播一遍本页，再跳下页播第二遍，
 *     用户看到的是「同一页出现了两次」；
 *   · 多选（偏好 / 已去过）→ 每点一下闪一次，连点体验很差。
 *
 * 判据不看动画（无头环境的动画时间线不推进，测不准），而是看**节点身份**：
 * 点选前后 `#opts` 与 `#stepsBar` 的 children 引用必须逐个相同。
 * 只要有人在选项点击路径上把 `paintOpts` 改回 `renderStep`，这里立刻会红。
 *
 * 运行：node test/wizard-ui.js   （在任意目录下均可，路径按 __dirname 解析）
 * ========================================================================== */
'use strict';
const fs = require('fs');
global.window = global;

/* ---------- DOM 桩：与 determinism.js 同一套约定 ----------
 *   innerHTML 的 setter 清空 children（否则重复渲染会累积节点）
 *   setTimeout 同步执行（「选完自动进入下一步」可线性断言）
 */
const nodes = {};
function mk(id) {
  const e = {
    id, style: {}, _h: '', textContent: '', className: '', value: '', label: '',
    disabled: false, dataset: {}, children: [], onclick: null, onchange: null,
    appendChild(c) { this.children.push(c); return c; },
    querySelectorAll() { return []; }
  };
  Object.defineProperty(e, 'innerHTML', {
    get() { return this._h; },
    set(v) { this._h = v; this.children.length = 0; }
  });
  return e;
}
global.document = {
  getElementById(id) { return nodes[id] || (nodes[id] = mk(id)); },
  createElement() { return mk(''); }
};
Object.defineProperty(global, 'navigator', { configurable: true, value: {} });
global.setTimeout = function (fn) { fn(); return 0; };
global.__CLOCK__ = { min: 14 * 60, dow: 5 };

const ROOT = __dirname + '/../';
const APP_SRC = fs.readFileSync(ROOT + 'js/app.js', 'utf8');
['data/cats.js', 'data/yinchuan.js', 'data/nearby.js', 'data/lodging.js', 'js/engine.js']
  .forEach(f => eval(fs.readFileSync(ROOT + f, 'utf8')));
eval(APP_SRC);

let pass = 0, fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + n + (x ? '   → ' + x : '')); c ? pass++ : fail++; };

/* ---------- 交互辅助 ---------- */
function host() { return nodes['opts']; }
function labels() { return host().children.map(c => c.children[0] && c.children[0].textContent); }
function clickOpt(label) {
  const o = host().children.find(c => c.children[0] && c.children[0].textContent === label);
  if (!o) throw new Error('找不到选项「' + label + '」，当前有：' + labels().join(' / '));
  o.onclick();
}
function click(id) { const n = nodes[id]; if (n && n.onclick) n.onclick(); }
function onCount() { return host().children.filter(c => /(^|\s)on(\s|$)/.test(c.className)).length; }
function onLabels() {
  return host().children.filter(c => /(^|\s)on(\s|$)/.test(c.className))
    .map(c => c.children[0] && c.children[0].textContent);
}
function stepNow() { return nodes['stepsBar'].children.findIndex(c => c.className.indexOf('now') >= 0); }
function picked() { return nodes['picked'] ? (nodes['picked']._h || '').replace(/<[^>]+>/g, '') : ''; }
function title() { return nodes['qTitle'] ? nodes['qTitle'].textContent : ''; }

/* 引用快照：必须 copy 一份，桩里 innerHTML 的 setter 会就地清空原数组 */
function snap(hostNode) { return (hostNode ? hostNode.children : []).slice(); }
function sameRefs(now, before) {
  if (now.length !== before.length) return false;
  for (let i = 0; i < now.length; i++) if (now[i] !== before[i]) return false;
  return true;
}

console.log('=== 1. 首屏：天数单选 ===');
ok('第一步是「计划玩几天」', /计划玩几天/.test(title()), title());
ok('选项数与天数档位一致（8 个）', host().children.length === 8, host().children.length + ' 个');
ok('初始没有任何选中', onCount() === 0);

console.log('\n=== 2. 单选点一下 → 直接进下一步（本页不重绘） ===');
const daysRefs = snap(host());
const stepsRefs = snap(nodes['stepsBar']);
ok('点击前记下天数页节点', daysRefs.length === 8);
clickOpt('2 天');
ok('已进入第 2 步「取向」', /您对银川熟悉吗/.test(title()), title());
ok('步骤条现在指向第 2 步', stepNow() === 1, 'now=' + (stepNow() + 1));
ok('面包屑记下「天数 2 天」', /天数\s*2 天/.test(picked()), picked());
ok('步骤条被整体重建（换页本来就该重建，这是正常的）',
  nodes['stepsBar'].children.length === 6, nodes['stepsBar'].children.length + ' 步');
ok('天数页的旧节点已脱离文档（被换掉了）',
  !sameRefs(snap(host()), daysRefs));

/* 取向同样是单选：点一下自动进下一步，「第一次来」默认就是选中态 */
const idRefs = snap(host());
ok('取向页默认选中「第一次来」', onLabels().join('、') === '第一次来', onLabels().join('、'));
clickOpt('第一次来');
ok('点选取向后自动进入第 3 步「想看什么」', /想看什么/.test(title()), title());
ok('身份页节点也被换掉', !sameRefs(snap(host()), idRefs));

console.log('\n=== 3. 多选：连点两下，节点必须一个都不换 ===');
const p0 = snap(host());
ok('偏好页 9 个标签', p0.length === 9, p0.length + ' 个');
const p0Steps = snap(nodes['stepsBar']);

clickOpt('摄影出片');
const p1 = snap(host());
ok('① 点第 1 个后，全是同一批节点（不重建）', sameRefs(p1, p0),
  sameRefs(p1, p0) ? p1.length + ' 个引用全部相同' : '有节点被重建');
ok('① 恰好 1 项选中', onCount() === 1, onLabels().join('、'));
ok('① 面包屑同步', /偏好\s*摄影出片/.test(picked()), picked());
ok('① 步骤条也没被重建', sameRefs(snap(nodes['stepsBar']), p0Steps));

clickOpt('亲子友好');
const p2 = snap(host());
ok('② 点第 2 个后，仍是同一批节点', sameRefs(p2, p0));
ok('② 现在 2 项选中', onCount() === 2, onLabels().join('、'));
ok('② 面包屑同步', /摄影出片、亲子友好/.test(picked()), picked());

clickOpt('摄影出片');       /* 取消 */
ok('③ 取消一项：节点仍没换', sameRefs(snap(host()), p0));
ok('③ 现在 1 项选中', onCount() === 1, onLabels().join('、'));
ok('③ 取消后剩亲子友好', onLabels()[0] === '亲子友好', onLabels().join('、'));

console.log('\n=== 4. 偏好至少保留一项 ===');
clickOpt('亲子友好');       /* 只剩它了，再点应当无效 */
ok('唯余一项时再点不会清空', onCount() === 1, onLabels().join('、'));
ok('此时按钮仍可用', nodes['nextBtn'].disabled === false);

console.log('\n=== 5. 回上一步再回来：选中态要回显，且重建是允许的 ===');
click('nextBtn');                       /* 进第 4 步「节奏」 */
ok('第 4 步是节奏单选', /每天想怎么安排/.test(title()), title());
const paceRefs = snap(host());
click('back');                          /* 退回偏好 */
ok('退回后仍显示偏好页', /想看什么/.test(title()), title());
ok('退回偏好时「亲子友好」保持选中', onLabels().join('、') === '亲子友好', onLabels().join('、'));
click('back');                          /* 再退一步是取向 */
ok('退到取向页', /您对银川熟悉吗/.test(title()), title());
ok('取向保持选中', onLabels().join('、') === '第一次来', onLabels().join('、'));

console.log('\n=== 6. 单选重复点：不会造成两步跳页 ===');
click('nextBtn');                       /* 回偏好 */
click('nextBtn');                       /* 进节奏 */
const before = stepNow();
const r = snap(host());
clickOpt('轻松');
ok('节奏点一下就进第 5 步', stepNow() === 4, 'now=' + (stepNow() + 1));
ok('节奏页节点已换（换页正常）', !sameRefs(snap(host()), r));
ok('面包屑记下「节奏 轻松」', /节奏\s*轻松/.test(picked()), picked());

console.log('\n' + '-'.repeat(60));
if (fail === 0) {
  console.log('全部通过（' + pass + ' 项）');
  process.exit(0);
} else {
  console.log(pass + ' 通过 / ' + fail + ' 失败');
  process.exit(1);
}

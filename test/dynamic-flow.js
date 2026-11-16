/* =============================================================================
 * 「已在路上 · 从此刻重排」界面流程验证 · 文旅导览智能体
 *
 * 用 DOM 桩走完两条流程的真实点击路径，断言界面行为：
 *   A 初始状态（默认计划流程）
 *   B 计划流程跑通（六步 → 生成行程）
 *   C 切到「已在路上」流程
 *   D 动态五步逐级推进（位置 → 时间 → 已去过 → 兴趣 → 收工）
 *   E 动态结果（时间轴从此刻起算、候选卡、去不了清单）
 *   F 顺带把明天也排上
 *   G 已去过的点位被排除
 *   H 时间与收工冲突时给出可操作提示
 *   I 切回计划流程后状态干净
 *
 * 时钟通过 window.__CLOCK__ 固定为「周五 14:00」，因此结果完全可复现。
 * 运行：node test/dynamic-flow.js
 * ========================================================================== */
const fs = require('fs');
global.window = global;
global.__CLOCK__ = { min: 14 * 60, dow: 5 };

/* ---------- DOM 桩 ----------
 * 只实现被测代码真正用到的 API。两处关键设定：
 *   1. innerHTML 的 setter 必须清空 children，否则重复渲染会累积节点
 *   2. setTimeout 改为同步执行，让「选完自动进入下一步」可被线性断言
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

const ROOT = __dirname + '/../';
['data/cats.js', 'data/yinchuan.js', 'data/nearby.js', 'data/lodging.js', 'js/engine.js', 'js/app.js']
  .forEach(f => eval(fs.readFileSync(ROOT + f, 'utf8')));

let pass = 0, fail = 0;
function check(name, cond, extra) {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (extra ? '   → ' + extra : ''));
  cond ? pass++ : fail++;
}
function textOf(n) {
  return (n._h || '') + ' ' + (n.textContent || '') + ' ' + n.children.map(textOf).join(' ');
}
function clean(n) { return textOf(n).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }
function clickOpt(label) {
  const host = nodes['opts'];
  const o = (host ? host.children : []).find(c => c.children[0] && c.children[0].textContent === label);
  if (!o) throw new Error('未找到选项「' + label + '」，当前：' +
    (host ? host.children.map(c => c.children[0] && c.children[0].textContent).join(' / ') : '（无）'));
  o.onclick();
}
function click(id) { const n = nodes[id]; if (n && n.onclick) n.onclick(); }
function dayCount() { return nodes['days'] ? nodes['days'].children.length : 0; }
function stepNow() { return nodes['stepsBar'].children.findIndex(c => c.className.indexOf('now') >= 0); }
/* 结果页一次只展示一天，分页条在 #dayNav 里 */
function navText() { return clean(nodes['dayNav']); }
function navCur() { const m = navText().match(/第\s*(\d+)\s*\/\s*\d+\s*天/); return m ? +m[1] : 1; }
function navTotal() { const m = navText().match(/第\s*\d+\s*\/\s*(\d+)\s*天/); return m ? +m[1] : 1; }

/* ================= A. 初始状态 ================= */
console.log('=== A. 初始状态：默认进入计划流程 ===');
check('停在计划流程第 1 步', stepNow() === 0);
check('「出发前做计划」为高亮态', nodes['modePlan'].className.indexOf('on') >= 0);
check('第 1 步给出 8 个天数选项', nodes['opts'].children.length === 8);
check('单选步骤不显示「下一步」按钮', nodes['nextBtn'].style.display === 'none');

/* ================= B. 计划流程 ================= */
console.log('\n=== B. 计划流程跑通 ===');
clickOpt('3 天'); clickOpt('第一次来'); clickOpt('人文历史'); clickOpt('摄影出片'); click('nextBtn');
clickOpt('标准'); clickOpt('银川市全域'); click('nextBtn');
check('一次只展示一天', dayCount() === 1, dayCount() + ' 张');
check('分页条显示「第 1 / 3 天」', navCur() === 1 && navTotal() === 3, navText());
check('结果区标题为「行程概览」', nodes['resultTitle'].textContent === '行程概览');
check('行程含动线与用餐', /前往/.test(clean(nodes['days'])) && /午餐/.test(clean(nodes['days'])));
check('排程参数写明会校验开放时间', /停止入园/.test(nodes['algo'].innerHTML));
check('计划流程不显示「还能去哪」卡', clean(nodes['cand']) === '');

/* ================= C. 切换流程 ================= */
console.log('\n=== C. 切到「已在路上」流程 ===');
click('modeNow');
check('流程切到第 1 步（位置）', stepNow() === 0, '当前 index=' + stepNow());
check('第 1 步问题改为「你现在在哪一带」', nodes['qTitle'].textContent.indexOf('你现在在哪一带') >= 0);
check('位置步骤按钮为「下一步」而非「生成行程」', nodes['nextBtn'].textContent === '下一步', nodes['nextBtn'].textContent);
check('高亮已切到「已在路上」', nodes['modeNow'].className.indexOf('on') >= 0 &&
  nodes['modePlan'].className.indexOf('on') < 0);
check('切换流程后分页条已清空', navText() === '', navText() || '（已清空）');

/* ================= D. 动态五步 ================= */
console.log('\n=== D. 动态五步逐级推进 ===');
click('nextBtn');
check('进入第 2 步（时间）', stepNow() === 1, '当前 index=' + stepNow());
const tOpts = nodes['opts'].children.map(c => c.children[0].textContent);
check('时间选项首项为「现在 14:00」', tOpts[0] === '现在 14:00', tOpts.slice(0, 4).join(' / '));
clickOpt('现在 14:00');
check('点选时间后自动进入第 3 步（已去过）', stepNow() === 2, '当前 index=' + stepNow());
check('「已去过」可跳过（下一步未禁用）', nodes['nextBtn'].disabled === false);
check('「已去过」候选来自数据包（' + nodes['opts'].children.length + ' 个）', nodes['opts'].children.length > 40);
click('nextBtn');
check('进入第 4 步（兴趣）', stepNow() === 3, '当前 index=' + stepNow());
check('兴趣默认全选（不限）', nodes['opts'].children.filter(c => c.className.indexOf('on') >= 0).length === 9);
check('面包屑显示「兴趣 不限」', /兴趣.*不限/.test(clean(nodes['picked'])), clean(nodes['picked']));
click('nextBtn');
check('进入第 5 步（收工时间）', stepNow() === 4, '当前 index=' + stepNow());
const pOpts = nodes['opts'].children.map(c => c.children[0].textContent);
check('收工提供 18/19/20/23 四档', pOpts.join('/') === '到 18:00/到 19:00/到 20:00/到 23:00', pOpts.join(' / '));
clickOpt('到 19:00');

/* ================= E. 动态结果 ================= */
console.log('\n=== E. 动态结果 ===');
check('生成今天 1 天的行程', dayCount() === 1, dayCount() + ' 张');
check('标题为「今天剩下的时间怎么安排」', nodes['resultTitle'].textContent.indexOf('今天剩下的时间') >= 0);
check('显示候选统计', /处现在还进得去/.test(clean(nodes['nowInfo'])), clean(nodes['nowInfo']).slice(0, 90));
check('产出「现在还能去哪」卡', /现在还能去哪/.test(clean(nodes['cand'])));
check('产出「去不了及原因」清单', /这些暂时去不了/.test(clean(nodes['cand'])));
check('「去不了」原因使用中文标签',
  /今日闭馆|已过停止入园时间|剩余时间不足|还没开门|车程过远/.test(clean(nodes['cand'])));
check('三条动态验收标准全部勾出', (nodes['check'].innerHTML.match(/✓/g) || []).length === 3);
check('时间轴从 14:00 起算', /14:00/.test(clean(nodes['days'])));
check('午后出发不再插入午餐', !/午餐/.test(clean(nodes['days'])));
check('排程参数写明等待与最短游览的门槛', /停止入园时间|最短/.test(nodes['algo'].innerHTML));
check('出现「顺带把明天也排上」入口', nodes['addTom'] != null);

/* ================= F. 顺带排明天 ================= */
console.log('\n=== F. 顺带把明天也排上 ===');
click('addTom');
check('变成 2 天，且仍只展示一天', navTotal() === 2 && dayCount() === 1, navText());
check('标题改为「今天与明天」', nodes['resultTitle'].textContent.indexOf('今天与明天') >= 0,
  nodes['resultTitle'].textContent);
check('当前停在今天（14:00 起算）', navCur() === 1 && /14:00/.test(clean(nodes['days'])), clean(nodes['days']).slice(0, 46));
click('nextDay');
check('点「下一天」才看到第二天', navCur() === 2, navText());
check('第二天从正常出发时刻起算（非此刻）', /0[89]:\d\d–/.test(clean(nodes['days'])), clean(nodes['days']).slice(0, 46));
click('prevDay');
check('点「上一天」回到今天', navCur() === 1 && /14:00/.test(clean(nodes['days'])), clean(nodes['days']).slice(0, 46));
click('addTom');
check('再点一次回到 1 天且分页条消失', dayCount() === 1 && navText() === '', navText() || '（无分页条）');

/* ================= G. 已去过排除 ================= */
console.log('\n=== G. 已去过的点位被排除 ===');
click('restart');
click('nextBtn');                                  // 位置 → 时间
clickOpt('12:00');                                 // 时间 → 已去过（自动推进）
check('回到第 3 步', stepNow() === 2, '当前 index=' + stepNow());
clickOpt('西夏陵');
check('面包屑记录已去过 1 处', /已去过 1 处/.test(clean(nodes['picked'])), clean(nodes['picked']));
click('nextBtn'); click('nextBtn'); clickOpt('到 20:00');
check('西夏陵不再出现在行程里', !/西夏陵/.test(clean(nodes['days'])), clean(nodes['days']).slice(0, 110));
check('「已排除今天去过」出现在结果里', /已排除今天去过的 1 处/.test(clean(nodes['cand'])),
  clean(nodes['cand']).slice(-90));

/* ================= H. 时间与收工冲突 ================= */
console.log('\n=== H. 时间已过收工时刻 ===');
click('restart');
click('nextBtn'); clickOpt('21:00'); click('nextBtn');
click('nextBtn'); click('nextBtn');
clickOpt('到 18:00');
check('明确提示这个时刻排不出行程', /排不出行程/.test(clean(nodes['notice'])), clean(nodes['notice']).slice(0, 70));
check('空日卡片说明可调的两个旋钮', /改成更早的时刻/.test(clean(nodes['days'])), clean(nodes['days']).slice(0, 110));
check('只有一天时不显示分页条', navText() === '', navText() || '（无分页条）');
check('「还能去哪」给出同样的建议', /把「玩到几点」往后调/.test(clean(nodes['cand'])), clean(nodes['cand']).slice(0, 100));

/* ================= I. 切回计划流程 ================= */
console.log('\n=== I. 切回计划流程后状态干净 ===');
click('modePlan');
check('回到计划流程第 1 步', stepNow() === 0);
check('结果区已清空', clean(nodes['days']) === '' && clean(nodes['cand']) === '' &&
  clean(nodes['notice']) === '' && navText() === '');
check('高亮切回「出发前做计划」', nodes['modePlan'].className.indexOf('on') >= 0 &&
  nodes['modeNow'].className.indexOf('on') < 0);
clickOpt('2 天'); clickOpt('第一次来'); clickOpt('自然风光'); click('nextBtn'); clickOpt('轻松');
clickOpt('银川市全域'); click('nextBtn');
check('计划流程仍能正常生成', navTotal() === 2 && dayCount() === 1, navText());
check('切流程后退回第 1 天', navCur() === 1);

console.log('\n' + (fail === 0 ? '✓ 全部通过（' + pass + ' 项）' : '✗ 失败 ' + fail + ' 项 / 共 ' + (pass + fail) + ' 项'));

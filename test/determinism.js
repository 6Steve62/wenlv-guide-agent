/* =============================================================================
 * 确定性验证 · 文旅导览智能体
 *
 * 回答两个问题：
 *   ① 同一组输入是否必然产出同一份行程（不是预存线路表）
 *   ② 走完六步向导后，整页 HTML 是否可完全复现
 *
 * 运行：node test/determinism.js   （在任意目录下均可，路径按 __dirname 解析）
 * ========================================================================== */
const fs = require('fs');
global.window = global;

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
/* 固定时钟：界面唯一读取系统时间的地方取到的是这个值，页面快照因此可复现。
   引擎本身零时间依赖——时间只能由参数传入，这也是「同一时刻 + 同一输入 → 同一结果」的前提。 */
global.__CLOCK__ = { min: 14 * 60, dow: 5 };

const ROOT = __dirname + '/../';
const APP_SRC = fs.readFileSync(ROOT + 'js/app.js', 'utf8');
['data/cats.js', 'data/yinchuan.js', 'data/nearby.js', 'data/lodging.js', 'js/engine.js']
  .forEach(f => eval(fs.readFileSync(ROOT + f, 'utf8')));
const E = global.Engine;
const LOD = global.CITY_DATA.lodging.lodgings;
const ALL_PREFS = ['人文历史', '自然风光', '摄影出片', '亲子友好', '美食体验', '酒庄品鉴', '科普研学', '红色研学', '轻松休闲'];
const ROLE_LABEL = { first: '第一次来', repeat: '多次来', local: '我是本地人' };

let pass = 0, fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + n + (x ? '   → ' + x : '')); c ? pass++ : fail++; };

const city = E.buildCity(['yinchuan', 'nearby']);
const pick = id => E.toBase(LOD.filter(x => x.id === id)[0], city);
const sumOf = r => {
  const use = r.city || city;
  return E.summarize(use, r.days.map(d => ({ d: d, tl: E.timeline(use, d, r.W) })));
};
const base = pick('lod-xinhua');
const opts = { days: 4, prefs: ['人文历史', '自然风光', '美食体验'], pace: 'normal', base };

/* ================= 1. 引擎层：同输入两次调用 ================= */
console.log('=== 1. 引擎层：同输入两次调用 ===');
const t0 = process.hrtime.bigint();
const runA = JSON.stringify(E.plan(city, opts));
const t1 = process.hrtime.bigint();
const runB = JSON.stringify(E.plan(city, opts));
ok('两次返回逐字节一致', runA === runB, runA.length + ' 字节，单次 ' + (Number(t1 - t0) / 1e6).toFixed(2) + ' ms');
const p1 = E.plan(city, opts), p2 = E.plan(city, opts);
ok('逐日时间轴（分钟级）一致',
  JSON.stringify(p1.days.map(d => E.timeline(city, d, p1.W))) === JSON.stringify(p2.days.map(d => E.timeline(city, d, p2.W))));
ok('概览指标一致', JSON.stringify(sumOf(p1)) === JSON.stringify(sumOf(p2)));

/* ================= 2. 隐藏状态：A → B → A ================= */
console.log('\n=== 2. 隐藏状态：A → B → A ===');
E.plan(city, { days: 3, prefs: ['亲子友好'], pace: 'relax', base: pick('lod-zhongwei') });
E.plan(city, { days: 9, prefs: ALL_PREFS, pace: 'tight', base: pick('lod-zhenbeibao') });
ok('中间插入两组不同条件后，再跑 A 结果不变', JSON.stringify(E.plan(city, opts)) === runA, '无状态泄漏');

/* ================= 3. 反证：只改一个输入 ================= */
console.log('\n=== 3. 反证：只改一个输入，输出必须随之改变 ===');
[['加一天', { days: 5 }], ['减一天', { days: 2 }], ['换节奏', { pace: 'tight' }],
 ['只留酒庄偏好', { prefs: ['酒庄品鉴'] }], ['偏好清空', { prefs: [] }],
 ['偏好全选', { prefs: ALL_PREFS }], ['换镇北堡驻点', { base: pick('lod-zhenbeibao') }],
 ['换灵武驻点', { base: pick('lod-lingwu') }]
].forEach(([label, patch]) => {
  ok(label + ' → 行程改变', JSON.stringify(E.plan(city, Object.assign({}, opts, patch))) !== runA);
});
const rZ = E.plan(city, Object.assign({}, opts, { base: pick('lod-zhenbeibao') }));
ok('换驻点后总车程确实不同',
  sumOf(p1).travel !== sumOf(rZ).travel,
  sumOf(p1).travel + ' 分 → ' + sumOf(rZ).travel + ' 分');

/* ================= 4. 数据里不存在的位置与条件 ================= */
console.log('\n=== 4. 数据里从不存在的位置与条件，能否当场算出行程 ===');
const freeBase = { id: 'free', name: '自定义坐标', district: '—', lng: 106.1123, lat: 38.4107, roadKph: 50 };
[1, 2, 5, 9].forEach(n => {
  const r = E.plan(city, { days: n, prefs: ALL_PREFS, pace: 'tight', base: freeBase });
  const filled = r.days.filter(d => d.items.length).length;
  const ids = new Set(); r.days.forEach(d => { d.items.forEach(i => ids.add(i.a.id)); if (d.night) ids.add(d.night.id); });
  ok(n + ' 天（全偏好）→ 当场算出 ' + filled + '/' + n + ' 天、' + ids.size + ' 处点位', filled > 0);
});
const exotic = E.plan(city, { days: 6, prefs: ['酒庄品鉴', '红色研学'], pace: 'relax', base: pick('lod-yongning') });
ok('冷门偏好组合也能算出结果', exotic.days.some(d => d.items.length), exotic.days.filter(d => d.items.length).length + '/6 天');

/* ================= 向导测试辅助 ================= */
function boot() {
  Object.keys(nodes).forEach(k => delete nodes[k]);
  eval(APP_SRC);            // 重新求值 → 全新闭包状态，等价于刷新页面
}
function clickOpt(label) {
  const host = nodes['opts'];
  const o = (host ? host.children : []).find(c => c.children[0] && c.children[0].textContent === label);
  if (!o) throw new Error('未找到选项「' + label + '」，当前选项：' +
    (host ? host.children.map(c => c.children[0] && c.children[0].textContent).join(' / ') : '（无）'));
  o.onclick();
}
function click(id) { const n = nodes[id]; if (n && n.onclick) n.onclick(); }
function onCount() { return nodes['opts'].children.filter(c => c.className.indexOf('on') >= 0).length; }
function stepNow() { return nodes['stepsBar'].children.findIndex(c => c.className.indexOf('now') >= 0); }
/* 未渲染过结果时 #days 尚未被访问，桩里还不存在这个节点 */
function dayCardCount() { return nodes['days'] ? nodes['days'].children.length : 0; }
function textOf(n) {
  return (n._h || '') + ' ' + (n.textContent || '') + ' ' + n.children.map(textOf).join(' ');
}
function flat(n) { return textOf(n).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }
/* 结果页一次只展示一天，分页条在 #dayNav 里 */
function navText() { return flat(nodes['dayNav']); }
function navCur() { const m = navText().match(/第\s*(\d+)\s*\/\s*\d+\s*天/); return m ? +m[1] : 1; }
function navTotal() { const m = navText().match(/第\s*\d+\s*\/\s*(\d+)\s*天/); return m ? +m[1] : 1; }
function daysText() { return flat(nodes['days']); }
/* 逐天翻页，收集每一天的文本（用于「8 天里有没有覆盖到沙湖」这类跨天断言） */
function walkDays() {
  const out = [], total = navTotal();
  for (let i = 0; i < total; i++) {
    if (i > 0) click('nextDay');
    out.push(daysText());
  }
  return out;
}
function pageSnap() {
  const walk = n => [n._h || '', n.textContent || '', n.className || '', n.value || '',
    (n.style && n.style.display) || '', String(!!n.disabled)].join('\u0001') +
    '\u0002' + n.children.map(walk).join('\u0003');
  return Object.keys(nodes).sort().map(k => k + '=' + walk(nodes[k])).join('\n');
}
/* 走完一次完整向导：天数(自动) → 偏好(点下一步) → 节奏(自动) → 范围(自动) → 住宿(生成行程) */
function walkWizard(picks) {
  clickOpt(picks.days + ' 天');
  clickOpt(ROLE_LABEL[picks.role || 'first']);
  picks.prefs.forEach(p => clickOpt(p));
  click('nextBtn');
  clickOpt(picks.pace);
  clickOpt(picks.scope);
  click('nextBtn');
}

/* ================= 5. 向导流程 ================= */
console.log('\n=== 5. 向导流程：六步逐级推进（新增身份步骤）===');
const PICKS = { days: 3, prefs: ['人文历史', '摄影出片'], pace: '标准', scope: '银川市全域' };
boot();

ok('起始停在第 1 步', stepNow() === 0, '步骤条当前项 index=' + stepNow());
ok('第 1 步给 8 个天数选项', nodes['opts'].children.length === 8);
ok('起始未答时不显示「上一步」', nodes['back'].style.display === 'none');
ok('单选步骤不显示「下一步」按钮', nodes['nextBtn'].style.display === 'none');

clickOpt('3 天');
ok('点选天数后自动进入第 2 步', stepNow() === 1, '当前 index=' + stepNow());
ok('第 2 步为取向单选（第一次来 / 多次来 / 我是本地人），不显示「下一步」',
  nodes['qTitle'].textContent.indexOf('您对银川熟悉吗') >= 0 && nodes['nextBtn'].style.display === 'none');

clickOpt('第一次来');
ok('点选身份后自动进入第 3 步偏好', stepNow() === 2, '当前 index=' + stepNow());
ok('第 3 步为多选偏好，显示「下一步」',
  nodes['qTitle'].textContent.indexOf('想看什么') >= 0 && nodes['nextBtn'].style.display === 'inline-block');

ok('未选偏好时「下一步」为禁用态', nodes['nextBtn'].disabled === true);
clickOpt('人文历史');
ok('勾选后可继续', nodes['nextBtn'].disabled === false);
clickOpt('摄影出片');
ok('多选累计生效（2 项高亮）', onCount() === 2, onCount() + ' 项');
clickOpt('摄影出片');
ok('再点同一项可取消（1 项高亮）', onCount() === 1);
clickOpt('摄影出片');
ok('取消后补回（2 项高亮）', onCount() === 2);

click('nextBtn');
ok('点「下一步」进入第 4 步', stepNow() === 3);
clickOpt('标准');
ok('点选节奏后自动进入第 5 步', stepNow() === 4);
clickOpt('银川市全域');
ok('点选范围后自动进入第 6 步（住宿）', stepNow() === 5);
ok('住宿步骤隐藏选项网格、显示住宿控件',
  nodes['opts'].style.display === 'none' && nodes['lodBlock'].style.display === 'block');
ok('住宿步骤按钮改为「生成行程」', nodes['nextBtn'].textContent === '生成行程');
ok('显示「上一步」', nodes['back'].style.display === 'inline-block');

click('nextBtn');
ok('生成后向导隐藏', nodes['wizard'].style.display === 'none');
ok('生成后结果区显示', nodes['result'].style.display === 'block');
ok('一次只展示一天（不是把 3 天铺在一屏）', dayCardCount() === 1, dayCardCount() + ' 张');
ok('分页条显示「第 1 / 3 天」', navTotal() === 3 && navCur() === 1, navText());
ok('概览指标非空', nodes['summary'].innerHTML.length > 100);
ok('条件回顾含两条偏好',
  nodes['cond'].innerHTML.indexOf('人文历史') >= 0 && nodes['cond'].innerHTML.indexOf('摄影出片') >= 0);
ok('三条验收标准全部勾出', (nodes['check'].innerHTML.match(/✓/g) || []).length === 3);
ok('排程参数已展示', nodes['algo'].innerHTML.indexOf('单点最远车程') >= 0);
const dayText = textOf(nodes['days']);
ok('行程含动线与用餐', /前往/.test(dayText) && /午餐/.test(dayText));

/* 视觉品类：日卡片里每一站都配一张品类缩略图，用的仍是 data/cats.js 那一份素材，
   只是按 id 错开了取景 —— 所以「素材没多一张」与「缩略图不重样」两件事可以同时成立。 */
const VIS = global.CAT_VISUALS;
const thumbs = dayText.match(/<svg class="catart" style="left:-\d+%"[^>]*>[\s\S]*?<\/svg>/g) || [];
const spotCountOnDay = (dayText.match(/class="spotname"/g) || []).length;
ok('每个景点行都带品类缩略图（' + thumbs.length + ' / ' + spotCountOnDay + '）',
  thumbs.length === spotCountOnDay && thumbs.length > 0);
ok('缩略图就是品类字典里的那一幅，只是错开了取景',
  thumbs.length > 0 && thumbs.every(t =>
    Object.keys(VIS).some(k => VIS[k].art === t.replace(/ style="left:-\d+%"/, ''))));
ok('日卡片头部标出当天品类构成',
  /class="day-cats"/.test(dayText) && /class="catpill"/.test(dayText));
ok('概览里有整趟行程的品类构成条',
  /class="catbar"/.test(nodes['summary'].innerHTML) &&
  (nodes['summary'].innerHTML.match(/class="cl"/g) || []).length > 0);
const sumHtml = nodes['summary'].innerHTML;
const catBarSeg = sumHtml.match(/<div class="cbar">([\s\S]*?)<\/div>/);
ok('品类构成条：彩带段数 = 图例条数（段与释一一对应）',
  !!catBarSeg && (catBarSeg[1].match(/<span/g) || []).length === (sumHtml.match(/class="cl"/g) || []).length,
  catBarSeg ? (catBarSeg[1].match(/<span/g) || []).length + ' 段 / ' +
    (sumHtml.match(/class="cl"/g) || []).length + ' 条' : '未渲染');

/* 景点名是打开「游玩攻略」的入口：id 与 data-day/data-ev 必须自洽，
   否则点 A 景点会弹出 B 景点的攻略。这里校验 HTML 入口 → 引擎查得的对应关系。 */
const spotBtns = dayText.match(/<button class="spotname" id="j-(\d+)-(\d+)" data-spot="[^"]+"/g) || [];
ok('景点名带确定性 id 与点击上下文（形如 j-0-1）',
  spotBtns.length > 0 && /id="j-\d+-\d+"/.test(dayText), spotBtns.length + ' 个入口');
const entryDay = spotBtns.map(t => +t.match(/id="j-(\d+)-(\d+)"/)[1]);
const entryEv = spotBtns.map(t => +t.match(/id="j-(\d+)-(\d+)"/)[2]);
ok('入口指向正在展示的那一天', entryDay.every(d => d === 0), 'Day ' + (entryDay[0] + 1));
ok('同一天内入口 id 不重复', new Set(entryEv).size === entryEv.length, entryEv.map(k => 'j-0-' + k).join(' '));
const entryGuide = spotBtns.map(t => {
  const id = t.match(/data-spot="([^"]+)"/)[1];
  const s = city.attractions.filter(a => a.id === id)[0];
  return s ? E.spotGuide(city, s, {}).name : null;
});
ok('每个入口都能在引擎里取到对应景点的攻略卡', entryGuide.every(Boolean), entryGuide.join('、'));

/* 引擎必须零时间依赖、零随机数；界面只允许在「时钟读取」这一处碰系统时间。
   若这条失守，「同一时刻 + 同一输入 → 同一结果」就不成立。 */
function timeHits(src) { return (src.match(/new Date|Date\.now/g) || []).length; }
function noRandomness() {
  const engineSrc = fs.readFileSync(ROOT + 'js/engine.js', 'utf8');
  return (APP_SRC + engineSrc).indexOf('Math.random') < 0 &&
    timeHits(engineSrc) === 0 && timeHits(APP_SRC) === 1;
}
ok('全站零随机数 · 引擎零时间依赖 · 界面仅一处读取系统时间', noRandomness(),
  '界面 ' + timeHits(APP_SRC) + ' 处 / 引擎 ' + timeHits(fs.readFileSync(ROOT + 'js/engine.js', 'utf8')) + ' 处');

/* ================= 6. 整页 HTML 可复现 ================= */
console.log('\n=== 6. 整页 HTML 是否可完全复现 ===');
boot(); walkWizard(PICKS);
const snap1 = pageSnap();
boot(); walkWizard(PICKS);
const snap2 = pageSnap();
ok('两次完整走完向导，整页 DOM 逐字节一致', snap1 === snap2, snap1.length + ' 字符');
ok('快照确实含行程内容（非空跑）', /Day/.test(snap1) && /j-0-/.test(snap1));

boot(); walkWizard({ days: 5, prefs: ['酒庄品鉴'], pace: '轻松', scope: '含银川周边' });
const snap3 = pageSnap();
ok('换一组条件 → 快照不同（排除快照恒等）', snap3 !== snap1);

/* 范围步骤的选项说明应随数据包自动变化（不是写死的数字） */
function countsOf(packs) {
  let n = 0; const d = {};
  packs.forEach(id => {
    const p = global.CITY_DATA[id];
    if (!p) return;
    (p.attractions || []).forEach(a => { n++; if (a.district) d[a.district] = true; });
  });
  return n + ' 处景点 · ' + Object.keys(d).length + ' 个区县';
}
boot();
clickOpt('3 天'); clickOpt('第一次来'); click('nextBtn'); clickOpt('标准');
const scopeDescs = nodes['opts'].children.map(c => c.children[1].textContent);
ok('范围选项的景点数与区县数由数据包实时算出',
  scopeDescs[0] === countsOf(['yinchuan']) && scopeDescs[1] === countsOf(['yinchuan', 'nearby']),
  scopeDescs.join('  |  '));

/* 全偏好 + 紧凑 + 8 天，含周边时周边点位应被纳入（逐天翻页把 8 天都看一遍） */
boot(); walkWizard({ days: 8, prefs: ALL_PREFS, pace: '紧凑', scope: '含银川周边' });
ok('8 天行程仍是一次只展示一天', dayCardCount() === 1 && navTotal() === 8, dayCardCount() + ' 张 / 共 ' + navTotal() + ' 天');
const wide = walkDays().join(' ');
ok('含周边时沙湖 / 青铜峡 / 一百零八塔可被纳入',
  /沙湖生态旅游区/.test(wide) && /青铜峡/.test(wide) && /一百零八塔/.test(wide));
boot(); walkWizard({ days: 8, prefs: ALL_PREFS, pace: '紧凑', scope: '银川市全域' });
const narrow = walkDays().join(' ');
ok('限定市域时周边点位不会出现',
  !/沙湖生态旅游区/.test(narrow) && !/青铜峡/.test(narrow) && !/一百零八塔/.test(narrow));

/* ================= 7. 回退与重规划 ================= */
console.log('\n=== 7. 回退与重规划 ===');
/* 先在一个已知条件上走完一遍，再点「重新规划」 */
boot();
walkWizard({ days: 5, prefs: ['酒庄品鉴'], pace: '轻松', scope: '含银川周边' });
ok('前置条件生成了 5 天行程', navTotal() === 5 && dayCardCount() === 1, navTotal() + ' 天 / 当前显示 ' + dayCardCount() + ' 张');

click('restart');
ok('点「重新规划」回到向导', nodes['wizard'].style.display === 'block' && nodes['result'].style.display === 'none');
ok('结果区内容已清空', dayCardCount() === 0 && nodes['cond'].innerHTML === '');
ok('回到第 1 步', stepNow() === 0);
ok('已选条件仍保留（面包屑）',
  nodes['picked'].innerHTML.indexOf('5 天') >= 0 && nodes['picked'].innerHTML.indexOf('酒庄品鉴') >= 0);

clickOpt('3 天'); clickOpt('第一次来');
ok('重选天数后偏好仍记忆（1 项高亮）', onCount() === 1, onCount() + ' 项');
click('nextBtn');
clickOpt('紧凑');
clickOpt('银川市全域');
click('nextBtn');
ok('只改天数与节奏也能重新生成', navTotal() === 3 && dayCardCount() === 1, navTotal() + ' 天');
ok('条件回顾已更新为「紧凑」', nodes['cond'].innerHTML.indexOf('紧凑') >= 0);

/* 从第 5 步点「上一步」回到范围步骤，且原选项仍高亮 */
console.log('\n=== 8. 步骤条与「上一步」 ===');
click('restart');
walkWizard({ days: 2, prefs: ['亲子友好'], pace: '标准', scope: '含银川周边' });
click('restart');
clickOpt('2 天'); clickOpt('第一次来');
click('nextBtn');
clickOpt('标准');
clickOpt('含银川周边');
click('back');
ok('从住宿步骤「上一步」回到范围步骤', stepNow() === 4, '当前 index=' + stepNow());
ok('范围原选项仍高亮', onCount() === 1, onCount() + ' 项');

/* 重新规划后，已答过的步骤都能直接点回去，不必从头再答 */
click('restart');
ok('回到第 1 步', stepNow() === 0);
const bar = nodes['stepsBar'].children;
ok('已答步骤标记为可跳转（6 个中 5 个已答）',
  bar.filter(c => c.className.indexOf('past') >= 0).length === 5,
  bar.map(c => c.textContent + '(' + c.className + ')').join(' '));
ok('已答步骤可点击', typeof bar[1].onclick === 'function');
bar[5].onclick();
ok('点步骤条可直接跳到住宿步骤', stepNow() === 5, '当前 index=' + stepNow());
ok('直接跳过后生成行程仍能沿用已有答案', nodes['qTitle'].textContent.indexOf('你住哪') >= 0);

/* ================= 9. 未答项兜底 ================= */
console.log('\n=== 9. 未答项兜底 ===');
boot();
const freshBar = nodes['stepsBar'].children;
ok('全新进入时后 5 步均不可点击',
  freshBar.slice(1).every(c => c.className.indexOf('past') < 0 && c.onclick === null),
  freshBar.map(c => c.textContent + '(' + c.className + ')').join(' '));
clickOpt('3 天'); clickOpt('第一次来');
click('nextBtn');          // 偏好还没选就点（真实界面是禁用态，这里模拟异常路径）
clickOpt('标准');
clickOpt('银川市全域');
click('nextBtn');          // 生成 → finish() 应发现偏好未答并送回第 3 步
ok('缺偏好时被送回偏好步骤', stepNow() === 2, '当前 index=' + stepNow());
ok('未生成行程', dayCardCount() === 0);

/* ================= 10. 「已在路上」流程：同样当场算、同样可复现 ================= */
console.log('\n=== 10. 「已在路上 · 从此刻重排」流程 ===');
/* 走完动态向导：位置 → 时间(自动) → 已去过(可跳过) → 兴趣 → 收工(自动出结果) */
function walkNow(o) {
  click('modeNow');
  click('nextBtn');                       // 位置 → 时间
  clickOpt(o.at);                         // 时间 → 已去过（自动推进）
  (o.visited || []).forEach(v => clickOpt(v));
  (o.prefsOff || []).forEach(p => clickOpt(p));
  click('nextBtn');                       // 已去过 → 兴趣
  click('nextBtn');                       // 兴趣 → 收工
  clickOpt(o.pace);
}
const NOW_PICKS = { at: '现在 14:00', visited: [], prefsOff: [], pace: '到 19:00' };

boot(); walkNow(NOW_PICKS);
ok('动态流程生成今天的行程', dayCardCount() === 1, dayCardCount() + ' 张');
ok('只有一天时不显示分页条（避免「1 / 1」这种无意义分页）', navText() === '', navText() || '（无分页条）');
ok('产出「现在还能去哪」卡', /现在还能去哪/.test(textOf(nodes['cand'])));
ok('产出「去不了」及原因', /这些暂时去不了/.test(textOf(nodes['cand'])));
ok('时间轴从选择的时刻起算', /14:00/.test(textOf(nodes['days'])));
ok('午后出发不插午餐', !/午餐/.test(textOf(nodes['days'])));
ok('候选统计已展示', /处现在还进得去/.test(textOf(nodes['nowInfo'])), textOf(nodes['nowInfo']).trim().slice(0, 80));

const nowSnap1 = pageSnap();
boot(); walkNow(NOW_PICKS);
const nowSnap2 = pageSnap();
ok('同一时刻走两次，整页 DOM 逐字节一致', nowSnap1 === nowSnap2, nowSnap1.length + ' 字符');

boot(); walkNow(Object.assign({}, NOW_PICKS, { at: '16:00' }));
const nowSnap3 = pageSnap();
ok('把「现在」改到 16:00 → 快照随之改变', nowSnap3 !== nowSnap1);

boot(); walkNow(Object.assign({}, NOW_PICKS, { visited: ['西夏陵'] }));
const nowSnap4 = pageSnap();
ok('把西夏陵标为已去过 → 快照随之改变', nowSnap4 !== nowSnap1);
ok('已去过的点位不再出现在行程里', !/西夏陵/.test(textOf(nodes['days'])));
ok('面包屑记录已去过 1 处',
  nodes['picked'].innerHTML.indexOf('已去过') >= 0 && nodes['picked'].innerHTML.indexOf('1 处') >= 0,
  nodes['picked'].innerHTML);

boot(); walkNow(Object.assign({}, NOW_PICKS, { pace: '到 23:00' }));
ok('收工推到 23:00 后，行程结束时刻变晚',
  nowSnap4 !== pageSnap() && /2[0-3]:\d\d/.test(textOf(nodes['days'])),
  (textOf(nodes['days']).match(/\d\d:\d\d–\d\d:\d\d/) || ['-'])[0]);

boot(); walkNow(Object.assign({}, NOW_PICKS, { at: '21:00', pace: '到 18:00' }));
ok('时间已过收工时刻 → 明确提示排不出', /排不出行程/.test(textOf(nodes['notice'])),
  textOf(nodes['notice']).trim().slice(0, 60));

/* ================= 11. 逐日翻页：看完一天再点「下一天」 ================= */
console.log('\n=== 11. 逐日翻页 ===');
boot(); walkWizard({ days: 3, prefs: ['人文历史'], pace: '标准', scope: '银川市全域' });
const d1 = daysText();
ok('初始停在第 1 天', navCur() === 1 && dayCardCount() === 1, navText());
ok('第 1 天内容含「Day 1」', /Day 1/.test(d1), d1.slice(0, 50));

click('nextDay');
const d2 = daysText();
ok('点「下一天」翻到第 2 天', navCur() === 2, navText());
ok('页面仍只有一张日卡片', dayCardCount() === 1, dayCardCount() + ' 张');
ok('第 2 天内容与第 1 天不同，且标为「Day 2」', d2 !== d1 && /Day 2/.test(d2), d2.slice(0, 50));

click('nextDay');
const d3 = daysText();
ok('再点一次翻到第 3 天', navCur() === 3 && /Day 3/.test(d3), navText());
ok('最后一天时按钮文案改为「已是最后一天」', /已是最后一天/.test(navText()));
ok('最后一天提示回看或重新规划', /最后一天/.test(navText()) && /重新规划/.test(navText()));

click('nextDay');
ok('在最后一天再点「下一天」不会越界', navCur() === 3 && daysText() === d3, navText());

click('prevDay');
ok('点「上一天」回到第 2 天，内容与之前一致', navCur() === 2 && daysText() === d2, navText());
click('prevDay');
ok('回到第 1 天，内容与最初逐字符一致', navCur() === 1 && daysText() === d1);
click('prevDay');
ok('在第 1 天再点「上一天」不会越界', navCur() === 1, navText());

click('dayGo-2');
ok('点日期圆点可直接跳到第 3 天', navCur() === 3 && daysText() === d3, navText());
click('dayGo-0');
ok('点圆点回到第 1 天', navCur() === 1 && daysText() === d1);

/* 翻页不影响结果本身：翻到第 3 天时，整页快照仍应可复现 */
const pageSnapA = pageSnap();
click('dayGo-2'); click('dayGo-0');
ok('来回翻页后快照回到原样（翻页不改变结果）', pageSnap() === pageSnapA);

/* 重新生成行程后回到第 1 天 */
click('dayGo-2');
ok('翻页后停在最后一天', navCur() === 3);
click('restart');
clickOpt('3 天'); clickOpt('第一次来'); click('nextBtn'); clickOpt('标准'); clickOpt('银川市全域'); click('nextBtn');
ok('重新生成后回到第 1 天', navCur() === 1 && navTotal() === 3, navText());

/* 「已在路上」排 2 天时同样分页 */
boot(); walkNow({ at: '现在 14:00', visited: [], prefsOff: [], pace: '到 19:00' });
ok('动态模式只有今天时不显示分页条', navText() === '');
click('addTom');
ok('顺带排明天后出现分页条（第 1 / 2 天）', navCur() === 1 && navTotal() === 2, navText());
click('nextDay');
ok('点「下一天」看到明天，且第二天从正常出发时刻起算', navCur() === 2 && /0[89]:\d\d–/.test(daysText()),
  daysText().slice(0, 50));
click('prevDay');
ok('点「上一天」回到今天', navCur() === 1 && /14:00/.test(daysText()), daysText().slice(0, 40));

console.log('\n' + (fail === 0 ? '✓ 全部通过（' + pass + ' 项）' : '✗ 失败 ' + fail + ' 项 / 共 ' + (pass + fail) + ' 项'));

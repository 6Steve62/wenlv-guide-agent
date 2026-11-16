/* =============================================================================
 * 攻略弹窗链路验证 · 文旅导览智能体
 *
 * 引擎侧的 spotGuide() 由 test/spot-guide.js 覆盖；这个脚本管界面侧的那一半：
 *   ① 结果页的景点名是不是真的可点（HTML 里带 spotname 入口 + 点击上下文）
 *   ② 点下去是否真的打开弹窗、内容是否按段渲染齐全
 *   ③ 关闭方式（× / 遮罩 / Esc）是否都能关掉
 *   ④ 弹窗内容是否随「本次行程上下文」变化（压缩提示、已去过、已在行程中）
 *
 * 运行：node test/guide-panel.js   （在任意目录下均可，路径按 __dirname 解析）
 * ========================================================================== */
const fs = require('fs');
global.window = global;

/* ---------- DOM 桩 ----------
 * 与 determinism.js 同一套路，另加三样界面侧真正用到的东西：
 *   document.body（弹窗要锁滚动）、addEventListener（Esc 关闭）、
 *   可记录事件的 style / className。innerHTML 的 setter 仍清空 children，
 *   因此「重复渲染不累积节点」这一约定在这里同样被检查。
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
const listeners = [];
global.document = {
  body: mk('body'),
  getElementById(id) { return nodes[id] || (nodes[id] = mk(id)); },
  createElement() { return mk(''); },
  addEventListener(type, fn) { listeners.push({ type, fn }); }
};
Object.defineProperty(global, 'navigator', { configurable: true, value: {} });
global.setTimeout = fn => { fn(); return 0; };
global.__CLOCK__ = { min: 14 * 60, dow: 5 };
global.__EXPOSE_APP__ = true;   // 让 app.js 把弹窗函数挂到 window.__APP__

const ROOT = __dirname + '/../';
const APP_SRC = fs.readFileSync(ROOT + 'js/app.js', 'utf8');
['data/cats.js', 'data/yinchuan.js', 'data/nearby.js', 'data/lodging.js', 'js/engine.js']
  .forEach(f => eval(fs.readFileSync(ROOT + f, 'utf8')));
eval(APP_SRC);

const E = global.Engine, APP = global.__APP__;
const LOD = global.CITY_DATA.lodging.lodgings;
const ALL_PREFS = ['人文历史', '自然风光', '摄影出片', '亲子友好', '美食体验', '酒庄品鉴', '科普研学', '红色研学', '轻松休闲'];
const city = E.buildCity(['yinchuan', 'nearby']);
const pick = id => E.toBase(LOD.filter(x => x.id === id)[0], city);
const base = pick('lod-xinhua');

let pass = 0, fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + n + (x ? '   → ' + x : '')); c ? pass++ : fail++; };
const panel = () => nodes['guidePanel'].innerHTML;
const opened = () => nodes['guide'].className.indexOf('on') >= 0;

/* 界面拿到的 plan 形状就是 { city, built:[{ d, tl }] } */
function buildPlan(patch) {
  const r = E.plan(city, Object.assign({ days: 3, prefs: ALL_PREFS, pace: 'normal', base }, patch || {}));
  const use = r.city || city;
  return { city: use, built: r.days.map(d => ({ d: d, tl: E.timeline(use, d, r.W) })) };
}

console.log('=== 1. 结果页的景点名是弹窗入口 ===');
const plan = buildPlan();
const visitIdx = plan.built[0].tl.ev.findIndex(e => e.k === 'visit');
const firstSpot = plan.built[0].tl.ev[visitIdx].a;
ok('拿到了可点的第一站', !!firstSpot && visitIdx > 0, 'Day 1 第 ' + visitIdx + ' 个事件：' + firstSpot.name);

APP.openSpotGuide(plan, 0, visitIdx);
ok('打开后弹窗容器进入 on 状态', opened(), nodes['guide'].className);
ok('页面加了滚动锁 guide-open', document.body.className.indexOf('guide-open') >= 0, document.body.className);
ok('面板渲染出了内容', panel().length > 600, panel().length + ' 字符');
ok('标题是这一站的景点名', panel().indexOf('>' + firstSpot.name + '<') >= 0);
ok('带有区县与玩法标签', panel().indexOf(firstSpot.district) >= 0 && panel().indexOf('白天游览') >= 0);

['这是什么地方', '核心看点', '本次行程中的安排', '关键信息', '怎么过去', '同片区可串起来一起去',
 '就近用餐', '出行提示', '门票', '开放时间', '坐标'
].forEach(sec => {
  ok('渲染了「' + sec + '」', panel().indexOf(sec) >= 0);
});

console.log('\n=== 1b. 版式：一图 + 三层信息 ===');
const VIS = global.CAT_VISUALS, cat = VIS[firstSpot.cat];
ok('卡里有品类题图，且用的正是字典里那一幅插画（第 ' + firstSpot.cat + ' 类）',
  !!cat && panel().indexOf(cat.art) >= 0);
ok('题图区带品类名与景点名压条',
  panel().indexOf('class="ghero"') >= 0 && panel().indexOf('class="gband"') >= 0 &&
  panel().indexOf('>' + cat.label + '<') >= 0);
/* 折起来的必须是「一开始不需要读的」那几段；一眼要看完的三段不能被折叠挡住 */
const foldAt = panel().indexOf('<details');
const headAt = panel().indexOf('关键信息');
ok('「关键信息」在折叠之前（不用展开就看到）', foldAt > 0 && headAt > 0 && headAt < foldAt,
  '关键信息 @' + headAt + '，首个折叠 @' + foldAt);
const mustSee = ['这是什么地方', '核心看点', '本次行程中的安排'];
ok('常读三段都在折叠之前',
  mustSee.every(t => { const i = panel().indexOf(t); return i > 0 && i < foldAt; }),
  mustSee.join(' / '));
ok('收起的是「怎么过去 · 顺路与用餐」与「出行提示」两组',
  (panel().match(/<details class="gfold">/g) || []).length === 2,
  (panel().match(/<details class="gfold">/g) || []).length + ' 组');

console.log('\n=== 2. 本次行程上下文真的进了卡里 ===');
const ev = plan.built[0].tl.ev[visitIdx];
ok('写出「到访 → 离开」与 Days/站序',
  panel().indexOf(E.fmtHM(ev.from)) >= 0 && panel().indexOf(E.fmtHM(ev.to)) >= 0 &&
  panel().indexOf('Day 1') >= 0 && panel().indexOf('第 1 / ') >= 0);
ok('实际停留分钟数与时间轴一致', panel().indexOf('实际停留 <b>' + (ev.to - ev.from) + ' 分钟</b>') >= 0,
  ev.to - ev.from + ' 分钟');
ok('压缩/未压缩的说法与事实一致',
  /被压缩了/.test(panel()) === (ev.stay != null && ev.stay < firstSpot.stay),
  ev.stay + ' / 建议 ' + firstSpot.stay);
ok('衔接点用时间轴里的地名（首站则写「从驻点直接出发」）',
  /从驻点直接出发（车程 \d+ 分钟）|前一站：/.test(panel()) &&
  /下一站：|之后返程回驻点|这是当天的最后一站/.test(panel()));
ok('「已在行程中」的标记出现（同片区有其它站点时）',
  (panel().indexOf('已在本次行程中') >= 0) ===
  plan.built[0].tl.ev.some(e => e.k === 'visit' && e.a.id !== firstSpot.id));

console.log('\n=== 3. 措辞：回驻点不能说成「顺路去驻点」 ===');
const baseName = plan.city.base.name;
const y0 = plan.built[0];
const visits0 = y0.tl.ev.map((e, i) => [e, i]).filter(([e]) => e.k === 'visit');
const lastVisit = visits0[visits0.length - 1];
APP.openSpotGuide(plan, 0, lastVisit[1]);
ok('不会把「返回驻点」写成「顺路去驻点」',
  panel().indexOf('顺路去「' + baseName) < 0, '驻点：' + baseName);
const moreVisits = y0.tl.ev.slice(lastVisit[1] + 1).some(e => e.k === 'visit');
ok('当天最后一站的说法两种都通顺（末站 / 返程回驻点）',
  moreVisits || panel().indexOf('这是当天的最后一站') >= 0 || panel().indexOf('之后返程回驻点') >= 0,
  moreVisits ? '该站之后还有一站，走「下一站」分支' : '末站分支');
APP.openSpotGuide(plan, 0, visits0[0][1]);
ok('当天第一站不重复写「接在驻点之后」',
  panel().indexOf('接在「' + baseName + '」之后') < 0 && panel().indexOf('从驻点直接出发') >= 0);

console.log('\n=== 4. 三种关闭方式 ===');
APP.closeGuide();
ok('closeGuide() 能关掉', !opened());
ok('关闭后滚动锁解除', document.body.className.indexOf('guide-open') < 0, '「' + document.body.className + '」');

APP.openSpotGuide(plan, 0, visitIdx);
const closeBtn = nodes['guideClose'];
ok('面板里渲染了关闭按钮', !!closeBtn, 'id=guideClose');
closeBtn.onclick();
ok('点 × 能关掉', !opened());

APP.openSpotGuide(plan, 0, visitIdx);
nodes['guideMask'].onclick();
ok('点遮罩能关掉', !opened());

const escListener = listeners.filter(l => l.type === 'keydown')[0];
ok('注册了键盘监听', !!escListener);
APP.openSpotGuide(plan, 0, visitIdx);
escListener.fn({ key: 'Escape' });
ok('按 Esc 能关掉', !opened());

console.log('\n=== 5. 换景点 / 换上下文，内容随之变化 ===');
APP.openSpotGuide(plan, 0, visitIdx);
const snapshot = panel();
const idx2 = plan.built[0].tl.ev.map((e, i) => [e, i])
  .filter(([e]) => e.k === 'visit')[1];
if (idx2) {
  APP.openSpotGuide(plan, 0, idx2[1]);
  ok('换一天里的第二站 → 面板内容改变', panel() !== snapshot,
    firstSpot.name + ' → ' + idx2[0].a.name);
} else {
  const other = plan.built[1] ? plan.built[1].tl.ev.findIndex(e => e.k === 'visit') : -1;
  APP.openSpotGuide(plan, other > 0 ? 1 : 0, other > 0 ? other : visitIdx);
  ok('换到另一天 → 面板内容改变', panel() !== snapshot || other <= 0);
}

const planNight = buildPlan({ days: 2, prefs: ['美食体验'], pace: 'relax' });
const nightIdx = planNight.built[0].tl.ev.findIndex(e => e.k === 'visit');
APP.openSpotGuide(planNight, 0, nightIdx);
ok('换一组条件后仍能正常出卡', opened() && panel().length > 600, panel().length + ' 字符');

console.log('\n=== 6. 边界 ===');
const before = panel();
APP.openSpotGuide(plan, 0, 9999);        // 不存在的事件序号
ok('事件序号越界时不炸、不改内容', panel() === before, '仍是上一张卡');
APP.openSpotGuide(plan, 99, 0);          // 不存在的天
ok('天序号越界时不炸', panel() === before);
APP.openSpotGuide(null, 0, 0);
ok('plan 为 null 时不炸', panel() === before);
APP.openSpotGuide(plan, 0, -1);
ok('负索引不炸', panel() === before);

APP.openSpotGuide(plan, 0, visitIdx);
ok('重新打开后内容与第一次逐字节一致（无随机量）', panel() === snapshot, panel().length + ' 字符');

const guideSrc = APP_SRC.slice(APP_SRC.indexOf('function guideHtml'), APP_SRC.indexOf('供 test/'));
ok('guideHtml 不读时间、不用随机数',
  !/new Date|Date\.now|Math\.random/.test(guideSrc));

console.log('\n' + (fail === 0 ? '✓ 全部通过' : '✗ 有 ' + fail + ' 项未通过') + '（' + pass + ' 项）');
process.exit(fail ? 1 : 0);

/* =============================================================================
 * 地图图例 ↔ 下方时间轴的联动 · 文旅导览智能体
 *
 * 锁的是一类「两个视角各说各话」的界面缺陷：
 * 地图卡片上方有 Day 图例，下方是当天的时间轴卡片。点图例只看某一天时，
 * 如果只让地图收紧、不通知下方，用户就会看到「地图在说 Day 2、")
 * 下面还写着 Day 1」——数据全对，读起来却是自相矛盾。
 *
 * 判据三条（缺一不可）：
 *   ① 点图例 Day N → 下方日卡片与分页条一起翻到第 N 天
 *   ② 点图例 Day N 得到的内容，与点「下一天」翻过去的内容逐字节相同
 *      （图例只是另一个入口，不该有自己的一套渲染口径）
 *   ③ 再点一次同一档回「全部」时，地图恢复全景，但下方**不倒退**——
 *      「全部」是地图视角，不等于「回到第 1 天」
 *
 * 运行：node test/map-sync.js   （在任意目录下均可，路径按 __dirname 解析）
 * ========================================================================== */
'use strict';
const fs = require('fs');
global.window = global;

/* ---------- DOM 桩：与 wizard-ui.js 同一套约定，补上地图需要的浏览器 API ---------- */
const nodes = {};
function mk(id) {
  const e = {
    id, style: {}, _h: '', textContent: '', className: '', value: '', label: '',
    disabled: false, dataset: {}, children: [], onclick: null, onchange: null, hidden: false,
    clientWidth: 820, clientHeight: 520, offsetWidth: 820, offsetHeight: 520,
    appendChild(c) { this.children.push(c); return c; },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    addEventListener() {},
    removeEventListener() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 820, height: 520 }; },
    classList: { contains() { return false; }, add() {}, remove() {}, toggle() {} },
    scrollIntoView() {}
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
global.scrollTo = function () {};
global.__CLOCK__ = { min: 14 * 60, dow: 5 };

const ROOT = __dirname + '/../';
['data/cats.js', 'data/yinchuan.js', 'data/nearby.js', 'data/lodging.js',
 'data/basemap.js', 'js/engine.js', 'js/map.js', 'js/app.js']
  .forEach(f => eval(fs.readFileSync(ROOT + f, 'utf8')));

let pass = 0, fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + n + (x ? '   → ' + x : '')); c ? pass++ : fail++; };

/* ---------- 交互辅助 ---------- */
function host() { return nodes['opts']; }
function clickOpt(label) {
  const o = host().children.find(c => c.children[0] && c.children[0].textContent === label);
  if (!o) throw new Error('找不到选项「' + label + '」，当前是：' +
    host().children.map(c => c.children[0] && c.children[0].textContent).join(' / '));
  o.onclick();
}
function click(id) { const n = nodes[id]; if (n && n.onclick) n.onclick(); }

/* 日卡片 / 分页条 / 地图 SVG / 图例：都是被 innerHTML 写进容器的字符串 */
function dayCard() { return (nodes['days'].children[0] || {}).innerHTML || ''; }
function navHtml() { return (nodes['dayNav'].children[0] || {}).innerHTML || ''; }
function mapSvg() { return nodes['mvwrap'].innerHTML || ''; }
function legendHtml() { return nodes['mvlegend'].innerHTML || ''; }
function countIn(s, needle) { return s.split(needle).length - 1; }
const legsIn = svg => countIn(svg, 'class="mv-leg-hit"');
const stopsIn = svg => countIn(svg, 'class="mv-stop"');
const legendOn = () => (legendHtml().match(/class="mv-lg on" data-day="(\d+)"/g) || [])
  .map(s => +s.match(/data-day="(\d+)"/)[1]);

/* 图例按钮桩：closestBy 只需要 nodeType / classList.contains / getAttribute */
function lgBtn(d) {
  return {
    nodeType: 1,
    classList: { contains: c => c === 'mv-lg' },
    getAttribute: k => (k === 'data-day' ? String(d) : null)
  };
}
function clickLegend(d) { nodes['mvlegend'].onclick({ target: lgBtn(d) }); }

/* ---------- 走到结果页：3 天 / 两项偏好 / 标准节奏 / 含周边 ---------- */
clickOpt('3 天');
clickOpt('第一次来');
clickOpt('人文历史');
clickOpt('自然风光');
click('nextBtn');
clickOpt('标准');
clickOpt('含银川周边');
click('nextBtn');                       /* 住宿步骤：默认驻点 → 生成行程 */

console.log('=== 1. 结果页默认停在第 1 天 ===');
ok('结果页已生成', nodes['result'].style.display === 'block');
ok('日卡片是 Day 1', /Day 1/.test(dayCard()), (dayCard().match(/Day \d/) || [])[0]);
ok('分页条写着第 1 / 3 天', /第 <b>1<\/b> \/ 3 天/.test(navHtml()));
ok('图例三档且全部高亮（默认「全部」视角）',
  legendOn().join(',') === '0,1,2', legendOn().join(','));

const day1Html = dayCard();
const allSvg = mapSvg();
const allLegs = legsIn(allSvg), allStops = stopsIn(allSvg);
ok('全景视图确实画出连线与节点', allLegs > 0 && allStops > 0,
  allLegs + ' 段 / ' + allStops + ' 站');

console.log('\n=== 2. 点图例 Day 2 → 下方时间轴一起翻过去 ===');
clickLegend(1);
ok('日卡片翻到 Day 2', /Day 2/.test(dayCard()) && !/Day 1/.test(dayCard()),
  (dayCard().match(/Day \d/) || [])[0]);
ok('分页条同步到第 2 / 3 天', /第 <b>2<\/b> \/ 3 天/.test(navHtml()),
  (navHtml().match(/第 <b>\d<\/b> \/ \d 天/) || [])[0]);
ok('图例只剩 Day 2 高亮', legendOn().join(',') === '1', legendOn().join(','));
ok('地图收紧到当天（连线数少于全景）', legsIn(mapSvg()) > 0 && legsIn(mapSvg()) < allLegs,
  legsIn(mapSvg()) + ' 段 < ' + allLegs + ' 段');
ok('地图只画当天节点', stopsIn(mapSvg()) > 0 && stopsIn(mapSvg()) < allStops,
  stopsIn(mapSvg()) + ' 站 < ' + allStops + ' 站');

console.log('\n=== 3. 等价性：图例切换 == 翻页切换（同一套渲染口径）===');
const dayByLegend = dayCard(), navByLegend = navHtml();
click('dayGo-0');                       /* 圆点回第 1 天 */
ok('点圆点回第 1 天', /Day 1/.test(dayCard()), (dayCard().match(/Day \d/) || [])[0]);
click('nextDay');                       /* 翻到第 2 天 */
ok('「下一天」翻到的日卡片与点图例得到的逐字节相同',
  dayCard() === dayByLegend, dayCard() === dayByLegend ? dayCard().length + ' 字节' : '不一致');
ok('两种入口的分页条也一致', navHtml() === navByLegend);

console.log('\n=== 4. 再点同一档回「全部」：地图复位，下方不倒退 ===');
clickLegend(1);
ok('图例恢复三档全亮', legendOn().join(',') === '0,1,2', legendOn().join(','));
ok('地图回到全景（连线数与初始一致）', legsIn(mapSvg()) === allLegs,
  legsIn(mapSvg()) + ' / ' + allLegs);
ok('下方仍停在第 2 天，不会被拖回第 1 天', /Day 2/.test(dayCard()),
  (dayCard().match(/Day \d/) || [])[0]);

console.log('\n=== 5. 图例切换不改变行程数据 ===');
clickLegend(2);
ok('点 Day 3 → 下方翻到第 3 天', /Day 3/.test(dayCard()), (dayCard().match(/Day \d/) || [])[0]);
click('dayGo-0');
ok('切回第 1 天，日卡片与最初逐字节相同（只换了视角，没换行程）',
  dayCard() === day1Html, dayCard().length + ' 字节');

console.log('\n' + '-'.repeat(60));
if (fail === 0) {
  console.log('全部通过（' + pass + ' 项）');
  process.exit(0);
} else {
  console.log(pass + ' 通过 / ' + fail + ' 失败');
  process.exit(1);
}

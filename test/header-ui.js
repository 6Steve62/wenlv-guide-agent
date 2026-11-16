/* =============================================================================
 * 页头版式 · 文旅导览智能体
 *
 * 锁两件事：
 *
 * 一、题字下面那一行「是什么」。它原先是一枚「赛道二 · 2.3 文旅导览智能体」胶囊 ——
 *     那是作品登记信息，摆在作品首页像一张海报的残标。现在改为三段提要，
 *     排版与上面那行题签（英文地名 + 中文点分）分开：题签是「在哪儿」，
 *     提要是「做什么」。这条断言防的是有人又把注册信息粘回首页。
 *
 * 二、品类带默认折叠。十一类铺开是两行半彩色胶囊，会把向导卡片挤到首屏之外，
 *     也盖过「先选偏好」这件正事。折叠的实现刻意只动 CSS 类、不动 DOM：
 *     展开再收起，`innerHTML` 必须逐字节不变 —— 否则多选一次就重建一遍节点，
 *     跟向导里踩过的那个坑是同一个。
 *
 * 运行：node test/header-ui.js   （在任意目录下均可，路径按 __dirname 解析）
 * ========================================================================== */
'use strict';
const fs = require('fs');
global.window = global;

/* ---------- DOM 桩：与 wizard-ui.js 同一套约定，另补 setAttribute/getAttribute ---------- */
const nodes = {};
function mk(id) {
  const e = {
    id, style: {}, _h: '', textContent: '', className: '', value: '', label: '',
    disabled: false, dataset: {}, children: [], _attrs: {},
    onclick: null, onchange: null,
    appendChild(c) { this.children.push(c); return c; },
    querySelectorAll() { return []; },
    setAttribute(k, v) { this._attrs[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null; }
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
const HTML = fs.readFileSync(ROOT + 'index.html', 'utf8');
const APP_SRC = fs.readFileSync(ROOT + 'js/app.js', 'utf8');
['data/cats.js', 'data/yinchuan.js', 'data/nearby.js', 'data/lodging.js', 'js/engine.js']
  .forEach(f => eval(fs.readFileSync(ROOT + f, 'utf8')));
window.__EXPOSE_APP__ = true;
eval(APP_SRC);

let pass = 0, fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + n + (x ? '   → ' + x : '')); c ? pass++ : fail++; };
const head = t => console.log('\n' + t);

/* =============================================================================
 * 一、题字下面那一行
 * ========================================================================== */
head('一、页头提单行');

ok('首页不再出现「赛道」字样（作品登记信息不该出现在作品页上）',
  HTML.indexOf('赛道') < 0);
ok('提示行换成三段式 .lede', /<p class="lede">/.test(HTML));

const lede = (HTML.match(/<p class="lede">([\s\S]*?)<\/p>/) || [, ''])[1];
const spans = (lede.match(/<span>([^<]*)<\/span>/g) || [])
  .map(s => s.replace(/<\/?span>/g, ''));
ok('三段提要是「推荐线路 / 讲背景看点 / 安排交通用餐停留」',
  spans.length === 3 &&
  /推荐线路/.test(spans[0]) && /看点/.test(spans[1]) && /交通/.test(spans[2]) && /用餐/.test(spans[2]),
  spans.join(' | '));
ok('颜色与边框不再有胶囊样式的残留定义',
  HTML.indexOf('.badge{') < 0 && HTML.indexOf('<span class="badge"') < 0);

/* =============================================================================
 * 二、品类带：默认折叠
 * ========================================================================== */
head('二、品类带默认折叠');

const host = nodes['catLegend'];
const legendHtml = () => nodes['catLegend']._h;

const counts = {};
let total = 0;
Object.keys(window.CITY_DATA || {}).forEach(k => {
  (window.CITY_DATA[k].attractions || []).forEach(a => { counts[a.cat] = (counts[a.cat] || 0) + 1; total++; });
});
const keys = Object.keys(counts).filter(k => window.CAT_VISUALS[k])
  .sort((a, b) => counts[b] - counts[a] || (a < b ? -1 : a > b ? 1 : 0));

function pills() {
  return (legendHtml().match(/<span class="catpill[^"]*"/g) || [])
    .map(s => s.replace('<span class="catpill', '').replace('"', ''));
}
function pillTexts() {
  return (legendHtml().match(/<span class="catpill[^"]*"[^>]*>([^<]*)<\/span>/g) || [])
    .map(s => s.replace(/^[^>]*>/, '').replace(/<\/span>$/, ''));
}
function btnHtml() { return (legendHtml().match(/<button class="catmore"[\s\S]*?<\/button>/) || [''])[0]; }

ok('首行写着「收录 N 处景点 · 分 M 类」，数字取自数据包',
  legendHtml().indexOf('收录 ' + total + ' 处景点 · 分 ' + keys.length + ' 类') >= 0,
  total + ' 处 / ' + keys.length + ' 类');
ok('品类胶囊数与品类数一致（一处没漏、也没重复）',
  pills().length === keys.length, pills().length + ' 个');
ok('胶囊按数量降序、并列按品类 id 字典序（同一份数据顺序固定）',
  pillTexts().join('|') === keys.map(k => window.CAT_VISUALS[k].label + ' ' + counts[k]).join('|'),
  pillTexts().slice(0, 3).join(' / '));

const folded = pills().filter(c => c.indexOf('is-fold') >= 0);
ok('默认只露前 5 类，其余收进折叠（10 类以上长起来就不该全铺开）',
  pills().length - folded.length === 5 && folded.length === keys.length - 5,
  (pills().length - folded.length) + ' 露 / ' + folded.length + ' 收');
ok('按钮写着「展开全部 M 类」且 aria-expanded=false',
  /展开全部 \d+ 类/.test(btnHtml()) && /aria-expanded="false"/.test(btnHtml()),
  btnHtml().replace(/<[^>]+>/g, ''));

/* =============================================================================
 * 三、点击展开 / 收起
 * ========================================================================== */
head('三、点击展开与收起');

const btn = nodes['catMore'];
ok('按钮挂了点击处理（不是纯装饰的胶囊）', !!(btn && btn.onclick));
const before = legendHtml();

if (btn && btn.onclick) {
  btn.onclick();
  ok('点一次：宿主加上 is-open，全部胶囊显示',
    host.className.indexOf('is-open') >= 0, 'class="' + host.className + '"');
  ok('点一次：按钮变「收起」，aria-expanded 同步为 true',
    btn.textContent === '收起' && btn.getAttribute('aria-expanded') === 'true',
    btn.textContent + ' / aria=' + btn.getAttribute('aria-expanded'));

  btn.onclick();
  ok('再点一次：is-open 撤掉，回到默认五类',
    host.className.indexOf('is-open') < 0, 'class="' + host.className + '"');
  ok('再点一次：文案与 aria 都复原',
    /展开全部 \d+ 类/.test(btn.textContent) && btn.getAttribute('aria-expanded') === 'false',
    btn.textContent + ' / aria=' + btn.getAttribute('aria-expanded'));
}

ok('展开再收起，品类带的 HTML 逐字节不变（折叠只动样式类，不重建节点）',
  legendHtml() === before,
  legendHtml().length + ' 字节');
ok('被折叠的始终是同一批胶囊：后 6 个，顺序不变',
  pills().slice(5).every(c => c.indexOf('is-fold') >= 0) &&
  pills().slice(0, 5).every(c => c.indexOf('is-fold') < 0));

/* =============================================================================
 * 四、边界：品类不超过五个时不该出现按钮
 * ========================================================================== */
head('四、少品类时不出现折叠按钮');

const backup = window.CITY_DATA;
const fakeCats = Object.keys(window.CAT_VISUALS).slice(0, 3);
const fake = { t: { attractions: fakeCats.map(c => ({ cat: c })) } };
window.CITY_DATA = fake;
window.__APP__.renderCatLegend();
ok('只有 3 类时不生成展开按钮（没有可收的东西就别给按钮）',
  /<button class="catmore"/.test(legendHtml()) === false &&
  legendHtml().indexOf('收录 3 处景点 · 分 3 类') >= 0,
  legendHtml().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());

window.CITY_DATA = backup;
window.__APP__.renderCatLegend();
ok('换回真实数据后，品类带与最初逐字节一致',
  legendHtml() === before);

console.log('\n' + (fail === 0 ? '全部通过（' + pass + ' 项）' : fail + ' 项未通过：' + pass + ' 通过 / ' + fail + ' 失败'));
process.exit(fail === 0 ? 0 : 1);

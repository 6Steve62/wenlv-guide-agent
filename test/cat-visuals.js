/* =============================================================================
 * 视觉品类验证 · 文旅导览智能体
 *
 * 这一层不是排程算法，但它有两个必须守住的硬约束，所以照样写成可复跑的脚本：
 *   ① 每一处景点都有合法品类 —— 否则界面上会出现一个没有配色的空位
 *   ② 插画零外部素材 —— 这是本作品「不依赖任何第三方服务」这条声明的一部分，
 *      一旦有人往里塞了一张 <image href="https://..."> 或 base64 位图，
 *      这条断言会立刻报警，而不是等到路演被问「这图哪来的」才发现
 *
 * 运行：node test/cat-visuals.js
 * ========================================================================== */
const fs = require('fs');
global.window = global;

const ROOT = __dirname + '/../';
['data/cats.js', 'data/yinchuan.js', 'data/nearby.js', 'js/engine.js']
  .forEach(f => eval(fs.readFileSync(ROOT + f, 'utf8')));

const CV = global.CAT_VISUALS;
const city = global.Engine.buildCity(['yinchuan', 'nearby']);
const spots = city.attractions;

let pass = 0, fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + n + (x ? '   → ' + x : '')); c ? pass++ : fail++; };

console.log('=== 1. 每处景点都有品类，每个品类都有插图 ===');
const known = Object.keys(CV).filter(k => k !== '_default');
const noCat = spots.filter(a => !a.cat);
const badCat = spots.filter(a => a.cat && known.indexOf(a.cat) < 0);
ok('45 处景点全部标了 cat（' + spots.length + ' 处）', noCat.length === 0,
  noCat.map(a => a.name).join('、') || '全部已标');
ok('标出的品类都在字典里（' + known.length + ' 类）', badCat.length === 0,
  badCat.map(a => a.name + '→' + a.cat).join('、') || '全部命中');

const byCat = {};
spots.forEach(a => { (byCat[a.cat] = byCat[a.cat] || []).push(a.name); });
const orphans = known.filter(k => !byCat[k]);
ok('没有「字典里有、数据里一处都没用」的空品类', orphans.length === 0, orphans.join('、') || '无空类');
const thin = known.filter(k => (byCat[k] || []).length < 2);
ok('每个品类至少 2 处（否则该合并，不值得单独一幅画）', thin.length === 0,
  thin.map(k => CV[k].label + ' ' + byCat[k].length).join('、') || '全部 ≥ 2');

console.log('\n=== 2. 字典字段完整、颜色合法 ===');
const HEX = /^#[0-9A-Fa-f]{6}$/;
const badField = [], badColor = [];
Object.keys(CV).forEach(k => {
  const v = CV[k];
  if (!v.label || !v.art) badField.push(k);
  if (!HEX.test(v.tint || '') || !HEX.test(v.wash || '') || !HEX.test(v.line || '')) badColor.push(k);
});
ok('每一类都有 label 与 art', badField.length === 0, badField.join('、') || '全部完整');
ok('每一类的 tint / wash / line 都是 6 位十六进制色', badColor.length === 0, badColor.join('、') || '全部合法');
const tints = known.map(k => CV[k].tint);
ok('各品类的强调色互不重复（' + tints.length + ' 个）',
  new Set(tints).size === tints.length, tints.join(' '));
const arts = known.map(k => CV[k].art);
ok('各品类的插画互不重复', new Set(arts).size === arts.length);

console.log('\n=== 3. 插画是完整、自洽、零外部引用的 SVG ===');
const badSvg = [], badView = [], external = [], scripty = [];
/* xmlns 是 SVG 的命名空间声明，形如 http://www.w3.org/2000/svg —— 它不是一个
   网络请求，必须先摘掉再查外部引用，否则每一幅都会被误报。 */
const stripNs = a => a.replace(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, '');
Object.keys(CV).forEach(k => {
  const a = CV[k].art;
  const body = stripNs(a);
  if (a.slice(0, 4) !== '<svg' || !/<\/svg>\s*$/.test(a)) badSvg.push(k);
  if (a.indexOf('viewBox="0 0 1200 450"') < 0) badView.push(k);
  if (/https?:|xlink:href|<image|data:image|url\(/.test(body)) external.push(k);
  if (/<script|onload=|onclick=/i.test(body)) scripty.push(k);
});
ok('每一幅都是闭合的 <svg>…</svg>（含 _default，共 ' + Object.keys(CV).length + ' 幅）',
  badSvg.length === 0, badSvg.join('、') || '全部闭合');
ok('视框统一为 1200×450（题图 16:6 恰好铺满，不留白）', badView.length === 0,
  badView.join('、') || '全部一致');
ok('零外部引用：没有 http(s)、没有 <image>、没有 base64 位图',
  external.length === 0, external.join('、') || '全部自绘');
ok('没有 <script> 或内联事件属性（它们是靠 innerHTML 注入页面的）',
  scripty.length === 0, scripty.join('、') || '干净');

console.log('\n=== 4. 兜底与取用 ===');
ok('_default 兜底款存在且带插画', !!CV._default && !!CV._default.art);
ok('未知品类回落到兜底款、不抛错',
  global.catVisual({ cat: '不存在的品类' }) === CV._default &&
  global.catVisual(null) === CV._default &&
  global.catVisual({}) === CV._default);
ok('已知品类取到的是它自己那一款',
  known.every(k => global.catVisual({ cat: k }) === CV[k]));
ok('装进 SVG 的插画字符串可直接内联（不含未转义的引号冲突）',
  Object.keys(CV).every(k => (CV[k].art.match(/"/g) || []).length % 2 === 0));

console.log('\n=== 5. 品类分布（供设计参考，不是断言） ===');
Object.keys(byCat).sort((a, b) => byCat[b].length - byCat[a].length).forEach(k => {
  console.log('  ' + CV[k].label.padEnd(5) + byCat[k].length + ' 处  ' + byCat[k].join('、'));
});

console.log('\n' + (fail === 0 ? '✓ 全部通过' : '✗ 有 ' + fail + ' 项未通过') + '（' + pass + ' 项）');
process.exit(fail ? 1 : 0);

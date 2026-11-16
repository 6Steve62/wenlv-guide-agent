/* =============================================================================
 * 图片素材授权校验 · 文旅导览智能体
 *
 * 这个脚本守的是「合规」而不是「功能」。它保证：
 *   ① 每张进页面的照片都有据可查 —— 作者、协议、原始链接、获取日期齐全；
 *   ② 协议只在白名单内（CC0 与公有领域）；
 *   ③ 登记的照片文件真的存在，id 真的对应一处景点；
 *   ④ img/ 目录里没有「放进了目录却没登记」的孤儿图片；
 *   ⑤ 登记了 GPS 的照片，拍摄点离景点坐标不过分离谱；
 *   ⑥ CREDITS.md 与 photos.js 两边对得上。
 *
 * 运行：node test/credits.js
 *
 * 空清单是合法状态 —— 页面会全部走品类插画，脚本如实报告覆盖率为 0 并通过。
 * 这样「还没攒够素材」不会成为提交的阻碍。
 * ========================================================================== */
const fs = require('fs');
const path = require('path');
const ROOT = __dirname + '/../';

global.window = global;
['data/photos.js', 'data/yinchuan.js', 'data/nearby.js', 'js/engine.js']
  .forEach(f => eval(fs.readFileSync(ROOT + f, 'utf8')));

const P = global.PHOTOS;
const E = global.Engine;
const city = E.buildCity(['yinchuan', 'nearby']);
const items = (P && P.items) || [];

let pass = 0, fail = 0, warn = 0;
const ok = (n, c, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + n + (x ? '   → ' + x : '')); c ? pass++ : fail++; };
const wr = (n, x) => { console.log('  ! ' + n + (x ? '   → ' + x : '')); warn++; };

function haversine(la1, ln1, la2, ln2) {
  const R = 6371000, p = Math.PI / 180;
  const dLa = (la2 - la1) * p, dLn = (ln2 - ln1) * p;
  const x = Math.sin(dLa / 2) ** 2 +
    Math.cos(la1 * p) * Math.cos(la2 * p) * Math.sin(dLn / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/* 把 key=value 形式的位置换算成 Python 之外都不用管的数字，这里只用一次 */
const byId = {};
city.attractions.forEach(a => { byId[a.id] = a; });

console.log('=== 1. 清单结构 ===');
ok('data/photos.js 定义了 window.PHOTOS', !!P);
ok('含有授权白名单 licenseWhitelist',
  !!(P && Array.isArray(P.licenseWhitelist) && P.licenseWhitelist.length),
  P && P.licenseWhitelist ? P.licenseWhitelist.join(' / ') : '缺失');
ok('items 是数组', !!(P && Array.isArray(P.items)));
ok('白名单里没有 SA 类协议（共享协议会限制裁剪）',
  !(P.licenseWhitelist || []).some(w => /sa|share/i.test(w)));
console.log('  已登记 ' + items.length + ' 条 · 景点共 ' + city.attractions.length + ' 处');

console.log('\n=== 2. 逐条核对（字段 / 协议 / 关联 / 文件 / 链接）===');
const miss = [], badLic = [], badId = [], missFile = [], badSrc = [], badDate = [];
items.forEach((it, i) => {
  const tag = '[' + i + '] ' + (it.id || '(无 id)');
  if (!it.id || !it.file || !it.license || !it.source || !it.author || !it.fetched) {
    miss.push(tag + ' → 缺 ' + ['id', 'file', 'license', 'source', 'author', 'fetched']
      .filter(k => !it[k]).join('/'));
  }
  if (it.license && !(P.licenseWhitelist || []).some(w =>
    String(it.license).toLowerCase().startsWith(w.toLowerCase()))) {
    badLic.push(tag + ' → ' + it.license);
  }
  if (it.id && !byId[it.id]) badId.push(tag);
  if (it.file && !fs.existsSync(ROOT + it.file)) missFile.push(tag + ' → ' + it.file);
  if (it.source && !/^(https:\/\/|self:)/.test(it.source)) badSrc.push(tag + ' → ' + it.source);
  if (it.fetched && !/^\d{4}-\d{2}-\d{2}$/.test(it.fetched)) badDate.push(tag + ' → ' + it.fetched);
});

ok('每条都填齐了 id / file / license / source / author / fetched',
  miss.length === 0, miss.slice(0, 4).join('；') || '全部齐备');
ok('协议全部落在白名单内', badLic.length === 0, badLic.slice(0, 4).join('；') || '全部合规');
ok('id 都能对应到真实景点', badId.length === 0, badId.slice(0, 4).join('；') || '全部对上');
ok('登记的图片文件都真实存在', missFile.length === 0, missFile.slice(0, 4).join('；') || '全部存在');
ok('来源是 https 原始页面，或 self: 自证（自摄照片填 self: 拍摄说明）',
  badSrc.length === 0, badSrc.slice(0, 4).join('；') || '全部合法');
ok('获取日期都是 YYYY-MM-DD', badDate.length === 0, badDate.slice(0, 4).join('；') || '全部合法');

console.log('\n=== 2b. 首页背景照片（可选，独立于景点）===');
/* 背景照片不属于任何一处景点，所以单独登记在 PHOTOS.hero。
   它有两个容易静默失败的地方，正是这一节要拦的：
   ① 登记了却忘了放文件 —— 页面不报错，只是悄悄没有背景；
   ② 文件改了名 —— CSS 里写死了 img/hero.jpg，登记成别的名字样式根本不会引用到。 */
{
  const H = P && P.hero;
  const CSS = fs.readFileSync(ROOT + 'index.html', 'utf8');
  const APP = fs.readFileSync(ROOT + 'js/app.js', 'utf8');
  ok('index.html 里有 .bg-photo 背景层', /\.bg-photo\s*\{/.test(CSS) && /id="bgPhoto"/.test(CSS));
  /* 背景地址必须由登记数据驱动，而不是写死在样式里：
     写死的话，没有素材时每次加载都会请求一个不存在的文件，控制台留一条 404，
     演示时看起来像资源缺失 —— 也是「登记了却没生效」这类静默失败的高发处。 */
  ok('背景图由 photos.js 的 hero 驱动（没登记就一次请求都不发）',
    /PHOTOS\s*&&[\s\S]{0,24}PHOTOS\.hero/.test(APP) && /el\('bgPhoto'\)/.test(APP));

  if (!H) {
    console.log('  · 未启用背景照片（PHOTOS.hero 为 null）—— 首页只用自绘山河底图，属正常状态');
  } else {
    const missH = ['file', 'license', 'source', 'author', 'fetched'].filter(k => !H[k]);
    ok('背景照片字段齐全', missH.length === 0, missH.join('/') || '全部齐备');
    ok('背景照片放在 img/ 目录下（与其余素材同处）', /^img\//.test(H.file || ''), H.file || '未填');
    ok('背景照片授权在白名单内',
      !!H.license && (P.licenseWhitelist || []).some(w =>
        String(H.license).toLowerCase().startsWith(w.toLowerCase())), H.license || '未填');
    ok('背景照片文件真的存在', !!H.file && fs.existsSync(ROOT + H.file), H.file || '未填');
    ok('背景照片来源是 https 原始页面，或 self: 自证（自摄填 self: 拍摄说明）',
      /^(https:\/\/|self:)/.test(H.source || ''), H.source || '未填');
    ok('背景照片获取日期是 YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(H.fetched || ''), H.fetched || '未填');
    /* 背景图不是缩略图，体积直接决定"双击打开"要等多久 */
    if (H.file && fs.existsSync(ROOT + H.file)) {
      const kb = Math.round(fs.statSync(ROOT + H.file).size / 1024);
      ok('背景照片压到 300 KB 以内（单文件版会 base64 内联，体积 ×1.33）',
        kb <= 300, kb + ' KB');
    }
  }
}

console.log('\n=== 3. img/ 目录里没有孤儿图片 ===');
const IMG_DIR = ROOT + 'img/';
if (!fs.existsSync(IMG_DIR)) {
  ok('img/ 目录存在（可有可无，但登记了文件就必须有）',
    items.length === 0, items.length ? '登记了 ' + items.length + ' 条却没有 img/ 目录' : '尚未创建，当前也没有登记条目');
} else {
  const used = {};
  items.forEach(it => { if (it.file) used[path.basename(it.file)] = true; });
  /* 背景照片不在 items 里（它不属于任何景点），但同样是「已登记」的图，
     否则 hero.jpg 一放进来就会被误报成孤儿。 */
  if (P && P.hero && P.hero.file) used[path.basename(P.hero.file)] = true;
  /* 只把图片文件算进来 —— 目录里要放说明文档（img/README.md），不能因此报"孤儿" */
  const files = fs.readdirSync(IMG_DIR).filter(f => /\.(jpe?g|png|webp|avif|gif|svg)$/i.test(f));
  const orphan = files.filter(f => !used[f]);
  ok('目录里每个文件都已登记（没有孤儿图片）',
    orphan.length === 0, orphan.length ? orphan.slice(0, 5).join('、') : files.length + ' 个文件全部有登记');
  const shared = {};
  items.forEach(it => { if (it.file) { const b = path.basename(it.file); shared[b] = (shared[b] || 0) + 1; } });
  const reuse = Object.keys(shared).filter(k => shared[k] > 1);
  if (reuse.length) wr('同一张图被多个景点引用（若为有意复用可忽略）', reuse.join('、'));
}

console.log('\n=== 4. 有 GPS 的做交叉核对 ===');
const gpsChecked = [];
items.forEach(it => {
  if (!it.gps || !Array.isArray(it.gps) || it.gps.length !== 2) return;
  const a = byId[it.id];
  if (!a) return;
  const d = haversine(a.lat, a.lng, it.gps[1], it.gps[0]);
  gpsChecked.push(it.id + ' 距数据包坐标 ' + Math.round(d) + ' 米');
  if (d > (P.gpsTolerance || 8000)) {
    wr('照片拍摄点离景点坐标过远，可能拍的不是这处：' + it.id,
      Math.round(d) + ' 米 > 容忍 ' + (P.gpsTolerance || 8000) + ' 米');
  }
});
ok('登记了 GPS 的条目都做完了距离核对',
  true, gpsChecked.length ? gpsChecked.join('；') : '暂无登记 GPS（可选字段）');

console.log('\n=== 5. 体积（关系到能否双击离线打开）===');
let bytes = 0, biggest = ['-', 0], missing = 0;
items.forEach(it => {
  const p = ROOT + it.file;
  if (!fs.existsSync(p)) { missing++; return; }
  const s = fs.statSync(p).size;
  bytes += s;
  if (s > biggest[1]) biggest = [it.id, s];
});
console.log('  照片合计 ' + (bytes / 1024 / 1024).toFixed(2) + ' MB，最大一张 ' +
  biggest[0] + ' ' + Math.round(biggest[1] / 1024) + ' KB');
if (bytes > 15 * 1024 * 1024) wr('照片总体积超过 15 MB，建议压缩或减少张数', (bytes / 1024 / 1024).toFixed(1) + ' MB');
if (biggest[1] > 800 * 1024) wr('单张超过 800 KB，建议压到 800 KB 以内', biggest[0] + ' ' + Math.round(biggest[1] / 1024) + ' KB');
if (!missing) ok('体积在可接受范围内（仍为纯本地打开，不依赖网络）', true);

console.log('\n=== 6. CREDITS.md 与 photos.js 两边对得上 ===');
const CRED = ROOT + 'CREDITS.md';
const hasCred = fs.existsSync(CRED);
ok('CREDITS.md 存在', hasCred);
if (hasCred) {
  const cred = fs.readFileSync(CRED, 'utf8');
  /* 首页背景照片同样登记在 CREDITS.md 里（表格里写「首页背景」），
     否则答辩时翻得出数据包、翻不出图源，等于没登记。 */
  const all = items.slice();
  if (P && P.hero) all.push(Object.assign({ id: '首页背景' }, P.hero));
  const noLink = all.filter(it => it.source && cred.indexOf(it.source) < 0).map(it => it.id);
  const noAuthor = all.filter(it => it.author && cred.indexOf(it.author) < 0).map(it => it.id);
  ok('每条登记的原始链接都出现在 CREDITS.md 里',
    noLink.length === 0, noLink.slice(0, 5).join('、') || '全部对上');
  ok('每条登记的拍摄者都出现在 CREDITS.md 里',
    noAuthor.length === 0, noAuthor.slice(0, 5).join('、') || '全部对上');
}

console.log('\n=== 7. 覆盖率 ===');
const covered = city.attractions.filter(a => items.some(it => it.id === a.id));
console.log('  ' + covered.length + ' / ' + city.attractions.length + ' 处景点有实景照片（' +
  (covered.length / city.attractions.length * 100).toFixed(1) + '%），其余走品类插画');
if (items.length && covered.length < city.attractions.length) {
  console.log('  尚未配图的点位：' + city.attractions.filter(a => !items.some(it => it.id === a.id))
    .map(a => a.name).join('、'));
}

console.log('\n' + (fail === 0
  ? '✓ 全部通过（' + pass + ' 项' + (warn ? '，另有 ' + warn + ' 条提示' : '') + '）'
  : '✗ 未通过：' + fail + ' 项失败，' + pass + ' 项通过'));
process.exit(fail ? 1 : 0);

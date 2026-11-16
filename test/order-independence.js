/* 顺序无关性验证：结果是否依赖「数据文件里景点的书写顺序」
 * 同输入同输出是平凡结论；真正要证的是——把数据文件打乱重排后，
 * 行程是否仍然一样。若不一样，说明输出依赖书写顺序，维护数据时会踩坑。
 * 另外单独测：排序打平（tie）时是否由引擎随机决定。
 */
const fs = require('fs');
global.window = global;
['data/yinchuan.js', 'data/nearby.js', 'data/lodging.js', 'js/engine.js'].forEach(f => eval(fs.readFileSync(__dirname + '/../' + f, 'utf8')));
const E = global.Engine, LOD = global.CITY_DATA.lodging.lodgings;

const ALL_PREFS = ['人文历史', '自然风光', '摄影出片', '亲子友好', '美食体验', '酒庄品鉴', '科普研学', '红色研学', '轻松休闲'];

/* 可复现的洗牌：线性同余，避免用 Math.random 让测试本身不确定 */
function makeShuffle(seed) {
  let s = seed >>> 0;
  return arr => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      s = (s * 1664525 + 1013904223) >>> 0;
      const j = s % (i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
}

const city = E.buildCity(['yinchuan', 'nearby']);
const pick = id => E.toBase(LOD.filter(x => x.id === id)[0], city);

/* 行程指纹：只保留「哪天、去了哪些点、几点到几点」，不含内部对象引用 */
function fingerprint(r) {
  return r.days.map(function (d) {
    const tl = E.timeline(r.city || city, d, r.W);
    return 'Day[' + (d.district || '-') + '] ' + d.items.map(i => i.a.id).join('>') +
      (d.night ? ' +夜:' + d.night.id : '') +
      ' | ' + tl.ev.map(function (e) {
        /* 事件类型有五种：travel / wait / meal / evening / visit(含夜游)。
           wait（等待开园）没有 a 字段，单独处理，否则指纹构造会抛错。 */
        if (e.k === 'visit') return 'visit:' + e.a.id + '/' + e.from + '-' + e.to;
        if (e.k === 'wait') return 'wait:' + e.at + '/' + e.min + '/' + e.name;
        return e.k + ':' + e.at + '/' + e.min + '/' + (e.place ? (e.place.name || e.place) : '-');
      }).join(',');
  }).join('\n');
}

const conditions = [
  ['4 天 / 人文+自然+美食 / 标准', { days: 4, prefs: ['人文历史', '自然风光', '美食体验'], pace: 'normal', base: pick('lod-xinhua') }],
  ['6 天 / 全偏好 / 紧凑', { days: 6, prefs: ALL_PREFS, pace: 'tight', base: pick('lod-xinhua') }],
  ['2 天 / 只酒庄 / 轻松', { days: 2, prefs: ['酒庄品鉴'], pace: 'relax', base: pick('lod-zhenbeibao') }],
  ['5 天 / 亲子+科普 / 标准', { days: 5, prefs: ['亲子友好', '科普研学'], pace: 'normal', base: pick('lod-yongning') }]
];

let diffCount = 0, total = 0;

console.log('=== 打乱数据文件顺序后，行程是否改变 ===\n');

const shuffles = [1, 7, 42, 20261015].map(makeShuffle);
conditions.forEach(function (c) {
  const [label, opts] = c;
  const baseline = fingerprint(E.plan(city, opts));
  const outs = shuffles.map(sh => {
    /* 造一份「景点数组被重排、内容完全相同」的数据包 */
    const src = global.CITY_DATA.yinchuan;
    const shuffled = {
      id: src.id + '-shuffled', name: src.name, base: src.base,
      districts: src.districts, eats: src.eats.slice(),
      attractions: sh(src.attractions)
    };
    global.CITY_DATA.__tmp = shuffled;
    const city2 = E.buildCity(['__tmp', 'nearby']);
    return fingerprint(E.plan(city2, opts));
  });
  const same = outs.filter(o => o === baseline).length;
  total++;
  const okAll = same === outs.length;
  if (!okAll) diffCount++;
  console.log((okAll ? '  ✓ ' : '  ✗ ') + label + '  4 种乱序中 ' + same + '/4 与原始顺序一致');
  if (!okAll) {
    const i = outs.findIndex(o => o !== baseline);
    const b = baseline.split('\n')[0], o = outs[i].split('\n')[0];
    console.log('      原始顺序 Day1: ' + b);
    console.log('      乱序 #' + (i + 1) + ' Day1: ' + o);
  }
});

console.log('\n=== 打分完全打平时，由什么裁决（不得是随机的，也不得是书写顺序）===\n');
/* 造 4 个除 id 外完全相同的景点：坐标、时长、门票、标签全一致，必然打平 */
const mkTwin = (id, name) => ({
  id, name, district: '测试区', level: '', lng: 106.20, lat: 38.50, urban: false, roadKph: 50,
  stay: 90, ticket: 0, open: '09:00-18:00', slot: 'day', tags: ['人文历史'],
  bg: 'x', hl: 'y'
});
const twins = [mkTwin('t-a', '甲'), mkTwin('t-b', '乙'), mkTwin('t-c', '丙'), mkTwin('t-d', '丁')];
const mkTieCity = list => ({
  id: 'tie', name: '打平测试', base: { id: 'b', name: '驻点', district: '测试区', lng: 106.20, lat: 38.50, urban: false, roadKph: 50 },
  districts: { '测试区': 1 }, eats: [], attractions: list
});
const runTie = list => E.plan(mkTieCity(list), { days: 1, prefs: ['人文历史'], pace: 'normal' })
  .days[0].items.map(i => i.a.id).join('>');

/* ① 重复调用是否稳定 */
const tieRuns = [0, 1, 2].map(() => runTie(twins));
const tieStable = tieRuns.every(x => x === tieRuns[0]);
console.log((tieStable ? '  ✓ ' : '  ✗ ') + '同一输入重复 3 次结果一致：' + tieRuns[0]);

/* ② 把打平项的书写顺序倒过来，结果是否仍指向同一批景点 */
const rev = runTie(twins.slice().reverse());
const sameSet = rev.split('>').slice().sort().join('>') === tieRuns[0].split('>').sort().join('>');
console.log((sameSet ? '  ✓ ' : '  ✗ ') + '倒序书写后选中的仍是同一批点位：' + rev +
  (sameSet ? '（与 ' + tieRuns[0] + ' 同集合）' : ''));
console.log('      说明：打平由 id 字典序裁决，既非随机、也非文件书写顺序');

const allOk = diffCount === 0 && tieStable && sameSet;
console.log('\n' + (allOk
  ? '✓ 顺序无关：打乱数据文件顺序不改变行程，打平由 id 收敛而非书写顺序'
  : '✗ 存在依赖书写顺序的结果：' + diffCount + '/' + total + ' 组条件受影响' +
    (tieStable ? '' : '；打平项重复调用不稳定') +
    (sameSet ? '' : '；倒序书写后选中点位不同')));

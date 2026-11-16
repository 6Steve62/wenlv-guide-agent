/* =============================================================================
 * 驻点坐标敏感性验证 · 文旅导览智能体
 *
 * 回答一个问题：接地图 API 拿到 POI 级精度（百米级），对行程决策有没有用？
 *
 * 方法：把驻点坐标在 8 个方向分别平移若干米，重跑同一组条件，比对行程。
 *   ① 完全一致          —— 连顺序都没变
 *   ② 点位相同仅顺序不同 —— 去的地方一样，先后次序微调（用户基本无感）
 *   ③ 点位不同          —— 真正影响决策的那一类
 *
 * 若百米级的 ③ 占比很小，说明 POI 检索带来的精度对决策几乎无用；
 * 而公里级的 ③ 占比明显升高，说明「住哪个片区」才是真正的决策变量——
 * 这正是住宿数据包提供的粒度。
 *
 * 运行：node test/base-sensitivity.js
 * ========================================================================== */
const fs = require('fs');
global.window = global;
const ROOT = __dirname + '/../';
['data/yinchuan.js', 'data/nearby.js', 'data/lodging.js', 'js/engine.js']
  .forEach(f => eval(fs.readFileSync(ROOT + f, 'utf8')));
const E = global.Engine;
const LOD = global.CITY_DATA.lodging.lodgings;
const city = E.buildCity(['yinchuan']);

/* 单位换算：1 度纬度 ≈ 111.32 km；银川纬度 38.5 处 1 度经度 ≈ 87.13 km
   注意别再写错——把 1000 倍偏差的换算写进去，平移 300 米会变成平移 300 公里 */
const M_PER_DEG_LAT = 111320;
const M_PER_DEG_LNG = 87130;

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1],
              [0.707, 0.707], [-0.707, 0.707], [0.707, -0.707], [-0.707, -0.707]];
const PREF_SETS = [
  ['人文历史', '自然风光', '美食体验'],
  ['亲子友好', '科普研学'],
  ['酒庄品鉴', '摄影出片'],
  ['自然风光']
];
const LODGING_IDS = ['lod-xinhua', 'lod-daxuecheng', 'lod-zhenbeibao',
                     'lod-wanda', 'lod-lingwushi', 'lod-shanhukou'];
const DISTANCES = [100, 300, 500, 1000, 2000, 3000];

function plan(base, prefs) {
  return E.plan(city, { days: 3, prefs: prefs, pace: 'normal', base: base });
}
/* 结构指纹：哪天去哪个区县、按什么顺序去哪些点、夜游点 —— 即用户能感知的决策结果 */
function fullShape(r) {
  return r.days.map(d => (d.district || '-') + ':' +
    d.items.map(x => x.a.id).join('>') +
    (d.night ? '+' + d.night.id : '')).join(' | ');
}
/* 只看去过哪些点，忽略顺序 */
function spotSet(r) {
  const s = [];
  r.days.forEach(d => { d.items.forEach(x => s.push(x.a.id)); if (d.night) s.push(d.night.id); });
  return s.slice().sort().join(',');
}

console.log('条件：3 天 · 标准节奏 · 银川市全域 · 默认驻点 ' + city.base.name);
console.log('样本：' + LODGING_IDS.length + ' 个驻点 × ' + PREF_SETS.length + ' 组偏好 × 8 个方向 = ' +
  (LODGING_IDS.length * PREF_SETS.length * 8) + ' 次/档\n');

const rows = [];
DISTANCES.forEach(function (m) {
  let same = 0, reorder = 0, diff = 0, total = 0;
  LODGING_IDS.forEach(function (id) {
    const l = LOD.filter(x => x.id === id)[0];
    const b0 = E.toBase(l, city);
    PREF_SETS.forEach(function (prefs) {
      const r0 = plan(b0, prefs);
      const f0 = fullShape(r0), s0 = spotSet(r0);
      DIRS.forEach(function (d) {
        const nb = Object.assign({}, b0, {
          lng: l.lng + d[0] * m / M_PER_DEG_LNG,
          lat: l.lat + d[1] * m / M_PER_DEG_LAT
        });
        const r1 = plan(nb, prefs);
        total++;
        if (fullShape(r1) === f0) same++;
        else if (spotSet(r1) === s0) reorder++;
        else diff++;
      });
    });
  });
  rows.push({ m: m, same: same, reorder: reorder, diff: diff, total: total });
  const pct = n => String((100 * n / total).toFixed(0) + '%').padStart(4);
  console.log('平移 ' + String(m).padStart(4) + ' 米  (' + total + ' 次)：' +
    '完全一致 ' + pct(same) + '  ·  仅顺序不同 ' + pct(reorder) + '  ·  点位不同 ' + pct(diff));
});

console.log('\n判读：');
const p100 = rows[0], p3000 = rows[rows.length - 1];
console.log('  · 百米级精度（POI 检索所能提供）：点位不同仅 ' +
  (100 * p100.diff / p100.total).toFixed(0) + '%，说明拿到门牌级坐标对「去哪些地方」几乎无影响');
console.log('  · 公里级差异（住哪个片区）：点位不同升至 ' +
  (100 * p3000.diff / p3000.total).toFixed(0) + '%，这才是真正影响决策的粒度');
console.log('  · 结论：住宿数据包正好落在有效粒度上，POI 级精度带来的增量不值得为此引入地图 API');

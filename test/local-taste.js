/* =============================================================================
 * 身份维度验证 · 文旅导览智能体
 *
 * 同一份数据，三类人要的推荐恰好相反（用户原话：第一次来 / 多次来 /
 * 「我是本地人有啥推荐的吗」）。引擎用 opts.role 承载这个维度，只改
 * 「主打哪个区县」的排序：
 *   first  第一次来（默认）  5A +3 / 4A +1.5 → 短天数先把招牌景区覆盖掉
 *   repeat 多次来            无评级/3A/AA +1.5、4A +0.75、5A +0.5
 *                            → 招牌景点权重下调但不归零，新鲜点位上浮
 *   local  本地              无评级 +2 / 3A +1 / AA +0.5、4A/5A 归零
 *                            → 「年轻时就去过」的地方不再当头牌
 *
 * 验证：
 *   ① 权重推导：不新增数据字段，levelBonus 只读景点已有的 level
 *   ② first 2 天能见到贺兰山国家森林公园（修复前兴庆>金凤，贺兰县被挤出）
 *   ③ local 2 天不主打贺兰县，转去无评级点位多的区县
 *   ④ repeat 介于两者之间：既不像 first 那样直奔贺兰县，也不像 local 留在金凤
 *   ⑤ first 3 天覆盖西夏区（西夏陵所在），local 3 天不去
 *   ⑥ 归一化：不传 / 传 'first' / 旧布尔 local=false 三者等价；
 *      local=true 归一到 'local'（老调用点不静默降级）
 *   ⑦ 身份只动区县选择，不改点位的开闭园 / 时长 / 车程口径
 *   ⑧ 三种身份下行程自身仍自洽（站点数、时间轴、往返闭环）
 *   ⑨ 打乱数据文件顺序，三种身份的行程都不变（确定性）
 *
 * 运行：node test/local-taste.js   （在任意目录下均可，路径按 __dirname 解析）
 * ========================================================================== */
const fs = require('fs');
global.window = global;
['data/cats.js', 'data/yinchuan.js', 'data/nearby.js', 'data/lodging.js', 'js/engine.js']
  .forEach(f => eval(fs.readFileSync(__dirname + '/../' + f, 'utf8')));

const E = global.Engine;
const city = E.buildCity(['yinchuan', 'nearby']);
const base = { id: 'base', name: '银川市区（新华街商圈）', lng: 106.2325, lat: 38.4872 };

let pass = 0, fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + n + (x ? '   → ' + x : '')); c ? pass++ : fail++; };

/* 取一次行程的全部景点 id 与区县序列 */
function trip(opts) {
  const p = E.plan(city, Object.assign({ days: 3, prefs: ['自然风光'], pace: 'normal', scope: 'with' }, opts));
  const ids = []; p.days.forEach(d => d.items.forEach(i => ids.push(i.a.id)));
  const seq = p.days.filter(d => d.items.length).map(d => d.items[0].a.district);
  return { p: p, ids: ids, seq: seq, n: ids.length };
}
const SLGY = '贺兰山国家森林公园（苏峪口）';
const levelOf = id => { const a = city.attractions.filter(x => x.id === id)[0]; return a ? (a.level || '无评级') : '?'; };

console.log('=== 1. 权重推导：只读景点已有的 level，不新增数据字段 ===');
const src = fs.readFileSync(__dirname + '/../js/engine.js', 'utf8');
ok('levelBonus 由 level 推导', /function levelBonus[\s\S]{0,260}?a\.level/.test(src));
ok('first 权重 5A 最高（3）、4A 次之（1.5）',
  /lv === '5A' \? 3 : lv === '4A' \? 1\.5/.test(src));
ok('repeat 权重下调招牌（4A 0.75、5A 0.5）、抬新鲜点位（无评级/3A/AA 1.5）',
  /ROLE_REPEAT\)\s*\{[\s\S]{0,120}?1\.5[\s\S]{0,80}?4A' \? 0\.75[\s\S]{0,40}?5A' \? 0\.5/.test(src));
ok('local 权重把顺序倒过来（无评级 2、3A 1、AA 0.5）',
  /!lv \? 2 : \(lv === '3A' \? 1 : lv === 'AA' \? 0\.5 : 0\)/.test(src));
ok('数据包没有为身份新增任何字段',
  !/local|role/.test(fs.readFileSync(__dirname + '/../data/yinchuan.js', 'utf8')) &&
  !/local|role/.test(fs.readFileSync(__dirname + '/../data/nearby.js', 'utf8')));

console.log('\n=== 2. 第一次来 2 天：修复前见不到贺兰山，现在必须见到 ===');
const f2 = trip({ days: 2, role: 'first' });
ok('first 2 天含' + SLGY, f2.ids.indexOf('slgy') >= 0, '区县序列 ' + f2.seq.join('>'));
ok('first 2 天第 2 天主打贺兰县', f2.seq.indexOf('贺兰县') >= 0, f2.seq.join('>'));

console.log('\n=== 3. 本地 2 天：不主打贺兰县，转向无评级点位多的区县 ===');
const l2 = trip({ days: 2, role: 'local' });
ok('local 2 天不含贺兰山国家森林公园', l2.ids.indexOf('slgy') < 0, '区县序列 ' + l2.seq.join('>'));
ok('local 2 天第 1 天主打金凤区（无评级点位密集）', l2.seq[0] === '金凤区', l2.seq.join('>'));
ok('local 模式排进的点位以无评级 / 3A 为主',
  (function () {
    const lv = l2.ids.map(levelOf);
    return lv.filter(x => x === '无评级' || x === '3A' || x === 'AA').length >= Math.ceil(lv.length / 2);
  })(), l2.ids.map(levelOf).join('/'));

console.log('\n=== 4. 多次来 2 天：介于 first 与 local 之间 ===');
const r2 = trip({ days: 2, role: 'repeat' });
ok('repeat 2 天与 first 的区县序列不同（招牌权重真的下调了）',
  r2.seq.join('>') !== f2.seq.join('>'), 'repeat ' + r2.seq.join('>') + ' / first ' + f2.seq.join('>'));
ok('repeat 2 天与 local 的区县序列也不同（不是简单等于本地）',
  r2.seq.join('>') !== l2.seq.join('>'), 'repeat ' + r2.seq.join('>') + ' / local ' + l2.seq.join('>'));
ok('repeat 2 天不含贺兰山国家森林公园（招牌让位）',
  r2.ids.indexOf('slgy') < 0, r2.seq.join('>'));
ok('repeat 排进的点位等级比 first 更分散（有 4A/5A 也有无评级）',
  (function () {
    const lv = r2.ids.map(levelOf);
    return lv.some(x => x === '4A' || x === '5A') && lv.some(x => x === '无评级' || x === '3A');
  })(), r2.ids.map(levelOf).join('/'));

console.log('\n=== 5. first 3 天覆盖西夏区（西夏陵所在），local 3 天不去 ===');
const f3 = trip({ days: 3, role: 'first' });
ok('first 3 天区县序列含西夏区', f3.seq.indexOf('西夏区') >= 0, f3.seq.join('>'));
const l3 = trip({ days: 3, role: 'local' });
ok('local 3 天区县序列不含西夏区', l3.seq.indexOf('西夏区') < 0, l3.seq.join('>'));
const r3 = trip({ days: 3, role: 'repeat' });
ok('repeat 3 天序列同样与另两档都不同',
  r3.seq.join('>') !== f3.seq.join('>') && r3.seq.join('>') !== l3.seq.join('>'),
  'repeat ' + r3.seq.join('>'));

console.log('\n=== 6. 归一化：默认即 first，旧布尔 local 不静默降级 ===');
const json = p => JSON.stringify(p.days.map(d => d.items.map(i => i.a.id)));
ok('不传 role 的输出逐字符等于 role=first', json(trip({ days: 3 }).p) === json(f3.p));
ok('normRole 归一回 repeat / local',
  E.normRole('repeat') === 'repeat' && E.normRole('local') === 'local');
ok('normRole 对未识别值回落 first（含 undefined）',
  E.normRole(undefined) === 'first' && E.normRole('') === 'first' && E.normRole(null) === 'first');
ok('旧布尔 local=true 归一到 local（老调用点不静默变成另一套推荐）',
  E.normRole(true) === 'local' && json(trip({ days: 3, local: true }).p) === json(l3.p));
ok('旧布尔 local=false 归一到 first',
  E.normRole(false) === 'first' && json(trip({ days: 3, local: false }).p) === json(f3.p));

console.log('\n=== 7. 身份只动区县选择，不改点位的时长与车程口径 ===');
(function () {
  function rec(t) { const m = {}; t.p.days.forEach(d => d.items.forEach(i => m[i.a.id] = i.stay + '/' + i.travelMin)); return m; }
  const A = rec(f3), B = rec(l3), C = rec(r3);
  const ab = f3.ids.filter(id => l3.ids.indexOf(id) >= 0);
  const ac = f3.ids.filter(id => r3.ids.indexOf(id) >= 0);
  ok('共同点位足够多（三档里 first 与 local 至少 3 处）', ab.length >= 3, ab.length + ' 处');
  ok('first 与 local 的共同点位停留/车程一致',
    ab.every(id => A[id] === B[id]), ab.join('、'));
  ok('first 与 repeat 的共同点位停留/车程一致',
    ac.length >= 1 && ac.every(id => A[id] === C[id]), ac.join('、'));
})();

console.log('\n=== 8. 三种身份下行程自身仍自洽 ===');
[['first', f3], ['repeat', r3], ['local', l3]].forEach(function (pair) {
  const name = pair[0], t = pair[1];
  ok(name + '：3 天都排出了内容', t.p.days.filter(d => d.items.length).length === 3,
    t.p.days.filter(d => d.items.length).length + '/3 天');
  ok(name + '：同一天内没有重复点位',
    t.p.days.every(d => { const s = d.items.map(i => i.a.id); return new Set(s).size === s.length; }));
  ok(name + '：全程没有重复点位', new Set(t.ids).size === t.ids.length, t.ids.length + ' 站');
  ok(name + '：时间轴闭合成环（出行段 = 站数 + 1 + 夜间段，末段是回程）',
    t.p.days.every(function (d) {
      const ev = E.timeline(city, d, t.p.W).ev;
      const travels = ev.filter(e => e.k === 'travel');
      const want = d.items.length + 1 + (d.night ? 1 : 0);
      return travels.length === want && travels[travels.length - 1].ret === true;
    }));
});

console.log('\n=== 9. 打乱数据文件顺序，三种身份的行程都不变 ===');
(function () {
  const city2 = E.buildCity(['yinchuan', 'nearby']);
  city2.attractions = city2.attractions.slice().reverse();
  function seqOf(c, role) {
    const p = E.plan(c, { days: 3, prefs: ['自然风光'], pace: 'normal', scope: 'with', role: role });
    return p.days.map(d => d.items.map(i => i.a.id).join(',')).join('|');
  }
  ok('first：倒序后行程一致', seqOf(city2, 'first') === seqOf(city, 'first'));
  ok('repeat：倒序后行程一致', seqOf(city2, 'repeat') === seqOf(city, 'repeat'));
  ok('local：倒序后行程一致', seqOf(city2, 'local') === seqOf(city, 'local'));
})();

console.log('\n' + '-'.repeat(60));
console.log(pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail === 0 ? 0 : 1);

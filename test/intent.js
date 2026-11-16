/* =============================================================================
 * 自然语言解析器验证 · 文旅导览智能体（智能体层 · test/intent.js）
 *
 * 锁的东西：
 *   ① 纯度：零 DOM、零时间读取、零随机数、源码里没有任何城市名词
 *      （景点/住宿/合法偏好全部由 ctx 注入，换城市只换 ctx）
 *   ② 槽位口径：天数 / 身份三档 / 兴趣 / 节奏 / 范围 / 住宿 / 时刻 /
 *      「去过」与「不去」——取值必须与向导表单同一套，才能保证
 *      「对话层不改变排程结果」（那条由 test/dialogue.js 锁）
 *   ③ 优先级与掩蔽：「没来过」压过「来过」；「住西夏万达」不许顺手
 *      点亮「人文历史」；「多安排点博物馆」是兴趣加强、不是要把一天排满
 *   ④ 动作分类：问候 / 重来 / 确认 / 填充 / 没听懂；
 *      「逛步行街」里的「行」不算答应
 *   ⑤ 顺序与问法：FLOW_ORDER 与向导步骤同序；问句默认取向导原标题
 *   ⑥ 确定性与数据驱动：两次解析逐字节一致；打乱 ctx 数组顺序结果不变；
 *      换一份假城市数据（含自定义兴趣词表）解析器不改即用
 *
 * 运行：node test/intent.js
 * ========================================================================== */
const fs = require('fs');
global.window = global;
['data/cats.js', 'data/yinchuan.js', 'data/nearby.js', 'data/lodging.js', 'js/engine.js', 'js/intent.js']
  .forEach(f => eval(fs.readFileSync(__dirname + '/../' + f, 'utf8')));

const I = global.Intent;
const E = global.Engine;
const APP = fs.readFileSync(__dirname + '/../js/app.js', 'utf8');
const SRC = fs.readFileSync(__dirname + '/../js/intent.js', 'utf8');

/* 向导侧的合法取值与问法，一律从 app.js 源码提取——测试不另存一份，
   否则「表单改了、测试没跟着改」会静默通过。 */
const PREF_ALL = eval(APP.match(/var PREF_ALL = (\[[^\]]+\])/)[1]);
function stepSeq(blockName) {
  const block = APP.slice(APP.indexOf('var ' + blockName + ' = ['), APP.indexOf('var STEPS_', APP.indexOf('var ' + blockName + ' = [') + 10));
  const keyOf = name => {
    const m = APP.match(new RegExp('var ' + name + ' = \\{[\\s\\S]{0,400}?key: \'(\\w+)\''));
    return m ? m[1] : null;
  };
  const seq = [];
  block.replace(/key: '(\w+)'|(STEP_[A-Z_]+)/g, (m, k, ref) => { seq.push(k || keyOf(ref)); return m; });
  return seq.filter(Boolean);
}
const PLAN_SEQ = stepSeq('STEPS_PLAN');
const NOW_SEQ = stepSeq('STEPS_NOW');
const WIZARD_TITLE = {};
const titleRe = /key: '(\w+)'[\s\S]{0,140}?title: '([^']+)'/g;
let tm;
while ((tm = titleRe.exec(APP))) WIZARD_TITLE[tm[1]] = tm[2];

const city = E.buildCity(['yinchuan', 'nearby']);
const lodgings = global.CITY_DATA.lodging.lodgings;
const spots = city.attractions.map(a => ({ id: a.id, name: a.name }));
/* 城市专属词由调用方合入 ctx：默认表只有跨城市也说得通的词。
   这正是「换城市只换 ctx」——那边合一份西夏陵，这边合一份别的。 */
const prefWords = I.defaultPrefWords(PREF_ALL);
prefWords['人文历史'] = prefWords['人文历史'].concat(['丝路']);
const ctx = {
  prefs: PREF_ALL,
  prefWords: prefWords,
  lodgings: lodgings,
  spots: spots,
  nearbySpots: ((global.CITY_DATA.nearby && global.CITY_DATA.nearby.attractions) || []).map(a => ({ id: a.id, name: a.name })),
  now: 14 * 60,
  labels: {
    role: { first: '第一次来银川', repeat: '多次来银川', local: '我是银川本地人' },
    pace: { relax: '轻松', normal: '标准', tight: '紧凑', late: '夜间' },
    scope: { city: '只在市区', with: '含周边' }
  },
  ask: WIZARD_TITLE
};

let pass = 0, fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + n + (x !== undefined ? '   → ' + x : '')); c ? pass++ : fail++; };
const P = (t, c) => I.parse(t, ctx);
const slot = (t, k) => { const r = P(t); return r.slots[k]; };

console.log('=== 1. 纯度：不认识这座城市，也不碰浏览器 ===');
ok('源码里没有 DOM 接触（document / addEventListener / localStorage）',
  !/(document|addEventListener|localStorage|innerHTML)/.test(SRC));
ok('源码里没有时间读取与随机数（new Date / Date.now / Math.random）',
  !/(new Date|Date\.now|Math\.random)/.test(SRC));
ok('源码里没有任何城市专属名词', !/(银川|西夏陵|贺兰山|沙湖|兴庆|吴忠|青铜峡)/.test(SRC));
ok('挂载点只有 window.Intent', /window\.Intent = \{/.test(SRC) && typeof I === 'object');
ok('导出齐全（parse / missing / askFor / describe / describeState / toEngineOpts / defaultPrefWords / hmText）',
  ['parse', 'missing', 'askFor', 'describe', 'describeState', 'toEngineOpts', 'defaultPrefWords', 'hmText']
    .every(k => typeof I[k] === 'function'));
ok('FLOW_ORDER.plan 与向导 STEPS_PLAN 逐步同序',
  JSON.stringify(I.FLOW_ORDER.plan) === JSON.stringify(PLAN_SEQ),
  PLAN_SEQ.join(' → '));
ok('FLOW_ORDER.now 与向导 STEPS_NOW 同序，且只落下可选的 visited',
  I.FLOW_ORDER.now.every((k, i) => NOW_SEQ.indexOf(k) > (i ? NOW_SEQ.indexOf(I.FLOW_ORDER.now[i - 1]) : -1)) &&
  NOW_SEQ.filter(k => I.FLOW_ORDER.now.indexOf(k) < 0).join() === 'visited',
  NOW_SEQ.join(' → '));

console.log('\n=== 2. 天数 ===');
ok('「想玩三天」→ 3', slot('想玩三天', 'days') === 3);
ok('「3天」→ 3（阿拉伯数字）', slot('3天', 'days') === 3);
ok('「十天」→ 钳到 8 并说明', slot('十天', 'days') === 8 && /最多排 8 天/.test(P('十天').notes.join())); 
ok('「周末」→ 2 并说明是小长假默认值', slot('周末', 'days') === 2 && /按周末 2 天算/.test(P('周末').notes.join()));
ok('「三天两晚」→ 3（先认「天」）', slot('三天两晚', 'days') === 3);
ok('「住两晚」→ 折算成 3 天', slot('住两晚', 'days') === 3 && /折算/.test(P('住两晚').notes.join()));
ok('「10月18日」是日期不是时长', slot('10月18日', 'days') === undefined && P('10月18日').action === 'unknown');
ok('「玩个五天」→ 5', slot('玩个五天', 'days') === 5);
ok('「一两天」→ 保守认 1 并说明没定论', slot('一两天', 'days') === 1 && /没定论/.test(P('一两天').notes.join()));
ok('「两三天」→ 保守认 2', slot('两三天', 'days') === 2);

console.log('\n=== 3. 身份三档（优先级：first > local > repeat）===');
ok('「第一次来」→ first', slot('第一次来', 'role') === 'first');
ok('「我没来过」→ first（「没来过」压过「来过」）', slot('我没来过', 'role') === 'first');
ok('「我是本地人」→ local', slot('我是本地人', 'role') === 'local');
ok('「老家是银川的」→ local', slot('老家是银川的', 'role') === 'local');
ok('「第二次来」→ repeat', slot('第二次来', 'role') === 'repeat');
ok('「来过很多次」→ repeat', slot('来过很多次', 'role') === 'repeat');
ok('「第一次来，本地朋友带过路」→ first（先命中的 tiers 赢）', slot('第一次来，本地朋友带过路', 'role') === 'first');

console.log('\n=== 4. 节奏 ===');
ok('「轻松点」→ relax', slot('轻松点', 'pace') === 'relax');
ok('「别太累」→ relax', slot('别太累', 'pace') === 'relax');
ok('「紧凑一点」→ tight', slot('紧凑一点', 'pace') === 'tight');
ok('「想夜游」→ late', slot('想夜游', 'pace') === 'late');
ok('「正常节奏」→ normal', slot('正常节奏', 'pace') === 'normal');
ok('「多安排点博物馆」只点亮兴趣，不改节奏',
  slot('多安排点博物馆', 'pace') === undefined &&
  JSON.stringify(slot('多安排点博物馆', 'prefs')) === '["科普研学"]');

console.log('\n=== 5. 范围 ===');
ok('「想去周边」→ with', slot('想去周边', 'scope') === 'with');
ok('「就在市区」→ city', slot('就在市区', 'scope') === 'city');
ok('「就近玩」→ city', slot('就近玩', 'scope') === 'city');
ok('「沙湖」→ with', slot('沙湖', 'scope') === 'with');

console.log('\n=== 6. 兴趣（含掩蔽与否定）===');
ok('「想看历史」→ 人文历史', JSON.stringify(slot('想看历史', 'prefs')) === '["人文历史"]');
ok('直接打标签名「人文历史」也认', JSON.stringify(slot('人文历史', 'prefs')) === '["人文历史"]');
ok('「历史和美食」→ 两项，顺序按向导合法值表',
  JSON.stringify(slot('历史和美食', 'prefs')) === '["人文历史","美食体验"]');
ok('「不想看人文历史」→ 去掉人文历史偏好，不是添加',
  slot('不想看人文历史', 'prefs') === undefined &&
  JSON.stringify(slot('不想看人文历史', 'prefsDrop')) === '["人文历史"]');
ok('「不去西夏陵」→ 避开该景点（去过/不去指向具体景点）',
  JSON.stringify(slot('不去西夏陵', 'avoid')) === '["xxl"]' &&
  slot('不去西夏陵', 'prefs') === undefined);
ok('「住西夏万达」不顺手点亮人文历史',
  slot('住西夏万达', 'lodging') === 'lod-xixiawanda' && slot('住西夏万达', 'prefs') === undefined);
ok('「不去黄河军事文化博览园」→ 避开该景点，且不误点亮自然风光',
  JSON.stringify(slot('不去黄河军事文化博览园', 'avoid')) === '["hjjs"]' &&
  slot('不去黄河军事文化博览园', 'prefs') === undefined);
ok('「想吃夜市」→ 美食体验', JSON.stringify(slot('想吃夜市', 'prefs')) === '["美食体验"]');
ok('「想看丝路」→ 人文历史（城市词经 ctx 合入，默认表里没有）',
  JSON.stringify(slot('想看丝路', 'prefs')) === '["人文历史"]' &&
  I.defaultPrefWords(PREF_ALL)['人文历史'].indexOf('丝路') < 0);
ok('「带孩子」→ 亲子友好', JSON.stringify(slot('带孩子', 'prefs')) === '["亲子友好"]');
ok('「拍照出片」→ 摄影出片', JSON.stringify(slot('拍照出片', 'prefs')) === '["摄影出片"]');

console.log('\n=== 7. 住宿（数据驱动、最长别名优先）===');
ok('「住新华街」→ 新华街商圈（后缀泛化前缀）', slot('住新华街', 'lodging') === 'lod-xinhua');
ok('「住南门」→ 南门广场', slot('住南门', 'lodging') === 'lod-nanmen');
ok('「住西夏万达」→ 西夏万达（4 字别名压过 2 字「万达」）', slot('住西夏万达', 'lodging') === 'lod-xixiawanda');
ok('「住万达」→ 万达 · 大阅城', slot('住万达', 'lodging') === 'lod-wanda');
ok('「住兴庆区」→ 区县兜底取默认值并说明', slot('住兴庆区', 'lodging') === 'lod-xinhua' && /先按/.test(P('住兴庆区').notes.join()));
ok('「从鼓楼出发」→ 鼓楼 · 解放街', slot('从鼓楼出发', 'lodging') === 'lod-gulou');
ok('「想去贺兰山爬山」不匹配住宿（没有驻点提示词）', slot('想去贺兰山爬山', 'lodging') === undefined);

console.log('\n=== 8. 景点提及（去过 / 不去）===');
ok('「西夏陵去过了」→ visited', JSON.stringify(slot('西夏陵去过了', 'visited')) === '["xxl"]');
ok('「不想去西夏陵」→ avoid', JSON.stringify(slot('不想去西夏陵', 'avoid')) === '["xxl"]');
ok('「岩画看过了」→ visited（短前缀别名）', JSON.stringify(slot('岩画看过了', 'visited')) === '["yhs"]');
ok('「西夏陵不去了」→ avoid（「不去了」也归避）', JSON.stringify(slot('西夏陵不去了', 'avoid')) === '["xxl"]');
ok('「想去贺兰山」不带提示词、且不是偏好词，不产生任何槽位',
  Object.keys(P('想去贺兰山').slots).length === 0 && P('想去贺兰山').action === 'unknown');

console.log('\n=== 9. 出发时刻 ===');
ok('「下午三点出发」→ 15:00', slot('下午三点出发', 'startAt') === 15 * 60);
ok('「晚上8点」→ 20:00', slot('晚上8点', 'startAt') === 20 * 60);
ok('「八点半」→ 08:30', slot('八点半', 'startAt') === 8 * 60 + 30);
ok('「下午3点半」→ 15:30', slot('下午3点半', 'startAt') === 15 * 60 + 30);
ok('「现在」→ 取 ctx.now（14:00），不自己读时钟', slot('现在', 'startAt') === 14 * 60);
ok('「凌晨2点」→ 02:00', slot('凌晨2点', 'startAt') === 2 * 60);
ok('「25点」不合法，不产生槽位', slot('25点', 'startAt') === undefined);

console.log('\n=== 10. 动作分类 ===');
ok('「你好」→ greet', P('你好').action === 'greet');
ok('「你能做什么」→ greet', P('你能做什么').action === 'greet');
ok('「重新来」→ restart', P('重新来').action === 'restart');
ok('「换一批」→ restart', P('换一批').action === 'restart');
ok('「就这样」→ confirm', P('就这样').action === 'confirm');
ok('「OK」→ confirm', P('OK').action === 'confirm');
ok('「逛步行街」里的「行」不算答应', P('逛步行街').action !== 'confirm' && P('逛步行街').action === 'unknown');

console.log('\n=== 11. 一句话填多个槽位 ===');
const many = P('三天，第一次来，想看历史和美食，轻松点，住兴庆区');
ok('六项一次说齐：天数/身份/兴趣/节奏/住宿',
  many.slots.days === 3 && many.slots.role === 'first' &&
  JSON.stringify(many.slots.prefs) === '["人文历史","美食体验"]' &&
  many.slots.pace === 'relax' && many.slots.lodging === 'lod-xinhua');
ok('回显五条，让人看见「我听懂了什么」', many.heard.length === 5, many.heard.join(' / '));
const many2 = P('国庆去玩，住在万达，晚上8点出发，想去周边，别太累，西夏陵去过了');
ok('混合句：节假日默认 3 天 + 住宿 + 时刻 + 范围 + 节奏 + 去过',
  many2.slots.days === 3 && many2.slots.lodging === 'lod-wanda' &&
  many2.slots.startAt === 20 * 60 && many2.slots.scope === 'with' &&
  many2.slots.pace === 'relax' && JSON.stringify(many2.slots.visited) === '["xxl"]');

console.log('\n=== 12. 状态工具：缺哪个问哪个 ===');
ok('空状态按向导顺序缺 6 项',
  JSON.stringify(I.missing({}, 'plan')) === JSON.stringify(PLAN_SEQ));
ok('填满则一项不缺', I.missing({ days: 3, role: 'first', prefs: ['人文历史'], pace: 'normal', scope: 'city', lodging: 'lod-xinhua' }, 'plan').length === 0);
ok('「已在路上」只缺兴趣时会追问兴趣',
  JSON.stringify(I.missing({ lodging: 'lod-wanda', startAt: 600, pace: 'normal' }, 'now')) === '["prefs"]');
ok('visited 是可选槽位，永不进追问名单',
  I.FLOW_ORDER.plan.concat(I.FLOW_ORDER.now).indexOf('visited') < 0);
ok('问句默认取向导原标题（同一句问法）', I.askFor('days', ctx) === WIZARD_TITLE.days, I.askFor('days', ctx));
ok('问句兜底：ctx 没给 ask 时用解析器默认', I.askFor('days', {}) === I.SLOTS.days.ask);
ok('describeState 回显「3 天 · 第一次来银川 · 人文历史 · 轻松」',
  I.describeState({ days: 3, role: 'first', prefs: ['人文历史'], pace: 'relax' }, 'plan', ctx) ===
  '3 天 · 第一次来银川 · 人文历史 · 轻松');

console.log('\n=== 13. 与引擎的口径对齐 ===');
const opts = I.toEngineOpts({ days: 3, prefs: ['人文历史'], pace: 'relax' });
ok('toEngineOpts 输出 { days, prefs, pace, role } 四字段',
  JSON.stringify(Object.keys(opts).sort()) === '["days","pace","prefs","role"]');
ok('role 默认 first（与 runOnce 的 S.role || \'first\' 同口径）',
  opts.role === 'first' && I.toEngineOpts({ role: 'local' }).role === 'local');
ok('字段名与 app.js runOnce() 拼装的一致',
  /var o = \{ days: S\.days, prefs: S\.prefs, pace: S\.pace, role: S\.role \|\| 'first' \};/.test(APP));
ok('Engine.plan 直接吃这份 opts（跑一次不炸、天数对）',
  E.plan(city, Object.assign({}, opts, { base: { id: 'base', name: 't', lng: 106.23, lat: 38.49 } })).days.length === 3);

console.log('\n=== 14. 确定性与数据驱动 ===');
ok('同一输入两次解析逐字节一致',
  JSON.stringify(P('三天，第一次来，想看历史和美食，轻松点')) ===
  JSON.stringify(P('三天，第一次来，想看历史和美食，轻松点')));
const shuffled = Object.assign({}, ctx, { lodgings: lodgings.slice().reverse() });
ok('打乱住宿数组顺序，结果不变（同长别名按 id 收敛）',
  JSON.stringify(P('住西夏万达', shuffled)) === JSON.stringify(P('住西夏万达', ctx)));
/* 换一座「虚构城市」：新的合法兴趣、新的住宿、新的景点、新的兴趣词表。
   解析器本身一行不改——这正是「换一份数据就是一座新城市」在对话层的体现。 */
const fake = {
  prefs: ['古城墙', '大湖风光'],
  prefWords: { '古城墙': ['古城', '老城', '城墙', '古迹'], '大湖风光': ['湖', '划船', '湿地'] },
  lodgings: [{ id: 'h1', name: '湖畔客栈', district: '虚构区', isDefault: true }],
  spots: [{ id: 's1', name: '虚构古城墙' }, { id: 's2', name: '虚构大湖' }],
  now: 9 * 60
};
const fp = I.parse('三天，第一次来，想看古城墙，住湖畔客栈', fake);
ok('假城市：天数 / 身份 / 兴趣 / 住宿全部认得出',
  fp.slots.days === 3 && fp.slots.role === 'first' &&
  JSON.stringify(fp.slots.prefs) === '["古城墙"]' && fp.slots.lodging === 'h1');
ok('假城市：「虚构古城墙去过了」→ visited',
  JSON.stringify(I.parse('虚构古城墙去过了', fake).slots.visited) === '["s1"]');
ok('空字符串不抛错', I.parse('', ctx).action === 'unknown');
ok('不传 ctx 也不抛错（保守降级为空上下文）', I.parse('三天').slots.days === 3);

console.log('\n========================================');
if (fail) console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
else console.log('全部通过（' + pass + ' 项）');
process.exit(fail ? 1 : 0);

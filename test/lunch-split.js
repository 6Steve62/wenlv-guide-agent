/* =============================================================================
 * 午餐切分验证 · 文旅导览智能体
 *
 * 起因：用户在结果页看到同一个景点在一天里出现两次 —— 11:28 一次、13:13 又一次，
 * 两次都写「游览 45 分钟」，读起来就是「一天中重复推荐」。
 * 实际原因是引擎把一段横跨饭点的游览从中间切开、插入午餐，而界面把两段各渲染成了一行。
 *
 * 追下去发现同一个分支上还压着三个更硬的问题（都会让行程自相矛盾）：
 *   ① 门槛是「跨过 12:00」→ 13.8% 的到访被切开，包括「12:54 就能玩完、
 *      却偏要 12:00 出去吃一趟再回来」这种并不划算的拆法；
 *   ② 切开时插入的 60 分钟午餐没有算进闭园预算 →
 *      实测 210 处「17:00 闭园的景区被排到 17:17 才离开」；
 *   ③ 另有一处兜底会在一天 10:49 走完时插一顿 10:49 的午饭，
 *      而这正是引擎自检里判违规的那一条；
 *   ④ 同一个岔路上还有一处：出发时刻在 10:00–13:00 之间、又碰上切分被闭园挡住时，
 *      兜底会把「午餐」插到 15:00 以后（实测最晚 17:46），
 *      于是给「不切割的那条路」补上 14:30 的上界（LUNCH_MAX）。
 *
 * 这个脚本锁死五件事：
 *   ① 只在「不切开就要过 13:30 才吃得上饭、且切完仍在闭园前走得完、切点又不晚于 14:30」时才切
 *   ② 切开的是一次游览的两半：两段时长之和 = 总时长，不是各自算一遍
 *   ③ 结果页一天里每处景点只出现一行（用户直接看到的那个现象）
 *   ④ 攻略卡把两段读回一次游览：停留时长取总和、不误报「被压缩」、站点数不重复计
 *   ⑤ 任何一顿「午餐」都落在 11:00–14:30 之间（含晚出发的一整天）
 *
 * 运行：node test/lunch-split.js   （在任意目录下均可，路径按 __dirname 解析）
 * ========================================================================== */
const fs = require('fs');
global.window = global;

/* ---------- DOM 桩：与 determinism.js 同一套约定 ---------- */
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
global.__CLOCK__ = { min: 9 * 60, dow: 3 };
global.__EXPOSE_APP__ = true;      // 让 app.js 挂出攻略弹窗的几个函数

const ROOT = __dirname + '/../';
const APP_SRC = fs.readFileSync(ROOT + 'js/app.js', 'utf8');
['data/cats.js', 'data/photos.js', 'data/yinchuan.js', 'data/nearby.js', 'data/lodging.js', 'js/engine.js']
  .forEach(f => eval(fs.readFileSync(ROOT + f, 'utf8')));
const E = global.Engine;
const LOD = global.CITY_DATA.lodging.lodgings;
const ROLE_LABEL = { first: '第一次来', repeat: '多次来', local: '我是本地人' };

let pass = 0, fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + n + (x ? '   → ' + x : '')); c ? pass++ : fail++; };
const hm = m => m == null ? '—' : String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
const toMin = t => +t.slice(0, 2) * 60 + +t.slice(3);

const city = E.buildCity(['yinchuan', 'nearby']);
const PREFS = [[], ['人文历史'], ['自然风光'], ['亲子友好'], ['酒庄品鉴', '美食体验'], ['人文历史', '摄影出片']];

/* =============== 引擎侧：扫一批条件，收集所有切分及其上下文 =============== */
function scan(starts) {
  const out = { days: 0, visits: 0, splits: [], lunch: [], meals: [], problems: [] };
  LOD.forEach(b0 => {
    [1, 2, 3, 4, 5].forEach(d => {
      ['relax', 'normal', 'tight'].forEach(p => {
        PREFS.forEach(pr => {
          starts.forEach(s => {
            out.days++;
            const r = E.plan(city, { days: d, pace: p, prefs: pr, base: E.toBase(b0, city), startAt: s });
            /* 时间轴与自检都必须拿到「真正生效的 city」：plan() 会按 opts.base 覆盖驻点，
               用原始 city 去推时间轴，第一天第一段车程就会按默认驻点算 —— 差出十几分钟。 */
            const use = r.city || city;
            out.problems = out.problems.concat(E.selfCheck(use, r.days, r.W));
            r.days.forEach(dy => {
              const tl = E.timeline(use, dy, r.W);
              tl.ev.forEach((e, k) => {
                if (e.k === 'meal') { out.lunch.push(e.at); out.meals.push({ at: e.at, inVisit: !!e.inVisit }); }
                if (e.k !== 'visit' || e.cont) return;
                out.visits++;
                if (!e.break) return;
                const nxt = tl.ev[k + 1], tail = nxt && nxt.k === 'meal' ? tl.ev[k + 2] : null;
                out.splits.push({
                  name: e.a.name, from: e.from, stay: e.stay, total: e.total, planned: e.a.stay,
                  at: e.break.at, brk: e.break.min, back: e.break.back,
                  tailFrom: tail && tail.from, tailStay: tail && tail.stay,
                  tailCont: !!(tail && tail.cont), mealInVisit: !!(nxt && nxt.inVisit)
                });
              });
            });
          });
        });
      });
    });
  });
  out.lunch.sort((a, b) => a - b);
  return out;
}

console.log('=== 1. 引擎：切分门槛 = 13:30，不是「跨过 12:00」 ===');
/* 出发时刻刻意覆盖 12:00 与 13:00：这两档「午后出发、但按规则仍想吃午饭」的条件，
   正是「切分被闭园挡住 → 兜底把午餐插到 15:00 以后」那条岔路唯一能走到的入口。 */
const S = scan([8 * 60, 9 * 60, 10 * 60 + 30, 11 * 60, 11 * 60 + 30, 12 * 60, 13 * 60, 13 * 60 + 40]);
ok('扫描无自检异常', S.problems.length === 0,
  S.problems.length ? S.problems.slice(0, 3).join('；') : S.days + ' 组行程全部自检通过');
ok('确实出现了午餐切分（否则本节无意义）', S.splits.length > 0,
  S.splits.length + ' 次 / 共 ' + S.visits + ' 次到访，占 ' + (S.splits.length / S.visits * 100).toFixed(1) + '%');
const early = S.splits.filter(s => s.from + s.total <= E.LUNCH_LATE);
ok('每一处切分，其「不切就会结束于」都晚于 13:30', early.length === 0,
  early.length ? early.slice(0, 3).map(s => s.name + ' 结束 ' + hm(s.from + s.total)).join('；')
               : '门槛 ' + hm(E.LUNCH_LATE));
const tooEarly = S.splits.filter(s => s.at < E.LUNCH_AT);
ok('切点不早于 12:00', tooEarly.length === 0,
  tooEarly.slice(0, 3).map(s => s.name + ' ' + hm(s.at)).join('；') || '全部 ≥ 12:00');
ok('切分处的午餐带 inVisit 标记（界面据此并进景点那一行）',
  S.splits.every(s => s.mealInVisit), S.splits.filter(s => s.mealInVisit).length + '/' + S.splits.length);

console.log('\n=== 2. 引擎：切开的是一次游览的两半，不是两次游览 ===');
const badSum = S.splits.filter(s => s.stay + s.tailStay !== s.total);
ok('前段 + 后段 = 总时长', badSum.length === 0,
  badSum.slice(0, 3).map(s => s.name + ' ' + s.stay + '+' + s.tailStay + '≠' + s.total).join('；') || '全部相等');
const badShort = S.splits.filter(s => s.stay < E.SPLIT_MIN || s.tailStay < E.SPLIT_MIN);
ok('两段都不少于 ' + E.SPLIT_MIN + ' 分钟', badShort.length === 0,
  badShort.slice(0, 3).map(s => s.name + ' ' + s.stay + '/' + s.tailStay).join('；') ||
  '最短一段 ' + Math.min(...S.splits.map(s => Math.min(s.stay, s.tailStay))) + ' 分钟');
const badTail = S.splits.filter(s => !s.tailCont || s.tailFrom !== s.at + s.brk);
ok('后段标了 cont，且从「切点 + 用餐时长」接着开始', badTail.length === 0,
  badTail.slice(0, 3).map(s => s.name + ' tailFrom=' + hm(s.tailFrom) + ' 应为 ' + hm(s.at + s.brk)).join('；') ||
  '全部自洽');
const overPlan = S.splits.filter(s => s.total > s.planned);
ok('总时长不超过数据包建议（切分不会凭空加时间）', overPlan.length === 0, S.splits.length + ' 处');
/* 切开把这一站的占用整体拉长了一顿饭，因此闭园前必须仍然走得完 */
const pastClose = S.splits.filter(s => s.back + s.tailStay > s.from + s.total + s.brk);
ok('切开后仍在闭园前走得完（不会再出现 17:00 闭园、17:17 才走的行程）',
  pastClose.length === 0 && S.problems.filter(p => /越过闭园/.test(p)).length === 0);
ok('没有「同一景点一天被安排两段互不相连的游览」的情况',
  S.problems.filter(p => /同一景点/.test(p)).length === 0);

console.log('\n=== 3. 引擎：午餐时刻仍在合理区间 ===');
const q = k => S.lunch[Math.floor(S.lunch.length * k)];
ok('午餐不早于 11:00', S.lunch[0] >= E.LUNCH_EARLY, '最早 ' + hm(S.lunch[0]));
ok('午餐中位数不晚于 13:15', q(0.5) <= 13 * 60 + 15, 'P50 ' + hm(q(0.5)));
ok('午餐 P90 不晚于 13:30', q(0.9) <= E.LUNCH_LATE, 'P90 ' + hm(q(0.9)) + ' / 共 ' + S.lunch.length + ' 顿');
const standalone = S.meals.filter(m => !m.inVisit).map(m => m.at).sort((a, b) => a - b);
ok('「游览结束后再吃」这条路的午餐 P99 不晚于 13:30',
  standalone[Math.floor(standalone.length * 0.99)] <= E.LUNCH_LATE,
  'P99 ' + hm(standalone[Math.floor(standalone.length * 0.99)]) + ' / 共 ' + standalone.length + ' 顿');
const afterTwo = S.meals.filter(m => m.at > 14 * 60);
ok('独立午餐极少越过 14:00（0.1% 以内，且必然仍在 14:30 内）',
  standalone.filter(x => x > 14 * 60).length <= standalone.length * 0.001,
  standalone.filter(x => x > 14 * 60).length + ' / ' + standalone.length + ' 顿');
ok('晚于 14:00 的午餐 99% 以上来自「切开」这一类',
  afterTwo.length === 0 || afterTwo.filter(m => m.inVisit).length >= afterTwo.length * 0.99,
  afterTwo.length ? afterTwo.filter(m => m.inVisit).length + ' / ' + afterTwo.length + ' 顿来自切分' : '无');

console.log('\n=== 3b. 引擎：晚出发的一天不会把「午餐」插到下午 ===');
/* 回归护栏：出发时刻在 10:00–13:00、且切分被闭园挡住时，兜底曾把午餐插到 15:00 以后
   （实测最晚 17:46）。修法是给「不切割的那条路」也加上 14:30 的上界，见 LUNCH_MAX。 */
ok('LUNCH_MAX = LUNCH_LATE + LUNCH（14:30）', E.LUNCH_MAX === E.LUNCH_LATE + E.LUNCH,
  hm(E.LUNCH_MAX) + ' = ' + hm(E.LUNCH_LATE) + ' + ' + E.LUNCH + ' 分');
const tooLate = S.meals.filter(m => m.at > E.LUNCH_MAX);
ok('没有任何一顿午餐晚于 ' + hm(E.LUNCH_MAX), tooLate.length === 0,
  tooLate.length ? tooLate.slice(0, 3).map(m => hm(m.at)).join('、') : '最晚 ' + hm(S.lunch[S.lunch.length - 1]) + '（共 ' + S.lunch.length + ' 顿）');
const lateStandalone = S.meals.filter(m => !m.inVisit && m.at > E.LUNCH_MAX);
ok('「游览结束后再吃」这条兜底路径全部落在上界内', lateStandalone.length === 0,
  S.meals.filter(m => !m.inVisit).length + ' 顿独立午餐，最晚 ' +
  hm(S.meals.filter(m => !m.inVisit).reduce((a, m) => Math.max(a, m.at), 0)));
const lates = S.meals.filter(m => m.at > E.LUNCH_LATE);
ok('即便有晚于 13:30 的午餐，也都发生在切分那一类里（或仍在 14:30 内）',
  lates.every(m => m.at <= E.LUNCH_MAX),
  lates.length + ' 顿落在 13:30–' + hm(E.LUNCH_MAX) + ' 之间');

/* =============== 界面侧：走真实向导链路 =============== */
function boot() {
  Object.keys(nodes).forEach(k => delete nodes[k]);
  eval(APP_SRC);
}
function clickOpt(label) {
  const host = nodes['opts'];
  const o = (host ? host.children : []).find(c => c.children[0] && c.children[0].textContent === label);
  if (!o) throw new Error('未找到选项「' + label + '」，当前：' +
    (host ? host.children.map(c => c.children[0] && c.children[0].textContent).join(' / ') : '（无）'));
  o.onclick();
}
function click(id) { const n = nodes[id]; if (n && n.onclick) n.onclick(); }
/* 日卡片本身只有头部，每一站是 appendChild 进去的子节点 —— 必须递归取文本，
   只看卡片自身的 innerHTML 会得到「0 行」，那样的断言等于没写。 */
function walkHtml(n) { return (n._h || '') + (n.children || []).map(walkHtml).join(''); }
function flat(n) { return walkHtml(n).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }
function dayCount() { return nodes['days'] ? nodes['days'].children.length : 0; }
/* 结果页一次只渲染一天，总天数要从分页条上读；否则「翻遍整趟行程」实际上只翻了第 1 天。 */
function navTotal() { const m = flat(nodes['dayNav']).match(/第\s*\d+\s*\/\s*(\d+)\s*天/); return m ? +m[1] : 1; }
function dayHtmls() {
  const out = [];
  for (let i = 0; i < navTotal(); i++) { if (i > 0) click('nextDay'); out.push(walkHtml(nodes['days'])); }
  return out;
}
/* 天数 → 偏好 → 下一步 → 节奏 → 范围 → 生成行程（与 determinism.js 同一套标签） */
function driveWizard(o) {
  boot();
  clickOpt(o.days + ' 天');
  clickOpt(ROLE_LABEL[o.role || 'first']);
  o.prefs.forEach(clickOpt);
  click('nextBtn');
  clickOpt(o.pace);
  clickOpt(o.scope);
  click('nextBtn');
}
const spotNames = html => [...html.matchAll(/<button class="spotname"[^>]*>([^<]*)<\/button>/g)].map(m => m[1]);
const rowOfBreak = html => {                    // 含「中途午餐」的那一行的文本
  const i = html.indexOf(' 午餐 · 就近推荐');
  if (i < 0) return null;
  const before = html.slice(0, i);
  const nm = [...before.matchAll(/<button class="spotname"[^>]*>([^<]*)<\/button>/g)].pop();
  const st = [...before.matchAll(/游览 (\d+) 分钟/g)].pop();
  const sq = [...before.matchAll(/闭园前压缩至 (\d+) 分/g)].pop();
  return { name: nm && nm[1], stay: st && +st[1], shrink: sq && +sq[1] };
};
/* 这三组都是界面上真能选出来的组合（偏好不能为空：空偏好时「下一步」是禁用态） */
const CASES = [
  { days: 8, prefs: ['人文历史'], pace: '轻松', scope: '银川市全域' },
  { days: 3, prefs: ['摄影出片', '亲子友好'], pace: '紧凑', scope: '含银川周边' },
  { days: 5, prefs: ['自然风光'], pace: '标准', scope: '银川市全域' }
];

console.log('\n=== 4. 结果页：一天里每处景点只出现一行 ===');
let dupTotal = 0, dupDetail = [], splitDays = 0, splitCase = null;
CASES.forEach((o, ci) => {
  driveWizard(o);
  if (!dayCount()) { ok('第 ' + (ci + 1) + ' 组条件渲染出结果', false, '没有日卡片'); return; }
  const hs = dayHtmls();
  hs.forEach((h, i) => {
    const names = spotNames(h);
    names.filter((n, j) => names.indexOf(n) !== j).forEach(n => { dupTotal++; dupDetail.push('Day' + (i + 1) + ' ' + n); });
    if (/ 午餐 · 就近推荐/.test(h)) { splitDays++; if (!splitCase) splitCase = { html: h, day: i + 1 }; }
    /* 出现的都必须是真实景点名，防止把「午后续游」之类的标签渲染成一行 */
    const known = new Set(city.attractions.map(a => a.name));
    names.filter(n => !known.has(n)).forEach(n => { dupTotal++; dupDetail.push('未知行 ' + n); });
  });
  ok('第 ' + (ci + 1) + ' 组（' + o.days + ' 天 · ' + o.pace + '）渲染 ' + hs.length + ' 天无重复，且每行都是真实景点',
    hs.every(h => { const n = spotNames(h); return n.length === new Set(n).size && n.length > 0; }),
    hs.map((h, i) => 'Day' + (i + 1) + ' ' + spotNames(h).length + ' 行').join(' / '));
});
ok('跨 3 组条件累计无任何重复或异常行', dupTotal === 0, dupDetail.slice(0, 4).join('；') || '共 ' + CASES.length + ' 组');
ok('不再渲染「午后续游」这种读起来像第二趟的行', !dayHtmls().some(h => /午后续游/.test(h)));

console.log('\n=== 5. 结果页：切开的那一站按「一次游览」呈现 ===');
ok('这 3 组条件里出现过含中途午餐的一天', splitDays > 0, splitDays + ' 天');
if (splitCase) {
  const h = splitCase.html, row = rowOfBreak(h);
  const bk = h.match(/中途 (\d\d:\d\d)–(\d\d:\d\d) 午餐 · 就近推荐：([^（<]*)/);
  const tm = h.match(/(\d\d:\d\d) 到访 \/ (\d\d:\d\d) 离开/);
  ok('取到了「含中途午餐」那一行', !!row && !!row.name, row ? 'Day' + splitCase.day + ' ' + row.name : '未取到');
  ok('行内「游览 N 分钟」是这一趟的总时长，而不是某一段',
    !!row && row.stay >= 2 * E.SPLIT_MIN, row ? row.stay + ' 分钟（单一分段最多占一半，这里必须大于）' : '');
  ok('没有被误标成「闭园前压缩」', !row || row.shrink == null,
    row && row.shrink != null ? '误标为压缩至 ' + row.shrink + ' 分' : '无压缩标记');
  ok('写明了中途用餐的时刻与去处', !!bk, bk ? bk[1] + '–' + bk[2] + ' ' + bk[3] : '未找到');
  ok('写明了到访与离开时刻', !!tm, tm ? tm[1] + ' → ' + tm[2] : '未找到');
  if (tm && row && row.stay) {
    ok('离开 = 到访 + 总时长 + 用餐时长', toMin(tm[2]) === toMin(tm[1]) + row.stay + E.LUNCH,
      tm[1] + ' + ' + row.stay + ' + ' + E.LUNCH + ' = ' + hm(toMin(tm[1]) + row.stay + E.LUNCH) + '，行内写 ' + tm[2]);
  }
  ok('该站带「含中途午餐」标记', /含中途午餐 \d+ 分/.test(h));
  /* 同一顿午饭不能既写在景点行里、又单列一行「餐」：位置还排在景点行之后，
     与它实际发生在游览中途这件事是矛盾的。 */
  ok('中途午餐不再单列一行「餐」（不会同一顿写两遍）', !/>餐</.test(h));
  const names = spotNames(h);
  ok('同一张卡片里这一站只列一行', names.length === new Set(names).size, names.join(' / '));
}

console.log('\n=== 6. 攻略卡：两段读回一次游览（走真实的 openSpotGuide） ===');
/* 弹窗链路在桩里打不开（querySelectorAll 返回空），但 openSpotGuide 本身是可调的：
   与界面同一个入口、同一份上下文，只是绕开点击。 */
const r6 = E.plan(city, { days: 8, pace: 'relax', prefs: ['人文历史'], base: E.toBase(LOD.filter(x => x.id === 'lod-xinhua')[0], city), startAt: 9 * 60 });
const use6 = r6.city || city;
const built = r6.days.map(d => ({ d, tl: E.timeline(use6, d, r6.W) }));
let hit = null;
built.forEach((b, di) => b.tl.ev.forEach((e, k) => { if (!hit && e.k === 'visit' && e.break) hit = { di, k, e, b }; }));
ok('取到一处被午餐切开的到访', !!hit, hit ? 'Day' + (hit.di + 1) + ' ' + hit.e.a.name : '未取到');
if (hit) {
  window.__APP__.openSpotGuide({ city: use6, built }, hit.di, hit.k);
  const panel = nodes['guidePanel'] ? nodes['guidePanel']._h : '';
  ok('弹窗渲染出内容', panel.length > 200, panel.length + ' 字符');
  const stay = panel.match(/实际停留 <b>(\d+) 分钟<\/b>/);
  ok('停留时长取两段之和，不取前段', !!stay && +stay[1] === hit.e.total,
    stay ? '卡片写 ' + stay[1] + ' 分钟，引擎 total=' + hit.e.total + '，前段仅 ' + hit.e.stay + ' 分钟' : '未找到');
  ok('不会误报「被压缩了」', !/被压缩了/.test(panel));
  const leave = panel.match(/到访 (\d\d:\d\d) → 离开 (\d\d:\d\d)/);
  ok('离开时刻取后段终点', !!leave && toMin(leave[2]) === hit.e.break.back + (hit.e.total - hit.e.stay),
    leave ? leave[1] + ' → ' + leave[2] : '未找到');
  ok('卡片写明这是一次游览被午餐分成两段',
    /中途 \d\d:\d\d–\d\d:\d\d 用餐 \d+ 分钟/.test(panel) && /合起来仍是这一次/.test(panel));
  const stops = panel.match(/当天第 (\d+) \/ (\d+) 站/);
  const realStops = hit.b.tl.ev.filter(x => x.k === 'visit' && !x.cont).length;
  ok('站点数不把「午后续游」算成一站', !stops || +stops[2] === realStops,
    stops ? '卡片写 ' + stops[2] + ' 站，时间轴上独立点位 ' + realStops + ' 个 / items ' + hit.b.d.items.length + ' 个' : '当天只有一站');
  /* 顺带锁定：后段不能被误当成「另一个景点」而截断邻站查找 */
  const laterVisit = hit.b.tl.ev.slice(hit.k + 1).some(x => x.k === 'visit' && !x.cont);
  const nextMention = /下一站：/.test(panel);
  ok('后段不会被误当成「另一个景点」而截断邻站查找', !laterVisit || nextMention,
    laterVisit ? '当天后面还有点位，卡片写了「' + (nextMention ? '下一站' : '当天的最后一站') + '」' : '这是当天最后一站');
}

console.log('\n' + (fail === 0 ? '全部通过' : fail + ' 项未通过') + '：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail === 0 ? 0 : 1);

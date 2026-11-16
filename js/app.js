/* =============================================================================
 * 界面与交互 · 文旅导览智能体
 * 只负责渲染与事件，不含任何排程逻辑。所有行程与判定都由 js/engine.js 产出。
 *
 * 两条流程，共用同一套引擎：
 *   ① 出发前做计划（plan）—— 天数 → 偏好 → 节奏 → 范围 → 住宿位置
 *   ② 已在路上（now）   —— 位置 → 现在几点 → 今天去过哪些 → 兴趣 → 玩到几点
 *      选完立刻从「此刻」起算剩余时间，校验景区开放时间与停止入园时间，
 *      排除今天已去过的点，给出「还能去哪 / 为什么去不了」。
 *
 * 交互约定：
 *   单选步骤（天数/节奏/范围/时间/收工）点选后自动进入下一步，无需确认按钮。
 *   多选步骤（偏好/已去过）可勾多个，点「下一步」推进；「已去过」可跳过。
 *   住宿位置一改就推进；在①②两条流程中它分别位于最后一步与第一步。
 *
 * 住宿位置的三种来源，全部零成本、不依赖任何地图 API：
 *   ① 数据包选项（data/lodging.js）—— 覆盖绝大多数出行场景
 *   ② 浏览器定位 —— 原生 geolocation + 本地坐标转换，不调用地图服务
 *   ③ 手动输入坐标 —— 兜底，也是给「已在别处查好坐标」的用户留的入口
 * 三者最终都归一成一个 base 对象传给引擎，引擎不关心它从哪来。
 *
 * 关于时间：全站只有 NOW 这一处读取系统时间，读一次、之后全部作为参数传给引擎，
 * 因此引擎本身保持纯函数（零时间依赖），「同一时刻 + 同一输入 → 同一结果」成立。
 * 测试可用 window.__CLOCK__ = { min, dow } 注入固定时刻，从而完整复现整页输出。
 * 全站不使用随机数：讲解面板的 DOM id 由「天序号 + 事件序号」拼成。
 * ========================================================================== */

(function () {
  'use strict';

  var PREF_ALL = ['人文历史', '自然风光', '摄影出片', '亲子友好', '美食体验', '酒庄品鉴', '科普研学', '红色研学', '轻松休闲'];

  var PREF_DESC = {
    '人文历史': '西夏陵、岩画、古堡',
    '自然风光': '苏峪口、湿地、公园',
    '摄影出片': '日落、黄河、影城',
    '亲子友好': '湿地、军事博览园',
    '美食体验': '夜市、手抓、小吃',
    '酒庄品鉴': '贺兰山东麓酒庄',
    '科普研学': '博物馆、地质、生态',
    '红色研学': '黄河军事文化园',
    '轻松休闲': '花博园、阅海漫步'
  };

  var PACE_LABEL = { relax: '轻松', normal: '标准', tight: '紧凑', late: '夜间' };
  var PACE_DESC = {
    relax: '09:00–18:00 · 约 2 个点位',
    normal: '08:30–19:00 · 约 3 个点位',
    tight: '08:00–20:00 · 约 4 个点位'
  };
  var DAY_DESC = {
    1: '单日往返', 2: '周末游', 3: '经典行程', 4: '四日深度',
    5: '全域覆盖', 6: '全域 + 补漏', 7: '从容不赶', 8: '充裕慢游'
  };

  var SCOPE = {
    city: { label: '银川市全域', packs: ['yinchuan'] },
    with: { label: '含银川周边', packs: ['yinchuan', 'nearby'] }
  };

  /* 「去不了」的原因标签，与引擎里的 why 一一对应 */
  var WHY_LABEL = {
    visited: '今天已去过',
    closedToday: '今日闭馆',
    pastEntry: '已过停止入园时间',
    tooLate: '剩余时间不足',
    beforeOpen: '还没开门',
    far: '车程过远'
  };

  var LODGING = (window.CITY_DATA && window.CITY_DATA.lodging && window.CITY_DATA.lodging.lodgings) || [];

  function defaultLodging() {
    for (var i = 0; i < LODGING.length; i++) if (LODGING[i].isDefault) return LODGING[i];
    return LODGING[0] || null;
  }

  /* ---------- 时钟：全站唯一一处读取系统时间 ----------
   * 找不到窗口时（如某些容器环境）退回一个中性时刻，保证界面仍可用。
   */
  var NOW = (window.__CLOCK__ && window.__CLOCK__.min != null)
    ? { min: window.__CLOCK__.min, dow: window.__CLOCK__.dow == null ? 5 : window.__CLOCK__.dow }
    : (function () {
        try {
          var d = new Date();
          return { min: d.getHours() * 60 + d.getMinutes(), dow: d.getDay() };
        } catch (e) {
          return { min: 9 * 60, dow: 5 };
        }
      })();

  var WEEK_CN = '日一二三四五六';

  /* 条件状态：null 表示「尚未选择」，用于判断向导是否走完。
     住宿预选推荐默认值——若用户不改就推进，也要有一个明确出发点。 */
  var S = {
    days: null, prefs: [], pace: null, scope: null,
    lodgingId: (defaultLodging() || {}).id || null,
    customBase: null,
    startAt: null, visited: [],
    role: 'first'         // 'first' 第一次来 | 'repeat' 多次来 | 'local' 我是本地人
  };

  /* 身份三档的界面文案。引擎侧是 normRole()，这里只管怎么叫 */
  var ROLE_LABEL = { first: '第一次来银川', repeat: '多次来银川', local: '我是银川本地人' };

  var FLOW = 'plan';     // 'plan' 出行计划 | 'now' 已在路上
  var STEPS = [];
  var cur = 0;           // 当前步骤序号
  var busy = false;      // 自动推进的防重入锁
  var finished = false;  // 是否已出结果
  var nowDays = 1;       // 「已在路上」模式排几天（1 = 只算今天剩余）
  var dayIdx = 0;        // 结果页当前展示第几天（0 起）；一次只画一天
  var lastDayCount = 0;  // 最近一次生成的行程天数，供翻页条判断边界

  /* ---------- 小工具 ---------- */
  function hm(m) {
    var h = Math.floor(m / 60) % 24, mm = Math.round(m % 60);
    return (h < 10 ? '0' : '') + h + ':' + (mm < 10 ? '0' : '') + mm;
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function el(id) { return document.getElementById(id); }
  /* 换题时重放一次入场动效。没有 classList 的环境（测试桩）直接跳过，不影响任何逻辑。 */
  function replayIn(node) {
    if (!node || !node.classList) return;
    node.classList.remove('qanim');
    void node.offsetWidth;            /* 强制回流，让动画能够重新开始 */
    node.classList.add('qanim');
  }
  function findLodging(id) {
    for (var i = 0; i < LODGING.length; i++) if (LODGING[i].id === id) return LODGING[i];
    return null;
  }
  function top() { if (window.scrollTo) window.scrollTo(0, 0); }
  /* 多选步骤的值统一存成数组，避免为每个多选步骤各写一套状态 */
  function arr(key) { if (!S[key]) S[key] = []; return S[key]; }
  function packs() { return SCOPE[S.scope || 'with'].packs; }

  /* 范围内的景点数与区县数（用于选项说明，随数据包自动变化） */
  function scopeCounts(ids) {
    var n = 0, dist = {};
    ids.forEach(function (id) {
      var p = window.CITY_DATA && window.CITY_DATA[id];
      if (!p) return;
      (p.attractions || []).forEach(function (a) {
        n++;
        if (a.district) dist[a.district] = true;
      });
    });
    return { spots: n, districts: Object.keys(dist).length };
  }

  /* 「已去过」的候选：当前覆盖范围内的全部景点 */
  function visitedOptions() {
    var out = [];
    packs().forEach(function (id) {
      var p = window.CITY_DATA && window.CITY_DATA[id];
      if (!p) return;
      (p.attractions || []).forEach(function (a) {
        out.push({ value: a.id, label: a.name, desc: a.district + (a.level ? ' · ' + a.level : '') });
      });
    });
    return out;
  }

  /* ---------- 步骤定义 ---------- */
  var STEP_LODGING_PLAN = {
    key: 'lodging', short: '住宿', mode: 'lodging',
    title: '你住哪一带？', sub: '决定每天从哪出发；选定后立刻生成行程', options: null
  };
  var STEP_LODGING_NOW = {
    key: 'lodging', short: '位置', mode: 'lodging',
    title: '你现在在哪一带？', sub: '从当前位置出发，只算现在还走得完的点位', options: null
  };

  /* 身份步骤：同一份数据，三类人要的推荐恰好相反。
     第一次来的 3 天就该把 5A/4A 招牌看掉（否则「来银川三天没去西夏陵」）；
     多次来的招牌景点早年看过，权重下调、3A 与没评级的新鲜点位上浮；
     本地的 4A/5A 是年轻时就去过的地方，无评级与 3A 才是新鲜点位。
     权重由景点已有的 level 推导，见 engine.js 的 levelBonus。
     问法刻意不问「你是不是本地人」——那是查户口，容易让人不舒服；
     改问熟悉程度（第一次来 / 多次来 / 我是本地人），答案落在同一个三档上。 */
  var STEP_IDENTITY = {
    key: 'role', short: '取向', mode: 'single',
    title: '您对银川熟悉吗？', sub: '按熟悉程度给推荐：第一次来先看招牌，多次来换点新鲜的，本地就找小众去处',
    options: function () {
      return [
        { value: 'first', label: '第一次来', desc: '优先 5A/4A 知名景区，天数少也先把招牌看掉' },
        { value: 'repeat', label: '多次来', desc: '招牌景点往后排，多安排 3A 与没评级的新鲜点位' },
        { value: 'local', label: '我是本地人', desc: '4A/5A 是早年就去过的地方，优先没评级的小众点位' }
      ];
    }
  };

  var STEPS_PLAN = [
    {
      key: 'days', short: '天数', mode: 'single',
      title: '计划玩几天？', sub: '决定行程长度，按天数推荐线路',
      options: function () {
        var out = [];
        for (var n = 1; n <= 8; n++) out.push({ value: n, label: n + ' 天', desc: DAY_DESC[n] });
        return out;
      }
    },
    STEP_IDENTITY,
    {
      key: 'prefs', short: '偏好', mode: 'multi',
      title: '想看什么、玩什么？', sub: '可多选，按标签匹配景点；至少保留一项',
      options: function () {
        return PREF_ALL.map(function (p) { return { value: p, label: p, desc: PREF_DESC[p] }; });
      }
    },
    {
      key: 'pace', short: '节奏', mode: 'single',
      title: '每天想怎么安排？', sub: '决定每日可用时段，进而决定安排几个点位',
      options: function () {
        return ['relax', 'normal', 'tight'].map(function (k) {
          return { value: k, label: PACE_LABEL[k], desc: PACE_DESC[k] };
        });
      }
    },
    {
      key: 'scope', short: '范围', mode: 'single',
      title: '范围走多大？', sub: '决定候选景点池，含周边会把沙湖、青铜峡等一并纳入',
      options: function () {
        return Object.keys(SCOPE).map(function (k) {
          var c = scopeCounts(SCOPE[k].packs);
          return { value: k, label: SCOPE[k].label, desc: c.spots + ' 处景点 · ' + c.districts + ' 个区县' };
        });
      }
    },
    STEP_LODGING_PLAN
  ];

  var STEPS_NOW = [
    STEP_LODGING_NOW,
    {
      key: 'startAt', short: '时间', mode: 'single',
      title: '现在几点？', sub: '按此刻起算剩余可玩时间；改一下时间，可以看出可去点位的变化',
      options: function () {
        var out = [{ value: NOW.min, label: '现在 ' + hm(NOW.min), desc: '按当前时刻起算' }];
        [10, 12, 14, 16, 18, 20, 21].forEach(function (h) {
          var m = h * 60;
          if (m === NOW.min) return;
          out.push({
            value: m, label: hm(m),
            desc: h < 12 ? '上午出发' : h < 17 ? '午后出发' : h < 20 ? '傍晚出发' : '夜间出发'
          });
        });
        return out;
      }
    },
    {
      key: 'visited', short: '已去过', mode: 'multi', optional: true,
      title: '今天已经去过哪些？', sub: '已去过的不会再排进来；一个都没去过就直接点「下一步」',
      options: visitedOptions
    },
    {
      key: 'prefs', short: '兴趣', mode: 'multi',
      title: '接下来想看什么？', sub: '默认不限；可以点掉不感兴趣的标签',
      options: function () {
        return PREF_ALL.map(function (p) { return { value: p, label: p, desc: PREF_DESC[p] }; });
      }
    },
    {
      key: 'pace', short: '收工', mode: 'single',
      title: '今天打算玩到几点？', sub: '决定剩余可用时段，也决定夜市一类的夜游能不能算进来',
      options: function () {
        return [
          { value: 'relax', label: '到 18:00', desc: '约 1–2 个点位' },
          { value: 'normal', label: '到 19:00', desc: '约 2–3 个点位' },
          { value: 'tight', label: '到 20:00', desc: '约 3–4 个点位' },
          { value: 'late', label: '到 23:00', desc: '把夜市夜游一并算上' }
        ];
      }
    }
  ];

  /* ---------- 步骤指示条 ----------
   * 规则：前面每一步都答过了，这一步才算「可跳转」（绿色），可以直接点回去改，
   * 不必从头再答一遍。可选步骤（如「已去过」）永远视为已答。
   */
  function stepHasAnswer(i) {
    var st = STEPS[i];
    if (st.mode === 'multi') return st.optional ? true : arr(st.key).length > 0;
    if (st.mode === 'lodging') return true;      // 有预选默认值
    /* 布尔键特例：false 也可能是合法默认答案（曾踩过——身份步早先是布尔量，
       `!!S[key]` 会让默认态在步骤条上永远显示未答、点不回去）。
       现在身份是三档字符串、默认 'first'，走下面的真值判断即可；这个分支留着，
       是为了再有布尔型步骤时不用重新想起这条。 */
    if (typeof S[st.key] === 'boolean') return true;
    return !!S[st.key];
  }
  function stepJumpable(i) {
    for (var k = 0; k < i; k++) if (!stepHasAnswer(k)) return false;
    return stepHasAnswer(i);
  }

  function renderSteps() {
    var host = el('stepsBar');
    host.innerHTML = '';
    STEPS.forEach(function (st, i) {
      var jumpable = i !== cur && stepJumpable(i);
      var d = document.createElement('div');
      d.className = 'step' + (i === cur ? ' now' : (jumpable ? ' past' : ''));
      d.textContent = (i + 1) + '. ' + st.short;
      if (jumpable) d.onclick = function () { goTo(i); };
      host.appendChild(d);
    });
  }

  /* ---------- 已选条件面包屑 ---------- */
  function renderPicked() {
    var parts = [];
    if (FLOW === 'now') {
      var l = findLodging(S.lodgingId);
      if (S.customBase) parts.push('位置 <b>' + esc(S.customBase.name) + '</b>');
      else if (l) parts.push('位置 <b>' + esc(l.name) + '</b>');
      if (S.startAt != null) parts.push('现在 <b>' + hm(S.startAt) + '</b>');
      if (S.visited.length) parts.push('已去过 <b>' + S.visited.length + ' 处</b>');
      if (S.prefs.length) {
        parts.push('兴趣 <b>' + (S.prefs.length === PREF_ALL.length ? '不限' : esc(S.prefs.join('、'))) + '</b>');
      }
      if (S.pace) parts.push('玩到 <b>' + hm(Engine.PACE[S.pace].e) + '</b>');
    } else {
      if (S.days) parts.push('天数 <b>' + S.days + ' 天</b>');
      parts.push('取向 <b>' + (ROLE_LABEL[S.role] || ROLE_LABEL.first) + '</b>');
      if (S.prefs.length) parts.push('偏好 <b>' + esc(S.prefs.join('、')) + '</b>');
      if (S.pace) parts.push('节奏 <b>' + PACE_LABEL[S.pace] + '</b>');
      if (S.scope) parts.push('范围 <b>' + SCOPE[S.scope].label + '</b>');
    }
    el('picked').innerHTML = parts.length ? '已选：' + parts.join(' · ') : '';
  }

  /* ---------- 选项渲染 ---------- */
  function isOn(st, value) {
    if (st.mode === 'multi') return arr(st.key).indexOf(value) >= 0;
    return S[st.key] === value;
  }

  function renderOpts(st) {
    var host = el('opts');
    host.innerHTML = '';
    st.options().forEach(function (o) {
      var d = document.createElement('div');
      d.className = 'opt' + (isOn(st, o.value) ? ' on' : '');
      var t = document.createElement('div'); t.className = 'ot'; t.textContent = o.label;
      var s = document.createElement('div'); s.className = 'od'; s.textContent = o.desc || '';
      d.appendChild(t); d.appendChild(s);
      /* 把取值记在节点上：更新选中态时按取值对位，而不是靠「节点顺序 = options() 顺序」 */
      d.dataset.value = String(o.value);
      d.onclick = function () {
        if (st.mode === 'multi') {
          var list = arr(st.key), i = list.indexOf(o.value);
          if (i >= 0) {
            /* 偏好至少保留一项；「已去过」可以一项不选 */
            if (st.key !== 'prefs' || list.length > 1) list.splice(i, 1);
          } else {
            list.push(o.value);
          }
          /* 只改选中态，不重建节点：重建会让整排卡片的入场动效重播，
             多选时每点一下都闪一次，连点体验很差。 */
          paintOpts(st);
          syncChoice(st);
        } else {
          chooseSingle(st, o.value);
        }
      };
      host.appendChild(d);
    });
  }

  /* 切换 `.opt` 的选中类。不碰 DOM 结构，所以入场动效只在这一页第一次渲染时播一次。
     按节点上记的取值对位（dataset.value），与 options() 的返回顺序无关；
     万一某个节点上没有记取值，就退回按序号对应。 */
  function paintOpts(st) {
    if (st.mode !== 'multi' && st.mode !== 'single') return;
    var host = el('opts');
    var kids = host.children || [];
    var list = st.options();
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i];
      var v = (k.dataset && k.dataset.value != null) ? k.dataset.value
        : (list[i] ? list[i].value : undefined);
      if (v === undefined) continue;
      var on;
      if (st.mode === 'multi') {
        var cur = arr(st.key);
        on = false;
        for (var j = 0; j < cur.length; j++) if (String(cur[j]) === String(v)) { on = true; break; }
      } else {
        on = S[st.key] != null && String(S[st.key]) === String(v);
      }
      var want = 'opt' + (on ? ' on' : '');
      if (k.className !== want) k.className = want;
    }
  }

  /* 与 renderStep 里同源的一小段：按钮可用性 + 已选面包屑。选一下就要变，但不值得整页重绘。 */
  function syncChoice(st) {
    var btn = el('nextBtn');
    btn.disabled = (st.mode === 'multi' && !st.optional && arr(st.key).length === 0);
    renderPicked();
  }

  /* ---------- 单选：点选后自动进入下一步 ---------- */
  function chooseSingle(st, value) {
    if (busy) return;
    S[st.key] = value;
    /* 先把高亮画出来，让用户看到自己选了什么。这里同样不整页重绘 ——
       否则会先重播一遍本页动效，再跳下页播第二遍，看起来像「同一页出现了两次」。 */
    paintOpts(st);
    syncChoice(st);
    busy = true;
    /* 停顿 180ms：留出勾选动效（160ms）播完的时间，再切页。
       短于动画时长就会被切页打断，看着像「闪一下就走」。 */
    setTimeout(function () {
      busy = false;
      if (cur < STEPS.length - 1) goTo(cur + 1);
      else finish();
    }, 180);
  }

  /* ---------- 渲染当前步骤 ---------- */
  function renderStep() {
    var st = STEPS[cur];
    var isLod = st.mode === 'lodging';
    var isLast = cur === STEPS.length - 1;

    el('qTitle').textContent = st.title;
    el('qSub').textContent = st.sub;
    renderSteps();

    el('opts').style.display = isLod ? 'none' : 'grid';
    el('lodBlock').style.display = isLod ? 'block' : 'none';
    /* 住宿步骤在「已在路上」流程里是第一步，按钮仍应是「下一步」 */
    el('lodNoteLabel').textContent = FLOW === 'now' ? '住宿位置（可改用定位或手输坐标）' : '';
    if (!isLod) renderOpts(st);
    else syncLodging();

    var btn = el('nextBtn');
    btn.style.display = (st.mode === 'multi' || isLod) ? 'inline-block' : 'none';
    btn.textContent = isLast ? '生成行程' : '下一步';
    btn.disabled = (st.mode === 'multi' && !st.optional && arr(st.key).length === 0);
    btn.onclick = function () { if (isLast) finish(); else goTo(cur + 1); };

    el('back').style.display = cur === 0 ? 'none' : 'inline-block';
    /* 第一步单选时既没有「上一步」也没有「下一步」，这一行只剩一条虚线边框 —— 整行收起来 */
    var navBar = el('navBar');
    if (navBar) navBar.style.display = (cur > 0 || st.mode === 'multi' || isLod) ? 'flex' : 'none';
    renderPicked();
    replayIn(el('qHead'));
  }

  /* ---------- 步骤跳转 ---------- */
  function goTo(i) {
    if (finished) restoreWizard();
    cur = Math.max(0, Math.min(STEPS.length - 1, i));
    renderStep();
    top();
  }

  function clearOutput() {
    el('result').style.display = 'none';
    el('cond').innerHTML = '';
    el('nowInfo').innerHTML = '';
    el('nowInfo').style.display = 'none';
    el('cand').innerHTML = '';
    el('notice').innerHTML = '';
    el('mapBox').innerHTML = '';
    el('days').innerHTML = '';
    el('dayNav').innerHTML = '';
    dayIdx = 0;
    lastDayCount = 0;
    mapDay = null;
    mapState = null;
  }

  function restoreWizard() {
    finished = false;
    el('wizard').style.display = 'block';
    clearOutput();
  }

  function finish() {
    /* 兜底：从步骤条跳过来时可能还有未答项，直接送回第一个没答的步骤 */
    for (var i = 0; i < STEPS.length; i++) {
      var st = STEPS[i];
      if (st.mode === 'multi' && !st.optional && !arr(st.key).length) { goTo(i); return; }
      if (st.mode === 'single' && (S[st.key] === null || S[st.key] === undefined || S[st.key] === '')) { goTo(i); return; }
    }
    finished = true;
    dayIdx = 0;                 // 新生成的行程总是从第 1 天开始看
    mapDay = null;              // 地图回到「全部」视角
    el('wizard').style.display = 'none';
    renderResult();
    top();
  }

  /* ---------- 模式切换 ---------- */
  function setFlow(f) {
    if (FLOW === f && !finished) return;
    FLOW = f;
    if (f === 'now') {
      STEPS = STEPS_NOW;
      S.scope = 'with';              // 「已在路上」默认把周边也纳入候选，便于就近选择
      S.prefs = PREF_ALL.slice();    // 兴趣默认不限，少点一次
      S.pace = 'normal';
      S.visited = [];
      S.startAt = null;
      S.days = 1;
    } else {
      STEPS = STEPS_PLAN;
      S.days = null;
      S.prefs = [];
      S.pace = null;
      S.scope = null;
      S.role = 'first';     // 回到计划流程默认「第一次来」，与首屏一致
      S.startAt = null;
      S.visited = [];
    }
    nowDays = 1;
    cur = 0;
    finished = false;
    el('modePlan').className = 'mode' + (f === 'plan' ? ' on' : '');
    el('modeNow').className = 'mode' + (f === 'now' ? ' on' : '');
    el('wizard').style.display = 'block';
    clearOutput();
    renderStep();
  }

  /* ---------- 住宿位置 ---------- */
  function buildLodgingSelect() {
    var sel = el('lodging');
    sel.innerHTML = '';
    var order = [], byGroup = {};
    LODGING.forEach(function (l) {
      if (!byGroup[l.group]) { byGroup[l.group] = []; order.push(l.group); }
      byGroup[l.group].push(l);
    });
    order.forEach(function (g) {
      var og = document.createElement('optgroup');
      og.label = g;
      byGroup[g].forEach(function (l) {
        var op = document.createElement('option');
        op.value = l.id;
        op.textContent = l.name;
        og.appendChild(op);
      });
      sel.appendChild(og);
    });
    sel.onchange = function () {
      S.lodgingId = sel.value;
      S.customBase = null;
      el('lodStatus').textContent = '';
      showLodgingNote();
      advanceFromLodging();
    };
  }

  function syncLodging() {
    var sel = el('lodging');
    if (S.lodgingId) sel.value = S.lodgingId;
    showLodgingNote();
  }

  function showLodgingNote() {
    var l = findLodging(S.lodgingId);
    el('lodNote').textContent = l ? '适合：' + l.note : '';
  }

  /* 住宿步骤完成后的去向：它可能是最后一步（出行计划），也可能是第一步（已在路上） */
  function advanceFromLodging() {
    if (cur < STEPS.length - 1) goTo(cur + 1);
    else finish();
  }

  function useDefault() {
    var d = defaultLodging();
    S.lodgingId = d ? d.id : null;
    S.customBase = null;
    el('lodStatus').textContent = '';
    syncLodging();
    advanceFromLodging();
  }

  /* 浏览器定位：原生 geolocation + 本地坐标转换，不调用任何地图服务 */
  function useGeo() {
    var st = el('lodStatus');
    if (!navigator.geolocation) {
      st.textContent = '当前浏览器不支持定位，请改用上方的住宿位置选项。';
      return;
    }
    st.textContent = '正在请求定位…（浏览器会弹出授权提示）';
    navigator.geolocation.getCurrentPosition(function (pos) {
      var g = Engine.wgs84ToGcj02(pos.coords.longitude, pos.coords.latitude);
      var city = Engine.buildCity(packs());
      var b = { id: 'base', name: '浏览器定位位置', district: '—', lng: g.lng, lat: g.lat };
      b.urban = Engine.inferUrban(city, b);
      b.roadKph = b.urban ? 58 : 54;
      S.customBase = b;
      st.textContent = '已定位并转换为 GCJ-02：' + g.lng + ', ' + g.lat +
        '（精度 ±' + Math.round(pos.coords.accuracy) + ' 米）';
      advanceFromLodging();
    }, function (err) {
      var why = { 1: '授权被拒绝', 2: '位置不可用', 3: '定位超时' }[err && err.code] ||
                (err && err.message) || '未知原因';
      st.textContent = '定位未成功（' + why + '）。以本地文件（file://）方式打开页面时，浏览器通常不允许定位；' +
        '请改用上方的住宿位置选项，或手动输入坐标。';
    }, { enableHighAccuracy: true, timeout: 9000, maximumAge: 0 });
  }

  function applyCoord() {
    var st = el('lodStatus');
    var lng = parseFloat(el('inLng').value), lat = parseFloat(el('inLat').value);
    if (!isFinite(lng) || !isFinite(lat)) { st.textContent = '请填写有效的经纬度（GCJ-02）。'; return; }
    if (lng < 73 || lng > 136 || lat < 3 || lat > 54) {
      st.textContent = '坐标超出中国境内范围，请检查经纬度是否填反。';
      return;
    }
    var city = Engine.buildCity(packs());
    var b = { id: 'base', name: '自定义坐标', district: '—', lng: lng, lat: lat };
    b.urban = Engine.inferUrban(city, b);
    b.roadKph = b.urban ? 58 : 54;
    S.customBase = b;
    st.textContent = '已应用自定义坐标（GCJ-02 ' + lng + ', ' + lat + '）。';
    advanceFromLodging();
  }

  function currentBase(city) {
    if (S.customBase) return S.customBase;
    var l = findLodging(S.lodgingId);
    return l ? Engine.toBase(l, city) : null;
  }

  /* ---------- 跑一次排程 ---------- */
  function runOnce(city, base, extra) {
    var o = { days: S.days, prefs: S.prefs, pace: S.pace, role: S.role || 'first' };
    if (base) o.base = base;
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) o[k] = extra[k];
    var r = Engine.plan(city, o);
    var use = r.city || city;          // plan() 回传真正生效的 city（含覆盖后的 base）
    var built = r.days.map(function (d) { return { d: d, tl: Engine.timeline(use, d, r.W) }; });
    return { r: r, city: use, built: built, sum: Engine.summarize(use, built) };
  }

  /* 对话层 / 测试共用的纯排程入口。与 runOnce 同构，但吃一份「与向导 S 同字段」的
     state 而非全局 S——这是「对话层不改变排程结果」的结构性保证：同一份 state 走对话
     还是走向导，planWith 都是同一个函数，排程输出逐字节一致。向导自身仍走 runOnce
     （保持历史行为不动），两者构造的 opts 必须同构（见上：days/prefs/pace/role，
     scope 不进 opts，只决定 buildCity 加载哪些数据包）。
     住宿位置：customBase 优先，否则用 lodgingId 经数据包换算成 base。 */
  function planWith(city, state, extra) {
    /* 空偏好 = 不限，与向导「不限」同义；展开成全部偏好，确保「对话层不填偏好」
       与「表单选不限」产出完全一致，而不是被引擎当成「完全无偏好（每处 0 分）」。 */
    var prefs = (state.prefs && state.prefs.length) ? state.prefs : PREF_ALL.slice();
    var o = { days: state.days, prefs: prefs, pace: state.pace, role: state.role || 'first' };
    var base = state.customBase;
    if (!base && state.lodgingId) {
      var l = findLodging(state.lodgingId);
      if (l) base = Engine.toBase(l, city);
    }
    if (base) o.base = base;
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) o[k] = extra[k];
    var r = Engine.plan(city, o);
    var use = r.city || city;
    var built = r.days.map(function (d) { return { d: d, tl: Engine.timeline(use, d, r.W) }; });
    return { r: r, city: use, built: built, sum: Engine.summarize(use, built) };
  }

  /* ---------- 结果页公共部件 ---------- */
  function metricHtml(items) {
    return items.map(function (m) {
      return '<div class="metric"><div class="k">' + m[0] + '</div><div class="v">' + m[1] +
        '<small>' + m[2] + '</small></div></div>';
    }).join('');
  }

  function criteriaHtml(list) {
    return list.map(function (t) { return '<span><i>✓</i>' + t + '</span>'; }).join('');
  }

  function condHtml(pairs) {
    return pairs.map(function (it) {
      return '<span>' + esc(it[0]) + '：<b>' + esc(it[1]) + '</b></span>';
    }).join('');
  }

  /* ---------- 视觉品类 ----------
   * 品类是数据包里的字段（spot.cat），配色与插画来自 data/cats.js —— 那是一份
   * 不绑定城市的字典。界面只做两件事：把品类名取出来当标签，把插画取出来当题图。
   * 因此换一座城市，只要新数据包给景点标了 cat，这里一行都不用改。
   */
  var FALLBACK_CAT = { label: '', tint: '#5F5E5A', wash: '#F1EFE8', line: '#D3D1C7', art: '' };

  function catOf(spot) {
    var c = window.catVisual ? window.catVisual(spot) : null;
    return c || FALLBACK_CAT;
  }

  function catPill(spot) {
    var c = catOf(spot);
    if (!c.label) return '';
    return '<span class="catpill" style="color:' + c.tint + ';background:' + c.wash +
      ';border-color:' + c.line + '">' + esc(c.label) + '</span>';
  }

  /* ---------- 照片素材（可选层） ----------
   * data/photos.js 按景点 id 给出「已确认可用」的实景照片。查不到就回退品类插画，
   * 所以那份清单可以是空的、也可以只填一部分，页面永远能正常渲染 ——
   * 找不到 CC0／公有领域素材的点位，保持插画即可，这里一行都不用改。
   * 界面只按 id 查表，不判断照片内容，与品类那套是同一个思路。
   */
  var PHOTO_MAP = null;

  function photoOf(spot) {
    if (!spot || !spot.id) return null;
    if (!PHOTO_MAP) {
      PHOTO_MAP = {};
      var P = window.PHOTOS;
      (P && P.items ? P.items : []).forEach(function (it) {
        /* 同一景点多张时取第一条；空/非法条目静默跳过，不让素材问题打断渲染 */
        if (it && it.id && it.file && !PHOTO_MAP[it.id]) PHOTO_MAP[it.id] = it;
      });
    }
    return PHOTO_MAP[spot.id] || null;
  }

  /* 照片出处：CC0 与公有领域都不强制署名，仍然写出来 —— 一是留档，
     二是初审的「材料完整性」与决赛答辩都要求能说清素材来源。 */
  function photoCredit(ph) {
    if (!ph) return '';
    return '图：' + (ph.author || '未署名') + ' · ' + (ph.license || '');
  }

  /* 品类构成：把一趟行程按品类汇总成一条彩带 + 图例。
     排序是「数量降序 → 品类 id 字典序」，并列也有确定顺序，所以同一趟行程
     两次渲染逐字节一致（与引擎里的 tieId 是同一个约定）。 */
  function catBarHtml(counts) {
    var keys = Object.keys(counts || {});
    if (!keys.length) return '';
    var total = keys.reduce(function (s, k) { return s + counts[k]; }, 0);
    if (!total) return '';
    keys.sort(function (a, b) { return counts[b] - counts[a] || (a < b ? -1 : a > b ? 1 : 0); });

    var seg = keys.map(function (k) {
      var c = window.CAT_VISUALS[k] || FALLBACK_CAT;
      return '<span style="flex:' + counts[k] + ';background:' + (c.tint || '#8A8880') + '"></span>';
    }).join('');
    var legend = keys.map(function (k) {
      var c = window.CAT_VISUALS[k] || FALLBACK_CAT;
      var col = c.tint || '#8A8880';
      return '<span class="cl"><i style="background:' + col + '"></i>' +
        '<b style="color:' + col + '">' + esc(c.label || k) + '</b>' +
        '<em>' + counts[k] + '</em></span>';
    }).join('');

    return '<div class="catbar"><div class="cbar">' + seg + '</div>' +
      '<div class="cleg">' + legend + '</div></div>';
  }

  /* 缩略图用的插画：同一幅图按景点 id 错开取景。
     同一天连着走三个同类点位时，三张缩略图不会长得一模一样，
     但用的仍是同一份素材 —— 没有多画一张图，也没有引入随机数
     （位移只由 id 决定，所以整页 DOM 依旧可复现）。 */
  function thumbArt(spot) {
    /* 有实景照片就用照片，没有才退回插画。这里的裁剪是允许的：
       我们只收 CC0 与公有领域，两者都不限制修改，所以「错开取景」照用。 */
    var ph = photoOf(spot);
    if (ph) return '<img class="catphoto" src="' + esc(ph.file) + '" alt="">';
    var s = (spot && spot.id) || '';
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return catOf(spot).art.replace('<svg class="catart"',
      '<svg class="catart" style="left:-' + (h % 44) + '%"');
  }

  /* 一趟行程里各品类各出现几次（含夜游点位） */
  function catCounts(plan) {
    var m = {};
    plan.built.forEach(function (b) {
      b.d.items.forEach(function (it) { m[it.a.cat] = (m[it.a.cat] || 0) + 1; });
      if (b.d.night) m[b.d.night.cat] = (m[b.d.night.cat] || 0) + 1;
    });
    return m;
  }

  /* 日卡片：逐日时间轴。wait 事件表示到达后等待开园；游览时长可能因闭园被压缩。
   * 一次只画一天：5–8 天的行程一屏铺开会失去重点，也让看的人不知道该看哪一天。
   * 默认第 1 天，点「下一天」才翻到第 2 天；分页条见 renderDayNav。
   */
  function renderDays(host, plan, W) {
    host.innerHTML = '';
    var total = plan.built.length;
    lastDayCount = total;
    if (!total) { renderDayNav(plan); return; }
    dayIdx = Math.max(0, Math.min(total - 1, dayIdx));

    var i = dayIdx;
    var b = plan.built[i];
    if (b) {
      var d = b.d, tl = b.tl;
      var dcName = d.district ? (plan.city.districts[d.district] || d.district) : '未安排';
      var dayTicket = d.items.reduce(function (s, x) { return s + x.a.ticket; }, 0) +
                      (tl.nightOn ? tl.nightOn.ticket : 0);
      var dayDrive = tl.ev.filter(function (e) { return e.k === 'travel'; })
                         .reduce(function (s, e) { return s + e.min; }, 0);
      var dayStart = d.startAt != null ? d.startAt : W.s;

      var box = document.createElement('div');
      box.className = 'day';
      /* 当天去了哪几类地方：一眼看出这一天的"性格"（湖泽湿地日 / 西夏古堡日） */
      var dayCats = {};
      d.items.forEach(function (x) { dayCats[x.a.cat] = (dayCats[x.a.cat] || 0) + 1; });
      if (tl.nightOn) dayCats[tl.nightOn.cat] = (dayCats[tl.nightOn.cat] || 0) + 1;
      var dayCatPills = Object.keys(dayCats).sort().map(function (k) {
        var c = window.CAT_VISUALS[k] || FALLBACK_CAT;
        if (!c.label) return '';
        return '<span class="catpill" style="color:' + c.tint + ';background:' + c.wash +
          ';border-color:' + c.line + '">' + esc(c.label) + ' ' + dayCats[k] + '</span>';
      }).join('');
      box.innerHTML =
        '<div class="day-h">' +
          '<span class="d">Day ' + (i + 1) + '</span>' +
          '<span class="meta">' + esc(dcName) + ' · ' + hm(dayStart) + '–' + hm(tl.end) + '</span>' +
          '<span class="cost">车程 ' + dayDrive + ' 分 · 门票约 ¥' + dayTicket + '/人</span>' +
        '</div>' +
        (dayCatPills ? '<div class="day-cats">' + dayCatPills + '</div>' : '');

      if (!d.items.length) {
        var empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = d.reason === 'too-far'
          ? '该日未安排：剩下的可选点位都超出当前位置的可达范围，继续排只会变成整天赶路。可改选更靠近景区的住宿位置，或减少天数。'
          : d.reason === 'window'
            ? (d.early
                ? '该日未安排：这个时刻景点还没开门，现在赶过去只能在外面等。把「现在几点」改到开门之后（多数景点 08:30–09:00 开门）即可自动排上。'
                : '该日未安排：这个时刻已经赶不上任何景点的开放时间（或过了停止入园时间、剩余时间不足以走完最短游览）。把「玩到几点」往后调一档，或改成更早的时刻看看。')
            : '该日无合适点位（偏好过窄或可选景点已排完），可放宽兴趣偏好或增加覆盖范围。';
        box.appendChild(empty);
      }

      tl.ev.forEach(function (e, k) {
        var row = document.createElement('div');
        row.className = 'ev ev-' + e.k;
        if (e.k === 'travel') {
          /* 回驻点那一段写成「返回」，图标也用「回」：它与「前往某景区」是两回事，
             一天的收尾必须看得出来。否则读者会把它当成当天的第 N+1 站。 */
          row.innerHTML =
            '<div class="t">' + hm(e.at - e.min) + '</div><div class="ic">' + (e.ret ? '回' : '车') + '</div>' +
            '<div class="bd"><div class="ttl">' + (e.ret ? '返回 ' : '前往 ') + esc(e.to) +
            ' <span class="tag">' + e.min + ' 分钟</span></div>' +
            '<div class="sub">从' + esc(e.from) + '出发' + (e.evening ? '（晚间）' : '') +
            (e.ret ? '　·　当日行程到此收尾' : '') + '</div></div>';
        } else if (e.k === 'wait') {
          row.innerHTML =
            '<div class="t">' + hm(e.at) + '</div><div class="ic">候</div>' +
            '<div class="bd"><div class="ttl">等待开园 <span class="tag">' + e.min + ' 分钟</span></div>' +
            '<div class="sub">' + esc(e.name) + ' 于 ' + hm(e.openAt) + ' 开始接待</div></div>';
        } else if (e.k === 'meal') {
          /* 被切进景点中途的那顿午餐已经写在景点行里了（时间、时长、去处都在），
             再单列一行会出现同一顿午饭写两遍，而且位置在景点行之后，
             与它实际发生在 11:37–14:37 之间这件事读起来是矛盾的。 */
          if (e.inVisit) return;
          row.innerHTML =
            '<div class="t">' + hm(e.at) + '</div><div class="ic">餐</div>' +
            '<div class="bd"><div class="ttl">' + e.kind + ' <span class="tag m">' + e.min + ' 分钟</span></div>' +
            '<div class="sub">就近推荐：' + esc(e.place ? e.place.name : '—') +
            (e.place ? '（' + esc(e.place.district) + '）' : '') + '</div></div>';
        } else if (e.k === 'evening') {
          row.innerHTML =
            '<div class="t">' + hm(e.at) + '</div><div class="ic">晚</div>' +
            '<div class="bd"><div class="ttl">晚间自由活动 <span class="tag">' + e.min + ' 分钟</span></div>' +
            '<div class="sub">驻点就近推荐：' + esc(e.place) + '</div></div>';
        } else {
          var a = e.a;
          /* 被午餐切开的游览，后半段不单独出一行：它已经并进前一段那一行里了
             （前段带 break 标记，行内写明中途几点吃饭）。否则同一天会出现同一处景点两行，
             用户读到的就是「一天里重复推荐了一个地方」。 */
          if (e.cont) return;
          /* id 由「天序号 + 事件序号」拼成，不含随机量，整页 HTML 因此可复现。
             景点名本身是打开「游玩攻略」的按钮（带 data-spot / data-day / data-ev，
             点击时按天序号 + 事件序号回到这份时间轴上取上下文）。 */
          var id = 'j-' + i + '-' + k;
          /* 游览时长一律按「这一次游览总共多久」算：被切开的点用 total（两段之和），
             否则就是本段的 to - from。用分段时长会让 3 小时的到访显示成两个 1.5 小时，
             连「闭园前压缩」的提示也会跟着算错。 */
          var full = e.total != null ? e.total : (e.to - e.from);
          var shrunk = a.stay != null && full < a.stay;
          var cv = catOf(a);
          var catTag = cv.label
            ? ' <span class="tag cat" style="color:' + cv.tint + ';background:' + cv.wash +
              ';border-color:' + cv.line + '">' + esc(cv.label) + '</span>' : '';
          row.innerHTML =
            '<div class="t">' + hm(e.from) + '</div><div class="ic">' + (e.evening ? '夜' : '点') + '</div>' +
            '<div class="bd"><div class="bdrow">' +
              /* 品类缩略图：同一类地方共用一幅自绘插画，是同一个视觉锚点 */
              '<span class="thumb" style="border-color:' + cv.line + '">' + thumbArt(a) + '</span>' +
              '<div class="bdcol"><div class="ttl">' +
                '<button class="spotname" id="' + id + '" data-spot="' + esc(a.id) +
                  '" data-day="' + i + '" data-ev="' + k + '" title="查看游玩攻略">' + esc(a.name) + '</button>' +
                (a.level ? ' <span class="tag lv">' + a.level + '</span>' : '') +
                catTag +
                (e.cont ? ' <span class="tag">午后续游</span>' : '') +
                (e.evening ? ' <span class="tag m">夜游</span>' : '') +
                (shrunk ? ' <span class="tag m">闭园前压缩至 ' + full + ' 分</span>' : '') +
                ' <span class="tag z">游览 ' + full + ' 分钟</span>' +
                (e.break ? ' <span class="tag m">含中途午餐 ' + e.break.min + ' 分</span>' : '') +
                ' <span class="tag">' + (a.ticket ? '¥' + a.ticket : '免费') + '</span>' +
                /* 免票日短标签：只回答「这天不一定得付全价」，精确到哪个时段免哪几天
                   由攻略卡讲（Engine.freeTagText 从数据包拼，界面不识字面政策）。 */
                (a.free ? ' <span class="tag m">' + esc(Engine.freeTagText(a.free)) + '</span>' : '') +
                '</div>' +
              '<div class="sub">' + esc(a.district) + '｜' + a.tags.join(' · ') +
                '｜开放 ' + esc(a.open) +
                /* 这一站横跨饭点、饭在园里（或门口）吃：把「几点到、几点吃、几点走」写在同一行里，
                   时间轴因此不会看起来像两趟。 */
                (e.break ? '<br><span class="brk">中途 ' + hm(e.break.at) + '–' +
                  hm(e.break.at + e.break.min) + ' 午餐 · 就近推荐：' +
                  esc(e.break.place ? e.break.place.name : '—') +
                  (e.break.place ? '（' + esc(e.break.place.district) + '）' : '') +
                  '　·　' + hm(e.from) + ' 到访 / ' + hm(e.break.back + (e.total - e.stay)) + ' 离开</span>' : '') +
                '</div></div>' +
            '</div></div>';
        }
        box.appendChild(row);
      });

      host.appendChild(box);
    }

    renderDayNav(plan);

    host.querySelectorAll('.spotname').forEach(function (btn) {
      btn.onclick = function () {
        openSpotGuide(plan, +btn.dataset.day, +btn.dataset.ev);
      };
    });
  }

  /* ==========================================================================
   * 景点攻略弹窗
   * --------------------------------------------------------------------------
   * 内容全部由 Engine.spotGuide() 现算（引擎是纯函数，界面只负责排版）。
   * 界面额外负责一件事：把「这次行程里对这个点的实际安排」告诉引擎——
   * 第几站、几点进几点出、停留是否被压缩、前一站从哪来、后一站去哪。
   * 这些只存在于时间轴上，数据包里没有，所以由界面取好再传进去。
   * ========================================================================== */

  /* 在时间轴里就近找一个车程事件：取这一站之前/之后最近的一段路 */
  function neighborTravel(list, idx, dir) {
    for (var q = idx + dir; q >= 0 && q < list.length; q += dir) {
      var e = list[q];
      if (e.k === 'travel') return { name: dir < 0 ? e.from : e.to, min: e.min };
      /* 「午后续游」是同一次游览的后半段，不是另一个景点，必须穿过去继续找，
         否则被午餐切开的这一站会被误判成「当天的最后一站」。 */
      if (e.k === 'visit' && !e.cont) break;   // 中间隔着另一个景点就不再往外找
    }
    return null;
  }

  function openSpotGuide(plan, di, evIdx) {
    if (!plan || !plan.built || di < 0 || evIdx < 0) return;   // 越界或未生成行程时静默返回
    var b = plan.built[di];
    if (!b || !b.tl.ev[evIdx] || !b.tl.ev[evIdx].a) return;
    var ev = b.tl.ev[evIdx], a = ev.a, tl = b.tl;

    /* 全行程已排到的点位，用于在「顺路可去」里标出「已在行程中」 */
    var inPlanIds = {};
    plan.built.forEach(function (x) {
      x.d.items.forEach(function (it) { inPlanIds[it.a.id] = true; });
      if (x.tl.nightOn) inPlanIds[x.tl.nightOn.id] = true;
    });

    /* 「当天第几站」不把「午后续游」算成一站：它是同一次游览的后半段。 */
    var visits = tl.ev.filter(function (x) { return x.k === 'visit' && !x.cont; });
    var at = visits.indexOf(ev);
    var d = b.d;
    /* 被午餐切开的一次游览：到访时刻取前段起点，离开时刻取后段终点，停留时长取两段之和。
       若按分段算，卡片会写「实际停留 45 分钟、比建议少了 45 分钟」，
       而行程里其实给足了 90 分钟、只是中间吃了一顿饭 —— 那就成了假话。 */
    var full = ev.total != null ? ev.total : (ev.to - ev.from);
    var endAt = ev.break ? ev.break.back + (full - ev.stay) : ev.to;

    var g = Engine.spotGuide(plan.city, a, {
      inPlanIds: inPlanIds,
      trimmed: a.stay != null && full < a.stay,
      visited: S.visited.indexOf(a.id) >= 0,
      visit: {
        day: di + 1, dayCount: plan.built.length,
        stop: at + 1, stops: visits.length,
        from: ev.from, to: endAt, stay: full, planned: a.stay,
        brk: ev.break
          ? { at: ev.break.at, min: ev.break.min, name: ev.break.place ? ev.break.place.name : '' }
          : null,
        evening: !!ev.evening, district: d.district
      },
      prev: neighborTravel(tl.ev, evIdx, -1) ||
            { name: (d.startAt != null ? '当日出发地 · ' : '出发地 · ') + plan.city.base.name,
              min: Engine.driveMin(plan.city.base, a) },
      next: neighborTravel(tl.ev, evIdx, 1)
    });
    if (!g) return;

    var panel = el('guidePanel'), box = el('guide');
    if (!panel || !box) return;
    panel.innerHTML = guideHtml(g);
    box.className = 'guide on';
    panel.scrollTop = 0;
    if (document.body && document.body.className.indexOf('guide-open') < 0) {
      document.body.className += ' guide-open';
    }
    var close = el('guideClose');
    if (close) close.onclick = closeGuide;
  }

  function closeGuide() {
    var box = el('guide');
    if (box) box.className = 'guide';
    if (document.body) {
      document.body.className = document.body.className.replace(/\s*guide-open/g, '');
    }
  }

  /* 攻略卡版式：一图 + 三个信息层。
   *   第一层「一眼看完」—— 品类题图、景点名、关键是四个数（门票 / 时长 / 开放 / 等级）
   *   第二层「常读三段」—— 这是什么地方、核心看点、本次行程中的安排
   *   第三层「要用再展开」—— 怎么过去 / 顺路与用餐 / 出行提示，折起来不占视线
   * 八段的标题一个都没少，只是把「一开始不需要读的」收进了折叠里。
   * 全部内容仍由数据包字段与坐标现算，且不读时间、不用随机数（test/guide-panel.js 有断言）。
   */
  function guideHtml(g) {
    var cv = catOf({ cat: g.cat });
    var ph = photoOf({ id: g.id });

    /* 有实景照片用它当题图，没有则用品类插画。两者占同一个位置，
       所以「有没有照片」不改变版式，只改变那张图是什么。 */
    var h = '<div class="ghero">' + (ph
        ? '<img class="gphoto" src="' + esc(ph.file) + '" alt="' + esc(g.name) + '">'
        : cv.art) +
      (ph ? '<span class="gcred">' + esc(photoCredit(ph)) + '</span>' : '') +
      (cv.label ? '<span class="gcat" style="color:' + cv.tint + ';background:' + cv.wash +
        ';border-color:' + cv.line + '">' + esc(cv.label) + '</span>' : '') +
      '<button class="gclose" id="guideClose" title="关闭">×</button>' +
      '<div class="gband">' +
        '<span class="gname">' + esc(g.name) + '</span>' +
        (g.level ? '<span class="gtag lv">' + esc(g.level) + '</span>' : '') +
        '<span class="gtag">' + esc(g.slotText) + '</span>' +
        g.tags.map(function (t) { return '<span class="gtag tg">' + esc(t) + '</span>'; }).join('') +
      '</div>' +
    '</div>';

    h += '<div class="gsub">' + esc(g.districtLabel) + '</div>';

    /* 关键信息提到最前：一张卡最先想知道的就是门票、要逛多久、几点开门 */
    h += '<div class="gsec"><h4>关键信息</h4><div class="gfacts">' +
      g.facts.map(function (f) {
        return '<div><div class="k">' + esc(f[0]) + '</div><div class="v">' + esc(f[1]) + '</div></div>';
      }).join('') + '</div></div>';

    h += '<div class="gsec"><h4>这是什么地方</h4><p>' + esc(g.bg) + '</p></div>';

    if (g.points.length) {
      h += '<div class="gsec"><h4>核心看点（' + g.points.length + ' 处）</h4><ul class="gcols">' +
        g.points.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul></div>';
    }

    /* 本次行程安排：与用户在时间轴上看到的一字不差，避免「攻略说 3 小时、行程只给 2 小时」 */
    if (g.visit) {
      var v = g.visit;
      var backHome = g.next && g.next.name === g.fromBase.name;
      h += '<div class="gsec"><h4>本次行程中的安排</h4><div class="gvisit">' +
        '<b>Day ' + v.day + '</b>' + (v.dayCount > 1 ? '（共 ' + v.dayCount + ' 天）' : '') +
        (v.stops > 1 ? ' · 当天第 ' + v.stop + ' / ' + v.stops + ' 站' : '') +
        '<br>到访 ' + hm(v.from) + ' → 离开 ' + hm(v.to) +
        '，实际停留 <b>' + v.stay + ' 分钟</b>' +
        (v.stay === v.planned ? '（与数据包建议一致）'
          : '<span class="warn">（数据包建议 ' + v.planned + ' 分钟，这里被压缩了 ' +
            (v.planned - v.stay) + ' 分钟）</span>') +
        /* 被午餐切开的这一次：说明它是「一次游览 + 中间一顿饭」，不是来了两趟 */
        (v.brk ? '<br>中途 ' + hm(v.brk.at) + '–' + hm(v.brk.at + v.brk.min) + ' 用餐 ' +
          v.brk.min + ' 分钟' + (v.brk.name ? '（就近推荐：' + esc(v.brk.name) + '）' : '') +
          '，游览在用餐前后各进行一段，合起来仍是这一次' : '') +
        '<br>' + (g.prev && g.prev.name === g.fromBase.name
          ? '从驻点直接出发（车程 ' + g.prev.min + ' 分钟）'
          : '前一站：' + (g.prev ? esc(g.prev.name) + '（车程 ' + g.prev.min + ' 分钟）' : '—')) +
        '　·　' + (!g.next ? '这是当天的最后一站'
          : backHome ? '之后返程回驻点（' + g.next.min + ' 分钟）'
          : '下一站：' + esc(g.next.name) + '（车程 ' + g.next.min + ' 分钟）') +
        '</div></div>';
    }

    /* ---- 以下三段收进折叠：要用的时候才展开，不占一开始的视线 ---- */
    var fold = '';

    fold += '<div class="gsec"><h4>怎么过去</h4><div class="groute">' +
      '从驻点「' + esc(g.fromBase.name) + '」出发：' + g.fromBase.km + ' 公里 · 约 <b>' +
      g.fromBase.min + ' 分钟</b>车程' +
      /* 当天第一站的前一站就是驻点本身，这时只留上面那句，不再重复一遍 */
      (g.prev && g.prev.name !== g.fromBase.name
        ? '<br>接在「' + esc(g.prev.name) + '」之后：' + g.prev.min + ' 分钟' +
          (g.prev.min <= 5 ? '（几乎相邻，可步行衔接）' : '')
        : '') +
      (g.next ? (g.next.name === g.fromBase.name
        ? '<br>之后返程回驻点：' + g.next.min + ' 分钟'
        : '<br>顺路去「' + esc(g.next.name) + '」：' + g.next.min + ' 分钟') : '') +
      '</div></div>';

    if (g.nearby.length) {
      fold += '<div class="gsec"><h4>同片区可串起来一起去</h4><div class="glist">' +
        g.nearby.map(function (n) {
          return '<div class="gitem' + (n.inPlan ? ' inplan' : '') + '">' +
            '<div class="n">' + esc(n.name) + (n.level ? ' <span class="tag lv">' + esc(n.level) + '</span>' : '') + '</div>' +
            '<div class="d">车程 ' + n.min + ' 分钟 · ' + esc(n.district) +
              (n.same ? ' <span class="same">同片区</span>' : '') +
              (n.inPlan ? ' · 已在本次行程中' : '') +
              (n.tags.length ? '<br>' + n.tags.map(esc).join(' · ') : '') +
            '</div></div>';
        }).join('') + '</div></div>';
    }

    if (g.eats.length) {
      fold += '<div class="gsec"><h4>就近用餐</h4><div class="glist">' +
        g.eats.map(function (e) {
          return '<div class="gitem"><div class="n">' + esc(e.name) + '</div>' +
            '<div class="d">车程 ' + e.min + ' 分钟 · ' + esc(e.district) +
            (e.same ? ' <span class="same">同片区</span>' : '') +
            (e.note ? '<br>' + esc(e.note) : '') + '</div></div>';
        }).join('') + '</div></div>';
    }

    if (fold) {
      h += '<details class="gfold"><summary>怎么过去 · 顺路与用餐</summary>' + fold + '</details>';
    }

    if (g.tips.length) {
      /* 只要提示里出现闭馆 / 停止入园 / 需预约，就在折叠标题上先亮一下，
         否则用户永远不会展开它，也就永远看不到「周一闭馆」这件事。 */
      var urgent = g.tips.some(function (t) { return /闭馆|停止入园|预约/.test(t); });
      h += '<details class="gfold"><summary>出行提示（' + g.tips.length + ' 条）' +
        (urgent ? '<span class="tag m">有需要留意的</span>' : '') +
        '</summary><ul class="gtips">' +
        g.tips.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul></details>';
    }

    /* 题图的来源决定这句话怎么写 —— 用的是实景照片就不能再说「不是实景照片」，
       否则卡片自己跟自己矛盾，也从"没图"变成了误导。 */
    h += '<div class="gfoot">' +
      (ph
        ? '题图是「' + esc(g.name) + '」的实景照片（' + esc(ph.license || '') +
          (ph.author ? ' · 摄影 ' + esc(ph.author) : '') +
          '），素材出处逐条登记在页脚的「数据来源与作品说明」里。'
        : '题图为自绘示意插画，不是实景照片。') +
      '以上内容由数据包的字段与坐标现算得出：' +
      '背景与看点来自景区资料，' +
      '车程由 GCJ-02 坐标按路网系数 1.35 与分段时速推算，同片区推荐与就近用餐按车程排序。' +
      '门票、开放时间为公开整理的参考值，实际以景区当日公示为准。</div>';
    return h;
  }

  /* ---------- 逐日翻页条 ----------
   * 页码用「第 N / 共 M 天」+ 上一天/下一天 + 可点的日期圆点。
   * 只有一天时不渲染这一条，避免出现「1 / 1」这种无意义的分页。
   * 「下一天」是主操作（用户要求：看完第一天再点它才翻到第二天），
   * 圆点只是方便长行程直接跳到某一天。
   */
  function renderDayNav(plan) {
    var host = el('dayNav');
    host.innerHTML = '';
    var n = plan.built.length;
    if (n <= 1) return;

    var atFirst = dayIdx === 0, atLast = dayIdx === n - 1;
    var html = '<div class="navrow">' +
      '<button class="ghost" id="prevDay"' + (atFirst ? ' disabled' : '') + '>上一天</button>' +
      '<span class="navpos">第 <b>' + (dayIdx + 1) + '</b> / ' + n + ' 天</span>' +
      '<button class="btn sm" id="nextDay"' + (atLast ? ' disabled' : '') + '>' +
        (atLast ? '已是最后一天' : '下一天') + '</button>' +
      '</div>';
    html += '<div class="navdots">';
    for (var i = 0; i < n; i++) {
      html += '<span class="dot' + (i === dayIdx ? ' on' : '') + '" id="dayGo-' + i + '">' + (i + 1) + '</span>';
    }
    html += '</div>';
    html += '<div class="hint">' + (atLast
      ? '这是行程的最后一天。可点上方圆点回看任意一天，或点「重新规划」改条件。'
      : '看完这一天，点「下一天」继续；也可点上方圆点直接跳到某一天。') + '</div>';

    var box = document.createElement('div');
    box.className = 'card daynav';
    box.innerHTML = html;
    host.appendChild(box);
    /* 说明：分页条放在 #dayNav 里，与日卡片的容器 #days 分开，便于样式隔离与测试 */

    el('prevDay').onclick = function () { goDay(dayIdx - 1); };
    el('nextDay').onclick = function () { goDay(dayIdx + 1); };
    for (var j = 0; j < n; j++) {
      (function (k) {
        el('dayGo-' + k).onclick = function () { goDay(k); };
      })(j);
    }
  }

  /* 翻到第 i 天。越界时不做任何事——这样按钮即使在禁用态被程序触发，行为也与浏览器一致。 */
  function goDay(i) {
    var total = lastDayCount;
    if (total <= 1) return;
    var k = Math.max(0, Math.min(total - 1, i));
    if (k === dayIdx) return;
    dayIdx = k;
    mapDay = k;              // 时间轴切到哪天，地图就高亮哪天
    renderResult();
    scrollToDays();
  }

  function scrollToDays() {
    var n = el('days');
    if (n && typeof n.scrollIntoView === 'function') n.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  /* ---------- 行程示意地图 ----------
   * 地图是「同一份行程的第二个视角」，不是另一套算法：输入 runOnce() 的
   * 结果，输出一张内联 SVG。它不读时间、不读随机、不请求任何资源，
   * 因此断网 / file:// / 单文件版三种情况下表现一致。
   */
  var mapDay = null;      /* 地图高亮哪一天；null = 全部 */
  var mapState = null;    /* { plan, base } —— 窗口 resize 时要按新宽度重绘 */

  function closestBy(node, cls) {
    while (node && node.nodeType) {
      if (node.nodeType === 1 && node.classList && node.classList.contains(cls)) return node;
      node = node.parentNode;
    }
    return null;
  }

  /* ---------- 地图连线：这一段多远、各方式各要多久 ----------
     细到 1.8px 的弧线用鼠标根本点不中，所以 SVG 里另铺了一条透明的粗路径
     （.mv-leg-hit）专门接事件。悬停即出卡；点一下固定（手机没有悬停，只能点），
     再点一次或点别处收起；键盘 Tab 到连线上同样出卡，回车固定。
     卡片的数值全部来自 Engine.legModes，与行程表里的车程同源。 */
  var tipPinned = -1;

  function fmtKm(km) {
    if (km == null) return '—';
    return (km < 10 ? km.toFixed(1) : String(Math.round(km))) + ' km';
  }

  function legCardHtml(l) {
    var rows = (l.items || []).map(function (it) {
      var best = (it.k === l.best);
      return '<li' + (best ? ' class="best"' : '') + '>' +
        '<span class="mn">' + esc(it.name) + '</span>' +
        '<span class="t">' + it.min + ' 分</span>' +
        (best ? '<em>最省时</em>' : '') +
        '<span class="nt">' + esc(it.note || '') + '</span></li>';
    }).join('');
    /* 三种段说三种话：出发段、站到站、末站回驻点。
       回程那一段最容易读错成「又去了一站」，所以标题里直接写「返回」。 */
    var head = l.toBase
      ? 'Day ' + (l.day + 1) + ' · 第 ' + l.order + ' 站回驻点'
      : l.fromBase
        ? 'Day ' + (l.day + 1) + ' · 从驻点出发'
        : 'Day ' + (l.day + 1) + ' · 第 ' + l.order + ' → ' + (l.order + 1) + ' 站';
    return '<div class="mvtip-h">' + esc(head) + '</div>' +
      '<div class="mvtip-p">' + esc(l.fromName) + ' → ' + esc(l.toName) + '</div>' +
      '<div class="mvtip-d">直线 <b>' + fmtKm(l.km) + '</b> · 路网约 ' + fmtKm(l.roadKm) + '</div>' +
      '<ul class="mvtip-l">' + rows + '</ul>' +
      '<div class="mvtip-f">门到门估算，含候车与找车位；未含实时路况与班次</div>';
  }

  function bindLegs(wrap, legs) {
    tipPinned = -1;                       /* 重绘后旧的下标可能已不存在 */
    if (!legs.length) return;

    var tip = document.createElement('div');
    tip.className = 'mvtip';
    tip.hidden = true;
    wrap.appendChild(tip);

    var svg = wrap.querySelector('svg');
    var cur = -1, pinAt = [0, 0];

    function rel(e) {
      var b = wrap.getBoundingClientRect();
      return [e.clientX - b.left, e.clientY - b.top];
    }

    function hot(i) {
      var arr = wrap.querySelectorAll('.mv-leg');
      for (var k = 0; k < arr.length; k++) {
        arr[k].classList.toggle('is-hot', +arr[k].getAttribute('data-leg') === i);
      }
      wrap.classList.toggle('is-linking', i >= 0);
    }

    var place = function (x, y) {
      var w = tip.offsetWidth, h = tip.offsetHeight;
      var left = x + 14, top = y + 14;
      if (left + w > wrap.clientWidth - 8) left = x - w - 14;
      if (top + h > wrap.clientHeight - 8) top = y - h - 14;
      tip.style.left = Math.max(8, Math.min(left, wrap.clientWidth - w - 8)) + 'px';
      tip.style.top = Math.max(8, Math.min(top, wrap.clientHeight - h - 8)) + 'px';
    };

    var show = function (i, x, y) {
      var l = legs[i];
      if (!l) return;
      cur = i;
      tip.innerHTML = legCardHtml(l);
      tip.hidden = false;
      hot(i);
      place(x, y);
    };

    var hide = function () {
      cur = -1;
      tip.hidden = true;
      hot(-1);
    };

    var unpin = function () {
      tipPinned = -1;
      hide();
    };

    /* 固定时鼠标移开，卡片要留在原处；再悬停别的线则临时预览，移开后回到固定的那张 */
    var restorePin = function () {
      if (tipPinned >= 0) show(tipPinned, pinAt[0], pinAt[1]);
      else hide();
    };

    wrap.addEventListener('pointerover', function (e) {
      var hit = closestBy(e.target, 'mv-leg-hit');
      if (!hit) return;
      var p = rel(e);
      show(+hit.getAttribute('data-leg'), p[0], p[1]);
    });

    wrap.addEventListener('pointermove', function (e) {
      if (cur < 0 || cur === tipPinned) return;
      if (!closestBy(e.target, 'mv-leg-hit')) return;
      var p = rel(e);
      place(p[0], p[1]);
    });

    wrap.addEventListener('pointerout', function (e) {
      if (!closestBy(e.target, 'mv-leg-hit')) return;
      restorePin();
    });

    wrap.addEventListener('click', function (e) {
      var hit = closestBy(e.target, 'mv-leg-hit');
      if (!hit) { if (tipPinned >= 0) unpin(); return; }
      var i = +hit.getAttribute('data-leg');
      if (tipPinned === i) { unpin(); return; }
      var p = rel(e);
      tipPinned = i; pinAt = p;
      show(i, p[0], p[1]);
    });

    /* 键盘：Tab 到连线上就出卡（锚在这条线的中点），回车固定，Esc 收起 */
    function midOf(i) {
      var l = legs[i];
      var sx = (svg && svg.viewBox.baseVal.width) ? svg.clientWidth / svg.viewBox.baseVal.width : 1;
      return l ? [(l.x1 + l.x2) / 2 * sx, (l.y1 + l.y2) / 2 * sx] : [0, 0];
    }

    wrap.addEventListener('focusin', function (e) {
      var hit = closestBy(e.target, 'mv-leg-hit');
      if (!hit) return;
      var i = +hit.getAttribute('data-leg'), m = midOf(i);
      if (tipPinned < 0) show(i, m[0], m[1]);
    });

    wrap.addEventListener('keydown', function (e) {
      var hit = closestBy(e.target, 'mv-leg-hit');
      if (!hit) return;
      var i = +hit.getAttribute('data-leg'), m;
      if (e.key === 'Escape') { unpin(); return; }
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      e.preventDefault();
      if (tipPinned === i) { unpin(); return; }
      m = midOf(i);
      tipPinned = i; pinAt = m;
      show(i, m[0], m[1]);
    });
  }

  function paintMap(plan, base) {
    var host = el('mapBox');
    if (!host) return;

    if (!plan || !plan.built || !plan.built.length || !window.MapView || !window.BASE_MAP) {
      host.innerHTML = '';
      mapState = null;
      return;
    }
    mapState = { plan: plan, base: base };

    host.innerHTML =
      '<div class="card">' +
        '<h2>行程走向</h2>' +
        '<div class="mvsub">按天分色，<b>定位指针是出发位置</b>，节点上的数字是<b>当天第几站</b>。' +
          '每天从指针出发、末站再<b>虚线回指针</b>，一头一尾两道虚线就是当天的往返。' +
          '底图只画黄河、贺兰山与湖泊湿地，' +
          '不画道路网 —— 这张图要回答的是「几天分别往哪个方向跑、彼此相距多远」，' +
          '而不是「在哪个路口转弯」。点节点看该景点的攻略。</div>' +
        '<div class="mvwrap" id="mvwrap"></div>' +
        '<div class="mvlegend" id="mvlegend"></div>' +
        '<div class="mvhint">点图例可单独看某一天，再点一次回到全部。' +
          '<b>把鼠标放到连线上（手机上点一下）</b>，可看这一段多远、自驾 / 公交 / 骑行 / 步行各要多久。' +
          '地图为示意图：地物为手绘近似，连线是直连弧线、不沿真实路网，不可用于导航。</div>' +
      '</div>';

    /* 先落骨架再量宽：读一个还不存在的容器只会拿到 0。
       高度交给 MapView 按行程的自然比例算 —— 它知道地理跨度，这里不知道。 */
    var wrap = el('mvwrap');
    var w = Math.max(280, wrap.clientWidth || 820);

    var m = MapView.render({
      basemap: window.BASE_MAP,
      built: plan.built,
      city: plan.city,
      base: base,
      width: Math.round(w),
      activeDay: mapDay,
      /* 出发位置怎么称呼取决于流程：「做计划」时是行程起点，「已在路上」时就是当前位置。
         语义由界面给，地图只管把这两个字画在方框旁边。 */
      baseLabel: FLOW === 'now' ? '当前位置' : '行程起点',
      /* 数值一律走引擎：图上写的车程必须与行程表里那行同源，否则两处会打架 */
      legInfo: Engine.legModes
    });

    wrap.innerHTML = m.svg;
    el('mvlegend').innerHTML = m.legend;

    bindLegs(wrap, m.legs || []);

    /* 图例：切高亮。再点同一档回到「全部」，这样任何时刻都能退回全景。
       单看某天时，下方的时间轴要一起翻到那天 —— 地图和日卡片是同一份行程的
       两个视角，一个停在第 2 天、一个还写着 Day 1，读者只会以为图算错了。
       只重画日卡片，不整页重绘：地图卡片本身不重建，刚点的图例不会闪。 */
    el('mvlegend').onclick = function (e) {
      var btn = closestBy(e.target, 'mv-lg');
      if (!btn) return;
      var d = +btn.getAttribute('data-day');
      mapDay = (mapDay === d) ? null : d;
      if (mapDay != null && plan.built && plan.r && dayIdx !== mapDay) {
        dayIdx = mapDay;
        renderDays(el('days'), plan, plan.r.W);
      }
      paintMap(plan, base);
    };

    /* 节点：开攻略卡。地图只认「当天第几站」，攻略卡要的是 tl.ev 的下标，
       两者不是一回事（午餐切开的一次游览在 tl.ev 里占两条），所以按 id 反查。 */
    wrap.onclick = function (e) {
      var g = closestBy(e.target, 'mv-stop');
      if (!g) return;
      var di = +g.getAttribute('data-day'), id = g.getAttribute('data-spot');
      var b = plan.built[di];
      if (!b) return;
      var at = -1;
      b.tl.ev.forEach(function (x, k) {
        if (at < 0 && x.k === 'visit' && !x.cont && x.a && x.a.id === id) at = k;
      });
      if (at >= 0) openSpotGuide(plan, di, at);
    };
  }

  /* ---------- 结果：出行计划 ---------- */
  function renderPlanResult() {
    var city = Engine.buildCity(packs());
    var base = currentBase(city);
    var plan = runOnce(city, base);
    var r = plan.r, sum = plan.sum;

    el('result').style.display = 'block';
    el('resultTitle').textContent = '行程概览';
    el('nowInfo').innerHTML = '';
    el('nowInfo').style.display = 'none';
    el('cand').innerHTML = '';
    el('alsoTom').innerHTML = '';

    el('cond').innerHTML = condHtml([
      ['天数', S.days + ' 天'],
      ['取向', ROLE_LABEL[S.role] || ROLE_LABEL.first],
      ['偏好', S.prefs.join('、')],
      ['节奏', PACE_LABEL[S.pace]],
      ['范围', SCOPE[S.scope].label],
      ['驻点', base ? base.name : '—']
    ]);

    /* 驻点信息 + 与数据包默认驻点的车程对比 */
    var packBase = city.base;
    var sameAsPack = base && Math.abs(base.lng - packBase.lng) < 1e-6 && Math.abs(base.lat - packBase.lat) < 1e-6;
    var diff = '';
    if (r.notice) {
      /* 行程没排满时车程自然更少，直接对比会得出「住远了更省」的错误结论 */
      diff = '　<span class="delta">行程未排满 ' + r.notice.emptyDays + ' 天，车程不可与完整行程直接比较</span>';
    } else if (base && !sameAsPack) {
      var ref = runOnce(city, null);
      var dv = Math.round(sum.travel - ref.sum.travel);
      diff = '　相比默认驻点「' + esc(packBase.name) + '」，全程车程 ' +
        '<span class="delta' + (dv <= 0 ? ' down' : '') + '">' +
        (dv > 0 ? '+' : dv < 0 ? '−' : '±') + Math.abs(dv) + ' 分钟</span>';
    }
    el('baseInfo').innerHTML = base
      ? '<b>行程驻点：' + esc(base.name) + '</b>（' + esc(base.district || '—') + '）' + diff
      : '';

    /* 驻点过远：不输出空白行程，改为说明原因并给出就近候选 */
    if (r.notice && r.notice.kind === 'too-far') {
      el('notice').innerHTML =
        '<div class="card notice">' +
          '<h2>当前位置距景区过远，未生成行程</h2>' +
          '<p>驻点「' + esc(r.notice.originName) + '」（' + esc(r.notice.originDistrict) + '）到最近的景点仍需 <b>' +
            r.notice.nearest + ' 分钟</b>车程，超过本节奏档位下「单点最远车程」上限 ' + r.notice.limit + ' 分钟。</p>' +
          '<p>这通常意味着当前位置已超出该数据包的服务范围 —— 例如数据包是银川市域，而人已到中卫。</p>' +
          '<p><b>驻点附近还没去的点位：</b></p><ul>' +
            r.notice.candidates.map(function (c) {
              return '<li>' + esc(c.a.name) + '（' + esc(c.a.district) + '）· 车程约 ' + c.min + ' 分钟</li>';
            }).join('') +
          '</ul>' +
          '<p>建议：点「重新规划」，把范围改为「含银川周边」，或改选银川市域内的住宿位置。</p>' +
        '</div>';
      el('summary').innerHTML = '';
      el('check').innerHTML = '';
      el('algo').innerHTML = '';
      el('days').innerHTML = '';
      return;
    }
    /* 部分天数排不出：保留已排好的行程，只在上面加一条说明 */
    el('notice').innerHTML = r.notice && r.notice.kind === 'partial'
      ? '<div class="card notice"><h2>有 ' + r.notice.emptyDays + ' 天未能安排</h2>' +
        '<p>驻点「' + esc(r.notice.originName) + '」到剩余可选景点的最近车程为 <b>' + r.notice.nearest +
        ' 分钟</b>，已超过上限 ' + r.notice.limit + ' 分钟，继续排下去只会变成整天赶路，因此留空。</p>' +
        '<p><b>驻点附近还没去的点位：</b>' +
        r.notice.candidates.map(function (c) { return esc(c.a.name) + '（' + c.min + ' 分钟）'; }).join('、') + '</p>' +
        '<p>建议：改选更靠近景区的住宿位置，或减少行程天数。</p></div>'
      : '';

    var seen = {};
    plan.built.forEach(function (b) { if (b.d.district) seen[b.d.district] = true; });
    var districtList = Object.keys(city.districts).filter(function (d) { return seen[d]; });

    el('summary').innerHTML = metricHtml([
      ['行程天数', S.days, ' 天'],
      ['安排点位', sum.spots, ' 个'],
      ['人均门票', '¥' + sum.tickets, ''],
      ['累计车程', (Math.round(sum.travel / 6) / 10).toFixed(1), ' 小时']
    ]) + catBarHtml(catCounts(plan));

    el('check').innerHTML = criteriaHtml(
      ['按天数和偏好推荐线路', '讲解景点背景与看点', '安排交通、用餐和停留时间']
    ) + '<span class="wide">覆盖区县 ' + districtList.length + '/' + Object.keys(city.districts).length +
      '：' + (districtList.map(function (d) { return d.replace(/[区市县]$/, ''); }).join('、') || '—') + '</span>';

    /* 算法参数：阈值是「当日可用时长的占比」，因此换个城市、换个尺度都成立 */
    el('algo').innerHTML =
      '<b>本次排程参数</b>（均由节奏档位推导，不含城市专属常数）：' +
      '每日可用 ' + hm(r.W.s) + '–' + hm(r.W.e) + '（' + r.cap.budget + ' 分钟）· ' +
      '单点最远车程 ' + r.cap.MAX_FIRST + ' 分钟 · ' +
      '同日内段间上限 ' + r.cap.MAX_HOP + ' 分钟 · ' +
      '溢出到邻区上限 ' + r.cap.SPILL_MAX + ' 分钟。' +
      '车程 = 球面距离 × 路网系数 ' + Engine.ROAD_FACTOR + ' ÷ 分段时速；' +
      '行程会先校验景区开放时间（含周一闭馆、停止入园时间）；夜游必须 ' + hm(Engine.NIGHT_CAP) + ' 前结束。';

    renderDays(el('days'), plan, r.W);

    /* 驻点：用户没选时 runOnce 已回退到数据包默认驻点，地图照它画 */
    paintMap(plan, base || plan.city.base);
  }

  /* ---------- 结果：已在路上 ---------- */
  function renderNowResult() {
    var city = Engine.buildCity(packs());
    var base = currentBase(city);
    var plan = runOnce(city, base, {
      days: nowDays, startAt: S.startAt, dayOfWeek: NOW.dow, visitedIds: S.visited
    });
    var r = plan.r, sum = plan.sum;

    var cand = Engine.dayCandidates(city, {
      prefs: S.prefs, pace: S.pace, startAt: S.startAt,
      dayOfWeek: NOW.dow, base: base, visitedIds: S.visited
    });

    el('result').style.display = 'block';
    el('resultTitle').textContent = nowDays === 1 ? '今天剩下的时间怎么安排' : '今天与明天怎么安排';
    el('baseInfo').innerHTML = '<b>当前位置：' + esc(base ? base.name : '—') + '</b>（' +
      esc(base ? (base.district || '—') : '—') + '）　现在是 ' + hm(S.startAt) + '（周' + WEEK_CN.charAt(NOW.dow) +
      '），玩到 ' + hm(r.W.e) + '。';

    el('cond').innerHTML = condHtml([
      ['位置', base ? base.name : '—'],
      ['现在', hm(S.startAt)],
      ['已去过', S.visited.length + ' 处'],
      ['兴趣', S.prefs.length === PREF_ALL.length ? '不限' : S.prefs.join('、')],
      ['玩到', hm(r.W.e)]
    ]);

    /* 时间窗不足：把原因讲清楚，并给出可调的两个旋钮 */
    var noticeHtml = '';
    if (r.notice && r.notice.kind === 'too-early') {
      noticeHtml = '<div class="card notice">' +
        '<h2>这个时刻景点还没开门</h2>' +
        '<p>按「现在 ' + hm(r.notice.startAt) + '」出发，车程内的景点都尚未开始接待——' +
        '银川多数景区 08:30–09:00 开门，现在过去只能在门外等。</p>' +
        '<p><b>建议：</b>把「现在几点」改到 <b>08:30 之后</b>（界面里选 10:00 或之后最稳妥），' +
        '行程会自动排上。若想直接就着现在的时间出门，可把范围改小一些、改选更近的住宿位置。</p></div>';
    } else if (r.notice && r.notice.kind === 'too-late') {
      noticeHtml = '<div class="card notice">' +
        '<h2>这个时刻已排不出行程</h2>' +
        '<p>按「现在 ' + hm(r.notice.startAt) + '」起算，剩余时间里没有任何一个还没去过的景点能在收工前走完：' +
        '要么已闭园、要么已过停止入园时间、要么剩余时间不足最短游览。</p>' +
        '<p><b>两个可调的地方：</b>把「今天打算玩到几点」往后调一档（例如选「到 23:00」把夜市算进来），' +
        '或把「现在几点」改成更早的时刻看看。</p></div>';
    } else if (r.notice && r.notice.kind === 'too-far') {
      noticeHtml = '<div class="card notice"><h2>当前位置距景区过远</h2>' +
        '<p>「' + esc(r.notice.originName) + '」到最近的景点仍需 <b>' + r.notice.nearest +
        ' 分钟</b>车程，超过当下可达上限 ' + r.notice.limit + ' 分钟。请改用更靠近景区的住宿位置，或改用「出发前做计划」。</p></div>';
    } else if (r.notice && r.notice.kind === 'none-left') {
      noticeHtml = '<div class="card notice"><h2>已经没有可选点位了</h2>' +
        '<p>当前范围内的景点大多已被排除（今天去过、或已排入行程）。可点「重新规划」放宽条件。</p></div>';
    } else if (r.notice && r.notice.kind === 'partial') {
      noticeHtml = '<div class="card notice"><h2>有 ' + r.notice.emptyDays + ' 天未能安排</h2>' +
        '<p>剩余候选点位距离当前位置过远或时间不够，继续排只会变成整天赶路，因此留空。</p></div>';
    }
    el('notice').innerHTML = noticeHtml;

    el('nowInfo').style.display = 'block';
    el('nowInfo').innerHTML = '候选 ' + cand.items.length + ' 处中，<b>' + cand.ok.length +
      ' 处现在还进得去</b>，' + cand.blocked.length + ' 处已无法安排' +
      (cand.visited.length ? '，另有 ' + cand.visited.length + ' 处今天已经去过' : '') + '。';

    el('summary').innerHTML = metricHtml([
      ['剩余可用', (Math.round((r.W.e - S.startAt) / 6) / 10).toFixed(1), ' 小时'],
      ['安排点位', sum.spots, ' 个'],
      ['人均门票', '¥' + sum.tickets, ''],
      ['累计车程', (Math.round(sum.travel / 6) / 10).toFixed(1), ' 小时']
    ]);

    el('check').innerHTML = criteriaHtml(
      ['从当前时刻起算剩余行程', '校验开放时间与停止入园时间', '排除今天已去过的点位']
    ) + '<span class="wide">还能去 ' + cand.ok.length + ' 处；按「偏好匹配 → 车程由近及远」排序，' +
      '点「重新规划」可改现在几点、玩到几点或已去过的点位。</span>';

    el('algo').innerHTML =
      '<b>本次动态重排参数：</b>当前 ' + hm(S.startAt) + ' · 收工 ' + hm(r.W.e) +
      '（剩余 ' + r.cap.budget + ' 分钟）· 单点最远车程 ' + r.cap.MAX_FIRST + ' 分钟 · ' +
      '同日内段间上限 ' + r.cap.MAX_HOP + ' 分钟。' +
      '每个候选点都要过「现在赶到还进得去吗」：开园前到达需等 ≤ ' + Engine.MAX_WAIT + ' 分钟；' +
      '过了停止入园时间或闭园前不足 ' + Engine.MIN_VISIT + ' 分钟（且低于建议停留的 ' +
      Math.round(Engine.MIN_SHARE * 100) + '%）都不排。';

    renderDays(el('days'), plan, r.W);
    paintMap(plan, base || plan.city.base);

    /* 「顺带把明天也排上」：把今天剩余与明天整天连起来看 */
    el('alsoTom').innerHTML = nowDays === 1
      ? '<button class="ghost" id="addTom">顺带把明天也排上</button>'
      : '<button class="ghost" id="addTom">去掉明天，只看今天</button>';
    el('addTom').onclick = function () {
      nowDays = nowDays === 1 ? 2 : 1;
      renderNowResult();
    };

    renderCand(cand, plan);
  }

  /* ---------- 「还能去哪 / 为什么去不了」 ---------- */
  function renderCand(c, plan) {
    var host = el('cand');
    host.innerHTML = '';

    var planned = {};
    plan.built.forEach(function (b) {
      b.d.items.forEach(function (it) { planned[it.a.id] = true; });
      if (b.d.night) planned[b.d.night.id] = true;
    });

    var box = document.createElement('div');
    box.className = 'card cand';
    var html = '<h2>现在还能去哪（' + c.ok.length + ' 处）</h2>';

    if (c.ok.length) {
      var show = c.ok.slice(0, 20);
      html += '<div class="candgrid">' + show.map(function (x) {
        return '<div class="citem' + (planned[x.a.id] ? ' inplan' : '') + '">' +
          '<div class="cn">' + esc(x.a.name) +
            (planned[x.a.id] ? ' <span class="tag z">已排入行程</span>' : '') +
            (x.reserve ? ' <span class="tag m">需预约</span>' : '') +
            (x.trimmed ? ' <span class="tag m">压缩至 ' + x.stay + ' 分</span>' : '') + '</div>' +
          '<div class="cd">' + esc(x.a.district) + ' · 车程 ' + x.drive + ' 分 · 约 ' + hm(x.arriveAt) +
            ' 到 · 可玩 ' + x.stay + ' 分' +
            (x.wait ? ' · 需等 ' + x.wait + ' 分开门' : '') +
            ' · 开放 ' + esc(x.a.open) + '</div>' +
        '</div>';
      }).join('') + '</div>';
      if (c.ok.length > show.length) {
        html += '<div class="note-line">另有 ' + (c.ok.length - show.length) + ' 处同样可去，未逐一列出。</div>';
      }
    } else {
      var allEarly = c.blocked.length > 0 && c.blocked.every(function (x) {
        return x.reason === 'beforeOpen' || x.reason === 'far';
      });
      html += '<p class="empty">' + (allEarly
        ? '这个时刻景点都还没开门——现在赶过去只能在门外等。把「现在几点」改到开门之后（多数景区 08:30–09:00 开门）即可自动排上。'
        : '按当前的时刻与收工时间，已经没有能走完的点位了。把「玩到几点」往后调一档，或把「现在几点」改成更早的时刻看看。') + '</p>';
    }

    if (c.blocked.length) {
      html += '<div class="blocked"><h3>这些暂时去不了（' + c.blocked.length + ' 处）</h3><ul>' +
        c.blocked.map(function (x) {
          return '<li><b>' + esc(x.a.name) + '</b><span class="why">' + esc(WHY_LABEL[x.reason] || x.reason) +
            '</span><span class="det">' + esc(x.detail) + '</span></li>';
        }).join('') + '</ul></div>';
    }

    if (c.visited.length) {
      html += '<div class="note-line">已排除今天去过的 ' + c.visited.length + ' 处：' +
        c.visited.map(function (x) { return esc(x.a.name); }).join('、') + '</div>';
    }

    box.innerHTML = html;
    host.appendChild(box);
  }

  /* ---------- 结果分发 ---------- */
  function renderResult() {
    if (FLOW === 'now') renderNowResult();
    else renderPlanResult();
  }

  /* ---------- 事件绑定 ---------- */
  el('back').onclick = function () { if (cur > 0) goTo(cur - 1); };
  el('geo').onclick = useGeo;
  el('manual').onclick = function () {
    var box = el('coordBox');
    box.style.display = box.style.display === 'flex' ? 'none' : 'flex';
  };
  el('applyCoord').onclick = applyCoord;
  el('useDefault').onclick = useDefault;
  el('restart').onclick = function () { restoreWizard(); goTo(0); };
  el('modePlan').onclick = function () { setFlow('plan'); };
  el('modeNow').onclick = function () { setFlow('now'); };

  /* 窗口尺寸变了要按新宽度重算视框，不能靠 CSS 把 SVG 拉宽：
     拉伸会把圆形节点压成椭圆、把文字拉变形，而且 stroke 宽度会不一致。
     防抖 180ms，避免拖动窗口时反复重排。 */
  if (window.addEventListener) {
    var mapResizeTimer = null;
    window.addEventListener('resize', function () {
      if (!mapState) return;
      if (mapResizeTimer) clearTimeout(mapResizeTimer);
      mapResizeTimer = setTimeout(function () {
        if (mapState) paintMap(mapState.plan, mapState.base);
      }, 180);
    });
  }

  /* 攻略弹窗：点遮罩、点右上角 × 、按 Esc 都能关 */
  el('guideMask').onclick = closeGuide;
  if (document.addEventListener) {
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' || e.keyCode === 27) closeGuide();
    });
  }

  /* ---------- 页头品类带 ----------
   * 数据包里出现过的品类，按数量排序列一遍：既是「本页有多少东西」的第一印象，
   * 也是后面结果页与攻略卡那套配色的图例。全部取自品类字典，没有一条是写死的。
   *
   * 默认折叠：十一类铺开是两行半彩色胶囊，把向导卡片挤到首屏之外，
   * 也盖过「先选偏好」这件正事。先露前五类，其余收在一枚按钮后面。
   * 分界固定按条数，不按实测宽度 —— 量宽度要读 DOM 布局，
   * 窗口一变答案就变，同一份数据会长出两种首屏（确定性就没了）。
   */
  var CAT_FOLD = 5;

  function renderCatLegend() {
    var host = el('catLegend');
    if (!host || !window.CAT_VISUALS) return;
    var counts = {};
    Object.keys(window.CITY_DATA || {}).forEach(function (k) {
      var p = window.CITY_DATA[k];
      (p.attractions || []).forEach(function (a) { counts[a.cat] = (counts[a.cat] || 0) + 1; });
    });
    var keys = Object.keys(counts).filter(function (k) { return window.CAT_VISUALS[k]; });
    if (!keys.length) return;
    keys.sort(function (a, b) { return counts[b] - counts[a] || (a < b ? -1 : a > b ? 1 : 0); });
    var total = keys.reduce(function (s, k) { return s + counts[k]; }, 0);
    var folded = keys.length - CAT_FOLD;

    host.innerHTML = '<span class="cglead">收录 ' + total + ' 处景点 · 分 ' + keys.length + ' 类</span>' +
      keys.map(function (k, i) {
        var c = window.CAT_VISUALS[k];
        return '<span class="catpill' + (i >= CAT_FOLD ? ' is-fold' : '') + '"' +
          ' title="' + esc(c.label) + ' · 本城收录 ' + counts[k] + ' 处"' +
          ' style="color:' + c.tint + ';background:' + c.wash +
          ';border-color:' + c.line + '">' + esc(c.label) + ' ' + counts[k] + '</span>';
      }).join('') +
      (folded > 0
        ? '<button class="catmore" id="catMore" type="button" aria-expanded="false">' +
          '展开全部 ' + keys.length + ' 类</button>'
        : '');

    var btn = el('catMore');
    if (btn) {
      var full = '展开全部 ' + keys.length + ' 类';
      btn.onclick = function () {
        /* 追加/移除而不是整串重写：宿主上若将来还挂别的修饰类（测试桩也会加），
           整串赋值会把它们一起抹掉。 */
        var open = host.className.indexOf('is-open') < 0;
        host.className = open
          ? host.className + ' is-open'
          : host.className.replace(/\s*is-open/, '');
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        btn.textContent = open ? '收起' : full;
      };
    }
  }

  /* 背景照片层：只有 data/photos.js 里登记了 hero 才去取图。
     不写死在样式里，是为了让「还没攒到素材」时连一次请求都不发 ——
     否则每次加载都会请求一个不存在的文件，控制台留一条 404，
     演示时看起来像资源缺失。路径跟着登记走，换图也不必改样式。
     它纯粹是氛围层：取不到图、或浏览器不支持 mask，都只是「没有背景照片」，
     不影响任何功能，也不改 DOM 结构。 */
  function paintHeroPhoto() {
    var host = el('bgPhoto');
    var h = window.PHOTOS && window.PHOTOS.hero;
    if (!host || !h || !h.file) return;
    host.style.backgroundImage = 'url("' + h.file + '")';
  }

  buildLodgingSelect();
  STEPS = STEPS_PLAN;
  /* 流程高亮由脚本掌管，避免依赖 HTML 里的初始 class */
  el('modePlan').className = 'mode on';
  el('modeNow').className = 'mode';
  renderCatLegend();
  paintHeroPhoto();
  renderStep();

  /* 对话层运行时直接调用，不依赖测试开关：把与向导同构的排程入口挂出去。
     浏览器里也一直存在——它就是「用话聊也能生成同一份行程」的那个接缝。 */
  window.__APP__ = Object.assign(window.__APP__ || {}, {
    planWith: planWith,
    /* 对话层切「已在路上」用：那套步骤的问答顺序与字段语义与计划流程不同，
       只有它需要直接切 FLOW，所以只暴露这一个入口，不暴露整份内部状态。 */
    setFlow: setFlow,
    PREF_ALL: PREF_ALL,
    ROLE_LABEL: ROLE_LABEL,
    PACE_LABEL: PACE_LABEL,
    SCOPE: SCOPE,
    findLodging: findLodging,
    /* 对话层攒够槽位后，把它的 state 镜像进向导 S，再走与表单完全相同的
       renderResult()——这样「用话聊」和「点表单」产出的结果页逐字节一致，
       也顺便让用户在结果页继续用表单微调。D 是对话层的 state（见 js/dialogue.js）。 */
    applyDialogueState: function (state) {
      /* 先把向导拨回计划流程（会归零 S 与 finished），再灌对话层的槽位。
         顺序不能反：setFlow 在 finished=真 时会重置 S.days/prefs/pace/scope，
         若先灌再切，第二次对话生成就会拿到一份被清空的 S。 */
      setFlow('plan');
      S.days = state.days || null;
      S.role = state.role || 'first';
      S.prefs = (state.prefs && state.prefs.length) ? state.prefs : PREF_ALL.slice();
      S.pace = state.pace || 'normal';
      S.scope = state.scope || 'with';
      S.lodgingId = state.lodgingId || null;
      S.customBase = state.customBase || null;
      S.visited = state.visited ? state.visited.slice() : [];
      S.avoid = state.avoid ? state.avoid.slice() : [];
      S.startAt = (state.startAt != null) ? state.startAt : null;
      renderResult();
    }
  });

  /* 仅在复跑脚本里挂出几个内部函数（test/guide-panel.js 靠它走通「点景点名 → 弹窗」
     这条链路，test/header-ui.js 靠它换一份小数据测折叠的边界）。
     浏览器里 window.__EXPOSE_APP__ 不存在，这段不会执行，也不产生任何全局变量。 */
  if (window.__EXPOSE_APP__) {
    window.__APP__ = Object.assign(window.__APP__ || {}, {
      openSpotGuide: openSpotGuide,
      closeGuide: closeGuide,
      guideHtml: guideHtml,
      thumbArt: thumbArt,
      photoOf: photoOf,
      renderCatLegend: renderCatLegend
    });
  }
})();

/* =============================================================================
 * 对话外壳 · 文旅导览智能体（智能体层 · js/dialogue.js）
 * -----------------------------------------------------------------------------
 * 这一层只做一件事：把自然语言接进既有的确定性排程引擎。它不生成行程、不调模型、
 * 不做任何需要「正确性保证」的计算——那些都交给 js/engine.js（经 window.__APP__.planWith）。
 *
 * 分工（也是这个 Agent 的立身之本）：
 *   · 意图解析：js/intent.js 的纯函数解析器，零依赖、可单测、离线可跑，是主路径。
 *   · 槽位状态机：把解析出的槽位攒进 state，缺哪个问哪个、说过的不再问。
 *   · 工具调用：攒够就用 window.__APP__.planWith 产出与表单完全一致的行程。
 *   · 降级：解析置信度低时明说「没听懂」，一键切回六步表单（window.__APP__.applyDialogueState 的同伴）。
 *
 * 纯度纪律：emptyState / ingest / plan 三个函数零 DOM、零时间读取、零随机数——
 * 因此「同一句话两次对话」与「同一组槽位走对话 / 走向导」的排程结果逐字节一致，
 * 由 test/dialogue.js 锁死。UI 部分（init 起）才碰 DOM，不影响排程确定性。
 * ========================================================================== */
(function () {
  'use strict';

  /* ---------- 槽位状态 ---------- */
  /* 偏好默认空数组：空 = 不限（与向导「不限」同义，由 planWith 在排程时展开成全部）。
     这样「喜欢人文历史」就是真的只保留人文历史，而不是「在全部里再加一项」——
     与向导勾选语义一致。其余有默认值的字段在 missing() 里补，不在 state 里预填。 */
  function emptyState(prefAll) {
    return {
      days: null,
      role: null,
      prefs: [],                       // 空 = 不限；说了具体偏好就覆盖
      pace: null,
      scope: null,
      lodgingId: null,
      customBase: null,
      visited: [],
      avoid: [],
      startAt: null
    };
  }

  /* 把解析结果并回 state。纯函数：不改入参，返回新 state。
     prefs 走「并集 + 差集」，所以「多安排点人文历史」是加强、「不想看人文历史」是剔除，
     与向导里「勾选 / 取消勾选」语义一致。 */
  function ingest(state, parsed, prefAll) {
    var s = {
      days: state.days, role: state.role,
      prefs: state.prefs.slice(), pace: state.pace, scope: state.scope,
      lodgingId: state.lodgingId, customBase: state.customBase,
      visited: state.visited.slice(), avoid: state.avoid.slice(),
      startAt: state.startAt
    };
    var sl = parsed.slots || {};
    if (sl.days != null) s.days = sl.days;
    if (sl.role) s.role = sl.role;
    if (sl.pace) s.pace = sl.pace;
    if (sl.scope) s.scope = sl.scope;
    if (sl.lodging) s.lodgingId = sl.lodging;
    if (sl.startAt != null) s.startAt = sl.startAt;
    if (sl.visited && sl.visited.length) {
      sl.visited.forEach(function (id) { if (s.visited.indexOf(id) < 0) s.visited.push(id); });
    }
    if (sl.avoid && sl.avoid.length) {
      sl.avoid.forEach(function (id) { if (s.avoid.indexOf(id) < 0) s.avoid.push(id); });
    }
    if (sl.prefs && sl.prefs.length) {
      sl.prefs.forEach(function (v) { if (s.prefs.indexOf(v) < 0) s.prefs.push(v); });
    }
    if (sl.prefsDrop && sl.prefsDrop.length) {
      s.prefs = s.prefs.filter(function (v) { return sl.prefsDrop.indexOf(v) < 0; });
    }
    return s;
  }

  /* 缺哪个问哪个。提问顺序与向导步骤同序；有默认值的字段（role/prefs/pace/scope）
     不主动追问，攒到最后若仍未给再补一句。行程真正跑起来最少要 days + lodgingId。
     问句里**不写城市名与周边地名**：界面上会被向导原标题覆盖（见 askFor），
     这里只是兜底；写死地名会让"换一份数据包就是一座新城市"变成空话。 */
  var ASK_ORDER = ['days', 'lodgingId', 'role', 'prefs', 'pace', 'scope'];
  var PROMPTS = {
    days: '打算玩几天？',
    lodgingId: '住哪儿？告诉我住宿位置或片区，我据此排路线。',
    role: '您对这里熟悉吗？第一次来 / 多次来 / 我是本地人？',
    prefs: '对哪些类型感兴趣？（人文历史、自然风光、美食…不挑就默认都看）',
    pace: '节奏想怎么玩？轻松 / 标准 / 紧凑 / 夜间？',
    scope: '只在市区，还是把周边也纳入？'
  };
  function missing(state) {
    for (var i = 0; i < ASK_ORDER.length; i++) {
      var k = ASK_ORDER[i];
      if (k === 'role' || k === 'prefs' || k === 'pace' || k === 'scope') continue; // 有默认，不追问
      if (state[k] == null || state[k] === '') return k;
    }
    return null;
  }
  function ready(state) {
    return state.days != null && !!state.lodgingId;
  }

  /* 排程：直接复用与向导同构的 window.__APP__.planWith，保证结果逐字节一致。 */
  function plan(city, state, extra) {
    return window.__APP__.planWith(city, state, extra);
  }

  /* ---------- 思考过程（纯函数，零 DOM、零时间、零随机） ----------
   * 对话里的「思考中…」不是装饰性话术：每一行都由解析结果、槽位与（可选）引擎产出
   * 现算 —— 听懂什么、现在有哪些槽位、按什么口径筛、排出来是多少。
   * 因此同一句话永远得到同一段思考文本，与排程一样可复现（test/chat-ui.js 锁）。
   * 文本里不出现任何城市专名（山、陵、湖一概不提），换数据包不用改这里。 */
  function fmtHM(m) {
    var h = Math.floor(m / 60), mm = m % 60;
    return (h < 10 ? '0' : '') + h + ':' + (mm < 10 ? '0' : '') + mm;
  }

  function thinking(parsed, state, ctx, res, meta) {
    var lines = [];
    var sl = (parsed && parsed.slots) || {};
    var L = ctx.labels || {};

    /* ⑤′ 模型参与时，明写它做了什么 —— 只报"补了哪几格"，
       不把模型的自由文本搬进思考块（那是话术，不是依据）。
       未接入模型时 meta 为空，这段完全不出现，思考文本与 v11 逐字节一致。 */
    if (meta && meta.used && meta.filled && meta.filled.length) {
      lines.push('模型解析：' + (meta.model || 'LLM') + ' 补全 ' + meta.filled.length + ' 个槽位（'
        + meta.filled.join('、') + '）｜ 命令判定与排程仍在本地');
    }

    function lab(kind, v) { return (L[kind] && L[kind][v]) || v; }
    function lodgingName(id) {
      var ls = ctx.lodgings || [];
      for (var i = 0; i < ls.length; i++) if (ls[i].id === id) return ls[i].name;
      return id || '';
    }
    function spotName(id) {
      var all = (ctx.spots || []).concat(ctx.nearbySpots || []);
      for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i].name;
      return id;
    }

    /* ① 这句话听出了什么 */
    var heard = [];
    if (sl.days != null) heard.push('天数 ' + sl.days + ' 天');
    if (sl.role) heard.push('身份 ' + lab('role', sl.role));
    if (sl.lodging) heard.push('驻点 ' + lodgingName(sl.lodging));
    if (sl.prefs && sl.prefs.length) heard.push('偏好 ' + sl.prefs.join('/'));
    if (sl.prefsDrop && sl.prefsDrop.length) heard.push('去掉 ' + sl.prefsDrop.join('/'));
    if (sl.pace) heard.push('节奏 ' + lab('pace', sl.pace));
    if (sl.scope) heard.push('范围 ' + lab('scope', sl.scope));
    if (sl.startAt != null) heard.push('出发 ' + fmtHM(sl.startAt));
    if (sl.visited && sl.visited.length) heard.push('已去过 ' + sl.visited.map(spotName).join('/'));
    if (sl.avoid && sl.avoid.length) heard.push('不去 ' + sl.avoid.map(spotName).join('/'));
    lines.push(heard.length ? ('听懂这句：' + heard.join('、'))
      : '这句话没有带来新的行程条件，先按已有槽位推进');

    /* ② 当前槽位全景（有默认值的标"默认"，缺的写"待补"） */
    var have = [], miss = [];
    if (state.days != null) have.push(state.days + ' 天'); else miss.push('天数');
    if (state.lodgingId) have.push('驻点 ' + lodgingName(state.lodgingId)); else miss.push('住宿位置');
    have.push('身份 ' + lab('role', state.role || 'first') + (state.role ? '' : '（默认）'));
    have.push('偏好 ' + ((state.prefs && state.prefs.length) ? state.prefs.join('/') : '不限'));
    have.push('节奏 ' + lab('pace', state.pace || 'normal') + (state.pace ? '' : '（默认）'));
    have.push('范围 ' + lab('scope', state.scope || 'with') + (state.scope ? '' : '（默认）'));
    lines.push('当前槽位：' + have.join(' · ') + (miss.length ? ('（待补：' + miss.join('、') + '）') : ''));

    /* ③ 按身份决定筛谁——这是三档身份真正的用处，写在思考里才看得出逻辑 */
    var RULE = {
      first: '身份「第一次来」→ 招牌 5A/4A 加权在前，必看的山与陵要排得进',
      repeat: '身份「多次来」→ 招牌降权，多排 3A 与没评级的新鲜点位',
      local: '身份「本地人」→ 4A/5A 归零，优先小众与郊野'
    };
    lines.push(RULE[state.role || 'first'] || RULE.first);
    if (state.scope === 'city') lines.push('范围「市区」→ 周边方向不进候选');
    if (state.avoid && state.avoid.length) {
      lines.push('排除 ' + state.avoid.map(spotName).join('/') + '（说过不去）');
    }

    /* ④ 结论回填：有引擎产出就报真实数字，没有就说还差哪一项 */
    if (res && res.sum && res.sum.spots) {
      lines.push('引擎排出 ' + state.days + ' 天 ' + res.sum.spots + ' 个点位 ｜ 人均门票 ¥'
        + res.sum.tickets + ' ｜ 累计车程 '
        /* 与结果页「累计车程」同一条算式（app.js 的概览卡），两处必须一致 */
        + (Math.round(res.sum.travel / 6) / 10).toFixed(1)
        + ' 小时 ｜ 开闭园与用餐已按时间窗校验');
    } else if (miss.length) {
      lines.push('还差「' + miss.join('、') + '」，补齐就能排');
    }
    return lines;
  }

  /* ---------- 上下文（喂给解析器） ----------
   * 景点 / 住宿 / 偏好全部来自数据包，换城市只换这里——与 js/intent.js 的纯度约束一致。 */
  function buildCtx() {
    var CD = window.CITY_DATA || {};
    var APP = window.__APP__ || {};
    var prefAll = APP.PREF_ALL || [];
    var city = window.Engine.buildCity(['yinchuan', 'nearby']);
    return {
      city: city,
      prefs: prefAll,
      prefWords: window.Intent.defaultPrefWords(prefAll),
      lodgings: (CD.lodging && CD.lodging.lodgings) || [],
      spots: city.attractions.map(function (a) { return { id: a.id, name: a.name }; }),
      nearbySpots: ((CD.nearby && CD.nearby.attractions) || []).map(function (a) { return { id: a.id, name: a.name }; }),
      now: 14 * 60,
      labels: {
        role: APP.ROLE_LABEL || { first: '第一次来', repeat: '多次来', local: '本地人' },
        pace: APP.PACE_LABEL || { relax: '轻松', normal: '标准', tight: '紧凑', late: '夜间' },
        scope: APP.SCOPE ? { city: APP.SCOPE.city.label, with: APP.SCOPE.with.label } : { city: '市区', with: '含周边' }
      }
    };
  }

  /* 「听懂了什么」原先单独回一条「已记下：…」气泡；现在并入思考块的第一行
     （thinking() 的「听懂这句」），同一句话不再既回显又解释，省掉一次重复。 */

  /* ================= 以下为 UI 部分（仅在浏览器里执行） ================= */
  /* 本轮检索拿到了几条（只用来决定「怎么开口」）。
     它绝不参与解析与排程：拿到三条也只是换一句话说，槽位与结果一个都不动。 */
  var lastSearch = null;

  function init() {
    if (typeof document === 'undefined') return;        // 测试环境（node + DOM 桩）下不自动初始化
    var panel = document.getElementById('chatPanel');
    if (!panel) return;
    var log = document.getElementById('chatLog');
    var input = document.getElementById('chatInput');
    var send = document.getElementById('chatSend');
    var chips = document.getElementById('chatChips');
    var newBtn = document.getElementById('chatNew');
    var nowChip = document.getElementById('chatNow');
    var wiz = document.getElementById('wizardWrap');
    var body = document.getElementById('chatBody');

    var ctx = buildCtx();
    var state = emptyState(ctx.prefs);
    var started = false;

    /* 打字速度（字/秒）。思考行快一点、正文慢一点，读起来像"想完再说"。
       整轮约 3 秒：4 行思考约 2 秒，正文 1 秒左右 —— 再快就看不出逐字，
       再慢演示时就要干等。 */
    var CPS_THINK = 60, CPS_SAY = 32;
    var busy = false;
    var reduceMotion = false;
    try {
      reduceMotion = !!(window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) { reduceMotion = false; }

    /* 把某个块滚到滚动区顶部。用 scrollTop 直接赋值而不是 scrollIntoView：
       整页设了 scroll-behavior:smooth，scrollIntoView 会走动画，位置要等下一帧才生效
       （无头验证里甚至永远不生效），而这里需要"点完就在那儿"。 */
    function scrollBodyTo(el, pad) {
      if (!body || !el || !el.getBoundingClientRect) return;
      var delta = el.getBoundingClientRect().top - body.getBoundingClientRect().top
        + body.scrollTop - (pad || 0);
      body.scrollTop = Math.max(0, delta);
    }

    /* 滚动发生在外层 .chat-body 里（页面本身不滚，见 index.html 的应用壳）：
       只把它往下推，让正在出的那一行始终留在可视区，不做任何整页滚动。 */
    function keepVisible(el) {
      if (!body || !el || !el.getBoundingClientRect || !body.getBoundingClientRect) return;
      var rb = body.getBoundingClientRect(), re = el.getBoundingClientRect();
      if (re.bottom > rb.bottom - 10) body.scrollTop += (re.bottom - rb.bottom) + 26;
    }

    /* ---------- 逐字输出 ----------
     * 为什么不用 CSS 逐字动画：逐字 span 会提前把气泡撑到最终高度，看起来是"整段一起
     * 淡入"，不像打字。这里真的把文字一段段写进节点，气泡随字长出来。
     * 三条纪律：
     *   ① 只在用户发话之后启动，页面加载阶段一个定时器都没有（整页确定性快照不受影响）；
     *   ② 最终 DOM 与"一次写完"逐字节相同 —— 写的始终是同一段文本的前缀；
     *   ③ 减少动效（prefers-reduced-motion）时直接一次写完；测试里 setTimeout 被同步化，
     *      因此 test/chat-ui.js 拿到的也是终态。 */
    function stream(host, text, cps, done) {
      if (!host) { if (done) done(); return; }
      if (reduceMotion || !text) {
        if (text) host.textContent = text;
        if (done) done();
        return;
      }
      host.classList.add('typing');
      var step = Math.max(6, Math.round(1000 / (cps || CPS_SAY)));
      var i = 0;
      (function tick() {
        i += 1;
        host.textContent = text.slice(0, i);
        keepVisible(host);
        if (i < text.length) { setTimeout(tick, step); return; }
        host.classList.remove('typing');
        if (done) done();
      })();
    }

    /* 一轮回复没写完之前不接受新消息：否则两段逐字输出会交叉写进同一个消息流，
       "思考中的那一条"和"刚发的那一条"互相插队，读起来像串台。 */
    function setBusy(v) {
      busy = v;
      if (!send) return;
      send.disabled = v;
      if (send.classList) send.classList[v ? 'add' : 'remove']('waiting');
    }

    function bubble(who, text) {
      if (!log) return null;
      var d = document.createElement('div');
      d.className = 'bubble ' + who;
      d.textContent = text;
      log.appendChild(d);
      keepVisible(d);
      return d;
    }
    function bot(text) { return bubble('bot', text); }
    function user(text) { return bubble('user', text); }

    /* ---------- 一条助手回复 = 思考块 + 回答 ----------
     * 结构（与 index.html 的 .msg / .think 样式对应）：
     *   <div class="msg bot">
     *     <details class="think" open>…逐行写完自动收起，标题变「已思考 · N 步」…</details>
     *     <div class="bubble bot">…正文逐字写出…</div>
     *   </div>
     * 思考块保留在 DOM 里（收起不是删除），读者随时可以点开回看依据。 */
    function botTurn(lines, answer, after) {
      if (!log || !lines || !lines.length) {
        bot(answer);
        if (after) after();
        return;
      }
      setBusy(true);
      var wrap = document.createElement('div');
      wrap.className = 'msg bot';

      var det = document.createElement('details');
      det.className = 'think';
      det.open = true;
      var sum = document.createElement('summary');
      var caret = document.createElement('span');
      caret.className = 'think-caret';
      caret.textContent = '▸';
      var label = document.createElement('span');
      label.className = 'think-t';
      label.textContent = '思考中…';
      sum.appendChild(caret);
      sum.appendChild(label);

      var body = document.createElement('div');
      body.className = 'think-body';

      det.appendChild(sum);
      det.appendChild(body);

      var ans = document.createElement('div');
      ans.className = 'bubble bot';

      wrap.appendChild(det);
      wrap.appendChild(ans);
      log.appendChild(wrap);
      keepVisible(det);

      var k = 0;
      (function nextLine() {
        if (k >= lines.length) {
          det.open = false;
          label.textContent = '已思考 · ' + lines.length + ' 步';
          stream(ans, answer, CPS_SAY, function () {
            setBusy(false);
            if (after) after();
          });
          return;
        }
        var p = document.createElement('p');
        p.className = 'think-line';
        body.appendChild(p);
        stream(p, lines[k], CPS_THINK);
        k += 1;
        setTimeout(nextLine, Math.max(40, Math.round(1000 / CPS_THINK)));
      })();
    }

    /* 首条消息后从「欢迎态」切到「会话态」：欢迎区收起、消息流展开。
       只切换一个 CSS 类，不重建欢迎区节点 —— 收起再展开不会重播入场。 */
    function enterChat() {
      if (started) return;
      started = true;
      if (panel.classList) panel.classList.add('has-chat');
      else panel.className = (panel.className + ' has-chat').trim();
    }

    /* 「新对话」：清空消息与槽位，回到首屏欢迎态。 */
    function resetChat() {
      state = emptyState(ctx.prefs);
      started = false;
      if (log) log.innerHTML = '';
      if (panel.classList) panel.classList.remove('has-chat');
      else panel.className = panel.className.replace(/\s*has-chat\b/, '').trim();
      if (body) body.scrollTop = 0;
      if (input) { input.value = ''; input.focus(); }
    }

    /* 「已在路上」：这条流程的问答顺序与字段语义都与计划流程不同（同一个 pace 键
       在这里表示"收工时刻"），所以仍由那套步骤承载；点心片才展开，默认界面不显示。 */
    function openNow() {
      if (window.__APP__ && window.__APP__.setFlow) window.__APP__.setFlow('now');
      if (!wiz) return;
      wiz.hidden = false;
      wiz.open = true;
      if (wiz.scrollIntoView) wiz.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function askNext(parsed, meta) {
      var k = missing(state);
      if (k && PROMPTS[k]) { botTurn(thinking(parsed, state, ctx, null, meta), PROMPTS[k]); return; }
      if (ready(state)) { generate(parsed, meta); return; }
      botTurn(thinking(parsed, state, ctx, null, meta),
        '还差一点信息：玩几天、住哪儿？或者一句话告诉我，比如「三天，住新华街」。');
    }

    /* 结果区的标题逐字打出来。正文块的浮现交给 CSS 的 nth-child 延迟（见 index.html），
       两段在视觉上接成「先想、再说、最后把行程印出来」。结构与数字仍由 app.js 渲染，
       这里只动标题那一行的文字，不改任何排程结果。 */
    function printResult() {
      var t = document.getElementById('resultTitle');
      if (!t) return;
      var full = t.textContent;
      if (!full) return;
      t.textContent = '';
      stream(t, full, 34);
    }

    function generate(parsed, meta) {
      enterChat();
      /* 先算一遍拿真实数字写进思考块，再交给 applyDialogueState 渲染结果页。
         两次调用是同一个纯函数、同一份输入，产出必然相同（test/dialogue.js 锁的是这个）。 */
      var res = null;
      try { res = plan(ctx.city, state); } catch (e) { res = null; }
      botTurn(thinking(parsed, state, ctx, res, meta),
        '行程已生成，向下看结果页 ↓　想用话调整就说，例如「第二天太满了，调松一点」。',
        function () {
          window.__APP__.applyDialogueState(state);
          printResult();
          setTimeout(function () {
            scrollBodyTo(document.getElementById('result'), 6);
          }, 160);
        });
    }

    /* 把一次解析的结果落到状态上。抽成独立函数，是因为模型那条路是异步的，
       回来之后必须走与同步路径**完全相同**的这段逻辑 —— 不允许出现第二套判定口径。 */
    function applyParsed(parsed, meta) {
      var act = parsed.action;
      if (act === 'greet') {
        bot('你好，我是行程助手。告诉我天数和住宿，我就能排出一份行程；也可以一句话说，比如「玩三天，第一次来，住新华街」。');
        return;
      }
      if (act === 'restart') {
        state = emptyState(ctx.prefs);
        bot('已清空，重新来。打算玩几天？');
        return;
      }
      if (act === 'confirm') {
        if (ready(state)) { generate(parsed, meta); } else { askNext(parsed, meta); }
        return;
      }
      // fill 或 unknown：都先试 ingest，有槽位就并入
      var before = JSON.stringify(state);
      state = ingest(state, parsed, ctx.prefs);
      var changed = JSON.stringify(state) !== before;
      if (act === 'unknown' && !changed) {
        /* 旁注里已经有东西可看时，还说「没听懂」就是自相矛盾 ——
           得说清楚：查到的是时效信息，不是行程；行程还差什么。 */
        var said = '没太听懂，我需要：玩几天、住哪儿？也可以直接说「三天住新华街」。';
        if (lastSearch && lastSearch.n > 0) {
          said = '上面那几条是从外网查到的，本地数据包里没有时效信息 —— 门票、开放时间、路线都在包里。'
            + '行程这句我没太听懂：玩几天、住哪儿？';
        }
        botTurn(thinking(parsed, state, ctx, null, meta), said);
        return;
      }
      if (ready(state)) generate(parsed, meta);
      else askNext(parsed, meta);
    }

    /* 返回 true 表示"这句收下了"：调用方据此决定是否清空输入框 ——
       忙碌时既不发出去也不清空，否则用户打了一半的字会被悄悄吞掉。 */
    function handle(text) {
      text = (text || '').trim();
      if (!text) return false;
      if (busy) return false;        // 上一轮还在逐字输出（或在等模型），先让它说完
      lastSearch = null;             // 每轮重算，不把上一轮的旁注算到这一轮头上
      enterChat();
      user(text);

      /* 检索排在最前面，只因为它要"先看一眼再开口"：
         命中时效词就等它（最长 3.5 秒，占了位所以看得见在等什么），
         没命中就直接走解析。**它不影响解析与排程的任何一步** ——
         proceed() 拿到的还是原来那份 text。 */
      searchThen(text, proceed);
      return true;

      function proceed() {
        /* 规则解析器永远先跑：它既是保底，也是这次请求失败时的回落目标。 */
        var fast = window.Intent.parse(text, ctx);

        /* 模型只在用户配过 key 并打开开关时参与，且只影响"补槽位"这一件事。
           请求期间锁住输入（同一句话连点会被 busy 挡住），回调里无论成败都会解锁。
           适配器内部已有超时兜底，但这里仍包一层 try：万一它抛错，
           不能让一个 UI 增强件把发送键永久锁死。 */
        if (window.LLM && window.LLM.enabled && window.LLM.enabled()) {
          setBusy(true);
          try {
            window.LLM.parse(text, ctx, fast, function (parsed, meta) {
              setBusy(false);
              applyParsed(parsed || fast, meta);
            });
          } catch (e) {
            setBusy(false);
            applyParsed(fast, null);
          }
          return;
        }
        applyParsed(fast, null);
      }
    }

    /* ---------- 检索这一步 ----------
     * 三条判据都在 search.js 里（纯函数、可单测）：开没开、要不要查、查什么。
     * 这里只负责"占位 → 填内容 → 继续"，顺序固定，所以消息流里的位置也固定：
     * 用户的问话 → 旁注 → 思考块 → 回答。旁注永远在回答之前，不会被后来的
     * 异步结果插到行程下面去。 */
    function searchThen(text, done) {
      var S = window.SEARCH;
      if (!S || !S.enabled || !S.enabled() || !S.shouldSearch(text)) { done(); return; }

      var city = (ctx.city && ctx.city.name) || '';
      city = String(city).split(' + ')[0];          // 数据包可能是"主城 + 周边"，检索只带主城名
      var q = S.buildQuery(text, city);
      var node = S.pending(log);
      if (node) keepVisible(node);

      setBusy(true);
      S.query(q, function (err, items) {
        lastSearch = { n: (items || []).length, err: err || null };
        if (node) S.fill(node, items, { query: q, err: err });
        if (node) keepVisible(node);
        setBusy(false);
        done();
      });
    }

    if (send) send.onclick = function () {
      if (handle(input ? input.value : '') && input) input.value = '';
    };
    if (input) input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.keyCode === 13) {
        if (handle(input.value)) input.value = '';
      }
    });
    /* 示例 chips：点一下就当作把这句话发出去，省去打字。
       「已在路上」那枚带 data-now，走另一条分支（不发送消息）。 */
    if (chips && chips.querySelectorAll) {
      var cs = chips.querySelectorAll('.chip');
      for (var i = 0; i < cs.length; i++) {
        (function (c) {
          if (c.getAttribute && c.getAttribute('data-now')) return;   // 这枚走 openNow()
          c.onclick = function () {
            var say = (c.getAttribute && c.getAttribute('data-say')) || c.textContent || '';
            if (input) input.value = say;
            if (handle(say) && input) input.value = '';
          };
        })(cs[i]);
      }
    }
    if (nowChip) nowChip.onclick = openNow;
    if (newBtn) newBtn.onclick = resetChat;

    /* 结果页的「重新规划」：app.js 那边负责清空结果（restoreWizard + 回到第 1 步），
       这里补上对话侧的动作 —— 把对话区带回视野、光标放回输入框，让人知道
       "接着用话改就行"。向导已隐藏，所以点它不会再冒出表单。 */
    var restartBtn = document.getElementById('restart');
    if (restartBtn && restartBtn.addEventListener) {
      restartBtn.addEventListener('click', function () {
        if (body) body.scrollTop = 0;
        setTimeout(function () { if (input) input.focus(); }, 60);
      });
    }

    /* 模型设置面板：可选件，节点不在（或桩环境）时内部直接返回，不抛错。 */
    if (window.LLM && window.LLM.initPanel) {
      try { window.LLM.initPanel(); } catch (e) { /* 面板坏了不能连带影响对话 */ }
    }
    /* 检索面板同理：另一个开关，另一件事。 */
    if (window.SEARCH && window.SEARCH.initPanel) {
      try { window.SEARCH.initPanel(); } catch (e) { /* 同上 */ }
    }
  }

  window.Dialogue = {
    emptyState: emptyState,
    ingest: ingest,
    missing: missing,
    ready: ready,
    plan: plan,
    thinking: thinking,
    init: init,
    PROMPTS: PROMPTS
  };

  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('DOMContentLoaded', init);
  }
})();

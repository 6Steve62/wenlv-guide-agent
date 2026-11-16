/* =============================================================================
 * js/search.js —— 可选的外部信息检索（问答旁注层）
 *
 * 定位：**不在排程链路上**。数据包里存的是常年的开放时间、票价与点位，
 *      而「今天闭没闭园」「这周有什么活动」「现在下不下雨」只有外面知道。
 *      这一层只回答后一类问题，而且回答方式是**把原文摆出来让人自己看**，
 *      不是让模型转述一遍。
 *
 * 五条纪律（与 llm.js 同一条）：
 *   ① 默认关闭。没有配置 = 关闭 = 加载阶段零网络请求，整页 DOM 逐字节可复现。
 *   ② 只在命中"时效词"时才查。判据是纯函数 shouldSearch()，不看时间、不认识城市，
 *      因此"查不查"这件事本身可以被断言锁死。
 *   ③ 结果只做旁注：不进槽位、不进结果页、不参与任何时间与费用的计算。
 *      行程该怎样还是怎样 —— 旁注里说"今天闭园"，也只会显示在旁注里。
 *   ④ 任何失败都不挡正文：超时 / 断网 / CORS / 非 JSON 一律收成一行说明，
 *      正文照常走本地数据。
 *   ⑤ 代码里没有密钥。Key 只存 localStorage，且只发往用户自己确认的那个端点。
 *
 * 为什么单独一个文件、而不是塞进 llm.js 的"服务商"下拉：
 * 那一栏是 `POST {base}/chat/completions` + `messages`（对话补全），
 * 这里是 `POST {base}` + `query`（检索），返回一串网页摘要 —— 协议、载荷、
 * 回包形状全都不一样。混在一栏里，用户填了也只会得到一个假开关。
 * ========================================================================== */
(function () {
  'use strict';

  var VERSION = '1.0.0';
  var STORE_KEY = 'lvyou_search_cfg_v1';
  var TIMEOUT = 3500;                       // 检索比解析慢，给它比模型多 0.9 秒
  var ENDPOINT = 'https://api.tavily.com/search';
  var MAX_ITEMS = 3;                        // 旁注最多三条：再多就不像旁注了

  /* ---------- 时效词 ----------
   * 只收"会变的事"：临时通知、状态变化、当期活动、天气路况。
   * 刻意不收「门票多少钱」「开放时间」这类 —— 那些数据包里有准确答案，
   * 去外面查反而可能拿到一篇过期的攻略。 */
  var TIME_WORDS = /临时|闭园|关闭|停运|停飞|检修|维修|施工|管制|限流|预约|天气|下雨|下雪|沙尘|大风|客流|排队|活动|展览|演出|庙会|节庆|开幕|调价|免费日|最新/;

  /* ---------- 配置 ---------- */
  function readCfg() {
    try {
      var raw = window.localStorage && window.localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      var c = JSON.parse(raw);
      if (!c || !c.base || !c.key) return null;
      return { base: String(c.base).replace(/\/+$/, ''), key: String(c.key), vendor: 'tavily' };
    } catch (e) { return null; }
  }
  function saveCfg(c) {
    try {
      if (!c) { window.localStorage.removeItem(STORE_KEY); return true; }
      window.localStorage.setItem(STORE_KEY, JSON.stringify(c));
      return true;
    } catch (e) { return false; }
  }
  function enabled() { return !!readCfg(); }

  /* ---------- 纯函数：要不要查 ----------
   * 太短的句子不查（「今天」两个字不足以构造检索词）；
   * 命中时效词才查。两条都是确定性判据，没有模型参与。 */
  function shouldSearch(text) {
    var s = String(text == null ? '' : text).trim();
    if (s.length < 4) return false;
    return TIME_WORDS.test(s);
  }

  /* ---------- 纯函数：检索词 ----------
   * 城市名由调用方注入 —— 本文件不认识任何城市，换数据包也不用改这里。
   * 用户句子里已经带了城市名就不重复加。 */
  function buildQuery(text, cityName) {
    var s = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    var c = String(cityName == null ? '' : cityName).trim();
    if (c && s.indexOf(c) < 0) s = c + ' ' + s;
    return s.slice(0, 60);
  }

  /* ---------- 回包收敛 ----------
   * 外面拿回来的东西一律当不可信输入：地址不是 http(s) 的丢掉，
   * 标题空就用地址顶上，摘要截断。宁可少显示，不可显示一个拼错的来源。 */
  function domainOf(u) {
    var m = String(u || '').match(/^https?:\/\/([^\/?#]+)/i);
    return m ? m[1].replace(/^www\./i, '').slice(0, 40) : '';
  }
  function sanitize(raw) {
    var out = [];
    var list = (raw && raw.results) || [];
    if (Object.prototype.toString.call(list) !== '[object Array]') return out;
    for (var i = 0; i < list.length && out.length < MAX_ITEMS; i++) {
      var r = list[i] || {};
      var url = String(r.url || '');
      if (!/^https?:\/\//i.test(url)) continue;
      var title = String(r.title || '').replace(/\s+/g, ' ').trim();
      var body = String(r.content || r.snippet || '').replace(/\s+/g, ' ').trim();
      out.push({
        title: (title || domainOf(url)).slice(0, 80),
        url: url.slice(0, 300),
        domain: domainOf(url),
        snippet: body.length > 90 ? body.slice(0, 90) + '…' : body
      });
    }
    return out;
  }

  /* ---------- 一次检索 ---------- */
  var lastDiag = null;
  function diag(info) { lastDiag = info; }

  function query(q, cb) {
    cb = cb || function () {};
    var cfg = readCfg();
    if (!cfg) { diag({ ok: false, err: '未配置' }); cb('未配置', []); return; }

    var done = false;
    function finish(err, items) {
      if (done) return;
      done = true;
      diag(err ? { ok: false, err: err } : { ok: true, n: (items || []).length });
      cb(err || null, items || []);
    }

    var timer = setTimeout(function () { finish('timeout', []); }, TIMEOUT);
    try {
      var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var opt = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.key },
        body: JSON.stringify({
          query: q,
          search_depth: 'basic',       // 1 个额度、够快；旁注不需要深度检索
          topic: 'general',
          max_results: MAX_ITEMS,
          include_answer: false,       // 不要它替我们总结：旁注只摆原文
          include_raw_content: false,
          include_images: false
        })
      };
      if (ctrl) opt.signal = ctrl.signal;
      setTimeout(function () { if (ctrl) { try { ctrl.abort(); } catch (e) {} } }, TIMEOUT);

      window.fetch(cfg.base, opt).then(function (r) {
        if (!r.ok) { clearTimeout(timer); finish('http ' + r.status, []); return null; }
        return r.json();
      }).then(function (j) {
        clearTimeout(timer);
        if (!j) return;
        var items = sanitize(j);
        if (!items.length) { finish('没有可用结果', []); return; }
        finish(null, items);
      })['catch'](function (e) {
        clearTimeout(timer);
        var msg = String((e && e.message) || e);
        if (/abort/i.test(msg)) msg = 'timeout';
        if (/failed to fetch|networkerror|load failed/i.test(msg)) msg = 'network/CORS';
        finish(msg, []);
      });
    } catch (e) {
      clearTimeout(timer);
      finish('exception', []);
    }
  }

  /* ---------- 旁注的三种形态 ----------
   * pending：先占位（等 3.5 秒是有代价的，得让人知道在等什么）
   * fill：   查到就摆条目，查不到就一行说明 —— 不假装，也不弹窗
   * 结构与文案都在这里，dialogue.js 只负责把它插进消息流。 */
  function host() {
    if (typeof document === 'undefined' || !document.createElement) return null;
    var d = document.createElement('div');
    d.className = 'note-search';
    return d;
  }

  function pending(where) {
    var d = host();
    if (!d || !where) return null;
    var h = document.createElement('p');
    h.className = 'note-search-h';
    h.textContent = '查外网…（只查时效信息，不参与排程）';
    d.appendChild(h);
    where.appendChild(d);
    return d;
  }

  function head(text) {
    var h = document.createElement('p');
    h.className = 'note-search-h';
    h.textContent = text;
    return h;
  }

  function fill(node, items, meta) {
    if (!node || !node.parentNode) return null;
    while (node.firstChild) node.removeChild(node.firstChild);
    meta = meta || {};

    if (!items || !items.length) {
      node.className = 'note-search is-empty';
      node.appendChild(head('外网没查到（' + (meta.err || '无结果') + '），下面按本地数据作答。'));
      return node;
    }

    node.className = 'note-search';
    node.appendChild(head('检索旁注 · ' + items.length + ' 条 · 来自外部网页，不参与排程'));

    var ol = document.createElement('ol');
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var li = document.createElement('li');

      var a = document.createElement('a');
      a.className = 'ns-t';
      a.href = it.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';       // 外部页面不许拿到本页的 window.opener
      a.textContent = it.title;
      li.appendChild(a);

      if (it.domain) {
        var s = document.createElement('span');
        s.className = 'ns-u';
        s.textContent = it.domain;
        li.appendChild(s);
      }
      if (it.snippet) {
        var x = document.createElement('span');
        x.className = 'ns-x';
        x.textContent = it.snippet;
        li.appendChild(x);
      }
      ol.appendChild(li);
    }
    node.appendChild(ol);
    return node;
  }

  /* ---------- 设置面板 ----------
   * 与模型面板同一套 class（.llm-wrap / .llm-pop），所以样式不必再写一遍。
   * 节点不存在时每个分支都安全返回 —— test/chat-ui.js 的 DOM 桩里没有这些节点。 */
  function initPanel() {
    if (typeof document === 'undefined' || !document.getElementById) return;
    var wrap = document.getElementById('searchWrap');
    if (!wrap) return;
    var btn = document.getElementById('searchBtn');
    var baseIn = document.getElementById('searchBase');
    var keyIn = document.getElementById('searchKey');
    var saveBtn = document.getElementById('searchSave');
    var clearBtn = document.getElementById('searchClear');
    var diagEl = document.getElementById('searchDiag');

    function say(txt, bad) {
      if (!diagEl) return;
      diagEl.textContent = txt || '';
      if (diagEl.classList) diagEl.classList[bad ? 'add' : 'remove']('bad');
    }

    function paint() {
      var c = readCfg();
      if (btn) {
        btn.textContent = '检索：' + (c ? '开' : '关');
        if (btn.classList) btn.classList[c ? 'add' : 'remove']('on');
      }
      if (c) {
        if (baseIn) baseIn.value = c.base;
        if (keyIn) keyIn.value = c.key;
      } else if (baseIn && !baseIn.value) {
        baseIn.value = ENDPOINT;
      }
      var d = lastDiag;
      if (d && !d.ok && c) say('上次检索：' + d.err, true);
      else if (d && d.ok) say('上次检索：' + d.n + ' 条');
      else say('');
    }

    if (saveBtn) {
      saveBtn.onclick = function () {
        var base = (baseIn && baseIn.value || '').trim() || ENDPOINT;
        var key = (keyIn && keyIn.value || '').trim();
        if (!key) { say('请填 API Key', true); return; }
        if (!/^https?:\/\//i.test(base)) { say('接口地址要以 http:// 或 https:// 开头', true); return; }
        var ok = saveCfg({ base: base.replace(/\/+$/, ''), key: key });
        if (!ok) say('浏览器不允许写入本地存储（可能是隐私模式），本次有效但不保留', true);
        else say('已开启。只有问到时效问题（临时闭园、活动、天气）才会去查。');
        paint();
        if (ok && wrap) wrap.open = false;
      };
    }
    if (clearBtn) {
      clearBtn.onclick = function () {
        saveCfg(null);
        if (baseIn) baseIn.value = '';
        if (keyIn) keyIn.value = '';
        say('已关闭。时效问题也只按本地数据作答。');
        paint();
      };
    }
    if (wrap.addEventListener) {
      wrap.addEventListener('toggle', function () { if (wrap.open) paint(); });
    }
    if (document.addEventListener) {
      document.addEventListener('click', function (e) {
        if (!wrap.open) return;
        var t = e && e.target;
        while (t) { if (t === wrap) return; t = t.parentNode; }
        wrap.open = false;
      });
    }
    paint();
  }

  window.SEARCH = {
    VERSION: VERSION,
    ENDPOINT: ENDPOINT,
    readCfg: readCfg,
    saveCfg: saveCfg,
    enabled: enabled,
    shouldSearch: shouldSearch,
    buildQuery: buildQuery,
    sanitize: sanitize,
    query: query,
    pending: pending,
    fill: fill,
    initPanel: initPanel,
    lastDiag: function () { return lastDiag; },
    _reset: function () { lastDiag = null; }
  };
})();

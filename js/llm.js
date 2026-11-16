/* =============================================================================
 * js/llm.js —— 可选的大模型意图适配器（智能体层 · 耳朵的可替换件）
 *
 * 定位：主路径仍然是 js/intent.js 的零依赖规则解析器。本文件只是在它前面
 *      插一道**可选前置**：当用户在页面上填了自己的 API Key 并打开开关，
 *      先用大模型把开放表达解析成槽位，再与规则解析器的结果合并。
 *      排程永远不经过它。
 *
 * 五条纪律（与工程其他部分同一条）：
 *   ① 默认关闭。没有用户配置 = 关闭 = 加载阶段零网络请求，
 *      整页 DOM 逐字节可复现（test/determinism.js）一个字节都不受影响。
 *   ② 只补空、不改已认出的。规则解析器认对的槽位一律保留 ——
 *      「宁可少认，不可认错」（intent.js 的取舍）在这里同样成立。
 *   ③ 不产出事实、不产出文案。模型只吐一份槽位 JSON；
 *      回显句（heard）、命令判定（action）全部在本地拼；
 *      门票 / 开放时间 / 车程一概不经过它 —— 那些在 data/ 里。
 *   ④ 失败静默回落。超时 / 断网 / CORS / 非 JSON / 字段非法 →
 *      直接采用规则解析器的结果，用户无感，只在设置面板留一行诊断。
 *   ⑤ 代码里没有任何密钥。配置只存 localStorage，
 *      且只会发往用户自己填的那个端点。
 * ========================================================================== */
(function () {
  'use strict';

  var VERSION = '1.0.0';
  var STORE_KEY = 'lvyou_llm_cfg_v1';
  var TIMEOUT = 2600;      // 超过这个时间就回落，别让人干等

  /* ---------- 预置端点 ----------
   * 都是国内可直连、OpenAI 兼容的接口。
   * custom 留给用户自填（任何 OpenAI 兼容网关都能用）。
   * 注意：这些是**默认值**，不是承诺 —— 免费政策与模型名都会变，以厂商页面为准。
   *
   * DeepSeek 单独说明（2026-11 核过文档）：
   *   · 模型名用 deepseek-flash（现指向 DeepSeek-V4.1-Flash-1017）；
   *     旧名 deepseek-chat / deepseek-reasoner 已于 2026-07-24 弃用，别再填。
   *   · base_url 用 https://api.deepseek.com/v1（与 /chat/completions 拼起来即官方端点）。
   *   · 思考模式**默认开启**，对"只吐一行 JSON"这种活儿纯属浪费：又慢又吃 max_tokens，
   *     容易在 2.6 秒超时前只吐到 reasoning 就断了。callOnce() 里对它显式关掉。 */
  var ENDPOINTS = {
    zhipu:    { label: '智谱 GLM-4-Flash（永久免费）', base: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
    silicon:  { label: '硅基流动 Qwen2.5-7B（免费）',  base: 'https://api.siliconflow.cn/v1',     model: 'Qwen/Qwen2.5-7B-Instruct' },
    qianfan:  { label: '百度 ERNIE-Speed（免费）',      base: 'https://qianfan.baidubce.com/v2',   model: 'ernie-speed-8k' },
    deepseek: { label: 'DeepSeek（按量计费）', base: 'https://api.deepseek.com/v1', model: 'deepseek-flash' },
    custom:   { label: '自定义（OpenAI 兼容）',          base: '',                                 model: '' }
  };

  /* ---------- 配置读写 ----------
   * localStorage 在 file:// 与 http:// 下都能用，但隐私模式下可能抛错，
   * 所以一律 try/catch；读不出来就当没配置（= 关闭）。 */
  function readCfg() {
    try {
      var raw = window.localStorage && window.localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      var c = JSON.parse(raw);
      if (!c || !c.base || !c.key || !c.model) return null;
      return { base: String(c.base).replace(/\/+$/, ''), key: String(c.key), model: String(c.model), vendor: String(c.vendor || 'custom') };
    } catch (e) { return null; }
  }
  function saveCfg(c) {
    try {
      if (!c) { window.localStorage.removeItem(STORE_KEY); return true; }
      window.localStorage.setItem(STORE_KEY, JSON.stringify(c));
      return true;
    } catch (e) { return false; }
  }

  /* 是否可用：三项都齐才算开。任何一项缺失都静默走规则解析器。 */
  function enabled() { return !!readCfg(); }

  /* ---------- 槽位校验 ----------
   * 模型的输出一律当"不可信输入"处理：类型不对、取值越界、
   * 不在 ctx 给的白名单里 —— 一律丢那一个字段，而不是整份结果。
   * 这样即便模型胡写，也不会把排程喂进一个非法参数。 */
  function inList(v, list) {
    if (typeof v !== 'string') return null;
    for (var i = 0; i < list.length; i++) if (list[i] === v) return v;
    return null;
  }
  function idList(v, list) {
    if (!v || Object.prototype.toString.call(v) !== '[object Array]') return null;
    var ok = [];
    for (var i = 0; i < v.length; i++) { if (inList(v[i], list)) ok.push(v[i]); }
    return ok.length ? ok : null;
  }
  function intIn(v, lo, hi) {
    return (typeof v === 'number' && isFinite(v) && Math.floor(v) === v && v >= lo && v <= hi) ? v : null;
  }

  /* 把模型给的对象收敛成 slots。ctx 是唯一白名单来源 —— 本文件不认识任何城市。 */
  function sanitize(obj, ctx) {
    var out = {};
    if (!obj || typeof obj !== 'object') return out;
    var c = ctx || {};

    var d = intIn(obj.days, 1, 7);                          if (d != null) out.days = d;
    var r = inList(obj.role, ['first', 'repeat', 'local']);  if (r) out.role = r;
    var p = inList(obj.pace, ['relax', 'normal', 'tight', 'late']); if (p) out.pace = p;
    var s = inList(obj.scope, ['city', 'with']);             if (s) out.scope = s;

    var lodgIds = (c.lodgings || []).map(function (x) { return x.id; });
    var l = inList(obj.lodging, lodgIds);
    if (l) {
      out.lodging = l;
      for (var i = 0; i < c.lodgings.length; i++) {
        if (c.lodgings[i].id === l) out._lodgingName = c.lodgings[i].name;
      }
    }

    var prefAll = c.prefs || [];
    var pf = idList(obj.prefs, prefAll);       if (pf) out.prefs = pf;
    var pd = idList(obj.prefsDrop, prefAll);   if (pd) out.prefsDrop = pd;

    var allSpots = (c.spots || []).concat(c.nearbySpots || []);
    var spotIds = allSpots.map(function (x) { return x.id; });
    var nameOf = {};
    allSpots.forEach(function (x) { nameOf[x.id] = x.name; });

    var vi = idList(obj.visited, spotIds);
    if (vi) { out.visited = vi; out._visitedNames = vi.map(function (id) { return nameOf[id]; }); }
    var av = idList(obj.avoid, spotIds);
    if (av) { out.avoid = av; out._avoidNames = av.map(function (id) { return nameOf[id]; }); }

    var t = intIn(obj.startAt, 0, 1439);       if (t != null) out.startAt = t;

    return out;
  }

  /* ---------- 提示词 ----------
   * 这一段就是「核心提示词」材料里那份的实际实现：角色 / 任务 / 约束 /
   * 取值域 / 输出格式 / 异常处理。合法取值全部由 ctx 注入，
   * 换一座城市只换数据包，本文件一行不改。 */
  function buildPrompt(text, ctx) {
    var c = ctx || {};
    var prefs = (c.prefs || []).join('、');
    var lodg = (c.lodgings || []).map(function (x) { return x.id + '=' + x.name; }).join('；');
    var spots = (c.spots || []).map(function (x) { return x.id + '=' + x.name; }).join('；');
    var near = (c.nearbySpots || []).map(function (x) { return x.id + '=' + x.name; }).join('；');

    var sys = [
      '你是行程助手的意图解析器，只做一件事：把用户的一句话解析成槽位 JSON。',
      '',
      '【边界】',
      '你不知道任何现实事实——门票价、开放时间、距离、天气、交通。',
      '这些由本地引擎负责，你绝对不要输出，也不要放进任何字段。',
      '',
      '【规则】',
      '1. 只输出 JSON 对象本身，不要解释，不要 markdown 代码块。',
      '2. 只填用户这句话里**明确提到**的字段。没提到的一律省略，不要猜、不要补默认值。',
      '3. 每个字段的值必须来自下面的合法取值表。表里没有的，直接省略该字段。',
      '4. 天数最多 7 天。一句话里出现多个数字时，取"玩几天"那个。',
      '5. 用户说"不想去/去掉/别看"的点位或兴趣，放 avoid 或 prefsDrop。',
      '6. 整句话没有任何行程信息时，输出 {}。',
      '',
      '【合法取值】',
      'days: 1 到 7 的整数',
      'role: first（第一次来）/ repeat（多次来）/ local（本地人）',
      'pace: relax（轻松）/ normal（标准）/ tight（紧凑）/ late（夜间活动为主）',
      'scope: city（只在市区）/ with（含周边）',
      'prefs: ' + (prefs || '（无）'),
      'prefsDrop: 同上，取用户明确排斥的那几个',
      'lodging: ' + (lodg || '（无）'),
      'visited: ' + (spots ? spots + (near ? '；' + near : '') : '（无）'),
      'avoid: 同上，取用户明确不想去的',
      'startAt: 当天出发时刻，换算成"第几分钟"，0 到 1439',
      '',
      '【输出示例】',
      '用户：玩三天，第一次来，喜欢人文历史，住新华街',
      '{"days":3,"role":"first","prefs":["人文历史"],"lodging":"xinhua"}',
      '',
      '【异常处理】',
      '拿不准就不填。宁少认，不认错——认错会让行程排错，少认只是多问一句。'
    ].join('\n');

    return [
      { role: 'system', content: sys },
      { role: 'user', content: String(text || '') }
    ];
  }

  /* ---------- 一次调用 ---------- */
  function callOnce(cfg, messages, cb) {
    var url = cfg.base + '/chat/completions';
    var body = {
      model: cfg.model,
      messages: messages,
      temperature: 0,                       // 要结构化输出，不要发挥
      max_tokens: 300,
      stream: false
    };

    /* DeepSeek 的思考模式默认开着，会把 300 个 max_tokens 先灌进 reasoning_content，
     * 正文还没开始就被截断，还会把 2.6 秒的超时耗光。这里只在它一家显式关掉 ——
     * 别家不认这个字段，多发反而可能 400。 */
    if (cfg.vendor === 'deepseek') body.thinking = { type: 'disabled' };

    var done = false;
    function finish(err, data) {
      if (done) return;
      done = true;
      cb(err, data);
    }

    var timer = setTimeout(function () { finish('timeout'); }, TIMEOUT);

    try {
      var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var opt = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.key },
        body: JSON.stringify(body)
      };
      if (ctrl) opt.signal = ctrl.signal;
      setTimeout(function () { if (ctrl) { try { ctrl.abort(); } catch (e) {} } }, TIMEOUT);

      window.fetch(url, opt).then(function (r) {
        if (!r.ok) {
          clearTimeout(timer);
          finish('http ' + r.status);
          return null;
        }
        return r.json();
      }).then(function (j) {
        clearTimeout(timer);
        if (!j) return;
        var txt = '';
        try { txt = j.choices[0].message.content || ''; } catch (e) { txt = ''; }
        finish(null, txt);
      })['catch'](function (e) {
        clearTimeout(timer);
        var msg = String((e && e.message) || e);
        if (/abort/i.test(msg)) msg = 'timeout';
        if (/failed to fetch|networkerror|load failed/i.test(msg)) msg = 'network/CORS';
        finish(msg);
      });
    } catch (e) {
      clearTimeout(timer);
      finish('exception: ' + String((e && e.message) || e));
    }
  }

  /* 模型爱套 ```json 围栏，剥掉再解析。 */
  function extractJson(txt) {
    if (!txt) return null;
    var s = String(txt).trim();
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    var a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a < 0 || b <= a) return null;
    try { return JSON.parse(s.slice(a, b + 1)); } catch (e) { return null; }
  }

  /* ---------- 对外接口 ----------
   * parse(text, ctx, fallback, cb)
   *   fallback：规则解析器的结果，一定非空。任何一步失败都回落到它。
   *   cb(parsed, meta)：parsed 与 Intent.parse() 同构；
   *      meta = { used:true/false, vendor, model, filled:[...], err:'...' }
   *   回调**一定**会被调用一次（同步或异步），调用方不必自己兜底。 */
  var cache = {};       // 同一句话 + 同一模型只问一次，避免连点重复计费
  var lastDiag = null;  // 设置面板读它显示"上次请求：成功 / 超时 / CORS…"

  function diag(info) { lastDiag = info; }

  function parse(text, ctx, fallback, cb) {
    cb = cb || function () {};
    var fb = fallback || { action: 'unknown', slots: {}, heard: [], notes: [], echo: text };

    var cfg = readCfg();
    if (!cfg) { diag({ ok: false, err: '未配置' }); cb(fb, { used: false, err: '未配置' }); return; }

    /* 命令类（问好 / 重来 / 确认）认得很准，不必问模型 —— 省一次往返。 */
    if (fb.action === 'greet' || fb.action === 'restart' || fb.action === 'confirm') {
      cb(fb, { used: false, err: '命令类，走规则' });
      return;
    }

    var ck = cfg.model + '|' + String(text || '');
    if (cache[ck]) {
      applySlots(fb, cache[ck].slots, cb, { used: true, cached: true, vendor: cfg.vendor, model: cfg.model });
      return;
    }

    callOnce(cfg, buildPrompt(text, ctx), function (err, txt) {
      if (err) {
        diag({ ok: false, err: err, vendor: cfg.vendor, model: cfg.model });
        cb(fb, { used: false, err: err });
        return;
      }
      var obj = extractJson(txt);
      if (!obj) {
        diag({ ok: false, err: '非 JSON', vendor: cfg.vendor, model: cfg.model });
        cb(fb, { used: false, err: '非 JSON' });
        return;
      }
      var slots = sanitize(obj, ctx);
      cache[ck] = { slots: slots };
      diag({ ok: true, err: '', vendor: cfg.vendor, model: cfg.model });
      applySlots(fb, slots, cb, { used: true, vendor: cfg.vendor, model: cfg.model });
    });
  }

  /* 合并：**只补空，不改已认出的**。
   * 规则解析器认识的槽位优先级最高 —— 那是本项目按 91 项断言调过的；
   * 模型只负责补它没覆盖到的开放表达。这样「接不接模型」不会改变已正确的结果，
   * 只会让原本认不出的句子多认几个（test/llm.js 锁这条）。 */
  function applySlots(fb, slots, cb, meta) {
    var out = {
      action: fb.action,
      slots: {},
      heard: (fb.heard || []).slice(),
      notes: (fb.notes || []).slice(),
      echo: fb.echo
    };
    var k;
    for (k in fb.slots) if (Object.prototype.hasOwnProperty.call(fb.slots, k)) out.slots[k] = fb.slots[k];

    var filled = [];
    for (k in slots) {
      if (!Object.prototype.hasOwnProperty.call(slots, k)) continue;
      if (k.charAt(0) === '_') {                    // 伴随名（_lodgingName 等）跟着主字段走
        var host = k.slice(1);
        if (out.slots[host] === slots[host] || out.slots[host] == null) out.slots[k] = slots[k];
        continue;
      }
      var had = out.slots[k];
      var empty = (k === 'prefs' || k === 'visited' || k === 'avoid' || k === 'prefsDrop')
        ? (!had || !had.length)
        : (had == null || had === '');
      if (!empty) continue;                          // 已认出 → 保留规则的判断
      out.slots[k] = slots[k];
      filled.push(k);
    }

    /* 有槽位就是一次有效填充；原本 unknown 的被模型救回来，action 也要跟着改。 */
    var keys = Object.keys(out.slots).filter(function (x) { return x.charAt(0) !== '_'; });
    if (keys.length && out.action === 'unknown') out.action = 'fill';
    if (!keys.length) { cb(fb, { used: false, err: '无槽位' }); return; }

    /* 回显句在本地拼（模型不产出文案）：只报这次模型补进来的那几个。 */
    var add = [];
    if (filled.indexOf('days') >= 0) add.push(out.slots.days + ' 天');
    if (filled.indexOf('role') >= 0) add.push({ first: '第一次来', repeat: '多次来', local: '本地人' }[out.slots.role] || out.slots.role);
    if (filled.indexOf('prefs') >= 0) add.push(out.slots.prefs.join('、'));
    if (filled.indexOf('prefsDrop') >= 0) add.push('去掉 ' + out.slots.prefsDrop.join('、'));
    if (filled.indexOf('pace') >= 0) add.push({ relax: '轻松', normal: '标准', tight: '紧凑', late: '夜间' }[out.slots.pace] || out.slots.pace);
    if (filled.indexOf('scope') >= 0) add.push({ city: '只在市区', with: '含周边' }[out.slots.scope] || out.slots.scope);
    if (filled.indexOf('lodging') >= 0) add.push('住' + (out.slots._lodgingName || out.slots.lodging));
    if (filled.indexOf('visited') >= 0 && out.slots._visitedNames) add.push('去过 ' + out.slots._visitedNames.join('、'));
    if (filled.indexOf('avoid') >= 0 && out.slots._avoidNames) add.push('避开 ' + out.slots._avoidNames.join('、'));
    if (add.length) out.heard.push('（模型补全）' + add.join('、'));

    meta.filled = filled;
    cb(out, meta);
  }

  /* ---------- 设置面板 ----------
   * 只在真实浏览器里跑。DOM 桩环境（test/chat-ui.js）没有这些节点，
   * 每个节点都判空后安全返回，不影响既有用例。 */
  function initPanel() {
    if (typeof document === 'undefined' || !document.getElementById) return;
    var wrap = document.getElementById('llmWrap');
    if (!wrap) return;
    var btn = document.getElementById('llmBtn');
    var vendorSel = document.getElementById('llmVendor');
    var baseIn = document.getElementById('llmBase');
    var modelIn = document.getElementById('llmModel');
    var keyIn = document.getElementById('llmKey');
    var saveBtn = document.getElementById('llmSave');
    var clearBtn = document.getElementById('llmClear');
    var diagEl = document.getElementById('llmDiag');

    function say(txt, bad) {
      if (!diagEl) return;
      diagEl.textContent = txt || '';
      if (diagEl.classList) diagEl.classList[bad ? 'add' : 'remove']('bad');
    }

    /* 按钮上的文字就是唯一的状态指示：关着写「模型：关」，
       开着写模型名（截断到 14 字，别把顶栏撑破）。 */
    function paint() {
      var c = readCfg();
      if (btn) {
        var nm = c ? (c.model.length > 14 ? c.model.slice(0, 14) + '…' : c.model) : '关';
        btn.textContent = '模型：' + nm;
        if (btn.classList) btn.classList[c ? 'add' : 'remove']('on');
      }
      if (c) {
        if (vendorSel) vendorSel.value = c.vendor || 'custom';
        if (baseIn) baseIn.value = c.base;
        if (modelIn) modelIn.value = c.model;
        if (keyIn) keyIn.value = c.key;
      } else {
        /* 未配置：按当前选中的服务商把地址与模型名预填好，
           用户只需要贴一个 key —— 少两步才能少一处出错。 */
        var e = ENDPOINTS[(vendorSel && vendorSel.value) || 'zhipu'];
        if (e) {
          if (baseIn && !baseIn.value) baseIn.value = e.base;
          if (modelIn && !modelIn.value) modelIn.value = e.model;
        }
      }
      var d = lastDiag;
      if (d && !d.ok && c) say('上次请求：' + d.err, true);
      else if (d && d.ok) say('上次请求：成功（' + (d.model || '') + '）');
      else say('');
    }

    /* 选服务商就把地址与模型名填好，用户只需贴一个 key。 */
    if (vendorSel) {
      vendorSel.onchange = function () {
        var e = ENDPOINTS[vendorSel.value];
        if (!e) return;
        if (baseIn) baseIn.value = e.base;
        if (modelIn) modelIn.value = e.model;
        say('');
      };
    }

    if (saveBtn) {
      saveBtn.onclick = function () {
        var base = (baseIn && baseIn.value || '').trim();
        var model = (modelIn && modelIn.value || '').trim();
        var key = (keyIn && keyIn.value || '').trim();
        if (!base) { say('请填接口地址（选服务商会自动带出）', true); return; }
        if (!model) { say('请填模型名', true); return; }
        if (!key) { say('请填 API Key', true); return; }
        if (!/^https?:\/\//i.test(base)) { say('接口地址要以 http:// 或 https:// 开头', true); return; }
        var ok = saveCfg({
          base: base.replace(/\/+$/, ''), key: key, model: model,
          vendor: (vendorSel && vendorSel.value) || 'custom'
        });
        if (!ok) { say('浏览器不允许写入本地存储（可能是隐私模式），本次有效但不保留', true); }
        else say('已启用。下一句话会先问模型，失败自动回落本地解析。');
        paint();
        if (ok && wrap) wrap.open = false;      // 配好就收起，别挡着对话
      };
    }

    if (clearBtn) {
      clearBtn.onclick = function () {
        saveCfg(null);
        if (baseIn) baseIn.value = '';
        if (modelIn) modelIn.value = '';
        if (keyIn) keyIn.value = '';
        say('已关闭。全部走本地规则解析。');
        paint();
      };
    }

    /* 展开时把上次的诊断结果带出来：CORS 被拦、401、超时，都写在脸上，
       省得用户以为是"模型没生效"。 */
    if (wrap.addEventListener) {
      wrap.addEventListener('toggle', function () { if (wrap.open) paint(); });
    }
    /* 点面板外面收起。target 在 wrap 内（含 summary）就放行，
       所以点 summary 自己不会被这里抢着关掉。 */
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

  window.LLM = {
    VERSION: VERSION,
    ENDPOINTS: ENDPOINTS,
    readCfg: readCfg,
    saveCfg: saveCfg,
    enabled: enabled,
    parse: parse,
    sanitize: sanitize,
    buildPrompt: buildPrompt,
    extractJson: extractJson,
    initPanel: initPanel,
    lastDiag: function () { return lastDiag; },
    /* 测试用：清掉内存缓存，避免用例互相污染 */
    _reset: function () { cache = {}; lastDiag = null; }
  };
})();

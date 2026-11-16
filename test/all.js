#!/usr/bin/env node
/* ============================================================================
 * 一键复跑全部验证脚本 —— node test/all.js
 * ----------------------------------------------------------------------------
 * 逐个启动 test/ 下的验证脚本，汇总结果，任一脚本失败则整体退出码为 1。
 *
 * 判据（同时满足才算通过）：
 *   ① 子进程退出码为 0（脚本自身在断言失败时 exit 1）
 *   ② 输出里没有 "✗"
 *   ③ 输出里没有 "N 失败"（N > 0）
 *   ④ 输出里没有 "异常 N 处"（N > 0）
 *
 * 零依赖：只用 Node 内置模块，不需要 npm install。
 * ========================================================================== */
'use strict';

var spawnSync = require('child_process').spawnSync;
var path = require('path');
var fs = require('fs');

var HERE = __dirname;
var ROOT = path.join(HERE, '..');

var CASES = [
  ['determinism.js',        '确定性：逐字节一致 / 无隐藏状态 / 非预存答案'],
  ['wizard-ui.js',          '向导交互：点选不重建节点（动效不重播）/ 选中回显'],
  ['header-ui.js',          '页头提单行 / 品类带折叠展开（不动 DOM，按钮与 aria 同步）'],
  ['boot-guard.js',         '启动护栏：文件没凑齐时页面自解释，正常打开时无痕'],
  ['time-window.js',        '开放时间解析与时间窗判定'],
  ['dynamic-flow.js',       '「已在路上」界面流程逐级走查'],
  ['spot-guide.js',         '景点攻略卡字段完整性'],
  ['guide-panel.js',        '攻略弹窗链路：入口 / 三层版式 / 关闭'],
  ['cat-visuals.js',        '视觉品类覆盖率与插画零外部引用'],
  ['lunch-split.js',        '午餐切分规则与结果页单行呈现'],
  ['map.js',                '离线地图：底图与真实坐标自洽 / 确定性 / 零外部依赖'],
  ['map-sync.js',           '地图图例与下方时间轴联动：切天同步 / 两入口等价'],
  ['local-taste.js',        '身份维度三档：第一次来看招牌 / 多次来换新鲜 / 本地找小众'],
  ['free-ticket.js',        '免票政策：分时段如实呈现，不改预算与排程口径'],
  ['intent.js',             '自然语言解析：零 DOM / 数据驱动 / 槽位口径与向导同构'],
  ['dialogue.js',           '对话层：攒槽位复用排程，不改输出（同参同果）'],
  ['llm.js',                '大模型适配器：默认关闭 / 只补空 / 失败静默回落'],
  ['search.js',            '外部检索旁注：默认关 / 只查时效问题 / 结果不进排程'],
  ['chat-ui.js',            '对话界面：思考块 / 逐字打印 / 表单入口已收（默认隐藏）'],
  ['credits.js',            '照片素材与授权清单一致性'],
  ['order-independence.js', '打乱数据文件顺序，行程不变'],
  ['base-sensitivity.js',   '驻点坐标平移的敏感性（判读型）']
];

/* 终端显示宽度：中日韩字符按 2 列计，用于对齐表格 */
function dwidth(s) {
  var w = 0;
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    w += (c >= 0x2e80 && c <= 0x9fff) || (c >= 0xff00 && c <= 0xffef) ? 2 : 1;
  }
  return w;
}
function pad(s, n) { return s + new Array(Math.max(0, n - dwidth(s)) + 1).join(' '); }

var failed = 0;
var totalItems = 0;
var rows = [];

console.log('\n复跑验证脚本 · ' + CASES.length + ' 个\n' + new Array(78).join('-'));

CASES.forEach(function (c) {
  var file = c[0], desc = c[1];
  var abs = path.join(HERE, file);

  if (!fs.existsSync(abs)) {
    rows.push([file, '缺失', '-', desc]);
    failed++;
    return;
  }

  var r = spawnSync(process.execPath, [abs], { cwd: ROOT, encoding: 'utf8', timeout: 240000 });
  var out = (r.stdout || '') + (r.stderr || '');
  var crash = r.error || r.status === null;

  var hasCross = /✗/.test(out);
  var mFail = out.match(/(\d+)\s*失败/);
  var mProb = out.match(/异常\s*(\d+)\s*处/);
  var ok = !crash && r.status === 0 && !hasCross &&
           !(mFail && +mFail[1] > 0) && !(mProb && +mProb[1] > 0);

  var items = '-';
  var m1 = out.match(/全部通过（\s*(\d+)\s*项\s*）/);
  var m2 = out.match(/(\d+)\s*通过\s*\/\s*(\d+)\s*失败/);
  if (m1) { items = m1[1] + ' 项'; totalItems += +m1[1]; }
  else if (m2) { items = m2[1] + ' 项'; totalItems += +m2[1]; }

  if (!ok) {
    failed++;
    console.log('');
    console.log('── ' + file + ' 未通过，输出尾部 ──');
    console.log(out.split('\n').slice(-16).join('\n'));
    console.log('');
  }

  rows.push([file, ok ? '通过' : '失败', items, desc]);
});

rows.forEach(function (row) {
  console.log(' ' + (row[1] === '通过' ? '[OK]' : '[!!]') + '  ' +
    pad(row[0], 24) + pad(row[2], 8) + row[3]);
});

/* 派生产物同步检查：源码改了却忘了重新打包，单文件兜底版会悄悄过期 */
var buildScript = path.join(ROOT, 'build-standalone.js');
if (fs.existsSync(buildScript)) {
  var chk = spawnSync(process.execPath, [buildScript, '--check'], { cwd: ROOT, encoding: 'utf8' });
  var syncOk = chk.status === 0;
  if (!syncOk) failed++;
  console.log(' ' + (syncOk ? '[OK]' : '[!!]') + '  ' +
    pad('index-standalone.html', 24) + pad('-', 8) +
    (syncOk ? '单文件兜底版与源码同步' : '已过期：请运行 node build-standalone.js'));
}

console.log(new Array(78).join('-'));
if (failed === 0) {
  console.log('\n全部通过：' + CASES.length + ' 个脚本，' + totalItems + ' 项断言，失败 0\n');
  process.exit(0);
} else {
  console.log('\n有 ' + failed + ' 项检查未通过，请查看上方输出\n');
  process.exit(1);
}

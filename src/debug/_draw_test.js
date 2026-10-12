/* 抽签功能测试：以最小 DOM shim 在 Node 里加载 src/_app_script.js 的真实代码，
   验证 xlsx 解析、列映射、去重、抽取人数计算、随机抽样均匀性与导出。
   样本由 src/debug/_mk_draw_sample.py 生成（data/tmp/draw_sample.xlsx）。 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const APP = path.join(ROOT, 'src', '_app_script.js');
const SAMPLE = path.join(ROOT, 'data', 'tmp', 'draw_sample.xlsx');
const DUP = path.join(ROOT, 'data', 'tmp', 'draw_dup.xlsx');
const BAD = path.join(ROOT, 'data', 'tmp', 'draw_badtpl.xlsx');

let pass = 0, fail = 0;
const fails = [];
function ok(cond, msg, extra) {
  if (cond) { pass++; return; }
  fail++; fails.push(msg);
  console.log('  x ' + msg + (extra === undefined ? '' : '   -> ' + extra));
}
function head(t) { console.log('\n' + t); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- 最小 XML / DOM shim（仅覆盖 _app_script.js 用到的 API） ---------- */
function decEnt(s) {
  return s.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (m, e) => {
    if (e === 'amp') return '&';
    if (e === 'lt') return '<';
    if (e === 'gt') return '>';
    if (e === 'quot') return '"';
    if (e === 'apos') return "'";
    return e[1] === 'x' || e[1] === 'X'
      ? String.fromCodePoint(parseInt(e.slice(2), 16))
      : String.fromCodePoint(parseInt(e.slice(1), 10));
  });
}
function rawParse(str) {
  const root = { tag: '#doc', attrs: {}, children: [], text: '' };
  const stack = [root];
  const re = /<(\/?)([A-Za-z_][\w.:\-]*)((?:\s+[\w.:\-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![\s\S]*?>|([^<]+)/g;
  let m;
  while ((m = re.exec(str))) {
    if (m[5] !== undefined) { stack[stack.length - 1].text += decEnt(m[5]); continue; }
    if (m[2] === undefined) continue;
    if (m[1] === '/') { if (stack.length > 1) stack.pop(); continue; }
    const node = { tag: m[2], attrs: {}, children: [], text: '' };
    const ar = /([\w.:\-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let a;
    while ((a = ar.exec(m[3] || ''))) node.attrs[a[1]] = decEnt(a[2] !== undefined ? a[2] : a[3]);
    stack[stack.length - 1].children.push(node);
    if (!m[4]) stack.push(node);
  }
  return root;
}
function wrap(node) {
  return {
    get tagName() { return node.tag; },
    getAttribute(n) { return node.attrs[n] !== undefined ? node.attrs[n] : null; },
    getAttributeNS(ns, local) {
      for (const k in node.attrs) if (k === local || k.endsWith(':' + local)) return node.attrs[k];
      return null;
    },
    getElementsByTagName(name) {
      const out = [];
      (function walk(n) { for (const c of n.children) { if (c.tag === name) out.push(wrap(c)); walk(c); } })(node);
      return out;
    },
    get textContent() {
      let s = node.text;
      for (const c of node.children) s += wrap(c).textContent;
      return s;
    },
  };
}
class DOMParserShim { parseFromString(str) { return wrap(rawParse(str)); } }

/* ---------- 元素 / 浏览器环境 stub ---------- */
const els = {};
function elStub(id) {
  if (els[id]) return els[id];
  return (els[id] = {
    id, innerHTML: '', textContent: '', className: '', value: '', files: null,
    style: {}, dataset: {},
    classList: { toggle() {}, add() {}, remove() {} },
    addEventListener() {}, appendChild() {}, removeChild() {}, click() {}, select() {},
  });
}
let lastInput = null, elSeq = 0;
const alerts = [];
const documentStub = {
  getElementById: elStub,
  querySelectorAll: () => [],
  addEventListener() {},
  createElement(tag) {
    const e = elStub('__el' + (++elSeq));
    e.tagName = tag;
    if (tag === 'input') lastInput = e;
    return e;
  },
  body: { appendChild() {}, removeChild() {} },
  documentElement: { outerHTML: '<html></html>' },
};
const sandbox = {
  console, setTimeout, clearTimeout, setInterval, clearInterval, performance,
  TextDecoder, TextEncoder, Blob, Response, DecompressionStream, URL,
  Uint8Array, Uint32Array, DataView, ArrayBuffer, crypto: globalThis.crypto,
  DOMParser: DOMParserShim, document: documentStub,
  localStorage: {
    _d: {},
    getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
    setItem(k, v) { this._d[k] = String(v); },
    removeItem(k) { delete this._d[k]; },
  },
  navigator: {}, location: { pathname: '/tool.html' },
  addEventListener() {}, scrollTo() {},
  alert(m) { alerts.push(String(m)); },
  confirm() { return true; },
  requestAnimationFrame(fn) { fn(); },
  indexedDB: { open() { throw new Error('idb unavailable in test'); } },
  BANK: { positions: [{ name: '测试岗', b: [], c: [] }], chapters: [], q: [] },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(APP, 'utf8'), ctx, { filename: '_app_script.js' });
vm.runInContext('globalThis.__T = { get dz(){return dz;}, get dr(){return dr;}, get view(){return view;} };', ctx);
const T = sandbox.__T;

/* ---------- 断言辅助 ---------- */
function selectedOpt(html, call) {
  const i = html.indexOf(call);
  if (i < 0) return null;
  const seg = html.slice(i, html.indexOf('</select>', i));
  const m = seg.match(/<option value="(-?\d+)" selected>/);
  return m ? +m[1] : null;
}
const chips = () => [...elStub('dzPicked').innerHTML.matchAll(/class="dz-chip">([^<]*)/g)].map(m => m[1].trim());

(async function main() {
  if (!fs.existsSync(SAMPLE)) {
    console.log('缺少测试样本，请先运行: python src/debug/_mk_draw_sample.py');
    process.exit(2);
  }

  head('[1] 列号 <-> 列名');
  ok(ctx.dzColIdx('A') === 0, 'A -> 0');
  ok(ctx.dzColIdx('Z') === 25, 'Z -> 25');
  ok(ctx.dzColIdx('AA') === 26, 'AA -> 26');
  ok(ctx.dzColName(0) === 'A', '0 -> A');
  ok(ctx.dzColName(26) === 'AA', '26 -> AA');
  let rt = true;
  for (let i = 0; i < 60; i++) if (ctx.dzColIdx(ctx.dzColName(i)) !== i) rt = false;
  ok(rt, '0..59 列号列名往返一致');

  head('[2] xlsx 解析（真实文件）');
  const b = fs.readFileSync(SAMPLE);
  const file = { name: 'draw_sample.xlsx', arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
  const bd = fs.readFileSync(DUP);
  const dupFile = { name: 'draw_dup.xlsx', arrayBuffer: async () => bd.buffer.slice(bd.byteOffset, bd.byteOffset + bd.byteLength) };
  const bb = fs.readFileSync(BAD);
  const badFile = { name: 'draw_badtpl.xlsx', arrayBuffer: async () => bb.buffer.slice(bb.byteOffset, bb.byteOffset + bb.byteLength) };
  const sheets = await ctx.dzReadXlsx(file);
  ok(sheets.length === 2, '解析出 2 个工作表', sheets.length);
  ok(sheets[0].name === '抽签名单', '工作表名正确（含中文）', sheets[0].name);
  const r0 = sheets[0].rows;
  ok(r0.length >= 43, '行数 >= 43', r0.length);
  ok(r0[0][0] === '部门' && r0[0][1] === '工号' && r0[0][2] === '姓名', '第 1 行标题三列读出', JSON.stringify(r0[0]));
  ok(r0[1][2] === '员工01', '第 2 行姓名读出', r0[1][2]);
  ok(r0[1][1] === '0001', '文本工号保留前导零', r0[1][1]);

  head('[3] 自动识别：第一行是标题、数据从第 2 行开始');
  ctx.dzPickFile();
  ok(lastInput && lastInput.type === 'file', '触发文件选择');
  lastInput.files = [file];
  await lastInput.onchange();
  ok(T.dz && T.dz.mode === 'map', '进入确认名单状态');
  ok(T.dz.head === 2, '数据固定从第 2 行开始，无需手选', T.dz.head);
  ok(T.dz.colName === 2, '按标题文字认出姓名列 = C（姓名）', T.dz.colName);
  ok(T.dz.colNo === 1, '按标题文字认出工号列 = B（工号）', T.dz.colNo);
  ok(T.dz.autoOk === true, '识别成功标记');
  let mh = ctx.vDrawMap();
  ok(mh.indexOf('已按第一行标题识别') >= 0, '界面告知识别结果');
  ok(mh.indexOf('dzSetCol') < 0 && mh.indexOf('dzSetHead') < 0, '界面上没有姓名/工号/起始行的手动设置');
  ok(mh.indexOf('<th>姓名</th>') >= 0 && mh.indexOf('<th>工号</th>') >= 0 && mh.indexOf('<th>部门</th>') >= 0,
    '预览表头显示名单自己的标题，而不是列号');
  ok(mh.indexOf('<th>A</th>') < 0 && mh.indexOf('<th>B</th>') < 0, '预览里不再出现 A/B 列号');
  ok(mh.indexOf('名</i>') < 0 && mh.indexOf('dz-tag') < 0, '已去掉「名 / 号」标记');
  ok(mh.indexOf('<td>部门</td>') < 0 && mh.indexOf('<td>工号</td>') < 0, '标题行不在预览正文里重复出现');
  ok(mh.indexOf('<td>0001</td>') >= 0 && mh.indexOf('<td>员工01</td>') >= 0, '预览正文从数据起始行开始');
  ok(mh.indexOf('共识别到 <b class="num">40</b> 条记录') >= 0, '预览识别 40 条记录（跳过空行与缺工号行）');

  head('[4] 确认导入：跳过空行与缺工号行');
  alerts.length = 0;
  ctx.dzConfirmMap();
  ok(alerts.length === 0, '导入未弹出错误', alerts.join(' | '));
  ok(T.dr.roster.length === 40, '导入 40 人（跳过 1 空行 + 1 行缺工号）', T.dr.roster.length);
  ok(T.dr.roster[0].n === '员工01' && T.dr.roster[0].no === '0001', '首条记录正确', JSON.stringify(T.dr.roster[0]));
  const same = T.dr.roster.filter(p => p.n === '员工01');
  ok(same.length === 2 && same[0].no !== same[1].no, '同名不同工号保留为两个人', JSON.stringify(same));

  head('[4b] 工号重复必须拦截');
  T.dr.roster = [];
  ctx.dzPickFile();
  lastInput.files = [dupFile];
  await lastInput.onchange();
  ctx.dzConfirmMap();
  const dupHtml = ctx.vDrawMap();
  ok(T.dr.roster.length === 0, '工号重复时不导入任何数据', T.dr.roster.length);
  ok(dupHtml.indexOf('工号有重复') >= 0 && dupHtml.indexOf('1001') >= 0, '页面提示出重复的工号');
  ok(dupHtml.indexOf('dz-warn') >= 0, '以警告样式呈现，而不是静默处理');
  ctx.dzCancelMap();

  head('[4c] 第一行不是标题行时应给出提示');
  ctx.dzPickFile();
  lastInput.files = [badFile];
  await lastInput.onchange();
  const bh = ctx.vDrawMap();
  ok(T.dz.autoOk === false, '识别失败', T.dz.autoOk);
  ok(bh.indexOf('没认出') >= 0, '提示没认出姓名和工号列');
  ok(bh.indexOf('下载名单模板') >= 0, '提供下载模板入口');
  ok(/dz-start[^>]*disabled/.test(bh), '识别失败时不能确认导入');
  ctx.dzCancelMap();

  head('[4d] 名单模板：生成后能被自己的解析器读回');
  const tbuf = await ctx.dzTemplateBlob().arrayBuffer();
  const tsh = await ctx.dzReadXlsx({ name: 't.xlsx', arrayBuffer: async () => tbuf });
  ok(tsh.length === 1, '模板是合法 xlsx，能被读回', tsh.length);
  ok(tsh[0].name === '名单', '模板工作表名为「名单」', tsh[0].name);
  ok(tsh[0].rows[0][0] === '姓名' && tsh[0].rows[0][1] === '工号', '模板表头为 姓名 / 工号', JSON.stringify(tsh[0].rows[0]));
  ok(tsh[0].rows[1][0] === '张三' && tsh[0].rows[1][1] === '1001', '模板带示例数据，工号为文本', JSON.stringify(tsh[0].rows[1]));

  head('[5] 抽取人数计算与取整');
  const cases = [
    [37, 30, 'floor', 11], [37, 30, 'ceil', 12], [37, 30, 'round', 11],
    [30, 35, 'floor', 10], [30, 35, 'ceil', 11], [30, 35, 'round', 11],
    [29, 3, 'floor', 0], [29, 3, 'ceil', 1], [29, 3, 'round', 1],
    [10, 100, 'floor', 10], [40, 0.1, 'round', 0],
    [8, 200, 'floor', 8],
  ];
  cases.forEach(c => {
    const t = ctx.dzTarget(c[0], c[1], c[2]);
    ok(t.k === c[3], `${c[0]} 人 x ${c[1]}% ${c[2]} -> ${c[3]} 人`, t.k);
  });
  ok(ctx.dzTarget(40, 30, 'floor').raw === 12, '原始值 40 x 30% = 12', ctx.dzTarget(40, 30, 'floor').raw);
  ok(Math.abs(ctx.dzTarget(37, 30, 'floor').raw - 11.1) < 1e-9, '原始值 37 x 30% = 11.1');
  ok(Math.abs(ctx.dzTarget(30, 35, 'floor').raw - 10.5) < 1e-9, '.5 的原始值保留，四种取整可区分');

  head('[6] 随机抽取：无放回与等概率');
  const pick = ctx.dzShuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]).slice(0, 4);
  ok(new Set(pick).size === 4, '抽出的 4 个互不重复', pick.join(','));
  const perm = ctx.dzShuffle(Array.from({ length: 20 }, (_, i) => i));
  ok(perm.length === 20 && new Set(perm).size === 20, '返回完整排列且无重复');
  const N = 40, K = 10, ROUNDS = 4000, cnt = new Array(N).fill(0);
  for (let i = 0; i < ROUNDS; i++) {
    const r = ctx.dzShuffle(Array.from({ length: N }, (_, j) => j)).slice(0, K);
    for (const v of r) cnt[v]++;
  }
  const exp = ROUNDS * K / N;
  const dev = Math.max(...cnt.map(c => Math.abs(c - exp) / exp));
  ok(dev < 0.12, '4000 轮抽样：每人中签频率偏离期望 < 12%', (dev * 100).toFixed(2) + '%');
  ok(cnt.every(c => c > 0), '无人被系统性排除');

  head('[7] 名单指纹');
  const A = [{ n: '张三', no: '1' }, { n: '李四', no: '2' }];
  const h1 = ctx.dzHash(A), h2 = ctx.dzHash(A);
  ok(h1 === h2, '同一名单指纹稳定');
  ok(h1 !== ctx.dzHash([{ n: '张三', no: '1' }, { n: '李四', no: '3' }]), '工号变化 -> 指纹变化');
  ok(h1 !== ctx.dzHash([{ n: '张三', no: '1' }, { n: '李四', no: '2' }, { n: '王五', no: '3' }]), '增删人员 -> 指纹变化');
  ok(h1 === ctx.dzHash([{ n: '李四', no: '2' }, { n: '张三', no: '1' }]), '名单顺序变化不影响指纹');
  ok(h1 !== ctx.dzHash([{ n: '张三李', no: '42' }, { n: '四', no: '' }]), '条目边界不同 -> 指纹不同');
  ok(/^[0-9A-F]{8}$/.test(h1), '指纹为 8 位十六进制', h1);

  head('[8] CSV 转义');
  ok(ctx.dzCsv('张三') === '张三', '普通值不加引号');
  ok(ctx.dzCsv('张,三') === '"张,三"', '含逗号加引号');
  ok(ctx.dzCsv('张"三') === '"张""三"', '含引号翻倍');
  ok(ctx.dzCsv('') === '' && ctx.dzCsv(null) === '', '空值安全');

  head('[9] 参数边界');
  ctx.dzSetPct('250'); ok(T.dr.pct === 100, '比例上限钳制到 100', T.dr.pct);
  ctx.dzSetPct('-5'); ok(T.dr.pct === 0.1, '比例下限钳制到 0.1', T.dr.pct);
  ctx.dzSetPct('abc'); ok(T.dr.pct === 0.1, '非法输入回落到 0.1', T.dr.pct);
  ctx.dzSetPct('12.5'); ok(T.dr.pct === 12.5, '支持小数比例', T.dr.pct);

  head('[10] 端到端：40 人抽 30% 向下取整');
  ctx.dzPickFile();
  lastInput.files = [file];
  await lastInput.onchange();
  ctx.dzConfirmMap();
  ok(T.dr.roster.length === 40, '重新导入 40 人', T.dr.roster.length);
  T.dr.pct = 30; T.dr.rounding = 'floor';
  ctx.dzEnter();
  ok(T.view === 'draw', '进入抽签视图', T.view);
  const mainHtml = ctx.vDrawMain();
  ok(mainHtml.indexOf('40 × 30% = 12') >= 0, '界面显示算式 40 × 30% = 12');
  ok(mainHtml.indexOf('<b>抽 12 人</b>') >= 0, '界面显示应抽 12 人');
  ok(!/disabled/.test(mainHtml.split('dz-start')[1] || ''), '抽签按钮可用');
  elStub('dzPicked').innerHTML = '';
  ctx.dzStart();
  ctx.dzSkip();
  await sleep(200);
  const names = chips();
  ok(names.length === 12, '中签 12 人', names.length);
  ok(new Set(names).size === 12, '中签名单无重复');
  ok(names.every(n => /^员工\d\d$/.test(n)), '中签者全部来自名单', names.join(','));
  ok(T.dz && T.dz.hash === ctx.dzHash(T.dr.roster), '运行时指纹与当前名单一致', T.dz && T.dz.hash);

  head('[11] 应抽 0 人的拦截');
  T.dr.pct = 0.1; T.dr.rounding = 'floor';
  const zeroHtml = ctx.vDrawMain();
  ok(zeroHtml.indexOf('应抽 <b>0</b> 人') >= 0, '给出 0 人警告');
  ok(/dz-start[^>]*disabled/.test(zeroHtml), '0 人时抽签按钮禁用');
  const before = elStub('dzPicked').innerHTML;
  ctx.dzStart();
  await sleep(20);
  ok(elStub('dzPicked').innerHTML === before, '0 人时不会启动抽签');

  head('[12] 清空名单');
  ctx.dzClear();
  ok(T.dr.roster.length === 0, '名单已清空', T.dr.roster.length);
  ok(ctx.vDrawMain().indexOf('选择文件') >= 0, '回到上传引导界面');

  console.log('\n----------------------------------------');
  console.log(`通过 ${pass} 项，失败 ${fail} 项`);
  if (fail) { console.log('失败项:'); fails.forEach(f => console.log('  - ' + f)); }
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试异常:', e); process.exit(2); });

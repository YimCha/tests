/* 生成试卷功能测试：以最小 DOM shim 在 Node 里加载 src/_app_script.js 的真实代码，
   并注入构建产物中的真实题库（同 src/_test_logic.js 的提取方式）。
   覆盖：组卷口径、组卷正确性、组卷记录 xlsx 导出/读回、按记录重印闭环、
   篡改记录拦截、打印版文档结构与「答案卷不带解析」。 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const APP = path.join(ROOT, 'src', '_app_script.js');

let pass = 0, fail = 0;
const fails = [];
function ok(cond, msg, extra) {
  if (cond) { pass++; return; }
  fail++; fails.push(msg);
  console.log('  x ' + msg + (extra === undefined ? '' : '   -> ' + extra));
}
function head(t) { console.log('\n' + t); }

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
  open() { return { close() {} }; },   // window.open stub：打印窗口在测试里不可见
  BANK: null,
};
if (typeof URL.createObjectURL !== 'function') URL.createObjectURL = () => 'blob:fake';
if (typeof URL.revokeObjectURL !== 'function') URL.revokeObjectURL = () => {};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);

/* ---------- 从构建产物提取真实题库 ---------- */
const outMeta = JSON.parse(fs.readFileSync(path.join(__dirname, '_output.json'), 'utf-8'));
const html = fs.readFileSync(path.join(ROOT, outMeta.file), 'utf-8');
const m = html.match(/const BANK = (.*?);\s*<\/script>/s);
const BANK = JSON.parse(m[1]);
sandbox.BANK = BANK;

vm.runInContext(fs.readFileSync(APP, 'utf8'), ctx, { filename: '_app_script.js' });
vm.runInContext('globalThis.__T = { get paper(){return paper;}, get view(){return view;}, get st(){return st;}, get DEFAULT_TYPES(){return DEFAULT_TYPES;} };', ctx);
const T = sandbox.__T;

function setPaper(p) {
  const iso = JSON.stringify(new Date(p.at).toISOString());
  vm.runInContext(`paper = {at: new Date(${iso}), papers: ${JSON.stringify(p.papers)}}`, ctx);
}
function paperList(pi) { return T.paper.papers.find(p => p.pi === pi).list; }
function fileOf(blob, name) {
  return blob.arrayBuffer().then(b => ({ name, arrayBuffer: async () => b }));
}

(async function main() {
  head('[0] 环境与口径常量');
  ok(BANK.positions.length >= 2, '真题库加载：岗位数 >= 2', BANK.positions.length);
  ok(T.DEFAULT_TYPES.join(',') === '40,25,15', '题型默认口径 40/25/15（与模拟考试一致）', T.DEFAULT_TYPES && T.DEFAULT_TYPES.join(','));
  ok(T.DEFAULT_TYPES.reduce((a, b) => a + b, 0) === 80, '题型合计 80 题');
  ok(typeof ctx.metaTitle === 'function' && ctx.metaTitle().length > 0, '卷头标题取自 config 元数据', ctx.metaTitle());

  head('[1] 抽题口径与模拟考试默认规则一致');
  let ruleOk = true;
  BANK.positions.forEach((pos, pi) => {
    const r = ctx.defaultRule(pi);
    if (r.A !== pos.ratio[0]) ruleOk = false;
    pos.b.forEach((g, i) => { if (r.B[i] !== g[1]) ruleOk = false; });
    pos.c.forEach((g, i) => { if (r.C[i] !== g[1]) ruleOk = false; });
  });
  ok(ruleOk, '每个岗位的默认抽取规则 = 方案配置（A 合集 + B/C 分组目标）');

  head('[2] 组卷正确性：每岗位 10 次');
  const deptOf = qi => BANK.chapters[BANK.q[qi].ch].slice(0, -2);
  let genOk = true, genMsg = '';
  for (let pi = 0; pi < BANK.positions.length && genOk; pi++) {
    const pos = BANK.positions[pi];
    for (let t = 0; t < 10 && genOk; t++) {
      const list = ctx.paperGenOne(pi);
      const tot = list.length;
      if (tot !== 80) { genOk = false; genMsg = `${pos.name} 总题数 ${tot}≠80`; break; }
      if (new Set(list).size !== 80) { genOk = false; genMsg = `${pos.name} 题目有重复`; break; }
      if (!list.every(qi => BANK.q[qi].p.includes(pi))) { genOk = false; genMsg = `${pos.name} 抽到不属于该岗位的题`; break; }
      const s = { A: 0, B: 0, C: 0 }, byB = {}, byC = {};
      list.forEach(qi => {
        const ch = BANK.chapters[BANK.q[qi].ch];
        const c = ch.endsWith('A类') ? 'A' : ch.endsWith('B类') ? 'B' : 'C';
        s[c]++;
        if (c === 'B') byB[deptOf(qi)] = (byB[deptOf(qi)] || 0) + 1;
        if (c === 'C') byC[deptOf(qi)] = (byC[deptOf(qi)] || 0) + 1;
      });
      if (s.A !== pos.ratio[0] || s.B !== pos.ratio[1] || s.C !== pos.ratio[2]) {
        genOk = false; genMsg = `${pos.name} A/B/C ${s.A}/${s.B}/${s.C} ≠ ${pos.ratio.join('/')}`; break;
      }
      for (const g of pos.b) {
        const got = g[0].reduce((a, d) => a + (byB[d] || 0), 0);
        if (got !== g[1]) { genOk = false; genMsg = `${pos.name} B组[${g[0].join('+')}] ${got}≠${g[1]}`; break; }
      }
      if (!genOk) break;
      for (const g of pos.c) {
        const got = g[0].reduce((a, d) => a + (byC[d] || 0), 0);
        if (got !== g[1]) { genOk = false; genMsg = `${pos.name} C组[${g[0].join('+')}] ${got}≠${g[1]}`; break; }
      }
      if (!genOk) break;
    }
  }
  ok(genOk, '6 岗位 × 10 次：80 题无重复、岗位归属、A/B/C 与分组目标全部命中', genMsg);

  head('[3] 生成试卷：排序、结果状态');
  // 模拟考试与试卷共用同一组读值函数：先在 DOM stub 里填好试卷设置（柜员岗默认口径）
  function setPPInputs() {
    const v = (id, val) => { elStub(id).value = String(val); };
    v('pptp0', 40); v('pptp1', 25); v('pptp2', 15);
    v('ppruleA', 30); v('ppruleB0', 40); v('ppruleC0', 5); v('ppruleC1', 5);
  }
  setPPInputs();
  vm.runInContext('st.paperSel = [3, 0, 3]', ctx);   // 乱序 + 重复勾选
  alerts.length = 0;
  ctx.paperGenerate();
  ok(alerts.length === 0, '正常生成无报错', alerts.join(' | '));
  ok(T.paper.papers.map(p => p.pi).join(',') === '0,3', '岗位按岗位表顺序输出（去重）', T.paper.papers.map(p => p.pi).join(','));
  ok(T.paper.papers.every(p => p.list.length === 80), '每套 80 题');
  ok(JSON.stringify(T.st.paperTypes) === JSON.stringify([40, 25, 15]), '生成后题型设置持久化', JSON.stringify(T.st.paperTypes));
  ok(typeof T.paper.at.getTime === 'function', '记录生成时间');

  head('[4] 空勾选拦截');
  vm.runInContext('st.paperSel = []', ctx);
  const keep = T.paper;
  alerts.length = 0;
  ctx.paperGenerate();
  ok(alerts.length === 1 && alerts[0].includes('勾选'), '未勾选岗位时给出提示', alerts[0]);
  ok(T.paper === keep, '空勾选不覆盖已有生成结果');

  head('[4b] 口径合计校验（与模拟考试同一 checkSetup）');
  elStub('pptp2').value = '5';    // 40/25/5 = 70 ≠ 80
  vm.runInContext('st.paperSel = [0]', ctx);
  alerts.length = 0;
  ctx.paperGenerate();
  ok(alerts.length === 1 && alerts[0].includes('题型题量合计需为 80'), '题型合计≠80 拦截', alerts[0]);
  setPPInputs();
  elStub('ppruleA').value = '25';   // 25+40+5+5 = 75 ≠ 80
  alerts.length = 0;
  ctx.paperGenerate();
  ok(alerts.length === 1 && alerts[0].includes('抽取规则合计需为 80'), '规则合计≠80 拦截', alerts[0]);
  setPPInputs();

  head('[5] 组卷记录导出 -> 读回闭环');
  // 以当前生成结果的第一套作为固定基准卷
  const baseList = T.paper.papers[0].list.slice();
  setPaper({ at: new Date('2026-09-22T10:30:00'), papers: [{ pi: 0, list: baseList }] });
  const blob = ctx.paperRecordBlob();
  ok(blob && typeof blob.arrayBuffer === 'function', 'paperRecordBlob 返回 Blob');
  const recFile = await fileOf(blob, '组卷记录_测试.xlsx');
  const sheets = await ctx.dzReadXlsx(recFile);
  ok(sheets.length === 2, '记录含 组卷记录 + 信息 两个工作表', sheets.map(s => s.name).join('/'));
  ok(sheets[0].name === '组卷记录', '第一个工作表名为「组卷记录」', sheets[0].name);
  const rows = sheets[0].rows;
  ok(rows.length === 81, '标题行 + 80 行题目', rows.length);
  ok(JSON.stringify(rows[0]) === JSON.stringify(['岗位', '题型', '卷面题号', '题库题号', '章节', '答案']), '表头六列', JSON.stringify(rows[0]));
  let recOk = true, recMsg = '';
  for (let i = 0; i < 80; i++) {
    const qi = baseList[i], q = BANK.q[qi];
    const r = rows[i + 1];
    if (r[0] !== BANK.positions[0].name) { recOk = false; recMsg = `第${i + 1}题岗位不符`; break; }
    if (r[1] !== ['单选题', '多选题', '判断题'][q.t]) { recOk = false; recMsg = `第${i + 1}题题型不符`; break; }
    if (r[2] !== String(i + 1)) { recOk = false; recMsg = `第${i + 1}题卷面题号不符`; break; }
    if (r[3] !== String(qi + 1)) { recOk = false; recMsg = `第${i + 1}题题库题号不符`; break; }
    if (r[4] !== BANK.chapters[q.ch]) { recOk = false; recMsg = `第${i + 1}题章节不符`; break; }
    if (r[5] !== ctx.paperAnsStr(q)) { recOk = false; recMsg = `第${i + 1}题答案不符`; break; }
  }
  ok(recOk, '记录 80 行的岗位/题型/题号/章节/答案与卷子逐行一致', recMsg);
  const infoRows = sheets[1].rows;
  ok(infoRows[1][0] === '工具标题' && infoRows[1][1] === ctx.metaTitle(), '信息表含工具标题', JSON.stringify(infoRows[1]));

  head('[6] 按记录重印：原样重出同一张卷');
  setPaper({ at: new Date(), papers: [{ pi: 1, list: [0, 1, 2] }] });   // 伪造无关结果，验证导入会覆盖
  ctx.paperImportRecord();
  lastInput.files = [recFile];
  alerts.length = 0;
  await lastInput.onchange();
  ok(alerts.length === 0, '导入无报错', alerts.join(' | '));
  ok(T.paper && T.paper.papers.length === 1 && T.paper.papers[0].pi === 0, '重印后岗位正确', JSON.stringify(T.paper && T.paper.papers.map(p => p.pi)));
  ok(T.paper.papers[0].list.join(',') === baseList.join(','), '重印题号序列与原卷完全一致');

  head('[7] 篡改记录拦截（答案 / 题号 / 岗位 / 顺序）');
  async function importTampered(mut) {
    const rows2 = JSON.parse(JSON.stringify((await ctx.dzReadXlsx(recFile))[0].rows));
    mut(rows2);
    const f = await fileOf(ctx.ppSheetBlob([{ name: '组卷记录', rows: rows2, cols: 6 }]), 't.xlsx');
    lastInput.files = [f];
    alerts.length = 0;
    await lastInput.onchange();
  }
  await importTampered(rows2 => { rows2[5][5] = rows2[5][5] === 'A' ? 'B' : 'A'; });   // 改一行答案
  ok(alerts.length === 1 && alerts[0].includes('答案不符'), '答案被改 -> 拒绝重印', alerts[0]);
  ok(T.paper.papers[0].list.join(',') === baseList.join(','), '拦截后不覆盖当前结果');

  await importTampered(rows2 => { rows2[3][3] = '99999'; });
  ok(alerts.length === 1 && alerts[0].includes('超出题库范围'), '题库题号超界 -> 拒绝重印', alerts[0]);

  await importTampered(rows2 => { rows2[2][0] = '不存在的岗位'; });
  ok(alerts.length === 1 && alerts[0].includes('不存在'), '岗位名对不上 -> 拒绝重印', alerts[0]);

  await importTampered(rows2 => { rows2[10][2] = '99'; });   // 卷面题号改乱
  ok(alerts.length === 1 && alerts[0].includes('不连续'), '卷面题号不连续 -> 拒绝重印', alerts[0]);

  await importTampered(rows2 => { rows2[7][4] = '别的章节'; });
  ok(alerts.length === 1 && alerts[0].includes('章节不符'), '章节与题库不符 -> 拒绝重印', alerts[0]);

  head('[8] 打印版文档结构');
  setPaper({ at: new Date('2026-09-22T10:30:00'), papers: [{ pi: 0, list: baseList }, { pi: 1, list: ctx.paperGenOne(1) }] });
  const doc = ctx.paperPrintHTML();
  ok((doc.match(/class="sheet/g) || []).length === 6, '两岗位 -> 6 个打印分段（空白卷/答题卡/答案卷 × 2）', (doc.match(/class="sheet/g) || []).length);
  ok(doc.includes('@page{size:A4') && doc.includes('page-break-before'), 'A4 分页与分段换页');
  ok(doc.includes('window.print()'), '内嵌自动打印脚本');
  ok(doc.includes(BANK.positions[0].name) && doc.includes(BANK.positions[1].name), '两岗位名称都出现');
  ok(doc.includes('答题卡') && doc.includes('参考答案'), '含答题卡与参考答案部分');
  const firstStem = BANK.q[baseList[0]].s.slice(0, 12);
  ok(doc.includes(firstStem), '含第一题题干文本', firstStem);
  ok(doc.indexOf('解析') < 0, '打印文档中不出现「解析」（答案卷只有题号+答案）');
  ok((doc.match(/class="q"/g) || []).length === 160, '空白卷题块总数 = 2 × 80', (doc.match(/class="q"/g) || []).length);
  const acq = (doc.match(/class="ac-q"/g) || []).length;
  ok(acq === 160, '答题卡题行总数 = 2 × 80', acq);
  const kit = (doc.match(/class="kit"/g) || []).length;
  ok(kit === 160, '答案卷条目总数 = 2 × 80', kit);
  ok(/姓名：＿＿＿＿＿＿/.test(doc) && /工号：＿＿＿＿＿＿/.test(doc), '卷头有姓名/工号填写栏');

  head('[9] 判断题与选项排版');
  const jItem = baseList.map((qi, i) => ({ qi, i })).find(x => BANK.q[x.qi].t === 2);
  const jSeg = doc.slice(doc.indexOf(`>${jItem.i + 1}.`), doc.indexOf(`>${jItem.i + 1}.`) + 600);
  ok(/（　　）/.test(jSeg), '判断题题干后补全角括号');
  const sItem = baseList.map((qi, i) => ({ qi, i })).find(x => BANK.q[x.qi].t === 0);
  const q0 = BANK.q[sItem.qi];
  const maxLen = Math.max(...q0.o.map(t => [...String(t)].length));
  const optSeg = doc.slice(doc.indexOf(`class="qo`), doc.indexOf(`class="qo`) + 400);
  ok(optSeg.includes(`class="qo c${maxLen <= 8 ? '4' : maxLen <= 22 ? '2' : '1'}"`), '选项列数按最长选项自动选择', maxLen);

  head('[10] 视图：setup 与 done');
  vm.runInContext('paper = null; st.paperSel = []; st.paperTypes = null; st.paperRule = null', ctx);
  ctx.paperEnter();
  ok(T.view === 'paper', '进入生成试卷视图', T.view);
  let sv = ctx.vPaper();
  ok(sv.includes('选择岗位') && /disabled/.test(sv.split('paperGenerate')[1] || ''), '未勾选时生成按钮禁用');
  ok(sv.includes('自定义设置') && sv.includes('pptp0'), '含自定义设置面板（题型题量）');
  ok(sv.indexOf('ppruleA') < 0 && sv.includes('只勾选一个岗位'), '未勾选/多岗位时抽取规则锁定为默认口径', 'should not contain ppruleA');
  ctx.paperToggleSel(0);
  ok(JSON.stringify(T.st.paperSel) === JSON.stringify([0]), '勾选状态记录', JSON.stringify(T.st.paperSel));
  sv = ctx.vPaper();
  ok(!/disabled/.test(sv.split('paperGenerate')[1] || ''), '勾选后生成按钮可用');
  ok(sv.includes('1 个岗位'), '按钮显示已勾选岗位数');
  ok(sv.includes('ppruleA') && sv.includes('ppruleTotal'), '单岗位时抽取规则可编辑');
  ctx.paperToggleSel(2);
  sv = ctx.vPaper();
  ok(sv.indexOf('ppruleA') < 0 && sv.includes('各自方案默认口径'), '勾选两个岗位后规则回到默认口径', 'should not contain ppruleA');
  ok(sv.includes('全选') && sv.includes('按记录重印'), '提供全选与按记录重印入口');
  ctx.paperSelAll(true);
  ok(T.st.paperSel.length === BANK.positions.length, '全选覆盖所有岗位');
  ctx.paperSelAll(false);
  ok(T.st.paperSel.length === 0, '清空后为 0');
  setPaper({ at: new Date('2026-09-22T10:30:00'), papers: [{ pi: 0, list: baseList }] });
  const dv = ctx.vPaper();
  ok(dv.includes('打印 / 保存 PDF') && dv.includes('下载组卷记录'), 'done 页提供打印与下载组卷记录');
  ok(dv.includes(BANK.positions[0].name), 'done 页显示岗位');

  head('[11] 记录文件名与 toast');
  let dlName = '';
  documentStub.createElement = function (tag) {
    const e = elStub('__el' + (++elSeq));
    e.tagName = tag;
    if (tag === 'input') lastInput = e;
    if (tag === 'a') { e.click = () => { dlName = e.download || ''; }; }
    return e;
  };
  ctx.paperDownloadRecord();
  ok(/^组卷记录_.+_\d{8}_\d{4}\.xlsx$/.test(dlName), '单岗位下载文件名含岗位与时间戳', dlName);
  ok(dlName.indexOf(BANK.positions[0].name) >= 0, '文件名带岗位名', dlName);

  head('[12] 自定义口径：与模拟考试共用公共层');
  ok(ctx.checkSetup([40, 25, 15], { A: 30, B: [40], C: [5, 5] }) === '', '合法口径通过校验');
  ok(ctx.checkSetup([40, 25, 15], null) === '', '规则为 null（多岗位）跳过规则校验');
  ok(ctx.checkSetup([40, 25, 10], null).includes('题型题量合计需为 80'), '题型合计≠80 报错');
  ok(ctx.checkSetup([40, 25, 15], { A: 30, B: [40], C: [5, 0] }).includes('抽取规则合计需为 80'), '规则合计≠80 报错');

  vm.runInContext('st.paperTypes = [32, 32, 16]; st.paperRule = null', ctx);
  const list32 = ctx.paperGenOne(0);
  ok(list32.length === 80, '自定义题型：总数仍 80');
  const tcnt = [0, 0, 0];
  list32.forEach(qi => tcnt[BANK.q[qi].t]++);
  ok(tcnt.join(',') === '32,32,16', '自定义题型分布生效（32/32/16）', tcnt.join(','));
  ok(new Set(list32).size === 80, '自定义题型下仍无重复题');

  vm.runInContext('st.paperRule = {pi: 0, rule: {A: 40, B: [40], C: [0, 0]}}', ctx);
  const s40 = { A: 0, B: 0, C: 0 };
  let grp40Ok = true;
  ctx.paperGenOne(0).forEach(qi => {
    const ch = BANK.chapters[BANK.q[qi].ch];
    const c = ch.endsWith('A类') ? 'A' : ch.endsWith('B类') ? 'B' : 'C';
    s40[c]++;
    if (c === 'C') grp40Ok = false;   // C 目标 0，不应出现 C 类题
  });
  ok(s40.A === 40 && s40.B === 40 && s40.C === 0, '自定义抽取规则生效（A40/B40/C0）', JSON.stringify(s40));
  ok(grp40Ok, '规则调整为 0 的分组不再出题');
  ok(T.st.paperRule.pi === 0, '自定义规则绑定岗位');

  vm.runInContext('st.paperTypes = null; st.paperRule = null', ctx);
  const listBack = ctx.paperGenOne(0);
  const sBack = { A: 0, B: 0, C: 0 };
  listBack.forEach(qi => {
    const ch = BANK.chapters[BANK.q[qi].ch];
    sBack[ch.endsWith('A类') ? 'A' : ch.endsWith('B类') ? 'B' : 'C']++;
  });
  ok(JSON.stringify(sBack) === JSON.stringify({ A: BANK.positions[0].ratio[0], B: BANK.positions[0].ratio[1], C: BANK.positions[0].ratio[2] }),
    '清掉自定义后回到方案默认口径', JSON.stringify(sBack));

  console.log('\n----------------------------------------');
  console.log(`通过 ${pass} 项，失败 ${fail} 项`);
  if (fail) { console.log('失败项:'); fails.forEach(f => console.log('  - ' + f)); }
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试异常:', e); process.exit(2); });

/* 生成打印版试卷样例（真实题库），输出 data/tmp/paper_preview.html，
   供人工预览「生成试卷」功能的打印版式：空白卷 / 答题卡 / 参考答案。
   产物在 data/tmp/（git 忽略），不进入交付物。 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const APP = path.join(ROOT, 'src', '_app_script.js');

function elStub(id) {
  return { id, innerHTML: '', textContent: '', className: '', value: '', files: null,
    style: {}, dataset: {},
    classList: { toggle() {}, add() {}, remove() {} },
    addEventListener() {}, appendChild() {}, removeChild() {}, click() {}, select() {} };
}
const documentStub = {
  getElementById: elStub, querySelectorAll: () => [], addEventListener() {},
  createElement(t) { return elStub('_' + t + Math.random()); },
  body: { appendChild() {}, removeChild() {} }, documentElement: { outerHTML: '' },
};
const sandbox = {
  console, setTimeout, clearTimeout, TextDecoder, TextEncoder, Blob, Response,
  DecompressionStream, URL, Uint8Array, Uint32Array, DataView, ArrayBuffer,
  crypto: globalThis.crypto, DOMParser: {}, document: documentStub,
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  navigator: {}, location: { pathname: '/x.html' },
  addEventListener() {}, scrollTo() {}, alert() {}, confirm() { return true; },
  requestAnimationFrame(f) { f(); }, indexedDB: { open() { throw 0; } },
  open() { return {}; },
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;

const outMeta = JSON.parse(fs.readFileSync(path.join(__dirname, '_output.json'), 'utf-8'));
const html = fs.readFileSync(path.join(ROOT, outMeta.file), 'utf-8');
sandbox.BANK = JSON.parse(html.match(/const BANK = (.*?);\s*<\/script>/s)[1]);
const ctx = vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(APP, 'utf8'), ctx, { filename: '_app.js' });

// 取前两个岗位出样例卷
vm.runInContext('st.paperSel = [0, 1]; paperGenerate(); paper.at = new Date();', ctx);
const doc = vm.runInContext('paperPrintHTML()', ctx);

const out = path.join(ROOT, 'data', 'tmp', 'paper_preview.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, doc, 'utf-8');
console.log('样例打印文档 ->', out);
const papers = vm.runInContext('paper.papers', ctx);
console.log('岗位:', papers.map(p => sandbox.BANK.positions[p.pi].name).join(' / '),
  '| 每卷', papers[0].list.length, '题');

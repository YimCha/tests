/* ================= 状态 ================= */
const KEY = 'exam_tool_v1';
const TYPES = ['单选题','多选题','判断题'];
const TYPE_SHORT = ['单选','多选','判断'];
const DEFAULT_TYPES = [40,25,15];   // 题型题量默认口径（单选/多选/判断），模拟考试与生成试卷共用
let st = load();
let pools = buildPools();
let view = 'home';

/* 错题本存储：记录跟随本文件（#bankRec），localStorage 仅作实时冗余备份。
   数据存在 HTML 文件本体里：复制/移动文件即带走记录，不同文件天然独立。
   写回文件经 File System Access API 授权（每次打开一次），授权后当次会话自动保存。 */
const PKEY = 'exam_tool_practice_v1';
const MASTER_STREAK = 3;   // 连续答对 N 次视为掌握
const HIGH_FAILS = 2;      // 高频错题阈值（错误次数 >= 此值）
let recSnap = '';          // 当前文件打开时的记录快照，用于恢复时识别副本
let pw = recInit();
let recHandle = null;      // FileSystemFileHandle，用于写回本文件（已授权）
let recPending = null;     // 已保存的句柄，待恢复授权（无需再选文件）
let recDirty = false;      // 有未写回的变更
let recTimer = 0;          // 防抖定时器

function recInit(){
  let d = {};
  try{ const el = document.getElementById('bankRec');
    if(el && el.textContent){
      recSnap = el.textContent.trim();
      d = JSON.parse(recSnap) || {};
    } }catch(e){ d = {}; }
  // 旧版本数据迁移：文件内记录为空时取 localStorage 备份
  if(!Object.keys(d).length){
    try{ const ls = JSON.parse(localStorage.getItem(PKEY)); if(ls && typeof ls==='object') d = ls; }catch(e){}
  }
  return d;
}
function pSave(){
  localStorage.setItem(PKEY, JSON.stringify(pw));   // 冗余备份
  if(!recDirty){ recDirty = true; clearTimeout(recTimer);
    recTimer = setTimeout(()=>{ recDirty = false; saveRecToFile(); }, 800); }
  updateRecBar();
}

/* ---- 写回本文件（File System Access API，Chromium 专属） ---- */
function recDB(){ return new Promise((res, rej)=>{
  const req = indexedDB.open('exam_tool_rec_v1', 1);
  req.onupgradeneeded = ()=> req.result.createObjectStore('kv');
  req.onsuccess = ()=> res(req.result);
  req.onerror = ()=> rej(req.error);
});}
function recDBGet(db, key){ return new Promise((res, rej)=>{
  const t = db.transaction('kv','readonly').objectStore('kv').get(key);
  t.onsuccess = ()=> res(t.result); t.onerror = ()=> rej(t.error);
});}
function recDBPut(db, key, val){ return new Promise((res, rej)=>{
  const t = db.transaction('kv','readwrite').objectStore('kv').put(val, key);
  t.onsuccess = ()=> res(); t.onerror = ()=> rej(t.error);
});}
/* 校验句柄是否属于当前文件：构建指纹一致 + 文件名一致（防复制副本/换版本误写旧文件） */
function recMetaOK(meta, name){
  if(!meta) return false;
  if(typeof FILE_ID === 'undefined' || meta.id !== FILE_ID) return false;
  if(meta.name && name && meta.name !== name) return false;
  return true;
}
function recFileName(){ try{ return decodeURIComponent(location.pathname.split('/').pop() || ''); }catch(e){ return ''; } }
async function recRestore(){
  // 打开时找回上次授权的句柄：校验属于当前文件且权限有效则直接开启；否则回退首次开启流程
  try{
    const db = await recDB();
    const [h, meta] = await Promise.all([recDBGet(db, 'handle'), recDBGet(db, 'meta')]);
    if(h && h.kind==='file' && recMetaOK(meta, recFileName())){
      if(await h.queryPermission({mode:'readwrite'}) === 'granted'){ recHandle = h; }
      else recPending = h;
      updateRecBar();
      return;
    }
    // 句柄属于其他文件/版本，清除避免误用
    try{ await recDBPut(db, 'handle', null); await recDBPut(db, 'meta', null); }catch(e){}
  }catch(e){}
  updateRecBar();
}
async function resumeRecSave(){
  // 已持有文件句柄，只需重新授予修改权限（不弹文件选择器）
  if(!recPending) return;
  try{
    // 自动检查：句柄文件内嵌记录与本文件不一致 -> 疑似复制副本，拦截并引导重新选择
    const f = await recPending.getFile();
    const text = await f.text();
    const m = text.match(/<script id="bankRec" type="application\/json">([\s\S]*?)<\/script>/);
    const other = m ? m[1].trim() : '';
    if(other && other !== recSnap){
      if(!confirm('检测到上次授权的文件与本文件的刷题记录不一致，可能是在使用复制的新副本。\n为避免写错文件：点「确定」改用「重新选择文件」指向当前文件；点「取消」则不恢复。')){
        recPending = null; updateRecBar(); return;
      }
      recPending = null; updateRecBar();
      enableRecSave(); return;
    }
    const ok = await recPending.queryPermission({mode:'readwrite'}) === 'granted'
      || await recPending.requestPermission({mode:'readwrite'}) === 'granted';
    if(ok){
      recHandle = recPending; recPending = null; updateRecBar();
      await saveRecToFile();
    }
  }catch(e){ recPending = null; updateRecBar(); }   // 句柄失效（文件移动/删除），回退首次开启流程
}
async function enableRecSave(){
  if(!window.showOpenFilePicker) return;
  const hint = '即将弹出系统窗口，请选择你正在使用的这个 HTML 文件本身（保持原位置，不要另存新文件）。\n\n选择后浏览器会询问「是否允许修改该文件」，点「允许」即完成开启，之后答题将自动保存到该文件。';
  if(!confirm(hint)) return;
  try{
    const [h] = await window.showOpenFilePicker({
      types: [{description:'HTML', accept:{'text/html':['.html']}}],
    });
    // 浏览器权限提示：允许修改所选文件（= 启动自动保存的确认）
    const p = await h.queryPermission({mode:'readwrite'});
    if(p !== 'granted'){
      if(await h.requestPermission({mode:'readwrite'}) !== 'granted') return;
    }
    recHandle = h;
    const db = await recDB(); await recDBPut(db, 'handle', h);
    await recDBPut(db, 'meta', {id: FILE_ID, name: h.name});   // 记录身份，供下次恢复校验
    updateRecBar();
    await saveRecToFile();   // 授权后立即落盘一次
  }catch(e){ /* 用户取消选择/授权 */ }
}
function recHTML(){
  const el = document.getElementById('bankRec');
  if(el) el.textContent = JSON.stringify(pw);
  return '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
}
async function saveRecToFile(){
  if(!recHandle) return false;
  try{
    const w = await recHandle.createWritable();
    await w.write(recHTML());
    await w.close();
    updateRecBar();
    return true;
  }catch(e){ return false; }
}
async function recFlush(){ if(recDirty){ recDirty = false; clearTimeout(recTimer); return saveRecToFile(); } return false; }
function exportRec(){
  const blob = new Blob([JSON.stringify(pw, null, 1)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '刷题记录备份.json';
  a.click();
}
function importRec(){
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.json,application/json';
  inp.onchange = ()=>{
    const f = inp.files[0]; if(!f) return;
    const rd = new FileReader();
    rd.onload = ()=>{
      try{
        const d = JSON.parse(rd.result);
        if(d && typeof d==='object'){ pw = d; pSave(); alert('导入成功'); }
      }catch(e){ alert('文件格式不正确'); }
    };
    rd.readAsText(f);
  };
  inp.click();
}
function recBarHTML(){
  const common = `<button class="btn ghost" onclick="clearRec()">清空记录</button>
    <button class="btn ghost" onclick="exportRec()">导出</button>
    <button class="btn ghost" onclick="importRec()">导入</button>`;
  if(recHandle) return `
    <span class="rb-ok">✓ 自动保存已开启${recHandle.name?' · '+recHandle.name:''}</span>${common}`;
  if(recPending) return `
    <span>已找到本文件 · <b>点「恢复」即可继续自动保存</b></span>
    <button class="btn primary" onclick="resumeRecSave()">恢复自动保存</button>
    <button class="btn ghost" onclick="enableRecSave()">重新选择文件</button>${common}`;
  if(window.showOpenFilePicker) return `
    <span>记录跟随本文件 · <b>开启后答题自动保存到文件</b></span>
    <button class="btn primary" onclick="enableRecSave()">开启自动保存</button>${common}`;
  return `<span>当前浏览器不支持写回文件</span>${common}`;
}
function clearRec(){
  if(!confirm('将清空全部岗位的刷题记录（错误次数、掌握状态等），并写回本文件，不可恢复。确定清空？')) return;
  pw = {};
  pSave();
  render();
}
function updateRecBar(){
  const el = document.getElementById('recBar');
  if(el) el.innerHTML = recBarHTML();
}
window.addEventListener('load', recRestore);
window.addEventListener('pagehide', ()=>{ recFlush(); });

function load(){
  try{ const d = JSON.parse(localStorage.getItem(KEY));
    return Object.assign({pos:0, types:DEFAULT_TYPES.slice(), rule:null, dur:60, mode:'exam'}, d);
  }catch(e){ return {pos:0, types:DEFAULT_TYPES.slice(), rule:null, dur:60, mode:'exam'}; }
}
function save(){ localStorage.setItem(KEY, JSON.stringify(st)); }

/* ================= 数据：岗位 -> 题库池 ================= */
function buildPools(){
  return BANK.positions.map((_,pi)=>{
    const A=[],B=[],C=[];
    BANK.q.forEach((q,qi)=>{
      if(!q.p.includes(pi)) return;
      const ch = BANK.chapters[q.ch];
      if(ch.endsWith('A类')) A.push(qi);
      else if(ch.endsWith('B类')) B.push(qi);
      else C.push(qi);
    });
    return {A,B,C, all:[...A,...B,...C]};
  });
}
function poolFor(pi){ return pools[pi]; }
function qAt(i){ return BANK.q[i]; }
function shuffle(a){ a=[...a]; for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; }

/* ================= 渲染骨架 ================= */
const app = document.getElementById('app');
app.addEventListener('click', e=>{
  const el = e.target.closest ? e.target.closest('.opt') : null;
  if(el) onOptClick(el);
});
function go(v){ view=v; render(); window.scrollTo({top:0}); }

function render(){
  let html='';
  if(view==='home') html = vHome();
  else if(view==='exam') html = vExam();
  else if(view==='practice') html = vPractice();
  else if(view==='wrong') html = vWrong();
  else if(view==='draw') html = vDraw();
  else if(view==='paper') html = vPaper();
  app.innerHTML = html;
  app.classList.toggle('wide', (view==='exam' && !exam) || view==='practice' || view==='wrong' || view==='draw' || view==='paper');
  if(view==='exam' && exam) drawExam();
  if(view==='practice' && practice && !practice.done) drawPractice();
  bindGlobal();
  updateRecBar();
}
function setPos(i){
  st.pos=i; st.rule=null; st.punits=null; st.ptypes=null; save();
  go(st.mode==='wrong' ? 'wrong' : (st.mode==='practice' ? 'practice' : 'exam'));
}
function setMode(m){ st.mode=m; save(); render(); }

/* ================= 首页 ================= */
function vHome(){
  const tabs = [['exam','模拟考试'],['practice','刷题练习'],['wrong','错题本']].map(t=>
    `<button class="top-tab ${st.mode===t[0]?'on':''}" onclick="setMode('${t[0]}')">${t[1]}</button>`).join('')
    + `<button class="top-tab tab-far" onclick="paperEnter()">生成试卷</button><button class="top-tab" onclick="dzEnter()">抽签</button>`;
  const title = {exam:'请选择考试岗位', practice:'选择岗位 · 刷题练习', wrong:'选择岗位 · 错题本'}[st.mode];
  let cards;
  if(st.mode==='wrong'){
    cards = BANK.positions.map((p,i)=>{
      const n = wrongCount(i), act = wrongAct(i), ok = wrongOK(i);
      return `
      <div class="card pos-card ${i===st.pos?'on':''}" onclick="setPos(${i})">
        <div class="pc-head"><div class="pc-check">✓</div>
          <div class="pc-name">${p.name}</div>
          <div class="pc-num">${n}<small>错题</small></div></div>
        <div class="pc-stats"><span>待复习 <b class="num">${act}</b><em>题</em></span>
          <span>已掌握 <b class="num">${ok}</b><em>题</em></span></div>
      </div>`;
    }).join('');
  } else {
    cards = BANK.positions.map((p,i)=>{
      const pool = poolFor(i);
      const cls = {A:pool.A.length, B:pool.B.length, C:pool.C.length};
      const tot = cls.A+cls.B+cls.C;
      const w = {A:cls.A/tot*100, B:cls.B/tot*100, C:cls.C/tot*100};
      return `
      <div class="card pos-card ${i===st.pos?'on':''}" onclick="setPos(${i})">
        <div class="pc-head">
          <div class="pc-check">✓</div>
          <div class="pc-name">${p.name}</div>
          <div class="pc-num">${tot}<small>题</small></div>
        </div>
        <div class="bar3">
          <i class="ba" style="width:${w.A}%"></i>
          <i class="bb" style="width:${w.B}%"></i>
          <i class="bc" style="width:${w.C}%"></i>
        </div>
        <div class="pc-stats">
          <span><i style="background:var(--a)"></i>A类 <b>${cls.A}</b><em>题</em></span>
          <span><i style="background:var(--b)"></i>B类 <b>${cls.B}</b><em>题</em></span>
          <span><i style="background:var(--c)"></i>C类 <b>${cls.C}</b><em>题</em></span>
        </div>
      </div>`;
    }).join('');
  }
  return `
  <div class="top-tabs">${tabs}</div>
  <div class="sec-title"><span class="diamond"></span><h2>${title}</h2></div>
  <div class="grid c3">${cards}</div>`;
}

/* ================= 答题交互 ================= */
function onOptClick(el){
  const qi = +el.dataset.qi;
  if(view==='exam' && exam && !exam.done) toggleExamSelect(qi, el);
  else if(view==='practice' && practice && !practice.done && !practice.st[qi]) practicePick(qi, el);
}
function bindGlobal(){
  requestAnimationFrame(()=>{
    document.querySelectorAll('.bar-row i[data-w]').forEach(el=>{ el.style.width=el.dataset.w+'%'; });
  });
}

/* ================= 模拟考试 ================= */
const OUTER_NOTE = '正式考试满分 100 分＝题库内 80 分＋题库外 20 分。题库外题目本工具无法练习，此处仅模拟题库内 80 分。';
const CLS_INFO = {A:'#d8a75c', B:'#6aa7dd', C:'#5fc3a2'};
let exam = null;
let examLoopId = 0;

function clsOf(qi){ const ch = BANK.chapters[qAt(qi).ch]; return ch.endsWith('A类')?'A':(ch.endsWith('B类')?'B':'C'); }
function deptOf(qi){ const ch = BANK.chapters[qAt(qi).ch]; return ch.slice(0,-2); }

// 把 total 按 weights 比例拆成整数，四舍五入并保证合计=total
function splitByWeight(total, weights){
  const sum = weights.reduce((a,b)=>a+b,0);
  const raw = weights.map(w=>total*w/sum);
  const res = raw.map(Math.floor);
  let left = total - res.reduce((a,b)=>a+b,0);
  const order = raw.map((v,i)=>({i, f:v-res[i]})).sort((a,b)=>b.f-a.f);
  for(let k=0; left>0; k++){ res[order[k%order.length].i]++; left--; }
  return res;
}
// 生成 [题型×抽题单元] 目标矩阵：每题型合计=types，每单元合计=其方案题数
function genMatrix(types, unitTargets){
  const total = types.reduce((a,b)=>a+b,0);
  const M = types.map(()=>unitTargets.map(()=>0));
  const cells = [];
  types.forEach((_,t)=>unitTargets.forEach((_,c)=>{
    const e = types[t]*unitTargets[c]/total;
    M[t][c] = Math.floor(e);
    cells.push({t, c, f:e-Math.floor(e)});
  }));
  const rowLeft = types.map((n,t)=>n-M[t].reduce((a,b)=>a+b,0));
  const colLeft = unitTargets.map((n,c)=>n-types.reduce((a,_,t)=>a+M[t][c],0));
  let left = rowLeft.reduce((a,b)=>a+b,0);
  cells.sort((a,b)=>b.f-a.f);
  for(let k=0; left>0; k++){
    const cell = cells[k%cells.length];
    if(rowLeft[cell.t]>0 && colLeft[cell.c]>0){ M[cell.t][cell.c]++; rowLeft[cell.t]--; colLeft[cell.c]--; left--; }
  }
  return M;
}
function genPaper(pi, types, rule){
  const pos = BANK.positions[pi], pool = poolFor(pi);
  const units = [{pool:pool.A, target:rule.A}];
  pos.b.forEach((g,i)=>units.push({pool:pool.B.filter(qi=>g[0].includes(deptOf(qi))), target:rule.B[i]}));
  pos.c.forEach((g,i)=>units.push({pool:pool.C.filter(qi=>g[0].includes(deptOf(qi))), target:rule.C[i]}));
  const M = genMatrix(types, units.map(u=>u.target));
  const paper = [];
  // 单元内跨题型共享已用集合（本行抽中立即登记）：某题型不足补抽其他题型时，绝不与已抽的题重复
  units.forEach((u,c)=>{
    const used = new Set();
    types.forEach((_,t)=>{
      const n = M[t][c];
      if(n <= 0) return;
      const r = shuffle(u.pool.filter(qi=>!used.has(qi) && qAt(qi).t===t)).slice(0, n);
      r.forEach(qi=>used.add(qi));
      if(r.length < n)
        r.push(...shuffle(u.pool.filter(qi=>!used.has(qi))).slice(0, n - r.length));
      r.forEach(qi=>used.add(qi));
      paper.push(...r);
    });
  });
  return paper.sort((x,y)=>qAt(x).t - qAt(y).t);
}

/* ===== 组卷设置（模拟考试与生成试卷共用的单源逻辑） =====
   默认口径、设置行渲染、读值、合计校验都在这里，两边只传各自的 DOM id 前缀：
   模拟考试沿用无前缀 id（tp0 / ruleA / ruleTotal...），生成试卷用 'pp' 前缀，互不干扰。
   调整口径或校验规则时改这里即可，两个入口同时生效。 */
function defaultRule(pi){
  const pos = BANK.positions[pi];
  return {A: pos.ratio[0], B: pos.b.map(g=>g[1]), C: pos.c.map(g=>g[1])};
}
/* 各设置面板注册表：id 前缀 -> {pi: 当前岗位下标}。模拟考试在 vExamSetup 注册 ''，试卷注册 'pp' */
const SETUP_PANELS = {};
function numVal(el){ return el ? Math.max(0, Math.round(+el.value)||0) : 0; }
/* 抽取规则行：A 合集 + B/C 部门组，每行 − 输入框 + */
function ruleRowsHTML(pos, rule, p){
  const row = (id, name, val, c)=>`
    <div class="tp-row">
      ${c?`<span class="rp-tag" style="--c:${CLS_INFO[c]}">${c}</span>`:''}
      <span class="tp-name">${name}</span>
      <button class="tp-btn" onclick="adjustNum('${id}',-1,'${p}')">−</button>
      <input class="tp-num num" id="${id}" type="number" value="${val}" min="0" oninput="onSetupInput('${p}')">
      <button class="tp-btn" onclick="adjustNum('${id}',1,'${p}')">+</button>
    </div>`;
  return [
    row(p+'ruleA', '所有部门 A 类题合集', rule.A, 'A'),
    ...pos.b.map((g,i)=>row(p+'ruleB'+i, grpText(g), rule.B[i], 'B')),
    ...pos.c.map((g,i)=>row(p+'ruleC'+i, grpText(g), rule.C[i], 'C')),
  ].join('');
}
/* 题型题量行：单选/多选/判断 */
function typeRowsHTML(types, p){
  return TYPES.map((n,t)=>`
    <div class="tp-row">
      <span class="tp-name">${n}</span>
      <button class="tp-btn" onclick="adjustNum('${p}tp${t}',-1,'${p}')">−</button>
      <input class="tp-num num" id="${p}tp${t}" type="number" value="${types[t]}" min="0" oninput="onSetupInput('${p}')">
      <button class="tp-btn" onclick="adjustNum('${p}tp${t}',1,'${p}')">+</button>
    </div>`).join('');
}
function readTypeInputs(p){ return [0,1,2].map(i=>numVal(document.getElementById(p+'tp'+i))); }
function readRuleInputs(p, pi){
  const pos = BANK.positions[pi];
  return {
    A: numVal(document.getElementById(p+'ruleA')),
    B: pos.b.map((_,i)=>numVal(document.getElementById(p+'ruleB'+i))),
    C: pos.c.map((_,i)=>numVal(document.getElementById(p+'ruleC'+i))),
  };
}
function ruleTotalOf(rule){ return rule.A + rule.B.reduce((a,b)=>a+b,0) + rule.C.reduce((a,b)=>a+b,0); }
/* 面板合计行实时刷新；各入口自己的联动写在 onSetupInput 的分支里 */
function syncPanelTotal(p){
  const tEl = document.getElementById(p+'tpTotal');
  if(tEl) tEl.textContent = readTypeInputs(p).reduce((a,b)=>a+b,0);
  const rEl = document.getElementById(p+'ruleTotal');
  if(rEl){
    const reg = SETUP_PANELS[p];
    if(reg) rEl.textContent = ruleTotalOf(readRuleInputs(p, reg.pi()));
  }
}
function onSetupInput(p){
  syncPanelTotal(p);
  if(p === '' && view === 'exam') updateInfoCard();
}
function adjustNum(id, d, p){
  const el = document.getElementById(id);
  if(!el) return;
  const v = (+el.value||0)+d;
  if(v<0) return;
  el.value = v;
  onSetupInput(p);
}
/* 合计校验：题型题量必须合计 80；规则传 null 时跳过规则校验（多岗位各自默认口径） */
function checkSetup(types, rule){
  const tt = types.reduce((a,b)=>a+b,0);
  if(tt !== 80) return `题型题量合计需为 80 题（当前 ${tt}）`;
  if(rule){
    const rt = ruleTotalOf(rule);
    if(rt !== 80) return `抽取规则合计需为 80 题（当前 ${rt}）`;
  }
  return '';
}
function togglePanel(panelId, arrowId){
  const p = document.getElementById(panelId);
  if(!p) return;
  const on = p.style.display !== 'none';
  p.style.display = on ? 'none' : 'block';
  const a = document.getElementById(arrowId);
  if(a) a.textContent = on ? '▸' : '▾';
}
function adjustDur(d){
  const el = document.getElementById('durInput');
  const v = (+el.value||0)+d;
  if(v<1) return;
  el.value = v; syncDur();
}
function syncDur(){
  const el = document.getElementById('durInput');
  st.dur = Math.max(1, Math.round(+el.value)||1);
  save();
  updateInfoCard();
}
function startExam(){
  const types = readTypeInputs('');
  const rule = readRuleInputs('', st.pos);
  const err = checkSetup(types, rule);
  if(err){ alert(err); return; }
  st.types = types; st.rule = rule; syncDur(); save();
  exam={paper:genPaper(st.pos, types, rule), rule, cur:0, ans:{}, mark:{}, start:Date.now(), dur:st.dur*60, done:false};
  go('exam');
  examTimerLoop();
}
function vExam(){
  if(!exam) return vExamSetup();
  if(exam.done) return vExamResult();
  return vExamRun();
}
function grpText(g){ return g[0].length>1 ? g[0].join(' + ') : g[0][0]; }
function vExamSetup(){
  const pos = BANK.positions[st.pos];
  const rule = st.rule || defaultRule(st.pos);
  const rA = rule.A, rB = rule.B.reduce((a,b)=>a+b,0), rC = rule.C.reduce((a,b)=>a+b,0);
  SETUP_PANELS[''] = {pi: ()=>st.pos};
  const ruleRows = ruleRowsHTML(pos, rule, '');
  const tpRows = typeRowsHTML(st.types, '');
  return `
  <div class="exam-setup card">
    <div class="seal-ring" style="margin:0 auto 6px">卷</div>
    <div class="es-title">模拟考试 · ${pos.name}</div>
    <div class="es-notice">${OUTER_NOTE}</div>
    <div class="info-card">
      <div class="ic-head">
        <span class="ic-name">${pos.name}</span>
        <span class="ic-total">共 <b id="icTotal" class="num">${rA+rB+rC}</b> 题 · 满分 <b class="num">80</b> 分</span>
      </div>
      <div class="ic-grid">
        <div class="ic-cell"><span>限时</span><b id="icDur" class="num">${st.dur}</b> 分钟</div>
        <div class="ic-cell"><span>题型</span><b id="icTypes" class="num">${st.types.map((n,t)=>TYPE_SHORT[t]+n).join(' · ')}</b></div>
        <div class="ic-cell"><span>分值</span><b id="icRule" class="num">A类${rA}题 · B类${rB}题 · C类${rC}题</b></div>
      </div>
    </div>
    <div class="setup-toggle" onclick="toggleSetup()">
      <span class="st-t">自定义设置</span>
      <span class="st-sub">默认按《实施方案》，可调整</span>
      <span class="st-arrow" id="stArrow">▾</span>
    </div>
    <div id="setupPanel" class="setup-panel" style="display:none">
      <div class="es-sec">抽取规则</div>
      <div class="type-panel">
        ${ruleRows}
        <div class="tp-total">合计 <b id="ruleTotal" class="num">${rA+rB+rC}</b> 题</div>
      </div>
      <div class="es-sec">题型题量</div>
      <div class="type-panel">
        ${tpRows}
        <div class="tp-total">合计 <b id="tpTotal" class="num">${st.types.reduce((a,b)=>a+b,0)}</b> 题</div>
      </div>
      <div class="es-sec">考试时长</div>
      <div class="type-panel">
        <div class="tp-row">
          <span class="tp-name">限时答题</span>
          <button class="tp-btn" onclick="adjustDur(-1)">−</button>
          <input class="tp-num num" id="durInput" type="number" value="${st.dur}" min="1" oninput="syncDur()">
          <button class="tp-btn" onclick="adjustDur(1)">+</button>
          <span class="tp-unit">分钟</span>
        </div>
      </div>
    </div>
    <div class="es-actions">
      <button class="btn ghost" onclick="go('home')">重新选择岗位</button>
      <button class="btn primary" onclick="startExam()">开始考试</button>
    </div>
  </div>`;
}
function toggleSetup(){ togglePanel('setupPanel', 'stArrow'); }
function updateInfoCard(){
  const pos = BANK.positions[st.pos];
  const rule = st.rule || {A:pos.ratio[0], B:pos.b.map(g=>g[1]), C:pos.c.map(g=>g[1])};
  const rA=rule.A, rB=rule.B.reduce((a,b)=>a+b,0), rC=rule.C.reduce((a,b)=>a+b,0);
  const el = document.getElementById('icTotal'); if(el) el.textContent = rA+rB+rC;
  const ed = document.getElementById('icDur'); if(ed) ed.textContent = st.dur;
  const et = document.getElementById('icTypes'); if(et) et.textContent = st.types.map((n,t)=>TYPE_SHORT[t]+n).join(' · ');
  const er = document.getElementById('icRule'); if(er) er.textContent = `A类${rA}题 · B类${rB}题 · C类${rC}题`;
}
function vExamRun(){
  return `
  <div class="exam-topbar">
    <button class="btn ghost" onclick="exitExam()">← 返回岗位选择</button>
    <div class="et-info">
      <span class="exam-timer" id="examTimer">00:00:00</span>
      <span class="exam-pos">第 <b class="num">1</b> / 80 题</span>
      <span class="exam-done">已答 <b class="num">0</b> · 未答 <b class="num">80</b> · 标记 <b class="num">0</b></span>
    </div>
  </div>
  <div id="examBox"></div>
  <div class="card exam-navcard">
    <div class="exam-legend">
      <span><i class="lg-done"></i>已答</span>
      <span><i class="lg-cur"></i>当前</span>
      <span><i class="lg-mark"></i>标记</span>
    </div>
    <div class="exam-nav" id="examNav"></div>
  </div>
  <div class="card exam-statcard" id="examStat"></div>`;
}
function exitExam(){
  if(!confirm('退出后本次答题进度将丢失，确定返回岗位选择？')) return;
  examLoopId++;
  exam = null;
  go('home');
}
function drawExam(){
  if(!exam || exam.done) return;
  const qi = exam.paper[exam.cur], q = qAt(qi);
  document.getElementById('examBox').innerHTML = qCard(qi,{n:exam.cur+1,total:exam.paper.length,instant:false,lock:false,
    sel:exam.ans[qi]||[], chapName:BANK.chapters[q.ch], exam:true});
  document.getElementById('examNav').innerHTML = exam.paper.map((qj,i)=>navBtn(i)).join('');
  updateExamHead(); syncTimer(); drawStatCard();
  bindGlobal();
}
function statCardHTML(){
  const pos = BANK.positions[st.pos];
  const rule = exam.rule;
  const total = exam.paper.length;
  const bTarget = rule.B.reduce((a,b)=>a+b,0);
  const cTarget = rule.C.reduce((a,b)=>a+b,0);
  const aCnt = exam.paper.filter(qi=>clsOf(qi)==='A').length;
  const bGroups = pos.b.map((g,i)=>({sub:grpText(g), target:rule.B[i],
    cnt:exam.paper.filter(qi=>clsOf(qi)==='B'&&g[0].includes(deptOf(qi))).length}));
  const bCnt = bGroups.reduce((a,b)=>a+b.cnt,0);
  const cGroups = pos.c.map((g,i)=>({sub:grpText(g), target:rule.C[i],
    cnt:exam.paper.filter(qi=>clsOf(qi)==='C'&&g[0].includes(deptOf(qi))).length}));
  const cCnt = cGroups.reduce((a,b)=>a+b.cnt,0);
  const bar = (cnt, cls) => `<div class="rp-bar"><i style="width:${total?(cnt/total*100).toFixed(1):0}%;background:${CLS_INFO[cls]}"></i></div>`;
  const catRow = (cls, name, cnt, target) => `
    <div class="rp-cat">
      <span class="rp-tag" style="--c:${CLS_INFO[cls]}">${cls}类</span>
      <div class="rp-main">${bar(cnt,cls)}<div class="rp-sub">${name}</div></div>
      <span class="rp-pt num">${cnt}<small> 题 / 要求 ${target} 题</small></span>
    </div>`;
  const grpRow = (cls, sub, cnt, target) => `
    <div class="rp-row rp-subrow">
      <span class="rp-tag" style="--c:${CLS_INFO[cls]}">${cls}</span>
      <div class="rp-main">${bar(cnt,cls)}<div class="rp-sub">${sub}</div></div>
      <span class="rp-pt num">${cnt}<small> 题 / 要求 ${target} 题</small></span>
    </div>`;
  const rows = [
    catRow('A', '所有部门合集', aCnt, rule.A),
    catRow('B', 'B类合计', bCnt, bTarget),
    ...bGroups.map(g=>grpRow('B', g.sub, g.cnt, g.target)),
    catRow('C', 'C类合计', cCnt, cTarget),
    ...cGroups.map(g=>grpRow('C', g.sub, g.cnt, g.target)),
  ].join('');
  return `
  <div class="es-sec">本次实际抽取（共 ${total} 题）</div>
  <div class="ratio-panel">${rows}</div>`;
}
function drawStatCard(){
  const el = document.getElementById('examStat');
  if(el && exam && !exam.done) el.innerHTML = statCardHTML();
}
function syncTimer(){
  const el = document.getElementById('examTimer');
  if(el && exam && !exam.done){
    const left = exam.dur - Math.floor((Date.now()-exam.start)/1000);
    el.textContent = fmtTime(Math.max(0,left));
    el.classList.toggle('warn', left<=300);
  }
}
const TYPE_COLORS=['#d8a75c','#6aa7dd','#5fc3a2'];
function navBtn(i){
  const qi = exam.paper[i], t = qAt(qi).t;
  const stt=[];
  if(i===exam.cur) stt.push('on');
  if(exam.ans[qi] && exam.ans[qi].length) stt.push('done');
  if(exam.mark[qi]) stt.push('mark');
  return `<button class="${stt.join(' ')}" onclick="jumpExam(${i})">
    <i class="tt" style="--c:${TYPE_COLORS[t]}">${TYPES[t]}</i><b>${i+1}</b></button>`;
}
function updateExamHead(){
  const el=document.querySelector('.exam-done');
  if(!el || !exam) return;
  const answered = Object.keys(exam.ans).filter(k=>exam.ans[k]&&exam.ans[k].length).length;
  const marked = Object.keys(exam.mark).length;
  el.innerHTML = `已答 <b class="num">${answered}</b> · 未答 <b class="num">${exam.paper.length-answered}</b> · 标记 <b class="num">${marked}</b>`;
  const pos = document.querySelector('.exam-pos');
  if(pos && exam) pos.innerHTML = `第 <b class="num">${exam.cur+1}</b> / ${exam.paper.length} 题`;
}
function toggleExamSelect(qi, el){
  const q = qAt(qi);
  const card = el.closest('.q-card');
  if(q.t===1){
    el.classList.toggle('sel');
  } else {
    if(el.classList.contains('sel')) el.classList.remove('sel');
    else { card.querySelectorAll('.opt').forEach(o=>o.classList.remove('sel')); el.classList.add('sel'); }
  }
  const sel = q.t===1 ? [...card.querySelectorAll('.opt.sel')].map(o=>o.dataset.key)
    : [card.querySelector('.opt.sel')?.dataset.key].filter(Boolean);
  if(sel.length) exam.ans[qi]=sel; else delete exam.ans[qi];
  updateExamHead(); drawExamNav();
}
function drawExamNav(){
  const nav=document.getElementById('examNav');
  if(nav && exam && !exam.done) nav.innerHTML = exam.paper.map((qj,i)=>navBtn(i)).join('');
}
function jumpExam(i){ if(!exam||exam.done) return; exam.cur=i; drawExam(); }
function prevExam(){ if(!exam||exam.done) return; if(exam.cur>0){ exam.cur--; drawExam(); } }
function nextExam(){ if(!exam||exam.done) return; if(exam.cur<exam.paper.length-1){ exam.cur++; drawExam(); } }
function toggleMark(){
  if(!exam||exam.done) return;
  const qi = exam.paper[exam.cur];
  if(exam.mark[qi]) delete exam.mark[qi]; else exam.mark[qi]=1;
  drawExam(); updateExamHead();
}
function judgeOK(q, ua){
  if(q.t===1) return ua.length>0 && [...ua].sort().join('')===[...q.a].sort().join('');
  if(q.t===0) return ua.length===1 && ua[0]===q.a;
  return ua.length===1 && ((ua[0]==='对')===(q.a==='对'));
}
function submitExam(){
  if(!exam || exam.done) return;
  const answered = Object.keys(exam.ans).filter(k=>exam.ans[k]&&exam.ans[k].length).length;
  const marked = Object.keys(exam.mark).length;
  const un = exam.paper.length - answered;
  if(!confirm(`已答 ${answered} 题 · 未答 ${un} 题${marked?` · 标记 ${marked} 题`:''}\n确定交卷？`)) return;
  let score=0;
  const stt={A:{g:0,f:0},B:{g:0,f:0},C:{g:0,f:0}}, tst={0:{g:0,f:0},1:{g:0,f:0},2:{g:0,f:0}};
  exam.paper.forEach(qi=>{
    const q=qAt(qi), ua=exam.ans[qi]||[], cls=clsOf(qi);
    stt[cls].f++; tst[q.t].f++;
    if(judgeOK(q,ua)){
      score++; stt[cls].g++; tst[q.t].g++;
    }
  });
  save();
  exam.score=score; exam.done=true; exam.tst=tst; exam.stt=stt;
  exam.used = Math.round((Date.now()-exam.start)/1000);
  examLoopId++;
  render();
}
function fmtTime(sec){
  const h=Math.floor(sec/3600), m=Math.floor(sec%3600/60), s=sec%60;
  return [h,m,s].map(x=>String(x).padStart(2,'0')).join(':');
}
function examTimerLoop(){
  const myId = ++examLoopId;
  (function tick(){
    if(!exam || exam.done || examLoopId!==myId) return;
    const left = exam.dur - Math.floor((Date.now()-exam.start)/1000);
    if(left<=0){
      const el=document.getElementById('examTimer');
      if(el) el.textContent='00:00:00';
      submitExam(); return;
    }
    const el=document.getElementById('examTimer');
    if(el){ el.textContent=fmtTime(left); el.classList.toggle('warn', left<=300); }
    setTimeout(tick,1000);
  })();
}
function reviewDetail(qi){
  const q=qAt(qi), ua=exam.ans[qi]||[], letters=['A','B','C','D','E','F','G','H'];
  const right=[...q.a];
  let opts;
  if(q.t===2){
    opts=['对','错'].map(v=>{
      const stt = right.includes(v)?'r':(ua.includes(v)?'w':'');
      return `<div class="rv-opt ${stt}"><span class="key">${v==='对'?'✓':'✕'}</span>${v}</div>`;
    }).join('');
  } else {
    opts=q.o.map((txt,idx)=>{
      const L=letters[idx];
      const stt=right.includes(L)?'r':(ua.includes(L)?'w':'');
      return `<div class="rv-opt ${stt}"><span class="key">${L}</span>${esc(txt)}</div>`;
    }).join('');
  }
  const rightStr = q.t===2 ? (q.a==='对'?'对':'错') : right.join('、');
  return `<div class="rv-inner">
    <div class="rv-stem-full">${esc(q.s)}</div>
    <div class="rv-opts">${opts}</div>
    <div class="rv-answer">你的答案：<b>${ua.join('')||'未作答'}</b>　·　正确答案：<b class="okc">${rightStr}</b></div>
    ${q.n?`<div class="rv-note">解析：${esc(q.n)}</div>`:''}
  </div>`;
}
function toggleReview(i){
  const el=document.getElementById('rv-'+i);
  if(el) el.closest('.review-row').classList.toggle('open');
}
function vExamResult(){
  const full=exam.paper.length, s=exam.score, pct=Math.round(s/full*100);
  const verdict = pct>=90?'卓越':pct>=80?'优秀':pct>=70?'良好':pct>=60?'合格':'待加强';
  const typeRows=['单选题','多选题','判断题'].map((name,t)=>{
    const d=exam.tst[t];
    return `<div class="bar-row"><span class="b-name">${name}</span>
      <div class="b-track"><i data-w="${d.f?d.g/d.f*100:0}"></i></div>
      <span class="b-val num">${d.g}/${d.f} 分</span></div>`;
  }).join('');
  const catRows=['A','B','C'].map(c=>{
    const d=exam.stt[c];
    return `<div class="bar-row"><span class="b-name" style="color:${CLS_INFO[c]}">${c} 类</span>
      <div class="b-track"><i data-w="${d.f?d.g/d.f*100:0}" style="background:${CLS_INFO[c]}"></i></div>
      <span class="b-val num">${d.g}/${d.f} 分</span></div>`;
  }).join('');
  const rows = exam.paper.map((qi,i)=>{
    const q=qAt(qi), ua=exam.ans[qi]||[], ok=judgeOK(q,ua);
    return `<div class="review-row ${ok?'ok':'no'}" onclick="toggleReview(${i})">
      <span class="rv-ic">${ok?'✓':'✕'}</span>
      <span class="rv-n num">${i+1}</span>
      <span class="rv-chap">${BANK.chapters[q.ch]}</span>
      <span class="rv-stem">${esc(q.s)}</span>
      <span class="rv-meta num">${ua.join('')||'未答'}</span>
      <div class="rv-detail" id="rv-${i}">${reviewDetail(qi)}</div>
    </div>`;
  }).join('');
  return `
  <div class="card result-hero">
    <div class="ring">
      <svg width="120" height="120">
        <defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#f5e3b8"/><stop offset="100%" stop-color="#b8863a"/>
        </linearGradient></defs>
        <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="9"/>
        <circle cx="60" cy="60" r="52" fill="none" stroke="url(#rg)" stroke-width="9" stroke-linecap="round"
          stroke-dasharray="${2*Math.PI*52}" stroke-dashoffset="${2*Math.PI*52*(1-pct/100)}" style="transition:stroke-dashoffset 1.2s ease"/>
      </svg>
      <div class="ring-v num">${pct}%</div>
    </div>
    <div class="score">${s}<small> / ${full} 分</small></div>
    <div class="verdict">${verdict}</div>
    <div class="rv-meta-row">
      <span>用时 ${fmtTime(exam.used)}</span><span>共 ${exam.paper.length} 题</span>
      <span>${BANK.positions[st.pos].name}</span>
    </div>
    <div class="es-actions" style="margin-top:16px">
      <button class="btn primary" onclick="exam=null;go('exam')">再来一次</button>
      <button class="btn ghost" onclick="go('home')">返回首页</button>
    </div>
  </div>
  <div class="grid c2" style="margin-top:16px">
    <div class="card rv-panel"><div class="panel-title">分题型得分</div>${typeRows}</div>
    <div class="card rv-panel"><div class="panel-title">分 A/B/C 得分</div>${catRows}</div>
  </div>
  <div class="sec-title"><span class="diamond"></span><h2>答题详情</h2><small>点击行可展开查看解析</small></div>
  <div class="card" style="padding:6px 0">${rows}</div>`;
}


/* ================= 刷题练习 ================= */
let practice = null;

function practiceUnits(){
  const pos = BANK.positions[st.pos], pool = poolFor(st.pos);
  return [
    {id:'A', tag:'A', sub:'所有部门 A 类题合集', qs:pool.A},
    ...pos.b.map((g,i)=>({id:'B'+i, tag:'B', sub:grpText(g), qs:pool.B.filter(qi=>g[0].includes(deptOf(qi)))})),
    ...pos.c.map((g,i)=>({id:'C'+i, tag:'C', sub:grpText(g), qs:pool.C.filter(qi=>g[0].includes(deptOf(qi)))})),
  ];
}
function selUnits(){ return st.punits || practiceUnits().map(u=>u.id); }
function toggleUnit(id){
  const s = selUnits().slice();
  const i = s.indexOf(id);
  if(i>=0) s.splice(i,1); else s.push(id);
  st.punits = s; save(); render();
}
function togglePType(t){
  const a = (st.ptypes||[true,true,true]).slice();
  a[t] = !a[t];
  st.ptypes = a; save(); render();
}
function setPOrder(o){ st.porder = o; save(); render(); }
function buildPracticeList(){
  const units = practiceUnits(), sel = selUnits(), tsel = st.ptypes||[true,true,true];
  let list = [];
  units.forEach(u=>{ if(sel.includes(u.id)) u.qs.forEach(qi=>{ if(tsel[qAt(qi).t]) list.push(qi); }); });
  if(st.porder==='seq') list.sort((a,b)=>(qAt(a).ch-qAt(b).ch)||(a-b));
  else list = shuffle(list);
  return list;
}
function startPractice(){
  const list = buildPracticeList();
  if(!list.length){ alert('当前筛选没有可练题目，请调整范围或题型'); return; }
  practice = {list, cur:0, st:{}, done:false, src:'normal'};
  go('practice');
}
function vPractice(){
  if(!practice) return vPracticeSetup();
  if(practice.done) return vPracticeResult();
  return `
  <div class="exam-topbar">
    <button class="btn ghost" onclick="exitPractice()">← 返回</button>
    <div class="et-info">
      <span class="exam-pos">第 <b class="num">1</b> / ${practice.list.length} 题</span>
      <span class="exam-done">已答 <b class="num">0</b> · 未答 <b class="num">${practice.list.length}</b></span>
    </div>
  </div>
  <div id="practiceBox"></div>
  <div class="card exam-navcard">
    <div class="exam-legend">
      <span><i class="lg-done"></i>答对</span>
      <span style="color:var(--bad)"><i class="lg-mark" style="box-shadow:inset 0 0 0 1px rgba(233,104,116,.6)"></i>答错</span>
      <span><i style="box-shadow:inset 0 0 0 1px var(--line2)"></i>未答</span>
    </div>
    <div class="exam-nav" id="practiceNav"></div>
  </div>`;
}
function vPracticeSetup(){
  const pos = BANK.positions[st.pos];
  const units = practiceUnits(), sel = selUnits(), tsel = st.ptypes||[true,true,true];
  const unitRows = units.map(u=>`
    <div class="unit-row ${sel.includes(u.id)?'on':''}" onclick="toggleUnit('${u.id}')">
      <span class="u-box">${sel.includes(u.id)?'✓':''}</span>
      <span class="rp-tag" style="--c:${CLS_INFO[u.tag]}">${u.tag}</span>
      <span class="u-name">${u.sub}</span>
      <span class="u-num num">${u.qs.length} 题</span>
    </div>`).join('');
  const segs = TYPES.map((n,t)=>`<button class="seg ${tsel[t]?'on':''}" onclick="togglePType(${t})">${n}</button>`).join('');
  const orderBtns = [['rand','随机混合'],['seq','按章节顺序']].map(o=>
    `<button class="seg ${st.porder===o[0]?'on':''}" onclick="setPOrder('${o[0]}')">${o[1]}</button>`).join('');
  const cnt = buildPracticeList().length;
  return `
  <div class="p-setup card">
    <div class="seal-ring" style="margin:0 auto 6px">练</div>
    <div class="es-title">刷题练习 · ${pos.name}</div>
    <div class="es-notice">即时反馈：选择答案立即判断对错并展示解析；答错的题自动记入该岗位错题本，连续答对 ${MASTER_STREAK} 次后移入「已掌握」（历史错次保留）。</div>
    <div class="es-sec">练习范围</div>
    <div class="type-panel" style="gap:9px">${unitRows}</div>
    <div class="es-sec">题型</div>
    <div class="seg-row">${segs}</div>
    <div class="es-sec">顺序</div>
    <div class="seg-row">${orderBtns}</div>
    <div class="es-actions">
      <button class="btn ghost" onclick="go('home')">重新选岗位</button>
      <button class="btn primary" onclick="startPractice()">开始刷题 ${cnt?`<b class="num">${cnt}</b> 题`:''}</button>
    </div>
  </div>`;
}
function vPracticeResult(){
  const p = practice, wrong = p.total - p.ok;
  const remain = p.src!=='normal' ? wrongAct(st.pos) : null;
  return `
  <div class="card result-hero" style="max-width:640px;margin:0 auto">
    <div class="score">${p.ok}<small> / ${p.total} 题</small></div>
    <div class="verdict">答对 ${p.ok} 题 · 答错 ${wrong} 题${remain!=null?` · 错题本剩余 <b class="num">${remain}</b> 题`:''}</div>
    <div class="es-actions" style="margin-top:16px">
      <button class="btn primary" onclick="finishPracticeAgain()">再来一组</button>
      <button class="btn ghost" onclick="practiceBack()">返回选择</button>
    </div>
  </div>`;
}
function finishPracticeAgain(){
  const src = practice && practice.src;
  practice = null;
  if(src==='normal') startPractice();
  else go('wrong');
}
function practiceBack(){
  const back = practice && practice.src!=='normal' ? 'wrong' : 'practice';
  practice = null; go(back);
}
function finishPractice(){
  if(!practice || practice.done) return;
  let ok = 0;
  practice.list.forEach(qi=>{ if(practice.st[qi] && practice.st[qi].ok) ok++; });
  practice.ok = ok; practice.total = practice.list.length; practice.done = true;
  render();
}
function drawPractice(){
  if(!practice || practice.done) return;
  const i = practice.cur, qi = practice.list[i], q = qAt(qi);
  const stt = practice.st[qi] || null;
  document.getElementById('practiceBox').innerHTML = qCard(qi,{n:i+1,total:practice.list.length,
    instant:true, st:stt, chapName:BANK.chapters[q.ch]});
  document.getElementById('practiceNav').innerHTML = practice.list.map((_,j)=>pNavBtn(j)).join('');
  updatePracticeHead();
  bindGlobal();
}
function pNavBtn(i){
  const qi = practice.list[i], t = qAt(qi).t;
  const ps = practice.st[qi], cls = [];
  if(i===practice.cur) cls.push('on');
  if(ps) cls.push(ps.ok?'done':'no');
  return `<button class="${cls.join(' ')}" onclick="jumpPractice(${i})">
    <i class="tt" style="--c:${TYPE_COLORS[t]}">${TYPES[t]}</i><b>${i+1}</b></button>`;
}
function updatePracticeHead(){
  const el = document.querySelector('.exam-done');
  if(el && practice){
    const done = Object.keys(practice.st).length;
    el.innerHTML = `已答 <b class="num">${done}</b> · 未答 <b class="num">${practice.list.length-done}</b>`;
  }
  const pos = document.querySelector('.exam-pos');
  if(pos && practice) pos.innerHTML = `第 <b class="num">${practice.cur+1}</b> / ${practice.list.length} 题`;
}
function practicePick(qi, el){
  const q = qAt(qi);
  if(q.t===1){ el.classList.toggle('sel'); return; }   // 多选：勾选后点「确认答案」再判分
  lockPractice(qi, [el.dataset.key]);
}
function practiceConfirm(qi){
  const card = document.querySelector(`.q-card[data-qi="${qi}"]`);
  const ua = card ? [...card.querySelectorAll('.opt.sel')].map(o=>o.dataset.key) : [];
  if(!ua.length) return;
  lockPractice(qi, ua);
}
function lockPractice(qi, ua){
  if(practice.st[qi]) return;
  const ok = judgeOK(qAt(qi), ua);
  practice.st[qi] = {ua, ok};
  recordWrong(st.pos, qi, ok);
  updatePracticeHead(); drawPractice();
}
function prevPractice(){ if(!practice||practice.done)return; if(practice.cur>0){practice.cur--;drawPractice();} }
function nextPractice(){ if(!practice||practice.done)return; if(practice.cur<practice.list.length-1){practice.cur++;drawPractice();} }
function jumpPractice(i){ if(!practice||practice.done)return; practice.cur=i; drawPractice(); }
function exitPractice(){
  if(practice && !practice.done && !confirm('退出后本次刷题进度将丢失，确定返回？')) return;
  practiceBack();
}

/* ================= 错题本 ================= */
function wrongP(pi){ return pw[pi] || (pw[pi] = {}); }
function wrongCount(pi){ return Object.keys(pw[pi]||{}).length; }
function wrongAct(pi){ return Object.values(pw[pi]||{}).filter(r=>!r.mastered).length; }
function wrongOK(pi){ return Object.values(pw[pi]||{}).filter(r=>r.mastered).length; }
function recordWrong(pi, qi, ok){
  const m = wrongP(pi);
  if(!ok){
    const r = m[qi] || (m[qi] = {fails:0, streak:0, mastered:false});
    r.fails++; r.streak = 0; r.mastered = false;   // 答错：次数只增不减，连对计数清零并拉回待复习
  } else if(m[qi] && !m[qi].mastered){
    const r = m[qi];
    r.streak++;
    if(r.streak >= MASTER_STREAK) r.mastered = true;   // 连对 N 次移入已掌握，历史错次保留
  }
  pSave();
}
function freqBadge(r){
  if(r.mastered) return '<span class="freq ok">已掌握</span>';
  if(r.fails>=3) return `<span class="freq f3">顽固 ×${r.fails}</span>`;
  if(r.fails>=2) return `<span class="freq f2">高频 ×${r.fails}</span>`;
  return `<span class="freq f1">×${r.fails}</span>`;
}
function vWrong(){
  const pos = BANK.positions[st.pos];
  const m = wrongP(st.pos);
  const recs = Object.keys(m).map(Number).filter(qi=>qi<BANK.q.length && m[qi])
    .map(qi=>({qi, fails:m[qi].fails, streak:m[qi].streak, mastered:!!m[qi].mastered}));
  const act = recs.filter(r=>!r.mastered), okd = recs.filter(r=>r.mastered);
  const high = act.filter(r=>r.fails>=HIGH_FAILS).length;
  const row = r => {
    const q = BANK.q[r.qi];
    return `<div class="review-row" onclick="toggleReviewP(${r.qi})">
      <span class="rv-ic" style="background:rgba(233,104,116,.14);color:var(--bad)">✕</span>
      <span class="rv-chap">${BANK.chapters[q.ch]}</span>
      <span class="rv-stem">${esc(q.s)}</span>
      ${freqBadge(r)}
      <span class="rv-meta num">错${r.fails}次</span>
      <div class="rv-detail" id="rv-d-${r.qi}">${reviewPractice(r)}</div>
    </div>`;
  };
  const actRows = act.map(row).join('') || '<div style="padding:26px;text-align:center;color:var(--faint)">暂无待复习错题，去刷题练习吧</div>';
  const okRows = okd.map(r=>`
    <div class="review-row" onclick="toggleReviewP(${r.qi})">
      <span class="rv-ic" style="background:rgba(95,195,162,.14);color:var(--good)">✓</span>
      <span class="rv-chap">${BANK.chapters[BANK.q[r.qi].ch]}</span>
      <span class="rv-stem">${esc(BANK.q[r.qi].s)}</span>
      ${freqBadge(r)}
      <span class="rv-meta num">错${r.fails}次</span>
      <button class="btn sm ghost" onclick="event.stopPropagation();reviveWrong(${r.qi})">拉回</button>
      <div class="rv-detail" id="rv-d-${r.qi}">${reviewPractice(r)}</div>
    </div>`).join('') || '<div style="padding:18px;text-align:center;color:var(--faint)">暂无已掌握题目</div>';
  return `
  <div class="exam-topbar">
    <button class="btn ghost" onclick="go('home')">← 返回选岗</button>
    <div class="et-info"><span class="exam-pos">${pos.name} · 错题本</span></div>
  </div>
  <div class="grid c3" style="margin-bottom:16px">
    <div class="card p-setup" style="padding:20px">
      <div class="panel-title">待复习</div>
      <div class="score" style="font-size:44px;margin:2px 0">${act.length}<small> 题</small></div>
      <div style="font-size:12.5px;color:var(--muted)">高频（≥${HIGH_FAILS} 次）<b class="num" style="color:var(--gold-hi)">${high}</b> 题</div>
      <div class="q-foot" style="margin-top:16px">
        <button class="btn primary" ${high?'':'disabled'} onclick="startWrong(true)">强化练习 ${high?`（${high} 题）`:''}</button>
        <button class="btn ghost" ${act.length?'':'disabled'} onclick="startWrong(false)">重刷全部</button>
      </div>
    </div>
    <div class="card p-setup" style="padding:20px">
      <div class="panel-title">已掌握</div>
      <div class="score" style="font-size:44px;margin:2px 0">${okd.length}<small> 题</small></div>
      <div style="font-size:12.5px;color:var(--muted)">连对 ${MASTER_STREAK} 次自动移入，历史错次保留</div>
    </div>
    <div class="card p-setup" style="padding:20px">
      <div class="panel-title">累计记录</div>
      <div class="score" style="font-size:44px;margin:2px 0">${recs.length}<small> 题</small></div>
      <div style="font-size:12.5px;color:var(--muted)">含已掌握，错误次数只增不减</div>
    </div>
  </div>
  <div class="sec-title"><span class="diamond"></span><h2>待复习</h2><small>点击行展开解析</small></div>
  <div class="card" style="padding:6px 0">${actRows}</div>
  <div class="sec-title"><span class="diamond"></span><h2>已掌握</h2><small>可拉回待复习</small></div>
  <div class="card" style="padding:6px 0">${okRows}</div>`;
}
function reviewPractice(r){
  const q = BANK.q[r.qi];
  return `<div class="rv-stem-full">${esc(q.s)}</div>
    <div class="rv-answer">正确答案：<b class="okc">${q.t===2?(q.a==='对'?'对':'错'):[...q.a].join('')}</b>　·　错误 <b class="num">${r.fails}</b> 次　·　连对 <b class="num">${r.streak}</b> 次</div>
    ${q.n?`<div class="rv-note">解析：${esc(q.n)}</div>`:''}`;
}
function toggleReviewP(qi){ const el = document.getElementById('rv-d-'+qi); if(el) el.closest('.review-row').classList.toggle('open'); }
function reviveWrong(qi){
  const r = wrongP(st.pos)[qi];
  if(r){ r.mastered = false; r.streak = 0; pSave(); render(); }
}
function weightedOrder(arr, w){
  const pool = [];
  arr.forEach(a=>{ const n = Math.max(1, w(a)); for(let k=0;k<n;k++) pool.push(a); });
  for(let i=pool.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [pool[i],pool[j]]=[pool[j],pool[i]]; }
  const seen = new Set(), out = [];
  pool.forEach(a=>{ if(!seen.has(a)){ seen.add(a); out.push(a); } });
  return out;
}
function startWrong(hardOnly){
  const m = wrongP(st.pos);
  let list = Object.keys(m).map(Number).filter(qi=>qi<BANK.q.length && BANK.q[qi] && !m[qi].mastered);
  if(hardOnly) list = list.filter(qi=>m[qi].fails>=HIGH_FAILS);
  if(!list.length) return;
  practice = {list: weightedOrder(list, qi=>m[qi].fails), cur:0, st:{}, done:false, src: hardOnly?'hard':'wrong'};
  go('practice');
}

/* ================= 题目卡渲染 ================= */
function qCard(qi, o){
  const q=qAt(qi);
  const letters=['A','B','C','D','E','F','G','H'];
  const right=[...q.a];
  const LK = o.st || null;                     // 刷题锁定记录 {ua, ok}，null 表示未作答
  const optCls = v => {
    if(!LK) return (o.sel||[]).includes(v)?'sel':'';
    const c = [];
    if(right.includes(v)) c.push('right');
    if(LK.ua.includes(v) && !right.includes(v)) c.push('wrong');
    if(!c.length) c.push('lock');
    return c.join(' ');
  };
  const tick = v => (LK && !LK.ok && LK.ua.includes(v)) ? '✕' : '✓';
  let opts;
  if(q.t===2){
    opts=['对','错'].map(v=>`
      <div class="opt ${optCls(v)}" data-qi="${qi}" data-key="${v}">
        <span class="key">${v==='对'?'✓':'✕'}</span><span class="txt">${v}</span><span class="tick">${tick(v)}</span></div>`).join('');
  } else {
    opts=q.o.map((txt,i)=>{
      const L=letters[i];
      return `<div class="opt ${optCls(L)}" data-qi="${qi}" data-key="${L}">
        <span class="key">${L}</span><span class="txt">${esc(txt)}</span><span class="tick">${tick(L)}</span></div>`;}).join('');
  }
  const badge = q.t===0?'single':(q.t===1?'multi':'judge');
  const chap = o.chapName? `<span class="badge chap">${o.chapName}</span>`:'';
  const marked = (o.exam && exam && exam.mark[qi]) ? `<span class="badge" style="color:var(--bad);border:1px solid rgba(233,104,116,.4);background:rgba(233,104,116,.1)">已标记</span>`:'';
  let foot = '';
  if(o.exam && exam){
    const isLast = exam.cur>=exam.paper.length-1;
    foot = `
    <div class="q-foot">
      <button class="btn ghost" onclick="prevExam()">上一题</button>
      <button class="btn ${exam.mark[qi]?'primary':'ghost'}" onclick="toggleMark()">${exam.mark[qi]?'已标记':'标记'}</button>
      <span class="q-foot-spacer"></span>
      <button class="btn ${isLast?'primary':'ghost'}" onclick="submitExam()">交卷</button>
      ${isLast?'':`<button class="btn primary" onclick="nextExam()">下一题</button>`}
    </div>`;
  } else if(o.instant){
    const answered = !!LK;
    const isMul = q.t===1 && !answered;
    foot = `
    <div class="q-foot">
      <button class="btn ghost" onclick="prevPractice()">上一题</button>
      ${isMul?`<button class="btn primary" onclick="practiceConfirm(${qi})">确认答案</button>`:''}
      ${answered?`<span class="p-judge ${LK.ok?'ok':'no'}">${LK.ok?'回答正确':'回答错误'}</span>`:''}
      <span class="q-foot-spacer"></span>
      <button class="btn primary" onclick="finishPractice()">完成练习</button>
      ${practice && practice.cur<practice.list.length-1?`<button class="btn ghost" onclick="nextPractice()">下一题</button>`:''}
    </div>
    ${answered && q.n?`<div class="p-note">解析：${esc(q.n)}</div>`:''}
    ${answered?`<div class="rv-answer" style="margin-top:14px">你的答案：<b>${LK.ua.join('')||'未作答'}</b>　·　正确答案：<b class="okc">${q.t===2?(q.a==='对'?'对':'错'):right.join('')}</b></div>`:''}`;
  }
  return `
  <div class="card q-card" data-qi="${qi}" data-locked="${o.lock?'1':'0'}">
    <div class="q-head">
      <span class="badge ${badge}">${TYPES[q.t]}</span>
      ${chap}
      ${marked}
      ${o.extra||''}
      <span class="q-prog num">${o.n} / ${o.total}</span>
    </div>
    <div class="q-stem">${esc(q.s)}</div>
    <div class="opts">${opts}</div>
    ${foot}
  </div>`;
}
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/* ================= 抽签 =================
   名单只保存在本机浏览器(localStorage)，不写回 HTML 文件，也不上传任何服务器。
   抽签用 crypto.getRandomValues 做无放回等概率抽取：名单顺序不影响结果，每人中签概率相同。 */
const DKEY = 'exam_tool_draw_v1';
const DZ_SPEED = {fast:420, mid:780, slow:1150};
const DZ_NAME_RE = /姓名|名字|人员|员工|职工/;
const DZ_NO_RE = /工号|编号|账号|员工号|职工号/;
const DZ_RID = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const DZ_ROUND_LABEL = {floor:'向下取整', ceil:'向上取整', round:'四舍五入'};

let dr = dzLoad();
let dz = null;          // 运行时状态：列映射中 或 抽签进行中
let dzPaste = false;    // 粘贴面板是否展开
let dzToken = 0;        // 抽签序列令牌，用于终止上一轮揭晓动画
let dzToastT = 0;

function dzLoad(){
  const def = {roster:[], pct:30, rounding:'floor', fname:'', speed:'mid'};
  try{
    const d = JSON.parse(localStorage.getItem(DKEY));
    if(d && typeof d === 'object'){
      const r = Object.assign({}, def, d);
      if(!Array.isArray(r.roster)) r.roster = [];
      if(!DZ_SPEED[r.speed]) r.speed = 'mid';
      if(!DZ_ROUND_LABEL[r.rounding]) r.rounding = 'floor';
      const p = +r.pct;
      r.pct = (isFinite(p) && p > 0 && p <= 100) ? p : 30;
      r.roster = r.roster.filter(x=>x && typeof x.n === 'string' && x.n).map(x=>({n:x.n, no:String(x.no == null ? '' : x.no)}));
      return r;
    }
  }catch(e){}
  return def;
}
function dzSave(){
  try{ localStorage.setItem(DKEY, JSON.stringify({roster:dr.roster, pct:dr.pct, rounding:dr.rounding, fname:dr.fname, speed:dr.speed})); }
  catch(e){ dzToast('名单较大，本地存储写入失败，下次打开需重新导入'); }
}
function dzToast(msg){
  let el = document.getElementById('dzToast');
  if(!el){ el = document.createElement('div'); el.id = 'dzToast'; document.body.appendChild(el); }
  el.className = 'dz-toast';
  el.textContent = msg;
  clearTimeout(dzToastT);
  dzToastT = setTimeout(()=>{ el.className = 'dz-toast off'; }, 2400);
}

/* ---- 列号 <-> 列名 ---- */
function dzColIdx(s){
  let n = 0;
  for(let i=0;i<s.length;i++){ const c = s.charCodeAt(i); if(c < 65 || c > 90) continue; n = n*26 + (c-64); }
  return n - 1;
}
function dzColName(i){
  let s = ''; i = i + 1;
  while(i > 0){ s = String.fromCharCode(65 + ((i-1) % 26)) + s; i = Math.floor((i-1) / 26); }
  return s;
}

/* ---- 极简 xlsx 读取：ZIP 中央目录 + 原生 deflate-raw 解压 + DOMParser ---- */
async function dzUnzip(buf, want){
  const u8 = new Uint8Array(buf), dv = new DataView(buf), dec = new TextDecoder('utf-8');
  let eocd = -1;
  const stop = Math.max(0, u8.length - 66000);
  for(let i = u8.length - 22; i >= stop; i--){ if(dv.getUint32(i, true) === 0x06054b50){ eocd = i; break; } }
  if(eocd < 0) throw new Error('不是有效的 xlsx 文件');
  const cnt = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  const out = {};
  for(let i=0;i<cnt;i++){
    if(off + 46 > u8.length || dv.getUint32(off, true) !== 0x02014b50) throw new Error('xlsx 压缩包头损坏');
    const method = dv.getUint16(off + 10, true);
    const csize  = dv.getUint32(off + 20, true);
    const fnLen  = dv.getUint16(off + 28, true);
    const exLen  = dv.getUint16(off + 30, true);
    const cmLen  = dv.getUint16(off + 32, true);
    const lho    = dv.getUint32(off + 42, true);
    const name   = dec.decode(u8.subarray(off + 46, off + 46 + fnLen));
    off += 46 + fnLen + exLen + cmLen;
    if(want && !want.test(name)) continue;
    if(lho + 30 > u8.length) throw new Error('xlsx 压缩包头越界');
    const lFn = dv.getUint16(lho + 26, true), lEx = dv.getUint16(lho + 28, true);
    const ds = lho + 30 + lFn + lEx;
    out[name] = {method, raw: u8.subarray(ds, Math.min(ds + csize, u8.length))};
  }
  for(const k in out){
    const it = out[k];
    if(it.method === 0){ out[k] = dec.decode(it.raw); }
    else if(it.method === 8){
      if(!it.raw.length){ out[k] = ''; continue; }
      const st = new Blob([it.raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      out[k] = await new Response(st).text();
    }
    else { throw new Error('xlsx 使用了不支持的压缩方式'); }
  }
  return out;
}
function dzXml(s, what){
  if(!s) throw new Error('xlsx 缺少 ' + what);
  const d = new DOMParser().parseFromString(s, 'application/xml');
  if(d.getElementsByTagName('parsererror').length) throw new Error('xlsx 内部 ' + what + ' 解析失败');
  return d;
}
function dzShared(xml){
  const out = [];
  if(!xml) return out;
  const doc = dzXml(xml, 'sharedStrings');
  Array.prototype.forEach.call(doc.getElementsByTagName('si'), si=>{
    let t = '';
    Array.prototype.forEach.call(si.getElementsByTagName('t'), x=>{ t += x.textContent; });
    out.push(t);
  });
  return out;
}
function dzSheet(xml, shared){
  const doc = dzXml(xml, 'sheet'), rows = [];
  Array.prototype.forEach.call(doc.getElementsByTagName('row'), (r, idx)=>{
    const ri = (+r.getAttribute('r') || idx + 1) - 1;
    const cells = [];
    Array.prototype.forEach.call(r.getElementsByTagName('c'), c=>{
      const ci = dzColIdx(c.getAttribute('r') || '');
      if(ci < 0) return;
      const t = c.getAttribute('t') || 'n';
      let v = '';
      if(t === 'inlineStr'){
        const is = c.getElementsByTagName('is')[0];
        if(is) Array.prototype.forEach.call(is.getElementsByTagName('t'), x=>{ v += x.textContent; });
      } else {
        const vn = c.getElementsByTagName('v')[0];
        if(vn){
          v = vn.textContent;
          if(t === 's'){ const k = +v; v = (k >= 0 && k < shared.length) ? shared[k] : ''; }
        }
      }
      cells[ci] = v;
    });
    rows[ri] = cells;
  });
  for(let i=0;i<rows.length;i++) if(!rows[i]) rows[i] = [];
  return rows;
}
async function dzReadXlsx(file){
  if(typeof DecompressionStream === 'undefined') throw new Error('当前浏览器不支持解压 xlsx，请改用粘贴文本导入');
  const files = await dzUnzip(await file.arrayBuffer(),
    /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/sheet\d+\.xml)$/);
  const wb = dzXml(files['xl/workbook.xml'], 'workbook');
  const relMap = {};
  if(files['xl/_rels/workbook.xml.rels']){
    Array.prototype.forEach.call(dzXml(files['xl/_rels/workbook.xml.rels'], 'rels').getElementsByTagName('Relationship'), r=>{
      relMap[r.getAttribute('Id')] = r.getAttribute('Target');
    });
  }
  const shared = dzShared(files['xl/sharedStrings.xml']);
  const sheets = [];
  Array.prototype.forEach.call(wb.getElementsByTagName('sheet'), (s, i)=>{
    const rid = s.getAttribute('r:id') || s.getAttributeNS(DZ_RID, 'id');
    let tgt = relMap[rid] || ('worksheets/sheet' + (i+1) + '.xml');
    tgt = tgt.replace(/^\/?xl\//, '').replace(/^\//, '');
    const p = 'xl/' + tgt;
    if(files[p]) sheets.push({name: s.getAttribute('name') || ('工作表' + (i+1)), rows: dzSheet(files[p], shared)});
  });
  if(!sheets.length) throw new Error('xlsx 里没有找到可读的工作表');
  return sheets;
}

/* ---- 名单导入 ---- */
function dzPickFile(){
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.xlsx';
  inp.onchange = async ()=>{
    const f = inp.files && inp.files[0];
    if(!f) return;
    if(!/\.xlsx$/i.test(f.name)){
      alert('只支持 .xlsx 格式。\n\n如果名单是 .xls 老格式，请用 Excel 或 WPS「另存为」.xlsx；也可以直接框选表格复制，用「粘贴」进来。');
      return;
    }
    try{
      const sheets = await dzReadXlsx(f);
      dz = {mode:'map', fname:f.name, sheets:sheets, si:0, colName:0, colNo:-1, head:1, err:''};
      dzAutoMap(sheets[0].rows);
      render();
    }catch(e){
      alert('读取失败：' + ((e && e.message) || e) + '\n\n可以改用「粘贴」导入。');
    }
  };
  inp.click();
}
/* 约定：第一行是标题行，数据从第二行开始。按标题文字认列——不让用户手选。
   先认工号（「员工编号」这类同时含「员工」「编号」的标题，应算工号列）。 */
function dzAutoMap(rows){
  dz.head = 2;
  const t = rows[0] || [];
  let nameC = -1, noC = -1;
  for(let c=0;c<t.length;c++){
    const v = String(t[c] == null ? '' : t[c]).trim();
    if(!v) continue;
    if(noC < 0 && DZ_NO_RE.test(v)) noC = c;
    else if(nameC < 0 && DZ_NAME_RE.test(v)) nameC = c;
  }
  dz.colName = nameC;
  dz.colNo = noC;
  dz.autoOk = nameC >= 0 && noC >= 0;
}
function dzMaxCols(rows){
  let m = 0;
  for(let i=0;i<rows.length;i++){ const r = rows[i]; if(r && r.length > m) m = r.length; }
  return Math.min(Math.max(m, 2), 26);
}
function dzCountValid(rows, head, cn, cno){
  const start = Math.max(0, (head | 0) - 1);
  let n = 0;
  for(let i=start;i<rows.length;i++){
    const r = rows[i] || [];
    if(String(r[cn] == null ? '' : r[cn]).trim() && String(r[cno] == null ? '' : r[cno]).trim()) n++;
  }
  return n;
}
function dzSetSheet(v){ dz.si = +v; dzAutoMap(dz.sheets[dz.si].rows); render(); }
function dzCancelMap(){ dz = null; render(); }
function dzConfirmMap(){
  const rows = dz.sheets[dz.si].rows;
  const start = Math.max(0, (dz.head | 0) - 1);
  const list = [], byNo = {}, dup = [];
  let half = 0;
  for(let i=start;i<rows.length;i++){
    const r = rows[i] || [];
    const name = String(r[dz.colName] == null ? '' : r[dz.colName]).trim();
    const no = String(r[dz.colNo] == null ? '' : r[dz.colNo]).trim();
    if(!name && !no) continue;
    if(!name || !no){ half++; continue; }              // 姓名或工号缺一个的行不计入
    if(byNo[no] !== undefined){ if(dup.indexOf(no) < 0) dup.push(no); continue; }
    byNo[no] = 1;
    list.push({n:name, no:no});
  }
  if(dup.length){
    dz.err = '工号有重复：' + dup.slice(0, 8).map(esc).join('、') +
      (dup.length > 8 ? ' 等共 ' + dup.length + ' 个' : '') + '。请修改名单后重新上传。';
    render();
    return;
  }
  if(!list.length){ dz.err = '没有识别到名单，检查一下上面选的列对不对。'; render(); return; }
  dr.roster = list;
  dr.fname = dz.fname;
  dzSave();
  const msg = '已导入 ' + list.length + ' 人' + (half ? '，跳过 ' + half + ' 行缺项的' : '');
  dz = null;
  render();
  dzToast(msg);
}
function dzTogglePaste(){ dzPaste = !dzPaste; render(); }
/* 粘贴的名单不限定列序：哪一列像工号（不含中文）就按工号处理。 */
function dzPasteApply(){
  const ta = document.getElementById('dzPasteBox');
  if(!ta) return;
  const rows = ta.value.split(/\r?\n/).map(s=>s.trim()).filter(s=>s)
    .map(ln=>ln.split(/\t|,|，|;|；/).map(s=>s.trim()))
    .filter(r=>r.length > 1);
  if(!rows.length){ alert('每行需要有姓名和工号两列。\n\n直接从 Excel 复制整行粘贴即可。'); return; }
  const isHeader = v => /^(工号|员工号|职工号|编号|姓名|名字|人员|员工姓名)$/.test(v);
  const body = rows.filter(r=>!isHeader(r[0]) && !isHeader(r[1]));
  const looksNo = i => body.length > 0 && body.every(r=>r[i] && !/[\u4e00-\u9fa5]/.test(r[i]));
  let ci = 0, cn = 1;
  if(!looksNo(0) && looksNo(1)){ ci = 1; cn = 0; }
  const list = [], byNo = {}, dup = [];
  body.forEach(r=>{
    const no = r[ci] || '', name = r[cn] || '';
    if(!no || !name) return;
    if(byNo[no] !== undefined){ if(dup.indexOf(no) < 0) dup.push(no); return; }
    byNo[no] = 1;
    list.push({n:name, no:no});
  });
  if(dup.length){
    alert('工号有重复：' + dup.slice(0, 8).join('、') + (dup.length > 8 ? ' 等共 ' + dup.length + ' 个' : '') + '\n\n请修改后再导入。');
    return;
  }
  if(!list.length){ alert('没有识别到名单，请确认每行都有姓名和工号。'); return; }
  dr.roster = list; dr.fname = '粘贴导入'; dzPaste = false; dzSave(); render();
  dzToast('已导入 ' + list.length + ' 人');
}
function dzClear(){
  if(!confirm('将清空已导入的 ' + dr.roster.length + ' 人名单（本机保存），下次需要重新导入。确定清空？')) return;
  dr.roster = []; dr.fname = ''; dzSave(); render();
}

/* ---- 抽取计算 ---- */
function dzTarget(n, pct, mode){
  const raw = n * pct / 100;
  let k = mode === 'ceil' ? Math.ceil(raw) : (mode === 'round' ? Math.round(raw) : Math.floor(raw));
  if(!isFinite(k) || k < 0) k = 0;
  if(k > n) k = n;
  return {raw: raw, k: k};
}
function dzFmt(x){ return String(Math.round(x * 10000) / 10000); }
function dzSetPct(v){
  let p = parseFloat(v);
  if(!isFinite(p) || p <= 0) p = 0.1;
  if(p > 100) p = 100;
  dr.pct = p; dzSave(); render();
}
function dzSetRound(m){ if(DZ_ROUND_LABEL[m]){ dr.rounding = m; dzSave(); render(); } }
function dzSetSpeed(s){ if(DZ_SPEED[s]){ dr.speed = s; dzSave(); render(); } }

/* ---- 随机源：拒绝采样消除模偏差 ---- */
function dzRandInt(max){
  if(max <= 1) return 0;
  if(window.crypto && crypto.getRandomValues){
    const lim = Math.floor(4294967296 / max) * max;
    const a = new Uint32Array(1);
    let v;
    do{ crypto.getRandomValues(a); v = a[0]; }while(v >= lim);
    return v % max;
  }
  return Math.floor(Math.random() * max);
}
function dzShuffle(a){
  for(let i=a.length-1;i>0;i--){ const j = dzRandInt(i+1); const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}
/* 名单指纹：抽签前留存，事后可核对名单未被中途更换。
   先排序再哈希，使同一份名单无论行序如何都得到相同指纹。 */
function dzHash(list){
  const keys = [];
  for(let i=0;i<list.length;i++) keys.push(list[i].n + '\u0001' + list[i].no);
  keys.sort();
  let h = 0x811c9dc5;
  for(let i=0;i<keys.length;i++){
    const s = keys[i];
    for(let j=0;j<s.length;j++){ h ^= s.charCodeAt(j); h = (h * 0x01000193) >>> 0; }
    h ^= 10; h = (h * 0x01000193) >>> 0;   // 条目分隔，避免相邻条目拼接歧义
  }
  return ('00000000' + h.toString(16)).slice(-8).toUpperCase();
}
function dzSleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

/* ---- 抽签执行与揭晓 ---- */
function dzStart(){
  const n = dr.roster.length;
  const t = dzTarget(n, dr.pct, dr.rounding);
  if(!n || t.k <= 0) return;
  const idx = dzShuffle(dr.roster.map((_, i)=>i));
  dz = {
    mode:'run', k:t.k, picked:idx.slice(0, t.k), revealed:[],
    hasNo: dr.roster.some(p=>p.no), hash:dzHash(dr.roster), at:new Date(), skip:false
  };
  const tk = ++dzToken;
  render();
  dzReveal(tk);
}
async function dzReveal(tk){
  const dur = DZ_SPEED[dr.speed] || 780;
  for(let i=0;i<dz.picked.length;i++){
    if(tk !== dzToken || !dz) return;
    const el = document.getElementById('dzRoll');
    if(!el) return;
    el.className = 'dz-rollname on';
    const t0 = performance.now();
    while(performance.now() - t0 < dur){
      if(tk !== dzToken || dz.skip) break;
      const p = dr.roster[dzRandInt(dr.roster.length)];
      el.textContent = p ? p.n : '';
      await dzSleep(72);
    }
    if(tk !== dzToken || !dz) return;
    if(dz.skip) break;
    const p = dr.roster[dz.picked[i]];
    el.textContent = p.n;
    el.className = 'dz-rollname lock';
    dz.revealed.push(dz.picked[i]);
    dzPaint();
    await dzSleep(210);
    if(tk !== dzToken || !dz) return;
  }
  dz.revealed = dz.picked.slice();
  const rollEl = document.getElementById('dzRoll');
  if(rollEl && dz.picked.length){             // 跳过动画时，大字定格到最后一位中签者
    rollEl.textContent = dr.roster[dz.picked[dz.picked.length - 1]].n;
    rollEl.className = 'dz-rollname lock';
  }
  const msg = document.getElementById('dzStageMsg');
  if(msg) msg.textContent = '抽签完成 · 共 ' + dz.k + ' 人';
  dzPaint();
  const sp = document.getElementById('dzSkipBtn'); if(sp) sp.style.display = 'none';
  ['dzAgainBtn','dzCopyBtn','dzDlBtn'].forEach(id=>{ const e = document.getElementById(id); if(e) e.style.display = ''; });
}
function dzSkip(){ if(dz) dz.skip = true; }
function dzPaint(){
  if(!dz) return;
  const pg = document.getElementById('dzProg');
  if(pg) pg.textContent = dz.revealed.length + ' / ' + dz.k;
  const el = document.getElementById('dzPicked');
  if(el) el.innerHTML = dz.revealed.map(i=>{
    const p = dr.roster[i];
    return `<span class="dz-chip">${esc(p.n)}${p.no ? `<em>${esc(p.no)}</em>` : ''}</span>`;
  }).join('');
}
function dzAgain(){ dzStart(); }
function dzLeave(){ dzToken++; dz = null; dzPaste = false; go('home'); }
function dzEnter(){ dz = null; dzPaste = false; go('draw'); }

/* ---- 结果导出 ---- */
function dzCsv(s){ s = String(s == null ? '' : s); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function dzStamp(d){
  const p = x=>String(x).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth()+1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes());
}
function dzTimeText(d){
  const p = x=>String(x).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth()+1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
function dzCopy(){
  if(!dz || !dz.picked.length) return;
  const lines = ['序号\t姓名' + (dz.hasNo ? '\t工号' : '')];
  dz.picked.forEach((i, n)=>{
    const p = dr.roster[i];
    lines.push((n+1) + '\t' + p.n + (dz.hasNo ? '\t' + (p.no || '') : ''));
  });
  const txt = lines.join('\r\n');
  const done = ()=>dzToast('已复制，可直接粘贴到 Excel');
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(txt).then(done, ()=>dzCopyFallback(txt, done));
  } else dzCopyFallback(txt, done);
}
function dzCopyFallback(txt, done){
  const ta = document.createElement('textarea');
  ta.value = txt;
  ta.style.cssText = 'position:fixed;left:-9999px;top:0';
  document.body.appendChild(ta);
  ta.select();
  try{ document.execCommand('copy'); done(); }catch(e){ alert('复制失败，请手动选择文本复制'); }
  document.body.removeChild(ta);
}
function dzDownload(){
  if(!dz || !dz.picked.length) return;
  const lines = ['序号,姓名' + (dz.hasNo ? ',工号' : '')];
  dz.picked.forEach((i, n)=>{
    const p = dr.roster[i];
    lines.push((n+1) + ',' + dzCsv(p.n) + (dz.hasNo ? ',' + dzCsv(p.no || '') : ''));
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + lines.join('\r\n')], {type:'text/csv;charset=utf-8'}));
  a.download = '抽签结果_' + dzStamp(dz.at) + '.csv';
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 4000);
}

/* ---- 下载 xlsx 名单模板：手写最小 xlsx（ZIP stored + inlineStr），不引任何库 ---- */
function dzCrc32(u8){
  let crc = 0xFFFFFFFF;
  for(let i=0;i<u8.length;i++){
    let c = (crc ^ u8[i]) & 0xFF;
    for(let k=0;k<8;k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function dzZip(files, mime){
  const enc = new TextEncoder();
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const parts = [], central = [];
  let offset = 0;
  files.forEach(f=>{
    const nm = enc.encode(f.name), crc = dzCrc32(f.data), len = f.data.length;
    const lh = new Uint8Array(30 + nm.length), lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, 0, true); lv.setUint16(10, dosTime, true); lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true); lv.setUint32(18, len, true); lv.setUint32(22, len, true);
    lv.setUint16(26, nm.length, true); lv.setUint16(28, 0, true);
    lh.set(nm, 30);
    parts.push(lh, f.data);

    const cd = new Uint8Array(46 + nm.length), cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true); cv.setUint16(10, 0, true);
    cv.setUint16(12, dosTime, true); cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, len, true); cv.setUint32(24, len, true);
    cv.setUint16(28, nm.length, true); cv.setUint16(30, 0, true); cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true); cv.setUint16(36, 0, true); cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    cd.set(nm, 46);
    central.push(cd);
    offset += lh.length + len;
  });
  let cdSize = 0;
  central.forEach(c=>{ cdSize += c.length; });
  const eo = new Uint8Array(22), ev = new DataView(eo.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
  return new Blob(parts.concat(central, [eo]),
    {type: mime || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
function dzTemplateBlob(){
  const xe = s => String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
  const H = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const rows = [['姓名','工号'],['张三','1001'],['李四','1002'],['王五','1003']];
  const sheetData = rows.map((r, i)=>`<row r="${i+1}">` + r.map((v, c)=>
    `<c r="${dzColName(c)}${i+1}" t="inlineStr"><is><t>${xe(v)}</t></is></c>`).join('') + '</row>').join('');
  const raw = [
    ['[Content_Types].xml', H + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
      + '</Types>'],
    ['_rels/.rels', H + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
      + '</Relationships>'],
    ['xl/workbook.xml', H + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
      + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + '<sheets><sheet name="名单" sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', H + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
      + '</Relationships>'],
    ['xl/worksheets/sheet1.xml', H + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + '<cols><col min="1" max="1" width="14" customWidth="1"/><col min="2" max="2" width="14" customWidth="1"/></cols>'
      + '<sheetData>' + sheetData + '</sheetData></worksheet>'],
  ];
  const enc = new TextEncoder();
  const files = raw.map(f=>({name:f[0], data:enc.encode(f[1])}));
  return dzZip(files);
}
function dzDownloadTemplate(){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(dzTemplateBlob());
  a.download = '抽签名单模板.xlsx';
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 4000);
  dzToast('模板已下载，照着填姓名和工号');
}

/* ---- 抽签视图 ---- */
/* 预览只显示数据行：表头用名单自己的标题行，正文从「数据起始行」开始，
   所以标题行不会在正文里再出现一遍；行号列用原始 Excel 行号，便于和文件对照。 */
function dzTitleOf(rows, c){
  const t = dz.head >= 2 ? (rows[dz.head - 2] || []) : null;
  const v = t && t[c] != null ? String(t[c]).trim() : '';
  return v || ('第 ' + (c + 1) + ' 列');
}
function dzPreviewHTML(rows, maxRow, maxCol){
  const head = [];
  for(let c=0;c<maxCol;c++) head.push(`<th>${esc(dzTitleOf(rows, c))}</th>`);
  const start = Math.max(0, (dz.head | 0) - 1);
  const body = [];
  for(let i=start;i<Math.min(rows.length, start + maxRow);i++){
    const r = rows[i] || [], tds = [];
    for(let c=0;c<maxCol;c++) tds.push(`<td>${esc(r[c] == null ? '' : String(r[c]))}</td>`);
    body.push(`<tr><th>${i + 1}</th>${tds.join('')}</tr>`);
  }
  if(!body.length) return `<div class="dz-note" style="margin:0">起始行超出了表格范围，请检查「数据起始行」。</div>`;
  return `<table class="dz-tbl"><thead><tr><th>行</th>${head.join('')}</tr></thead><tbody>${body.join('')}</tbody></table>`;
}
function vDrawMap(){
  const rows = dz.sheets[dz.si].rows;
  const maxc = Math.max(dzMaxCols(rows), 2);
  const pv = Math.min(maxc, 8);
  const sheetSel = dz.sheets.length > 1 ? `
    <div class="dz-param"><label class="dz-lab">工作表</label>
      <select class="dz-sel" onchange="dzSetSheet(this.value)">
        ${dz.sheets.map((s, i)=>`<option value="${i}" ${i === dz.si ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
      </select></div>` : '';
  const est = dz.autoOk ? dzCountValid(rows, dz.head, dz.colName, dz.colNo) : 0;
  return `
  <div class="exam-topbar">
    <button class="btn ghost sm" onclick="dzCancelMap()">← 取消导入</button>
    <span class="exam-pos">${esc(dz.fname)}</span>
  </div>
  <div class="sec-title"><span class="diamond"></span><h2>确认名单</h2></div>
  <div class="card dz-card">
    ${dz.err ? `<div class="dz-warn">${dz.err}</div>` : ''}
    ${dz.autoOk ? `<div class="dz-note" style="margin:0">已按第一行标题识别：姓名列
      <b>${esc(dzTitleOf(rows, dz.colName))}</b>，工号列 <b>${esc(dzTitleOf(rows, dz.colNo))}</b>，
      数据从第 2 行开始。</div>` : `
      <div class="dz-warn">没认出「姓名」和「工号」列。请让名单的<b>第一行是标题行</b>，
        且包含「姓名」「工号」两列；也可以下载模板照着填。</div>
      <div class="dz-actions" style="justify-content:flex-start;margin-top:12px">
        <button class="btn primary sm" onclick="dzDownloadTemplate()">下载名单模板</button>
      </div>`}
    ${sheetSel}
    ${dz.autoOk ? `
    <div class="panel-title" style="margin-top:18px">数据预览</div>
    <div class="dz-scroll">${dzPreviewHTML(rows, 7, pv)}</div>
    <div class="dz-est">共识别到 <b class="num">${est}</b> 条记录</div>` : ''}
    <button class="btn primary dz-start" onclick="dzConfirmMap()" ${est ? '' : 'disabled'}>确认导入</button>
  </div>`;
}
function vDrawMain(){
  const n = dr.roster.length;
  const t = dzTarget(n, dr.pct, dr.rounding);
  const k = t.k, raw = t.raw;
  const zero = n > 0 && k <= 0;
  const whole = Math.abs(raw - Math.round(raw)) < 1e-9;
  const roster = n ? `
    <div class="dz-row">
      <span class="badge single">共 <b class="num">${n}</b> 人</span>
      <span class="dz-fname">${esc(dr.fname || '名单')}</span>
      <span class="dz-meta">
        <button class="btn ghost sm" onclick="dzPickFile()">重新导入</button>
        <button class="btn danger sm" onclick="dzClear()">清空</button>
      </span>
    </div>
    <div class="dz-note">名单编号 <b class="dz-fp">${dzHash(dr.roster)}</b>（抽签前记下，事后可核对名单有没有变过）</div>
    <div class="dz-chips dz-chips-all">
      ${dr.roster.map(p=>`<span class="dz-chip">${esc(p.n)}<em>${esc(p.no)}</em></span>`).join('')}
    </div>` : `
    <div class="dz-file">
      <div class="dz-fi">上传名单，需要<b>姓名</b>和<b>工号</b>两列</div>
      <div class="dz-actions">
        <button class="btn primary" onclick="dzPickFile()">选择文件</button>
        <button class="btn ghost" onclick="dzTogglePaste()">粘贴</button>
        <button class="btn ghost" onclick="dzDownloadTemplate()">下载模板</button>
      </div>
    </div>`;
  const paste = dzPaste ? `
    <div class="card dz-card">
      <div class="panel-title">粘贴名单</div>
      <div class="dz-note" style="margin:0">从 Excel 复制后粘贴到下面，一行一个人。</div>
      <textarea class="dz-paste" id="dzPasteBox" placeholder="工号&#9;姓名&#10;1001&#9;张三&#10;1002&#9;李四"></textarea>
      <div class="dz-actions" style="justify-content:flex-start;margin-top:12px">
        <button class="btn primary sm" onclick="dzPasteApply()">导入</button>
        <button class="btn ghost sm" onclick="dzTogglePaste()">取消</button>
      </div>
    </div>` : '';
  return `
  <div class="exam-topbar">
    <button class="btn ghost sm" onclick="dzLeave()">← 返回首页</button>
  </div>
  <div class="sec-title"><span class="diamond"></span><h2>抽签</h2></div>
  <div class="card dz-card">
    <div class="panel-title">参与名单</div>
    ${roster}
  </div>
  ${paste}
  <div class="card dz-card">
    <div class="panel-title">抽取设置</div>
    <div class="dz-param">
      <label class="dz-lab">抽取比例</label>
      <div class="dz-pct">
        <input class="tp-num" type="number" min="0.1" max="100" step="0.1" value="${dr.pct}" onchange="dzSetPct(this.value)">
        <span>%</span>
      </div>
    </div>
    <div class="dz-param">
      <label class="dz-lab">取整方式</label>
      <div class="dz-seg">
        ${[['floor','向下取整'],['ceil','向上取整'],['round','四舍五入']].map(o=>
          `<div class="seg ${dr.rounding === o[0] ? 'on' : ''}" onclick="dzSetRound('${o[0]}')">${o[1]}</div>`).join('')}
      </div>
    </div>
    <div class="dz-calc">
      <span>${n ? `${n} × ${dr.pct}% = ${dzFmt(raw)}` : '还没导入名单'}</span>
      ${n && !whole ? `<span class="dz-arrow">→</span><span>${DZ_ROUND_LABEL[dr.rounding]}</span>` : ''}
      <span class="dz-arrow">→</span>
      <b>抽 ${k} 人</b>
    </div>
    ${zero ? `<div class="dz-warn">按这个比例应抽 <b>0</b> 人，请把比例调大一点。</div>` : ''}
    <div class="dz-param" style="margin:16px 0 0">
      <label class="dz-lab">抽取速度</label>
      <div class="dz-seg">
        ${[['fast','快'],['mid','中'],['slow','慢']].map(o=>
          `<div class="seg ${dr.speed === o[0] ? 'on' : ''}" onclick="dzSetSpeed('${o[0]}')">${o[1]}</div>`).join('')}
      </div>
    </div>
    <button class="btn primary dz-start" onclick="dzStart()" ${(!n || zero) ? 'disabled' : ''}>开始抽签</button>
  </div>`;
}
function vDrawRun(){
  return `
  <div class="exam-topbar">
    <button class="btn ghost sm" onclick="dzLeave()">← 返回首页</button>
    <div class="et-info">
      <span class="exam-pos">名单 ${dr.roster.length} 人 · 抽 ${dz.k} 人</span>
    </div>
  </div>
  <div class="card dz-stage">
    <div class="dz-stagehead">
      <span id="dzStageMsg">抽取中…</span>
      <span class="dz-prog num" id="dzProg">0 / ${dz.k}</span>
    </div>
    <div class="dz-rollbox"><div class="dz-rollname" id="dzRoll">准备中</div></div>
    <div class="dz-actions">
      <button class="btn ghost" id="dzSkipBtn" onclick="dzSkip()">跳过动画</button>
      <button class="btn ghost" id="dzAgainBtn" style="display:none" onclick="dzAgain()">重新抽签</button>
      <button class="btn ghost" id="dzCopyBtn" style="display:none" onclick="dzCopy()">复制结果</button>
      <button class="btn primary" id="dzDlBtn" style="display:none" onclick="dzDownload()">下载表格</button>
    </div>
    <div class="dz-note" style="text-align:center">名单编号 <b class="dz-fp">${dz.hash}</b> · ${dzTimeText(dz.at)}</div>
  </div>
  <div class="card dz-card" style="margin-top:16px">
    <div class="panel-title">中签名单</div>
    <div class="dz-chips" id="dzPicked"></div>
  </div>`;
}
function vDraw(){
  if(dz && dz.mode === 'map') return vDrawMap();
  if(dz && dz.mode === 'run') return vDrawRun();
  return vDrawMain();
}

/* ================= 生成试卷 =================
   在浏览器里按各岗位考试方案组出纸质试卷：空白卷、答题卡、参考答案，
   汇成一个打印版文档（新窗口打开即可打印或另存 PDF）。
   组卷与模拟考试共用同一套抽题逻辑与默认口径（80 题、每题 1 分）。
   每次生成可下载「组卷记录」xlsx 留档；加印时导入记录即可原样重出同一张卷。 */
const PAPER_LETTERS = ['A','B','C','D','E','F','G','H'];
let paper = null;                    // 本次会话的生成结果 {at, papers:[{pi, list:[qi]}]}

function metaTitle(){ return (BANK.meta && (BANK.meta['工具标题'] || BANK.meta.title)) || ''; }
function paperEnter(){ go('paper'); }
/* 试卷设置存本机（题型题量全局共用；抽取规则仅在勾选单个岗位时可自定义，记岗位） */
function paperTypes(){ return st.paperTypes || DEFAULT_TYPES.slice(); }
function paperRuleFor(pi){
  return (st.paperRule && st.paperRule.pi === pi) ? st.paperRule.rule : defaultRule(pi);
}
function paperToggleSel(pi){
  const s = st.paperSel || (st.paperSel = []);
  const i = s.indexOf(pi);
  if(i >= 0) s.splice(i, 1); else s.push(pi);
  save(); render();
}
function paperSelAll(on){
  st.paperSel = on ? BANK.positions.map((_, i)=>i) : [];
  save(); render();
}
function paperAnsStr(q){
  return q.t === 2 ? q.a : (q.t === 1 ? [...q.a].sort().join('') : q.a);
}
/* 组一个岗位的卷子：与模拟考试同一套 genPaper；规则按「勾选单岗位时的自定义，否则方案默认口径」 */
function paperGenOne(pi){
  return genPaper(pi, paperTypes(), paperRuleFor(pi));
}
function paperGenerate(){
  const sel = [...new Set(st.paperSel || [])].sort((a, b)=>a - b).filter(pi=>pi >= 0 && pi < BANK.positions.length);
  if(!sel.length){ alert('请先勾选要出卷的岗位'); return; }
  const types = readTypeInputs('pp');
  const single = sel.length === 1 ? sel[0] : -1;
  const rule = single >= 0 ? readRuleInputs('pp', single) : null;
  const err = checkSetup(types, rule);
  if(err){ alert(err); return; }
  st.paperTypes = types; save();
  if(single >= 0){ st.paperRule = {pi: single, rule}; save(); }
  paper = { at: new Date(), papers: sel.map(pi=>({pi, list: genPaper(pi, types, single >= 0 ? rule : defaultRule(pi))})) };
  render();
  paperOpenPrint();
}

/* ---- 打印版文档 ---- */
function paperSegItems(p, t){
  const items = [];
  p.list.forEach((qi, i)=>{ if(qAt(qi).t === t) items.push({qi, i}); });
  return items;
}
function paperQBlock(q, no){
  const stem = q.t === 2 ? esc(q.s) + '（　　）' : esc(q.s);
  let opts = '';
  if(q.t !== 2){
    const len = Math.max(...q.o.map(t=>[...String(t)].length));
    const cls = len <= 8 ? 'c4' : (len <= 22 ? 'c2' : 'c1');
    opts = `<div class="qo ${cls}">` + q.o.map((t, i)=>`<span>${PAPER_LETTERS[i]}．${esc(t)}</span>`).join('') + `</div>`;
  }
  return `<div class="q"><div class="qs"><b>${no}.</b>${stem}</div>${opts}</div>`;
}
function paperSheetHTML(p, first){
  const pos = BANK.positions[p.pi];
  const segNames = ['一、单选题','二、多选题','三、判断题'];
  const segs = [0,1,2].map(t=>{
    const items = paperSegItems(p, t);
    if(!items.length) return '';
    let sub = `（共 ${items.length} 题，每题 1 分）`;
    if(t === 2) sub = `（共 ${items.length} 题，每题 1 分；正确的在括号内写「对」，错误的写「错」）`;
    return `<div class="psec">${segNames[t]}${sub}</div>` + items.map(x=>paperQBlock(qAt(x.qi), x.i + 1)).join('');
  }).join('');
  return `
  <section class="sheet${first ? '' : ' pb'}">
    <div class="ptitle">${esc(metaTitle())}</div>
    <div class="psub">${esc(pos.name)}　·　试卷</div>
    <div class="phrow"><span>姓名：＿＿＿＿＿＿</span><span>工号：＿＿＿＿＿＿</span><span>得分：＿＿＿＿＿＿</span></div>
    <div class="pnote">本卷共 ${p.list.length} 题，每题 1 分，满分 ${p.list.length} 分；请将答案填写在每题的括号内。选择题只有一个正确答案的为单选题，有两个及以上正确答案的为多选题。</div>
    ${segs}
  </section>`;
}
function paperCardHTML(p){
  const pos = BANK.positions[p.pi];
  const segNames = ['一、单选题','二、多选题','三、判断题'];
  const segs = [0,1,2].map(t=>{
    const items = paperSegItems(p, t);
    if(!items.length) return '';
    const half = Math.ceil(items.length / 2);
    const col = arr => arr.map(x=>{
      const q = qAt(x.qi);
      const boxes = q.t === 2
        ? `<span class="bx bxt">对</span><span class="bx bxt">错</span>`
        : q.o.map((_, k)=>`<span class="bx">${PAPER_LETTERS[k]}</span>`).join('');
      return `<div class="ac-q"><span class="ac-n">${x.i + 1}</span>${boxes}</div>`;
    }).join('');
    return `<div class="ac-sec">${segNames[t]}（第 ${items[0].i + 1}～${items[items.length - 1].i + 1} 题${t === 1 ? '，可涂多个' : ''}）</div>
      <div class="ac-cols"><div class="ac-col">${col(items.slice(0, half))}</div><div class="ac-col">${col(items.slice(half))}</div></div>`;
  }).join('');
  return `
  <section class="sheet pb">
    <div class="ptitle">${esc(metaTitle())} · 答题卡</div>
    <div class="psub">${esc(pos.name)}</div>
    <div class="phrow"><span>姓名：＿＿＿＿＿＿</span><span>工号：＿＿＿＿＿＿</span></div>
    <div class="pnote">请用黑色签字笔将所选选项的字母框涂满涂黑；判断题涂「对」或「错」。</div>
    ${segs}
  </section>`;
}
function paperKeyHTML(p){
  const pos = BANK.positions[p.pi];
  const segNames = ['一、单选题','二、多选题','三、判断题'];
  const segs = [0,1,2].map(t=>{
    const items = paperSegItems(p, t);
    if(!items.length) return '';
    return `<div class="ac-sec">${segNames[t]}</div>
      <div class="kgrid">${items.map(x=>`<span class="kit"><b>${x.i + 1}</b>${esc(paperAnsStr(qAt(x.qi)))}</span>`).join('')}</div>`;
  }).join('');
  return `
  <section class="sheet pb">
    <div class="ptitle">${esc(metaTitle())} · 参考答案</div>
    <div class="psub">${esc(pos.name)}　·　${dzTimeText(paper.at)}</div>
    ${segs}
    <div class="pnote" style="margin-top:20px">本页为阅卷用参考答案，请单独保管，勿随试卷下发。</div>
  </section>`;
}
function paperPrintCSS(){
  return `
@page{size:A4;margin:13mm 12mm}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:"Source Han Serif SC","Noto Serif CJK SC","SimSun","STSong",serif;color:#000;background:#fff;font-size:12.5px;line-height:1.7}
.toolbar{position:sticky;top:0;z-index:9;display:flex;gap:10px;justify-content:center;padding:10px;background:#f2f2f2;border-bottom:1px solid #ddd;font-family:system-ui,"Microsoft YaHei",sans-serif}
.toolbar button{padding:8px 24px;border:1px solid #bbb;border-radius:6px;background:#fff;font-size:13px;cursor:pointer}
.toolbar button.primary{background:#1a73e8;color:#fff;border-color:#1a73e8}
.sheet{max-width:186mm;margin:0 auto;padding:5mm 0}
.sheet.pb{page-break-before:always}
.ptitle{text-align:center;font-size:19px;font-weight:700;letter-spacing:2px}
.psub{text-align:center;font-size:12px;margin-top:3px;letter-spacing:1px}
.phrow{display:flex;justify-content:space-between;gap:12px;border-bottom:1.5px solid #000;padding:7px 2px 6px;margin:10px 0 6px;font-size:12.5px}
.pnote{font-size:10.5px;color:#333;margin-bottom:10px;line-height:1.6}
.psec{font-weight:700;font-size:13.5px;margin:12px 0 6px}
.q{break-inside:avoid;margin-bottom:8px}
.qs{font-size:12.5px}
.qs b{margin-right:3px}
.qo{display:grid;gap:1px 16px;padding-left:20px}
.qo.c4{grid-template-columns:repeat(4,1fr)}
.qo.c2{grid-template-columns:repeat(2,1fr)}
.qo.c1{grid-template-columns:1fr}
.ac-sec{font-weight:700;font-size:13px;margin:10px 0 5px}
.ac-cols{display:flex;gap:16px}
.ac-col{flex:1;min-width:0}
.ac-q{display:flex;align-items:center;gap:3px;margin-bottom:3px;break-inside:avoid}
.ac-n{flex:none;width:24px;text-align:right;font-size:10.5px;font-family:Tahoma,"Microsoft YaHei",sans-serif}
.bx{flex:none;width:14px;height:14px;border:1px solid #000;border-radius:2px;display:inline-flex;align-items:center;justify-content:center;font-size:9px;font-family:Tahoma,"Microsoft YaHei",sans-serif;line-height:1}
.bxt{font-size:8px}
.kgrid{display:flex;flex-wrap:wrap;gap:3px 4px}
.kit{width:62px;font-size:12.5px}
.kit b{margin-right:3px}
@media print{.toolbar{display:none}.sheet{max-width:none;padding:0}}`;
}
function paperPrintHTML(){
  const title = metaTitle() || '试卷';
  const sec1 = paper.papers.map((p, i)=>paperSheetHTML(p, i === 0)).join('');
  const sec2 = paper.papers.map(p=>paperCardHTML(p)).join('');
  const sec3 = paper.papers.map(p=>paperKeyHTML(p)).join('');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>${esc(title)}（打印版）</title>
<style>${paperPrintCSS()}</style>
</head>
<body>
<div class="toolbar"><button class="primary" onclick="window.print()">打印 / 保存 PDF</button><button onclick="window.close()">关闭</button></div>
${sec1}${sec2}${sec3}
<script>window.addEventListener('load', function(){ setTimeout(function(){ window.print(); }, 350); });<\/script>
</body>
</html>`;
}
function paperOpenPrint(){
  if(!paper || !paper.papers.length) return;
  const blob = new Blob([paperPrintHTML()], {type:'text/html'});
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank');
  setTimeout(()=>URL.revokeObjectURL(url), 60000);
  if(!w) alert('浏览器拦截了新窗口，请允许本页面弹出窗口后，再点一次「打印 / 保存 PDF」。');
}

/* ---- 组卷记录：下载留档 + 导入重印 ---- */
/* 行数组 -> 最小 xlsx（全部 inlineStr 文本，复用手写 ZIP），供记录导出与测试构造 */
function ppSheetBlob(sheets){
  const xe = s => String(s == null ? '' : s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
  const H = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const ct = H + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + sheets.map((_, i)=>`<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + '</Types>';
  const rels = H + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
    + '</Relationships>';
  const wb = H + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
    + sheets.map((s, i)=>`<sheet name="${xe(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')
    + '</sheets></workbook>';
  const wbRels = H + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + sheets.map((_, i)=>`<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
    + '</Relationships>';
  const sheetXml = s => H + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + `<cols><col min="1" max="${Math.max(1, s.cols || 4)}" width="16" customWidth="1"/></cols>`
    + '<sheetData>' + s.rows.map((r, ri)=>`<row r="${ri + 1}">` + r.map((v, c)=>
      `<c r="${dzColName(c)}${ri + 1}" t="inlineStr"><is><t>${xe(v)}</t></is></c>`).join('') + '</row>').join('')
    + '</sheetData></worksheet>';
  const enc = new TextEncoder();
  const files = [
    ['[Content_Types].xml', ct], ['_rels/.rels', rels],
    ['xl/workbook.xml', wb], ['xl/_rels/workbook.xml.rels', wbRels],
    ...sheets.map((s, i)=>[`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)]),
  ].map(f=>({name:f[0], data:enc.encode(f[1])}));
  return dzZip(files);
}
function paperRecordRows(){
  const rows = [['岗位','题型','卷面题号','题库题号','章节','答案']];
  paper.papers.forEach(p=>{
    const pos = BANK.positions[p.pi];
    p.list.forEach((qi, i)=>{
      const q = qAt(qi);
      rows.push([pos.name, TYPES[q.t], String(i + 1), String(qi + 1), BANK.chapters[q.ch], paperAnsStr(q)]);
    });
  });
  return rows;
}
function paperRecordBlob(){
  const total = paper.papers.reduce((a, p)=>a + p.list.length, 0);
  const types = paperTypes();
  const info = [
    ['项目','内容'],
    ['工具标题', metaTitle()],
    ['生成时间', dzTimeText(paper.at)],
    ['试卷份数', String(paper.papers.length)],
    ['每卷题数', String(paper.papers.length ? Math.round(total / paper.papers.length) : 0)],
    ['题型分布', `单选${types[0]} · 多选${types[1]} · 判断${types[2]}`],
  ];
  return ppSheetBlob([
    {name:'组卷记录', rows:paperRecordRows(), cols:6},
    {name:'信息', rows:info, cols:2},
  ]);
}
function paperDownloadRecord(){
  if(!paper || !paper.papers.length) return;
  const tag = paper.papers.length === 1 ? '_' + BANK.positions[paper.papers[0].pi].name : '';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(paperRecordBlob());
  a.download = ('组卷记录' + tag + '_' + dzStamp(paper.at)).replace(/[\\/:*?"<>|]/g, '') + '.xlsx';
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 4000);
  dzToast('组卷记录已下载，留档备查');
}
/* 导入组卷记录原样重印：逐行校验岗位/题号/章节/答案与当前题库一致，
   不一致说明题库已更新或记录被改动，拒绝重印避免印出错卷。 */
function paperImportRecord(){
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.xlsx';
  inp.onchange = async ()=>{
    const f = inp.files && inp.files[0];
    if(!f) return;
    try{
      const sheets = await dzReadXlsx(f);
      const sh = sheets.find(s=>s.name === '组卷记录') || sheets[0];
      const rows = sh.rows;
      const head = rows[0] || [];
      let cPos = -1, cQno = -1, cIno = -1, cChap = -1, cAns = -1;
      head.forEach((v, c)=>{
        const t = String(v == null ? '' : v);
        if(/岗位/.test(t)) cPos = c;
        else if(/题库|题目编号/.test(t)) cQno = c;      // 先认题库题号，避免「卷面题号」抢先
        else if(/卷面|题号/.test(t)) cIno = c;
        else if(/章节/.test(t)) cChap = c;
        else if(/答案/.test(t)) cAns = c;
      });
      if(cPos < 0 || cQno < 0 || cIno < 0 || cAns < 0)
        throw new Error('认不出「岗位 / 题库题号 / 卷面题号 / 答案」列，请确认导入的是本工具下载的组卷记录。');
      const errs = [], byPos = {};
      for(let r = 1; r < rows.length; r++){
        const row = rows[r] || [];
        const posName = String(row[cPos] == null ? '' : row[cPos]).trim();
        const qnoTxt = String(row[cQno] == null ? '' : row[cQno]).trim();
        if(!posName && !qnoTxt) continue;
        const at = `第 ${r + 1} 行`;
        const pi = BANK.positions.findIndex(p=>p.name === posName);
        if(pi < 0){ errs.push(`${at}：岗位「${posName}」在当前工具里不存在`); continue; }
        const qno = Number(qnoTxt);
        if(!Number.isInteger(qno) || qno < 1 || qno > BANK.q.length){ errs.push(`${at}：题库题号「${qnoTxt}」超出题库范围`); continue; }
        const qi = qno - 1, q = BANK.q[qi];
        if(cChap >= 0){
          const chap = String(row[cChap] == null ? '' : row[cChap]).trim();
          if(chap && BANK.chapters[q.ch] !== chap){ errs.push(`${at}：章节不符（记录「${chap}」，当前题库为「${BANK.chapters[q.ch]}」）`); continue; }
        }
        if(cAns >= 0){
          const ans = String(row[cAns] == null ? '' : row[cAns]).trim();
          if(ans && paperAnsStr(q) !== ans){ errs.push(`${at}：答案不符（记录「${ans}」，当前题库为「${paperAnsStr(q)}」）`); continue; }
        }
        const ino = Number(String(row[cIno] == null ? '' : row[cIno]).trim());
        if(!Number.isInteger(ino) || ino < 1){ errs.push(`${at}：卷面题号缺失或不是数字`); continue; }
        (byPos[pi] || (byPos[pi] = [])).push({ino, qi, at});
      }
      if(errs.length){
        alert('组卷记录无法原样重出：\n' + errs.slice(0, 6).join('\n') + (errs.length > 6 ? `\n……共 ${errs.length} 处` : '')
          + '\n\n常见原因：题库更新后旧记录不再匹配，请重新生成试卷。');
        return;
      }
      const papers = [];
      Object.keys(byPos).map(Number).sort((a, b)=>a - b).forEach(pi=>{
        const items = byPos[pi].sort((a, b)=>a.ino - b.ino);
        for(let i = 0; i < items.length; i++){
          if(items[i].ino !== i + 1) throw new Error(`岗位「${BANK.positions[pi].name}」卷面题号不连续（应为 1～${items.length}），记录可能被改动过。`);
        }
        papers.push({pi, list: items.map(x=>x.qi)});
      });
      if(!papers.length){ alert('记录里没有可用的题目行。'); return; }
      paper = {at: new Date(), papers};
      render();
      paperOpenPrint();
    }catch(e){
      alert('导入失败：' + ((e && e.message) || e));
    }
  };
  inp.click();
}

/* ---- 生成试卷视图 ---- */
function vPaper(){
  return paper ? vPaperDone() : vPaperSetup();
}
function vPaperSetup(){
  const sel = st.paperSel || [];
  const single = sel.length === 1 ? sel[0] : -1;
  const types = paperTypes();
  const rule = single >= 0 ? paperRuleFor(single) : null;
  SETUP_PANELS['pp'] = {pi: ()=> (st.paperSel || []).length === 1 ? st.paperSel[0] : -1};
  const rows = {
    ruleRows: single >= 0 ? ruleRowsHTML(BANK.positions[single], rule, 'pp') : '',
    typeRows: typeRowsHTML(types, 'pp'),
  };
  const posRows = BANK.positions.map((p, i)=>{
    const pool = poolFor(i);
    return `<div class="unit-row ${sel.includes(i) ? 'on' : ''}" onclick="paperToggleSel(${i})">
      <span class="u-box">${sel.includes(i) ? '✓' : ''}</span>
      <span class="u-name">${esc(p.name)}</span>
      <span class="u-num num">${pool.A.length + pool.B.length + pool.C.length} 题</span>
    </div>`;
  }).join('');
  const ruleBlock = single >= 0 ? `
    <div class="es-sec">抽取规则</div>
    <div class="type-panel">
      ${rows.ruleRows}
      <div class="tp-total">合计 <b id="ppruleTotal" class="num">${ruleTotalOf(rule)}</b> 题</div>
    </div>` : `
    <div class="es-sec">抽取规则</div>
    <div class="type-panel" style="padding:12px 15px">
      <div class="dz-note" style="margin:0">勾选了 ${sel.length} 个岗位，各岗位方案不同，抽取规则按<b>各自方案默认口径</b>执行；只勾选一个岗位时，可以在这里自定义。</div>
    </div>`;
  return `
  <div class="exam-topbar">
    <button class="btn ghost sm" onclick="go('home')">← 返回首页</button>
  </div>
  <div class="sec-title"><span class="diamond"></span><h2>生成试卷</h2></div>
  <div class="card dz-card">
    <div class="es-notice" style="margin:0 0 16px">勾选岗位，每个岗位出一套纸质试卷：单选 ${types[0]} 题 + 多选 ${types[1]} 题 + 判断 ${types[2]} 题，每题 1 分共 80 分，与线上模拟考试同一套抽题逻辑，默认按《实施方案》口径，可展开「自定义设置」调整。每套包含<b>空白试卷、答题卡、参考答案</b>三部分，打印时按材料分开取用。</div>
    <div class="panel-title">选择岗位</div>
    <div class="dz-row" style="margin:10px 0 12px">
      <button class="btn ghost sm" onclick="paperSelAll(true)">全选</button>
      <button class="btn ghost sm" onclick="paperSelAll(false)">清空</button>
    </div>
    <div class="type-panel" style="gap:9px">${posRows}</div>
    <div class="setup-toggle" onclick="togglePanel('ppSetupPanel', 'ppStArrow')">
      <span class="st-t">自定义设置</span>
      <span class="st-sub">默认按《实施方案》，可调整</span>
      <span class="st-arrow" id="ppStArrow">▾</span>
    </div>
    <div id="ppSetupPanel" class="setup-panel" style="display:none">
      ${ruleBlock}
      <div class="es-sec">题型题量</div>
      <div class="type-panel">
        ${rows.typeRows}
        <div class="tp-total">合计 <b id="pptpTotal" class="num">${types.reduce((a,b)=>a+b,0)}</b> 题</div>
      </div>
    </div>
    <div class="es-actions" style="position:static;background:none;padding:20px 0 0">
      <button class="btn ghost" onclick="paperImportRecord()">按记录重印</button>
      <button class="btn primary" onclick="paperGenerate()" ${sel.length ? '' : 'disabled'}>生成试卷${sel.length ? `（${sel.length} 个岗位）` : ''}</button>
    </div>
    <div class="dz-note">要加印之前出过的卷子？点「按记录重印」，导入当时下载的组卷记录，就能印出一模一样的卷子。</div>
  </div>`;
}
function vPaperDone(){
  const chips = paper.papers.map(p=>
    `<span class="dz-chip">${esc(BANK.positions[p.pi].name)}<em>${p.list.length} 题</em></span>`).join('');
  return `
  <div class="exam-topbar">
    <button class="btn ghost sm" onclick="paper=null;render()">← 重新选择岗位</button>
    <div class="et-info"><span class="exam-pos">${dzTimeText(paper.at)} 生成</span></div>
  </div>
  <div class="sec-title"><span class="diamond"></span><h2>试卷已生成</h2></div>
  <div class="card dz-card">
    <div class="dz-row">${chips}</div>
    <div class="es-actions" style="position:static;background:none;padding:20px 0 4px">
      <button class="btn primary" onclick="paperOpenPrint()">打印 / 保存 PDF</button>
      <button class="btn ghost" onclick="paperDownloadRecord()">下载组卷记录</button>
    </div>
    <div class="dz-note">打印窗口里选打印机即可印卷，选「另存为 PDF」可存档。组卷记录请留档：加印时导入它即可原样重出，不会变成另一套题。<b>答案部分在文档最后，请单独取走，不要随空白卷一起下发。</b></div>
  </div>`;
}

render();
if(view==='exam' && exam) examTimerLoop();

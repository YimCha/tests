/* ================= 状态 ================= */
const KEY = 'srbank_v1';
const TYPES = ['单选题','多选题','判断题'];
const TYPE_SHORT = ['单选','多选','判断'];
let st = load();
let pools = buildPools();
let view = 'home';

function load(){
  try{ const d = JSON.parse(localStorage.getItem(KEY));
    return Object.assign({pos:0, types:[40,25,15], rule:null, dur:60}, d);
  }catch(e){ return {pos:0, types:[40,25,15], rule:null, dur:60}; }
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
  app.innerHTML = html;
  app.classList.toggle('wide', view==='exam' && !exam);
  if(view==='exam' && exam) drawExam();
  bindGlobal();
}
function setPos(i){ st.pos=i; st.rule=null; save(); go('exam'); }

/* ================= 首页 ================= */
function vHome(){
  const cards = BANK.positions.map((p,i)=>{
    const pool = poolFor(i);
    const cls = {A:pool.A.length, B:pool.B.length, C:pool.C.length};
    const tot = cls.A+cls.B+cls.C;
    const w = {A:cls.A/tot*100, B:cls.B/tot*100, C:cls.C/tot*100};
    return `
    <div class="card pos-card ${i===st.pos?'on':''}" onclick="setPos(${i})">
      <div class="pc-check">✓</div>
      <div class="pc-name">${p.name}</div>
      <div class="pc-sub">A类 ${cls.A} · B类 ${cls.B} · C类 ${cls.C}</div>
      <div class="pc-num">${tot}<small> 题</small></div>
      <div class="bar3">
        <i class="ba" style="width:${w.A}%"></i>
        <i class="bb" style="width:${w.B}%"></i>
        <i class="bc" style="width:${w.C}%"></i>
      </div>
      <div class="pc-legend">
        <span><i style="background:var(--a)"></i>A</span>
        <span><i style="background:var(--b)"></i>B</span>
        <span><i style="background:var(--c)"></i>C</span>
      </div>
    </div>`;
  }).join('');
  return `
  <div class="sec-title"><span class="diamond"></span><h2>选择考试岗位</h2></div>
  <div class="grid c3">${cards}</div>`;
}

/* ================= 答题交互 ================= */
function onOptClick(el){
  const qi = +el.dataset.qi;
  if(view==='exam' && exam && !exam.done) toggleExamSelect(qi, el);
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

// 每题 1 分：按分值抽题即按题数抽题（池内随机抽）
function pickPoints(qids, pts){ return shuffle(qids).slice(0, pts); }
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
// 从单元池抽指定题型 n 题；该题型不足时用同单元其他题型补足，保证单元题数=目标
function pickTyped(pool, type, n){
  const typed = pool.filter(qi=>qAt(qi).t===type);
  const other = pool.filter(qi=>qAt(qi).t!==type);
  const r = pickPoints(typed, n);
  if(r.length<n) r.push(...pickPoints(other, n-r.length));
  return r;
}
function genPaper(pi, types, rule){
  const pos = BANK.positions[pi], pool = poolFor(pi);
  const units = [{pool:pool.A, target:rule.A}];
  pos.b.forEach((g,i)=>units.push({pool:pool.B.filter(qi=>g[0].includes(deptOf(qi))), target:rule.B[i]}));
  pos.c.forEach((g,i)=>units.push({pool:pool.C.filter(qi=>g[0].includes(deptOf(qi))), target:rule.C[i]}));
  const M = genMatrix(types, units.map(u=>u.target));
  const paper = [];
  types.forEach((_,t)=>units.forEach((u,c)=>{
    paper.push(...pickTyped(u.pool, t, M[t][c]));
  }));
  return paper.sort((x,y)=>qAt(x).t - qAt(y).t);
}
function readTypes(){ return [0,1,2].map(i=>Math.max(0, Math.round(+document.getElementById('tp'+i).value)||0)); }
function syncType(){
  const t = readTypes(), el = document.getElementById('tpTotal');
  if(el) el.textContent = t.reduce((a,b)=>a+b,0);
  updateInfoCard();
}
function adjustType(i,d){
  const el = document.getElementById('tp'+i);
  const v = (+el.value||0)+d;
  if(v<0) return;
  el.value = v; syncType();
}
function adjustRule(id,d){
  const el = document.getElementById(id);
  const v = (+el.value||0)+d;
  if(v<0) return;
  el.value = v; syncRule();
}
function readRule(){
  const pos = BANK.positions[st.pos];
  return {
    A: Math.max(0, Math.round(+document.getElementById('ruleA').value)||0),
    B: pos.b.map((_,i)=>Math.max(0, Math.round(+document.getElementById('ruleB'+i).value)||0)),
    C: pos.c.map((_,i)=>Math.max(0, Math.round(+document.getElementById('ruleC'+i).value)||0)),
  };
}
function syncRule(){
  const pos = BANK.positions[st.pos];
  const ids = ['ruleA', ...pos.b.map((_,i)=>'ruleB'+i), ...pos.c.map((_,i)=>'ruleC'+i)];
  const vals = ids.map(id=>Math.max(0, Math.round(+document.getElementById(id).value)||0));
  const t = vals.reduce((a,b)=>a+b,0);
  const el = document.getElementById('ruleTotal');
  if(el) el.textContent = t;
  updateInfoCard();
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
  const types = readTypes();
  const total = types.reduce((a,b)=>a+b,0);
  if(total!==80){ alert(`题型题量合计需为 80 题（当前 ${total}）`); return; }
  const rule = readRule();
  const rtotal = rule.A + rule.B.reduce((a,b)=>a+b,0) + rule.C.reduce((a,b)=>a+b,0);
  if(rtotal!==80){ alert(`抽取规则合计需为 80 题（当前 ${rtotal}）`); return; }
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
  const rule = st.rule || {A:pos.ratio[0], B:pos.b.map(g=>g[1]), C:pos.c.map(g=>g[1])};
  const rA = rule.A, rB = rule.B.reduce((a,b)=>a+b,0), rC = rule.C.reduce((a,b)=>a+b,0);
  const ruleRows = [
    {id:'ruleA', tag:'A', sub:'所有部门 A 类题合集', val:rule.A},
    ...pos.b.map((g,i)=>({id:'ruleB'+i, tag:'B', sub:grpText(g), val:rule.B[i]})),
    ...pos.c.map((g,i)=>({id:'ruleC'+i, tag:'C', sub:grpText(g), val:rule.C[i]})),
  ].map(r=>`
    <div class="tp-row">
      <span class="rp-tag" style="--c:${CLS_INFO[r.tag]}">${r.tag}</span>
      <span class="tp-name">${r.sub}</span>
      <button class="tp-btn" onclick="adjustRule('${r.id}',-1)">−</button>
      <input class="tp-num num" id="${r.id}" type="number" value="${r.val}" min="0" oninput="syncRule()">
      <button class="tp-btn" onclick="adjustRule('${r.id}',1)">+</button>
    </div>`).join('');
  const tpRows = TYPES.map((n,t)=>`
    <div class="tp-row">
      <span class="tp-name">${n}</span>
      <button class="tp-btn" onclick="adjustType(${t},-1)">−</button>
      <input class="tp-num num" id="tp${t}" type="number" value="${st.types[t]}" min="0" oninput="syncType()">
      <button class="tp-btn" onclick="adjustType(${t},1)">+</button>
    </div>`).join('');
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
function toggleSetup(){
  const p = document.getElementById('setupPanel');
  const on = p.style.display!=='none';
  p.style.display = on?'none':'block';
  const a = document.getElementById('stArrow');
  if(a) a.textContent = on?'▸':'▾';
}
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


/* ================= 题目卡渲染 ================= */
function qCard(qi, o){
  const q=qAt(qi);
  const letters=['A','B','C','D','E','F','G','H'];
  let opts;
  if(q.t===2){
    opts=['对','错'].map((v,i)=>`
      <div class="opt ${o.sel.includes(v)?'sel':''}" data-qi="${qi}" data-key="${v}">
        <span class="key">${v==='对'?'✓':'✕'}</span><span class="txt">${v}</span><span class="tick">✓</span></div>`).join('');
  } else {
    opts=q.o.map((txt,i)=>`
      <div class="opt ${o.sel.includes(letters[i])?'sel':''}" data-qi="${qi}" data-key="${letters[i]}">
        <span class="key">${letters[i]}</span><span class="txt">${esc(txt)}</span><span class="tick">✓</span></div>`).join('');
  }
  const badge = q.t===0?'single':(q.t===1?'multi':'judge');
  const chap = o.chapName? `<span class="badge chap">${o.chapName}</span>`:'';
  const marked = o.exam && exam && exam.mark[qi]? `<span class="badge" style="color:var(--bad);border:1px solid rgba(233,104,116,.4);background:rgba(233,104,116,.1)">已标记</span>`:'';
  const isLast = o.exam && exam && exam.cur>=exam.paper.length-1;
  const examFoot = o.exam && exam ? `
    <div class="q-foot">
      <button class="btn ghost" onclick="prevExam()">上一题</button>
      <button class="btn ${exam.mark[qi]?'primary':'ghost'}" onclick="toggleMark()">${exam.mark[qi]?'已标记':'标记'}</button>
      <span class="q-foot-spacer"></span>
      <button class="btn ${isLast?'primary':'ghost'}" onclick="submitExam()">交卷</button>
      ${isLast?'':`<button class="btn primary" onclick="nextExam()">下一题</button>`}
    </div>`:'';
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
    ${examFoot}
  </div>`;
}
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

render();
if(view==='exam' && exam) examTimerLoop();

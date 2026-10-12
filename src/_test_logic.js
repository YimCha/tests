const fs = require('fs');
const path = require('path');
const outMeta = JSON.parse(fs.readFileSync(path.join(__dirname, 'debug', '_output.json'), 'utf-8'));
const html = fs.readFileSync(path.join(__dirname, '..', outMeta.file), 'utf-8');
const m = html.match(/const BANK = (.*?);\s*<\/script>/s);
const BANK = JSON.parse(m[1]);
function buildPools(){ return BANK.positions.map((_,pi)=>{ const A=[],B=[],C=[];
  BANK.q.forEach((q,qi)=>{ if(!q.p.includes(pi)) return; const ch=BANK.chapters[q.ch];
    if(ch.endsWith('A类'))A.push(qi); else if(ch.endsWith('B类'))B.push(qi); else C.push(qi);});
  return {A,B,C,all:[...A,...B,...C]}; }); }
function shuffle(a){ a=[...a]; for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; }
const pointOf=()=>1;
const deptOf=qi=>BANK.chapters[BANK.q[qi].ch].slice(0,-2);
const clsOf=qi=>{const ch=BANK.chapters[BANK.q[qi].ch];return ch.endsWith('A类')?'A':ch.endsWith('B类')?'B':'C';};
function pickPoints(qids,pts){ const out=[]; let rem=pts;
  for(const qi of shuffle(qids)){ if(rem<=0)break; const pt=pointOf(BANK.q[qi]);
    if(pt<=rem){ out.push(qi); rem-=pt; } } return out; }
function genPaper(pi){ const pos=BANK.positions[pi], pool=pools[pi], paper=[];
  paper.push(...pickPoints(pool.A,pos.ratio[0]));
  pos.b.forEach(g=>paper.push(...pickPoints(pool.B.filter(qi=>g[0].includes(deptOf(qi))),g[1])));
  pos.c.forEach(g=>paper.push(...pickPoints(pool.C.filter(qi=>g[0].includes(deptOf(qi))),g[1])));
  return shuffle(paper); }
const pools=buildPools();
let allOk=true;
BANK.positions.forEach((p,pi)=>{
  const pool=pools[pi];
  const counts={A:pool.A.length,B:pool.B.length,C:pool.C.length};
  const okA=pool.A.every(qi=>clsOf(qi)==='A'), okB=pool.B.every(qi=>clsOf(qi)==='B'), okC=pool.C.every(qi=>clsOf(qi)==='C');
  // 岗位内 B/C 题库部门范围必须与实施方案部门组一致
  const deptSet=new Set();
  pool.B.concat(pool.C).forEach(qi=>deptSet.add(deptOf(qi)));
  const planDept=new Set();
  p.b.forEach(g=>g[0].forEach(d=>planDept.add(d))); p.c.forEach(g=>g[0].forEach(d=>planDept.add(d)));
  const deptOk = [...deptSet].every(d=>planDept.has(d)) && [...planDept].every(d=>deptSet.has(d));
  let fail=null;
  for(let t=0;t<10 && !fail;t++){
    const paper=genPaper(pi);
    const s={A:0,B:0,C:0}, byB={}, byC={};
    for(const qi of paper){ const c=clsOf(qi); s[c]+=pointOf(BANK.q[qi]);
      const d=deptOf(qi); if(c==='B') byB[d]=(byB[d]||0)+pointOf(BANK.q[qi]);
      else if(c==='C') byC[d]=(byC[d]||0)+pointOf(BANK.q[qi]); }
    const tot=s.A+s.B+s.C;
    if(tot!==80) fail=`总分${tot}≠80`;
    if(s.A!==p.ratio[0]||s.B!==p.ratio[1]||s.C!==p.ratio[2]) fail=`A/B/C ${s.A}/${s.B}/${s.C} ≠ 目标 ${p.ratio.join('/')}`;
    p.b.forEach(g=>{ const got=g[0].reduce((a,d)=>a+(byB[d]||0),0);
      if(got!==g[1]) fail=`B组[${g[0].join('+')}] ${got}≠目标${g[1]}`; });
    p.c.forEach(g=>{ const got=g[0].reduce((a,d)=>a+(byC[d]||0),0);
      if(got!==g[1]) fail=`C组[${g[0].join('+')}] ${got}≠目标${g[1]}`; });
  }
  const ok = okA&&okB&&okC&&deptOk&&!fail;
  if(!ok) allOk=false;
  console.log(`  [${ok?'PASS':'FAIL'}] ${p.name}: 池 A${counts.A}/B${counts.B}/C${counts.C} 部门匹配[${deptOk}] ${fail||'10次组卷均=80分且符合部门比例'}`);
});
console.log(allOk?'\n全部 PASS':'\n存在 FAIL');

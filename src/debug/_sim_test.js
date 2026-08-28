const fs = require('fs');
const path = require('path');
const outMeta = JSON.parse(fs.readFileSync(path.join(__dirname, '_output.json'), 'utf-8'));
const html = fs.readFileSync(path.join(__dirname, '..', '..', outMeta.file), 'utf-8');
const script = html.split('<script>').slice(1).map(s=>s.split('</script>')[0]).join('\n');

// 最小 DOM 桩（classList 真实可断言，支持事件监听存储与分发）
const store = {};
const fakeEl = () => {
  const cls = new Set();
  return {
    _h:'', innerHTML:'', className:'', dataset:{}, style:{}, _ls:{}, _cls:cls,
    classList:{ add:c=>cls.add(c), remove:c=>cls.delete(c),
      toggle:c=>cls.has(c)?(cls.delete(c),false):(cls.add(c),true),
      contains:c=>cls.has(c) },
    appendChild(){}, addEventListener(t,c){ (this._ls[t]=this._ls[t]||[]).push(c); },
    querySelectorAll(){ return []; }, querySelector(){ return null; }, closest(){ return null; },
    set innerHTML(v){ this._h=v; }, get innerHTML(){ return this._h; },
  };
};
global.document = {
  _els:{},
  getElementById(id){ if(!this._els[id]) this._els[id]=fakeEl(); return this._els[id]; },
  createElement(){ return fakeEl(); },
  body:{ appendChild(){} },
  querySelector(){ return fakeEl(); },
  querySelectorAll(){ return []; },
};
global.localStorage = { getItem(k){ return store[k]||null; }, setItem(k,v){ store[k]=String(v); }, removeItem(k){ delete store[k]; } };
global.confirm = () => true;
global.navigator = {};
global.window = { scrollTo(){} };
global.requestAnimationFrame = cb => cb();
global.cancelAnimationFrame = () => {};

eval(script + '\n;globalThis.__h={bank:()=>BANK, exam:()=>exam, st:()=>st, view:()=>view, setExam:v=>{exam=v;}};');

let fails = 0;
const ok = (cond,msg)=>{ console.log(`  [${cond?'PASS':'FAIL'}] ${msg}`); if(!cond) fails++; };
const BANK = __h.bank();
const clsOfPaper = paper => { const a={A:0,B:0,C:0}; paper.forEach(qi=>{ const ch=BANK.chapters[BANK.q[qi].ch]; a[ch.endsWith('A类')?'A':(ch.endsWith('B类')?'B':'C')]++; }); return a; };

// 1) 设置页渲染
const setup = vExamSetup();
ok(setup.includes('题库外') && setup.includes('80'), '设置页含题库外20分说明与80分提示');
ok(setup.includes('模拟考试 · 柜员岗'), '设置页显示岗位');
const pos0 = BANK.positions[0];
ok((setup.match(/id="rule[ABC]/g)||[]).length === 1+pos0.b.length+pos0.c.length, '设置页抽取规则行数 = A类合集+B类组+C类组');
ok(setup.includes('info-card') && setup.includes('icTotal') && setup.includes('ic-name'), '设置页含考试信息卡');
ok(setup.includes('type-panel') && setup.includes('tp0') && setup.includes('题型题量'), '设置页含题型题量设置');
ok(!setup.includes('重新组卷'), '设置页无重新组卷按钮');
ok(setup.includes('重新选择岗位'), '设置页含重新选择岗位返回按钮');

// 1.5) 点岗位卡片直接进入考试确认页
setPos(1);
ok(__h.st().pos===1 && __h.view()==='exam', '点击岗位卡片直接进入考试确认页');
ok(__h.st().rule===null, '切换岗位后抽取规则重置为方案默认');

// 1.6) 抽取规则设置区
const setup2 = vExamSetup();
ok(setup2.includes('ruleA') && setup2.includes('ruleTotal') && setup2.includes('抽取规则'), '设置页含抽取规则设置区');
ok(setup2.includes('所有部门 A 类题合集') && setup2.includes('ruleB0'), '抽取规则区含 A 类合集与 B 类部门组');
ok(setup2.includes('icTotal') && setup2.includes('icRule') && setup2.includes('icDur'), '信息卡含题量/分值/时长动态元素');

// 1.7) 考试时长设置
ok(setup.includes('durInput') && setup.includes('考试时长'), '设置页含考试时长设置');
ok(!setup.includes('限时 60 分钟'), '已删除限时静态文本');
ok(__h.st().dur===60, '考试时长默认 60 分钟');

// 1.8) 折叠设置
ok(setup.includes('setup-toggle') && setup.includes('setupPanel'), '设置页含折叠设置区');
ok(setup.includes('display:none'), '自定义设置默认收起');

// 2) 组卷比例 + 题型构成 + 排序
const p0 = BANK.positions[0];
const T0 = __h.st().types;
const rule0 = {A:p0.ratio[0], B:p0.b.map(g=>g[1]), C:p0.c.map(g=>g[1])};
const paper = genPaper(0, T0, rule0);
const a = clsOfPaper(paper);
ok(a.A===p0.ratio[0]&&a.B===p0.ratio[1]&&a.C===p0.ratio[2], `柜员岗组卷 A/B/C 分值符合方案(${p0.ratio.join('/')})`);
const tc = [0,1,2].map(t=>paper.filter(qi=>BANK.q[qi].t===t).length);
ok(tc.join()===T0.join(), `组卷题型数量符合设置(${T0.join('/')}，实际 ${tc.join('/')})`);
const ts = paper.map(qi=>BANK.q[qi].t);
ok(ts.every((t,i)=>i===0||t>=ts[i-1]), '试题按 单选→多选→判断 顺序排序');

// 2.5) 矩阵分配：不同题型组合下行(题型)/列(方案)约束均满足
const units = (()=>{ const pos=BANK.positions[0], u=[pos.ratio[0]];
  pos.b.forEach(g=>u.push(g[1])); pos.c.forEach(g=>u.push(g[1])); return u; })();
[[40,25,15],[32,32,16],[50,20,10],[60,15,5],[80,0,0]].forEach(tt=>{
  const M=genMatrix(tt, units);
  const rowOK = M.every((row,t)=>row.reduce((a,b)=>a+b,0)===tt[t]);
  const colOK = units.every((n,c)=>M.reduce((a,row)=>a+row[c],0)===n);
  ok(rowOK&&colOK, `题型${tt.join('/')} 矩阵行(题型)/列(方案)约束均满足`);
});

// 2.6) 组卷总题数恒为 80（某部门题型池不足时用其他题型补足，修复79题bug）
ok(genPaper(0,T0,rule0).length===80 && genPaper(0,[32,32,16],rule0).length===80 && genPaper(0,[50,20,10],rule0).length===80, '不同题型组合下组卷总题数恒为 80');
let all80=true;
for(let k=0;k<20;k++){ if(genPaper(0,T0,rule0).length!==80) all80=false; }
ok(all80, '随机组卷20次总题数均=80');

// 2.7) 自定义抽取规则组卷
const ruleCustom = {A:rule0.A+5, B:rule0.B.map((v,i)=>i===0?v-5:v), C:[...rule0.C]};
ok(ruleCustom.A+ruleCustom.B.reduce((a,b)=>a+b,0)+ruleCustom.C.reduce((a,b)=>a+b,0)===80, '自定义抽取规则合计=80');
const paperC = genPaper(0, T0, ruleCustom);
const aC = clsOfPaper(paperC);
ok(aC.A===ruleCustom.A && aC.B===ruleCustom.B.reduce((a,b)=>a+b,0) && aC.C===ruleCustom.C.reduce((a,b)=>a+b,0), '自定义抽取规则组卷 A/B/C 符合');

const mkExam = ()=> ({paper:genPaper(0, __h.st().types, rule0), rule:rule0, cur:0, ans:{}, mark:{}, start:Date.now(), dur:60*60, done:false});
__h.st().pos = 0; // 与 genPaper(0) 的岗位一致，统计卡按同岗位部门组统计
__h.setExam(mkExam());
const run = vExamRun();
ok(run.includes('examNav') && run.includes('examStat'), '考试页含答题卡与实际抽取卡');
ok(run.includes('et-info') && run.includes('exam-timer') && run.includes('exam-pos') && run.includes('exam-done'), '答题页顶部栏含计时/进度/已答');
ok(!run.includes('submitExam()'), '顶部栏无交卷按钮');
drawExam();
ok((document.getElementById('examNav').innerHTML.match(/class="[^"]*on[^"]*"/g)||[]).length>=1, '答题卡含当前题高亮');
const navHtml = document.getElementById('examNav').innerHTML;
ok(navHtml.includes('单选题') && navHtml.includes('多选题') && navHtml.includes('判断题'), '答题卡按钮含题型标注(单/多/判)');
ok(!navHtml.includes('class="cl"') && !/>[ABC]<\/i>/.test(navHtml), '答题卡按钮无 ABC 类别标注');
const box = document.getElementById('examBox').innerHTML;
ok(!box.includes('examTimer') && !box.includes('q-status'), '题目卡底部已无状态条');
ok(box.includes('submitExam()') && box.includes('nextExam()') && box.includes('prevExam()') && box.includes('toggleMark()'), '题目卡底部含交卷/上一题/标记/下一题按钮');
__h.exam().cur = __h.exam().paper.length-1; drawExam();
const lastBox = document.getElementById('examBox').innerHTML;
ok(lastBox.includes('submitExam()') && !lastBox.includes('nextExam()'), '最后一题时交卷按钮保留、下一题消失');
__h.exam().cur = 0; drawExam();
const statHtml = document.getElementById('examStat').innerHTML;
ok(statHtml.includes('本次实际抽取') && statHtml.includes('题 / 要求'), '实际抽取卡显示实际题数/方案要求题数');
ok(statHtml.includes('A类') && statHtml.includes('B类合计') && statHtml.includes('C类合计'), '实际抽取卡按 A/B/C 分类展示小计');
ok((statHtml.match(/题 \/ 要求 \d+ 题/g)||[]).length===3+p0.b.length+p0.c.length, `实际抽取卡覆盖 A/B/C小计+部门组 共${3+p0.b.length+p0.c.length}行`);

// 3.5) 选项点击：事件委托只绑定一次，点击可选中/取消/切换
const appEl = document.getElementById('app');
ok((appEl._ls['click']||[]).length===1, '选项事件委托只绑定一次（防重复绑定）');
const q0 = paper[0], q0q = BANK.q[q0];
const optA = fakeEl(); optA.dataset.qi=String(q0); optA.dataset.key='A';
const optB = fakeEl(); optB.dataset.qi=String(q0); optB.dataset.key='B';
let curSel = null;
const cardEl = fakeEl();
cardEl.querySelectorAll = ()=>[optA,optB];
cardEl.querySelector = sel => sel==='.opt.sel' ? ([optA,optB].find(o=>o._cls.has('sel'))||null) : null;
optA.closest = sel => sel==='.opt' ? optA : (sel==='.q-card' ? cardEl : null);
optB.closest = sel => sel==='.opt' ? optB : (sel==='.q-card' ? cardEl : null);
const click = target => (appEl._ls['click']||[]).forEach(cb=>cb({target}));
const syncSel = ()=>{ curSel=[optA,optB].find(o=>o._cls.has('sel'))||null; };
__h.setExam(mkExam());
__h.exam().cur = 0;
click(optA); syncSel();
ok(curSel===optA && __h.exam().ans[q0] && __h.exam().ans[q0][0]==='A', '点击选项A选中并写入答案');
click(optA); syncSel();
ok(curSel===null && !__h.exam().ans[q0], '再次点击取消选中并清除答案');
click(optB); syncSel();
ok(curSel===optB && __h.exam().ans[q0] && __h.exam().ans[q0][0]==='B', '点击选项B切换选中');

// 3.6) 多选题可多选、判断题互斥
const mkOptStub = (qi, keys)=>{
  const card = fakeEl();
  const opts = keys.map(k=>{ const o=fakeEl(); o.dataset.qi=String(qi); o.dataset.key=k;
    o.closest=s=>s==='.opt'?o:(s==='.q-card'?card:null); return o; });
  card.querySelectorAll = sel => sel==='.opt.sel' ? opts.filter(o=>o._cls.has('sel')) : opts;
  card.querySelector = sel => sel==='.opt.sel' ? (opts.find(o=>o._cls.has('sel'))||null) : null;
  const clickOpt = o=> (appEl._ls['click']||[]).forEach(cb=>cb({target:o}));
  return {card, opts, clickOpt};
};
const qMulti = paper.find(qi=>BANK.q[qi].t===1);
{
  const {opts, clickOpt} = mkOptStub(qMulti, ['A','B','C','D']);
  __h.setExam(mkExam()); __h.exam().cur = 0;
  clickOpt(opts[0]);
  ok(opts[0]._cls.has('sel') && __h.exam().ans[qMulti].includes('A'), '多选点击A选中');
  clickOpt(opts[1]);
  ok(opts[0]._cls.has('sel') && opts[1]._cls.has('sel') && __h.exam().ans[qMulti].join('')==='AB', '多选可同时选中A和B');
  clickOpt(opts[0]);
  ok(!opts[0]._cls.has('sel') && opts[1]._cls.has('sel') && __h.exam().ans[qMulti].join('')==='B', '多选再次点击A取消A');
}
const qJudge = paper.find(qi=>BANK.q[qi].t===2);
{
  const {opts, clickOpt} = mkOptStub(qJudge, ['对','错']);
  __h.setExam(mkExam()); __h.exam().cur = 0;
  clickOpt(opts[0]);
  ok(opts[0]._cls.has('sel') && __h.exam().ans[qJudge][0]==='对', '判断题点击"对"选中');
  clickOpt(opts[1]);
  ok(!opts[0]._cls.has('sel') && opts[1]._cls.has('sel') && __h.exam().ans[qJudge][0]==='错', '判断题"错"互斥替换"对"');
}

// 4) 标记功能
toggleMark();
ok(__h.exam().mark[__h.exam().paper[__h.exam().cur]]===1, '标记本题生效');
toggleMark();
ok(__h.exam().mark[__h.exam().paper[__h.exam().cur]]===undefined, '取消标记生效');

// 5) 全对 → 80 分
__h.setExam(mkExam());
__h.exam().paper.forEach(qi=>{ const q=BANK.q[qi];
  __h.exam().ans[qi] = q.t===1 ? [...q.a] : [q.a]; });
submitExam();
ok(__h.exam().score===80, '全部答对得 80 分');
ok(__h.exam().done===true, '交卷后 done=true');
const res = vExamResult();
ok(res.includes('80') && res.includes('答题详情'), '成绩报告含分数与答题详情');
ok((res.match(/review-row/g)||[]).length===__h.exam().paper.length, '成绩报告逐题列出全部题目');
ok(res.includes('分题型得分') && res.includes('分 A/B/C 得分'), '成绩报告含分题型/分A/B/C得分');
// 复查详情：单选/多选/判断
const ex = __h.exam();
const qiS = ex.paper.find(qi=>BANK.q[qi].t===0), qiM = ex.paper.find(qi=>BANK.q[qi].t===1), qiJ = ex.paper.find(qi=>BANK.q[qi].t===2);
ok(reviewDetail(qiS).includes('正确答案'), '单选复查含正确答案');
ok(reviewDetail(qiM).includes('你的答案'), '多选复查含你的答案');
ok(reviewDetail(qiJ).includes('对') && reviewDetail(qiJ).includes('错'), '判断复查含对/错选项');

// 6) 一半答错 → 得分小于80
__h.setExam(mkExam());
const LETTERS=['A','B','C','D','E','F','G','H'];
__h.exam().paper.forEach((qi,i)=>{ const q=BANK.q[qi];
  if(i%2===0){ __h.exam().ans[qi] = q.t===1 ? [...q.a] : [q.a]; }  // 一半答对
  else {  // 一半答错
    let wrong;
    if(q.t===2) wrong=[q.a==='对'?'错':'对'];
    else wrong=[LETTERS.find(L=>!q.a.includes(L))];
    __h.exam().ans[qi]=wrong;
  }
});
submitExam();
ok(__h.exam().score>0 && __h.exam().score<80, `一半答错得分介于0~80(实际 ${__h.exam().score})`);

// 7) 全不答 → 0 分（确认框被桩接受）
__h.setExam(mkExam());
submitExam();
ok(__h.exam().score===0, '未作答得 0 分');

console.log(fails? `\n存在 ${fails} 个 FAIL`:'\n全部 PASS');
process.exit(fails?1:0);

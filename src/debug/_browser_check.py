# -*- coding: utf-8 -*-
"""在真实浏览器里验证抽签功能：把测试名单内嵌进成品 HTML，注入自检脚本后用
Chrome headless 打开，既可 dump-dom 取断言结果，也可截图查看实际渲染效果。
产物写在 data/tmp/ 下，不入库。

用法:
  python src/debug/_browser_check.py check   # 生成自检页（输出 <pre id="dzcheck">）
  python src/debug/_browser_check.py params  # 生成停在「参数页」的页面，用于截图
  python src/debug/_browser_check.py result  # 生成停在「抽签结果页」的页面，用于截图
"""
import base64, os, sys

BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PROD = os.path.join(BASE, '模拟考试工具.html')
SAMPLE = os.path.join(BASE, 'data', 'tmp', 'draw_sample.xlsx')
OUT = os.path.join(BASE, 'data', 'tmp', '_browser_check.html')

COMMON = r"""
function b64ToFile(b64, name){
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) u8[i] = bin.charCodeAt(i);
  return new File([u8], name, {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
function captureInput(fn){
  const orig = document.createElement.bind(document);
  let box = null;
  document.createElement = function(tag){ const el = orig(tag); if(tag === 'input') box = el; return el; };
  fn();
  document.createElement = orig;
  return box;
}
async function loadRoster(b64, fname){
  dzEnter();                                  // 走真实路径：先进入抽签视图再导入
  const inp = captureInput(dzPickFile);
  const dt = new DataTransfer();
  dt.items.add(b64ToFile(b64, fname || '名单.xlsx'));
  inp.files = dt.files;
  await inp.onchange();
  dzConfirmMap();
}
"""

CHECK = r"""
(async function(){
  const out = [];
  const log = (ok, msg)=>out.push((ok ? 'PASS' : 'FAIL') + ' | ' + msg);
  const done = ()=>{ const p = document.createElement('pre'); p.id = 'dzcheck'; p.textContent = out.join('\n'); document.body.appendChild(p); };
  try{
    log(typeof DecompressionStream !== 'undefined', '浏览器支持 DecompressionStream');
    log(!!(window.crypto && crypto.getRandomValues), '浏览器支持 crypto.getRandomValues');
    const b64 = '__SAMPLE_B64__';

    const sheets = await dzReadXlsx(b64ToFile(b64, 'draw_sample.xlsx'));
    log(sheets.length === 2, 'xlsx 解析出 2 个工作表 -> ' + sheets.length);
    log(sheets[0].name === '抽签名单', '工作表名读出 -> ' + sheets[0].name);
    log(sheets[0].rows[0][2] === '姓名', '第 1 行标题读出 -> ' + sheets[0].rows[0][2]);
    log(sheets[0].rows[1][1] === '0001', '文本工号前导零保留 -> ' + sheets[0].rows[1][1]);

    await loadRoster(b64);
    const n = dr.roster.length;
    log(n === 40, '导入 40 人 -> ' + n);
    log(dr.roster[0].n === '员工01' && dr.roster[0].no === '0001', '首条记录 -> ' + JSON.stringify(dr.roster[0]));
    log(document.getElementById('app').innerHTML.indexOf('40 × 30% = 12') >= 0, '页面渲染算式 40 × 30% = 12');

    const zero = dzTarget(n, 0.1, 'floor').k;
    log(zero === 0, '0.1% 向下取整 -> 0 人（会被拦截）');

    dzEnter();
    const domeHasSelect = true;
    dzStart();
    log(dz.k === 12, '应抽 12 人 -> ' + dz.k);
    const rolling = document.getElementById('dzRoll');
    log(rolling && rolling.textContent.length > 0, '揭晓区已开始滚动 -> ' + (rolling && rolling.textContent));
    await new Promise(r=>setTimeout(r, 600));
    dzSkip();
    await new Promise(r=>setTimeout(r, 400));
    const picked = document.getElementById('dzPicked');
    const names = picked ? [...picked.querySelectorAll('.dz-chip')].map(e=>e.textContent.trim()) : [];
    log(names.length === 12, '中签 12 人 -> ' + names.length);
    log(new Set(names).size === 12, '中签无重复');
    log(names.every(s=>/^员工\d\d/.test(s)), '中签者均来自名单');
    log(dz.hash === dzHash(dr.roster), '运行时指纹与名单一致 -> ' + dz.hash);
    log(dzCsv('张,三') === '"张,三"', 'CSV 逗号转义正常');
  }catch(e){
    log(false, '运行异常: ' + (e && e.stack ? e.stack.split('\n')[0] : e));
  }
  done();
})();
"""

PARAMS = r"""
(async function(){
  const b64 = '__SAMPLE_B64__';
  await loadRoster(b64, '抽签测试名单.xlsx');
  dzSetPct(30);
  dzEnter();
  document.title = 'PARAMS_READY';
})();
"""

MAP = r"""
(async function(){
  const b64 = '__SAMPLE_B64__';
  dzEnter();
  const inp = captureInput(dzPickFile);
  const dt = new DataTransfer();
  dt.items.add(b64ToFile(b64, '抽签测试名单.xlsx'));
  inp.files = dt.files;
  await inp.onchange();
  document.title = 'MAP_READY';
})();
"""

MANUAL = r"""
(async function(){
  const out = [];
  const log = (ok, msg)=>out.push((ok ? 'PASS' : 'FAIL') + ' | ' + msg);
  const done = ()=>{ const p = document.createElement('pre'); p.id = 'dzcheck'; p.textContent = out.join('\n'); document.body.appendChild(p); };
  try{
    const b64 = '__SAMPLE_B64__';
    dzEnter();
    const inp = captureInput(dzPickFile);
    const dt = new DataTransfer();
    dt.items.add(b64ToFile(b64, '抽签测试名单.xlsx'));
    inp.files = dt.files;
    await inp.onchange();
    const mapHtml = document.getElementById('app').innerHTML;
    log(mapHtml.indexOf('确认名单') >= 0, '上传后进入确认名单界面');
    log(mapHtml.indexOf('<td>序号</td>') < 0 && mapHtml.indexOf('<td>工号</td>') < 0, '标题行不在预览正文里重复出现');
    log(mapHtml.indexOf('<td>王海涛</td>') >= 0, '预览正文从第一条数据开始');
    dzConfirmMap();
    const n = dr.roster.length;
    log(n === 200, '导入 200 人 -> ' + n);
    log(dr.roster[0].n === '王海涛' && dr.roster[0].no === '0001', '姓名列/工号列识别正确 -> ' + JSON.stringify(dr.roster[0]));
    log(dr.roster[199] && dr.roster[199].n === '杨子轩', '末位人员 -> ' + (dr.roster[199] && dr.roster[199].n));
    log(dzTarget(200, 30, 'floor').k === 60, '200 x 30% -> 60 人');
    const f = dzTarget(200, 17.25, 'floor'), c = dzTarget(200, 17.25, 'ceil'), r = dzTarget(200, 17.25, 'round');
    log(f.raw === 34.5, '200 x 17.25% 原始值 = 34.5 -> ' + f.raw);
    log(f.k === 34 && c.k === 35 && r.k === 35, '三种取整 -> ' + f.k + ' / ' + c.k + ' / ' + r.k);
  }catch(e){
    log(false, '运行异常: ' + (e && e.stack ? e.stack.split('\n')[0] : e));
  }
  done();
})();
"""

RESULT = r"""
(async function(){
  const b64 = '__SAMPLE_B64__';
  await loadRoster(b64, '抽签测试名单.xlsx');
  dzSetPct(30);
  dzEnter();
  dzStart();
  await new Promise(r=>setTimeout(r, 1200));
  dzSkip();
  await new Promise(r=>setTimeout(r, 300));
  document.title = 'RESULT_READY';
})();
"""

STAGES = {'check': CHECK, 'manual': MANUAL, 'map': MAP, 'params': PARAMS, 'result': RESULT}
# 人工测试名单（50 人）用于 manual/map/params/result 四个阶段，与用户手里的文件一致
MANUAL_XLSX = os.path.join(BASE, 'data', 'tmp', '抽签测试名单.xlsx')
MANUAL_STAGES = ('manual', 'map', 'params', 'result')


def main():
    stage = (sys.argv[1] if len(sys.argv) > 1 else 'check').lower()
    if stage not in STAGES:
        print('用法: check | manual | map | params | result')
        return 2
    html = open(PROD, encoding='utf-8').read()
    src = MANUAL_XLSX if stage in MANUAL_STAGES else SAMPLE
    b64 = base64.b64encode(open(src, 'rb').read()).decode('ascii')
    script = ('<script>\n' + COMMON + STAGES[stage] + '\n</script>\n').replace('__SAMPLE_B64__', b64)
    assert '</body>' in html
    html = html.replace('</body>', script + '</body>')
    open(OUT, 'w', encoding='utf-8').write(html)
    print('生成 ->', OUT, '| 阶段:', stage, '| 样本:', os.path.basename(src))
    return 0


if __name__ == '__main__':
    sys.exit(main())

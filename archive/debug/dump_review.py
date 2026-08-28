# -*- coding: utf-8 -*-
"""生成逐题复核明细（人类可读），便于全量校对解析结果。"""
import json, sys, io, re
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

def re_ws(s):
    return re.sub(r'\s+', ' ', s).strip()

data = json.load(open(r'c:\Users\lenovo\Desktop\题库\_tmp_text\parsed.json', encoding='utf-8'))
out = []
g = 0
for af in data:
    out.append('='*70)
    out.append(f"文件: {af['file']}   共 {len(af['questions'])} 题")
    for q in af['questions']:
        g += 1
        no = q['src_no'] if q['src_no'] is not None else '·'
        ans = q['answer'] if q['answer'] is not None else '??无答案??'
        out.append('-'*70)
        out.append(f"[{g:03d}] 源题号={no} | 题型={q['sec_type']} | 答案来源={q['answer_src']} | 答案={ans}")
        out.append(f"  题干: {q['stem']}")
        if q['options']:
            opts = '  |  '.join(f"{l}.{t}" for l, t in q['options'])
            out.append(f"  选项: {opts}")
        if q['note']:
            out.append(f"  解析/备注: {q['note']}")
        if q['flags']:
            out.append(f"  标记: {'; '.join(q['flags'])}")
        raws = [re_ws(l) for l in q['raw_lines']]
        out.append(f"  原始: {' ▏ '.join(raws)}")

with open(r'c:\Users\lenovo\Desktop\题库\_tmp_text\review_dump.txt', 'w', encoding='utf-8') as fh:
    fh.write('\n'.join(out))
print('written', len(out), 'lines')

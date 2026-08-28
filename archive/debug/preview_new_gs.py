# -*- coding: utf-8 -*-
"""用 parse_a 的解析逻辑对新版公司金融部A类文件做预演，确认 20 题可正确提取。"""
import sys, os, io, collections
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.path.insert(0, r'c:\Users\lenovo\Desktop\题库\4_脚本')
import parse_a

sections, raw = parse_a.parse_file(r'c:\Users\lenovo\Desktop\题库\5_临时调试\cmp_new.txt')
qs = []
for sec_type, sqs in sections:
    for q in sqs:
        parse_a.refine_question(q, sec_type)
        qs.append(q)

print('区段数:', len(sections))
c = collections.Counter(q['sec_type'] for q in qs)
print('题型分布:', dict(c))
print('有效题数:', sum(1 for q in qs if q['valid']))
for i, q in enumerate(qs, 1):
    opts = ' '.join(f"{l}.{t}" for l, t in q['options'])
    print(f"[{i:02d}] {q['sec_type']} 源号={q['src_no']} 答案={q['answer']} 标记={q['flags']}")
    print(f"   题干: {q['stem'][:70]}")
    print(f"   选项: {opts[:110]}")

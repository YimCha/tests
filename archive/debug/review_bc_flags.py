# -*- coding: utf-8 -*-
import json, sys, io
from collections import Counter
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
data = json.load(open(r'c:\Users\lenovo\Desktop\题库\_tmp_text\bc_parsed.json', encoding='utf-8'))
fc = Counter()
for af in data:
    for q in af['questions']:
        for f in q['flags']:
            fc[f.split(':')[0]] += 1
print('=== 标记类型统计 ===')
for k, v in fc.most_common():
    print(f'  {k}: {v}')
print()
print('=== 带标记的题 ===')
n = 0
for af in data:
    for q in af['questions']:
        if q['flags']:
            n += 1
            stem = ' '.join(q['stem'].split())[:60]
            print(f"[{af['file']}] 题{q['src_no']} {q['sec_type']} 答案={q['answer']} 选项数={len(q['options'])} | {'；'.join(q['flags'])}")
            print(f"    题干: {stem}")
            print(f"    选项: {[(l, t[:30]) for l, t in q['options']]}")
            if n >= 60:
                print('...(截断)')
                break
    if n >= 60:
        break
print()
print('标志题总数:', sum(1 for af in data for q in af['questions'] if q['flags']))

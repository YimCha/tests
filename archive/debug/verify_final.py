# -*- coding: utf-8 -*-
import json, sys, io, openpyxl
from collections import Counter
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
data = json.load(open(r'c:\Users\lenovo\Desktop\题库\_tmp_text\parsed.json', encoding='utf-8'))

print('=== 各文件题型分布（重分类后）===')
tot = Counter()
for af in data:
    c = Counter(q['sec_type'] for q in af['questions'])
    tot.update(c)
    print(f"{af['file']}: {len(af['questions'])}题 | {dict(c)} | 章节={af.get('chapter')}")
print('合计:', dict(tot), '| 总数:', sum(tot.values()))

print()
print('=== 公司金融部 8 道已改多选？===')
for af in data:
    if af['file'] == '2026年公司金融部题库':
        for q in af['questions']:
            if '改为多选题' in (q['flags'] or []):
                print('  源题号', q['src_no'], '|', q['sec_type'], '| 答案', q['answer'], '|', q['flags'])

print()
print('=== 合并Excel 章节列（前6行 + 公司金融部行）===')
wb = openpyxl.load_workbook(r'c:\Users\lenovo\Desktop\题库\A类题库合并_全部406题.xlsx')
ws = wb['试题案例，直接导入试试']
for r in list(range(3, 9)) + [50, 51, 52]:
    if ws.cell(row=r, column=1).value:
        print(f'  行{r}: 题型={ws.cell(row=r,column=2).value} | 答案={ws.cell(row=r,column=11).value} | 章节={ws.cell(row=r,column=13).value}')

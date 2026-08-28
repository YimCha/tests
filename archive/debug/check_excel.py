# -*- coding: utf-8 -*-
"""自检：读回合并 Excel，检查空题干/空答案/判断题映射/题数；并交叉核对源文件题数。"""
import json, sys, io, re, openpyxl
from collections import Counter
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

OUT = r'c:\Users\lenovo\Desktop\题库\A类题库合并_全部406题.xlsx'
wb = openpyxl.load_workbook(OUT)
ws = wb['试题案例，直接导入试试']

rows = [r for r in ws.iter_rows(min_row=3, values_only=True) if any(v is not None for v in r)]
print('数据行数:', len(rows))

problems = []
judge_bad = 0
for i, r in enumerate(rows, 3):
    stem, typ, *opts_ans = r
    opts = opts_ans[:8]
    ans = opts_ans[8]
    note = opts_ans[9]
    if not stem or not str(stem).strip():
        problems.append(f'行{i}: 空题干')
    if typ == '判断题':
        if ans not in ('A', 'B'):
            judge_bad += 1
            problems.append(f'行{i}: 判断题答案异常 {ans!r}')
    else:
        if not ans:
            problems.append(f'行{i}: 空答案')
    # 题干残留答案括号
    if re.search(r'[（\[【(]\s*[A-ZＡ-Ｚ]\s*[）\]】)]', str(stem)):
        problems.append(f'行{i}: 题干仍含答案括号: {str(stem)[:50]}')

if judge_bad:
    print('判断题答案异常数:', judge_bad)
if problems:
    print('问题数:', len(problems))
    for p in problems[:40]:
        print('  ', p)
else:
    print('未发现问题：题干/答案完整，判断题映射正确')

# 与 parsed.json 的题数交叉核对
data = json.load(open(r'c:\Users\lenovo\Desktop\题库\_tmp_text\parsed.json', encoding='utf-8'))
tot = sum(len(a['questions']) for a in data)
print('parsed.json 题数:', tot, '| Excel 行数:', len(rows))
print('一致' if tot == len(rows) else '!!!不一致!!!')

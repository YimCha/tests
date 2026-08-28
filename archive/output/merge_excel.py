# -*- coding: utf-8 -*-
"""从 master_bank.xlsx（经 bank_loader）筛选 A 类章节，写入考试宝模板 Excel。
保留模板表头/说明，去掉示例行，不去重。输出文件名按实际 A 类题数生成。"""
import sys, io, os, openpyxl
from bank_loader import load_bank

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

BASE = r'c:\Users\lenovo\Desktop\题库'
TPL = os.path.join(BASE, 'templates', 'kaoshibaoExcel20221101.xlsx')
OUT_DIR = os.path.join(BASE, 'data', 'output', 'A类')

TYPE_NAME = {0: '单选题', 1: '多选题', 2: '判断题'}
JUDGE_MAP = {'对': 'A', '是': 'A', '正确': 'A', '√': 'A', '✓': 'A', 'T': 'A',
             '错': 'B', '否': 'B', '错误': 'B', '×': 'B', 'F': 'B'}

bank = load_bank()
chapters = bank['chapters']

wb = openpyxl.load_workbook(TPL)
ws = wb['试题案例，直接导入试试']


def write_row(r, q, chapter):
    ws.cell(row=r, column=1, value=q['s'])
    ws.cell(row=r, column=2, value=TYPE_NAME[q['t']])
    if q['t'] == 2:
        ws.cell(row=r, column=3, value='对')
        ws.cell(row=r, column=4, value='错')
        ws.cell(row=r, column=11, value=JUDGE_MAP.get(q['a'], q['a']))
    else:
        for i, text in enumerate(q['o']):
            ws.cell(row=r, column=3 + i, value=text)
        ws.cell(row=r, column=11, value=q['a'] if q['a'] else '')
    ws.cell(row=r, column=12, value=q['n'] if q['n'] else '')
    ws.cell(row=r, column=13, value=chapter)


# 删除模板示例数据行（第3行起）
if ws.max_row >= 3:
    ws.delete_rows(3, ws.max_row - 2)

r = 3
total = 0
for q in bank['q']:
    chapter = chapters[q['ch']]
    if not chapter.endswith('A类'):
        continue
    write_row(r, q, chapter)
    r += 1
    total += 1

OUT = os.path.join(OUT_DIR, f'A类题库合并_全部{total}题.xlsx')
os.makedirs(OUT_DIR, exist_ok=True)
wb.save(OUT)
print('written rows:', total, '->', OUT)

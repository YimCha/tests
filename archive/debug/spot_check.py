# -*- coding: utf-8 -*-
import openpyxl, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
wb = openpyxl.load_workbook(r'c:\Users\lenovo\Desktop\题库\A类题库合并_全部406题.xlsx')
ws = wb['试题案例，直接导入试试']
for r in range(3, 10):
    vals = [ws.cell(row=r, column=c).value for c in range(1, 13)]
    stem, typ = vals[0], vals[1]
    opts = [v for v in vals[2:10] if v]
    ans, note = vals[10], vals[11]
    print(f'--- 行{r} [{typ}] 答案={ans}')
    print('  题干:', stem)
    print('  选项:', ' | '.join(opts))
    if note:
        print('  解析:', note)

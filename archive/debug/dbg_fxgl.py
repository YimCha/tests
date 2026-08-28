# -*- coding: utf-8 -*-
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
fn = r'c:\Users\lenovo\Desktop\题库\_tmp_text\bc\05_风险管理部_B.txt'
lines = open(fn, encoding='utf-8-sig').read().splitlines()
for i, ln in enumerate(lines):
    if '流动性覆盖率旨在' in ln:
        for j in range(max(0, i-2), min(len(lines), i+10)):
            print(f'{j:>3}| {lines[j]!r}')
        break

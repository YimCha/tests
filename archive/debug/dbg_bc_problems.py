# -*- coding: utf-8 -*-
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
for fn, kw in [
    (r'c:\Users\lenovo\Desktop\题库\_tmp_text\bc\01_安全保卫部_B.txt', '钱箱押运交接'),
    (r'c:\Users\lenovo\Desktop\题库\_tmp_text\bc\02_安全保卫部_C.txt', '擅自让无关人员'),
    (r'c:\Users\lenovo\Desktop\题库\_tmp_text\bc\13_科技部_B.txt', 'IE地址栏'),
    (r'c:\Users\lenovo\Desktop\题库\_tmp_text\bc\32_资金营运中心_C.txt', ''),
]:
    print('='*70)
    print(fn)
    lines = open(fn, encoding='utf-8-sig').read().splitlines()
    for i, ln in enumerate(lines):
        if kw == '' or kw in ln:
            start = max(0, i-4)
            end = min(len(lines), i+14)
            for j in range(start, end):
                print(f'{j:>3}| {lines[j]!r}')
            print('---')
            if kw == '':
                # 只打印首段
                break

# -*- coding: utf-8 -*-
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
targets = [
    (r'c:\Users\lenovo\Desktop\题库\_tmp_text\bc\04_办公室_C.txt', '小时通过协同'),
    (r'c:\Users\lenovo\Desktop\题库\_tmp_text\bc\05_风险管理部_B.txt', '流动性覆盖率旨在'),
    (r'c:\Users\lenovo\Desktop\题库\_tmp_text\bc\11_计划财务部_B.txt', '财务会计核算的基本前提'),
    (r'c:\Users\lenovo\Desktop\题库\_tmp_text\bc\13_科技部_B.txt', '存取信息的最基本单位'),
    (r'c:\Users\lenovo\Desktop\题库\_tmp_text\bc\17_普惠金融部_B.txt', '支小再贷款质押品种'),
    (r'c:\Users\lenovo\Desktop\题库\_tmp_text\bc\24_授信审批部_C.txt', '商业银行的操作风险具有'),
    (r'c:\Users\lenovo\Desktop\题库\_tmp_text\bc\29_运营管理部_B.txt', '长期不动户款项'),
]
for fn, kw in targets:
    print('='*70)
    print(fn)
    lines = open(fn, encoding='utf-8-sig').read().splitlines()
    for i, ln in enumerate(lines):
        if kw in ln:
            for j in range(max(0, i-1), min(len(lines), i+6)):
                print(f'{j:>3}| {lines[j]!r}')
            print('---')
            break

# -*- coding: utf-8 -*-
import re, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
s = '1、银行“五防二保”中五防指的是（A B E G J）。'
print('t1', re.search(r'[（\[【(]', s))
print('t2', re.search(r'[（\[【(]\s*([A-HＡ-Ｈ])', s))
print('t3', re.search(r'[（\[【(]\s*[A-HＡ-Ｈ][A-HＡ-Ｈ\s]*?[）\]】)]', s))
print('t4', re.search(r'[（\[【(].*?[）\]】)]', s))
# 逐步
m1 = re.search(r'[（\[【(]', s)
print('m1', m1, m1.group() if m1 else None)
i = m1.end() if m1 else 0
print('after open:', repr(s[i:i+6]))
m2 = re.search(r'[A-HＡ-Ｈ]', s[i:])
print('m2 letter', m2)
print(repr(s[i+ m2.start(): i+m2.end()+8]))

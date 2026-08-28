# -*- coding: utf-8 -*-
import re, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
s = 'A B E G J）'
print('last char:', hex(ord(s[-1])), repr(s[-1]))
print('q1', re.search(r'）', s))
print('q2', re.search(r'[）\]】)]', s))
print('q3', re.search(r'[（\[【(]', '（'))
# 整个 char class 构造
cl = r'[）\]】)]'
print('cl source:', cl)
m = re.match(cl, s[-1])
print('q4', m)
print('q5', re.match(r'[）\]】)]', '）'))

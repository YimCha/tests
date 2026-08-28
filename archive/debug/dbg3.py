# -*- coding: utf-8 -*-
import re, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
inner = 'A B E G J'
print('p1', re.match(r'[A-HＡ-Ｈ]', inner))
print('p2', re.match(r'[A-HＡ-Ｈ][A-HＡ-Ｈ\s]*?', inner))
m = re.match(r'[A-HＡ-Ｈ][A-HＡ-Ｈ\s]*?[）\]】)]', 'A B E G J）')
print('p3', m)
m = re.match(r'([A-HＡ-Ｈ][A-HＡ-Ｈ\s]*?)\s*[）\]】)]', 'A B E G J）')
print('p4', m, m.group(1) if m else None)
# 检测类里是否有问题：用 re.DEBUG 太重，改用逐步类
m = re.match(r'[A-HＡ-Ｈ][A-HＡ-Ｈ\s]*?\s*[）\]】)]', 'A B E G J）')
print('p5', m)
# 试试把 \s 换成 ' '
m = re.match(r'[A-HＡ-Ｈ][A-HＡ-Ｈ ]*?[）\]】)]', 'A B E G J）')
print('p6', m)

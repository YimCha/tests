# -*- coding: utf-8 -*-
import re, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

ANS_PICK_RE = re.compile(r'[（\[【(]\s*([A-HＡ-Ｈ][A-HＡ-Ｈ\s]*?)\s*[）\]】)]')
s = '1、银行“五防二保”中五防指的是（A B E G J）。'
m = ANS_PICK_RE.search(s)
print('match:', m)
if m:
    print('group:', repr(m.group(1)))
print('chars:', [hex(ord(c)) for c in '（A B E G J）'])

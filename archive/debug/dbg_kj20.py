# -*- coding: utf-8 -*-
import re, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
l1 = '20．在IE地址栏输入的“http://www.cqu.edu.cn/”中，http代表'
l2 = '的是（\u3000A\u3000）。'
ANS_PICK_RE = re.compile(r'[（\[【(]\s*([A-ZＡ-Ｚ][A-ZＡ-Ｚ\s]*?)\s*[）\]】)]')
print('l2 ans:', ANS_PICK_RE.search(l2))
print('l2 raw:', repr(l2))
# 模拟 refine 流程
OPT_LINE_RE = re.compile(r'^\s*([A-ZＡ-Ｚ])\s*[.、．:：)）]')
def parse_option_line(line):
    m = list(re.finditer(r'(?<![A-Z])([A-Z])\s*[.、．:：)）]', line))
    if not m: return None
    leading = line[:m[0].start()].strip()
    segs = [(x.group(1), line[x.end(): (m[i+1].start() if i+1<len(m) else len(line))]) for i,x in enumerate(m)]
    return leading, segs
r = parse_option_line(l2)
print('option_line:', r)

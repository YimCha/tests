# -*- coding: utf-8 -*-
"""分析：各题干行中 ANS_PICK_RE 括号答案标记的数量分布"""
import json, sys, io, re
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
data = json.load(open(r'c:\Users\lenovo\Desktop\题库\_tmp_text\parsed.json', encoding='utf-8'))

P = re.compile(r'[（\[【(]\s*([A-ZＡ-Ｚ][A-ZＡ-Ｚ\s]*?)\s*[）\]】)]')
multi = []
for af in data:
    for q in af['questions']:
        raw = ' '.join(q['raw_lines'])
        ms = list(P.finditer(raw))
        if len(ms) > 1:
            multi.append((af['file'], q['src_no'], q['sec_type'],
                          [re.sub(r'\s+', '', m.group(1)).upper() for m in ms]))
print('多空题数量:', len(multi))
for f, n, t, letters in multi:
    print(f'{f} | 题号{n} | {t} | 空答案={letters}')

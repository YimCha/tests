# -*- coding: utf-8 -*-
import json, sys, io
from collections import Counter
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
data = json.load(open(r'c:\Users\lenovo\Desktop\题库\_tmp_text\parsed.json', encoding='utf-8'))
tot = 0
for af in data:
    qs = af['questions']
    tot += len(qs)
    c = Counter(q['sec_type'] for q in qs)
    inv = [q for q in qs if not q['valid']]
    fl = [q for q in qs if q['flags']]
    extra = ''
    if inv or fl:
        extra = f"  <== 无效:{len(inv)} 带标记:{len(fl)}"
    print(f"{af['file']}: {len(qs)}题 | {dict(c)}{extra}")
print('TOTAL:', tot)

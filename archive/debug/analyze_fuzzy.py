# -*- coding: utf-8 -*-
"""模糊重复检查：归一化题干两两比对，找出相似但不完全相同的题。"""
import json, sys, io, re, difflib
from itertools import combinations
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
data = json.load(open(r'c:\Users\lenovo\Desktop\题库\_tmp_text\parsed.json', encoding='utf-8'))

FW = str.maketrans('ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ０１２３４５６７８９（）：，。',
                   'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789():，。')
def norm(s):
    s = s.replace('\u000b', ' ').replace('\xa0', ' ')
    s = s.translate(FW)
    s = re.sub(r'^\d+\s*[.、．]', '', s)
    s = re.sub(r'\s+', '', s)
    s = re.sub(r'[。．、，,；;：:（）()【】\[\]]+$', '', s)
    return s

items = []
for af in data:
    for q in af['questions']:
        items.append((af['file'], q['src_no'], q['sec_type'], q['answer'], q['stem'], norm(q['stem'])))

# 按长度分桶，只比较长度接近的
buckets = {}
for it in items:
    L = len(it[5])
    for b in range(max(6, L - 6), L + 7):
        buckets.setdefault(b, []).append(it)

seen = set()
near = []
for it in items:
    key = (it[0], it[1])
    for b in range(max(6, len(it[5]) - 6), len(it[5]) + 7):
        for o in buckets.get(b, []):
            if o is it: continue
            k2 = (o[0], o[1])
            if (key, k2) in seen or (k2, key) in seen: continue
            r = difflib.SequenceMatcher(None, it[5], o[5]).ratio()
            if 0.82 <= r < 1.0:
                seen.add((key, k2))
                near.append((r, it, o))

near.sort(key=lambda x: -x[0])
print('近似重复对数(相似度0.82~0.999):', len(near))
for r, a, b in near:
    print(f'--- 相似度{r:.2f} ---')
    print(f'  A: {a[0]} | 源题号{a[1]} | {a[2]} | 答案{a[3]} | {a[4][:60]}')
    print(f'  B: {b[0]} | 源题号{b[1]} | {b[2]} | 答案{b[3]} | {b[4][:60]}')

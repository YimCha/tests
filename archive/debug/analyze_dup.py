# -*- coding: utf-8 -*-
"""统计重复题：按归一化题干分组，报告重复组数、重复题次数、明细。"""
import json, sys, io, re
from collections import defaultdict
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
data = json.load(open(r'c:\Users\lenovo\Desktop\题库\_tmp_text\parsed.json', encoding='utf-8'))

FW = str.maketrans('ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ０１２３４５６７８９（）：，。',
                   'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789():，。')

def norm(s):
    s = s.replace('\u000b', ' ').replace('\xa0', ' ')
    s = s.translate(FW)
    s = re.sub(r'^\d+\s*[.、．]', '', s)          # 去掉题号前缀
    s = re.sub(r'\s+', '', s)                      # 去所有空白
    s = re.sub(r'[。．、，,；;：:（）()【】\[\]]+$', '', s)  # 去尾标点/括号
    s = re.sub(r'[【】\[\]（）()]', '', s)          # 去括号（保留括号内文字）
    return s.strip()

groups = defaultdict(list)
for af in data:
    for q in af['questions']:
        key = norm(q['stem'])
        groups[key].append((af['file'], q['src_no'], q['sec_type'], q['answer'], q['stem']))

dups = {k: v for k, v in groups.items() if len(v) > 1}
total_extra = sum(len(v) - 1 for v in dups.values())

print('总题数:', sum(len(a['questions']) for a in data))
print('归一化后唯一题干数:', len(groups))
print('重复组数(>1次):', len(dups))
print('多余重复出现次数(总题数-唯一数):', total_extra)
print()
print('=== 重复组明细 ===')
for i, (k, v) in enumerate(sorted(dups.items(), key=lambda x: -len(x[1])), 1):
    print(f'--- 组{i} 出现{len(v)}次 ---')
    print(f'  题干: {v[0][4][:60]}')
    answers = set(x[3] for x in v)
    types = set(x[2] for x in v)
    print(f'  答案集: {answers} | 题型集: {types}')
    for file, no, typ, ans, stem in v:
        print(f'    {file} | 源题号{no} | {typ} | 答案{ans}')

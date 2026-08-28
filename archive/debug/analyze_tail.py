# -*- coding: utf-8 -*-
"""分析：题干提取答案后，残留文本中是否还含内联选项片段（尾段字母+分隔符+文字）"""
import json, sys, io, re
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
data = json.load(open(r'c:\Users\lenovo\Desktop\题库\_tmp_text\parsed.json', encoding='utf-8'))

TAIL_OPT = re.compile(r'([A-ZＡ-Ｚ])\s*[.、．:：)）]\s*([^\s，。]{1,60})\s*$')
cnt = 0
for af in data:
    for q in af['questions']:
        if q['answer_src'] in ('题干', '题干(后续行)'):
            stem0 = None
            # 重新从 raw_lines 里取残留文本太复杂，这里直接从 stem 与选项推断
            pass
# 直接看题干里是否含 "X、" 形式的尾段选项
for af in data:
    for q in af['questions']:
        s = q['stem']
        m = TAIL_OPT.search(s)
        if m:
            cnt += 1
            print(f"{af['file']} | {q['sec_type']} | {q['src_no']}")
            print(f"   题干尾段: ...{s[-40:]}")
            print(f"   匹配字母: {m.group(1)} 文字: {m.group(2)}")
            print(f"   答案: {q['answer']} 选项: {[l for l,_ in q['options']]}")
print('总数:', cnt)

# -*- coding: utf-8 -*-
import json, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
data = json.load(open(r'c:\Users\lenovo\Desktop\题库\_tmp_text\bc_parsed.json', encoding='utf-8'))
for af in data:
    if af['file'] in ('28_数字金融部_C', '13_科技部_B', '29_运营管理部_B'):
        print('='*80)
        print(af['file'], '章节=', af['chapter'])
        for q in af['questions'][:12]:
            print(f"[{q['src_no']}] {q['sec_type']} 答案={q['answer']}")
            print(f"   题干: {q['stem'][:70]}")
            print(f"   选项: {[(l, t[:40]) for l, t in q['options']]}")
            if q['note']:
                print(f"   注: {q['note'][:40]}")

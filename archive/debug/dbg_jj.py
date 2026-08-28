# -*- coding: utf-8 -*-
import json, sys, io, re
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
data = json.load(open(r'c:\Users\lenovo\Desktop\题库\_tmp_text\parsed.json', encoding='utf-8'))
for af in data:
    if af['file'] == '2026年驻行纪检组题库':
        for q in af['questions']:
            if q['src_no'] == 5 and q['sec_type'] == '多选题':
                print('answer:', q['answer'])
                print('options:', q['options'])
                print('flags:', q['flags'])
                for i, l in enumerate(q['raw_lines']):
                    print(f'  [{i}] {l}')

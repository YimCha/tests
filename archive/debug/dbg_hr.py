# -*- coding: utf-8 -*-
import json, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
data = json.load(open(r'c:\Users\lenovo\Desktop\题库\_tmp_text\parsed.json', encoding='utf-8'))
for af in data:
    if af['file'] == '2026年人力资源部题库':
        for q in af['questions']:
            print('='*60)
            print('src_no:', q['src_no'], '| type:', q['sec_type'], '| answer:', q['answer'])
            print('stem:', q['stem'])
            print('options:', q['options'])
            print('flags:', q['flags'])
            print('raw:', ' ▏ '.join(q['raw_lines']))

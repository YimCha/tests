# -*- coding: utf-8 -*-
import sys, io, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

bc = json.load(open(r'c:\Users\lenovo\Desktop\题库\data\tmp\bc_parsed.json', encoding='utf-8'))
print('文件数:', len(bc))
for g in bc[:5]:
    print('keys:', list(g.keys()))
    print('chapter=', repr(g.get('chapter')), '| file=', repr(g.get('file')))
    qs = g.get('questions', [])
    if qs:
        print('  q keys:', list(qs[0].keys()))
        print('  q0 sec_type=', qs[0].get('sec_type'), 'valid=', qs[0].get('valid'))
    print('---')

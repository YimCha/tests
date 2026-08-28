# -*- coding: utf-8 -*-
import sys, io, importlib.util
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
spec = importlib.util.spec_from_file_location('pbc', r'c:\Users\lenovo\Desktop\题库\_tmp_text\parse_bc.py')
pbc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pbc)
f = r'c:\Users\lenovo\Desktop\题库\_tmp_text\bc\13_科技部_B.txt'
sections, raw = pbc.parse_file(f)
for sec, qs in sections:
    print('=== section:', sec, len(qs))
    for q in qs:
        if q['src_no'] in (19, 20, 21):
            print('  Q', q['src_no'], 'raw_lines:', q['raw_lines'])

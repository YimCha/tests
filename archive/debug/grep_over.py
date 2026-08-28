# -*- coding: utf-8 -*-
import re, sys, io, glob, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
pat = re.compile(r'([I-Z])[\s]*[.、．:：)）]')
for f in sorted(glob.glob(r'c:\Users\lenovo\Desktop\题库\_tmp_text\*.txt')):
    if os.path.basename(f).endswith('parse_a.py') or f.endswith('dbg1.py') or f.endswith('dbg2.py') or f.endswith('dbg3.py') or f.endswith('dbg4.py'):
        continue
    txt = open(f, encoding='utf-8-sig').read()
    hits = [ln.strip() for ln in txt.split('\n') if pat.search(ln)]
    if hits:
        print(os.path.basename(f))
        for h in hits[:12]:
            print('   ', h[:80])

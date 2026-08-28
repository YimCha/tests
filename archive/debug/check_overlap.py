# -*- coding: utf-8 -*-
import json, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
data = json.load(open(r'c:\Users\lenovo\Desktop\题库\_tmp_text\parsed.json', encoding='utf-8'))
def show(afile, no, typ=None):
    for af in data:
        if af['file'] == afile:
            for q in af['questions']:
                if q['src_no'] == no and (typ is None or q['sec_type'] == typ):
                    print(f"[{afile} | {typ} | 源题号{no}] 答案={q['answer']}")
                    print('  题干:', q['stem'])
                    print('  选项:', q['options'])
                    print()
show('2026党风廉政办题库', 1, '判断题')
show('2026年驻行纪检组题库', 3, '判断题')
print('#'*60)
show('2026年机关党委纪委办题库', 1, '判断题')
show('2026年驻行纪检组题库', 4, '判断题')
print('#'*60)
show('2026年机关党委纪委办题库', 2, '判断题')
show('2026年驻行纪检组题库', 2, '判断题')

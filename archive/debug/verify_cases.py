# -*- coding: utf-8 -*-
import json, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
data = json.load(open(r'c:\Users\lenovo\Desktop\题库\_tmp_text\parsed.json', encoding='utf-8'))

def find(afile, no, typ):
    for af in data:
        if af['file'] == afile:
            for q in af['questions']:
                if q['src_no'] == no and q['sec_type'] == typ:
                    return q
    return None

def show(label, q):
    print('='*60)
    print(label)
    if q is None:
        print('  NOT FOUND'); return
    print('  answer:', q['answer'], '| src:', q['answer_src'])
    print('  stem:', q['stem'])
    print('  options:', q['options'])
    print('  flags:', q['flags'])

show('驻行纪检组 Q5 多选', find('2026年驻行纪检组题库', 5, '多选题'))
show('授信审批部 Q2 单选', find('2026年授信审批部题库', 2, '单选题'))
show('授信审批部 Q7 单选', find('2026年授信审批部题库', 7, '单选题'))
show('人力 Q2 单选(双空BB)', find('2026年人力资源部题库', 2, '单选题'))
show('人力 Q3 单选(双空AA)', find('2026年人力资源部题库', 3, '单选题'))
show('人力 Q4 单选(三空BBB)', find('2026年人力资源部题库', 4, '单选题'))
show('人力 Q2 多选(党旗CF)', find('2026年人力资源部题库', 2, '多选题'))
show('安保 Q1 多选(ABEGJ)', find('2026年安全保卫部题库', 1, '多选题'))

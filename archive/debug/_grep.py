# -*- coding: utf-8 -*-
import io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
t = open(r'c:\Users\lenovo\Desktop\题库\4_脚本\template.html', encoding='utf-8').read()
print('go(mistake) singular:', t.count("go('mistake')"))
print('go(mistakes) plural:', t.count("go('mistakes')"))

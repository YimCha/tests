# -*- coding: utf-8 -*-
"""从 master_bank.xlsx（经 bank_loader）注入 template.html，输出单文件离线刷题工具。
输出文件名与标题/页脚等元数据均来自 config.xlsx 的「工具配置」sheet，代码不含业务信息。
母题库或配置更新后重跑本脚本即可。"""
import json, os
from collections import Counter
from bank_loader import load_bank

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TPL = os.path.join(BASE, 'src', 'template.html')
OUT_META = os.path.join(BASE, 'src', 'debug', '_output.json')


def main():
    bank = load_bank()
    meta = bank['meta']
    out_name = meta.get('输出文件名') or '刷题工具.html'
    out = os.path.join(BASE, out_name)
    chapters = bank['chapters']
    qs = bank['q']

    data_json = json.dumps(bank, ensure_ascii=False, separators=(',', ':'))
    # 防止题干文本里的 "</script>" 截断内嵌脚本
    data_json = data_json.replace('</', '<\\/')

    tpl = open(TPL, encoding='utf-8').read()
    assert '__BANK_DATA__' in tpl, 'template 缺少 __BANK_DATA__ 占位符'
    for key in ('__TOOL_TITLE__', '__FOOTER_1__', '__FOOTER_2__'):
        assert key in tpl, f'template 缺少 {key} 占位符'
    html = tpl.replace('__BANK_DATA__', data_json)
    html = html.replace('__TOOL_TITLE__', meta.get('工具标题') or '')
    html = html.replace('__FOOTER_1__', meta.get('页脚第一行') or '')
    html = html.replace('__FOOTER_2__', meta.get('页脚第二行') or '')
    with open(out, 'w', encoding='utf-8') as f:
        f.write(html)

    # 供测试脚本定位成品文件（文件名可配置，不硬编码在测试里）
    with open(OUT_META, 'w', encoding='utf-8') as f:
        json.dump({'file': out_name}, f, ensure_ascii=False)

    print('生成 ->', out)
    print('章节数:', len(chapters), '| 题目数:', len(qs))
    print('题型分布:', dict(Counter(q['t'] for q in qs)))
    for i, p in enumerate(bank['positions']):
        n = sum(1 for q in qs if i in q['p'])
        b = sum(1 for q in qs if i in q['p'] and chapters[q['ch']].endswith('B类'))
        c = sum(1 for q in qs if i in q['p'] and chapters[q['ch']].endswith('C类'))
        print(f'  {p["name"]}: 合计{n} (B类{b} C类{c})')


if __name__ == '__main__':
    main()

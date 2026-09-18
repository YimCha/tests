# -*- coding: utf-8 -*-
"""母题库一致性体检：扫描《母题库》内部的格式不统一与疑似笔误，按类归集，
为"规范母题库 + 搜集规则"提供客观清单。

用法
    python src/audit_master.py                 # 打印摘要 + 导出 data/tmp/audit_master_report.xlsx
    python src/audit_master.py --quiet         # 仅导出报告，不打印明细

设计
    只读 master_bank.xlsx 与（若存在的）import_text.json 缓存，不依赖 Word，不修改任何文件。
    每类问题给出：命中数、示例、以及"建议规范写法"，便于逐类定规则。
    不自动改写母题库——规范动作放在单独的 normalize 步骤，且必须先出差异报告、人工确认后再写回。
"""
import argparse
import re
from collections import Counter, defaultdict
from pathlib import Path

import openpyxl

BASE = Path(__file__).resolve().parent.parent
DATA = BASE / 'data'
MASTER = DATA / 'master_bank.xlsx'
RAW_CACHE = DATA / 'tmp' / 'import_text.json'
OUT = DATA / 'tmp' / 'audit_master_report.xlsx'

# 只扫这些列（题干与选项最易藏格式问题；正确答案/解析顺带看）
SCAN_COLS = ['题干', '选项A', '选项B', '选项C', '选项D', '选项E', '选项F', '选项G', '选项H', '正确答案', '解析']

CJK = '\u4e00-\u9fff'
# 半角括号字符（全角为 （）【】）
HALF_BR = re.compile(r'[()\[\]]')
# 全角空括号带内部空格 / 半角空括号：形态不统一
SPACE_EMPTY_BR = re.compile(r'[（(]\s+[）)]')
# 直引号（应为全角弯引号 “ ” ‘ ’）
ASCII_QUOTE = re.compile(r'["\']')
# 选项开头"字母直接连中文"——母题库照抄源文件的字母前缀笔误（如 A印控仪 / D年）
STRAY_PREFIX = re.compile(r'^[A-Za-z]\s*[' + CJK + r']')
# 疑似 0/O 笔误：零后接大写字母（如 0A 协同）
ZERO_LETTER = re.compile(r'0[A-Za-z]')
# 保留的填空占位符
EMPTY_FULL_BR = re.compile(r'（）')


def load_master():
    wb = openpyxl.load_workbook(MASTER, read_only=True)
    ws = wb[wb.sheetnames[0]]
    rows = list(ws.iter_rows(values_only=True))
    head = [str(h).strip() if h is not None else '列%d' % i for i, h in enumerate(rows[0])]
    recs = []
    for r in rows[1:]:
        if not any(c is not None and str(c).strip() for c in (r or [])):
            continue
        rec = {head[i]: ('' if r[i] is None else str(r[i]).strip()) for i in range(len(head))}
        recs.append(rec)
    return recs, head


def each_cell(recs):
    """yield (章节, 源题号, 题型, 列, 值)。"""
    for rec in recs:
        ch = rec.get('章节', '')
        num = rec.get('源题号', '')
        typ = rec.get('题型', '')
        for col in SCAN_COLS:
            v = rec.get(col, '')
            if v:
                yield ch, num, typ, col, v


def scan():
    recs, _ = load_master()
    cats = {
        '括号半角/空格形态': [],     # 题干/选项里出现半角 ()[] 或带空格的空括号
        '引号直/弯混用': [],        # 出现直引号 " '
        '判断题尾句号缺失': [],      # 判断题题干不以 。结尾（母题库多数保留，少数缺失）
        '选项多余字母前缀': [],      # 选项以 A-D+中文 开头（照抄源文件笔误）
        '空括号写法不统一': [],      # 空括号形态不是标准 （）
        '0/O 疑似笔误': [],         # 0 后接字母
        '保留填空占位符（）': [],    # 题干含 （） 的"留空括号"题集（与多数"整段删除"不一致）
    }
    judge_total = judge_period = 0
    for ch, num, typ, col, v in each_cell(recs):
        tag = (ch, str(num), typ, col)
        # 括号半角/空格
        if HALF_BR.search(v) or SPACE_EMPTY_BR.search(v):
            cats['括号半角/空格形态'].append((tag, v))
        # 引号直/弯
        if ASCII_QUOTE.search(v):
            cats['引号直/弯混用'].append((tag, v))
        # 选项多余字母前缀
        if col.startswith('选项') and STRAY_PREFIX.match(v):
            cats['选项多余字母前缀'].append((tag, v))
        # 空括号写法不统一
        for m in re.finditer(r'[（(]\s*[）)]', v):
            if m.group(0) != '（）':
                cats['空括号写法不统一'].append((tag, v))
                break
        # 0/O 笔误
        if ZERO_LETTER.search(v):
            cats['0/O 疑似笔误'].append((tag, v))
        # 判断题尾句号
        if typ == '判断题' and col == '题干':
            judge_total += 1
            if not v.endswith('。'):
                cats['判断题尾句号缺失'].append((tag, v))
            else:
                judge_period += 1
        # 保留填空占位符
        if '（）' in v and typ in ('单选题', '多选题', '判断题') and col == '题干':
            cats['保留填空占位符（）'].append((tag, v))

    ctx = {'judge_total': judge_total, 'judge_period': judge_period}
    return cats, ctx


SUGGEST = {
    '括号半角/空格形态': '统一为全角无空格 （）。半角 ()[] 与带空格 （ ） 一律改写。',
    '引号直/弯混用': '统一为全角弯引号 “ ” ‘ ’，删除直引号 " \'。',
    '判断题尾句号缺失': '母题库 226 道判断题中 %d 道以 。结尾；少数缺失者按多数补齐尾句号。' % 0,
    '选项多余字母前缀': '选项开头的多余字母（如 A印控仪 / D年）删掉，仅保留中文内容。',
    '空括号写法不统一': '空括号统一为 （）（无空格）；或按业务决定"整段删除"。',
    '0/O 疑似笔误': '0 后接字母多为 O 误输（如 0A 协同 → OA 协同），逐条核实后修正。',
    '保留填空占位符（）': '与"整段删除"二选一统一：填空类题目保留 （），答案标注类整段删除。',
}


def print_report(cats, ctx, quiet):
    print('母题库一致性体检报告')
    print('  判断题总数 %d，其中以 。结尾 %d，缺失 %d'
          % (ctx['judge_total'], ctx['judge_period'], ctx['judge_total'] - ctx['judge_period']))
    print('-' * 60)
    for name, items in cats.items():
        print('\n### %s ：%d 处' % (name, len(items)))
        print('  建议规范：%s' % SUGGEST[name].replace('%d', str(ctx['judge_total'] - ctx['judge_period'])))
        for tag, v in items[:12]:
            print('   [%s][%s][%s][%s]  %s' % (tag[0], tag[1], tag[2], tag[3], v[:50]))
        if len(items) > 12:
            print('   … 其余 %d 处见报告文件' % (len(items) - 12))


_ILLEGAL_SHEET = re.compile(r'[\\/*?:\[\]]')


def sanitize_title(name):
    # Excel 工作表名禁止 \ / * ? : [ ]，统一替换为全角「・」便于阅读
    return _ILLEGAL_SHEET.sub('・', name)[:28]


def write_xlsx(cats, ctx):
    import openpyxl as ox
    from openpyxl.styles import Font
    wb = ox.Workbook()
    meta = wb.active
    meta.title = '摘要'
    meta.append(['类别', '命中数', '建议规范写法'])
    for name, items in cats.items():
        meta.append([name, len(items), SUGGEST[name].replace('%d', str(ctx['judge_total'] - ctx['judge_period']))])
    meta.append(['判断题总数', ctx['judge_total'], ''])
    meta.append(['判断题以。结尾', ctx['judge_period'], ''])
    meta.append(['判断题尾句号缺失', ctx['judge_total'] - ctx['judge_period'], ''])
    for c in meta[1]:
        pass
    # 每类一个 sheet（标题清洗，避免非法字符）
    used = set()
    for name, items in cats.items():
        title = sanitize_title(name)
        base, i = title, 1
        while title in used:
            title = '%s_%d' % (base, i)
            i += 1
        used.add(title)
        ws = wb.create_sheet(title=title)
        ws.append(['章节', '源题号', '题型', '列', '当前值', '建议'])
        for tag, v in items:
            ws.append([tag[0], tag[1], tag[2], tag[3], v, SUGGEST[name].replace('%d', str(ctx['judge_total'] - ctx['judge_period']))])
    wb.save(OUT)
    return OUT


def main():
    ap = argparse.ArgumentParser(description='母题库一致性体检')
    ap.add_argument('--quiet', action='store_true')
    args = ap.parse_args()
    if not MASTER.exists():
        raise SystemExit('缺少母题库：%s' % MASTER)
    cats, ctx = scan()
    if not args.quiet:
        print_report(cats, ctx, args.quiet)
    out = write_xlsx(cats, ctx)
    print('\n报告已导出 -> %s' % out)


if __name__ == '__main__':
    main()

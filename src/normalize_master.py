#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""母题库规范脚本（只读 master_bank.xlsx，产出副本 + 差异报告，绝不回写 master）。

规则（由人工与脚本逐类核对后确定，见 data/tmp/audit_master_report.xlsx）：
  A. 判断题题干尾句号补齐 —— 对齐 207/226 多数派（无句号则补 。）
  B. 直引号 " ' 转全角弯引号 “ ” ‘ ’（成对转换；奇数引号不改并标记需人工）
  C. 选项开头多余单字母前缀剥离（授信审批部B类[5] 的 C级/D级 为合法信用等级，例外保留）

用法：
  python src/normalize_master.py            # 生成副本 + 差异报告并打印摘要
  python src/normalize_master.py --quiet    # 只生成文件，不打印
产物：
  data/master_bank.normalized.xlsx          # 规范后的副本（待人工确认后再决定是否回写）
  data/tmp/normalize_diff.xlsx              # 逐条差异（章节/源题号/题型/列/原值/新值/规则/备注）
"""
import re
import argparse
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
MASTER = ROOT / 'data' / 'master_bank.xlsx'
OUT_COPY = ROOT / 'data' / 'master_bank.normalized.xlsx'
OUT_DIFF = ROOT / 'data' / 'tmp' / 'normalize_diff.xlsx'

CJK = r'\u4e00-\u9fff\u3400-\u4dbf'
# 选项开头多余单字母前缀：一个字母 + 可选空格 + 中文
STRAY_PREFIX = re.compile(r'^[A-Za-z]\s*(?=[' + CJK + r'])')
# 信用等级白名单：不剥前缀（字母是内容一部分，剥掉会变“级”丢信息）
PREFIX_EXCEPT = {
    ('授信审批部B类', '5', '选项A'),   # C级
    ('授信审批部B类', '5', '选项B'),   # D级
}

SCAN_COLS = ['题干', '选项A', '选项B', '选项C', '选项D', '选项E',
             '选项F', '选项G', '选项H', '解析']
OPTION_COLS = {'选项A', '选项B', '选项C', '选项D', '选项E', '选项F', '选项G', '选项H'}


# ---------------------------------------------------------------------------
# 规则实现
# ---------------------------------------------------------------------------
def add_judge_period(stem):
    """判断题题干补尾句号。返回 (新值, 是否改动)。"""
    s = (stem or '').rstrip()
    if s.endswith('。'):
        # 已合规；若原值仅是尾部空白差异，仍按原值返回（不改）
        return stem, False
    return s + '。', True


def to_curly(s):
    """直引号转弯引号。返回 (新值, 是否改动, 是否需人工)。
    成对转换（左→“ 右→”）；若某类引号数量为奇数，不转换并标记需人工。"""
    if '"' not in s and "'" not in s:
        return s, False, False
    if s.count('"') % 2 or s.count("'") % 2:
        return s, False, True
    out, dq, sq = [], True, True
    for ch in s:
        if ch == '"':
            out.append('“' if dq else '”')
            dq = not dq
        elif ch == "'":
            out.append('‘' if sq else '’')
            sq = not sq
        else:
            out.append(ch)
    return ''.join(out), True, False


def strip_prefix(s, key):
    """选项开头多余单字母前缀剥离。返回 (新值, 是否改动)。"""
    if key in PREFIX_EXCEPT:
        return s, False
    if not s:
        return s, False
    if STRAY_PREFIX.match(s):
        return s[1:].lstrip(), True
    return s, False


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------
def normalize_cell(col, val, rowkey, qtype):
    """对单个单元格按规则归一化。

    返回 (新值, 真实改动[(规则,备注)], 需人工[(列,说明)])。
    真实改动 = 新值 != 原值；需人工 = 检测到但不安全自动改（如奇数引号）。
    """
    if val is None:
        return val, [], []
    changes = []
    manual = []
    new = val

    if col == '题干' and qtype == '判断题':
        n, ch = add_judge_period(new)
        if ch:
            new = n
            changes.append(('A-判断题补句号', ''))

    # 规则 B：直引号转弯引号（题干/选项/解析）
    if col in SCAN_COLS:
        n, ch, is_manual = to_curly(new)
        if is_manual:
            manual.append((col, '直引号奇数/不配对，未自动改，需人工决定'))
        elif ch:
            new = n
            changes.append(('B-直引号转弯引号', ''))

    # 规则 C：选项多余字母前缀
    if col in OPTION_COLS:
        n, ch = strip_prefix(new, rowkey + (col,))
        if ch:
            new = n
            changes.append(('C-去选项前缀', ''))

    return new, changes, manual


def main():
    ap = argparse.ArgumentParser(description='母题库规范（副本 + 差异报告）')
    ap.add_argument('--quiet', action='store_true')
    args = ap.parse_args()

    if not MASTER.exists():
        raise SystemExit('缺少母题库：%s' % MASTER)

    wb = openpyxl.load_workbook(MASTER)
    ws = wb.active
    hdr = [c.value for c in ws[1]]
    idx = {name: hdr.index(name) for name in
           ('章节', '源题号', '题型', '题干', '选项A', '选项B', '选项C', '选项D',
            '选项E', '选项F', '选项G', '选项H', '正确答案', '解析', '需复核')
           if name in hdr}
    cols = [c for c in SCAN_COLS if c in idx]

    diffs = []          # (章节, 源题号, 题型, 列, 原值, 新值, 规则, 备注)
    rule_count = {}
    manual_rows = []     # (章节, 源题号, 题型, 列, 原值, 说明)

    for r in range(2, ws.max_row + 1):
        chapter = ws.cell(r, idx['章节'] + 1).value
        srcno = ws.cell(r, idx['源题号'] + 1).value
        qtype = ws.cell(r, idx['题型'] + 1).value
        rowkey = (str(chapter), str(srcno))

        for col in cols:
            ci = idx[col] + 1
            val = ws.cell(r, ci).value
            new, changes, manual = normalize_cell(col, val, rowkey, qtype)
            for mcol, mnote in manual:
                manual_rows.append((chapter, srcno, qtype, mcol, val, mnote))
            if changes:
                for rule, note in changes:
                    rule_count[rule] = rule_count.get(rule, 0) + 1
                    diffs.append((chapter, srcno, qtype, col, val, new, rule, note))
                    ws.cell(r, ci).value = new  # 改在副本上，不动 master

    # 写副本
    OUT_COPY.parent.mkdir(parents=True, exist_ok=True)
    wb.save(OUT_COPY)

    # 写差异报告
    OUT_DIFF.parent.mkdir(parents=True, exist_ok=True)
    dwb = openpyxl.Workbook()
    meta = dwb.active
    meta.title = '摘要'
    meta.append(['规则', '改动数', '说明'])
    for rule, cnt in rule_count.items():
        meta.append([rule, cnt, ''])
    meta.append(['需人工（未自动改）', len(manual_rows), '奇数/不配对引号，见“需人工”页'])
    meta.append(['合计真实改动', len(diffs), ''])
    meta.append(['源文件', str(MASTER), ''])
    meta.append(['副本', str(OUT_COPY), '（待人工确认后再决定是否回写 master）'])
    ds = dwb.create_sheet('差异明细')
    ds.append(['章节', '源题号', '题型', '列', '原值', '新值', '规则', '备注'])
    for d in diffs:
        ds.append(list(d))
    if manual_rows:
        ms = dwb.create_sheet('需人工')
        ms.append(['章节', '源题号', '题型', '列', '原值', '说明'])
        for m in manual_rows:
            ms.append(list(m))
    dwb.save(OUT_DIFF)

    if not args.quiet:
        print('母题库规范完成（未改动 master，仅产出副本 + 差异报告）')
        print('=' * 60)
        for rule, cnt in rule_count.items():
            print('  %-22s %d 处' % (rule, cnt))
        print('  需人工（未自动改）      %d 处' % len(manual_rows))
        print('  合计真实改动 %d 处' % len(diffs))
        print('  副本 -> %s' % OUT_COPY)
        print('  差异 -> %s' % OUT_DIFF)
        if not diffs:
            print('  （无改动，母题库已符合规范）')
    return OUT_COPY, OUT_DIFF


if __name__ == '__main__':
    main()

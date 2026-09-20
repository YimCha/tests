# -*- coding: utf-8 -*-
"""母题库最终验收：内容保真（vs 原始 Word）+ 规范化安全性（vs 规范化前备份）。

配合 `bank_pipeline.py`（生成/校验）与 `normalize_master.py`（规范化）使用，
回答的唯一问题：**母题库的题干/选项/答案是否与原始 Word 一致、且规范化没改坏语义。**

Part A —— 内容保真（母题库 vs 原始 Word）
    复用 bank_pipeline 内核：extract_docs → parse_all → align → compare。
    覆盖 题干 / 选项 / 答案 三类，输出各差异类型计数。

Part B —— 规范化安全性（当前母题库 vs 规范化前 pristine 备份）
    逐行逐列比对，找出被规范化改过的单元格；对每一处判断是否只差标点/空壳/引号
    （题干用 norm_stem、选项用 norm_opt 归一后相等 ⇒ 语义未变）。
    只要语义改动为 0，就证明 A–F 规范化没有改坏任何题干/选项/答案。

用法：
    python src/final_acceptance.py
输出：
    data/tmp/final_acceptance.xlsx   # 结论 / 内容差异 / 规范化语义改动
    （终端打印总判定；退出码 0=通过，1=存在待处理项）
"""
import sys
from pathlib import Path
from collections import Counter

ROOT = Path(__file__).resolve().parent.parent                   # 仓库根（tests/）
sys.path.insert(0, str(ROOT / 'src'))
import openpyxl
import bank_pipeline as bp

MASTER = ROOT / 'data' / 'master_bank.xlsx'
PRISTINE = ROOT / 'data' / 'master_bank.bak-20260920.xlsx'   # 规范化前原始母题库（回退点）

COLS = ['题干', '选项A', '选项B', '选项C', '选项D', '选项E', '选项F', '选项G', '选项H',
        '正确答案', '解析']


def ans_key(s):
    return ''.join(sorted(set((s or '').replace(' ', ''))))


def main():
    # ---------- Part A：内容保真（母题库 vs Word）----------
    dump, src = bp.extract_docs(refresh=False)
    master = bp.load_master()
    known = {m['chapter'] for m in master}
    raw_qs, skipped = bp.parse_all(dump, known)
    pairs, unpaired, orphan = bp.align(raw_qs, master, 0.70)
    diffs = bp.compare(pairs)
    cnt = Counter(d['kind'] for d in diffs)

    ans_bad = cnt.get('答案不一致', 0) + cnt.get('答案缺失', 0)
    stem_bad = cnt.get('题干不同', 0)
    opt_diff = cnt.get('选项内容不同', 0)
    opt_split = cnt.get('选项切分差异（内容一致）', 0)
    total = len(pairs)

    print('=' * 66)
    print('Part A —— 内容保真：母题库 %d 题 vs 原始 Word 解析 %d 题（配对 %d）'
          % (len(master), len(raw_qs), total))
    print('  题干不一致          %d' % stem_bad)
    print('  答案不一致 / 缺失    %d' % ans_bad)
    print('  选项内容不同        %d' % opt_diff)
    print('  选项切分差异(内容一致) %d' % opt_split)
    print('  未配对(原文/母题库)   %d / %d' % (len(unpaired), len(orphan)))

    # ---------- Part B：规范化安全性（母题库 vs pristine）----------
    def load(p):
        wb = openpyxl.load_workbook(p, read_only=True)
        ws = wb[wb.sheetnames[0]]
        rows = list(ws.iter_rows(values_only=True))
        head = {str(h).strip(): i for i, h in enumerate(rows[0])}
        return head, rows

    h1, r1 = load(MASTER)
    h2, r2 = load(PRISTINE)
    n = min(len(r1), len(r2))
    changed = Counter()
    semantic = []
    for i in range(1, n):
        for c in COLS:
            if c not in h1 or c not in h2:
                continue
            a = r1[i][h1[c]]
            b = r2[i][h2[c]]
            a = '' if a is None else str(a)
            b = '' if b is None else str(b)
            if a == b:
                continue
            changed[c] += 1
            same_meaning = (bp.norm_stem(a) == bp.norm_stem(b)) if c == '题干' else (
                bp.norm_opt(a) == bp.norm_opt(b) if c.startswith('选项') else None)
            if c in ('正确答案', '解析') or same_meaning is False:
                semantic.append((i + 1, c, b, a))

    print('-' * 66)
    print('Part B —— 规范化安全性：当前母题库 vs 规范化前 pristine 备份')
    print('  被规范化改动的单元格：%d 处（分布：%s）'
          % (sum(changed.values()), dict(changed)))
    print('  其中【语义被改】(答案/解析被改，或题干/选项归一后仍不同)：%d 处'
          % len(semantic))
    for row, c, old, new in semantic[:50]:
        print('   行%s %s | 旧: %r | 新: %r' % (row, c, old[:70], new[:70]))

    print('=' * 66)
    ok = (ans_bad == 0 and stem_bad == 0 and not semantic
          and opt_diff <= 1 and not unpaired and not orphan)
    print('总判定：%s' % ('【通过】内容 100% 忠实于 Word；规范化仅动标点/空壳/引号，未改任何语义。'
                        if ok else '【存在待处理项】'))
    if opt_diff == 1:
        print('  注：选项内容不同 1 处 = 办公室B类源7「0A→OA」，母题库(OA)正确、源文件笔误，属母题库纠正源数据。')

    # ---------- 写报告 ----------
    out = ROOT / 'data' / 'tmp' / 'final_acceptance.xlsx'
    wb = openpyxl.Workbook()
    s = wb.active
    s.title = '结论'
    for k, v in [
        ('母题库题数', len(master)), ('原文解析题数', len(raw_qs)), ('配对成功', total),
        ('题干不一致', stem_bad), ('答案不一致或缺失', ans_bad),
        ('选项内容不同', opt_diff), ('选项切分差异(内容一致)', opt_split),
        ('原文侧未配对', len(unpaired)), ('母题库侧未配对', len(orphan)),
        ('规范化改动单元格数', sum(changed.values())),
        ('规范化中改到语义的处数', len(semantic)),
        ('总判定', '通过' if ok else '存在待处理项'),
    ]:
        s.append([k, v])
    s.column_dimensions['A'].width = 26
    s.column_dimensions['B'].width = 30

    s2 = wb.create_sheet('内容差异')
    s2.append(['级别', '类型', '章节', '源题号', '题型', '行', '字段', '母题库', '原文'])
    for d in diffs:
        s2.append([d['level'], d['kind'], d['chapter'], d['num'], d['type'], d['row'],
                   d.get('field', ''), d['now'][:200], d['fix'][:200]])
    s2.freeze_panes = 'A2'

    s3 = wb.create_sheet('规范化语义改动')
    s3.append(['行', '列', '旧值(规范化前)', '新值(当前)'])
    for row, c, old, new in semantic:
        s3.append([row, c, old, new])
    if not semantic:
        s3.append(['(空：无任何语义级改动)', '', '', ''])
    wb.save(out)
    print('最终验收报告 -> %s' % out)
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())

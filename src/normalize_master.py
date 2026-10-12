#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""母题库规范脚本（只读 master_bank.xlsx，产出副本 + 差异报告，绝不回写 master）。

规则（由人工与脚本逐类核对后确定，见 data/tmp/audit_master_report.xlsx）：
  A. 判断题题干尾句号补齐 —— 对齐 207/226 多数派（无句号则补 。）
  B. 直引号 " ' 转全角弯引号 “ ” ‘ ’（成对转换；奇数引号先补闭合再转，见 E）
  E. 奇数直引号补闭合（源数据漏收尾引号，末尾补闭合后统一转弯引号；不增删原意）
  F. 清理“壳前后双句号”（。（）。→。（），仅删壳后多余句号，不增删原意；适用于单选题题干等）
  C. 选项开头多余单字母前缀剥离（授信审批部B类[5] 的 C级/D级 为合法信用等级，例外保留）
  D. 圆括号答案标注统一留空壳（）——以修复后的 import 产物为基准，凡是母题库与它仅缺
     （）之差者，自动补壳（去答案字母、留（）占位）；方括号【X】维持删除。不篡改原意。

用法：
  python src/normalize_master.py            # 生成副本 + 差异报告并打印摘要
  python src/normalize_master.py --quiet    # 只生成文件，不打印
产物：
  data/master_bank.normalized.xlsx          # 规范后的副本（待人工确认后再决定是否回写）
  data/tmp/normalize_diff.xlsx              # 逐条差异（章节/源题号/题型/列/原值/新值/规则/备注）
"""
import re
import argparse
import datetime
import shutil
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
MASTER = ROOT / 'data' / 'master_bank.xlsx'
OUT_COPY = ROOT / 'data' / 'master_bank.normalized.xlsx'
OUT_DIFF = ROOT / 'data' / 'tmp' / 'normalize_diff.xlsx'
# import 修复版（圆括号答案标注已统一留空壳（））作为"应然壳版"基准
IMPORTED = ROOT / 'data' / 'master_bank.imported.xlsx'


def strip_shell(s):
    """去掉所有圆括号空壳（），用于判断两端差异是否仅（）有无。"""
    return (s or '').replace('（）', '')


def eq_ignore_ws(a, b):
    """去掉（）与所有空白后比较，用于判定两端差异是否仅（）有无（容忍壳前/壳后空格）。"""
    return re.sub(r'\s+', '', strip_shell(a)) == re.sub(r'\s+', '', strip_shell(b))


def norm_brackets(s):
    """圆/半角空括号（含内部空格，如（ ）/( )）统一为全角无空格（）；不影响含内容的括号如（含）。"""
    s = re.sub(r'\(\s*\)', '（）', s)
    s = re.sub(r'（\s*）', '（）', s)
    return s


def cell_key(s):
    """列级内容指纹：去（）空壳 + 圆半角空括号归一 + 去空白；用于按题干/选项内容精确匹配。"""
    return re.sub(r'\s+', '', strip_shell(norm_brackets(s or '')))

CJK = r'\u4e00-\u9fff\u3400-\u4dbf'
# 选项开头多余单字母前缀：一个字母 + 可选空格 + 中文
STRAY_PREFIX = re.compile(r'^[A-Za-z]\s*(?=[' + CJK + r'])')
# 信用等级白名单：不剥前缀（字母是内容一部分，剥掉会变“级”丢信息）
PREFIX_EXCEPT = {
    ('授信审批部B类', '多选题', '5', '选项A'),   # C级（合法信用等级，非乱入字母，保留）
    ('授信审批部B类', '多选题', '5', '选项B'),   # D级
}

SCAN_COLS = ['题干', '选项A', '选项B', '选项C', '选项D', '选项E',
             '选项F', '选项G', '选项H', '解析']
OPTION_COLS = {'选项A', '选项B', '选项C', '选项D', '选项E', '选项F', '选项G', '选项H'}


# ---------------------------------------------------------------------------
# 规则实现
# ---------------------------------------------------------------------------
def add_judge_period(stem):
    """判断题题干补尾句号（壳感知，避免重复句号）。返回 (新值, 是否改动)。

    句号应位于正文末尾、（）空壳占位之前：
      · 正文已以“。”结尾 → 不动；
      · 末尾为“（）”而正文缺句号 → 补在壳前；
      · 修复历史误加的“壳后多余句号”（如 “...。（）。” → “...。（）”）。“”
    """
    s = (stem or '').strip()
    # 修复历史误加：若“（）”后还跟句号（壳后多余句号），去掉该句号
    s = re.sub(r'（）\s*。', '（）', s)
    # 提取并暂存末尾空壳（）
    m = re.search(r'\s*（）\s*$', s)
    shell = m.group(0) if m else ''
    core = s[:len(s) - len(shell)] if shell else s
    core = core.rstrip()
    if not core.endswith('。'):
        core = core + '。'
    new = core + shell
    return new, new != (stem or '')


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


def close_odd_quotes(s):
    """奇数个直引号：在末尾补闭合引号（源数据漏闭合，最常见是整句/整词缺收尾引号）。

    仅补闭合、不增删其它内容，原意不变；随后由 to_curly 统一转弯引号。若某类引号仍为奇数
    （理论上补后不会再奇数），交由 to_curly 标记需人工。
    """
    if s is None:
        return s
    if s.count('"') % 2 == 1:
        s = s + '"'
    if s.count("'") % 2 == 1:
        s = s + "'"
    return s


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
def shell_count(s):
    """统计单元格内圆括号空壳（）的个数（形态已规整）。"""
    return norm_brackets(s or '').count('（）')


def shell_gap_report(out_path=OUT_COPY):
    """核对规范副本/母题库与 import 修复版的（）壳一致性（按 章节+题型+题干内容 对应）。

    返回 (已核对行数, 母题库仍缺壳数, 母题库仍多壳数)。缺壳=import 比母题库多壳
    （即可能漏补）；多壳=母题库比 import 多壳（通常为 import 误删，母题库保留，安全）。
    """
    if not (out_path.exists() and IMPORTED.exists()):
        return 0, 0, 0
    wb = openpyxl.load_workbook(OUT_COPY, read_only=True)
    ws = wb.active
    mh = [c.value for c in ws[1]]
    mrows = {}
    for row in ws.iter_rows(min_row=2, values_only=True):
        if not any(c is not None and str(c).strip() for c in (row or [])):
            continue
        rec = {mh[i]: ('' if row[i] is None else str(row[i])) for i in range(len(mh))}
        key = (rec.get('章节', ''), rec.get('题型', ''), cell_key(rec.get('题干', '')))
        mrows[key] = rec
    iwb = openpyxl.load_workbook(IMPORTED, read_only=True)
    iws = iwb.active
    ih = [c.value for c in iws[1]]
    cols = [c for c in SCAN_COLS if c in ih and c in mh]
    lack = extra = checked = 0
    for row in iws.iter_rows(min_row=2, values_only=True):
        if not any(c is not None and str(c).strip() for c in (row or [])):
            continue
        rec = {ih[i]: ('' if row[i] is None else str(row[i])) for i in range(len(ih))}
        key = (rec.get('章节', ''), rec.get('题型', ''), cell_key(rec.get('题干', '')))
        m = mrows.get(key)
        if m is None:
            continue
        checked += 1
        for col in cols:
            ni = shell_count(rec.get(col, ''))
            nm = shell_count(m.get(col, ''))
            if ni > nm:
                lack += 1
            elif nm > ni:
                extra += 1
    return checked, lack, extra


def resolve_imp(impd, imp_by_content, rowkey, mrec, cols):
    """解析母题库某行对应的 import 记录。

    优先按 (章节,题型,源题号) 主键；若主键缺失或题干内容不一致（源题号为空/重复导致
    主键塌缩，仅留最后一行），则按 (章节,题型,cell_key(题干)) 回退，并在多候选时取
    各列内容吻合度最高者（避免“同一题干多条重复题”误配）。
    """
    chapter, qtype, srcno = rowkey
    rec = impd.get(rowkey)
    if rec is not None and cell_key(rec.get('题干', '')) == cell_key(mrec.get('题干', '')):
        return rec
    cands = imp_by_content.get((chapter, qtype, cell_key(mrec.get('题干', ''))), [])
    if not cands:
        return rec
    if len(cands) == 1:
        return cands[0]
    best, best_score = None, -1
    for c in cands:
        score = sum(1 for col in cols if cell_key(c.get(col, '')) == cell_key(mrec.get(col, '')))
        if score > best_score:
            best_score, best = score, c
    return best


def normalize_cell(col, val, rowkey, qtype, imp_val=None):
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

    # 规则 B/E：先补闭合引号（奇数直引号→末尾补），再统一转弯引号（题干/选项/解析）
    if col in SCAN_COLS:
        closed = close_odd_quotes(new)
        n, ch, is_manual = to_curly(closed)
        if is_manual:
            manual.append((col, '直引号奇数/不配对，未自动改，需人工决定'))
        elif ch:
            if closed != new:
                changes.append(('E-补闭合引号并转弯引号', '奇数直引号末尾补闭合后转全角弯引号'))
            else:
                changes.append(('B-直引号转弯引号', ''))
            new = n

    # 规则 C：选项多余字母前缀
    if col in OPTION_COLS:
        n, ch = strip_prefix(new, rowkey + (col,))
        if ch:
            new = n
            changes.append(('C-去选项前缀', ''))

    # 规则 F：清理“壳前后双句号”（如 “...开支。（）。” → “...开支。（）”）——
    # 仅删壳后多余句号，不增删其它内容；仅当“壳前已有句号且壳后还有句号”时触发（单选题题干等也可能出现）。
    if col in SCAN_COLS:
        n = re.sub(r'(。)\s*（）\s*。', r'\1（）', new)
        if n != new:
            new = n
            changes.append(('F-清理壳后多余句号', ''))

    # 规则 D：圆括号答案标注统一留空壳（）
    # 以修复后的 import 产物为基准：若母题库与它在（）之外完全一致、仅壳数不同——
    #   ① 仅当 import 比母题库【多】壳时补壳（母题库缺壳→补留）；
    #   ② 若 import 反而少壳（即 import 误删了母题库正确保留的壳），则保留母题库、不删不改（不篡改原意）。
    # 仅在 A/B/C 未改本格时触发（避免覆盖引号/句号/前缀改动；若同时有非壳改动则留人工）。
    if imp_val is not None and not changes:
        # 先把两端空括号形态统一（含空格变体（ ）/( ) → （）），再判定仅壳差异
        a = norm_brackets(val) if val else ''
        b = norm_brackets(imp_val)
        if val != imp_val and re.sub(r'\s+', '', strip_shell(a)) == re.sub(r'\s+', '', strip_shell(b)):
            n_imp = b.count('（）')
            n_val = a.count('（）')
            if n_imp > n_val:
                new = b                       # 补壳（形态已规整为（））
                changes.append(('D-补圆括号空壳', '对齐 import 修复版：去答案字母、补留（）占位'))
            # 否则母题库壳已正确保留（import 误删侧），保留母题库，不删不改

    return new, changes, manual


def main():
    ap = argparse.ArgumentParser(description='母题库规范（副本 + 差异报告）')
    ap.add_argument('--quiet', action='store_true')
    ap.add_argument('--apply', action='store_true',
                    help='直接回写母题库（先备份 master_bank.bak-YYYYMMDD.xlsx）；默认仅产出副本')
    args = ap.parse_args()

    if not MASTER.exists():
        raise SystemExit('缺少母题库：%s' % MASTER)

    # --apply：回写真值文件前先备份
    if args.apply:
        stamp = datetime.date.today().strftime('%Y%m%d')
        backup = MASTER.with_name('%s.bak-%s.xlsx' % (MASTER.stem, stamp))
        if backup.exists():
            print('备份已存在，跳过：%s' % backup)
        else:
            shutil.copy2(MASTER, backup)
            print('已备份母题库 -> %s' % backup)
        out_path = MASTER
    else:
        out_path = OUT_COPY

    wb = openpyxl.load_workbook(MASTER)
    ws = wb.active
    hdr = [c.value for c in ws[1]]
    idx = {name: hdr.index(name) for name in
           ('章节', '源题号', '题型', '题干', '选项A', '选项B', '选项C', '选项D',
            '选项E', '选项F', '选项G', '选项H', '正确答案', '解析', '需复核')
           if name in hdr}
    cols = [c for c in SCAN_COLS if c in idx]

    # 加载 import 修复版作为规则 D 的补壳基准
    impd = {}
    imp_by_content = {}   # (章节,题型,cell_key(题干)) -> [import rec, ...]（容错：源题号空/冲突时按内容回退匹配）
    if IMPORTED.exists():
        iwb = openpyxl.load_workbook(IMPORTED, read_only=True)
        iws = iwb.active
        ihead = [c.value for c in iws[1]]
        for row in iws.iter_rows(min_row=2, values_only=True):
            if not any(c is not None and str(c).strip() for c in (row or [])):
                continue
            irec = {ihead[i]: ('' if row[i] is None else str(row[i])) for i in range(len(ihead))}
            k3 = (irec.get('章节', ''), irec.get('题型', ''), str(irec.get('源题号', '')))
            impd[k3] = irec
            ck = (irec.get('章节', ''), irec.get('题型', ''), cell_key(irec.get('题干', '')))
            imp_by_content.setdefault(ck, []).append(irec)
    elif not args.quiet:
        print('警告：缺少 import 修复版 %s，规则 D（补壳）将不生效' % IMPORTED)

    diffs = []          # (章节, 源题号, 题型, 列, 原值, 新值, 规则, 备注)
    rule_count = {}
    manual_rows = []     # (章节, 源题号, 题型, 列, 原值, 说明)

    for r in range(2, ws.max_row + 1):
        chapter = ws.cell(r, idx['章节'] + 1).value
        srcno = ws.cell(r, idx['源题号'] + 1).value
        qtype = ws.cell(r, idx['题型'] + 1).value
        rowkey = (str(chapter), qtype, str(srcno))
        mrec = {col: ws.cell(r, idx[col] + 1).value for col in cols}
        imp_rec = resolve_imp(impd, imp_by_content, rowkey, mrec, cols) or {}

        for col in cols:
            ci = idx[col] + 1
            val = mrec[col]
            imp_val = imp_rec.get(col)
            new, changes, manual = normalize_cell(col, val, rowkey, qtype, imp_val)
            for mcol, mnote in manual:
                manual_rows.append((chapter, srcno, qtype, mcol, val, mnote))
            if changes:
                for rule, note in changes:
                    rule_count[rule] = rule_count.get(rule, 0) + 1
                    diffs.append((chapter, srcno, qtype, col, val, new, rule, note))
                    ws.cell(r, ci).value = new  # 改在副本上，不动 master

    # 写副本 / 回写母题库
    out_path.parent.mkdir(parents=True, exist_ok=True)
    wb.save(out_path)

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
        print('母题库规范完成（%s）'
              % ('已回写母题库' if args.apply else '未改动 master，仅产出副本 + 差异报告'))
        print('=' * 60)
        for rule, cnt in rule_count.items():
            print('  %-22s %d 处' % (rule, cnt))
        print('  需人工（未自动改）      %d 处' % len(manual_rows))
        print('  合计真实改动 %d 处' % len(diffs))
        checked, lack, extra = shell_gap_report(out_path)
        print('  ——（）壳收敛核对（%s vs import）——' % ('母题库' if args.apply else '副本'))
        print('  已核对行数 %d / 缺壳(应=0) %d / 多壳(import误删,安全) %d'
              % (checked, lack, extra))
        print('  输出 -> %s' % out_path)
        print('  差异 -> %s' % OUT_DIFF)
        if not diffs:
            print('  （无改动，母题库已符合规范）')
    return OUT_COPY, OUT_DIFF


if __name__ == '__main__':
    main()

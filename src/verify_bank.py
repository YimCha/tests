# -*- coding: utf-8 -*-
"""题库一致性校验：母题库（Excel）↔ 原始题库（Word）双向核对。

用途
    题库更新后跑一次，确认没有「导入脚本静默改错」的问题流入。
    历史事故：旧导入脚本的兜底正则 `([A-H])\\s*[。．]?\\s*$` 只捕获行尾 1 个字母，
    原题答案写在空括号之后时（如「…特点的是（）。ABD」）只取到 D、其余字母残留进题干，
    且不触发任何既有校验 —— 静默错误，只有跟原文逐条比对才能发现。

用法
    python src/verify_bank.py                # 复用 data/tmp/raw_dump.json 缓存
    python src/verify_bank.py --refresh      # 重新从 data/raw_bank 抽取原文（需本机 Word）
    python src/verify_bank.py --excel 报告.xlsx   # 同时输出更正清单
    python src/verify_bank.py --ge 0.70      # 调整题干匹配阈值（默认 0.70）

退出码
    0 = 未发现答案/选项不一致；1 = 发现不一致（可用于流水线卡口）；2 = 前置条件缺失

依赖
    openpyxl；交叉校验另需 Windows + Word + pywin32（缺失时仅做母题库自检）
"""
import argparse
import json
import os
import re
import sys
from collections import Counter, defaultdict
from difflib import SequenceMatcher
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
DATA = BASE / 'data'
MASTER = DATA / 'master_bank.xlsx'
RAW_DIR = DATA / 'raw_bank'
CACHE = DATA / 'tmp' / 'raw_dump.json'

T2ID = {'单选题': 0, '多选题': 1, '判断题': 2}
T2NAME = {0: '单选题', 1: '多选题', 2: '判断题'}
LETTERS = 'ABCDEFGH'

# ---------- 文本规则 ----------
NUM_RE = re.compile(r'^\s*(\d+)\s*[.、．]')
ANY_OPT = re.compile(r'(?<![A-Za-z0-9])([A-H])\s*[.、．:：)）]\s*')
ANY_OPT_SP = re.compile(r'(?<![A-Za-z0-9])([A-H])\s+(?=[^\s，。、；;])')
OPT_START = re.compile(r'^\s*([A-H])\s*[.、．:：)）]')
OPT_PREFIX = re.compile(r'^\s*[A-H]\s*[.、．:：)）]\s*')
BRACKET = re.compile(r'[（(\[【]\s*([A-H][A-H\s、，,]{0,8}?)\s*[）)\]】]')
TAIL_ANS = re.compile(r'([A-H]{1,8})\s*[。．]?\s*$')
ANS_LINE = re.compile(r'^\s*答\s*案\s*[:：]?\s*(.*)$')
NOTE_LINE = re.compile(r'^\s*[（(]?\s*(解析|【解析】|正确答案|答案)\s*[:：为]?\s*(.*?)\s*[）)]?\s*$')
EMPTY_PAREN = re.compile(r'[（(\[【]\s*[）)\]】]')
BLANK_PAREN = re.compile(r'[（(]\s*[）)]')   # 题干空括号统一写作全角（）
JW = r'(正确|错误|对|错|√|×|✓|是|否|T|F)'
BRACKET_JUDGE = re.compile(r'[（(\[【]\s*(' + JW + r')\s*[）)\]】]')
TAIL_JUDGE = re.compile(r'(?<![A-Za-z0-9\u4e00-\u9fff])(' + JW + r')\s*$')
TAIL_JUDGE2 = re.compile(r'(?<![A-Za-z0-9\u4e00-\u9fff])(' + JW + r')\s*[（(\[【][^）)\]】]{0,12}[）)\]】]\s*[。．]?\s*$')
JUDGE_MAP = {'正确': '对', '对': '对', '是': '对', '√': '对', '✓': '对', 'T': '对',
             '错误': '错', '错': '错', '否': '错', '×': '错', 'F': '错'}
KW = r'(单项选择题|多项选择题|不定项选择题|判断题|填空题|简答题|问答题|论述题|计算题|单选题|多选题|选择题|单项选择|多项选择|不定项|单选|多选|判断)'
SEC_HEAD = re.compile(r'^\s*[一二三四五六七八九十]?\s*[、.．:：]?\s*[（(]?\s*' + KW + r'\s*[）)]?\s*[:：。．]?\s*$')
FW = str.maketrans('ＡＢＣＤＥＦＧＨａｂｃｄｅｆｇｈ', 'ABCDEFGHabcdefgh')


def sec_type(s):
    if '判断' in s:
        return 2
    if '多选' in s or '多项' in s or '不定项' in s:
        return 1
    if '单选' in s or '单项' in s or '选择' in s:
        return 0
    return None


def norm_stem(s):
    s = s.translate(FW)
    s = re.sub(r'^\s*\d+\s*[.、．]\s*', '', s)
    s = re.sub(r'[^\w\u4e00-\u9fff]', '', s)
    return s.lower()


def norm_opt(s):
    """选项文本归一化：去掉字母前缀、标点、空白后比较。
    前缀形式多样（`A.` / `B、` / `A ` 空格分隔），统一剥掉；两侧同样处理，不会掩盖真实差异。"""
    s = s.translate(FW)
    s = re.sub(r'^\s*[A-H]\s*[.、．:：)）]?\s*', '', s)
    s = re.sub(r'[^\w\u4e00-\u9fff]', '', s)
    return s.lower()


# ---------- 母题库 ----------
def load_master():
    import openpyxl
    wb = openpyxl.load_workbook(MASTER, read_only=True)
    rows = list(wb[wb.sheetnames[0]].iter_rows(values_only=True))
    head = {n: i for i, n in enumerate(rows[0])}
    opt_cols = [head['选项' + c] for c in LETTERS]
    out = []
    for i, r in enumerate(rows[1:], start=2):
        if not (r[0] and r[2] and r[3]):
            continue
        t = T2ID.get(str(r[2]).strip())
        if t is None:
            continue
        out.append({'row': i, 'chapter': str(r[0]).strip(), 'num': r[head['源题号']], 'type': t,
                    'stem': str(r[head['题干']]).strip(),
                    'opts': [str(r[c] or '').strip() for c in opt_cols],
                    'ans': str(r[head['正确答案']] or '').strip(),
                    'note': str(r[head['解析']] or '').strip()})
    return out


def self_check(master):
    """不依赖原文的母题库自检（导入脚本的典型残留）。"""
    bad = {'题干残留数字序号': [], '选项残留字母前缀': [], '题干含答案字样': [],
           '多选题答案不足2个字符': [], '题干尾部残留答案字母': [], '缺少正确答案': [],
           '题干空括号写法不统一': []}
    for m in master:
        s = m['stem']
        if NUM_RE.match(s):
            bad['题干残留数字序号'].append(m)
        for i, o in enumerate(m['opts']):
            if o and (OPT_PREFIX.match(o) or re.match(r'^\s*[A-H]\s+\S', o)):
                bad['选项残留字母前缀'].append(m)
                break
        if '答案' in s:
            bad['题干含答案字样'].append(m)
        if any(BLANK_PAREN.finditer(s)) and any(x.group(0) != '（）' for x in BLANK_PAREN.finditer(s)):
            bad['题干空括号写法不统一'].append(m)
        if m['type'] == 1 and m['ans'] and len(m['ans']) < 2:
            bad['多选题答案不足2个字符'].append(m)
        if m['type'] in (0, 1):
            if not m['ans']:
                bad['缺少正确答案'].append(m)
            elif re.search(r'[A-H]{2,8}\s*[。．]?\s*$', s):
                bad['题干尾部残留答案字母'].append(m)
    return bad


# ---------- 原文抽取 ----------
def extract_raw(refresh):
    """把 data/raw_bank 下全部 Word 正文抽成 {相对路径: [行]}，并缓存到 data/tmp/。"""
    if CACHE.exists() and not refresh:
        return json.loads(CACHE.read_text(encoding='utf-8')), 'cache'
    try:
        import win32com.client as win32
    except ImportError:
        raise RuntimeError('未安装 pywin32，无法抽取 Word 原文（可加 --refresh 前先 pip install pywin32）')
    files = sorted([p for p in RAW_DIR.glob('*/*.doc')] + [p for p in RAW_DIR.glob('*/*.docx')])
    app = win32.gencache.EnsureDispatch('Word.Application')
    app.Visible = False
    app.DisplayAlerts = 0
    dump = {}
    try:
        for f in files:
            rel = f.relative_to(RAW_DIR).as_posix()
            doc = app.Documents.Open(str(f), ReadOnly=True, AddToRecentFiles=False)
            text = doc.Content.Text
            doc.Close(False)
            # Word 用 \x07 分隔单元格、\x0b 软换行，都必须还原成换行
            lines = [l.strip() for l in text.replace('\x07', '\n').replace('\x0b', '\n')
                     .replace('\x0c', '\n').split('\r')]
            dump[rel] = [l for l in lines if l]
    finally:
        app.Quit()
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(json.dumps(dump, ensure_ascii=False), encoding='utf-8')
    return dump, '%d 个文件' % len(dump)


# ---------- 原文解析 ----------
def parse_options(line):
    line = line.translate(FW)
    ms = [m for m in ANY_OPT.finditer(line) if not (m.start() > 0 and line[m.start() - 1] in '（(【[')]
    if len(ms) < 2:
        sp = [m for m in ANY_OPT_SP.finditer(line) if not (m.start() > 0 and line[m.start() - 1] in '（(【[')]
        if len(sp) >= 2:
            ms = sp
    if not ms:
        return None
    segs = []
    for i, m in enumerate(ms):
        end = ms[i + 1].start() if i + 1 < len(ms) else len(line)
        segs.append((m.group(1), line[m.end():end].strip().strip('。．、；;').strip()))
    return line[:ms[0].start()].strip(), segs


def collect_answer(s2, typ):
    """返回 (答案字母列表, 抽取方式, 剥离答案后的文本)"""
    if typ == 2:
        m = ANS_LINE.match(s2)
        if m:
            jm = re.search(JW, m.group(1))
            return ([JUDGE_MAP[jm.group(1)]] if jm else None), '答案行', ''
        for rx, tag in ((BRACKET_JUDGE, '括号内'), (TAIL_JUDGE, '行尾'), (TAIL_JUDGE2, '行尾+补充')):
            m = rx.search(s2)
            if m:
                return [JUDGE_MAP[m.group(1)]], tag, s2[:m.start()].rstrip()
        return None, '', s2
    m = ANS_LINE.match(s2)
    if m:
        lets = re.sub(r'[^A-H]', '', m.group(1).upper())
        return (list(lets) if lets else None), '答案行', ''
    groups = [(re.sub(r'[^A-H]', '', mm.group(1).upper()), mm) for mm in BRACKET.finditer(s2)]
    groups = [g for g in groups if g[0]]
    if groups:
        singles = [g for g, _ in groups if len(g) == 1]
        pick = singles if singles else [groups[-1][0]]
        rest = s2
        for _, mm in (groups if singles else [groups[-1]]):
            rest = rest.replace(mm.group(0), '')
        return list(''.join(pick)), '括号内', rest
    m = TAIL_ANS.search(s2)
    if m:
        return list(m.group(1)), '行尾裸字母', s2[:m.start()].rstrip()
    return None, '', s2


def has_ans_marker(s, typ):
    if typ is None:
        return False
    s2 = s.translate(FW)
    if typ == 2:
        return any(rx.search(s2) for rx in (BRACKET_JUDGE, TAIL_JUDGE, TAIL_JUDGE2))
    if ANS_LINE.match(s2):
        return True
    if any(re.sub(r'[^A-H]', '', mm.group(1).upper()) for mm in BRACKET.finditer(s2)):
        return True
    return bool(TAIL_ANS.search(s2))


def split_blocks(lines):
    """按区段标题 + 编号 + 「本行自带答案标记」切题。
    注意：不能用「已抽到答案就切」，否则无字母前缀的选项行会被当成新题。"""
    out, cur = [], None
    for ln in lines:
        if SEC_HEAD.match(ln):
            cur = sec_type(ln)
            continue
        m = NUM_RE.match(ln)
        if m:
            out.append([cur, int(m.group(1)), [ln]])
            continue
        if not out:
            if not parse_options(ln) and not ANS_LINE.match(ln.translate(FW)) and not NOTE_LINE.match(ln.translate(FW)):
                out.append([cur, None, [ln]])
            continue
        bt, _, bl = out[-1]
        if (any(has_ans_marker(x, bt) for x in bl) and has_ans_marker(ln, bt)
                and not parse_options(ln) and not NOTE_LINE.match(ln.translate(FW))):
            out.append([cur, None, [ln]])
            continue
        bl.append(ln)
    ctr = defaultdict(int)
    for b in out:
        if b[1] is None:
            ctr[b[0]] += 1
            b[1] = ctr[b[0]]
        else:
            ctr[b[0]] = b[1]
    return out


def parse_block(bt, lines):
    stem_parts, opts, note, answer, how = [], {}, '', None, ''
    filled, over_h = 0, False
    for i, ln in enumerate(lines):
        s = ln.strip()
        if not s:
            continue
        s2 = s.translate(FW)
        if re.search(r'(?<![A-Za-z])[I-Z]\s*[.、．:：)）]', s2):
            over_h = True          # 原文选项字母超出 A-H（本工具最多 8 个选项）
        if NOTE_LINE.match(s2) and not ANS_LINE.match(s2):
            note = note or NOTE_LINE.match(s2).group(2).strip()
            continue
        if ANS_LINE.match(s2):
            lets, h, rest = collect_answer(s2, bt)
            if lets and answer is None:
                answer, how = lets, h
                if rest.strip():
                    stem_parts.append(rest.strip())
            elif bt == 2:
                note = note or ANS_LINE.match(s2).group(1).strip()
            continue
        if answer is None and not OPT_START.match(s2):
            lets, h, rest = collect_answer(s2, bt)
            if lets:
                answer, how = lets, h
                s2 = rest
                po = parse_options(s2) if s2.strip() else None
                if po and len(po[1]) >= 2:
                    for lt, tx in po[1]:
                        opts.setdefault(lt, tx)
                    s2 = po[0]
                if s2.strip():
                    stem_parts.append(EMPTY_PAREN.sub('', s2).strip())
                continue
        if i > 0:
            po = parse_options(s2)
            if po:
                leading, segs = po
                if leading and len(leading) > 2 and not re.search(r'[（(]\s*[）)]\s*$', leading) \
                        and not NUM_RE.match(leading):
                    nxt = next((c for c in LETTERS if c not in opts), None)
                    if nxt:
                        opts[nxt] = leading.strip().strip('。．、；;')
                for lt, tx in segs:
                    opts.setdefault(lt, tx)
                continue
        if answer is not None and bt != 2 and len(opts) < 8 and len(s) <= 60:
            # 跨行续写识别：本行不是选项行，且下一行以「尚未占用的选项字母」开头
            # ⇒ 本行是上一个选项的续行（原文排版换行），应并入上一个选项而不是新开一个。
            nxt_line = lines[i + 1].strip().translate(FW) if i + 1 < len(lines) else ''
            nxt_opt = OPT_START.match(nxt_line)
            if (opts and len(s) <= 20 and not re.search(r'[。．；;）)]$', s)
                    and nxt_opt and nxt_opt.group(1) not in opts):
                last = next(reversed(opts))
                opts[last] = opts[last] + s
                continue
            nxt = next((c for c in LETTERS if c not in opts), None)
            if nxt:
                opts[nxt] = s.strip().strip('。．、；;')
                filled += 1        # 该选项由「无字母前缀的行」推断而来，切分可能不准
                continue
        stem_parts.append(s)
    stem = EMPTY_PAREN.sub('', ' '.join(p for p in stem_parts if p))
    stem = re.sub(r'\s{2,}', ' ', stem).strip(' 。．、')
    ans = None
    if answer:
        ans = answer[0] if bt == 2 else ''.join(sorted(set(answer)))
    return {'stem': stem, 'opts': opts, 'answer': ans, 'note': note, 'how': how,
            'guessed': filled > 0, 'over_h': over_h}


def chapter_of(rel, known):
    """由「文件夹名 + 文件名」推导章节名，再与母题库章节名核对（不硬编码任何部门名）。"""
    folder, fn = rel.split('/')[0], rel.split('/')[-1]
    cls = next((c for c in ('A类', 'B类', 'C类') if c in fn), None)
    if cls is None:
        return None
    dept = re.sub(r'^20\d{2}年?', '', re.sub(r'题库$', '', folder))
    if dept + cls in known:
        return dept + cls
    base = re.sub(r'^20\d{2}年?', '', os.path.splitext(fn)[0])
    base = re.sub(r'(题库|题目|题|（[^）]*）|\([^)]*\))$', '', base).strip('_- ')
    return base + cls if base + cls in known else None


def parse_raw(dump, known):
    qs, skipped = [], []
    for rel in sorted(dump):
        chap = chapter_of(rel, known)
        if not chap:
            skipped.append(rel)
            continue
        for bt, num, lines in split_blocks(dump[rel]):
            if bt is None:
                continue
            e = parse_block(bt, lines)
            if e['stem']:
                qs.append({'file': rel, 'chapter': chap, 'num': num, 'type': bt, **e})
    return qs, skipped


def align(raw_qs, master, ge):
    """按 章节 + 题干相似度 一对一配对。
    题型不同时要求原文相似度 ≥0.9，避免「判断题」被误配到同章节的多选题上（会伪造答案不一致）。"""
    pool = defaultdict(list)
    for m in master:
        pool[m['chapter']].append(m)
    used, pairs, unpaired = set(), [], []
    for q in sorted(raw_qs, key=lambda x: (-x['type'], x['chapter'], x['num'] or 0)):
        ns = norm_stem(q['stem'])
        best, bs, br = None, -1.0, 0.0
        for m in pool.get(q['chapter'], []):
            if id(m) in used:
                continue
            ms = norm_stem(m['stem'])
            if not ns or not ms:
                continue
            r = SequenceMatcher(None, ns[:60], ms[:60]).ratio()
            same_type = m['type'] == q['type']
            if not same_type and r < 0.9:
                continue
            try:
                same_num = int(m['num']) == int(q['num'])
            except (TypeError, ValueError):
                same_num = False
            score = r + (0.12 if same_type else 0) + (0.10 if same_num else 0)
            if score > bs:
                best, bs, br = m, score, r
        if best is not None and br >= ge:
            used.add(id(best))
            pairs.append((q, best))
        else:
            unpaired.append(q)
    return pairs, unpaired, [m for m in master if id(m) not in used]


def compare(pairs):
    """逐题比对答案 / 题干 / 选项。"""
    diffs = []
    for q, m in pairs:
        base = dict(row=m['row'], chapter=m['chapter'], num=m['num'], type=T2NAME[m['type']])
        if m['type'] == 2:
            if q['answer'] and m['ans'] and q['answer'] != m['ans']:
                diffs.append({**base, 'level': '严重', 'kind': '答案不一致',
                              'now': m['ans'], 'fix': q['answer'], 'src': q['stem'][:160]})
        else:
            if q['answer'] and not m['ans']:
                diffs.append({**base, 'level': '严重', 'kind': '答案缺失',
                              'now': '', 'fix': q['answer'], 'src': q['stem'][:160]})
            elif q['answer'] and m['ans'] and ''.join(sorted(set(q['answer']))) != ''.join(sorted(set(m['ans']))):
                diffs.append({**base, 'level': '严重', 'kind': '答案不一致',
                              'now': m['ans'], 'fix': q['answer'], 'src': q['stem'][:160]})
        if norm_stem(q['stem']) != norm_stem(m['stem']):
            diffs.append({**base, 'level': '轻微', 'kind': '题干不同',
                          'now': m['stem'][:160], 'fix': q['stem'][:160], 'src': q['stem'][:160]})
        # 选项比较：先逐项比，若只是「跨行选项被拆开」的切分差异（两册文本拼接后一致）则降级为提示
        raw_opts = list(q['opts'].values())
        mobj = [o for o in m['opts'] if o]
        per_opt_diff = []
        for lt, tx in q['opts'].items():
            idx = LETTERS.find(lt)
            if idx < 0:
                continue
            mtx = m['opts'][idx]
            if norm_opt(tx) and norm_opt(mtx) and norm_opt(tx) != norm_opt(mtx):
                per_opt_diff.append((lt, mtx, tx))
        if per_opt_diff:
            same_content = ''.join(norm_opt(o) for o in mobj) == ''.join(norm_opt(o) for o in raw_opts)
            for lt, mtx, tx in per_opt_diff:
                if same_content:
                    diffs.append({**base, 'level': '提示', 'kind': '选项切分差异（内容一致）',
                                  'field': '选项' + lt, 'now': mtx[:120], 'fix': tx[:120],
                                  'src': '原文该选项跨行，自动切分位置不同；文本拼接后一致'})
                else:
                    diffs.append({**base, 'level': '中等', 'kind': '选项内容不同',
                                  'field': '选项' + lt, 'now': mtx[:120], 'fix': tx[:120], 'src': tx[:120]})
        if q.get('over_h') and m['type'] != 2:
            diffs.append({**base, 'level': '中等', 'kind': '原文选项超过8个（本工具上限）',
                          'field': '选项', 'now': '%d 个选项' % len(mobj),
                          'fix': '原文含 I 及以后的选项', 'src': '工具每题最多 8 个选项，超出的会被截断'})
    return diffs


def write_excel(path, selfbad, diffs, unpaired, orphan, skipped):
    import openpyxl
    from openpyxl.styles import Font, PatternFill, Alignment
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = '更正清单'
    ws.append(['级别', '问题类型', '章节', '源题号', '题型', '母题库行', '字段', '当前值', '应为', '说明'])
    for m in selfbad['缺少正确答案']:
        ws.append(['严重', '缺少正确答案', m['chapter'], m['num'], T2NAME[m['type']], m['row'],
                   '正确答案', '', '', '母题库自检'])
    for m in selfbad['多选题答案不足2个字符']:
        ws.append(['严重', '多选题答案不足2个字符', m['chapter'], m['num'], T2NAME[m['type']], m['row'],
                   '正确答案', m['ans'], '', '母题库自检'])
    for m in selfbad['题干尾部残留答案字母']:
        ws.append(['严重', '题干尾部残留答案字母', m['chapter'], m['num'], T2NAME[m['type']], m['row'],
                   '题干', m['stem'][:120], '', '母题库自检'])
    for d in diffs:
        ws.append([d['level'], d['kind'], d['chapter'], d['num'], d['type'], d['row'],
                   d.get('field', '正确答案' if d['kind'].startswith('答案') else '题干'),
                   d['now'], d['fix'], d.get('src', '')])
    for m in selfbad['题干残留数字序号']:
        ws.append(['轻微', '题干残留数字序号', m['chapter'], m['num'], T2NAME[m['type']], m['row'],
                   '题干', m['stem'][:120], re.sub(r'^\s*\d+\s*[.、．]\s*', '', m['stem'])[:120], '母题库自检'])
    for m in selfbad['选项残留字母前缀']:
        bad = [o for o in m['opts'] if o and OPT_PREFIX.match(o)]
        ws.append(['轻微', '选项残留字母前缀', m['chapter'], m['num'], T2NAME[m['type']], m['row'],
                   '选项', ' / '.join(bad)[:160], '', '母题库自检'])
    for m in selfbad['题干含答案字样']:
        ws.append(['轻微', '题干含答案字样', m['chapter'], m['num'], T2NAME[m['type']], m['row'],
                   '题干', m['stem'][:160], '', '母题库自检'])
    for q in unpaired:
        ws.append(['待人工', '原文未对齐', q['chapter'], q['num'], T2NAME[q['type']], '', '-',
                   '', '', '原文：' + q['stem'][:120]])
    for m in orphan:
        ws.append(['待人工', '母题库未被匹配', m['chapter'], m['num'], T2NAME[m['type']], m['row'], '-',
                   m['stem'][:120], '', '需人工确认是否在原文中存在'])
    for r in skipped:
        ws.append(['提示', '原文文件未识别章节', '', '', '', '', '-', r, '', '']);
    for c in range(1, 11):
        cell = ws.cell(row=1, column=c)
        cell.font = Font(bold=True, color='FFFFFF')
        cell.fill = PatternFill('solid', fgColor='8C1D1D')
    for i in range(2, ws.max_row + 1):
        for c in range(1, 11):
            ws.cell(row=i, column=c).alignment = Alignment(vertical='top', wrap_text=True)
    ws.freeze_panes = 'A2'
    ws.auto_filter.ref = ws.dimensions
    wb.save(path)


def main():
    ap = argparse.ArgumentParser(description='母题库 ↔ 原始 Word 题库一致性校验')
    ap.add_argument('--refresh', action='store_true', help='重新从 data/raw_bank 抽取原文')
    ap.add_argument('--excel', metavar='PATH', help='把更正清单输出为 xlsx')
    ap.add_argument('--ge', type=float, default=0.70, help='题干匹配阈值，默认 0.70')
    args = ap.parse_args()

    if not MASTER.exists():
        print('缺少母题库：%s' % MASTER)
        return 2
    master = load_master()
    print('母题库：%d 题' % len(master))

    print('\n=== 母题库自检（不依赖原文）===')
    selfbad = self_check(master)
    for k, v in selfbad.items():
        print('  %-18s %d' % (k, len(v)))

    try:
        dump, src = extract_raw(args.refresh)
    except Exception as e:
        print('\n[跳过原文交叉校验] %s' % e)
        print('（母题库自检结论仍然有效）')
        return 2 if selfbad['缺少正确答案'] or selfbad['多选题答案不足2个字符'] else 0

    known = {m['chapter'] for m in master}
    raw_qs, skipped = parse_raw(dump, known)
    print('\n=== 原文交叉校验（原文来源：%s）===' % src)
    print('  原文解析出题目：%d 题' % len(raw_qs))
    print('  原文未识别章节的文件：%d 个' % len(skipped))
    for r in skipped:
        print('     %s' % r)
    print('  原文未解析出答案：%d 题' % sum(1 for q in raw_qs if not q['answer']))

    pairs, unpaired, orphan = align(raw_qs, master, args.ge)
    print('  对齐成功：%d 题（原文侧未对齐 %d / 母题库侧未被匹配 %d）'
          % (len(pairs), len(unpaired), len(orphan)))

    diffs = compare(pairs)
    cnt = Counter(d['kind'] for d in diffs)
    print('\n=== 差异明细 ===')
    for k in ('答案不一致', '答案缺失', '选项内容不同', '原文选项超过8个（本工具上限）',
              '题干不同', '选项切分差异（内容一致）'):
        if cnt.get(k):
            print('  %-28s %d' % (k, cnt[k]))
    for d in diffs:
        if d['kind'] in ('答案不一致', '答案缺失', '选项内容不同', '原文选项超过8个（本工具上限）'):
            print('    [%s] 行%s %s 源%s %s %s | 母题库=%r 原文=%r'
                  % (d['kind'], d['row'], d['chapter'], d['num'], d['type'],
                     d.get('field', ''), d['now'], d['fix']))
    stem_diffs = [d for d in diffs if d['kind'] == '题干不同']
    if stem_diffs:
        print('\n  --- 题干文字差异（%d 处，逐条列出供人工抽查）---' % len(stem_diffs))
        for d in stem_diffs:
            print('    行%s %s 源%s %s' % (d['row'], d['chapter'], d['num'], d['type']))
            print('        母题库: %s' % d['now'][:100])
            print('        原文  : %s' % d['fix'][:100])
    if unpaired:
        print('\n  原文侧未对齐 %d 题（需人工确认识别逻辑）：' % len(unpaired))
        for q in unpaired[:10]:
            print('     %s 源%s %s | %s' % (q['chapter'], q['num'], T2NAME[q['type']], q['stem'][:60]))
    if orphan:
        print('  母题库侧未被匹配 %d 题（需人工确认是否存在于原文）：' % len(orphan))
        for m in orphan[:10]:
            print('     行%s %s 源%s %s | %s' % (m['row'], m['chapter'], m['num'], T2NAME[m['type']], m['stem'][:60]))

    if args.excel:
        write_excel(args.excel, selfbad, diffs, unpaired, orphan, skipped)
        print('\n更正清单 -> %s' % args.excel)

    fatal = cnt.get('答案不一致', 0) + cnt.get('答案缺失', 0) \
        + len(selfbad['缺少正确答案']) + len(selfbad['多选题答案不足2个字符']) \
        + len(selfbad['题干尾部残留答案字母'])
    if fatal:
        print('\n结论：发现 %d 处答案级问题，需人工确认后再构建。' % fatal)
        return 1
    print('\n结论：未发现答案级问题。其余为题干/选项的文字与切分差异，多数属格式差异，可人工抽查。')
    return 0


if __name__ == '__main__':
    sys.exit(main())

# -*- coding: utf-8 -*-
"""银行上岗考试题库统一管线：从原始 Word 题库生成《母题库》初版，并与现有母题库交叉校验。

合并了原 import_bank.py（生成）与 verify_bank.py（校验）为一个文件，共用同一套解析内核，
避免「两个解析器漂移」导致静默错误漏检。

子命令
    python src/bank_pipeline.py import                 # 生成 data/master_bank.imported.xlsx（不覆盖母题库）
    python src/bank_pipeline.py import --out 别的.xlsx  # 指定输出
    python src/bank_pipeline.py import --refresh        # 强制重抽 Word 正文（默认用缓存）
    python src/bank_pipeline.py import --text-only DIR  # 只把 Word 正文导出为 txt（不解析）
    python src/bank_pipeline.py verify                 # 复用缓存，与 data/master_bank.xlsx 交叉校验
    python src/bank_pipeline.py verify --refresh       # 重新从 data/raw_bank 抽取原文
    python src/bank_pipeline.py verify --excel 报告.xlsx
    python src/bank_pipeline.py verify --ge 0.70       # 题干匹配阈值（默认 0.70）

约定
  - 章节归属：部门 = raw_bank 子文件夹名（去掉 4 位年份与「题库」后缀），
    类别 = 文件名里的 A类/B类/C类，章节名 = 部门 + 类别 + '类'。
  - 输出列与母题库一致：章节 / 源题号 / 题型 / 题干 / 选项A-H / 正确答案 / 解析 / 需复核。
  - 判断题的选项列固定写 对 / 错，正确答案写 对 / 错。
  - import 只生成「初版」，**不覆盖** data/master_bank.xlsx（Word 原文是终极真值）；
    verify 把初版（= 现代码解析结果）与母题库逐题比对，找出母题库确定性去标注/重述与残留异常。
  - 路径与部门名全部从数据推导，代码不含任何业务信息。

退出码（仅 verify）
    0 = 未发现答案/选项内容级不一致；1 = 发现不一致；2 = 前置条件缺失
"""
import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from difflib import SequenceMatcher
from pathlib import Path

import openpyxl
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

BASE = Path(__file__).resolve().parent.parent
DATA = BASE / 'data'
RAW_DIR = DATA / 'raw_bank'
MASTER = DATA / 'master_bank.xlsx'
TEXT_CACHE = DATA / 'tmp' / 'import_text.json'
DEFAULT_OUT = DATA / 'master_bank.imported.xlsx'

HEADERS = ['章节', '源题号', '题型', '题干',
           '选项A', '选项B', '选项C', '选项D', '选项E', '选项F', '选项G', '选项H',
           '正确答案', '解析', '需复核']

LETTERS = 'ABCDEFGH'
T2ID = {'单选题': 0, '多选题': 1, '判断题': 2}
T2NAME = {0: '单选题', 1: '多选题', 2: '判断题'}

# ===================== 文本规则（import / verify 共用） =====================
_KB = (r'(单选题|单项选择题|单项选择|多选题|多项选择题|多项选择|不定项选择题|不定项|'
       r'判断题|填空题|问答题|简答题|论述题|计算题|选择题)')
SECTION_RE = re.compile(r'^\s*[一二三四五六七八九十]+\s*[.、．:：]?\s*[（(]?\s*' + _KB + r'[）)]?\s*[.、．:：。]?\s*$')
BARE_SECTION_RE = re.compile(r'^\s*' + _KB + r'\s*[.、．:：。]?\s*$')

SECTION_TYPE_MAP = {
    '单选题': '单选题', '单项选择题': '单选题', '单项选择': '单选题', '选择题': '单选题',
    '多选题': '多选题', '多项选择题': '多选题', '多项选择': '多选题',
    '判断题': '判断题', '填空题': '填空题',
    '问答题': '问答题', '简答题': '问答题', '论述题': '问答题', '计算题': '问答题',
    '不定项': '不定项选择题', '不定项选择题': '不定项选择题',
}

NUM_RE = re.compile(r'^(\d+)\s*[.、．]')
NUM_LEAD_RE = re.compile(r'^\d{1,3}\s*[.、．]\s*')   # 题干行首题号，输出前去掉
# 选项字母标记：① 字母 + 可选空白 + 显式分隔符(. 、 ： ) ）)；② 字母 + 空白 + 中文/数字（如 "A 发放对象"）。
# 字母类用 [A-Z]（含 A–H 之外，如 "J、防计算机犯罪"），超 H 的选项在 refine 中按出现顺序重标为 A–H。
OPT_RE = re.compile(r'(?<![A-Za-z])([A-Z])(?:\s*[.、．:：)）]|\s+(?=[\u4e00-\u9fff0-9]))')
OPT_LINE_RE = re.compile(r'^\s*([A-ZＡ-Ｚ])\s*[.、．:：)）]')
ANS_PICK_RE = re.compile(r'[（\[【(]\s*([A-ZＡ-Ｚ][A-ZＡ-Ｚ、，,\s]*?)\s*[）\]】)]')
ANS_TAIL_RE = re.compile(r'([A-Z])\s*[。．]?\s*$')
EMPTY_ANS_TAIL_RE = re.compile(r'[（\[【(]\s*[）\]】)]\s*[。．.]?\s*([A-Z]{1,8})\s*[。．]?\s*$')
BARE_MULTI_ANS_RE = re.compile(r'\s([A-Z]{2,8})\s*[。．.]?\s*$')
INLINE_OPT_RE = re.compile(r'[。．.，,]?\s*([A-Z])\s*[.、．:：)）]\s*([^，。]{1,80})$')
JUDGE_WORD = r'(正确|错误|对|错|√|×|✓|T|F|是|否)'
ANS_JUDGE_RE = re.compile(r'[（\[【(]\s*(' + JUDGE_WORD + r')\s*[）\]】)]')
ANS_JUDGE_PLAIN_RE = re.compile(r'(?<![A-Za-z0-9\u4e00-\u9fff])(' + JUDGE_WORD + r')\s*$')
ANS_JUDGE_NOTE_RE = re.compile(r'(?<![A-Za-z0-9\u4e00-\u9fff])(' + JUDGE_WORD + r')\s*[（\[【(][^）\]】)]*[）\]】)]\s*$')

FW = str.maketrans('ＡＢＣＤＥＦＧＨＴＦ', 'ABCDEFGHTF')
JUDGE_CANON = {'对': '对', '是': '对', '正确': '对', '√': '对', '✓': '对', 'T': '对',
               '错': '错', '否': '错', '错误': '错', '×': '错', 'F': '错'}

NOTE_PREFIX_RE = re.compile(r'^(解析|（?正确答案）?|答案)\s*[:：]?\s*[为是]?\s*')
TRAIL_EMPTY_PAREN_RE = re.compile(r'\s*[（\[【(]\s*[）\]】)]\s*$')

# verify 专用：母题库自检 / 比对归一化
BRACKET = re.compile(r'[（(\[【]\s*([A-Z][A-Z\s、，,]{0,8}?)\s*[）)\]】]')
TAIL_ANS = re.compile(r'([A-Z]{1,8})\s*[。．]?\s*$')
NOTE_LINE = re.compile(r'^\s*[（(]?\s*(解析|【解析】|正确答案|答案)\s*[:：为]?\s*(.*?)\s*[）)]?\s*$')
EMPTY_PAREN = re.compile(r'[（(\[【]\s*[）)\]】]')
BLANK_PAREN = re.compile(r'[（(]\s*[）)]')
OPT_PREFIX = re.compile(r'^\s*[A-Z]\s*[.、．:：)）]?\s*')
KW = r'(单项选择题|多项选择题|不定项选择题|判断题|填空题|简答题|问答题|论述题|计算题|单选题|多选题|选择题|单项选择|多项选择|不定项|单选|多选|判断)'


def norm_fw(s):
    return s.translate(FW)


def opt_like(txt):
    """判断一段文本是否为真实选项内容（去标点后 >=2 字符、含汉字、或纯数字如年份/百分比）。"""
    clean = re.sub(r'[\s、，,。．:：()（）【】\[\]"“”\u3000\xa0]+', '', txt)
    if not clean:
        return False
    if len(clean) >= 2:
        return True
    if clean.isdigit():          # 单数字/数值选项（如 "2"、"65%" 去符号后）
        return True
    return any('\u4e00' <= c <= '\u9fff' for c in clean)


def has_answer_marker(s):
    s = norm_fw(s)
    return bool(ANS_PICK_RE.search(s) or ANS_JUDGE_RE.search(s))


def has_judge_marker(s):
    s = norm_fw(s)
    return bool(ANS_JUDGE_RE.search(s) or ANS_JUDGE_PLAIN_RE.search(s) or ANS_JUDGE_NOTE_RE.search(s))


def classify_section(title):
    for k in ('单项选择题', '多项选择题', '单选题', '多选题', '不定项选择题', '判断题',
              '填空题', '问答题', '简答题', '论述题', '计算题', '单项选择', '多项选择', '不定项', '选择题'):
        if k in title:
            return SECTION_TYPE_MAP[k]
    return None


def strip_option_noise(txt):
    # 去掉行尾冗余标点与首尾引号（母题库对引号做了人工规范化，去掉可消除绝大部分引号风格差异）。
    txt = re.sub(r'[。．、]+$', '', txt.strip()).rstrip()
    return txt.strip('"“”')


def clean_stem(s):
    return re.sub(r'\s{2,}', ' ', s).strip().strip('"“”\u3000 ')


# 母题库统一规则：把题干里内嵌的正确答案标注剥掉。
# 原始 Word 把答案字母/答案说明写在题干里（泄题），考试版（母题库）需去标注。
# 这与项目约定"题干用（）占位、不写答案"一致。
ANS_NOTE_TAIL_RE = re.compile(r'\s*答案\s*[:：].*$')                       # 尾部"答案：…"说明
TAIL_ANS_BR_RE = re.compile(r'[【\[（(]\s*[A-Za-z]\s*[】\]）)]\s*[。．、]?\s*$')  # 尾部单字母标注（含尾标点）
INLINE_ANS_BR_RE = re.compile(r'[【\[（(]\s*([A-Za-z])\s*[】\]）)]\s*')        # 内嵌单字母标注


def clean_stem_annotations(stem, options):
    """题干去答案标注：返回 (清洗后题干, 是否发生过清洗)。

    ① 尾部"答案：…"说明 → 整段删除；
    ② 尾部单字母标注（【X】/（X）/(X)，含其后的尾标点）→ 删除（句尾不占位）；
    ③ 内嵌单字母标注 → 转占位空白（），符合项目"题干用（）占位"约定。
    只动单拉丁字母括号，不碰中文括号注（如（含）/（不得轮岗）），后者交由 verify 报残差。
    """
    s = stem
    changed = False
    new = ANS_NOTE_TAIL_RE.sub('', s)
    if new != s:
        changed = True
        s = new
    new = TAIL_ANS_BR_RE.sub('', s)
    if new != s:
        changed = True
        s = new
    new = INLINE_ANS_BR_RE.sub('（）', s)
    if new != s:
        changed = True
        s = new
    return clean_stem(s), changed



def extract_judge_answer(line):
    """抽取判断题答案，返回 (答案'对'/'错' 或 None, 去掉答案的题干, 解析说明)。

    注意：判断题答案标记（如（错误））是题干的终结符，其【之后】的文字是解析说明，
    绝不可并入题干。早期实现把标记前后文本拼回题干，导致解析被误并进题干（重复计入解析列），
    与母题库「题干干净、解析单列」不一致。这里只取标记之前的文本作题干，之后的作解析。
    """
    m = ANS_JUDGE_RE.search(line)
    if m:
        ans = JUDGE_CANON[norm_fw(m.group(1))]
        stem = TRAIL_EMPTY_PAREN_RE.sub('', line[:m.start()]).rstrip()
        note = line[m.end():].strip()
        # 答案标记之后若整段被括号包住（如（不得轮岗）），取括号内文本作为解析，与母题库一致
        nm = re.match(r'^[（(]([^（）()]*)[）)]\s*$', note)
        if nm:
            note = nm.group(1).strip()
        return ans, stem, note
    m2 = ANS_JUDGE_PLAIN_RE.search(line)
    if m2:
        ans = JUDGE_CANON[norm_fw(m2.group(1))]
        return ans, TRAIL_EMPTY_PAREN_RE.sub('', line[:m2.start()]).rstrip(), ''
    m3 = ANS_JUDGE_NOTE_RE.search(line)
    if m3:
        ans = JUDGE_CANON[norm_fw(m3.group(1))]
        stem = TRAIL_EMPTY_PAREN_RE.sub('', line[:m3.start()]).rstrip()
        nm = re.search(r'[（\[【(]([^）\]】)]*)[）\]】)]\s*$', line[m3.start():])
        return ans, stem, (nm.group(1).strip() if nm else '')
    return None, line, ''


def parse_option_line(line):
    """按字母标记切分一行中的选项，返回 (leading, [(letter, text), ...])；不是选项行返回 None。
    支持：① 字母 + 显式分隔符(. 、 ： ) ）)（分隔符前可含空白）；② 字母 + 空白 + 中文/数字；
    ③ 字母直接跟内容(无分隔，如 "A发放对象"/"A印控仪")；④ 一行多选项；⑤ 行首单选项；
    ⑥ 前导裸段 + 后续字母选项(如 "行政事业单位   B.非法人企业")。"""
    line = norm_fw(line)
    ms = [m for m in OPT_RE.finditer(line)
          if not (m.start() > 0 and line[m.start() - 1] in '（(【[')]
    if not ms:
        # 字母直接跟内容、无分隔符（如 "A发放对象" / "A印控仪"）视为单个选项
        m0 = re.match(r'\s*([A-Z])(?=[\u4e00-\u9fff0-9])', line)
        if m0:
            return line[:m0.start()].strip(), [(m0.group(1), line[m0.end():].strip())]
        return None
    leading = line[:ms[0].start()].strip()
    segs = []
    for i, m in enumerate(ms):
        end = ms[i + 1].start() if i + 1 < len(ms) else len(line)
        segs.append((m.group(1), line[m.end():end]))
    return leading, segs


def extract_pick_answer(line):
    """抽取选择题答案，返回 (字母列表 或 None, 去掉答案的题干, 内联选项列表)"""
    line = norm_fw(line)
    ms = list(ANS_PICK_RE.finditer(line))
    if ms:
        groups, ok = [], True
        for m in ms:
            l = re.sub(r'[\s、，,．.]+', '', m.group(1)).upper()
            if not l:
                ok = False
                break
            groups.append((l, m))
        if ok and groups:
            singles = [g for g in groups if len(g[0]) == 1]
            pick = singles if singles else [groups[-1]]
            letters = [g[0] for g in pick]
            stem = line
            for g in pick:
                stem = stem[:g[1].start()] + stem[g[1].end():]
            r = parse_option_line(stem)
            if r is not None:
                leading, segs = r
                if (len(segs) >= 2 and opt_like(segs[0][1]) and segs[0][0] == 'A' and leading.strip()):
                    return letters, leading.strip('。．、　 ').rstrip('。．、'), segs
            tail = INLINE_OPT_RE.search(stem)
            if tail:
                return letters, stem[:tail.start()].rstrip('。．'), [(tail.group(1), tail.group(2).strip())]
            return letters, stem, []
    m0 = EMPTY_ANS_TAIL_RE.search(line)          # 先处理「（）ABD」式裸答案
    if m0:
        return list(m0.group(1)), line[:m0.start()].rstrip(), []
    m1 = BARE_MULTI_ANS_RE.search(line)          # 句中裸多字母答案（≥2 个字母，避免误伤单个字母结尾）
    if m1:
        return list(m1.group(1)), line[:m1.start()].rstrip(), []
    m2 = ANS_TAIL_RE.search(line)
    if m2:
        return [m2.group(1)], line[:m2.start()].rstrip(), []
    return None, line, []


# ===================== 切块 + 结构化（import / verify 共用） =====================
def parse_file(raw):
    """把整篇文本切成 (区段题型, [题目块])；题目块保留原始行，稍后 refine。"""
    raw = raw.replace('\u000b', '\n').replace('\r\n', '\n').replace('\r', '\n')
    lines = raw.split('\n')

    sections, cur_type, cur_questions, cur_q, cur_has_ans = [], None, [], None, False

    def marker(s, t):
        return has_judge_marker(s) if t == '判断题' else has_answer_marker(s)

    def flush_q():
        nonlocal cur_q, cur_has_ans
        if cur_q is not None:
            cur_questions.append(cur_q)
            cur_q, cur_has_ans = None, False

    def start_q(src_no, line):
        nonlocal cur_q, cur_has_ans
        flush_q()
        cur_q = {'src_no': src_no, 'raw_lines': [line]}
        cur_has_ans = marker(line, cur_type)

    for ln in lines:
        s = ln.strip()
        if not s:
            continue
        if SECTION_RE.match(s) or BARE_SECTION_RE.match(s):
            t = classify_section(s)
            if t is not None:
                flush_q()
                if cur_questions:
                    sections.append((cur_type, cur_questions))
                cur_type, cur_questions = t, []
                continue
        mn = NUM_RE.match(s)
        if mn:
            start_q(int(mn.group(1)), s)
            continue
        if cur_q is None:
            if marker(s, cur_type):
                start_q(None, s)
            continue
        if cur_has_ans and marker(s, cur_type) and not OPT_LINE_RE.match(s):
            start_q(None, s)
            continue
        cur_q['raw_lines'].append(s)
        if marker(s, cur_type):
            cur_has_ans = True
    flush_q()
    if cur_questions:
        sections.append((cur_type, cur_questions))
    return sections


def refine_question(q, sec_type):
    """把原始行解析成 题干/选项/答案/解析/flags。"""
    lines = q['raw_lines']
    stem_parts, options, answer, answer_src, note, flags = [], [], None, '', '', []

    def next_letter():
        return chr(ord('A') + len(options)) if len(options) < 8 else None

    if sec_type == '判断题':
        for i, ln in enumerate(lines):
            s = ln.strip()
            if not s:
                continue
            if answer is None:
                ans, stem, n = extract_judge_answer(s)
                if ans is not None:
                    answer = ans
                    answer_src = '题干' if i == 0 else '独立行'
                    if stem.strip():
                        stem_parts.append(stem.strip())
                    if n:
                        note = n
                    continue
            if s.startswith(('解析', '（正确答案', '正确答案')):
                note = note or NOTE_PREFIX_RE.sub('', s).strip('（）')
                continue
            stem_parts.append(s)
        if answer is None:
            flags.append('未提取到判断题答案')
    else:
        first = lines[0].strip() if lines else ''
        ans_groups, stem0, tail_opts = extract_pick_answer(first)
        if ans_groups:
            answer = ''.join(dict.fromkeys(''.join(ans_groups)))
            answer_src = '题干'
            if stem0.strip():
                stem_parts.append(stem0.strip())
            for letter, txt in tail_opts:
                options.append((letter, strip_option_noise(txt)))
        else:
            stem_parts.append(first)

        for idx in range(1, len(lines)):
            s = lines[idx].strip()
            if not s:
                continue
            if s.startswith(('解析', '（正确答案', '正确答案', '答案')):
                note = note or NOTE_PREFIX_RE.sub('', s).strip('（）')
                continue
            # 续行若带答案标记（如题干被软回车切成两行、答案落在续行 "的是（ A ）。"），
            # 必须先抽答案再判选项——否则括号里的字母 A 会被误当成选项起点，
            # 把 "的是（" 变成伪选项 A、后续选项整体错位。
            if answer is None and has_answer_marker(s):
                ans_groups, stem2, tail_opts = extract_pick_answer(s)
                if ans_groups:
                    answer = ''.join(dict.fromkeys(''.join(ans_groups)))
                    answer_src = '题干(后续行)'
                    if stem2.strip():
                        stem_parts.append(stem2.strip())
                    for letter, txt in tail_opts:
                        options.append((letter, strip_option_noise(txt)))
                    continue
            r = parse_option_line(s)
            if r is not None:
                leading, segs = r
                segs = [(l, strip_option_noise(t)) for l, t in segs if t.strip()]
                if segs or leading.strip():
                    if leading.strip():
                        if options:               # 已有选项 ⇒ 前导段是上一选项的续行（如裸选项A后接" B.x"）
                            options[-1] = (options[-1][0], options[-1][1] + leading.strip())
                        else:                    # 首个选项无前缀（如"法定存款准备金  B、超额..."中的法定存款准备金）
                            letter = next_letter()
                            if letter:
                                options.append((letter, strip_option_noise(leading)))
                    for letter, txt in segs:
                        options.append((letter, txt))
                    continue
            if answer is None:
                ans_groups, stem2, tail_opts = extract_pick_answer(s)
                if ans_groups:
                    answer = ''.join(dict.fromkeys(''.join(ans_groups)))
                    answer_src = '题干(后续行)'
                    if stem2.strip():
                        stem_parts.append(stem2.strip())
                    for letter, txt in tail_opts:
                        options.append((letter, strip_option_noise(txt)))
                    continue
            # 跨行续写识别：本行不是选项行。两种情形并入上一选项：
            # ① 下一行是「尚未占用的新选项字母」（本行夹在两选项之间，必为上一选项的排版断行续写）；
            # ② 本行以续写符开头且下一行仍接上一选项（多行续写）。
            # 注意：若本行以汉字开头（像独立新选项，如 "担任…顾问"），即使无前缀也视为新选项，
            # 不可误并入上一选项（否则会把无前缀的选项 B 误并进 A）。
            used = {l for l, _ in options}
            nxt = norm_fw(lines[idx + 1].strip()) if idx + 1 < len(lines) else ''
            nxt_opt = OPT_LINE_RE.match(nxt)
            between = bool(nxt_opt) and norm_fw(nxt_opt.group(1)) not in used
            if options and between:
                options[-1] = (options[-1][0], options[-1][1] + s)
                continue
            CONT_PUNCT = '，。、；：’”；：（〔…—'
            cont_start = bool(s) and (s[0] in CONT_PUNCT or (s[0].isascii() and s[0].islower()))
            if (options and cont_start and len(s) <= 20
                    and not re.search(r'[。．；;）)]$', s)
                    and nxt_opt and norm_fw(nxt_opt.group(1)) not in used):
                options[-1] = (options[-1][0], options[-1][1] + s)
                continue
            letter = next_letter()
            if letter:
                options.append((letter, strip_option_noise(s)))
            else:
                flags.append('选项超过8个，无法续接')

    stem = NUM_LEAD_RE.sub('', clean_stem(' '.join(p for p in stem_parts if p)))

    # 题干去答案标注（母题库统一规则：剥掉题干内嵌的答案字母/说明，用（）占位）
    stem, ann_cleaned = clean_stem_annotations(stem, options)
    if ann_cleaned:
        flags.append('题干去答案标注')

    # 选项字母超 H（如 J）时按出现顺序重标为 A-H，并同步答案（考试宝仅支持 A-H）
    if options and any(l not in LETTERS for l, _ in options):
        mapping = {l: LETTERS[i] for i, (l, _) in enumerate(options)}
        options = [(mapping[l], t) for l, t in options]
        if answer and answer_src:
            answer = ''.join(mapping.get(ch, ch) for ch in answer)
        flags.append('选项字母超H，已按出现顺序重标为A-H并同步答案')

    q.update(stem=stem, answer=answer, answer_src=answer_src,
             options=options, note=note, flags=flags, sec_type=sec_type)

    if sec_type == '单选题' and answer and len(answer) > 1:
        q['sec_type'] = '多选题'
        flags.append('源文件标为单选题但答案多选，已按实际类型改为多选题')

    q['valid'] = answer is not None
    if answer is None:
        flags.append('未提取到答案')
    else:
        if q['sec_type'] == '单选题' and len(answer) != 1:
            flags.append(f'单选题答案非单字母: {answer}')
        if q['sec_type'] == '多选题' and len(answer) > len({l for l, _ in options}):
            flags.append(f'多选题答案数超过选项数: {answer}')
    if options and answer and q['sec_type'] in ('单选题', '多选题', '不定项选择题'):
        mg = {l for l, _ in options}
        for al in set(answer):
            if al not in mg:
                flags.append(f'答案字母{al}不在选项A-H中')
    if q['sec_type'] in ('单选题', '多选题', '不定项选择题') and len(options) < 2:
        flags.append('选项少于2个，疑似切题/切选项异常')
    if not stem:
        flags.append('题干为空')
    return q


def infer_type(q):
    """无区段标题时按答案特征推断题型。"""
    for ln in q['raw_lines']:
        if ANS_JUDGE_RE.search(ln) or ANS_JUDGE_PLAIN_RE.search(ln) or ANS_JUDGE_NOTE_RE.search(ln):
            return '判断题'
    for ln in q['raw_lines']:
        m = ANS_PICK_RE.search(ln)
        if m:
            letters = re.sub(r'[\s、，,．.]+', '', m.group(1)).upper()
            return '多选题' if len(letters) > 1 else '单选题'
    return '单选题'


# ===================== Word 抽取 =====================
def extract_docs(refresh):
    """把 data/raw_bank 下全部 Word（.doc/.docx）正文抽成 {相对路径: 文本}，带缓存。"""
    if TEXT_CACHE.exists() and not refresh:
        return json.loads(TEXT_CACHE.read_text(encoding='utf-8')), 'cache'
    try:
        import win32com.client as win32
    except ImportError:
        sys.exit('未安装 pywin32，无法抽取 Word 正文。请先 pip install pywin32，或用 --text-only 提供文本。')
    files = sorted(p for p in list(RAW_DIR.glob('*/*.doc')) + list(RAW_DIR.glob('*/*.docx'))
                   if not p.name.startswith('~$'))
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
            dump[rel] = text.replace('\x07', '\n').replace('\x0b', '\n').replace('\x0c', '\n')
    finally:
        app.Quit()
    TEXT_CACHE.parent.mkdir(parents=True, exist_ok=True)
    TEXT_CACHE.write_text(json.dumps(dump, ensure_ascii=False), encoding='utf-8')
    return dump, '%d 个文件' % len(dump)


def derive_chapter(rel_path, known=None):
    """由 raw_bank 相对路径推导章节名：部门=文件夹名，类别=文件名里的 A/B/C 类。"""
    p = Path(rel_path)
    dept = re.sub(r'^\d{4}年?', '', p.parent.name)
    dept = re.sub(r'题库$', '', dept).strip()
    m = re.search(r'([ABC])类', p.name)
    if not dept or not m:
        return None
    ch = f'{dept}{m.group(1)}类'
    if known is not None and ch not in known:
        return None
    return ch


# ===================== 解析全部（import / verify 共用） =====================
def parse_all(dump, known=None):
    """返回结构化题目列表（含 chapter/src_no/sec_type/stem/options/answer/note/flags）。"""
    qs, skipped = [], []
    for rel in sorted(dump):
        chapter = derive_chapter(rel, known)
        if chapter is None:
            skipped.append(rel)
            continue
        sections = parse_file(dump[rel])
        for sec_type, blk in sections:
            for q in blk:
                t = sec_type if sec_type is not None else None
                if t is None:
                    t = infer_type(q)
                refine_question(q, t)
                if not q.get('stem'):
                    continue
                qs.append({'file': rel, 'chapter': chapter, 'num': q.get('src_no'),
                           'type': T2ID.get(q['sec_type'], 0), 'sec_type': q['sec_type'],
                           'stem': q['stem'], 'options': q['options'], 'answer': q['answer'],
                           'note': q.get('note') or '', 'flags': q.get('flags') or [],
                           'raw_lines': q['raw_lines']})
    return qs, skipped


# ===================== 写 Excel：import 产物 =====================
def write_excel(out_path, rows):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = '母题库'
    ws.append(HEADERS)
    for r in rows:
        ws.append(r)

    thin = Side(style='thin', color='BBBBBB')
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    hdr_fill = PatternFill('solid', fgColor='4472C4')
    hdr_font = Font(bold=True, color='FFFFFF')
    for c in range(1, len(HEADERS) + 1):
        cell = ws.cell(row=1, column=c)
        cell.fill, cell.font = hdr_fill, hdr_font
        cell.border = border
        cell.alignment = Alignment(wrap_text=True, vertical='center')
    for i in range(2, ws.max_row + 1):
        for c in range(1, len(HEADERS) + 1):
            ws.cell(row=i, column=c).border = border
    for col, w in zip('ABCDEFGHIJKLMNO', [14, 7, 9, 46, 20, 20, 20, 20, 20, 20, 20, 20, 8, 28, 12]):
        ws.column_dimensions[col].width = w
    ws.freeze_panes = 'A2'
    wb.save(out_path)


def to_row(chapter, q):
    """结构化记录 -> Excel 行（判断题选项固定为 对/错）。"""
    sec = q['sec_type']
    if sec == '判断题':
        options = ['对', '错'] + [''] * 6
        ans = q['answer'] or ''
    else:
        options = [t for _, t in q['options']][:8]
        options += [''] * (8 - len(options))
        ans = q['answer'] or ''
    return [chapter, q.get('num'), sec, q['stem'], *options,
            ans, q.get('note') or '', '；'.join(q.get('flags') or [])]


# ===================== verify 专用 =====================
def norm_stem(s):
    s = s.translate(FW)
    s = re.sub(r'^\s*\d+\s*[.、．]\s*', '', s)
    s = re.sub(r'[^\w\u4e00-\u9fff]', '', s)
    return s.lower()


def norm_opt(s):
    """选项文本归一化：去掉字母前缀、标点、空白后比较。两侧同样处理，不会掩盖真实差异。"""
    s = s.translate(FW)
    s = re.sub(r'^\s*[A-Z]\s*[.、．:：)）]?\s*', '', s)
    s = re.sub(r'[^\w\u4e00-\u9fff]', '', s)
    return s.lower()


def load_master():
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
            if o and (OPT_PREFIX.match(o) or re.match(r'^\s*[A-Z]\s+\S', o)):
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
            elif re.search(r'[A-Z]{2,8}\s*[。．]?\s*$', s):
                bad['题干尾部残留答案字母'].append(m)
    return bad


def align(raw_qs, master, ge):
    """把原文题目与母题库逐题配对。

    第一遍：按 (章节, 题型, 源题号) 精确配对——这是最可靠的键，能避免「同章节、同题干、不同答案/
    选项」的多题碰撞（例如某章有多道题干雷同的单选题被错配，伪造答案不一致）。
    第二遍：未精确命中者，再按 章节 + 题干相似度 兜底配对（题型不同时要求相似度 ≥0.9）。
    """
    exact = defaultdict(list)
    for m in master:
        exact[(m['chapter'], m['type'], m['num'])].append(m)
    used, pairs, unmatched = set(), [], []
    for q in sorted(raw_qs, key=lambda x: (-x['type'], x['chapter'], x['num'] or 0)):
        cands = [m for m in exact.get((q['chapter'], q['type'], q['num']), []) if id(m) not in used]
        if cands:
            used.add(id(cands[0]))
            pairs.append((q, cands[0]))
        else:
            unmatched.append(q)

    master_pool = defaultdict(list)
    for m in master:
        if id(m) not in used:
            master_pool[m['chapter']].append(m)
    unpaired = []
    for q in sorted(unmatched, key=lambda x: (-x['type'], x['chapter'], x['num'] or 0)):
        ns = norm_stem(q['stem'])
        best, bs, br = None, -1.0, 0.0
        for m in master_pool.get(q['chapter'], []):
            ms = norm_stem(m['stem'])
            if not ns or not ms:
                continue
            r = SequenceMatcher(None, ns[:60], ms[:60]).ratio()
            if m['type'] != q['type'] and r < 0.9:
                continue
            score = r + (0.12 if m['type'] == q['type'] else 0)
            if score > bs:
                best, bs, br = m, score, r
        if best is not None and br >= ge:
            used.add(id(best))
            pairs.append((q, best))
        else:
            unpaired.append(q)
    orphan = [m for m in master if id(m) not in used]
    return pairs, unpaired, orphan


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
        raw_opts = [t for _, t in q['options']]
        mobj = [o for o in m['opts'] if o]
        for idx, (_, tx) in enumerate(q['options']):
            if idx >= len(LETTERS):
                break
            mtx = m['opts'][idx]
            if norm_opt(tx) and norm_opt(mtx) and norm_opt(tx) != norm_opt(mtx):
                same_content = ''.join(norm_opt(o) for o in mobj) == ''.join(norm_opt(o) for o in raw_opts)
                if same_content:
                    diffs.append({**base, 'level': '提示', 'kind': '选项切分差异（内容一致）',
                                  'field': '选项' + LETTERS[idx], 'now': mtx[:120], 'fix': tx[:120],
                                  'src': '原文该选项跨行，自动切分位置不同；文本拼接后一致'})
                else:
                    diffs.append({**base, 'level': '中等', 'kind': '选项内容不同',
                                  'field': '选项' + LETTERS[idx], 'now': mtx[:120], 'fix': tx[:120],
                                  'src': tx[:120]})
    return diffs


def write_excel_report(path, selfbad, diffs, unpaired, orphan, skipped):
    from openpyxl.styles import Font as _Font, PatternFill as _Fill, Alignment as _Align
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = '更正清单'
    ws.append(['级别', '问题类型', '章节', '源题号', '题型', '母题库行', '字段', '母题库', '导入初版(代码)', '说明'])
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
        cell.font = _Font(bold=True, color='FFFFFF')
        cell.fill = _Fill('solid', fgColor='8C1D1D')
    for i in range(2, ws.max_row + 1):
        for c in range(1, 11):
            ws.cell(row=i, column=c).alignment = _Align(vertical='top', wrap_text=True)
    ws.freeze_panes = 'A2'
    ws.auto_filter.ref = ws.dimensions
    wb.save(path)


# ===================== 子命令 =====================
def cmd_import(args):
    if not RAW_DIR.exists():
        sys.exit(f'未找到 {RAW_DIR}')

    if args.text_only:
        dump, info = extract_docs(args.refresh)
        outdir = Path(args.text_only)
        outdir.mkdir(parents=True, exist_ok=True)
        for rel, text in dump.items():
            (outdir / (rel.replace('/', '__') + '.txt')).write_text(text, encoding='utf-8')
        print(f'导出 {info} -> {outdir}')
        return 0

    dump, info = extract_docs(args.refresh)
    print(f'Word 正文：{info}')

    qs, skipped = parse_all(dump)
    rows, per_ch = [], Counter()
    for q in qs:
        rows.append(to_row(q['chapter'], q))
        per_ch[q['chapter']] += 1

    if skipped:
        print('跳过（无法推导章节）:', skipped)

    out = Path(args.out)
    write_excel(out, rows)
    print(f'生成 -> {out}（{len(rows)} 题 / {len(per_ch)} 章节）')
    types = Counter(r[2] for r in rows)
    print('题型分布:', dict(types))
    flagged = sum(1 for r in rows if r[14])
    print(f'需复核: {flagged} 题')
    print('\n各章节题量:')
    for ch in sorted(per_ch):
        print(f'  {ch:<20} {per_ch[ch]}')
    return 0


def cmd_verify(args):
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
        dump, src = extract_docs(args.refresh)
    except Exception as e:
        print('\n[跳过原文交叉校验] %s' % e)
        print('（母题库自检结论仍然有效）')
        return 2 if (selfbad['缺少正确答案'] or selfbad['多选题答案不足2个字符']
                     or selfbad['题干尾部残留答案字母']) else 0

    known = {m['chapter'] for m in master}
    raw_qs, skipped = parse_all(dump, known)
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
    for k in ('答案不一致', '答案缺失', '选项内容不同', '题干不同', '选项切分差异（内容一致）'):
        if cnt.get(k):
            print('  %-28s %d' % (k, cnt[k]))
    for d in diffs:
        if d['kind'] in ('答案不一致', '答案缺失', '选项内容不同'):
            print('    [%s] 行%s %s 源%s %s %s | 母题库=%r 原文=%r'
                  % (d['kind'], d['row'], d['chapter'], d['num'], d['type'],
                     d.get('field', ''), d['now'], d['fix']))
    stem_diffs = [d for d in diffs if d['kind'] == '题干不同']
    if stem_diffs:
        print('\n  --- 题干文字差异（%d 处，逐条列出供人工抽查）---' % len(stem_diffs))
        for d in stem_diffs[:40]:
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
        write_excel_report(args.excel, selfbad, diffs, unpaired, orphan, skipped)
        print('\n更正清单 -> %s' % args.excel)

    fatal = (cnt.get('答案不一致', 0) + cnt.get('答案缺失', 0)
             + len(selfbad['缺少正确答案']) + len(selfbad['多选题答案不足2个字符'])
             + len(selfbad['题干尾部残留答案字母']))
    if fatal:
        print('\n结论：发现 %d 处答案级问题，需人工确认后再构建。' % fatal)
        return 1
    print('\n结论：未发现答案级问题。其余为题干/选项的切分差异与少量母题库确定性去标注/重述残差（含无标记的尾部注释、以及母题库在去标注外另做措辞调整者），可人工抽查。')
    return 0


def main():
    ap = argparse.ArgumentParser(description='银行上岗考试题库统一管线（生成 + 校验）')
    sub = ap.add_subparsers(dest='cmd', required=True)

    pi = sub.add_parser('import', help='从 raw_bank 的 Word 题库生成母题库初版 Excel')
    pi.add_argument('--out', default=str(DEFAULT_OUT), help='输出 xlsx（默认 data/master_bank.imported.xlsx）')
    pi.add_argument('--refresh', action='store_true', help='强制重抽 Word 正文（忽略缓存）')
    pi.add_argument('--text-only', metavar='DIR', default=None, help='只把 Word 正文导出到该目录（不解析）')
    pi.set_defaults(func=cmd_import)

    pv = sub.add_parser('verify', help='母题库 ↔ 原始 Word 题库一致性校验')
    pv.add_argument('--refresh', action='store_true', help='重新从 data/raw_bank 抽取原文')
    pv.add_argument('--excel', metavar='PATH', help='把更正清单输出为 xlsx')
    pv.add_argument('--ge', type=float, default=0.70, help='题干匹配阈值，默认 0.70')
    pv.set_defaults(func=cmd_verify)

    args = ap.parse_args()
    return args.func(args)


if __name__ == '__main__':
    sys.exit(main())

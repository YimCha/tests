# -*- coding: utf-8 -*-
"""
解析全部 A 类题库文本 -> 结构化记录，输出 JSON 供后续生成 Excel 与核对清单。
不做去重，保留全部题目；无法可靠解析的内容单独标记为"需复核"。
v2: 修复裸区段标题/标题行过滤/区内无编号切题/括号外答案/无字母选项。
"""
import re, os, json, glob

TEXT_DIR = r'c:\Users\lenovo\Desktop\题库\data\tmp\A类'

SECTION_TYPE_MAP = {
    '单选题': '单选题', '单项选择题': '单选题', '单项选择': '单选题', '选择题': '单选题',
    '多选题': '多选题', '多项选择题': '多选题', '多项选择': '多选题',
    '判断题': '判断题', '填空题': '填空题',
    '问答题': '问答题', '简答题': '问答题', '论述题': '问答题', '计算题': '问答题',
    '不定项': '不定项选择题', '不定项选择题': '不定项选择题',
}
_KB = r'(单选题|单项选择题|单项选择|多选题|多项选择题|多项选择|不定项选择题|不定项|判断题|填空题|问答题|简答题|论述题|计算题|选择题)'
SECTION_RE = re.compile(r'^\s*[一二三四五六七八九十]+\s*[.、．:：]?\s*[（(]?\s*' + _KB + r'[）)]?\s*[.、．:：。]?\s*$')
BARE_SECTION_RE = re.compile(r'^\s*' + _KB + r'\s*[.、．:：。]?\s*$')

NUM_RE = re.compile(r'^(\d+)\s*[.、．]')
OPT_LINE_RE = re.compile(r'^\s*([A-ZＡ-Ｚ])\s*[.、．:：)）]')
ANS_PICK_RE = re.compile(r'[（\[【(]\s*([A-ZＡ-Ｚ][A-ZＡ-Ｚ\s]*?)\s*[）\]】)]')
ANS_TAIL_RE = re.compile(r'([A-H])\s*[。．]?\s*$')     # 括号外裸字母答案（如 "是 A 。"）
INLINE_OPT_RE = re.compile(r'[。．.，,]?\s*([A-Z])\s*[.、．:：)）]\s*([^，。]{1,80})$')  # 题干末尾内联选项（如 "（A）。A、最高债务承受能力"）
JUDGE_WORD = r'(正确|错误|对|错|√|×|✓|T|F|是|否)'
ANS_JUDGE_RE = re.compile(r'[（\[【(]\s*(' + JUDGE_WORD + r')\s*[）\]】)]')
ANS_JUDGE_PLAIN_RE = re.compile(r'(' + JUDGE_WORD + r')\s*$')

FW = str.maketrans('ＡＢＣＤＥＦＧＨＴＦ', 'ABCDEFGHTF')
def norm_fw(s): return s.translate(FW)

def has_answer_marker(s):
    s = norm_fw(s)
    return bool(ANS_PICK_RE.search(s) or ANS_JUDGE_RE.search(s))

def classify_section(title):
    for k in ('单项选择题', '多项选择题', '单选题', '多选题', '不定项选择题', '判断题',
              '填空题', '问答题', '简答题', '论述题', '计算题', '单项选择', '多项选择', '不定项', '选择题'):
        if k in title:
            return SECTION_TYPE_MAP[k]
    return None

def extract_judge_answer(line):
    m = ANS_JUDGE_RE.search(line)
    if m:
        raw = m.group(1)
        raw = norm_fw(raw)
        ans = {'对': '对', '是': '对', '正确': '正确', '√': '√', '✓': '√',
               '错': '错', '否': '错', '错误': '错误', '×': '×', 'T': '对', 'F': '错'}[raw]
        stem = line[:m.start()] + line[m.end():]
        note = line[m.end():].strip()
        return ans, stem, note
    m2 = ANS_JUDGE_PLAIN_RE.search(line)
    if m2:
        raw = norm_fw(m2.group(1))
        ans = {'对': '对', '是': '对', '正确': '正确', '√': '√', '✓': '√',
               '错': '错', '否': '错', '错误': '错误', '×': '×', 'T': '对', 'F': '错'}[raw]
        stem = line[:m2.start()].rstrip()
        return ans, stem, ''
    return None, line, ''

def extract_pick_answer(line):
    line = norm_fw(line)
    ms = list(ANS_PICK_RE.finditer(line))
    letters = []
    if ms:
        ok = True
        for m in ms:
            l = re.sub(r'\s+', '', m.group(1)).upper()
            if not l:
                ok = False
                break
            letters.append(l)
        if ok and letters:
            stem = ANS_PICK_RE.sub('', line)
            tail = INLINE_OPT_RE.search(stem)
            if tail:
                stem = stem[:tail.start()].rstrip('。．')
                return letters, stem, [(tail.group(1), tail.group(2).strip())]
            return letters, stem, []
    m2 = ANS_TAIL_RE.search(line)
    if m2:
        letters = m2.group(1)
        stem = line[:m2.start()].rstrip()
        return [letters], stem, []
    return None, line, []

def parse_option_line(line):
    """按字母标记切分一行中的选项，返回 (leading_text, [(letter, text), ...])
    leading_text: 首字母标记前的文字（无字母前缀选项），无则为 ''"""
    line = norm_fw(line)
    matches = list(re.finditer(r'(?<![A-Z])([A-Z])\s*[.、．:：)）]', line))
    if not matches:
        return None
    leading = line[:matches[0].start()].strip()
    segs = []
    for i, m in enumerate(matches):
        letter = m.group(1)
        end = matches[i+1].start() if i+1 < len(matches) else len(line)
        txt = line[m.end():end]
        segs.append((letter, txt))
    return leading, segs

def strip_option_noise(txt):
    txt = txt.strip()
    txt = re.sub(r'[。．、]+$', '', txt).rstrip()
    return txt.strip('"“”')

def parse_file(path):
    raw = open(path, encoding='utf-8-sig').read()
    raw = raw.replace('\u000b', '\n').replace('\r\n', '\n').replace('\r', '\n')
    lines = raw.split('\n')

    sections = []
    cur_type = None
    cur_questions = []
    cur_q = None
    cur_has_ans = False

    def flush_q():
        nonlocal cur_q, cur_has_ans
        if cur_q is not None:
            cur_questions.append(cur_q)
            cur_q = None
            cur_has_ans = False

    def start_q(src_no, line):
        nonlocal cur_q, cur_has_ans
        flush_q()
        cur_q = {'src_no': src_no, 'raw_lines': [line]}
        cur_has_ans = has_answer_marker(line)

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
                cur_type = t
                cur_questions = []
                continue
        mn = NUM_RE.match(s)
        if mn:
            start_q(int(mn.group(1)), s)
            continue
        # 非题号、非区段行
        if cur_q is None:
            # 仅当含答案标记才视为无编号题目，否则视为标题行跳过
            if has_answer_marker(s):
                start_q(None, s)
            continue
        else:
            # 无编号新题：当前题已有答案且本行含答案标记且非选项行
            if cur_has_ans and has_answer_marker(s) and not OPT_LINE_RE.match(s):
                start_q(None, s)
                continue
            cur_q['raw_lines'].append(s)
            if has_answer_marker(s):
                cur_has_ans = True
    flush_q()
    if cur_questions:
        sections.append((cur_type, cur_questions))
    return sections, raw

def refine_question(q, sec_type):
    lines = q['raw_lines']
    stem_parts = []
    options = []
    answer = None
    answer_src = ''
    note = ''
    flags = []

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
            if s.startswith('解析') or s.startswith('（正确答案') or s.startswith('正确答案'):
                note = note or re.sub(r'^(解析|（?正确答案）?)\s*[:：]?\s*[为是]?\s*', '', s).strip('（）')
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

        for ln in lines[1:]:
            s = ln.strip()
            if not s:
                continue
            # 先识别选项行，避免选项文本中的括号字母（如 "（MLF）"）被误当答案
            r = parse_option_line(s)
            is_opt = r is not None and (len(r[1]) >= 2 or any(txt.strip() for _, txt in r[1]))
            if is_opt:
                if r:
                    leading, segs = r
                    if leading:
                        letter = next_letter()
                        if letter:
                            options.append((letter, strip_option_noise(leading)))
                    for letter, txt in segs:
                        options.append((letter, strip_option_noise(txt)))
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
            if s.startswith('解析') or s.startswith('（正确答案') or s.startswith('正确答案'):
                note = note or re.sub(r'^(解析|（?正确答案）?)\s*[:：]?\s*[为是]?\s*', '', s).strip('（）')
                continue
            # 纯文本行：视为无字母选项（file05 等）
            letter = next_letter()
            if letter:
                options.append((letter, strip_option_noise(s)))
            else:
                flags.append('选项超过8个，无法续接')

    stem = ' '.join(p for p in stem_parts if p).strip()
    stem = re.sub(r'\s{2,}', ' ', stem).strip()

    # 选项字母超 H（如 J）时，按出现顺序重标为 A-H，并同步答案（考试宝仅支持 A-H）
    if options:
        letters = [l for l, _ in options]
        if any(l not in 'ABCDEFGH' for l in letters):
            mapping = {}
            for idx, (l, t) in enumerate(options):
                new_l = chr(ord('A') + idx)
                mapping[l] = new_l
            options = [(mapping[l], t) for l, t in options]
            if answer and answer_src:
                answer = ''.join(mapping.get(ch, ch) for ch in answer)
            flags.append('选项字母超H，已按出现顺序重标为A-H并同步答案')

    q['stem'] = stem
    q['answer'] = answer
    q['answer_src'] = answer_src
    q['options'] = options
    q['note'] = note
    q['flags'] = flags
    q['sec_type'] = sec_type

    # 源文件标为单选但答案实际为多选（多字母答案）时，按实际类型改为多选题
    if q['sec_type'] == '单选题' and answer and len(answer) > 1:
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
        ans_set = set(answer)
        opt_set = {l for l, _ in options}
        for al in ans_set:
            if al not in opt_set:
                flags.append(f'答案字母{al}不在选项A-H中')
    return q

def main():
    all_files = []
    for f in sorted(glob.glob(os.path.join(TEXT_DIR, '*.txt'))):
        base = os.path.basename(f)
        m = re.match(r'^(\d+)_(.+)\.txt$', base)
        if not m:
            continue
        src_name = m.group(2)
        chapter = re.sub(r'^2026年?', '', src_name)
        chapter = re.sub(r'题库$', '', chapter) + 'A类'
        sections, _raw = parse_file(f)
        file_qs = []
        for sec_type, qs in sections:
            for q in qs:
                refine_question(q, sec_type)
                file_qs.append(q)
        all_files.append({'file': src_name, 'path': f, 'chapter': chapter, 'questions': file_qs})
        print('='*60)
        print(src_name, '| 区段数:', len(sections), '| 题数:', len(file_qs))
        from collections import Counter
        c = Counter(q['sec_type'] for q in file_qs)
        print('   区段类型分布:', dict(c))
        for q in file_qs:
            if not q['valid']:
                print('   [无效]', q['sec_type'], '|', (q['stem'] or (q['raw_lines'][0] if q['raw_lines'] else ''))[:50], '| flags:', q['flags'])
    with open(os.path.join(TEXT_DIR, '..', 'parsed.json'), 'w', encoding='utf-8') as fh:
        json.dump(all_files, fh, ensure_ascii=False, indent=1)
    print('\nTOTAL QUESTIONS:', sum(len(a['questions']) for a in all_files))

if __name__ == '__main__':
    main()

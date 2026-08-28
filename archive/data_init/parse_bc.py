# -*- coding: utf-8 -*-
"""
解析全部 B/C 类题库文本 -> 结构化记录，输出 JSON 供生成岗位合集与核对清单。
基于 parse_a.py 适配 B/C 格式差异：
  - 判断题答案支持"（）错误"(答案在题干后)、"(正确)"、"(√)"、"(T/F)"等混合格式
  - 题干可跨行、选项A可缺字母前缀、题干首尾多余引号清理
  - 区段标题支持"单选题/多选题/判断题"裸标题
不做去重，保留全部题目。
"""
import re, os, json, glob
from collections import Counter

TEXT_DIR = r'c:\Users\lenovo\Desktop\题库\data\tmp\BC类'

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
ANS_PICK_RE = re.compile(r'[（\[【(]\s*([A-ZＡ-Ｚ][A-ZＡ-Ｚ、，,\s]*?)\s*[）\]】)]')
ANS_TAIL_RE = re.compile(r'([A-H])\s*[。．]?\s*$')
INLINE_OPT_RE = re.compile(r'[。．.，,]?\s*([A-Z])\s*[.、．:：)）]\s*([^，。]{1,80})$')
JUDGE_WORD = r'(正确|错误|对|错|√|×|✓|T|F|是|否)'
ANS_JUDGE_RE = re.compile(r'[（\[【(]\s*(' + JUDGE_WORD + r')\s*[）\]】)]')
ANS_JUDGE_PLAIN_RE = re.compile(r'(?<![A-Za-z0-9\u4e00-\u9fff])(' + JUDGE_WORD + r')\s*$')
ANS_JUDGE_NOTE_RE = re.compile(r'(?<![A-Za-z0-9\u4e00-\u9fff])(' + JUDGE_WORD + r')\s*[（\[【(][^）\]】)]*[）\]】)]\s*$')

def opt_like(txt):
    """判断一段文本是否为真实选项内容（去掉标点/空白后至少1个汉字或≥2字符）"""
    clean = re.sub(r'[\s、，,。．:：()（）【】\[\]"“”\u3000\xa0]+', '', txt)
    if not clean:
        return False
    if len(clean) >= 2:
        return True
    return any('\u4e00' <= c <= '\u9fff' for c in clean)

FW = str.maketrans('ＡＢＣＤＥＦＧＨＴＦ', 'ABCDEFGHTF')
def norm_fw(s): return s.translate(FW)

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

JUDGE_ANS_MAP = {'对': '对', '是': '对', '正确': '正确', '√': '√', '✓': '√',
                 '错': '错', '否': '错', '错误': '错误', '×': '×', 'T': '对', 'F': '错'}

def extract_judge_answer(line):
    m = ANS_JUDGE_RE.search(line)
    if m:
        raw = norm_fw(m.group(1))
        ans = JUDGE_ANS_MAP[raw]
        stem = line[:m.start()] + line[m.end():]
        note = line[m.end():].strip()
        stem = re.sub(r'\s*[（\[【(]\s*[）\]】)]\s*$', '', stem).rstrip()
        return ans, stem, note
    m2 = ANS_JUDGE_PLAIN_RE.search(line)
    if m2:
        raw = norm_fw(m2.group(1))
        ans = JUDGE_ANS_MAP[raw]
        stem = line[:m2.start()]
        stem = re.sub(r'\s*[（\[【(]\s*[）\]】)]\s*$', '', stem).rstrip()
        return ans, stem, ''
    m3 = ANS_JUDGE_NOTE_RE.search(line)
    if m3:
        raw = norm_fw(m3.group(1))
        ans = JUDGE_ANS_MAP[raw]
        stem = re.sub(r'\s*[（\[【(]\s*[）\]】)]\s*$', '', line[:m3.start()]).rstrip()
        nm = re.search(r'[（\[【(]([^）\]】)]*)[）\]】)]\s*$', line[m3.start():])
        note = nm.group(1).strip() if nm else ''
        return ans, stem, note
    return None, line, ''

def extract_pick_answer(line):
    line = norm_fw(line)
    ms = list(ANS_PICK_RE.finditer(line))
    if ms:
        groups = []
        ok = True
        for m in ms:
            l = re.sub(r'[\s、，,．.]+', '', m.group(1)).upper()
            if not l:
                ok = False
                break
            groups.append((l, m))
        if ok and groups:
            singles = [g for g in groups if len(g[0]) == 1]
            multis = [g for g in groups if len(g[0]) > 1]
            answer_groups = singles if singles else [groups[-1]]
            letters = [g[0] for g in answer_groups]
            stem = line
            for g in answer_groups:
                stem = stem[:g[1].start()] + stem[g[1].end():]
            r = parse_option_line(stem)
            if r is not None:
                leading, segs = r
                if (len(segs) >= 2 and opt_like(segs[0][1]) and segs[0][0] == 'A'
                        and leading.strip()):
                    return letters, leading.strip('。．、　 ').rstrip('。．、'), segs
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
    支持 字母+标点 与 字母+空格（如 "A 1  B 2  C 5  D 12"）两种分隔。"""
    line = norm_fw(line)
    strict = list(re.finditer(r'(?<![A-Z])([A-Z])\s*[.、．:：)）]', line))
    space = list(re.finditer(r'(?<![A-Z])([A-Z])\s{1,}(?=[^\s，。、])', line))
    matches = None
    if len(strict) >= 2:
        matches = strict
    elif len(strict) == 1:
        m = strict[0]
        prev = line[m.start()-1] if m.start() > 0 else ''
        if prev not in '（(【〔':
            matches = strict
    elif len(space) >= 2:
        matches = space
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

def clean_stem(s):
    s = re.sub(r'\s{2,}', ' ', s).strip()
    return s.strip('"“”\u3000 ')

def parse_file(path):
    raw = open(path, encoding='utf-8-sig').read()
    raw = raw.replace('\u000b', '\n').replace('\r\n', '\n').replace('\r', '\n')
    lines = raw.split('\n')

    sections = []
    cur_type = None
    cur_questions = []
    cur_q = None
    cur_has_ans = False

    def marker(s, t):
        return has_judge_marker(s) if t == '判断题' else has_answer_marker(s)

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
                cur_type = t
                cur_questions = []
                continue
        mn = NUM_RE.match(s)
        if mn:
            start_q(int(mn.group(1)), s)
            continue
        if cur_q is None:
            if marker(s, cur_type):
                start_q(None, s)
            continue
        else:
            if cur_has_ans and marker(s, cur_type) and not OPT_LINE_RE.match(s):
                start_q(None, s)
                continue
            cur_q['raw_lines'].append(s)
            if marker(s, cur_type):
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
            if s.startswith('解析') or s.startswith('（正确答案') or s.startswith('正确答案') or s.startswith('答案'):
                note = note or re.sub(r'^(解析|（?正确答案）?|答案)\s*[:：]?\s*[为是]?\s*', '', s).strip('（）')
                continue
            r = parse_option_line(s)
            is_opt = r is not None and (len(r[1]) >= 2 or any(opt_like(txt) for _, txt in r[1]))
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
            letter = next_letter()
            if letter:
                options.append((letter, strip_option_noise(s)))
            else:
                flags.append('选项超过8个，无法续接')

    stem = ' '.join(p for p in stem_parts if p).strip()
    stem = clean_stem(stem)

    # 选项字母超 H 时按出现顺序重标为 A-H 并同步答案
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
    if q['sec_type'] in ('单选题', '多选题', '不定项选择题') and len(options) < 2:
        flags.append('选项少于2个，疑似切题/切选项异常')
    if not stem:
        flags.append('题干为空')
    return q

def infer_type(q):
    for ln in q['raw_lines']:
        if ANS_JUDGE_RE.search(ln) or ANS_JUDGE_PLAIN_RE.search(ln) or ANS_JUDGE_NOTE_RE.search(ln):
            return '判断题'
    for ln in q['raw_lines']:
        m = ANS_PICK_RE.search(ln)
        if m:
            letters = re.sub(r'[\s、，,．.]+', '', m.group(1)).upper()
            return '多选题' if len(letters) > 1 else '单选题'
    return '单选题'

def main():
    all_files = []
    for f in sorted(glob.glob(os.path.join(TEXT_DIR, '*.txt'))):
        base = os.path.basename(f)
        m = re.match(r'^(\d+)_(.+)_([BC])\.txt$', base)
        if not m:
            continue
        dept, cls = m.group(2), m.group(3)
        chapter = f'{dept}{cls}类'
        sections, _raw = parse_file(f)
        file_qs = []
        for sec_type, qs in sections:
            t = sec_type
            for q in qs:
                if t is None:
                    t = infer_type(q)
                refine_question(q, t)
                file_qs.append(q)
        all_files.append({'file': base[:-4], 'dept': dept, 'cls': cls,
                          'chapter': chapter, 'questions': file_qs})
        c = Counter(q['sec_type'] for q in file_qs)
        invalid = [q for q in file_qs if not q['valid']]
        print(f'{base}: 题数={len(file_qs)} | {dict(c)} | 无效={len(invalid)}')
        for q in invalid:
            print('   [无效]', q['sec_type'], '|', (q['stem'] or (q['raw_lines'][0] if q['raw_lines'] else ''))[:40], '|', q['flags'])
    with open(os.path.join(TEXT_DIR, '..', 'bc_parsed.json'), 'w', encoding='utf-8') as fh:
        json.dump(all_files, fh, ensure_ascii=False, indent=1)
    print('\nTOTAL BC QUESTIONS:', sum(len(a['questions']) for a in all_files))

if __name__ == '__main__':
    main()

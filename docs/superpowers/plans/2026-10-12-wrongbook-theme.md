# 错题本增强 + 考试入错题本 + 浅色模式 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落实 spec 的三项用户反馈修复：错题本详情补完整选项、模拟考试答错入错题本、浅色模式三态切换。

**Architecture:** 单源改动集中在 `src/_app_script.js`（注入 template.html 占位符 `__APP_SCRIPT__`）与 `src/template.html`（CSS 变量 + 浅色变量组）。错题记录数据结构加可选字段 `ua`，向后兼容旧记录。测试通过构建后的 HTML 在 Node 桩环境断言。

**Tech Stack:** 原生 JS/CSS（无依赖）；测试 Node.js 桩 + eval；构建 Python + openpyxl。

**Spec:** `docs/superpowers/specs/2026-10-12-wrongbook-theme-design.md`

## Global Constraints

- 构建与测试解释器：构建用 `C:\Users\lenovo\.workbuddy\binaries\python\envs\default\Scripts\python.exe src\build_bank.py`（系统 python 缺 openpyxl）。
- **测试读的是构建产物**（`src/debug/_output.json` 指向的 HTML）：每次改完源码必须先重新构建，再跑测试，顺序不能反。
- 主逻辑唯一真源是 `src/_app_script.js`；**禁止**直接编辑 `src/template.html` 里的脚本占位符。
- 零第三方依赖；代码中不得出现银行名称、部门名、本机绝对路径。
- 回归四件套命令：`node src/_test_logic.js`、`node src/debug/_sim_test.js`、`node src/debug/_draw_test.js`、`node src/debug/_paper_test.js`。
- 错题记录持久化沿用现有 `pSave()`（localStorage 冗余 + 文件写回），不新增存储通道。
- 界面文案不出现技术术语（沿用 AGENTS.md 文案规范）。

## Review Focus

- **旧错题记录无 `ua` 字段**：期望详情只高亮正确项、不报错 → Task 2 Step 1 测试钉住。
- **错选项字母超出当前选项范围**（题库更新后）：期望静默跳过该标注、其余正常渲染 → Task 2 Step 1 测试钉住。
- **`localStorage('exam_tool_theme_v1')` 存了非法值**：期望按 `auto` 处理、不抛异常 → Task 5 Step 1 测试钉住。
- **`window.matchMedia` 不存在**（老内核/测试桩）：期望跳过系统偏好监听、按深色初始化，不阻塞脚本 → Task 5 Step 1 测试钉住（测试桩本身无 matchMedia，天然覆盖）。
- **考试未作答的题**（`ans[qi]` 为空）：期望不调用 `recordWrong`、不产生错题记录 → Task 3 Step 1 测试钉住。

---

### Task 1: `recordWrong` 增加 `ua` 参数

**Files:**
- Modify: `src/_app_script.js:979`（`lockPractice` 调用点）、`:995-1006`（`recordWrong`）
- Test: `src/debug/_sim_test.js`（在「10) 答错入错题本」段后追加）

**Interfaces:**
- Consumes: 现有 `recordWrong(pi, qi, ok)`。
- Produces: `recordWrong(pi, qi, ok, ua)` — `ua` 可选数组（选项字母，判断题为 `['对']`/`['错']`）；答错时写入记录字段 `ua`（数组原样保存），答对路径**不覆盖**已有 `ua`。旧记录无 `ua` 字段即「未记录作答」。

- [ ] **Step 1: 写失败测试**（`_sim_test.js` 第 10 段之后追加）

```js
// 10.5) 错题记录保存当时作答 ua；答对不覆盖
__h.resetPw();
const qu = seqP[0], q2u = seqP[1];
recordWrong(0, qu, false, ['A','C']);
ok(Array.isArray(__h.pw()[0][qu].ua) && __h.pw()[0][qu].ua.join('')==='AC', '答错记录保存 ua=[A,C]');
recordWrong(0, qu, false, ['B']);
ok(__h.pw()[0][qu].ua.join('')==='B', '再次答错时 ua 更新为最近一次');
recordWrong(0, qu, true);
ok(__h.pw()[0][qu].ua.join('')==='B', '答对（streak 路径）不覆盖 ua');
recordWrong(0, q2u, false);
ok(!('ua' in __h.pw()[0][q2u]), '不传 ua 时记录无 ua 字段（旧格式兼容）');
```

- [ ] **Step 2: 重建并跑测试，确认失败**

```bash
C:/Users/lenovo/.workbuddy/binaries/python/envs/default/Scripts/python.exe src/build_bank.py
node src/debug/_sim_test.js
```
预期：新用例 FAIL（`ua` 未定义/未保存）。

- [ ] **Step 3: 实现**

`recordWrong` 签名改为 `(pi, qi, ok, ua)`；答错分支在 `r.fails++` 后加：`if(ua) r.ua = ua.slice();`（拷贝，防外部引用变更）。`lockPractice` 的调用改为 `recordWrong(st.pos, qi, ok, ua);`。

- [ ] **Step 4: 重建并跑测试，确认通过**（同 Step 2 命令，全部 PASS）

- [ ] **Step 5: Commit**

```bash
git add src/_app_script.js src/debug/_sim_test.js
git commit -m "feat: 错题记录保存当时作答 ua（兼容旧记录）"
```

### Task 2: 错题本详情渲染完整选项

**Files:**
- Modify: `src/_app_script.js:1073-1078`（`reviewPractice`）
- Test: `src/debug/_sim_test.js`

**Interfaces:**
- Consumes: Task 1 的 `ua` 字段；`reviewDetail()` 已有的 `.rv-opt`（`r` 正确 / `w` 错选）选项样式与结构（`template.html` 中已定义，直接复用 class，不加新 CSS）。
- Produces: `reviewPractice(r)` 输出完整选项列表（字母+正文，判断题为对/错），正确项 `class="rv-opt r"`，`r.ua` 存在时错选项 `class="rv-opt w"`；`ua` 中超出选项范围的字母静默跳过。

- [ ] **Step 1: 写失败测试**

```js
// 13.5) 错题本详情渲染完整选项（含 ua 高亮与旧记录兼容）
__h.resetPw();
const qd = seqP.find(qi=>qAt(qi).t===0);          // 单选题
recordWrong(0, qd, false, ['A']);
let det = reviewPractice(__h.pw()[0][qd]);
ok((det.match(/rv-opt r/g)||[]).length===1, '详情恰有一个正确项高亮');
ok(det.includes('rv-opt w') && det.includes('>A<'), '错选项 A 标红');
ok(det.includes(esc(qAt(qd).o[1])) || qAt(qd).o.every((t,i)=>det.includes(esc(t))||i===0), '详情含选项正文');
const qdOld = seqP.find(qi=>qAt(qi).t===0 && qi!==qd);
recordWrong(0, qdOld, false);                      // 旧格式：无 ua
det = reviewPractice(__h.pw()[0][qdOld]);
ok((det.match(/rv-opt r/g)||[]).length===1 && !det.includes('rv-opt w'), '旧记录只高亮正确项、无错选标记');
const qdj = seqP.find(qi=>qAt(qi).t===2);          // 判断题
recordWrong(0, qdj, false, [qAt(qdj).a==='对'?'错':'对']);
det = reviewPractice(__h.pw()[0][qdj]);
ok(det.includes('对') && det.includes('错') && det.includes('rv-opt w'), '判断题详情含对/错两项与错选标记');
```

- [ ] **Step 2: 重建并跑测试，确认失败**

```bash
C:/Users/lenovo/.workbuddy/binaries/python/envs/default/Scripts/python.exe src/build_bank.py
node src/debug/_sim_test.js
```
预期：新用例 FAIL（当前 `reviewPractice` 不含 `rv-opt`）。

- [ ] **Step 3: 实现 `reviewPractice`**

结构照搬 `reviewDetail()` 的选项渲染分支（`q.t===2` 对/错两档；否则 `q.o.map` 字母+正文），状态判定：`right.includes(L)`→`r`；`ua && ua.includes(L) && !right.includes(L)`→`w`。保留原有 `.rv-stem-full` 题干、答案摘要行（判断题显示对/错，选择题显示正确项字母+正文）、解析行。

- [ ] **Step 4: 重建并跑测试，确认通过**（同 Step 2 命令）

- [ ] **Step 5: Commit**

```bash
git add src/_app_script.js src/debug/_sim_test.js
git commit -m "feat: 错题本详情展示完整选项与当时错选"
```

### Task 3: 模拟考试答错入错题本

**Files:**
- Modify: `src/_app_script.js:696-710`（`submitExam` 判分循环）
- Test: `src/debug/_sim_test.js`

**Interfaces:**
- Consumes: Task 1 的 `recordWrong(pi, qi, ok, ua)`；现有 `judgeOK(q, ua)`、`mkExam()` 测试助手。
- Produces: `submitExam()` 对每道 `judgeOK` 为否且**已作答**的题调用 `recordWrong(st.pos, qi, false, ua)`；未作答（`ua` 空数组）不记录。

- [ ] **Step 1: 写失败测试**

```js
// 6.5) 模拟考试答错入错题本（同刷题口径），未作答不入
__h.resetPw();
__h.setExam(mkExam());
const wrongQ = [];
__h.exam().paper.forEach((qi,i)=>{ const q=BANK.q[qi];
  if(i%3===0){ let w; if(q.t===2) w=[q.a==='对'?'错':'对']; else w=[LETTERS.find(L=>!q.a.includes(L))];
    __h.exam().ans[qi]=w; wrongQ.push(qi); } });
submitExam();
ok(__h.exam().done, '交卷完成');
wrongQ.forEach(qi=>{ const r=__h.pw()[__h.st().pos][qi];
  ok(r && r.fails===1 && Array.isArray(r.ua), '考试答错入错题本 fails=1 且含 ua'); });
ok(Object.keys(__h.pw()[__h.st().pos]||{}).length===wrongQ.length, '未作答题不产生记录');
// 第二场再错同一题，次数累计
__h.setExam(mkExam());
const qAgain = wrongQ[0];
__h.exam().ans[qAgain] = (()=>{ const q=qAt(qAgain); return q.t===2?[q.a==='对'?'错':'对']:[LETTERS.find(L=>!q.a.includes(L))]; })();
submitExam();
ok(__h.pw()[__h.st().pos][qAgain].fails===2, '多场考试错同一题次数累计');
__h.resetPw();
```

注意：`mkExam()` 与 `__h.st().pos` 的岗位须一致（沿用现有测试第 6 段的前置状态）；插入位置在第 6 段之后，后续段已有 `resetPw` 不受污染。

- [ ] **Step 2: 重建并跑测试，确认失败**

```bash
C:/Users/lenovo/.workbuddy/binaries/python/envs/default/Scripts/python.exe src/build_bank.py
node src/debug/_sim_test.js
```
预期：新用例 FAIL（交卷后无错题记录）。

- [ ] **Step 3: 实现**

`submitExam` 判分循环改为：

```js
if(judgeOK(q,ua)){ score++; stt[cls].g++; tst[q.t].g++; }
else if(ua.length){ recordWrong(st.pos, qi, false, ua); }
```

其余（save/render/统计）不动；自动交卷路径共用，无需另改。

- [ ] **Step 4: 重建并跑测试，确认通过；随后跑全量四件套**（Global Constraints 命令），确认既有用例（尤其第 6/10-15 段）零回归。

- [ ] **Step 5: Commit**

```bash
git add src/_app_script.js src/debug/_sim_test.js
git commit -m "feat: 模拟考试交卷后答错自动记入错题本"
```

### Task 4: 浅色主题 CSS 变量组

**Files:**
- Modify: `src/template.html:9-29`（`:root` 与滚动条）

**Interfaces:**
- Consumes: 无。
- Produces: `[data-theme="light"]` 选择器覆盖 `:root` 中**全部**颜色变量（`--bg0..2`、`--line`、`--line2`、`--panel`、`--gold*`、`--ink`、`--muted`、`--faint`、`--good`、`--bad`、`--a/b/c`、`--shadow`）；新增滚动条变量 `--sb1`、`--sb2`（深色取 `#333b55`/`#232a40`，浅色取配套灰金），滚动条 thumb 渐变改引 `var(--sb1)/var(--sb2)`。色值方向：浅色组用米白纸感底（`--bg0:#f5f3ee` 级）、深墨文字、降低金色的明度以保对比度；具体色值实现者按此方向定（CSS 不进测试，Task 5 后人工抽查）。

- [ ] **Step 1: 在 `:root` 块后新增 `[data-theme="light"]{...}` 全量变量覆盖**，并把 `:root` 增加 `--sb1/--sb2`，`::-webkit-scrollbar-thumb` 改用变量。
- [ ] **Step 2: 全文扫描写死色值**：`grep -n '#[0-9a-fA-F]\{3,6\}' src/template.html`，凡参与主题观感的字面量（阴影、渐变、徽章底色等）改引变量或补 `[data-theme="light"]` 专属覆盖；`::selection` 亦需浅色适配。结构/字号值不动。
- [ ] **Step 3: 重建**：`python.exe src\build_bank.py`，确认构建成功无报错。
- [ ] **Step 4: Commit**

```bash
git add src/template.html
git commit -m "feat: 新增浅色主题 CSS 变量组（data-theme=light）"
```

### Task 5: 主题三态切换逻辑与首页入口

**Files:**
- Modify: `src/_app_script.js`（新增「主题」小节，放状态区 `pSave` 之后）、`:248-251`（`vHome` 按钮区）
- Test: `src/debug/_sim_test.js`（**测试桩需扩展**）

**Interfaces:**
- Consumes: Task 4 的 `[data-theme="light"]` CSS。
- Produces:
  - `const THEME_KEY='exam_tool_theme_v1'`；`themePref()` 返回 `'auto'|'light'|'dark'`（缺省 `'auto'`，非法值按 `'auto'`）。
  - `applyTheme()`：按偏好设 `document.documentElement.setAttribute('data-theme', ...)`；`auto` 时读 `window.matchMedia('(prefers-color-scheme: light)')`，`matchMedia` 不存在则按深色。
  - `cycleTheme()`：`auto→light→dark→auto` 循环，写 localStorage、`applyTheme()`、刷新按钮文案。
  - `themeLabel(p)`：返回「主题：跟随系统 / 主题：浅色 / 主题：深色」。
  - 首页右上角按钮：`<button class="top-tab" id="themeBtn" onclick="cycleTheme()">`（排在「生成试卷」之前）。
  - 脚本初始化时调用一次 `applyTheme()`；`auto` 态注册 `matchMedia.addEventListener('change', ...)` 跟随系统（仅当偏好为 `auto` 时生效），注册前判 `window.matchMedia` 存在。

- [ ] **Step 1: 扩展测试桩**（`_sim_test.js` 桩区）：

```js
// fakeEl 增加（class 旁）：
setAttribute(k,v){ (this._attrs=this._attrs||{})[k]=v; },
getAttribute(k){ return (this._attrs||{})[k] ?? null; },
// window 增加 matchMedia 桩（默认浅色匹配，测试内可改）：
global.matchMediaResult = { matches:false, addEventListener(){}, removeEventListener(){} };
global.window.matchMedia = ()=>global.matchMediaResult;
global.matchMedia = global.window.matchMedia;
```

`__h` 增加暴露：`themePref:()=>themePref(), cycleTheme:()=>cycleTheme(), themeBtnHTML:()=>vHome()`。
随后写失败测试：

```js
// 18) 主题三态切换
document.documentElement._attrs = {};          // 清空起始主题
localStorage.setItem('exam_tool_theme_v1','bogus');
applyTheme();
ok(themePref()==='auto', '非法存储值按 auto 处理');
ok(document.documentElement.getAttribute('data-theme')!=='light', 'auto+深色系统偏好 → 非 light');
global.matchMediaResult.matches = true; applyTheme();
ok(document.documentElement.getAttribute('data-theme')==='light', 'auto 跟随系统浅色');
cycleTheme(); ok(themePref()==='light' && localStorage.getItem('exam_tool_theme_v1')==='light', '循环到 light 并持久化');
cycleTheme(); ok(themePref()==='dark', '循环到 dark');
cycleTheme(); ok(themePref()==='auto', '循环回 auto');
ok(vHome().includes('themeBtn') && vHome().includes('cycleTheme()'), '首页含主题切换按钮');
ok(vHome().includes('跟随系统')||vHome().includes('主题：'), '按钮文案为日常说法');
```

- [ ] **Step 2: 重建并跑测试，确认失败**

```bash
C:/Users/lenovo/.workbuddy/binaries/python/envs/default/Scripts/python.exe src/build_bank.py
node src/debug/_sim_test.js
```

- [ ] **Step 3: 实现**（按 Produces 契约；`vHome` 按钮插在「生成试卷」按钮之前；初始化调用放在脚本尾部 `render()` 首次执行前）

- [ ] **Step 4: 重建并跑测试，确认通过；随后全量四件套回归**（`_draw_test.js`/`_paper_test.js` 共享桩结构，若它们也有 `documentElement`/`window` 桩需同步补 `matchMedia`，改桩不算功能改动）。

- [ ] **Step 5: Commit**

```bash
git add src/_app_script.js src/template.html src/debug/_sim_test.js src/debug/_draw_test.js src/debug/_paper_test.js
git commit -m "feat: 主题三态切换（跟随系统/浅色/深色）与首页入口"
```

### Task 6: 收尾——全量回归、重建、人工抽查

**Files:**
- Produce: 重建产物 `模拟考试工具.html`（git 忽略与否以仓库现状为准，构建产物不提交源码库之外的仓）

- [ ] **Step 1: 全量回归**：四件套命令全部 EXIT 0。
- [ ] **Step 2: 重建** `python.exe src\build_bank.py`；`python src/bank_pipeline.py verify` 确认 EXIT 0（题库口径未被触碰）。
- [ ] **Step 3: 人工抽查清单**（Chrome 打开构建产物）：
  1. 首页右上角主题按钮三态循环，浅色下首页/考试/刷题/错题本/抽签/生成试卷六页观感正常（重点：金色强调、错项红/对项绿在浅色下可读）。
  2. 系统切换深浅色，`auto` 态跟随。
  3. 完整走一遍模拟考试（含答错）→ 交卷 → 错题本出现对应题，展开见选项正文、错选标红。
  4. 刷题答错 → 错题本同样可见；连对 3 次移入已掌握。
  5. 抽签与生成试卷功能不受影响（各走一遍主流程）。
- [ ] **Step 4: Commit（如有测试桩收尾改动）**，更新项目记忆：三反馈已修复、新测试用例数。

---

## Self-Review 记录

- Spec 覆盖：spec「详细设计」1→Task 4+5；2→Task 1+2；3→Task 3；错误处理四条→Review Focus + Task 5 测试；测试计划→各任务 Step 1 与 Task 6。无缺口。
- 类型一致：`recordWrong(pi, qi, ok, ua)` 在 Task 1 定义、Task 2/3 消费一致；`THEME_KEY`、`themePref/applyTheme/cycleTheme` 名称各处一致。
- 步骤粒度：每步一个动作；实现步骤只给签名/判定规则，函数体由测试决定。
- 比例：计划与 spec 篇幅相当，无成段代码转写。

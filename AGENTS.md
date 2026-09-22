# AGENTS.md

## 项目概述

银行上岗考试题库处理脚本：从母题库（Excel）生成离线模拟考试 + 刷题练习工具（单文件 HTML）。
本仓库只含代码与空模板，题库数据与银行信息均不提交。

## 核心原则

* **代码纯净**：代码中不得出现银行名称、部门名、本机绝对路径等业务信息。
  标题/页脚/输出文件名等元数据一律从 `data/config.xlsx` 的「工具配置」sheet 读取。

* **数据不入库**：`data/` 被 git 忽略；参与者用 `templates/` 空模板创建本地数据。

* **Excel 为唯一编辑入口**：题目在 `master_bank.xlsx`，岗位配置与元数据在 `config.xlsx`，
  代码不做硬编码。

## 数据架构

```
data/raw_bank/**（各部门原始 Word，终极真值）
   │  src/bank_pipeline.py（统一管线：Word COM 抽文本 + 解析 → 母题库初版，并与母题库逐题校验）
   ▼
data/master_bank.xlsx（题目，唯一人工编辑入口）
data/config.xlsx（岗位配置 + 工具元数据，唯一人工编辑入口）
   │  src/bank_loader.py（直读两个 xlsx + 按章节名自动推导岗位归属）
   ├─▶ src/build_bank.py → 离线模拟考试工具 HTML（文件名来自 config「工具配置」）
   └─▶ src/split_by_position.py → 各岗位考试宝导入表（data/by_position/）
```

## 关键约定

* 章节→岗位归属按章节名（`XX部A类` / `XX部B类` / `XX部C类`）自动推导，不在代码硬编码。

* 每个岗位 A/B/C 三类分值合计必须等于 80（`bank_loader.py` 会校验）。

* 题库规模：55 章节、1130 题（单选 452 / 多选 452 / 判断 226）。

* 岗位卷题量：560 / 610 / 595 / 595 / 595 / 595。

* 模拟考试：80 题、每题 1 分、总分 80；选项固定顺序（A–H 共 8 列）；判断题选项为「对 / 错」。

* 工具功能：模拟考试（80 题、每题 1 分、总分 80）与刷题练习（按岗位/类别/部门选范围、
  即时反馈判分）。错题本记录错误次数（只增不减），连对 3 次移入「已掌握」，可强化练习
  高频（≥2 次）错题。练习数据存浏览器 localStorage，不入库。

* **抽签**：独立于岗位的一级功能（首页右上角入口）。导入 Excel 名单（.xlsx，**零依赖本地解析**：
  ZIP 中央目录 + 原生 `DecompressionStream('deflate-raw')` + `DOMParser`，不引入解析库）。
  **零手动配置**：约定第一行是标题行、数据从第 2 行开始，按标题文字自动认列（先认工号，
  再认姓名），识别结果只读展示，不给下拉框；认不出就提示按模板整理，并提供「下载名单模板」
  （模板 xlsx 由 `dzTemplateBlob()` 在浏览器里手写 ZIP + inlineStr 生成，同样不引第三方库）。
  **姓名与工号都必填，且工号必须唯一**——工号重复会让同一人的中签概率翻倍，所以检测到重复时
  直接拦截导入并列出重复工号，不做静默去重；缺姓名或缺工号的行跳过。预览表格用名单自己的
  标题行作表头，正文从第 2 行开始（行号列是原始 Excel 行号），标题行不会重复出现。
  名单区**展示全部人员**，不做「还有 N 人」折叠。
  应抽人数 = 总人数 × 百分比，取整方式三选一（向下 / 向上 / 四舍五入，`.5` 一律进位）；
  向上取整结果超过总人数时钳制为全员，向下取整得 0 时拦截抽签并提示，不静默改数。
  抽取用 `crypto.getRandomValues` + 拒绝采样（消除模偏差）做无放回等概率抽取。
  名单及参数只存本机 localStorage，**不写回 HTML 文件**；名单编号用于事后核对名单未被更换
  （排序后哈希，与行序无关）。

* **抽签界面文案面向所有人**（抽签页可能投屏给全员看）：不写「等概率随机 / 无放回 / 列映射 /
  未去重 / 指纹」这类技术术语，也不写「导入名单 · 设定比例 · 逐个揭晓」这类操作步骤式副标题。
  用「抽取设置」「名单编号」「下载表格」「共 N 人」这类日常说法。

* **生成试卷**：独立于岗位的一级功能（首页右上角入口，与「抽签」并排）。勾选岗位（多选、
  去重、固定按岗位表顺序出卷），每个岗位出一套纸质试卷：单选 40 + 多选 25 + 判断 15，
  每题 1 分共 80 分，组卷复用模拟考试的 `genPaper` 与该岗位方案默认口径。
  每套含**空白试卷 / 答题卡 / 参考答案**三段（打印文档按此排序，答案在最后，防止随空白卷误发），
  新窗口打开即可打印或另存 PDF；短选项自动 2/4 列并排，题目块不跨页断裂；
  参考答案只含题号 + 答案，**不含解析**。
  每次生成可下载「组卷记录」xlsx（零依赖手写 ZIP，sheet：组卷记录 + 信息）留档；
  「按记录重印」导入记录后逐行校验岗位 / 题库题号 / 卷面题号 / 章节 / 答案与当前题库一致，
  任一不符（题库已更新或记录被改）直接拒绝重印，避免印出错卷。

* genPaper 组卷保证全卷无重复：抽题单元（A 合集 / B、C 部门组）池互斥，单元内跨题型共享
  已用集合，某题型不足时补抽其他题型也不会与已抽的题重复。

* **组卷设置为模拟考试与生成试卷单源共用**（`_app_script.js` 的「组卷设置」公共层）：
  默认口径（`DEFAULT_TYPES` / `defaultRule`）、设置行渲染（`ruleRowsHTML` / `typeRowsHTML`）、
  读值（`readTypeInputs` / `readRuleInputs`）、合计校验（`checkSetup`）都只写一份，
  两边各用 DOM id 前缀区分（模拟考试无前缀，试卷 `pp`，注意拼接后全小写）。
  试卷的题型题量所有岗位共用一份；抽取规则仅在勾选单个岗位时可自定义（`st.paperRule` 记岗位），
  多岗位按各自方案默认口径。调整口径或校验规则时改公共层，两个入口同时生效。

* 路径一律用相对路径（pathlib 或基于 `__file__`），禁止硬编码绝对路径。

* **题干文字规范**：空括号统一写作全角 `（）`；不得保留题号前缀（`1、`）、数字序号、
  选项字母前缀（`A.` `B、` `A `），也不得在题干里写出答案。
  母题库应保持干净，`bank_loader.clean_stem()` 另有一层输出侧归一化兜底。

* 修改 config.xlsx 后需重跑 `python src/build_bank.py` 使标题/页脚/文件名生效。

* **数据质量闸门**：`bank_loader.py` 的 `_check_questions()` 会直接报错拦截以下情况——
  答案为空、多选题答案不足 2 个字母、答案字母超出选项范围、题干尾部残留答案字母。
  这些是「导入脚本静默截断」的指纹，务必保持开启。

* **题库更新后跑一次一致性校验**：`python src/bank_pipeline.py verify`。
  它把 `data/raw_bank` 下的原始 Word 与母题库逐题比对，发现答案级不一致时以退出码 1 结束。
  原始文档是唯一真值来源，母题库与它不一致时以原文为准。
  校验与生成共用同一套解析内核，避免「两套解析器互相漂移」漏检静默错误。

* **岗位分表按考试宝导入模板出**：`python src/split_by_position.py` 默认套用
  `templates/kaoshibaoExcel20221101.xlsx`，只替换数据行（第 3 行起），
  保留第 1 行导入须知、第 2 行蓝色表头、「版本号」sheet 与题型下拉校验。
  映射约定：判断题的「对 / 错」写进选项 A / B，正确答案写字母 A / B；
  选择题答案只写字母、不加分隔符；难度列留空（非必填，题库无此字段）。

* **工具主逻辑以 `src/_app_script.js` 为唯一真源**：`build_bank.py` 构建时把它注入
  `template.html` 的 `__APP_SCRIPT__` 占位符。不要再直接编辑 template.html 里的脚本
  （那里只有占位符，改了不会生效）。

* **Word → 母题库** 由 `src/bank_pipeline.py` 完成（生成与校验合并为同一文件的两个子命令，
  共用解析内核）：章节归属从数据推导
  （部门 = `raw_bank` 子文件夹名去掉年份与「题库」，类别 = 文件名里的 A/B/C 类），
  `python src/bank_pipeline.py import` 生成 `data/master_bank.imported.xlsx` 初版，
  **默认不覆盖** `master_bank.xlsx`；`python src/bank_pipeline.py verify` 把初版与母题库
  逐题比对，差异交人工合并。文本缓存位于 `data/tmp/import_text.json`。

## 常用命令

```bash
python src/bank_pipeline.py import     # Word -> 母题库初版（默认 data/master_bank.imported.xlsx，不覆盖母题库）
python src/bank_pipeline.py import --refresh   # 强制重抽 Word 正文（忽略 data/tmp 缓存）
python src/bank_pipeline.py verify   # 题库一致性校验：母题库 ↔ 原始 Word 逐题比对（退出码 1 = 有答案级问题）
python src/bank_pipeline.py verify --refresh --excel 核对报告.xlsx   # 重抽原文并输出更正清单
python src/build_bank.py      # 生成离线模拟考试工具 HTML
python src/split_by_position.py            # 按岗位拆分 -> data/by_position/（考试宝导入模板格式）
python src/split_by_position.py --format plain   # 同上，但用母题库原始列结构
node src/_test_logic.js       # 组卷比例测试（6 岗位 × 10 次）
node src/debug/_sim_test.js   # 考试与刷题流程测试
python src/debug/_mk_draw_sample.py   # 生成抽签测试数据（draw_sample / draw_badtpl / draw_dup / 抽签测试名单 200 人）
node src/debug/_draw_test.js          # 抽签功能测试（xlsx 解析/自动识别/工号校验/取整/抽样均匀性/模板闭环，88 项）
node src/debug/_paper_test.js         # 生成试卷功能测试（组卷口径/无重复/记录导出导入/篡改拦截/打印文档，53 项）
node src/debug/_mk_paper_preview.js   # 生成打印版试卷样例（data/tmp/paper_preview.html，人工预览版式）
python src/debug/_browser_check.py check      # 生成浏览器自检页，配合 Chrome headless --dump-dom 使用
python src/debug/_browser_check.py manual     # 同上，改用 50 人人工测试名单验证
python src/debug/_browser_check.py map        # 同上，停在确认名单页（用于截图）
python src/debug/_browser_check.py params     # 同上，停在抽签参数页（用于截图）
```

## 依赖

* Python 3 + openpyxl（`pip install openpyxl`）

* Node.js（仅运行测试脚本）

* pywin32（`bank_pipeline.py` 抽取 Word 正文时需要；缺失时 `verify` 自动退化为
  「母题库自检」模式，`import` 会直接报错。文本缓存位于 `data/tmp/import_text.json`）


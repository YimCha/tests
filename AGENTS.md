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
data/master_bank.xlsx（题目，唯一人工编辑入口）
data/config.xlsx（岗位配置 + 工具元数据，唯一人工编辑入口）
   │  src/bank_loader.py（直读两个 xlsx + 按章节名自动推导岗位归属）
   ▼
src/build_bank.py → 离线模拟考试工具 HTML（文件名来自 config「工具配置」）

data/raw_bank/**（各部门原始 Word，终极真值）
   │  src/verify_bank.py
   ▼
与 master_bank.xlsx 逐题比对 → 差异报告 / 更正清单
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

* 路径一律用相对路径（pathlib 或基于 `__file__`），禁止硬编码绝对路径。

* **题干文字规范**：空括号统一写作全角 `（）`；不得保留题号前缀（`1、`）、数字序号、
  选项字母前缀（`A.` `B、` `A `），也不得在题干里写出答案。
  母题库应保持干净，`bank_loader.clean_stem()` 另有一层输出侧归一化兜底。

* 修改 config.xlsx 后需重跑 `python src/build_bank.py` 使标题/页脚/文件名生效。

* **数据质量闸门**：`bank_loader.py` 的 `_check_questions()` 会直接报错拦截以下情况——
  答案为空、多选题答案不足 2 个字母、答案字母超出选项范围、题干尾部残留答案字母。
  这些是「导入脚本静默截断」的指纹，务必保持开启。

* **题库更新后跑一次一致性校验**：`python src/verify_bank.py`。
  它把 `data/raw_bank` 下的原始 Word 与母题库逐题比对，发现答案级不一致时以退出码 1 结束。
  原始文档是唯一真值来源，母题库与它不一致时以原文为准。

* **岗位分表按考试宝导入模板出**：`python src/split_by_position.py` 默认套用
  `templates/kaoshibaoExcel20221101.xlsx`，只替换数据行（第 3 行起），
  保留第 1 行导入须知、第 2 行蓝色表头、「版本号」sheet 与题型下拉校验。
  映射约定：判断题的「对 / 错」写进选项 A / B，正确答案写字母 A / B；
  选择题答案只写字母、不加分隔符；难度列留空（非必填，题库无此字段）。

## 常用命令

```bash
python src/build_bank.py      # 生成离线模拟考试工具 HTML
python src/verify_bank.py     # 题库一致性校验：母题库 ↔ 原始 Word 逐题比对（退出码 1 = 有答案级问题）
python src/verify_bank.py --refresh --excel 核对报告.xlsx   # 重抽原文并输出更正清单
python src/split_by_position.py            # 按岗位拆分 -> data/by_position/（考试宝导入模板格式）
python src/split_by_position.py --format plain   # 同上，但用母题库原始列结构
node src/_test_logic.js       # 组卷比例测试（6 岗位 × 10 次）
node src/debug/_sim_test.js   # 考试流程测试（62 项断言）
```

## 依赖

* Python 3 + openpyxl（`pip install openpyxl`）

* Node.js（仅运行测试脚本）

* pywin32（仅 `verify_bank.py` 抽取 Word 原文时需要；缺失时自动退化为「母题库自检」模式，
  校验缓存位于 `data/tmp/raw_dump.json`）


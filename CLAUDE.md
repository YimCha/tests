# CLAUDE.md

## 项目概述

银行上岗考试题库处理脚本：从母题库（Excel）生成离线模拟考试工具（单文件 HTML）。
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
```

## 关键约定

* 章节→岗位归属按章节名（`XX部A类` / `XX部B类` / `XX部C类`）自动推导，不在代码硬编码。

* 每个岗位 A/B/C 三类分值合计必须等于 80（`bank_loader.py` 会校验）。

* 题库规模：55 章节、1130 题（单选 452 / 多选 452 / 判断 226）。

* 岗位卷题量：560 / 610 / 595 / 595 / 595 / 595。

* 模拟考试：80 题、每题 1 分、总分 80；选项固定顺序（A–H 共 8 列）；判断题选项为「对 / 错」。

* 工具只含模拟考试功能，不含刷题 / 错题本 / 统计模块。

* 路径一律用相对路径（pathlib 或基于 `__file__`），禁止硬编码绝对路径。

* 修改 config.xlsx 后需重跑 `python src/build_bank.py` 使标题/页脚/文件名生效。

## 常用命令

```bash
python src/build_bank.py      # 生成离线模拟考试工具 HTML
node src/_test_logic.js       # 组卷比例测试（6 岗位 × 10 次）
node src/debug/_sim_test.js   # 考试流程测试（62 项断言）
```

## 依赖

* Python 3 + openpyxl（`pip install openpyxl`）

* Node.js（仅运行测试脚本）


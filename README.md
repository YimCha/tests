# 银行上岗考试题库处理脚本

将各部门原始题库（Word）解析为结构化数据，并按岗位 A/B/C 比例生成离线模拟考试工具。
**本仓库只含代码与空模板，题库数据与银行信息均不提交。**

## 设计原则

* **代码纯净**：代码中不含银行名称、部门、绝对路径等业务信息；标题/页脚/输出文件名等
  元数据全部从 `data/config.xlsx` 的「工具配置」sheet 读取。

* **数据不入库**：`data/` 目录（母题库、岗位配置、原始文档、成品 HTML）被 git 忽略，
  参与者用 `templates/` 下的空模板自行创建本地数据。

* **Excel 为唯一编辑入口**：题目在 `master_bank.xlsx`、岗位配置与元数据在 `config.xlsx`，
  代码不做硬编码。

## 数据架构

```
data/master_bank.xlsx（题目，唯一人工编辑入口）
data/config.xlsx（岗位配置 + 工具元数据，唯一人工编辑入口）
   │  src/bank_loader.py（直读两个 xlsx + 按章节名自动推导岗位归属，公共数据源）
   ▼
src/build_bank.py → 离线模拟考试工具 HTML（文件名来自 config 的「工具配置」）
```

不产生常驻的中间 JSON：所有下游脚本都通过 `bank_loader.py` 直接读取
`master_bank.xlsx`（题目）与 `config.xlsx`（岗位配置），母题库是唯一的"单点编辑入口"，
从源头避免中间产物过期不同步。

## config.xlsx 格式

**「岗位配置」sheet** 列：**岗位 | 类别(A/B/C) | 组 | 部门 | 分值**。

* A 类行：组、部门留空，分值填该岗位 A 类总分

* B/C 类行：每个部门一行；同组部门组号相同（表示共占比、组内混合抽题），
  分值填在组内首行、同组其余行留空

* 每个岗位 A/B/C 三类分值合计必须等于 80（`bank_loader.py` 会校验）

**「工具配置」sheet** 列：**键 | 值 | 说明**，键包括：

* `银行名称` / `工具标题` / `页脚第一行` / `页脚第二行` / `输出文件名`

* 修改后重跑 `python src/build_bank.py` 即生效

## 目录结构

```
src/                  # 代码（纯代码，无业务信息）
  bank_loader.py      # 直读 master_bank.xlsx + config.xlsx，组装 BANK 结构 + 岗位自动推导（公共数据源）
  build_bank.py       # master_bank.xlsx + config.xlsx -> 离线模拟考试工具 HTML
  template.html       # 工具模板（含 __BANK_DATA__ / __TOOL_TITLE__ / __FOOTER_*__ 占位符，无真实数据）
  _app_script.js      # 工具主逻辑 JS（与 template.html 同步）
  _test_logic.js      # 组卷比例验证脚本
  debug/
    _sim_test.js      # 考试流程模拟测试（含 JS 语法校验）
    _output.json      # build_bank.py 生成的成品文件名（测试脚本据此定位，git 忽略）

templates/            # 空模板（提交到仓库，供参与者了解格式）
  config_template.xlsx      # 岗位配置 + 工具配置 + 说明
  master_bank_template.xlsx # 母题库列格式 + 说明

data/                 # 题库数据（本地使用，git 忽略，从 templates/ 复制创建）
  master_bank.xlsx    # 母题库，题目唯一人工编辑入口
  config.xlsx         # 岗位配置 + 工具元数据，唯一人工编辑入口
  raw_bank/           # 各部门原始 .doc/.docx（终极真值）
  tmp/                # 临时中间产物
  output/             # 运行产物

刷题工具.html          # 生成的单文件离线工具（内嵌题库数据，git 忽略）
```

## 主流程

```bash
# 1) 首次使用：从 templates/ 复制空模板到 data/，按格式填入本地题库与配置
cp templates/config_template.xlsx      data/config.xlsx
cp templates/master_bank_template.xlsx data/master_bank.xlsx

# 2) 生成离线模拟考试工具（标题/页脚/输出文件名来自 config 的「工具配置」）
python src/build_bank.py

# 3) 验证
node src/_test_logic.js     # 组卷比例（6 岗位 × 10 次）
node src/debug/_sim_test.js # 考试流程（62 项断言）
```

## 依赖

* Python 3 + openpyxl（`pip install openpyxl`）

* Node.js（仅运行测试脚本）


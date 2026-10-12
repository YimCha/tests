# 银行上岗考试题库处理脚本

将各部门原始题库（Word）解析为结构化数据，并按岗位 A/B/C 比例生成离线模拟考试、刷题练习
与抽签工具（单文件 HTML）。
**本仓库只含代码与空模板，题库数据与银行信息均不提交。**

## 设计原则

* **代码纯净**：代码中不含银行名称、部门、绝对路径等业务信息；标题/页脚/输出文件名等
  元数据全部从 `data/config.xlsx` 的「工具配置」sheet 读取。

* **数据不入库**：`data/` 目录（母题库、岗位配置、原始文档、成品 HTML）被 git 忽略，
  参与者用 `templates/` 下的空模板自行创建本地数据。

* **Excel 为唯一编辑入口**：题目在 `master_bank.xlsx`、岗位配置与元数据在 `config.xlsx`，
  代码不做硬编码。

* **原始文档是终极真值**：`data/raw_bank/` 下各部门的原始 Word 优先级高于母题库。
  两者不一致时以原文为准，并跑 `src/bank_pipeline.py verify` 找出全部差异。

* **数据质量闸门**：`bank_loader.py` 会直接报错拦截「导入脚本静默截断」的指纹
  （答案为空、多选答案不足 2 个字母、答案字母越界、题干尾部残留答案字母），
  避免错误数据静默流入工具。

## 数据架构

```
data/raw_bank/**（各部门原始 Word）
   │  src/bank_pipeline.py（统一管线：Word COM 抽文本 → 解析 → 母题库初版，并与母题库逐题校验）
   ▼
data/master_bank.xlsx（题目，唯一人工编辑入口）
data/config.xlsx（岗位配置 + 工具元数据，唯一人工编辑入口）
   │  src/bank_loader.py（直读两个 xlsx + 按章节名自动推导岗位归属，公共数据源）
   ├─▶ src/build_bank.py → 离线模拟考试 + 刷题练习工具 HTML（文件名来自 config 的「工具配置」）
   └─▶ src/split_by_position.py → 各岗位考试宝导入表（data/by_position/）
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

## 抽签功能

工具首页右上角的独立入口，与岗位无关。流程：导入 Excel 名单 → 确认列映射 → 设定比例与取整方式
→ 逐个揭晓 → 导出结果。

* **名单导入**：支持 .xlsx，**零依赖本地解析**（ZIP 中央目录 + 浏览器原生 `DecompressionStream`
  + `DOMParser`），不联网、不引第三方解析库，工具体积不受影响。**不需要手动设置任何参数**：
  约定第一行是标题行、数据从第 2 行开始，按标题文字自动认出姓名列和工号列；认不出来会提示
  如何整理，并提供「下载名单模板」（模板 xlsx 同样在浏览器本地生成，不引库）。
  **姓名与工号都必填，工号必须唯一**——工号重复会让同一人的中签概率翻倍，所以会直接拦截并
  列出重复的工号；缺姓名或缺工号的行自动跳过。名单区展示全部人员，不做折叠。
  解析失败或遇到 .xls 老格式时可改用「粘贴」（从 Excel 复制后粘贴，两列姓名和工号即可）。

* **应抽人数** ＝ 总人数 × 百分比，取整方式可选向下 / 向上 / 四舍五入（`.5` 一律进位）。
  界面上实时显示算式（如 `200 × 30% = 60 → 抽 60 人`）。向上取整超过总人数时按全员计；
  向下取整得 0 时拦截抽签并提示，不静默改数。

* **抽取**：`crypto.getRandomValues` + 拒绝采样（消除模偏差）做无放回等概率抽取——名单顺序不影响
  结果，每人中签概率相同。界面显示名单编号，抽签前可记下，事后核对名单有无改动。

* **数据去向**：名单与参数只存本机浏览器 localStorage，不写回 HTML 文件，也不上传任何服务器。

* **导出**：复制为 TSV（可直接粘回 Excel）或下载 UTF-8 带 BOM 的 CSV（Excel 打开不乱码）。

## 目录结构

```
src/                  # 代码（纯代码，无业务信息）
  bank_loader.py      # 直读 master_bank.xlsx + config.xlsx，组装 BANK 结构 + 岗位自动推导（公共数据源）
  bank_pipeline.py    # 统一管线：raw_bank 原始 Word -> 母题库初版（import）/ 母题库 ↔ 原文逐题校验（verify）
  build_bank.py       # master_bank.xlsx + config.xlsx -> 离线模拟考试 + 刷题练习工具 HTML
  template.html       # 工具模板（含 __BANK_DATA__ / __APP_SCRIPT__ / 标题页脚等占位符，无真实数据）
  _app_script.js      # 工具主逻辑 JS（唯一真源，构建时由 build_bank.py 注入 template.html）
  _test_logic.js      # 组卷比例验证脚本
  split_by_position.py # 按岗位拆分母题库，默认套考试宝导入模板，输出 data/by_position/<岗位>.xlsx
  debug/
    _sim_test.js      # 考试与刷题流程模拟测试（含 JS 语法校验）
    _draw_test.js     # 抽签功能测试（最小 DOM shim 下加载真实工具代码，78 项断言）
    _mk_draw_sample.py    # 生成抽签测试数据（脏数据 / 重复工号 / 50 人人工测试名单）
    _browser_check.py # 生成浏览器自检页，配 Chrome headless --dump-dom 验证或截图
    _output.json      # build_bank.py 生成的成品文件名（测试脚本据此定位，git 忽略）

templates/            # 空模板（提交到仓库，供参与者了解格式）
  config_template.xlsx      # 岗位配置 + 工具配置 + 说明
  master_bank_template.xlsx # 母题库列格式 + 说明
  kaoshibaoExcel20221101.xlsx # 考试宝批量导入模板（岗位分表按它生成）

data/                 # 本地数据（含业务信息，git 忽略，从 templates/ 复制创建）
  master_bank.xlsx    # 母题库，题目唯一人工编辑入口
  config.xlsx         # 岗位配置 + 工具元数据，唯一人工编辑入口
  raw_bank/           # 各部门原始 .doc/.docx（终极真值）
  by_position/        # 按岗位拆分的考试宝导入表（每岗位一份 + 题量汇总）
  tmp/                # 中间缓存（Word 抽取结果、导入文本缓存），可删可重建

模拟考试工具.html      # 生成的单文件离线工具（内嵌题库数据，模拟考试 + 刷题练习，git 忽略）
```

## 主流程

```bash
# 1) 首次使用：从 templates/ 复制空模板到 data/，按格式填入本地题库与配置
cp templates/config_template.xlsx      data/config.xlsx
cp templates/master_bank_template.xlsx data/master_bank.xlsx

# 2) （可选）从各部门原始 Word 题库重新生成「母题库初版」（不覆盖 data/master_bank.xlsx）
python src/bank_pipeline.py import          # -> data/master_bank.imported.xlsx（供 verify 比对后人工合并）
python src/bank_pipeline.py import --refresh   # 强制重抽 Word 正文（默认用 data/tmp 缓存）

# 3) 生成离线模拟考试工具（标题/页脚/输出文件名来自 config 的「工具配置」）
python src/build_bank.py

# 4) 验证
node src/_test_logic.js     # 组卷比例（6 岗位 × 10 次）
node src/debug/_sim_test.js # 考试与刷题流程（93 项断言）
node src/debug/_draw_test.js # 抽签功能（69 项断言，需先跑 _mk_draw_sample.py 生成样本）
python src/bank_pipeline.py verify   # 题库一致性：母题库与 raw_bank 原文逐题比对（退出码 1 = 有答案级问题）

# 5) 按岗位拆分母题库（套考试宝导入模板）
python src/split_by_position.py   # -> data/by_position/<岗位名>.xlsx + 题量汇总.xlsx
```

## 依赖

* Python 3 + openpyxl（`pip install openpyxl`）

* Node.js（仅运行测试脚本）


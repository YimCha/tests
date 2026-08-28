# archive/ — 临时存档（模拟考试剥离）

这些脚本在专注模拟考试开发期间从 `src/` 移出保存，**功能未删除**。
`src/` 当前只保留模拟考试核心：`bank_loader.py` / `build_bank.py` / `template.html` /
`_app_script.js` / `_test_logic.js` 及 `debug/` 下的 `_sim_test.js`、`_syntax_check.js`。

## data_init/ — 数据初始化（Word 原始题库 → master_bank.xlsx / config.xlsx）
仅在原始题库 Word 更新时使用，日常开发不需要。

- `parse_a.py`       A 类题库文本 -> data/tmp/parsed.json
- `parse_bc.py`      B/C 类题库文本 -> data/tmp/bc_parsed.json
- `json2master.py`   parsed/bc JSON -> data/master_bank.xlsx 初版
- `write_config.py`  岗位配置种子 -> data/config.xlsx 初版（之后在 Excel 维护）
- `write_ps_bom.py`  以 UTF-8 BOM 写出 extract_bc.ps1
- `extract_bc.ps1`   用 Word COM 抽取 B/C 类题库为纯文本（write_ps_bom 的产物）

## output/ — 成果生成（考试宝导入，与刷题工具内模拟考试无关）
- `merge_excel.py`   master_bank.xlsx -> A 类合并 Excel（考试宝导入，模板 templates/kaoshibaoExcel20221101.xlsx）
- `gen_abc.py`       master_bank.xlsx -> 各岗位 ABC 类合集 Excel + 核对清单
  ※ 两个脚本都 `from bank_loader import ...`，bank_loader 在 `src/`：
  使用时把文件放回 `src/` 运行，或设 `PYTHONPATH` 指向 `src/`

## debug/ — 一次性调试脚本
`analyze_*` / `check_*` / `dbg*` / `inspect_*` / `spot_*` / `verify_*` / `summary.py` /
`dump_review.py` / `grep_over.py` / `preview_new_gs.py` / `review_bc_flags.py` / `_grep.py`
均为当时排查数据问题的临时脚本，一般不再需要；需要时按文件名语义直接运行。

## 恢复方式
需要某个脚本时，把对应文件移回 `src/` 即可。依赖 bank_loader 的脚本
（output/ 下两个）必须与 `src/bank_loader.py` 同目录运行。

# -*- coding: utf-8 -*-
"""生成抽签功能的测试名单样本（data/tmp/draw_sample.xlsx），仅供本地测试，不入库。

样本刻意包含真实场景里的脏数据：
  * 表头不在第 1 行
  * 姓名 / 工号 / 部门 三列（姓名列不是第一列）
  * 空行、完全重复行
  * 文本工号（前导零）
  * 第二个工作表（无关内容）
"""
import os
from openpyxl import Workbook

BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(BASE, 'data', 'tmp', 'draw_sample.xlsx')

wb = Workbook()

# 工作表 2：无关内容，用来验证多工作表切换
ws2 = wb.active
ws2.title = '说明'
ws2['A1'] = '本表为无关内容，不应被当作名单'

# 工作表 1：合规名单（第 1 行即标题），但混入空行、缺工号行、同名不同工号
ws = wb.create_sheet('抽签名单', 0)
ws['A1'], ws['B1'], ws['C1'] = '部门', '工号', '姓名'

groups = ['一组', '二组', '三组']
for i in range(1, 41):
    ws.cell(row=i + 1, column=1, value=groups[(i - 1) % 3])
    ws.cell(row=i + 1, column=2, value='%04d' % i).number_format = '@'   # 文本，保留前导零
    ws.cell(row=i + 1, column=3, value='员工%02d' % i)

ws.cell(row=41, column=3, value='员工01')      # 与第 2 行同名、工号不同 -> 属两个人，应保留
ws.cell(row=42, column=1, value=None)          # 空行，应被跳过
ws.cell(row=43, column=1, value='一组')        # 有姓名没工号，应被跳过
ws.cell(row=43, column=3, value='员工41')

os.makedirs(os.path.dirname(OUT), exist_ok=True)
wb.save(OUT)
print('生成 ->', OUT)
print('工作表:', wb.sheetnames)
print('名单表行数:', ws.max_row, '| 期望导入人数: 40（跳过空行与缺工号行、保留同名不同工号）')

# 第一行不是标题行：工具应给出「没认出姓名和工号列」并引导下载模板
BAD = os.path.join(BASE, 'data', 'tmp', 'draw_badtpl.xlsx')
wbad = Workbook()
sbad = wbad.active
sbad.title = '名单'
sbad.append(['2026 年度抽签名单（内部资料）'])
sbad.append(['部门', '工号', '姓名'])
sbad.append(['一组', '0001', '张三'])
wbad.save(BAD)
print('生成 ->', BAD, '| 第 1 行不是标题行，期望识别失败并提示下载模板')

# 工号重复的名单：工号是唯一标识，重复会让同一人的中签概率翻倍，必须拦截
DUP = os.path.join(BASE, 'data', 'tmp', 'draw_dup.xlsx')
wd = Workbook()
sd = wd.active
sd.title = '名单'
sd.append(['工号', '姓名'])
sd.append(['1001', '张三'])
sd.append(['1002', '李四'])
sd.append(['1001', '王五'])
wd.save(DUP)
print('生成 ->', DUP)
print('含重复工号 1001 | 期望被拦截')


# ---------------------------------------------------------------------------
# 人工测试名单：数据干净、可直接上手抽签。唯一的「小陷阱」是姓名不在第 1 列
# （第 1 列是序号），用来验证列映射的自动识别确实认的是列名而不是位置。
# ---------------------------------------------------------------------------
XING = ('王李张刘陈杨黄赵周吴徐孙马朱胡林郭何高罗郑梁谢宋唐许韩冯邓曹彭曾萧田董潘于蒋蔡余杜叶程苏'
        '魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦付方白邹孟熊秦邱江尹薛段雷侯龙史陶黎贺顾毛郝龚邵万钱严武戴莫孔向汤')
MING = ['海涛', '静怡', '伟民', '雅琴', '志强', '晓东', '丽娟', '鹏飞', '文婷', '建华',
        '梦琪', '立新', '晓峰', '慧敏', '国栋', '嘉怡', '永强', '雪梅', '俊杰', '文静',
        '凯旋', '思远', '春华', '佳琪', '建国', '雅静', '明辉', '小雪', '志刚', '丽华',
        '少华', '梦琳', '文博', '雨欣', '海燕', '俊豪', '晓琳', '伟东', '欣怡', '天成',
        '春燕', '志远', '雅雯', '明哲', '思彤', '海峰', '小雨', '国平', '静文', '子轩']
DEPTS = ['营业部', '客户部', '运营部', '科技部', '综合部']
MANUAL_SIZE = 200


def build_names(count):
    """姓与名错位取模组合：97 与 50 互质，200 组之内不会重名，且名字足够多样。"""
    return [XING[i % len(XING)] + MING[i % len(MING)] for i in range(count)]


def build_manual(path):
    """表头在首行、列序「序号 | 工号 | 姓名 | 部门」，工号为文本（保留前导零）。"""
    names = build_names(MANUAL_SIZE)
    w = Workbook()
    s = w.active
    s.title = '人员名单'
    s.append(['序号', '工号', '姓名', '部门'])
    for i, nm in enumerate(names, 1):
        s.append([i, '%04d' % i, nm, DEPTS[(i - 1) % len(DEPTS)]])
    for col, width in zip('ABCD', (8, 12, 14, 14)):
        s.column_dimensions[col].width = width
    s.freeze_panes = 'A2'
    w.save(path)
    return len(names)


MANUAL = os.path.join(BASE, 'data', 'tmp', '抽签测试名单.xlsx')
n = build_manual(MANUAL)
print('生成 ->', MANUAL)
print('人工测试名单: %d 人 | 表头首行、列序 序号|工号|姓名|部门' % n)
print('  建议试算: 30% -> 60 人 | 17.25% -> 34.5 人（三种取整会得到 34 / 35 / 35）')

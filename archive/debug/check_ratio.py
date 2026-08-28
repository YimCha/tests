# -*- coding: utf-8 -*-
import sys, io, json
from collections import defaultdict
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

bc = json.load(open(r'c:\Users\lenovo\Desktop\题库\data\tmp\bc_parsed.json', encoding='utf-8'))

def point(q):
    return 2 if q['sec_type'] == '多选题' else 1

# 按 部门+类 统计题数与分值
stat = defaultdict(lambda: [0, 0])  # (dept, cls) -> [题数, 分值]
for g in bc:
    dept = g['dept']
    cls = g['cls']
    for q in g['questions']:
        if not q.get('valid'):
            continue
        stat[(dept, cls)][0] += 1
        stat[(dept, cls)][1] += point(q)

depts = sorted({k[0] for k in stat})
print(f"{'部门':<12}{'B题数':>6}{'B分值':>6}{'C题数':>6}{'C分值':>6}{'合计分值':>8}")
for d in depts:
    b = stat.get((d, 'B'), [0, 0])
    c = stat.get((d, 'C'), [0, 0])
    print(f"{d:<12}{b[0]:>6}{b[1]:>6}{c[0]:>6}{c[1]:>6}{b[1]+c[1]:>8}")

# 岗位部门分值目标
PLAN = {
 '柜员岗': {'B': [('运营管理部',20),('数字金融部',20)],
            'C': [('运营管理部',5),('数字金融部',5)]},
 '客户经理岗': {'B': [('公司金融部+个人金融部',10),('风险管理部',10),('授信审批部',10),('普惠金融部+资金营运中心',10),('数字金融部',10)],
              'C': [('公司金融部+个人金融部+风险管理部+授信审批部+普惠金融部+资金营运中心+数字金融部',10)]},
 '运营管理岗': {'B': [('运营管理部',25),('计划财务部+数据管理部',25)],
              'C': [('运营管理部+计划财务部+数据管理部',10)]},
 '内控稽核岗': {'B': [('数据管理部',5),('运营管理部',20),('审计部',25)],
              'C': [('运营管理部+审计部',10)]},
 '科技岗': {'B': [('内控合规部',10),('科技部',30)],
          'C': [('安全保卫部+内控合规部+科技部',10)]},
 '行政管理岗': {'B': [('办公室',10),('人力资源部',10),('安全保卫部',10),('数据管理部',10),('内控合规部',10)],
              'C': [('办公室+人力资源部+安全保卫部+数据管理部+内控合规部',10)]},
}

def available(dept_names, cls):
    pts = 0
    for d in dept_names:
        pts += stat.get((d, cls), [0,0])[1]
    return pts

print('\n=== 各岗位部门目标 vs 可用分值 ===')
for pos, plan in PLAN.items():
    for cls in ['B', 'C']:
        for gname, target in plan[cls]:
            depts = [x for x in gname.split('+')]
            avail = available(depts, cls)
            flag = 'OK' if avail >= target else '!! 不足'
            print(f"  {pos} {cls}类 {gname}: 目标{target}分 / 可用{avail}分 {flag}")

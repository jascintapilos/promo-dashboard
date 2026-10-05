# -*- coding: utf-8 -*-
import sys, json
sys.path.insert(0, r"C:\Users\vdiuser\Downloads\promo-automation")
import csir_config
from datetime import date, timedelta
def q(sql): return csir_config.get_client().query(sql).result_rows
mx = q("SELECT max(SnapshotDate) FROM WORKSPACE.Daily_GMT8_Snapshot_A")[0][0]
if isinstance(mx,str): mx=date.fromisoformat(mx[:10])
end=mx.replace(day=1); start=end.replace(month=1, day=1)   # YTD: Jan 1 .. first of latest month (through last COMPLETE month)

sql = f"""
WITH u AS (
  SELECT SITE_edit AS b, Currency AS c, DepositAmount d, DepositBonusAmount db, FreeCreditAmount fc, FreeSpinAmount fs,
         BonusAmount bo, Rebates rb, NGR ngr, DepositAmount_usd du, BonusAmount_usd bou, Rebates_usd rbu, NGR_usd ngru
  FROM WORKSPACE.Daily_GMT8_Snapshot_A WHERE SnapshotDate>='{start}' AND SnapshotDate<'{end}'
  UNION ALL
  SELECT SITE_edit, Currency, DepositAmount, DepositBonusAmount, FreeCreditAmount, FreeSpinAmount,
         BonusAmount, Rebates, NGR, DepositAmount_usd, BonusAmount_usd, Rebates_usd, NGR_usd
  FROM WORKSPACE.Daily_GMT8_Snapshot_BC WHERE SnapshotDate>='{start}' AND SnapshotDate<'{end}'
)
SELECT b, c, round(sum(d)) d, round(sum(db)) db, round(sum(fc)) fc, round(sum(fs)) fs, round(sum(bo)) bo,
       round(sum(rb)) rb, round(sum(ngr)) ngr, sum(du) du, sum(bou) bou, sum(rbu) rbu, sum(ngru) ngru
FROM u GROUP BY b, c HAVING d>100000 ORDER BY c, d DESC
"""
rows = q(sql)
CURMAP={"MYR":"Malaysia","SGD":"Singapore","THB":"Thailand","IDR":"Indonesia","BDT":"Bangladesh","VND":"Vietnam","USD":"Cambodia"}
SYM={"MYR":"RM","SGD":"S$","THB":"\u0e3f","IDR":"Rp","BDT":"\u09f3","VND":"\u20ab","USD":"US$"}
regs={}; comp={"d":0,"bo":0,"rb":0,"ngr":0}
for b,c,d,db,fc,fs,bo,rb,ngr,du,bou,rbu,ngru in rows:
    d,db,fc,fs,bo,rb,ngr=map(lambda v: float(v or 0),(d,db,fc,fs,bo,rb,ngr))
    r=regs.setdefault(c,{"region":CURMAP.get(c,c),"cur":c,"sym":SYM.get(c,c+" "),"brands":[],"d":0,"db":0,"fc":0,"fs":0,"bo":0,"rb":0,"ngr":0})
    r["brands"].append({"b":b,"d":d,"db":db,"fc":fc,"fs":fs,"bo":bo,"rb":rb,"ngr":ngr,
                        "bon_pct":round(bo/d*100,1) if d else 0,"br_pct":round((bo+rb)/d*100,1) if d else 0,
                        "mg":round(ngr/d*100,1) if d else 0})
    for k,v in zip(("d","db","fc","fs","bo","rb","ngr"),(d,db,fc,fs,bo,rb,ngr)): r[k]+=v
    comp["d"]+=float(du or 0); comp["bo"]+=float(bou or 0); comp["rb"]+=float(rbu or 0); comp["ngr"]+=float(ngru or 0)
for r in regs.values():
    r["bon_pct"]=round(r["bo"]/r["d"]*100,1) if r["d"] else 0
    r["br_pct"]=round((r["bo"]+r["rb"])/r["d"]*100,1) if r["d"] else 0
    r["mg"]=round(r["ngr"]/r["d"]*100,1) if r["d"] else 0
company={"dep_usd":comp["d"],"bon_pct":round(comp["bo"]/comp["d"]*100,1) if comp["d"] else 0,
         "br_pct":round((comp["bo"]+comp["rb"])/comp["d"]*100,1) if comp["d"] else 0,
         "mg":round(comp["ngr"]/comp["d"]*100,1) if comp["d"] else 0}
out={"window_start":str(start),"window_end":str(end),"company":company,
     "regions":sorted(regs.values(),key=lambda r:-r["d"])}
json.dump(out,open(r"C:\Users\vdiuser\AppData\Local\Temp\claude\C--Users-vdiuser-Downloads-promo-automation\879d83be-432b-45e6-8ade-a793a2fe518e\scratchpad\macro_data.json","w"),indent=1)
print("window",start,"..",end)
print(f"COMPANY-WIDE (USD): Bonus% {company['bon_pct']}  Bonus+Rebate% {company['br_pct']}  NGR margin {company['mg']}  (dep US${company['dep_usd']/1e6:.1f}m)")
for r in out["regions"]:
    print(f"  {r['region']:<11} {len(r['brands'])}br  Bonus% {r['bon_pct']:>4}  B+R% {r['br_pct']:>4}  NGRmg {r['mg']:>5}")

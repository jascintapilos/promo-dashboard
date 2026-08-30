"""Task 4 helper — Lane-B CASHBACK context: prior-week loss + forward NGR for Weekly Rescue claimers (MY).

Per (cashback-code, member): pre_loss_ggr = house GGR off them in the 7 days BEFORE the claim (their
loss the cashback returns) + forward NGR 30/60/90d (NGR net of bonus -> did the cashback retain a
profitable player) + redeposit flag. Only the Lane-B codes -> tiny pull.

Out: scratchpad/vip/rescue-forward-MY.json = [{code,member,claim_date,pre_loss_ggr,fwd_ngr_30/60/90,redep_30}]
Usage: python bin/vip_report/01c_rescue_forward.py
"""
import sys, json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from csir_config import get_client, CURRENCY, SITE_EDIT, SUF

SCR = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad")
VIP = SCR / "vip"
START, END1 = "2026-01-01", "2026-08-26"
SNAP_LO, SNAP_HI = "2025-12-01", "2026-11-30"
STATUSES = "('Approved','Redeemed','Complete','Active','Completed','Low Balance 1','Low Balance 2')"

codes = json.load(open(VIP / f"vip-codes-{SUF}.json", encoding="utf-8"))
rescue = [r["code"] for r in codes if r["lane"] == "B-cashback"]
inlist = ",".join("'" + c.replace("'", "''") + "'" for c in rescue)

c = get_client(send_receive_timeout=300)
q = f"""
WITH per_cm AS (
    SELECT SITE, MEMBER_ID, BonusCode, min(toDate(BonusTime_gmt8)) AS claim_date
    FROM WORKSPACE.GetBonus_ABC
    WHERE SITE_edit='{SITE_EDIT}' AND Currency='{CURRENCY}' AND BonusAmount>0 AND BonusStatus IN {STATUSES}
      AND BonusTime_gmt8 >= '{START} 00:00:00' AND BonusTime_gmt8 < '{END1} 00:00:00'
      AND BonusCode IN ({inlist})
    GROUP BY SITE, MEMBER_ID, BonusCode
),
snap AS (
    SELECT SITE AS ss, MEMBER_ID AS sm, SnapshotDate AS sd, DepositAmount AS dep, NGR AS ngr, GGR AS ggr
    FROM WORKSPACE.Daily_GMT8_Snapshot_A
    WHERE Currency='{CURRENCY}' AND (DepositAmount>0 OR NGR!=0 OR GGR!=0) AND SnapshotDate >= '{SNAP_LO}' AND SnapshotDate < '{SNAP_HI}'
    UNION ALL
    SELECT SITE, MEMBER_ID, SnapshotDate, DepositAmount, NGR, GGR
    FROM WORKSPACE.Daily_GMT8_Snapshot_BC
    WHERE Currency='{CURRENCY}' AND (DepositAmount>0 OR NGR!=0 OR GGR!=0) AND SnapshotDate >= '{SNAP_LO}' AND SnapshotDate < '{SNAP_HI}'
)
SELECT p.MEMBER_ID AS MEMBER_ID, p.BonusCode AS BonusCode, p.claim_date AS claim_date,
    sumIf(ifNull(s.ggr,0), w.off < 0) AS pre_loss_ggr,
    sumIf(ifNull(s.ngr,0), w.off >= 0 AND w.off < 30) AS fwd_ngr_30,
    sumIf(ifNull(s.ngr,0), w.off >= 0 AND w.off < 60) AS fwd_ngr_60,
    sumIf(ifNull(s.ngr,0), w.off >= 0 AND w.off < 90) AS fwd_ngr_90,
    sum(if(ifNull(s.dep,0)>0 AND w.off>=1 AND w.off<30,1,0)) AS redep_30
FROM per_cm p
CROSS JOIN (SELECT toInt32(number) - 7 AS off FROM numbers(97)) w
LEFT JOIN snap s ON p.SITE=s.ss AND p.MEMBER_ID=s.sm AND addDays(p.claim_date, w.off)=s.sd
GROUP BY p.MEMBER_ID, p.BonusCode, p.claim_date
"""
res = c.query(q, settings={"max_execution_time": 290, "max_memory_usage": 40000000000})
out = []
for row in res.result_rows:
    d = dict(zip(res.column_names, row))
    out.append({"code": d["BonusCode"].strip(), "member": str(d["MEMBER_ID"]), "claim_date": str(d["claim_date"]),
                "pre_loss_ggr": round(float(d["pre_loss_ggr"])),
                "fwd_ngr_30": round(float(d["fwd_ngr_30"])), "fwd_ngr_60": round(float(d["fwd_ngr_60"])),
                "fwd_ngr_90": round(float(d["fwd_ngr_90"])), "redep_30": int(d["redep_30"])})
json.dump(out, open(VIP / f"rescue-forward-{SUF}.json", "w", encoding="utf-8"), default=str)

n = len(out)
losing = sum(1 for r in out if r["pre_loss_ggr"] > 0)     # house-positive GGR before = player lost
redep = sum(1 for r in out if r["redep_30"] >= 1)
f30 = sum(r["fwd_ngr_30"] for r in out); f90 = sum(r["fwd_ngr_90"] for r in out); loss = sum(r["pre_loss_ggr"] for r in out)
print(f"cashback claim rows: {n:,} (Lane-B) | were LOSING in prior 7d: {losing:,} ({losing/n*100:.0f}%) | kept playing (redep 30d): {redep/n*100:.0f}%")
print(f"  Sigma prior loss (house GGR) RM{loss:,} | Sigma forward NGR 30d RM{f30:,} / 90d RM{f90:,}")
print("Saved scratchpad/vip/rescue-forward-MY.json")

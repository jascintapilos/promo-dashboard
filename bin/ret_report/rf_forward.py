"""Forward-outcome pull for RETENTION codes (grain A: per code x member). See forward-pull-spec.md.

Same window technique as bin/vip_report/01d_forward_outcomes.py, over the retention code universe
(ret-codes-MY.json). Gives the retention incrementality a forward-NGR own-baseline: forward NGR 30/60/90d
(net of bonus, claim day included) + matched pre-claim NGR baseline + maturity flags, per code x member.

Out: scratchpad/ret/forward-outcomes-MY.json
Usage: python bin/ret_report/rf_forward.py
"""
import sys, json
from pathlib import Path
from datetime import date, timedelta

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from csir_config import get_client, CURRENCY, SITE_EDIT, SUF, START, END_EXCL, AS_OF_DATE, snap_lo, snap_hi

SCR = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad")
RET = SCR / "ret"
END1 = END_EXCL                              # from csir_config date seam (START also imported)
SNAP_LO, SNAP_HI = snap_lo(92), snap_hi(96)  # generous over-fetch: covers pre-window + forward-90
AS_OF = AS_OF_DATE                            # maturity reference (= data_as_of)
STATUSES = "('Approved','Redeemed','Complete','Active','Completed','Low Balance 1','Low Balance 2')"

codes = [c["code"] for c in json.load(open(RET / f"ret-codes-{SUF}.json", encoding="utf-8"))]
inlist = ",".join("'" + c.replace("'", "''") + "'" for c in codes)

q = f"""
WITH per_cm AS (
    SELECT SITE, MEMBER_ID, BonusCode,
           min(toDate(BonusTime_gmt8)) AS claim_date,
           sum(BonusAmount)            AS bonus_amount,
           count()                     AS claims
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
    p.bonus_amount AS bonus_amount, p.claims AS claims,
    sumIf(ifNull(s.ngr,0), w.off >= -30 AND w.off < 0) AS pre_ngr_30,
    sumIf(ifNull(s.ngr,0), w.off >= -60 AND w.off < 0) AS pre_ngr_60,
    sumIf(ifNull(s.ngr,0), w.off >= -90 AND w.off < 0) AS pre_ngr_90,
    sumIf(ifNull(s.ngr,0), w.off >= 0 AND w.off < 30) AS fwd_ngr_30,
    sumIf(ifNull(s.ngr,0), w.off >= 0 AND w.off < 60) AS fwd_ngr_60,
    sumIf(ifNull(s.ngr,0), w.off >= 0 AND w.off < 90) AS fwd_ngr_90
FROM per_cm p
CROSS JOIN (SELECT toInt32(number) - 90 AS off FROM numbers(180)) w
LEFT JOIN snap s ON p.SITE=s.ss AND p.MEMBER_ID=s.sm AND addDays(p.claim_date, w.off)=s.sd
GROUP BY p.MEMBER_ID, p.BonusCode, p.claim_date, p.bonus_amount, p.claims
"""

def maturity(cd):
    d = date(*map(int, str(cd)[:10].split("-")))
    return {"mature_30": d <= AS_OF - timedelta(days=30),
            "mature_60": d <= AS_OF - timedelta(days=60),
            "mature_90": d <= AS_OF - timedelta(days=90)}

c = get_client(send_receive_timeout=300)
res = c.query(q, settings={"max_execution_time": 290, "max_memory_usage": 40000000000})
intf = ("pre_ngr_30", "pre_ngr_60", "pre_ngr_90", "fwd_ngr_30", "fwd_ngr_60", "fwd_ngr_90")
out = []
for row in res.result_rows:
    d = dict(zip(res.column_names, row))
    rec = {"code": d["BonusCode"].strip(), "member": str(d["MEMBER_ID"]), "claim_date": str(d["claim_date"]),
           "bonus_amount": round(float(d["bonus_amount"])), "claims": int(d["claims"])}
    for k in intf:
        rec[k] = round(float(d[k]))
    rec.update(maturity(d["claim_date"]))
    out.append(rec)
json.dump(out, open(RET / f"forward-outcomes-{SUF}.json", "w", encoding="utf-8"), default=str)

m90 = sum(1 for r in out if r["mature_90"])
f90 = sum(r["fwd_ngr_90"] for r in out if r["mature_90"])
print(f"ret forward-outcomes: {len(out):,} code x member rows | mature_90 {m90:,} | Sigma fwd_ngr_90 (mature) RM{f90:,}")
print("Saved scratchpad/ret/forward-outcomes-MY.json")

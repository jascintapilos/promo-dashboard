"""Phase 1.1 — treated players' EARLIER pre-window NGR (day -180..-90) for the pre-trend match (MY).

The forward pulls gave treated pre_ngr_90 (day -90..0) and fwd (0..90) but not the earlier -180..-90
window. Phase 1.1 matches treated to controls on their pre-TREND (pre_90 - pre_pre_90), not just the
pre level, so the two groups have parallel trajectories BEFORE the claim — the validity condition for
the difference-in-differences. Same anchor grain as the forward pulls (per member x code, first claim).

Out: scratchpad/attribution/treated-pretrend-MY.json = [{code, member, claim_date, pre_pre_90}]
Usage: python bin/attribution/phase1_treated_pretrend.py
"""
import sys, json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from csir_config import get_client, START, END_EXCL

SCR = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad")
OUT = SCR / "attribution"
END1 = END_EXCL   # from csir_config date seam (START also imported)
SNAP_LO, SNAP_HI = "2025-06-01", "2026-09-01"
STATUSES = "('Approved','Redeemed','Complete','Active','Completed','Low Balance 1','Low Balance 2')"

ret_codes = [c["code"] for c in json.load(open(SCR / "ret/ret-codes-MY.json", encoding="utf-8"))]
vip = json.load(open(SCR / "vip/vip-codes-MY.json", encoding="utf-8"))
vip_ab = [c["code"] for c in vip if c.get("lane") in ("A-performance", "B-cashback")]
codes = sorted(set(ret_codes) | set(vip_ab))
inlist = ",".join("'" + c.replace("'", "''") + "'" for c in codes)

q = f"""
WITH per_cm AS (
    SELECT SITE, MEMBER_ID, BonusCode, min(toDate(BonusTime_gmt8)) AS claim_date
    FROM WORKSPACE.GetBonus_ABC
    WHERE SITE_edit='WS1' AND Currency='MYR' AND BonusAmount>0 AND BonusStatus IN {STATUSES}
      AND BonusTime_gmt8 >= '{START} 00:00:00' AND BonusTime_gmt8 < '{END1} 00:00:00'
      AND BonusCode IN ({inlist})
    GROUP BY SITE, MEMBER_ID, BonusCode
),
snap AS (
    SELECT SITE AS ss, MEMBER_ID AS sm, SnapshotDate AS sd, NGR AS ngr
    FROM WORKSPACE.Daily_GMT8_Snapshot_A
    WHERE Currency='MYR' AND NGR!=0 AND SnapshotDate >= '{SNAP_LO}' AND SnapshotDate < '{SNAP_HI}'
    UNION ALL
    SELECT SITE, MEMBER_ID, SnapshotDate, NGR
    FROM WORKSPACE.Daily_GMT8_Snapshot_BC
    WHERE Currency='MYR' AND NGR!=0 AND SnapshotDate >= '{SNAP_LO}' AND SnapshotDate < '{SNAP_HI}'
)
SELECT p.MEMBER_ID AS MEMBER_ID, p.BonusCode AS BonusCode, p.claim_date AS claim_date,
    sumIf(ifNull(s.ngr,0), w.off >= -180 AND w.off < -90) AS pre_pre_90
FROM per_cm p
CROSS JOIN (SELECT toInt32(number) - 180 AS off FROM numbers(90)) w
LEFT JOIN snap s ON p.SITE=s.ss AND p.MEMBER_ID=s.sm AND addDays(p.claim_date, w.off)=s.sd
GROUP BY p.MEMBER_ID, p.BonusCode, p.claim_date
"""

c = get_client(send_receive_timeout=300)
res = c.query(q, settings={"max_execution_time": 290, "max_memory_usage": 40000000000})
out = []
for row in res.result_rows:
    d = dict(zip(res.column_names, row))
    out.append({"code": d["BonusCode"].strip(), "member": str(d["MEMBER_ID"]),
                "claim_date": str(d["claim_date"]), "pre_pre_90": round(float(d["pre_pre_90"]))})
json.dump(out, open(OUT / "treated-pretrend-MY.json", "w", encoding="utf-8"), default=str)
print(f"treated pre-trend: {len(out):,} (code,member) rows over {len(codes)} codes")
print("Saved scratchpad/attribution/treated-pretrend-MY.json")

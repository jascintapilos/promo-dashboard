"""Validation layer 1 — forward-outcome pull for ALL VIP lanes (MY). See forward-pull-spec.md.

Generalises 01c_rescue_forward.py (Lane-B only) to the whole VIP bonus universe, at two grains:
  A. per (member, code)  -> scratchpad/vip/forward-outcomes-MY.json         (lanes A+B; feeds 02 per-code cards)
  B. per  member         -> scratchpad/vip/forward-outcomes-member-MY.json  (all lanes; feeds whale_detection)
Each row: matched pre-claim baseline (day -30/-60/-90) + forward NGR/deposits 30/60/90 (NGR already net of
bonus; claim day included) + redeposit flags + maturity flags vs data_as_of.

Grain B must NOT be summed from grain A: a member with overlapping code windows would double-count calendar-day
NGR. Grain B anchors at the member's first VIP claim and counts each day once.

Usage: python bin/vip_report/01d_forward_outcomes.py
"""
import sys, json
from pathlib import Path
from datetime import date, timedelta

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from csir_config import get_client

SCR = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad")
VIP = SCR / "vip"
START, END1 = "2026-01-01", "2026-08-26"
SNAP_LO, SNAP_HI = "2025-10-01", "2026-11-30"      # LO covers pre-90 of earliest claim; HI covers fwd-90 of last
AS_OF = date(2026, 8, 26)                            # maturity reference (report data_as_of)
STATUSES = "('Approved','Redeemed','Complete','Active','Completed','Low Balance 1','Low Balance 2')"

codes = json.load(open(VIP / "vip-codes-MY.json", encoding="utf-8"))
all_codes = [c["code"] for c in codes]
ab_codes = [c["code"] for c in codes if c.get("lane") in ("A-performance", "B-cashback")]


def q_inlist(cs):
    return ",".join("'" + c.replace("'", "''") + "'" for c in cs)


def build_query(per_code, inlist):
    """per_code=True -> grain A (group by member,code). False -> grain B (group by member)."""
    sel_code = ", BonusCode" if per_code else ""            # leading-comma fragments: safe when empty
    out_sel_code = ", p.BonusCode AS BonusCode" if per_code else ""
    out_grp_code = ", p.BonusCode" if per_code else ""
    return f"""
WITH per_cm AS (
    SELECT SITE, MEMBER_ID{sel_code},
           min(toDate(BonusTime_gmt8)) AS claim_date,
           sum(BonusAmount)            AS bonus_amount,
           count()                     AS claims
    FROM WORKSPACE.GetBonus_ABC
    WHERE SITE_edit='WS1' AND Currency='MYR' AND BonusAmount>0 AND BonusStatus IN {STATUSES}
      AND BonusTime_gmt8 >= '{START} 00:00:00' AND BonusTime_gmt8 < '{END1} 00:00:00'
      AND BonusCode IN ({inlist})
    GROUP BY SITE, MEMBER_ID{sel_code}
),
snap AS (
    SELECT SITE AS ss, MEMBER_ID AS sm, SnapshotDate AS sd, DepositAmount AS dep, NGR AS ngr, GGR AS ggr
    FROM WORKSPACE.Daily_GMT8_Snapshot_A
    WHERE Currency='MYR' AND (DepositAmount>0 OR NGR!=0 OR GGR!=0) AND SnapshotDate >= '{SNAP_LO}' AND SnapshotDate < '{SNAP_HI}'
    UNION ALL
    SELECT SITE, MEMBER_ID, SnapshotDate, DepositAmount, NGR, GGR
    FROM WORKSPACE.Daily_GMT8_Snapshot_BC
    WHERE Currency='MYR' AND (DepositAmount>0 OR NGR!=0 OR GGR!=0) AND SnapshotDate >= '{SNAP_LO}' AND SnapshotDate < '{SNAP_HI}'
)
SELECT
    p.MEMBER_ID AS MEMBER_ID{out_sel_code},
    p.claim_date AS claim_date, p.bonus_amount AS bonus_amount, p.claims AS claims,
    sumIf(ifNull(s.ngr,0), w.off >= -30 AND w.off < 0) AS pre_ngr_30,
    sumIf(ifNull(s.ngr,0), w.off >= -60 AND w.off < 0) AS pre_ngr_60,
    sumIf(ifNull(s.ngr,0), w.off >= -90 AND w.off < 0) AS pre_ngr_90,
    sumIf(ifNull(s.dep,0), w.off >= -30 AND w.off < 0) AS pre_dep_30,
    sumIf(ifNull(s.dep,0), w.off >= -60 AND w.off < 0) AS pre_dep_60,
    sumIf(ifNull(s.dep,0), w.off >= -90 AND w.off < 0) AS pre_dep_90,
    sumIf(ifNull(s.ggr,0), w.off >= -7  AND w.off < 0) AS pre_loss_ggr,
    sumIf(ifNull(s.ngr,0), w.off >= 0 AND w.off < 30) AS fwd_ngr_30,
    sumIf(ifNull(s.ngr,0), w.off >= 0 AND w.off < 60) AS fwd_ngr_60,
    sumIf(ifNull(s.ngr,0), w.off >= 0 AND w.off < 90) AS fwd_ngr_90,
    sumIf(ifNull(s.dep,0), w.off >= 0 AND w.off < 30) AS fwd_dep_30,
    sumIf(ifNull(s.dep,0), w.off >= 0 AND w.off < 60) AS fwd_dep_60,
    sumIf(ifNull(s.dep,0), w.off >= 0 AND w.off < 90) AS fwd_dep_90,
    sum(if(ifNull(s.dep,0) > 0 AND w.off >= 1 AND w.off < 30, 1, 0)) AS redep_days_30,
    max(if(ifNull(s.dep,0) > 0 AND w.off >= 1 AND w.off < 60, 1, 0)) AS redep_60,
    max(if(ifNull(s.dep,0) > 0 AND w.off >= 1 AND w.off < 90, 1, 0)) AS redep_90
FROM per_cm p
CROSS JOIN (SELECT toInt32(number) - 90 AS off FROM numbers(180)) w
LEFT JOIN snap s ON p.SITE=s.ss AND p.MEMBER_ID=s.sm AND addDays(p.claim_date, w.off)=s.sd
GROUP BY p.MEMBER_ID{out_grp_code}, p.claim_date, p.bonus_amount, p.claims
"""


def maturity(claim_date):
    cd = claim_date if isinstance(claim_date, date) else date(*map(int, str(claim_date)[:10].split("-")))
    return {"mature_30": cd <= AS_OF - timedelta(days=30),
            "mature_60": cd <= AS_OF - timedelta(days=60),
            "mature_90": cd <= AS_OF - timedelta(days=90)}


def run(client, per_code, inlist, label):
    res = client.query(build_query(per_code, inlist),
                       settings={"max_execution_time": 290, "max_memory_usage": 40000000000})
    intf = ("pre_ngr_30", "pre_ngr_60", "pre_ngr_90", "pre_dep_30", "pre_dep_60", "pre_dep_90", "pre_loss_ggr",
            "fwd_ngr_30", "fwd_ngr_60", "fwd_ngr_90", "fwd_dep_30", "fwd_dep_60", "fwd_dep_90")
    out = []
    for row in res.result_rows:
        d = dict(zip(res.column_names, row))
        rec = {"member": str(d["MEMBER_ID"]), "claim_date": str(d["claim_date"]),
               "bonus_amount": round(float(d["bonus_amount"])), "claims": int(d["claims"])}
        if per_code:
            rec["code"] = d["BonusCode"].strip()
        for k in intf:
            rec[k] = round(float(d[k]))
        rec["redep_days_30"] = int(d["redep_days_30"])
        rec["redep_60"] = int(d["redep_60"])
        rec["redep_90"] = int(d["redep_90"])
        rec.update(maturity(d["claim_date"]))
        out.append(rec)
    f30 = sum(r["fwd_ngr_90"] for r in out if r["mature_90"])
    m90 = sum(1 for r in out if r["mature_90"])
    print(f"[{label}] rows: {len(out):,} | mature_90: {m90:,} | Sigma fwd_ngr_90 (mature) RM{f30:,}")
    return out


c = get_client(send_receive_timeout=300)

# Grain B — per member, ALL lanes (the whale universe)
gb = run(c, False, q_inlist(all_codes), "grain B / per-member / all lanes")
json.dump(gb, open(VIP / "forward-outcomes-member-MY.json", "w", encoding="utf-8"), default=str)

# Grain A — per (member, code), forward-graded lanes A+B
ga = run(c, True, q_inlist(ab_codes), "grain A / per-member-code / lanes A+B")
json.dump(ga, open(VIP / "forward-outcomes-MY.json", "w", encoding="utf-8"), default=str)

# ---- QC: Lane-B subset of grain A reconciles to the old rescue-forward-MY.json ----
try:
    old = json.load(open(VIP / "rescue-forward-MY.json", encoding="utf-8"))
    oldmap = {(r["code"], r["member"]): r for r in old}
    newmap = {(r["code"], r["member"]): r for r in ga if (r["code"], r["member"]) in oldmap}
    diffs = 0
    for k, o in oldmap.items():
        n = newmap.get(k)
        if not n:
            diffs += 1; continue
        for fld in ("fwd_ngr_30", "fwd_ngr_60", "fwd_ngr_90", "pre_loss_ggr"):
            if abs(o.get(fld, 0) - n.get(fld, 0)) > 1:
                diffs += 1; break
    print(f"[QC] Lane-B reconcile vs rescue-forward: {len(oldmap):,} pairs, {diffs} mismatches "
          f"({'PASS' if diffs == 0 else 'CHECK'})")
except FileNotFoundError:
    print("[QC] rescue-forward-MY.json not found — skipped reconcile")

print("Saved forward-outcomes-member-MY.json (grain B) + forward-outcomes-MY.json (grain A)")

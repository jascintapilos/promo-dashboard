"""Task 3 — per-member YTD ledger for VIP claimers (MY) — the program-wide grain.

For every member who claimed any VIP code, over 2026-01-01..2026-08-25:
  vip_bonus   = Sigma redeemed VIP bonus RM across ALL 383 codes
  vip_claims  = # VIP claims ; rescue_claims = # Lane-B (win-back) claims  (recidivism)
  ytd_ngr     = Sigma daily NGR (NET of bonus — do NOT subtract bonus again)
  ytd_ggr     = Sigma daily GGR (gross house win — for give-to-take)
  dep_h1/h2   = deposits Jan-Apr vs May-Aug  (deposit-slope / value-at-risk)
  tier_start  = tier ASOF 2026-01-01 ; tier_end = tier ASOF 2026-08-25  (migration)

Member-level -> scratchpad only.
Out: scratchpad/vip/member-ledger-MY.json
Usage: python bin/vip_report/01b_ledger.py
"""
import sys, json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from csir_config import get_client

SCR = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad")
VIP = SCR / "vip"
START, END1 = "2026-01-01", "2026-08-26"     # [start, end) -> 2026-08-25 inclusive
MID = "2026-05-01"                            # H1 (Jan-Apr) vs H2 (May-Aug) split for deposit slope
LOGSITE = "WS1_MYS_MYR"
STATUSES = "('Approved','Redeemed','Complete','Active','Completed','Low Balance 1','Low Balance 2')"

codes = json.load(open(VIP / "vip-codes-MY.json", encoding="utf-8"))
all_inlist = ",".join("'" + r["code"].replace("'", "''") + "'" for r in codes)
rescue_inlist = ",".join("'" + r["code"].replace("'", "''") + "'" for r in codes if r["lane"] == "B-cashback")

c = get_client(send_receive_timeout=400)
SET = {"readonly": 1, "max_execution_time": 390, "max_memory_usage": 50000000000, "max_result_rows": 500000}
CLAIMERS = f"""SELECT DISTINCT MEMBER_ID FROM WORKSPACE.GetBonus_ABC
  WHERE SITE_edit='WS1' AND Currency='MYR' AND BonusAmount>0 AND BonusStatus IN {STATUSES}
    AND BonusTime_gmt8 >= '{START} 00:00:00' AND BonusTime_gmt8 < '{END1} 00:00:00'
    AND BonusCode IN ({all_inlist})"""

# ---- Q1: per-member bonus + claims + rescue count ----
q1 = f"""
SELECT MEMBER_ID, sum(BonusAmount) AS vip_bonus, count() AS vip_claims,
       countIf(BonusCode IN ({rescue_inlist})) AS rescue_claims
FROM WORKSPACE.GetBonus_ABC
WHERE SITE_edit='WS1' AND Currency='MYR' AND BonusAmount>0 AND BonusStatus IN {STATUSES}
  AND BonusTime_gmt8 >= '{START} 00:00:00' AND BonusTime_gmt8 < '{END1} 00:00:00'
  AND BonusCode IN ({all_inlist})
GROUP BY MEMBER_ID
"""
print("Q1: per-member VIP bonus + rescue count...")
led = {}
for mid, bonus, cl, resc in c.query(q1, settings=SET).result_rows:
    led[str(mid)] = {"member": str(mid), "vip_bonus": round(float(bonus)), "vip_claims": int(cl),
                     "rescue_claims": int(resc), "ytd_ngr": 0.0, "ytd_ggr": 0.0, "dep_h1": 0.0, "dep_h2": 0.0,
                     "tier_start": "Unknown", "tier_end": "Unknown"}
print(f"  members: {len(led):,}")

# ---- Q2: per-member YTD NGR/GGR + deposit halves ----
q2 = f"""
WITH mem AS ({CLAIMERS})
SELECT MEMBER_ID, sum(ngr) AS ytd_ngr, sum(ggr) AS ytd_ggr,
       sumIf(dep, sd < '{MID}') AS dep_h1, sumIf(dep, sd >= '{MID}') AS dep_h2
FROM (
    SELECT MEMBER_ID, SnapshotDate AS sd, DepositAmount AS dep, GGR AS ggr, NGR AS ngr
    FROM WORKSPACE.Daily_GMT8_Snapshot_A
    WHERE Currency='MYR' AND SnapshotDate >= '{START}' AND SnapshotDate < '{END1}' AND MEMBER_ID IN (SELECT MEMBER_ID FROM mem)
    UNION ALL
    SELECT MEMBER_ID, SnapshotDate, DepositAmount, GGR, NGR
    FROM WORKSPACE.Daily_GMT8_Snapshot_BC
    WHERE Currency='MYR' AND SnapshotDate >= '{START}' AND SnapshotDate < '{END1}' AND MEMBER_ID IN (SELECT MEMBER_ID FROM mem)
)
GROUP BY MEMBER_ID
"""
print("Q2: per-member YTD NGR/GGR + deposit halves...")
for mid, ngr, ggr, h1, h2 in c.query(q2, settings=SET).result_rows:
    d = led.get(str(mid))
    if d: d["ytd_ngr"] = round(float(ngr)); d["ytd_ggr"] = round(float(ggr)); d["dep_h1"] = round(float(h1)); d["dep_h2"] = round(float(h2))

# ---- Q3/Q4: tier at start + end (ASOF) ----
def tier_asof(dt):
    # ASOF needs the inequality against a LEFT-table column, so carry the as-of date as a column
    q = f"""
    WITH mem AS (SELECT MEMBER_ID, toDateTime('{dt}') AS asof_dt FROM ({CLAIMERS}))
    SELECT mem.MEMBER_ID AS MEMBER_ID, ifNull(t.tier,'Unknown') AS tier
    FROM mem
    ASOF LEFT JOIN (SELECT MEMBER_ID, (TIME + INTERVAL 8 HOUR) AS tdt, NewMembershipName AS tier
                    FROM WORKSPACE.dedup_PlayerMembershipLog_A WHERE SITE='{LOGSITE}' AND NewMembershipName!='') t
      ON mem.MEMBER_ID=t.MEMBER_ID AND mem.asof_dt >= t.tdt
    """
    return {str(mid): tier for mid, tier in c.query(q, settings=SET).result_rows}
print("Q3: tier at start (2026-01-01)...")
ts = tier_asof("2026-01-01 00:00:00")
print("Q4: tier at end (2026-08-25)...")
te = tier_asof("2026-08-25 23:59:59")
for mid, d in led.items():
    d["tier_start"] = ts.get(mid, "Unknown"); d["tier_end"] = te.get(mid, "Unknown")

out = list(led.values())
json.dump(out, open(VIP / "member-ledger-MY.json", "w", encoding="utf-8"), default=str)

# ---- verify ----
tot_bonus = sum(d["vip_bonus"] for d in out)
tot_ngr = sum(d["ytd_ngr"] for d in out)
tot_ggr = sum(d["ytd_ggr"] for d in out)
neg = [d for d in out if d["ytd_ngr"] < 0]                       # net-negative (house lost, all-in)
neg_bonus = sum(d["vip_bonus"] for d in neg)
underwater = [d for d in out if d["ytd_ggr"] > 0 and d["vip_bonus"] > d["ytd_ggr"]]  # gave more than gross win
ngr_sorted = sorted((d["ytd_ngr"] for d in out), reverse=True)
top1 = sum(ngr_sorted[:max(1, len(out) // 100)]); top10 = sum(ngr_sorted[:max(1, len(out) // 10)])
pos_ngr = sum(v for v in ngr_sorted if v > 0)
recid = [d for d in out if d["rescue_claims"] >= 2]
print(f"\nmembers: {len(out):,} | Sigma VIP bonus RM{tot_bonus:,} (reconciles to RM8.46M) | Sigma YTD NGR RM{tot_ngr:,} | Sigma YTD GGR RM{tot_ggr:,}")
print(f"  NET-NEGATIVE VIPs (YTD NGR<0): {len(neg):,} ({len(neg)/len(out)*100:.0f}%) — RM{neg_bonus:,} of bonus flows to them ({neg_bonus/tot_bonus*100:.0f}% of spend)")
print(f"  underwater (bonus > YTD GGR): {len(underwater):,} ({len(underwater)/len(out)*100:.0f}%)")
print(f"  whale concentration: top 1% of players = {top1/pos_ngr*100:.0f}% of positive NGR | top 10% = {top10/pos_ngr*100:.0f}%")
print(f"  rescue recidivists (>=2 rescues): {len(recid):,} — RM{sum(d['vip_bonus'] for d in recid):,} bonus")
print("Saved scratchpad/vip/member-ledger-MY.json")

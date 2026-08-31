"""Acquisition LTV by source — which welcome mechanic brings high-lifetime players.

Splits the join-year cohorts by the MECHANIC of each player's FIRST bonus (FreeCredit /
FreeSpin / DepositBonus welcome, or Organic = no bonus), then follows each group's
cumulative net revenue per member over years. Answers "does a free-credit welcome acquire
keepers vs a free-spin welcome?" — a real acquisition-strategy question, buildable over the
full history (the mechanics persist even though individual codes change).

Uses mature cohorts only (first deposit MIN_YEAR..MAX_MATURE) so every group has a full
multi-year curve. Whole-book value (not attributed to a specific code); aggregated in
ClickHouse — no member data saved.

Out: scratchpad/ltv/ltv-by-source-{SUF}.json
Run: python bin/ltv_report/ltv_by_source.py        (PROMO_MARKET=SG for Singapore)
"""
import sys, json, os
from pathlib import Path
from collections import defaultdict

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from csir_config import get_client, CURRENCY, SITE_EDIT, SUF, SYMBOL, MARKET

SCR = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad")
OUT = SCR / "ltv"; OUT.mkdir(parents=True, exist_ok=True)
AS_OF = os.environ.get("LTV_AS_OF", "2026-08-30")   # lifetime-tenure reference (data-availability date; override per rebuild)
MIN_YEAR, MAX_MATURE = 2019, 2024   # cohorts old enough for a real LTV curve

c = get_client(send_receive_timeout=480)

MECH = {"FreeCredit": "Free credit", "FreeSpinBonus": "Free spins", "DepositBonus": "Deposit bonus",
        "Organic": "No welcome bonus"}

# (first-bonus mechanic, cohort year) -> member count
sizes = defaultdict(dict)
for mech, yr, n in c.query(f"""
WITH dep AS (
  SELECT MEMBER_ID, min(SnapshotDate) fd FROM (
    SELECT MEMBER_ID,SnapshotDate FROM WORKSPACE.Daily_GMT8_Snapshot_A WHERE Currency='{CURRENCY}' AND DepositAmount>0
    UNION ALL SELECT MEMBER_ID,SnapshotDate FROM WORKSPACE.Daily_GMT8_Snapshot_BC WHERE Currency='{CURRENCY}' AND DepositAmount>0)
  GROUP BY MEMBER_ID),
fb AS (SELECT MEMBER_ID, argMin(BonusType, BonusTime_gmt8) mech FROM WORKSPACE.GetBonus_ABC
       WHERE SITE_edit='{SITE_EDIT}' AND Currency='{CURRENCY}' AND BonusAmount>0 GROUP BY MEMBER_ID)
SELECT coalesce(fb.mech,'Organic') mech, toYear(dep.fd) yr, count() n
FROM dep LEFT JOIN fb ON fb.MEMBER_ID=dep.MEMBER_ID
WHERE toYear(dep.fd) BETWEEN {MIN_YEAR} AND {MAX_MATURE}
GROUP BY mech, yr
""").result_rows:
    sizes[mech or "Organic"][int(yr)] = n

# (first-bonus mechanic, cohort year, years-since) -> net revenue
rows = c.query(f"""
WITH dep AS (
  SELECT MEMBER_ID, min(SnapshotDate) fd FROM (
    SELECT MEMBER_ID,SnapshotDate FROM WORKSPACE.Daily_GMT8_Snapshot_A WHERE Currency='{CURRENCY}' AND DepositAmount>0
    UNION ALL SELECT MEMBER_ID,SnapshotDate FROM WORKSPACE.Daily_GMT8_Snapshot_BC WHERE Currency='{CURRENCY}' AND DepositAmount>0)
  GROUP BY MEMBER_ID),
fb AS (SELECT MEMBER_ID, argMin(BonusType, BonusTime_gmt8) mech FROM WORKSPACE.GetBonus_ABC
       WHERE SITE_edit='{SITE_EDIT}' AND Currency='{CURRENCY}' AND BonusAmount>0 GROUP BY MEMBER_ID),
ngr AS (
  SELECT MEMBER_ID,SnapshotDate,NGR FROM WORKSPACE.Daily_GMT8_Snapshot_A WHERE Currency='{CURRENCY}' AND NGR!=0
  UNION ALL SELECT MEMBER_ID,SnapshotDate,NGR FROM WORKSPACE.Daily_GMT8_Snapshot_BC WHERE Currency='{CURRENCY}' AND NGR!=0)
SELECT coalesce(fb.mech,'Organic') mech, toYear(dep.fd) yr, dateDiff('year', dep.fd, n.SnapshotDate) yoff, round(sum(n.NGR)) ngr
FROM ngr n INNER JOIN dep ON n.MEMBER_ID=dep.MEMBER_ID
LEFT JOIN fb ON fb.MEMBER_ID=dep.MEMBER_ID
WHERE n.SnapshotDate>=dep.fd AND toYear(dep.fd) BETWEEN {MIN_YEAR} AND {MAX_MATURE}
GROUP BY mech, yr, yoff
""").result_rows

# ngr[mech][cohort][yoff]
ng = defaultdict(lambda: defaultdict(dict))
for mech, yr, yoff, ngr in rows:
    if yoff is not None and yoff >= 0:
        ng[mech or "Organic"][int(yr)][int(yoff)] = float(ngr)

def label(m):
    return MECH.get(m, m)

groups = []
for mech in ng:
    # blended curve across cohorts: at offset y, sum NGR over cohorts that reached y / members who reached y
    blended, tot_n = {}, sum(sizes[mech].values())
    for y in range(9):
        num = sum(ng[mech][yr].get(y, 0) for yr in ng[mech] if y in ng[mech][yr])
        den = sum(sizes[mech].get(yr, 0) for yr in ng[mech] if y in ng[mech][yr])
        if den:
            prev = blended.get(y - 1, 0)
            # cumulative per member: prev + this-year incremental-per-member (over the reached denom)
            blended[y] = round(prev + num / den)
    if tot_n >= 500:   # ignore tiny mechanics
        groups.append({"mech": mech, "label": label(mech), "n": tot_n,
                       "max_offset": max(blended) if blended else 0, "cum_per_member": blended})

groups.sort(key=lambda g: -(g["cum_per_member"].get(3, g["cum_per_member"].get(g["max_offset"], 0))))
# rank by value at year 3 (a fair common horizon most groups reach)
best = groups[0] if groups else None
def at(g, y):
    return g["cum_per_member"].get(y)

out = {
    "market": MARKET, "currency": CURRENCY, "symbol": SYMBOL, "as_of": AS_OF,
    "basis": (f"Join-year cohorts {MIN_YEAR}-{MAX_MATURE} split by the mechanic of each player's FIRST bonus; "
              "cumulative net revenue per member over years, whole-book. Which welcome mechanic acquires keepers."),
    "groups": groups,
    "summary": {
        "best_by_yr3": best["label"] if best else None,
        "best_yr3": at(best, 3) if best else None,
        "ranking_yr3": [{"label": g["label"], "n": g["n"], "yr3": at(g, 3), "yr1": at(g, 1)} for g in groups],
    },
}
json.dump(out, open(OUT / f"ltv-by-source-{SUF}.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print(f"LTV by source ({MARKET}) — {len(groups)} mechanics, cohorts {MIN_YEAR}-{MAX_MATURE}")
for g in groups:
    print(f"  {g['label']:14s} n={g['n']:>7,}  yr1 {SYMBOL}{at(g,1)}  yr3 {SYMBOL}{at(g,3)}  (to yr{g['max_offset']}: {SYMBOL}{g['cum_per_member'][g['max_offset']]})")
print(f"Saved {OUT / f'ltv-by-source-{SUF}.json'}")

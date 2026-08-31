"""Player lifetime-value (LTV) — real multi-year cohort curves.

Unlike the promo-cut analysis (scoped to YTD), LTV uses the FULL snapshot history
(WORKSPACE.Daily_GMT8_Snapshot_A/_BC goes back to 2018). For every member it finds
the first-ever deposit, buckets each cohort by first-deposit YEAR, and follows the
cohort's cumulative net revenue per member by years since that first deposit.

This is whole-book player value (not promo-attributed) — the foundational number that
says how much a new player is worth over their life, so acquisition and whale spend can
be judged on the long horizon instead of a 7-90 day window.

Out: scratchpad/ltv/cohort-ltv-{SUF}.json
Run: python bin/ltv_report/cohort_ltv.py        (PROMO_MARKET=SG for Singapore)
"""
import sys, json, os
from pathlib import Path
from collections import defaultdict

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from csir_config import get_client, CURRENCY, SUF, SYMBOL, MARKET

SCR = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad")
OUT = SCR / "ltv"; OUT.mkdir(parents=True, exist_ok=True)
AS_OF = os.environ.get("LTV_AS_OF", "2026-08-30")   # lifetime-tenure reference (data-availability date; override per rebuild)
MIN_YEAR = 2019   # earlier cohorts are thin / partial-history

c = get_client(send_receive_timeout=420)

# first-ever deposit per member -> cohort year + size
sizes = {r[0]: r[1] for r in c.query(f"""
WITH dep AS (
  SELECT MEMBER_ID, min(SnapshotDate) fd FROM (
    SELECT MEMBER_ID,SnapshotDate FROM WORKSPACE.Daily_GMT8_Snapshot_A WHERE Currency='{CURRENCY}' AND DepositAmount>0
    UNION ALL SELECT MEMBER_ID,SnapshotDate FROM WORKSPACE.Daily_GMT8_Snapshot_BC WHERE Currency='{CURRENCY}' AND DepositAmount>0)
  GROUP BY MEMBER_ID)
SELECT toYear(fd) yr, count() n FROM dep WHERE toYear(fd)>={MIN_YEAR} GROUP BY yr ORDER BY yr
""").result_rows}

# cumulative net revenue per (cohort year, years-since-first-deposit)
rows = c.query(f"""
WITH dep AS (
  SELECT MEMBER_ID, min(SnapshotDate) fd FROM (
    SELECT MEMBER_ID,SnapshotDate FROM WORKSPACE.Daily_GMT8_Snapshot_A WHERE Currency='{CURRENCY}' AND DepositAmount>0
    UNION ALL SELECT MEMBER_ID,SnapshotDate FROM WORKSPACE.Daily_GMT8_Snapshot_BC WHERE Currency='{CURRENCY}' AND DepositAmount>0)
  GROUP BY MEMBER_ID),
ngr AS (
  SELECT MEMBER_ID,SnapshotDate,NGR FROM WORKSPACE.Daily_GMT8_Snapshot_A WHERE Currency='{CURRENCY}' AND NGR!=0
  UNION ALL SELECT MEMBER_ID,SnapshotDate,NGR FROM WORKSPACE.Daily_GMT8_Snapshot_BC WHERE Currency='{CURRENCY}' AND NGR!=0)
SELECT toYear(dep.fd) cohort, dateDiff('year', dep.fd, n.SnapshotDate) yoff, round(sum(n.NGR)) ngr
FROM ngr n INNER JOIN dep ON n.MEMBER_ID=dep.MEMBER_ID
WHERE n.SnapshotDate>=dep.fd AND toYear(dep.fd)>={MIN_YEAR}
GROUP BY cohort, yoff ORDER BY cohort, yoff
""").result_rows

inc = defaultdict(dict)
for cohort, yoff, ngr in rows:
    if yoff is not None and yoff >= 0:
        inc[cohort][int(yoff)] = float(ngr)

cohorts = []
for yr in sorted(inc):
    n = sizes.get(yr, 1) or 1
    cum, curve = 0.0, {}
    for y in range(9):
        if y in inc[yr]:
            cum += inc[yr][y]
            curve[y] = round(cum / n)
    cohorts.append({"year": yr, "n": n, "max_offset": max(curve), "cum_per_member": curve})

# ── blended curve: at each offset, weighted-avg cumulative per member over cohorts that reached it
blended = {}
for y in range(9):
    ns = [(cc["n"], cc["cum_per_member"][y]) for cc in cohorts if y in cc["cum_per_member"]]
    if ns:
        tot_n = sum(n for n, _ in ns)
        blended[y] = round(sum(n * v for n, v in ns) / tot_n)

# ── summary story numbers
mature = max(cohorts, key=lambda cc: cc["max_offset"])            # longest-followed cohort (2019)
yr0 = blended.get(0)
yr1 = blended.get(1)
yr3 = blended.get(3)
mult_1 = round(yr1 / yr0, 1) if yr0 else None                    # value multiple by year 1 vs year 0
neg0 = [cc["year"] for cc in cohorts if cc["cum_per_member"].get(0, 0) < 0]

out = {
    "market": MARKET, "currency": CURRENCY, "symbol": SYMBOL, "as_of": AS_OF,
    "basis": ("Whole-book player value (not promo-attributed): every member's first-ever deposit dates the cohort; "
              "cumulative net revenue per member follows the FULL snapshot history back to 2018 — the real lifetime "
              "curve, not the YTD window the promo-cut analysis uses."),
    "cohorts": cohorts,
    "blended_cum_per_member": blended,
    "summary": {
        "mature_year": mature["year"], "mature_offset": mature["max_offset"],
        "mature_yr0": mature["cum_per_member"].get(0), "mature_final": mature["cum_per_member"][mature["max_offset"]],
        "blended_yr0": yr0, "blended_yr1": yr1, "blended_yr3": yr3,
        "yr1_multiple": mult_1, "cohorts_negative_yr0": neg0,
    },
}
json.dump(out, open(OUT / f"cohort-ltv-{SUF}.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)

print(f"LTV cohort curves ({MARKET}) — {len(cohorts)} cohorts, {sum(cc['n'] for cc in cohorts):,} members")
print(f"  blended per member: yr0 {SYMBOL}{yr0} -> yr1 {SYMBOL}{yr1} ({mult_1}x) -> yr3 {SYMBOL}{yr3}")
print(f"  matured {mature['year']} cohort: {SYMBOL}{mature['cum_per_member'].get(0)} at yr0 -> {SYMBOL}{mature['cum_per_member'][mature['max_offset']]} by yr{mature['max_offset']}")
print(f"  cohorts net-negative in year 0: {neg0}")
print(f"Saved {OUT / f'cohort-ltv-{SUF}.json'}")

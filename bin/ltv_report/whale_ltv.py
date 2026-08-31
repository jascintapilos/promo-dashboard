"""Whale lifetime value — the top-1% whales are multi-year assets, not a one-year number.

Takes the current whales (members whose YTD net revenue clears the top-1% threshold used
by the whale tab), then computes their FULL-history cumulative net revenue and tenure — to
say "a whale is worth RM X over their life (avg N years), vs RM Y this year", the hard
number behind protect-don't-cut. Aggregated in ClickHouse; no member data saved.

Out: scratchpad/ltv/whale-ltv-{SUF}.json
Run: python bin/ltv_report/whale_ltv.py        (PROMO_MARKET=SG for Singapore)
"""
import os, sys, json, statistics
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from csir_config import get_client, CURRENCY, SUF, SYMBOL, MARKET, START, END_EXCL

SCR = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad")
OUT = SCR / "ltv"; OUT.mkdir(parents=True, exist_ok=True)
YTD_LO, YTD_HI = START, END_EXCL   # whale-selection window = the report window (from csir_config date seam)
AS_OF = os.environ.get("LTV_AS_OF", "2026-08-30")   # lifetime-tenure reference (data-availability date; override per rebuild)

# match the whale tab EXACTLY: take the top-N members by YTD NGR, where N = the report's whale
# count (top-1% of VIPs = 74). Using the same set keeps the LTV card's count consistent with the tab.
n_whales = None; thr = None
try:
    vip = json.load(open(SCR / "vip" / f"vip-metrics-{SUF}.json", encoding="utf-8"))
    wsum = (vip.get("whale_ledger", {}).get("summary", {}) or {})
    n_whales = wsum.get("whales"); thr = wsum.get("whale_threshold_ngr")
except FileNotFoundError:
    pass
if not n_whales:
    raise SystemExit("need the whale count from vip-metrics (run the VIP pipeline first)")

c = get_client(send_receive_timeout=420)
r = c.query(f"""
WITH ytd AS (
  SELECT MEMBER_ID, sum(NGR) ytd FROM (
    SELECT MEMBER_ID,NGR FROM WORKSPACE.Daily_GMT8_Snapshot_A WHERE Currency='{CURRENCY}' AND NGR!=0 AND SnapshotDate>='{YTD_LO}' AND SnapshotDate<'{YTD_HI}'
    UNION ALL SELECT MEMBER_ID,NGR FROM WORKSPACE.Daily_GMT8_Snapshot_BC WHERE Currency='{CURRENCY}' AND NGR!=0 AND SnapshotDate>='{YTD_LO}' AND SnapshotDate<'{YTD_HI}')
  GROUP BY MEMBER_ID ORDER BY ytd DESC LIMIT {n_whales}),
life AS (
  SELECT MEMBER_ID, sum(NGR) life, min(SnapshotDate) fd FROM (
    SELECT MEMBER_ID,SnapshotDate,NGR FROM WORKSPACE.Daily_GMT8_Snapshot_A WHERE Currency='{CURRENCY}'
    UNION ALL SELECT MEMBER_ID,SnapshotDate,NGR FROM WORKSPACE.Daily_GMT8_Snapshot_BC WHERE Currency='{CURRENCY}')
  GROUP BY MEMBER_ID)
SELECT count() n,
       round(avg(l.life)) avg_life, round(median(l.life)) med_life, round(max(l.life)) max_life,
       round(avg(y.ytd)) avg_ytd,
       round(avg(dateDiff('day', l.fd, toDate('{AS_OF}'))/365.25),1) avg_tenure_yr,
       round(sum(l.life)) total_life, round(sum(y.ytd)) total_ytd,
       countIf(l.fd < '2025-01-01') joined_before_2025
FROM ytd y INNER JOIN life l ON y.MEMBER_ID=l.MEMBER_ID
""").result_rows[0]
n, avg_life, med_life, max_life, avg_ytd, avg_tenure, total_life, total_ytd, before25 = r

out = {
    "market": MARKET, "currency": CURRENCY, "symbol": SYMBOL, "as_of": AS_OF,
    "threshold_ytd_ngr": round(thr),
    "n_whales": n, "avg_lifetime_ngr": avg_life, "median_lifetime_ngr": med_life, "max_lifetime_ngr": max_life,
    "avg_ytd_ngr": avg_ytd, "avg_tenure_years": avg_tenure,
    "total_lifetime_ngr": total_life, "total_ytd_ngr": total_ytd,
    "lifetime_to_ytd_ratio": round(avg_life / avg_ytd, 1) if avg_ytd else None,
    "pct_joined_before_2025": round(100 * before25 / n) if n else None,
    "basis": ("Members whose YTD net revenue clears the top-1% whale threshold, with their FULL-history "
              "cumulative net revenue and tenure — whole-book, not promo-attributed. Shows whales are "
              "multi-year assets: what one is worth over its life vs this year."),
}
json.dump(out, open(OUT / f"whale-ltv-{SUF}.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print(f"Whale LTV ({MARKET}) — {n} whales (YTD>={SYMBOL}{round(thr):,})")
print(f"  avg lifetime {SYMBOL}{avg_life:,} vs avg this-year {SYMBOL}{avg_ytd:,} ({out['lifetime_to_ytd_ratio']}x) · avg tenure {avg_tenure}y · {out['pct_joined_before_2025']}% joined before 2025")
print(f"  median lifetime {SYMBOL}{med_life:,} · max {SYMBOL}{max_life:,} · combined lifetime {SYMBOL}{total_life:,}")
print(f"Saved {OUT / f'whale-ltv-{SUF}.json'}")

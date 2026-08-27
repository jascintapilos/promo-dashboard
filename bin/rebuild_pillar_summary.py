"""Recompute the WS1 Pillar Code Classification 'Summary' tab against the
framework-corrected pillars (outputs/pvc-csir-probe/reclassified.json).

Regenerates all four sections so none contradict the corrected All Codes tab:
  1. Pillar code counts (MY/SG)
  2. Malaysia claims by pillar x player-tier-at-claim
  3. Singapore claims by pillar x player-tier-at-claim
  4. Pillar profitability (cost / NGR lift / ROI%), MY & SG

Emits scratchpad/summary-content.json for the node writer to push. No sheet write here.
"""
import json
from pathlib import Path
from bisect import bisect_right
from collections import defaultdict
from datetime import timedelta
import sys

# CSIR endpoint, credentials and client all come from csir_config.py at the repo root.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from csir_config import get_client

ROOT = Path("C:/Users/vdiuser/Downloads/promo-automation")
OUT = ROOT / "outputs" / "pvc-csir-probe"
SCRATCH = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad")

PILLARS = ["Acq", "Retention", "VIP", "Whale Detection", "Branding"]
TIERS = ["Classic", "Bronze", "Silver (Trial)", "Silver", "Gold (Trial)", "Gold",
         "Platinum (Trial)", "Platinum", "Diamond (Trial)", "Diamond", "Unknown"]


client = get_client(send_receive_timeout=180)

# code -> new pillar, per market
recl = json.load(open(OUT / "reclassified.json", encoding="utf-8"))
pillar_of = {(r["market"], (r["code"] or "").strip()): r["new_pillar"] for r in recl}

# ---- Section 1: code counts (from reclassified) ----
counts = defaultdict(lambda: {"MY": 0, "SG": 0})
for r in recl:
    counts[r["new_pillar"]][r["market"]] += 1

# ---- Section 4: cost / NGR lift / ROI (from local ngr-lift file) ----
lift = json.load(open(OUT / "all-codes-ngr-lift.json", encoding="utf-8"))
roi = defaultdict(lambda: {"MY": [0.0, 0.0], "SG": [0.0, 0.0]})  # pillar -> {mkt:[cost,lift]}
for key, v in lift.items():
    mkt, code = key.split("||")[0], key.split("||")[1]
    p = pillar_of.get((mkt, code.strip()))
    if not p:
        continue
    roi[p][mkt][0] += v.get("cost", 0) or 0
    roi[p][mkt][1] += v.get("ngr_lift", 0) or 0

# ---- Sections 2 & 3: pillar x tier-at-claim crosstab (ClickHouse) ----
print("Querying claims ...")
claims = client.query("""
    SELECT Currency, MEMBER_ID, BonusTime_gmt8, BonusCode
    FROM WORKSPACE.GetBonus_ABC
    WHERE SITE_edit='WS1' AND Currency IN ('MYR','SGD')
      AND BonusTime_gmt8 >= '2026-01-01 00:00:00' AND BonusTime_gmt8 < '2026-08-10 00:00:00'
      AND BonusStatus IN ('Approved','Redeemed','Complete','Active','Completed','Low Balance 1','Low Balance 2')
      AND BonusAmount > 0
""", settings={"readonly": 1, "max_execution_time": 150, "max_result_rows": 1000000, "result_overflow_mode": "break"})
print(f"  claims: {len(claims.result_rows)}")

print("Querying tier log ...")
log = client.query("""
    SELECT SITE, MEMBER_ID, TIME, NewMembershipName
    FROM WORKSPACE.dedup_PlayerMembershipLog_A
    WHERE SITE IN ('WS1_MYS_MYR','WS1_SGP_SGD') ORDER BY MEMBER_ID, TIME
""", settings={"readonly": 1, "max_execution_time": 150, "max_result_rows": 3000000, "result_overflow_mode": "break"})
S2C = {"WS1_MYS_MYR": "MYR", "WS1_SGP_SGD": "SGD"}
by_member = defaultdict(list)
for site, mid, t, tier in log.result_rows:
    by_member[(S2C[site], mid)].append((t + timedelta(hours=8), tier))


def tier_at(cur, mid, when):
    ev = by_member.get((cur, mid))
    if not ev:
        return "Unknown"
    ts = [e[0] for e in ev]
    i = bisect_right(ts, when) - 1
    return ev[i][1] if i >= 0 else "Unknown"


C2M = {"MYR": "MY", "SGD": "SG"}
cross = {"MY": defaultdict(lambda: defaultdict(int)), "SG": defaultdict(lambda: defaultdict(int))}
for cur, mid, bt, code in claims.result_rows:
    mkt = C2M[cur]
    p = pillar_of.get((mkt, (code or "").strip()))
    if not p:
        continue
    t = tier_at(cur, mid, bt)
    if t not in TIERS:
        t = "Unknown"
    cross[mkt][p][t] += 1

# ---- assemble sheet rows ----
rows = [["Pillar", "MY codes", "SG codes"]]
for p in PILLARS:
    rows.append([p, counts[p]["MY"], counts[p]["SG"]])
rows.append([])

for mkt, label in [("MY", "Malaysia"), ("SG", "Singapore")]:
    rows.append([f"{label} -- number of bonus claims, by pillar (corrected) and the player's actual account tier at the moment of each claim"])
    rows.append(["Pillar"] + TIERS + ["Total"])
    for p in PILLARS:
        d = cross[mkt][p]
        tot = sum(d.values())
        rows.append([p] + [d.get(t, 0) for t in TIERS] + [tot])
    rows.append([])

rows.append(["Pillar profitability -- incremental ROI (NGR Lift / Cost), 1 Jan to 9 Aug 2026"])
rows.append(["Pillar", "MY cost", "MY NGR Lift", "MY ROI %", "SG cost", "SG NGR Lift", "SG ROI %"])
for p in PILLARS:
    mc, ml = roi[p]["MY"]; sc, sl = roi[p]["SG"]
    mroi = f"{ml/mc*100:.1f}%" if mc else "n/a"
    sroi = f"{sl/sc*100:.1f}%" if sc else "n/a"
    rows.append([p, round(mc), round(ml), mroi, round(sc), round(sl), sroi])
rows.append(["Note", "NGR Lift is revenue above each player's own pre-bonus baseline, not raw NGR. Negative ROI = the pillar cost more in bonuses than the extra revenue it produced."])
rows.append([])
rows.append(["Classification note", "Pillars corrected to the official [Pillar_Team_Objective] framework (2026-08): pillar=objective; VM/AM are teams (not VIP); gamification/festive=Retention; Branding=production/sponsorship spend, which lives outside the bonus ledger (0 codes here)."])

SCRATCH.mkdir(parents=True, exist_ok=True)
(SCRATCH / "summary-content.json").write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
print(f"\nWrote {len(rows)} summary rows to scratchpad/summary-content.json")
print("Code counts:", {p: dict(counts[p]) for p in PILLARS})
print("MY crosstab totals:", {p: sum(cross['MY'][p].values()) for p in PILLARS})
print("SG crosstab totals:", {p: sum(cross['SG'][p].values()) for p in PILLARS})

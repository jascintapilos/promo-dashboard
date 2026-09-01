#!/usr/bin/env python3
"""LTV lens for the bonus value-over-tenure analysis — DIRECTIONAL.

For every give-back / deposit bonus family x mechanic, pull the LIFETIME net revenue
(all history) and YTD net revenue of the members who ever received it, from
WORKSPACE.Daily_GMT8_Snapshot_A/_BC, joined to receipt via GetBonus_ABC.BonusCode.
Answers "how did the bonus affect their LTV" the way Jascinta asked — alongside the
30/60/90 tenure read — but it is a REACH measure (does this bonus reach high- or
low-lifetime players), NOT causal. Causal proof is the holdout. The card says so.

Families come from the deposit flag (bin/bonus_family), VIP excludes lane D-engagement.
Out: scratchpad/ltv/lifetime-by-bonus-{SUF}.json   (MY, then PROMO_MARKET=SG for SG)
Run: python bin/ltv_report/lifetime_by_bonus.py
"""
import sys, json, os
from pathlib import Path
from collections import defaultdict

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "bin"))
from csir_config import get_client, CURRENCY, SITE_EDIT, SUF, SYMBOL, MARKET, START
from bonus_family import family_of, mech_label

SCR = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad")
OUT = SCR / "ltv"; OUT.mkdir(parents=True, exist_ok=True)


def load(p):
    fp = SCR / p
    return json.load(open(fp, encoding="utf-8")) if fp.exists() else None


ret = load(f"ret/ret-metrics-{SUF}.json")
vip = load(f"vip/vip-metrics-{SUF}.json")
if not ret or not vip:
    sys.exit(f"[{MARKET}] metrics missing")

# tag = (pillar, family, mechanic) -> codes ; and per-tag bonus spend (from the report metrics)
tags = defaultdict(list)
spend = defaultdict(float)
for pillar, m, size_key in (("retention", ret, "avg_bonus_per_claim"), ("vip", vip, "avg_amount")):
    for c in m["codes"]:
        if pillar == "vip" and c.get("lane") == "D-engagement":
            continue
        fam = family_of(c)
        if fam == "unclassified":
            continue
        key = (pillar, fam, mech_label(c.get("mechanic")))
        tags[key].append(c["code"].strip())
        spend[key] += (c.get("spend") or 0)

tag_list = list(tags.keys())
all_codes = sorted({code for codes in tags.values() for code in codes})
if not all_codes:
    sys.exit(f"[{MARKET}] no classified codes")


def inlist(codes):
    return ",".join("'" + x.replace("'", "''") + "'" for x in codes)


# multiIf routes each grant's BonusCode to its tag id (first match wins)
branches = []
for i, key in enumerate(tag_list):
    branches.append(f"trimBoth(BonusCode) IN ({inlist(tags[key])}), {i}")
multiif = "multiIf(" + ", ".join(branches) + ", -1)"

q = f"""
WITH recip AS (
  SELECT DISTINCT MEMBER_ID, {multiif} AS tag
  FROM WORKSPACE.GetBonus_ABC
  WHERE SITE_edit='{SITE_EDIT}' AND Currency='{CURRENCY}' AND BonusAmount>0
    AND trimBoth(BonusCode) IN ({inlist(all_codes)})
),
life AS (
  SELECT MEMBER_ID, sum(NGR) AS life, sumIf(NGR, SnapshotDate >= '{START}') AS ytd
  FROM (
    SELECT MEMBER_ID, SnapshotDate, NGR FROM WORKSPACE.Daily_GMT8_Snapshot_A  WHERE Currency='{CURRENCY}' AND NGR!=0
    UNION ALL
    SELECT MEMBER_ID, SnapshotDate, NGR FROM WORKSPACE.Daily_GMT8_Snapshot_BC WHERE Currency='{CURRENCY}' AND NGR!=0
  )
  WHERE MEMBER_ID IN (SELECT MEMBER_ID FROM recip)
  GROUP BY MEMBER_ID
)
SELECT r.tag AS tag,
       count(DISTINCT r.MEMBER_ID) AS n,
       round(sum(l.life))          AS tot_life,
       round(avg(l.life))          AS avg_life,
       round(median(l.life))       AS med_life,
       round(sum(l.ytd))           AS tot_ytd,
       round(avg(l.ytd))           AS avg_ytd
FROM recip r INNER JOIN life l ON l.MEMBER_ID = r.MEMBER_ID
WHERE r.tag >= 0
GROUP BY r.tag
"""

c = get_client(send_receive_timeout=600)
rows = {int(row[0]): row for row in c.query(q).result_rows}

# assemble per pillar x family (+ per mechanic)
pillars = defaultdict(lambda: defaultdict(lambda: {"n": 0, "tot_life": 0.0, "tot_ytd": 0.0, "spend": 0.0,
                                                   "mechanics": [], "avg_life_w": 0.0, "med_samples": []}))
per_mech = {}
for i, key in enumerate(tag_list):
    pillar, fam, mech = key
    row = rows.get(i)
    sp = spend[key]
    if not row:
        continue
    _, n, tot_life, avg_life, med_life, tot_ytd, avg_ytd = row
    per_mech[key] = {"mechanic": mech, "recipients": int(n), "spend": round(sp),
                     "avg_life": avg_life, "med_life": med_life, "avg_ytd": avg_ytd,
                     "life_per_rm": round(tot_life / sp, 2) if sp else None,
                     "ytd_per_rm": round(tot_ytd / sp, 2) if sp else None}
    b = pillars[pillar][fam]
    b["n"] += int(n); b["tot_life"] += tot_life; b["tot_ytd"] += tot_ytd; b["spend"] += sp
    b["mechanics"].append(per_mech[key])

out = {"market": MARKET, "currency": CURRENCY, "symbol": SYMBOL, "as_of": START,
       "basis": ("Lifetime + YTD net revenue (all history, whole-book) of every member who ever received "
                 "each give-back/deposit family, joined by BonusCode. DIRECTIONAL — shows whether a bonus "
                 "reaches high- or low-lifetime players, NOT that it caused the value (holdout is the proof). "
                 "VIP excludes lane D-engagement."),
       "pillars": {}}
for pillar, fams in pillars.items():
    out["pillars"][pillar] = {}
    for fam, b in fams.items():
        out["pillars"][pillar][fam] = {
            "recipients": b["n"], "spend": round(b["spend"]),
            "life_per_rm": round(b["tot_life"] / b["spend"], 2) if b["spend"] else None,
            "ytd_per_rm": round(b["tot_ytd"] / b["spend"], 2) if b["spend"] else None,
            "avg_life": round(b["tot_life"] / b["n"]) if b["n"] else None,
            "avg_ytd": round(b["tot_ytd"] / b["n"]) if b["n"] else None,
            "mechanics": sorted(b["mechanics"], key=lambda x: -x["spend"]),
        }

path = OUT / f"lifetime-by-bonus-{SUF}.json"
json.dump(out, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"[{MARKET}] lifetime-by-bonus — {len(all_codes)} codes, {sum(r[1] for r in rows.values()):,} recipient-rows")
for pillar, fams in out["pillars"].items():
    for fam, b in fams.items():
        print(f"  {pillar:9s} {fam:10s} n={b['recipients']:>7,}  avg_life {SYMBOL}{b['avg_life']:>8,}  "
              f"life/{SYMBOL}1 {b['life_per_rm']:>6}  avg_ytd {SYMBOL}{b['avg_ytd']:>7,}")
print(f"Saved {path}")

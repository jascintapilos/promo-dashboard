#!/usr/bin/env python3
"""Ripple / second-order pass over the bonus value-over-tenure data (proactive, per the
standing directive to surface more than the headline). Single market (PROMO_MARKET).

Cuts (all DIRECTIONAL — reach, not causal; the holdout is the causal proof):
  1. HUNTER vs KEEPER lifetime (warehouse) — is the 1/3 hunters the leak?
  2. TIER reach (local) — which tiers give-back vs deposit land on.
  3. SHORT-vs-LIFETIME reconciliation (local) — the 90-day-loss / high-lifetime paradox.
  4. GATEWAY (warehouse) — do give-back players later migrate into deposit bonuses?
  5. CANNIBALIZATION (local) — are deposit bonuses landing on already-active depositors
     (small gap since last deposit) rather than driving new deposits?
  6. SIZE x LIFETIME (warehouse) — does over-sizing give-backs reach lower-lifetime players?

Out: scratchpad/bonus-ripple-{SUF}.json    Run: python bin/bonus_ripple.py  (PROMO_MARKET=SG)
"""
import sys, json, os, statistics
from pathlib import Path
from collections import defaultdict

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT)); sys.path.insert(0, str(ROOT / "bin"))
from csir_config import get_client, CURRENCY, SITE_EDIT, SUF, SYMBOL, MARKET, START
from bonus_family import family_of, mech_label
from bonus_value_analysis import band_defs, band_of, size_of

SCR = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad")


def load(p):
    fp = SCR / p
    return json.load(open(fp, encoding="utf-8")) if fp.exists() else None


ret, vip = load(f"ret/ret-metrics-{SUF}.json"), load(f"vip/vip-metrics-{SUF}.json")
bonus = load(f"bonus-{SUF}.json")
life = load(f"ltv/lifetime-by-bonus-{SUF}.json")
BANDS = band_defs(MARKET)


def inlist(xs):
    return ",".join("'" + str(x).replace("'", "''") + "'" for x in xs)


# code sets + code->size (excl VIP D-engagement)
gb_codes = {"retention": set(), "vip": set()}
dep_codes = {"retention": set(), "vip": set()}
size_map = {}
for pillar, m in (("retention", ret), ("vip", vip)):
    for c in m["codes"]:
        if pillar == "vip" and c.get("lane") == "D-engagement":
            continue
        fam = family_of(c)
        code = c["code"].strip()
        size_map[code] = size_of(c, pillar)
        if fam == "give-back":
            gb_codes[pillar].add(code)
        elif fam == "deposit":
            dep_codes[pillar].add(code)
all_gb = gb_codes["retention"] | gb_codes["vip"]
all_dep = dep_codes["retention"] | dep_codes["vip"]

# ── give-back claim behaviour (hunter/keeper + member size band) ──────────────────
mem = defaultdict(lambda: {"mat": 0, "dep": 0, "size_sum": 0.0, "size_n": 0})
for pillar, f in (("retention", f"ret/claim-rows-{SUF}.json"), ("vip", f"vip/claim-rows-{SUF}.json")):
    for r in (load(f) or []):
        code = r.get("code", "").strip()
        if code not in gb_codes[pillar]:
            continue
        d = mem[str(r.get("member"))]
        if r.get("mature_30"):
            d["mat"] += 1
            if (r.get("dep_days_30") or 0) > 0:
                d["dep"] += 1
        s = size_map.get(code)
        if s is not None:
            d["size_sum"] += s * (r.get("claims") or 1); d["size_n"] += (r.get("claims") or 1)
keepers = {m for m, d in mem.items() if d["mat"] and d["dep"] > 0}
hunters = {m for m, d in mem.items() if d["mat"] and d["dep"] == 0}
# member -> give-back size band
band_members = defaultdict(list)
for m, d in mem.items():
    if d["size_n"]:
        b = band_of(d["size_sum"] / d["size_n"], BANDS)
        if b:
            band_members[b].append(m)

c = get_client(send_receive_timeout=600)

def life_cte(members):
    return f"""SELECT MEMBER_ID, sum(NGR) AS life FROM (
        SELECT MEMBER_ID,NGR FROM WORKSPACE.Daily_GMT8_Snapshot_A  WHERE Currency='{CURRENCY}' AND NGR!=0
        UNION ALL SELECT MEMBER_ID,NGR FROM WORKSPACE.Daily_GMT8_Snapshot_BC WHERE Currency='{CURRENCY}' AND NGR!=0
      ) WHERE MEMBER_ID IN ({inlist(members)}) GROUP BY MEMBER_ID"""

# ── 1. hunter vs keeper lifetime ──────────────────────────────────────────────────
hunt_life = keep_life = None
if hunters or keepers:
    both = hunters | keepers
    rows = {r[0]: r for r in c.query(
        f"WITH life AS ({life_cte(both)}) SELECT if(MEMBER_ID IN ({inlist(hunters)}),'hunter','keeper') g,"
        f" count() n, round(avg(life)) a, round(median(life)) md, round(sum(life)) t FROM life GROUP BY g").result_rows}
    pack = lambda r: None if not r else {"members": int(r[1]), "avg_life": r[2], "med_life": r[3], "tot_life": r[4]}
    hunt_life, keep_life = pack(rows.get("hunter")), pack(rows.get("keeper"))

# ── 4. gateway: give-back members who LATER took a deposit bonus ───────────────────
gateway = None
if all_gb and all_dep:
    r = c.query(f"""
    WITH gb AS (SELECT MEMBER_ID, min(BonusTime_gmt8) t0 FROM WORKSPACE.GetBonus_ABC
                WHERE SITE_edit='{SITE_EDIT}' AND Currency='{CURRENCY}' AND BonusAmount>0
                  AND trimBoth(BonusCode) IN ({inlist(all_gb)}) GROUP BY MEMBER_ID),
         dp AS (SELECT MEMBER_ID, min(BonusTime_gmt8) t1 FROM WORKSPACE.GetBonus_ABC
                WHERE SITE_edit='{SITE_EDIT}' AND Currency='{CURRENCY}' AND BonusAmount>0
                  AND trimBoth(BonusCode) IN ({inlist(all_dep)}) GROUP BY MEMBER_ID)
    SELECT count() gb_members, countIf(dp.t1 > gb.t0) migrated_after, countIf(dp.MEMBER_ID != '') ever_deposit_bonus
    FROM gb LEFT JOIN dp ON dp.MEMBER_ID = gb.MEMBER_ID""").result_rows[0]
    gbm, mig, ever = int(r[0]), int(r[1]), int(r[2])
    gateway = {"gb_members": gbm, "migrated_after": mig, "ever_deposit_bonus": ever,
               "gateway_rate_pct": round(100 * mig / gbm, 1) if gbm else None,
               "overlap_pct": round(100 * ever / gbm, 1) if gbm else None}

# ── 6. size x lifetime for give-backs ─────────────────────────────────────────────
size_life = []
if band_members:
    allm = [m for ms in band_members.values() for m in ms]
    lifemap = {r[0]: r[1] for r in c.query(f"{life_cte(allm)}").result_rows}
    for label, lo, hi in BANDS:
        ms = band_members.get(label, [])
        vals = [lifemap.get(m, 0) for m in ms]
        if ms:
            size_life.append({"band": label, "members": len(ms), "avg_life": round(sum(vals) / len(ms))})

# ── 7. MATCHED: give-back vs deposit lifetime WITHIN first-deposit-year cohort ─────
# Strips the tenure confounder — if the gap holds within a cohort it isn't just "older accounts".
matched = None
if all_gb and all_dep:
    q = f"""
    WITH grp AS (
      SELECT MEMBER_ID,
             max(trimBoth(BonusCode) IN ({inlist(all_gb)}))  AS is_gb,
             max(trimBoth(BonusCode) IN ({inlist(all_dep)})) AS is_dp
      FROM WORKSPACE.GetBonus_ABC
      WHERE SITE_edit='{SITE_EDIT}' AND Currency='{CURRENCY}' AND BonusAmount>0
        AND trimBoth(BonusCode) IN ({inlist(all_gb | all_dep)})
      GROUP BY MEMBER_ID
    ),
    fd AS (
      SELECT MEMBER_ID, toYear(min(SnapshotDate)) AS cohort FROM (
        SELECT MEMBER_ID,SnapshotDate FROM WORKSPACE.Daily_GMT8_Snapshot_A  WHERE Currency='{CURRENCY}' AND DepositAmount>0
        UNION ALL SELECT MEMBER_ID,SnapshotDate FROM WORKSPACE.Daily_GMT8_Snapshot_BC WHERE Currency='{CURRENCY}' AND DepositAmount>0
      ) WHERE MEMBER_ID IN (SELECT MEMBER_ID FROM grp) GROUP BY MEMBER_ID
    ),
    life AS (
      SELECT MEMBER_ID, sum(NGR) AS life FROM (
        SELECT MEMBER_ID,NGR FROM WORKSPACE.Daily_GMT8_Snapshot_A  WHERE Currency='{CURRENCY}' AND NGR!=0
        UNION ALL SELECT MEMBER_ID,NGR FROM WORKSPACE.Daily_GMT8_Snapshot_BC WHERE Currency='{CURRENCY}' AND NGR!=0
      ) WHERE MEMBER_ID IN (SELECT MEMBER_ID FROM grp) GROUP BY MEMBER_ID
    )
    SELECT fd.cohort AS cohort,
       countIf(g.is_gb) gb_n, round(avgIf(l.life, g.is_gb=1)) gb_life,
       countIf(g.is_dp) dp_n, round(avgIf(l.life, g.is_dp=1)) dp_life
    FROM grp g INNER JOIN life l ON l.MEMBER_ID=g.MEMBER_ID
    LEFT JOIN fd ON fd.MEMBER_ID=g.MEMBER_ID
    WHERE fd.cohort BETWEEN 2015 AND 2026
    GROUP BY cohort ORDER BY cohort
    """
    strata = [{"cohort": int(r[0]), "gb_n": int(r[1]), "gb_life": r[2], "dp_n": int(r[3]), "dp_life": r[4]}
              for r in c.query(q).result_rows if r[0]]
    # cohort-standardised: score both groups on the SAME cohort mix (pooled recipients) → tenure-neutral
    tot = sum(s["gb_n"] + s["dp_n"] for s in strata) or 1
    gb_adj = sum((s["gb_life"] or 0) * (s["gb_n"] + s["dp_n"]) for s in strata) / tot
    dp_adj = sum((s["dp_life"] or 0) * (s["gb_n"] + s["dp_n"]) for s in strata) / tot
    matched = {"by_cohort": strata, "gb_adj_life": round(gb_adj), "dp_adj_life": round(dp_adj),
               "raw_gb_life": (life or {}).get("pillars", {}).get("retention", {}).get("give-back", {}).get("avg_life"),
               "basis": "Give-back vs deposit recipients scored on a common first-deposit-year mix (tenure-matched)."}

# ── 2. tier reach (local) ─────────────────────────────────────────────────────────
tier_reach = {"give-back": defaultdict(int), "deposit": defaultdict(int)}
# ── 5. cannibalization (local): gap since last deposit before the claim ───────────
gaps = {"give-back": [], "deposit": []}
for pillar, f in (("retention", f"ret/claim-rows-{SUF}.json"), ("vip", f"vip/claim-rows-{SUF}.json")):
    idx = {}
    for c2 in (ret if pillar == "retention" else vip)["codes"]:
        if pillar == "vip" and c2.get("lane") == "D-engagement":
            continue
        idx[c2["code"].strip()] = family_of(c2)
    for r in (load(f) or []):
        fam = idx.get(r.get("code", "").strip())
        if fam in ("give-back", "deposit"):
            tier_reach[fam][str(r.get("tier") or "?")] += 1
            g = r.get("recency_days")   # days since last deposit before the claim (small = already-active)
            if isinstance(g, (int, float)) and g >= 0:
                gaps[fam].append(g)
tier_reach = {k: dict(sorted(v.items())) for k, v in tier_reach.items()}


def gapstat(xs):
    if not xs:
        return None
    xs = sorted(xs)
    return {"n": len(xs), "median_days": round(statistics.median(xs), 1),
            "active_within_7d_pct": round(100 * sum(1 for x in xs if x <= 7) / len(xs), 1),
            "lapsed_30d_plus_pct": round(100 * sum(1 for x in xs if x >= 30) / len(xs), 1)}


cannib = {"deposit": gapstat(gaps["deposit"]), "give-back": gapstat(gaps["give-back"])}

# ── 3. reconciliation (local) ─────────────────────────────────────────────────────
recon = []
for pillar in ("retention", "vip"):
    for fam in ("give-back", "deposit"):
        sb = (bonus or {}).get("pillars", {}).get(pillar, {}).get("families", {}).get(fam)
        lb = (life or {}).get("pillars", {}).get(pillar, {}).get(fam)
        if sb and lb:
            recon.append({"pillar": pillar, "family": fam, "short_per_rm": sb["per_rm"],
                          "life_per_rm": lb["life_per_rm"], "avg_life": lb["avg_life"], "avg_ytd": lb["avg_ytd"],
                          "hunter_pct": (sb.get("keeper_hunter") or {}).get("hunter_pct")})

out = {"market": MARKET, "symbol": SYMBOL,
       "basis": "Directional ripple cuts over the give-back/deposit families. Reach, not causal (holdout = proof).",
       "hunter_vs_keeper": {"hunter": hunt_life, "keeper": keep_life, "n_hunters": len(hunters), "n_keepers": len(keepers)},
       "tier_reach": tier_reach, "reconciliation": recon,
       "gateway": gateway, "cannibalization": cannib, "size_x_lifetime": size_life, "matched_cohort": matched}
path = SCR / f"bonus-ripple-{SUF}.json"
json.dump(out, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

print(f"[{MARKET}] ripple —")
if hunt_life and keep_life:
    mult = round(keep_life['avg_life'] / hunt_life['avg_life'], 1) if hunt_life['avg_life'] else 'inf'
    print(f"  1 HUNTER/KEEPER: hunter {hunt_life['members']:,}@{SYMBOL}{hunt_life['avg_life']:,} vs keeper "
          f"{keep_life['members']:,}@{SYMBOL}{keep_life['avg_life']:,}  (keeper {mult}x)")
if gateway:
    print(f"  4 GATEWAY: {gateway['gateway_rate_pct']}% of give-back members LATER took a deposit bonus "
          f"({gateway['overlap_pct']}% ever)")
if cannib['deposit']:
    d, g = cannib['deposit'], cannib['give-back']
    print(f"  5 CANNIBALIZATION: deposit claims median gap {d['median_days']}d, {d['active_within_7d_pct']}% within 7d"
          + (f" | give-back median {g['median_days']}d, {g['lapsed_30d_plus_pct']}% lapsed 30d+" if g else ""))
if size_life:
    print("  6 SIZE x LIFETIME (give-back):", [(x['band'], x['members'], f"{SYMBOL}{x['avg_life']:,}") for x in size_life])
if matched:
    print(f"  7 MATCHED (tenure-neutral): give-back {SYMBOL}{matched['gb_adj_life']:,} vs deposit {SYMBOL}{matched['dp_adj_life']:,}  "
          f"(raw give-back {SYMBOL}{matched['raw_gb_life']:,})")
    for s in matched["by_cohort"]:
        print(f"      {s['cohort']}: gb {s['gb_n']:>5,}@{SYMBOL}{s['gb_life'] or 0:>8,}  dp {s['dp_n']:>5,}@{SYMBOL}{s['dp_life'] or 0:>8,}")
print(f"Saved {path}")

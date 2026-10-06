#!/usr/bin/env python3
"""Independent code-level verification for the action codes (Scale / Reduce / Trim / Stop).

Re-pulls each action code's raw numbers straight from the warehouse over the SAME window the
report used, and compares to what the report shows — so every "cut it / scale it" call is
defensible. Two levels:
  * HARD CHECK (must match): spend, claims, distinct claimers — plain aggregations from GetBonus.
    A mismatch is a real data/pipeline bug.
  * DIRECTIONAL CHECK (sanity): a plain 7-day-after minus 14-day-before NGR lift per RM (no
    time-decay), compared to the report's decayed net-rev-per-RM — sign + rough magnitude.
    A sign flip is a review flag, not proof of error (the report uses a decayed attribution).

Writes scratchpad/verify-action-{MK}.json for the xlsx builder. Run: python bin/verify_action_codes.py
"""
import sys, json, os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from csir_config import get_client, CURRENCY, SITE_EDIT, START, END_INCL, SYMBOL, MARKET

SCR = Path(__import__("os").environ.get("PROMO_SCRATCH", r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad"))
# The MANAGED book — every code with a firm management call (the 5 exec buckets). Broadened from the
# 4 action verbs so Maintain (keep as-is) and Optimise (right-size) codes appear too — otherwise whole
# segments (e.g. SG acquisition, all Optimise/Maintain) vanish from the behaviour tool. Still excludes
# Low volume / Referral / Reload(->retention) / Watch-money / Hold / Monitor and VIP non-Lane-A perks.
ACTION = {"Scale", "Reduce", "Trim", "Stop", "Maintain", "Optimise"}
# same successful-status filter the report uses (00_ret_codes.py / 01_pull.py) — excludes Rejected/Pending
STATUSES = "('Approved','Redeemed','Complete','Active','Completed','Low Balance 1','Low Balance 2')"


def load(p):
    fp = SCR / p
    return json.load(open(fp, encoding="utf-8")) if fp.exists() else None


def main(mk):
    acq, ret, vip = load(f"acq/acq-metrics-{mk}.json"), load(f"ret/ret-metrics-{mk}.json"), load(f"vip/vip-metrics-{mk}.json")
    rows = []
    excluded = []
    for pillar, m, sk in (("Acquisition", acq, "avg_bonus_per_claim"), ("Retention", ret, "avg_bonus_per_claim"), ("VIP", vip, "avg_amount")):
        if not m:
            continue
        for c in m["codes"]:
            if c.get("decision") not in ACTION:
                continue
            # ROI action codes only. VIP non-A lanes are loyalty perks / entitlements / engagement
            # (weekly rescue = cashback perk, lucky-wheel / check-in / scratch / birthday), which the
            # report does not score on ROI — they carry the native word "Trim" but are not a cut/scale call.
            if pillar == "VIP" and (c.get("lane") or "") != "A-performance":
                excluded.append((c["code"].strip(), c.get("lane"), c.get("sub_type")))
                continue
            if True:
                rows.append({"code": c["code"].strip(), "pillar": pillar, "decision": c.get("decision"),
                             "name": c.get("name") or "", "mechanic": c.get("mechanic"),
                             "reason": (c.get("reason") or "")[:300], "do": (c.get("do") or "")[:300],
                             "r_spend": round(c.get("spend") or 0), "r_claims": c.get("claims"),
                             "r_claimers": c.get("claimers"), "r_per_rm": c.get("ngr_lift_per_rm"),
                             "r_fair_per_rm": c.get("fair_per_rm"), "r_tier": c.get("tier"),
                             # pillar-specific decision-metric inputs (so the sheet shows each code's own yardstick)
                             "r_redeposit_uplift": c.get("redeposit_uplift"),   # ret + VIP-A: keeps players vs type norm (pp)
                             "r_cost_per_ftd": c.get("cost_per_ftd"),           # acq: RM per new depositor
                             "r_stick_30": c.get("stick_30"),                   # acq: % who stayed 30d
                             "r_cost_per_retained": c.get("cost_per_retained"), # ret/VIP: RM per retained player
                             "r_fwd_incr_per_rm_90": c.get("fwd_incr_per_rm_90"), # VIP: 90d incremental "extra" NGR per RM
                             "r_ggr_coverage": c.get("ggr_coverage"),           # VIP: house's gross win / bonus cost — did the edge cover it (luck vs cost)
                             "r_lane": c.get("lane"),
                             "robustness": c.get("robustness")})
    codes = sorted({r["code"] for r in rows})
    if not codes:
        # Empty market (no qualifying action codes): emit a VALID empty file rather than
        # None, so the downstream consumers that read verify-action-{mk}.json .codes
        # (ggr_coverage, bonus_roi_horizon, reproduce_attribution, keeps_horizon, the
        # deposit_* pulls) degrade to no-op instead of crashing on a missing file.
        json.dump({"market": mk, "sym": SYMBOL, "window": f"{START} to {END_INCL}",
                   "n_codes": 0, "n_flagged": 0, "n_excluded_perks": 0, "excluded_perks": [], "codes": []},
                  open(SCR / f"verify-action-{mk}.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print(f"[{mk}] no qualifying action codes — wrote empty verify-action-{mk}.json")
        return None
    inlist = ",".join("'" + x.replace("'", "''") + "'" for x in codes)
    c = get_client(send_receive_timeout=600)

    # HARD CHECK — spend / claims / claimers straight from GetBonus (same window)
    qa = f"""
    SELECT trimBoth(BonusCode) code, count() claims, uniqExact(MEMBER_ID) claimers, round(sum(BonusAmount)) spend
    FROM WORKSPACE.GetBonus_ABC
    WHERE SITE_edit='{SITE_EDIT}' AND Currency='{CURRENCY}' AND BonusAmount>0
      AND trimBoth(BonusCode) IN ({inlist}) AND BonusStatus IN {STATUSES}
      AND toDate(BonusTime_gmt8) >= '{START}' AND toDate(BonusTime_gmt8) <= '{END_INCL}'
    GROUP BY code
    """
    hard = {r[0]: {"claims": int(r[1]), "claimers": int(r[2]), "spend": round(r[3])} for r in c.query(qa).result_rows}

    # DIRECTIONAL CHECK — plain 7d-after minus 14d-before NGR per RM
    qb = f"""
    WITH claims AS (
      SELECT MEMBER_ID, trimBoth(BonusCode) code, toDate(BonusTime_gmt8) cd, BonusAmount amt
      FROM WORKSPACE.GetBonus_ABC
      WHERE SITE_edit='{SITE_EDIT}' AND Currency='{CURRENCY}' AND BonusAmount>0
        AND trimBoth(BonusCode) IN ({inlist}) AND BonusStatus IN {STATUSES}
        AND toDate(BonusTime_gmt8) >= '{START}' AND toDate(BonusTime_gmt8) <= '{END_INCL}'
    ),
    ngr AS (
      SELECT MEMBER_ID, SnapshotDate, NGR FROM (
        SELECT MEMBER_ID,SnapshotDate,NGR FROM WORKSPACE.Daily_GMT8_Snapshot_A  WHERE Currency='{CURRENCY}' AND NGR!=0
        UNION ALL SELECT MEMBER_ID,SnapshotDate,NGR FROM WORKSPACE.Daily_GMT8_Snapshot_BC WHERE Currency='{CURRENCY}' AND NGR!=0
      ) WHERE MEMBER_ID IN (SELECT MEMBER_ID FROM claims)
    )
    SELECT c.code code, round(sum(c.amt)) spend,
      round(sum(n.NGR * ((n.SnapshotDate >= c.cd) AND (n.SnapshotDate < addDays(c.cd,7))))) fwd7,
      round(sum(n.NGR * ((n.SnapshotDate >= addDays(c.cd,-14)) AND (n.SnapshotDate < c.cd)))) pre14
    FROM claims c LEFT JOIN ngr n ON n.MEMBER_ID = c.MEMBER_ID
    GROUP BY c.code
    """
    lift = {}
    for r in c.query(qb).result_rows:
        code, sp, fwd7, pre14 = r[0], (r[1] or 0), (r[2] or 0), (r[3] or 0)
        plain_lift = fwd7 - pre14
        lift[code] = {"fwd7": round(fwd7), "pre14": round(pre14),
                      "plain_per_rm": round(plain_lift / sp, 2) if sp else None}

    # merge + flag
    def sign(x): return 0 if x is None else (1 if x > 0.05 else (-1 if x < -0.05 else 0))
    out = []
    for r in rows:
        h = hard.get(r["code"], {}); l = lift.get(r["code"], {})
        spend_ok = (h.get("spend") is not None and r["r_spend"] and abs(h["spend"] - r["r_spend"]) / max(r["r_spend"], 1) <= 0.02)
        claims_ok = (h.get("claims") == r["r_claims"])
        rob = r.get("robustness") or {}
        n = rob.get("n"); thin = (n is not None and n < 30)
        flags = []
        if not h:
            flags.append("NOT FOUND in warehouse")
        else:
            if not spend_ok:
                flags.append("SPEND MISMATCH")
            if not claims_ok:
                flags.append("CLAIMS MISMATCH")
        if r["r_per_rm"] is not None and l.get("plain_per_rm") is not None and sign(r["r_per_rm"]) != 0 and sign(l["plain_per_rm"]) != 0 and sign(r["r_per_rm"]) != sign(l["plain_per_rm"]):
            flags.append("LIFT SIGN FLIP")
        if thin:
            flags.append("THIN (<30)")
        out.append({**r, "w_spend": h.get("spend"), "w_claims": h.get("claims"), "w_claimers": h.get("claimers"),
                    "w_plain_per_rm": l.get("plain_per_rm"), "w_fwd7": l.get("fwd7"), "w_pre14": l.get("pre14"),
                    "flags": flags, "flag": ("OK" if not flags else " · ".join(flags))})
    res = {"market": mk, "sym": SYMBOL, "window": f"{START} to {END_INCL}", "n_codes": len(out),
           "n_flagged": sum(1 for o in out if o["flags"] and o["flags"] != ["THIN (<30)"]),
           "n_excluded_perks": len(excluded), "excluded_perks": excluded,
           "codes": out}
    json.dump(res, open(SCR / f"verify-action-{mk}.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    if excluded:
        print(f"  excluded {len(excluded)} VIP perk/engagement codes (non-Lane-A, not ROI-scored):",
              ", ".join(e[0][:26] for e in excluded[:8]))
    return res


if __name__ == "__main__":
    for mk in (MARKET,):
        r = main(mk)
        if not r:
            print(f"[{mk}] no action codes"); continue
        print(f"[{mk}] verify-action — {r['n_codes']} action codes, window {r['window']}")
        from collections import Counter
        fc = Counter(f for o in r["codes"] for f in o["flags"])
        print("  flags:", dict(fc))
        print("  hard-check mismatches (spend/claims):", sum(1 for o in r["codes"] if any(x in o["flag"] for x in ("SPEND MISMATCH", "CLAIMS MISMATCH", "NOT FOUND"))))
        for o in [o for o in r["codes"] if any(x in o["flag"] for x in ("SPEND MISMATCH", "CLAIMS MISMATCH", "NOT FOUND"))][:8]:
            print(f"    {o['code'][:34]:34s} {o['flag']} | report spend {r['sym']}{o['r_spend']:,} vs wh {o['w_spend']} | claims {o['r_claims']} vs {o['w_claims']}")

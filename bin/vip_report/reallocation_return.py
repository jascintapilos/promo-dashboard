#!/usr/bin/env python3
"""Emit the `reallocation` block into vip-metrics-MY.json (VIP decision layer, P2).

Answers "what is the reinvestment worth". Reads ONLY existing scratchpad data
(no ClickHouse pulls):
  - surface-and-arithmetic pieces (this file, always): marginal-return-by-tier,
    the tier-climb funnel, and a reclaimable-Rescue *context* band (perk
    right-sizing, NOT an ROI cut).
  - directional causal pieces (added in Task 2): cost-per-retained-whale and
    recoverable fraction of the at-risk NGR — clearly labelled and holdout-gated.

Run: python bin/vip_report/reallocation_return.py
"""
import json, os

SCR = os.environ.get(
    "VIP_SCR",
    "C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/"
    "879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad",
)
VIPDIR = os.path.join(SCR, "vip")
PATH = os.path.join(VIPDIR, "vip-metrics-MY.json")

j = json.load(open(PATH, encoding="utf-8"))

BAND_ORDER = ["<RM50", "RM50–150", "RM150–400", "RM400–1000", "RM1000+"]
TIERS = ["Diamond", "Platinum", "Gold", "Silver", "Bronze"]


def band_idx(b):
    return BAND_ORDER.index(b) if b in BAND_ORDER else 99


# ---- 1) marginal-return-by-tier (return on the NEXT RM) ---------------------
# From sweet_by_tier.size_grid: per tier x size band, ngr_per_rm (net revenue per
# RM). The curve's sign flip is the marginal cut-off — spend past it loses money.
size_grid = (j.get("sweet_by_tier", {}) or {}).get("size_grid", []) or []
per_tier = {p.get("tier"): p for p in ((j.get("sweet_by_tier", {}) or {}).get("per_tier", []) or [])}
marginal_by_tier = []
for t in TIERS:
    rows = sorted([r for r in size_grid if r.get("tier") == t], key=lambda r: band_idx(r.get("key")))
    if not rows:
        continue
    curve = [{"band": r["key"], "spend": round(r.get("spend", 0)),
              "ngr_per_rm": r.get("ngr_per_rm"), "thin": bool(r.get("thin"))} for r in rows]
    solid = [c for c in curve if not c["thin"] and c["ngr_per_rm"] is not None]
    best = max(solid, key=lambda c: c["ngr_per_rm"], default=None)
    loses = [c["band"] for c in curve if (c["ngr_per_rm"] or 0) < 0]  # bands that lose money (curve can be non-monotonic)
    marginal_by_tier.append({
        "tier": t, "curve": curve,
        "sweet_band": (per_tier.get(t) or {}).get("sweet_band"),        # properly-computed sweet band
        "best_band": best["band"] if best else None,
        "best_ngr_per_rm": best["ngr_per_rm"] if best else None,
        "loses_bands": loses,
    })

# ---- 2) tier-climb funnel (reshape existing tier_migration) -----------------
tm = j.get("tier_migration", {}) or {}
migration_funnel = {
    "by_end_tier": tm.get("by_end_tier", []),
    "climbers": tm.get("climbers", {}),
    "held_grp": tm.get("held_grp", {}),
    "climbed": tm.get("climbed"), "held": tm.get("held"), "slid": tm.get("slid"),
    "insight": ("Climbers get more bonus AND return more than members who held "
                "(median bonus {cb} vs {hb}, median NGR {cn} vs {hn}) — the up-tier "
                "pipeline is real, so budget moved up the tiers funds growth, not just defence.").format(
        cb=tm.get("climbers", {}).get("med_bonus"), hb=tm.get("held_grp", {}).get("med_bonus"),
        cn=tm.get("climbers", {}).get("med_ngr"), hn=tm.get("held_grp", {}).get("med_ngr")),
}

# ---- 3) reclaimable-Rescue CONTEXT band (perk right-sizing, NOT a cut) -------
# Per-tier Rescue spend from the Lane B codes; base-rate lift says how little of
# the retention is incremental. Framed as context for a PERK, not an ROI target.
codes = j.get("codes", []) or []
base_rate = (j.get("cashback_validation", {}) or {}).get("base_rate", {}) or {}
rescue_spend_by_tier = {}
for c in codes:
    if c.get("lane") == "B-cashback":
        t = (c.get("tier_top") or "?").replace(" (Trial)", "").strip()
        rescue_spend_by_tier[t] = rescue_spend_by_tier.get(t, 0) + (c.get("spend") or 0)
reclaimable_rows = []
for t in TIERS:
    sp = rescue_spend_by_tier.get(t)
    if not sp:
        continue
    br = base_rate.get(t, {})
    untreated = br.get("untreated_redep")   # % who redeposit WITHOUT the rescue
    lift = br.get("lift_pp")
    # high end = the non-incremental share (would redeposit anyway); low end = 0 (it is a perk)
    high = round(sp * (untreated or 0) / 100) if untreated is not None else None
    reclaimable_rows.append({"tier": t, "rescue_spend": round(sp), "lift_pp": lift,
                             "untreated_redep": untreated, "reclaimable_low": 0, "reclaimable_high": high})
reclaimable_rescue = {
    "rows": reclaimable_rows,
    "total_spend": round(sum(rescue_spend_by_tier.values())),
    "note": ("This is PERK right-sizing context, not a cut. Judged purely as retention, most of "
             "the Rescue spend is non-incremental (losing VIPs redeposit ~96% with no rescue) — "
             "but it is a loyalty perk, so we reclaim RM0 by design; the gap is why it is scored "
             "as a perk, not an ROI lever. Only action: eligibility hygiene."),
}

# ---- 4) directional cost-per-retained-whale (observational, holdout-gated) --
# Do slipping whales who received a DEPOSIT-TIED bonus retain deposits better
# than those who did not? Observational + matched on tier only, so it reflects
# ASSOCIATION not causation (VMs target the worst decliners → selection). The
# matched holdout is the proof step; report the delta honestly whatever its sign.
led = json.load(open(os.path.join(VIPDIR, "member-ledger-MY.json"), encoding="utf-8"))
claims = json.load(open(os.path.join(VIPDIR, "claim-rows-MY.json"), encoding="utf-8"))
dep_req = {c.get("code"): bool(c.get("deposit_required")) for c in codes}
treated_members, tied_spend_by_member = set(), {}
for r in claims:
    if dep_req.get(r.get("code")):
        m = r.get("member")
        treated_members.add(m)
        tied_spend_by_member[m] = tied_spend_by_member.get(m, 0) + (r.get("bonus_cost") or 0)

whales = sorted([d for d in led if (d.get("ytd_ngr", 0) or 0) > 0], key=lambda d: -d["ytd_ngr"])
topn = max(1, round(len(led) * 0.10))                       # top 10% by YTD NGR
whale_set = whales[:topn]
slipping = [d for d in whale_set if (d.get("dep_h1", 0) or 0) > 0 and (d.get("dep_h2", 0) or 0) < (d.get("dep_h1", 0) or 0)]


def ret_rate(grp):                                          # kept >= half of H1 deposits into H2
    if not grp:
        return None
    kept = sum(1 for d in grp if (d.get("dep_h2", 0) or 0) >= 0.5 * (d.get("dep_h1", 0) or 0))
    return round(kept / len(grp), 3)


treated = [d for d in slipping if d["member"] in treated_members]
untreated = [d for d in slipping if d["member"] not in treated_members]
tr, ur = ret_rate(treated), ret_rate(untreated)
delta = round(tr - ur, 3) if (tr is not None and ur is not None) else None
tied_spend = round(sum(tied_spend_by_member.get(d["member"], 0) for d in treated))
extra_retained = round(delta * len(treated), 1) if delta is not None else None
cost_per = round(tied_spend / extra_retained) if (extra_retained and extra_retained > 0) else None

whale = (j.get("program", {}) or {}).get("whale", {}) or {}
var_ngr = whale.get("value_at_risk_ngr")
recoverable_ngr = round(var_ngr * delta) if (delta is not None and delta > 0 and var_ngr) else 0
positive = delta is not None and delta > 0
thin_control = len(untreated) < 30 or len(treated) < 30
treated_share = round(len(treated) / len(slipping) * 100) if slipping else None

if thin_control:
    signal = ("Almost every slipping whale ({sh}%) already gets deposit-tied bonuses, leaving only "
              "{nu} with no bonus to compare against — far too few to trust. The gap that's left "
              "(about {pp} percentage points more staying, on those {nu} untreated) is a hint at best; "
              "this is exactly why a proper holdout is needed."
              ).format(sh=treated_share, nu=len(untreated), pp=round((delta or 0) * 100))
elif positive:
    signal = "Deposit-tied bonuses ASSOCIATE with better whale retention (+{d}); directional, not yet causal.".format(d=delta)
else:
    signal = ("Observationally, targeted whales do NOT retain better (delta {d}) — consistent with VMs "
              "chasing the worst decliners (selection). More observational spend is not the answer; the "
              "holdout is.").format(d=delta)

cost_per_retained_whale = {
    "n_slipping_whales": len(slipping), "n_treated": len(treated), "n_untreated": len(untreated),
    "treated_share_pct": treated_share,
    "treated_retention": tr, "untreated_retention": ur, "delta": delta,
    "tied_bonus_spend": tied_spend,
    "cost_per_retained_whale": cost_per,
    "control_confidence": "low — thin control group" if thin_control else "moderate",
    "signal": signal,
    "caveat": "Observational, matched on tier only — association not causation (selection + mean reversion), "
              "and the control group is tiny. Treat the numbers as illustrative, not a forecast.",
    "gated_on": "Lane A / retention matched holdout (bin/vip_report/frequency-cap-holdout-spec.md)",
}
recoverable_fraction = {
    "fraction": delta, "at_risk_ngr": var_ngr,
    "recoverable_ngr_directional": recoverable_ngr,
    "caveat": "Directional only — applies the observational retention delta to the at-risk NGR; 0 if the "
              "delta is not positive. The holdout is the proof step before banking any of it.",
}
total_upside = {
    "freed_floor": 228000, "recoverable_ngr_directional": recoverable_ngr,
    "illustrative_only": bool(thin_control or not positive),
    "note": ("ILLUSTRATIVE, not a forecast. If the freed ~RM228k floor is redeployed to slipping whales and the "
             "observational retention gap held, the recoverable NGR would be about the figure above — but that "
             "gap rests on a tiny control group, so it is not bankable. Redeploy via a small controlled test, "
             "not at scale; the holdout is the proof step."),
}

reallocation = {
    "marginal_by_tier": marginal_by_tier,
    "migration_funnel": migration_funnel,
    "reclaimable_rescue": reclaimable_rescue,
    "cost_per_retained_whale": cost_per_retained_whale,
    "recoverable_fraction": recoverable_fraction,
    "total_upside": total_upside,
    "basis": ("marginal-return-by-tier and the migration funnel are from existing computed blocks; the "
              "reclaimable-Rescue band is perk right-sizing context (not a cut); cost-per-retained-whale / "
              "recoverable fraction are DIRECTIONAL observational estimates, holdout-gated."),
}

# ---- report (Task 1 does not write; Task 2 completes + writes) --------------
print("reallocation (Task 1 pieces):")
print("  marginal_by_tier:")
for m in marginal_by_tier:
    print(f"    {m['tier']:9s} sweet {m['sweet_band']} · best {m['best_band']} ({m['best_ngr_per_rm']}/RM) · loses {m['loses_bands']}")
print(f"  migration funnel: climbers med_bonus {migration_funnel['climbers'].get('med_bonus')} vs held {migration_funnel['held_grp'].get('med_bonus')}")
print("  reclaimable_rescue (perk context):")
for r in reclaimable_rows:
    print(f"    {r['tier']:9s} spend RM{r['rescue_spend']:,} · lift {r['lift_pp']}pp · reclaimable(if-retention) 0..RM{r['reclaimable_high']:,}")
print("  cost-per-retained-whale (DIRECTIONAL, holdout-gated):")
print(f"    slipping whales {len(slipping)} | treated {len(treated)} (ret {tr}) vs untreated {len(untreated)} (ret {ur}) | delta {delta}")
print(f"    tied-bonus spend RM{tied_spend:,} | cost/retained {cost_per} | recoverable NGR (directional) RM{recoverable_ngr:,}")
print(f"    signal: {cost_per_retained_whale['signal']}")

j["reallocation"] = reallocation
json.dump(j, open(PATH, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print(f"\nreallocation block written -> {PATH}")

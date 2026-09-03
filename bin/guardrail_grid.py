#!/usr/bin/env python3
"""Guardrail grid — lifecycle x tier x mechanic, at YG's "Cooling Diamond + Free Credit"
granularity. Joins the claim-rows (tier + recency-at-claim + performance) to the redeposit
TIMING pull (bin/redep_timing.py) + the code metrics (mechanic + size + deposit flag), so each
cell carries what a guardrail needs: observed size range, net-revenue-per-RM by size (where it
pays), redeposit rate + median days-to-redeposit (expected behaviour), and the paying
alternative mechanic in the same segment.

Gated by a minimum claim count per cell; thin cells are reported but flagged
requires_validation. No hard rules invented — observed sweet spot is kept distinct from a
suggested guardrail. Reads scratchpad claim-rows + metrics + redep-timing (no DB).
Out: scratchpad/guardrails-{MK}.json     Run: python bin/guardrail_grid.py
"""
import json, os, sys, statistics
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bonus_family import mech_label, family_of

SCR = os.environ.get("SCRATCH") or (
    r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad")
MIN_N = 25  # claims per cell to grade; below this -> requires_validation

# money-denominated size bands (MYR edges rescaled per market; S$1 ~ RM3.3)
BAND_EDGES_MYR = [50, 100, 300, 700]
MYR_PER_UNIT = {"MY": 1.0, "SG": 3.3}


def load(p):
    fp = os.path.join(SCR, p)
    return json.load(open(fp, encoding="utf-8")) if os.path.exists(fp) else None


def lifecycle(recency):
    if recency is None: return None
    if recency <= 14: return "Active (0-14d)"
    if recency <= 30: return "Cooling (15-30d)"
    if recency <= 60: return "Dormant (31-60d)"
    return "Lapsed (61-120d)"


def norm_tier(t):
    t = (t or "Unknown").replace(" (Trial)", "")
    return t


def bands(mk):
    d = MYR_PER_UNIT[mk]; step = 5 if d > 1 else 1
    e = [round(x / d / step) * step for x in BAND_EDGES_MYR]
    sym = "RM" if mk == "MY" else "S$"
    out, lo = [], 0
    for hi in e:
        out.append((f"under {sym}{e[0]}" if lo == 0 else f"{sym}{lo}-{hi}", lo, hi)); lo = hi
    out.append((f"{sym}{e[-1]}+", e[-1], None))
    return out


def band_of(v, bs):
    if v is None: return None
    for label, lo, hi in bs:
        if v >= lo and (hi is None or v < hi): return label
    return None


def per_rm(ng, sp): return round(ng / sp, 2) if sp else None


def analyse(mk):
    ret, vip = load(f"ret/ret-metrics-{mk}.json"), load(f"vip/vip-metrics-{mk}.json")
    tim = load(f"redep-timing-{mk}.json") or {}
    if not ret or not vip:
        return None
    BS = bands(mk)
    # code -> (mechanic, size, family)
    cmeta = {}
    for pillar, m, sk in (("ret", ret, "avg_bonus_per_claim"), ("vip", vip, "avg_amount")):
        for c in m["codes"]:
            cmeta[c["code"].strip()] = (mech_label(c.get("mechanic")), c.get(sk), family_of(c), pillar)

    # cell key = (lifecycle, tier, mechanic)
    cells = defaultdict(lambda: {"n": 0, "spend": 0.0, "ngr": 0.0, "sizes": [], "redep": [], "redep30": 0, "redepden": 0,
                                 "byband": defaultdict(lambda: [0, 0.0, 0.0])})
    # per (lifecycle,tier) mechanic comparison for the alternative
    seg_mech = defaultdict(lambda: defaultdict(lambda: [0.0, 0.0]))  # (life,tier)->mech->[spend,ngr]

    for f in (f"ret/claim-rows-{mk}.json", f"vip/claim-rows-{mk}.json"):
        for r in (load(f) or []):
            meta = cmeta.get((r.get("code") or "").strip())
            if not meta:
                continue
            mech, size, fam, pillar = meta
            life = lifecycle(r.get("recency_days"))
            tier = norm_tier(r.get("tier"))
            if not life:
                continue
            key = (life, tier, mech)
            cl = r.get("claims") or 1
            bc = r.get("bonus_cost") or 0
            ng = r.get("ngr_lift") or 0
            cell = cells[key]
            cell["n"] += cl; cell["spend"] += bc; cell["ngr"] += ng
            if size is not None:
                cell["sizes"].append(size)
                b = band_of(size, BS)
                if b:
                    a = cell["byband"][b]; a[0] += cl; a[1] += bc; a[2] += ng
            seg_mech[(life, tier)][mech][0] += bc; seg_mech[(life, tier)][mech][1] += ng
            # redeposit timing
            dd = tim.get(f"{r.get('member')}|{r.get('claim_date')}")
            if dd is not None:
                cell["redep"].append(dd); cell["redep30"] += 1
            cell["redepden"] += 1

    def quant(xs, q):
        if not xs: return None
        xs = sorted(xs); i = min(len(xs) - 1, int(q * (len(xs) - 1)))
        return round(xs[i])

    grid = []
    for (life, tier, mech), cell in cells.items():
        if cell["n"] < 5:
            continue
        pr = per_rm(cell["ngr"], cell["spend"])
        size_bands = []
        best = None
        for label, lo, hi in BS:
            if label in cell["byband"]:
                a = cell["byband"][label]; bpr = per_rm(a[2], a[1])
                size_bands.append({"band": label, "n": a[0], "spend": round(a[1]), "per_rm": bpr})
                if bpr is not None and (best is None or bpr > best[1]):
                    best = (label, bpr)
        redn = cell["redepden"] or 1
        red = cell["redep"]
        # paying alternative in the same (lifecycle,tier): best-per-rm mechanic that isn't this one
        alts = seg_mech[(life, tier)]
        alt = None
        cand = [(m, per_rm(v[1], v[0])) for m, v in alts.items() if m != mech and v[0] and per_rm(v[1], v[0]) is not None]
        cand = [x for x in cand if x[1] > (pr or -9)]
        if cand:
            alt = max(cand, key=lambda x: x[1])
        grid.append({
            "lifecycle": life, "tier": tier, "mechanic": mech,
            "n": cell["n"], "spend": round(cell["spend"]), "per_rm": pr,
            "size_p25": quant(cell["sizes"], .25), "size_median": quant(cell["sizes"], .5), "size_p75": quant(cell["sizes"], .75),
            "best_size_band": best[0] if best else None, "best_band_per_rm": best[1] if best else None,
            "size_bands": size_bands,
            "redeposit_30d_pct": round(100 * cell["redep30"] / redn, 1),
            "median_days_to_redep": round(statistics.median(red)) if red else None,
            "alt_mechanic": alt[0] if alt else None, "alt_per_rm": alt[1] if alt else None,
            "graded": cell["n"] >= MIN_N,
        })
    grid.sort(key=lambda g: (-g["spend"]))
    return {"market": mk, "sym": "RM" if mk == "MY" else "S$", "min_n": MIN_N,
            "cells": grid,
            "basis": ("lifecycle (recency at claim) x tier x mechanic. per_rm = sum(ngr_lift)/sum(bonus_cost) "
                      "(7-day attributed, directional). redeposit_30d = share of claims whose member deposited "
                      "again within 30 days; median_days_to_redep from bin/redep_timing.py. Observed sweet spot "
                      "(best_size_band) is kept distinct from a suggested guardrail. Cells under min_n are "
                      "requires_validation. Not causal — the holdout is the proof.")}


if __name__ == "__main__":
    for mk in ("MY", "SG"):
        res = analyse(mk)
        if not res:
            print(f"[{mk}] skip"); continue
        path = os.path.join(SCR, f"guardrails-{mk}.json")
        json.dump(res, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        graded = [c for c in res["cells"] if c["graded"]]
        print(f"[{mk}] {os.path.basename(path)} — {len(res['cells'])} cells, {len(graded)} graded (n>={res['min_n']})")
        for c in sorted(graded, key=lambda x: (x["mechanic"], -x["spend"]))[:14]:
            print(f"  {c['lifecycle']:16s} {c['tier']:9s} {c['mechanic']:11s} n={c['n']:>5} {res['sym']}{c['spend']:>8,} "
                  f"| {res['sym']}{c['per_rm']}/RM | best {c['best_size_band']} | redep30 {c['redeposit_30d_pct']}% ~{c['median_days_to_redep']}d"
                  + (f" | alt {c['alt_mechanic']} {res['sym']}{c['alt_per_rm']}" if c['alt_mechanic'] else ""))

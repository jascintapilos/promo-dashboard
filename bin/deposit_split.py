"""Attach the pulled promo config to each pillar and aggregate the deposit-required
vs no-deposit split (with a wagering cut) so each tab can judge no-deposit bonuses.

Reads scratchpad/promo-config-MY.json (from pull_promo_config.py) and each pillar's
metrics. Adds per-code deposit_required / min_deposit / wagering, and emits a
`deposit_split` block: the pillar's own judge metric split by deposit-required vs
no-deposit, plus a wagering-band cut over the no-deposit codes (the recover-the-cost
lever). Config only. Run after pull_promo_config.py.
Usage: python bin/deposit_split.py
"""
import json
from pathlib import Path

S = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad")
cfg = json.load(open(S / "promo-config-MY.json", encoding="utf-8"))

def wband(w):
    if w is None: return "?"
    if w <= 0: return "none (0×)"
    if w < 5: return "low (1–4×)"
    if w < 8: return "mid (5–7×)"
    return "high (8×+)"

def attach(codes):
    """add deposit_required/min_deposit/wagering to each code; return grouping key."""
    for c in codes:
        v = cfg.get(c["code"])
        if v:
            c["deposit_required"] = v["deposit_required"]; c["min_deposit"] = v["min_deposit"]; c["wagering_x"] = v["wagering"]
        else:
            c["deposit_required"] = None; c["min_deposit"] = None; c["wagering_x"] = None

def group_key(c):
    return "unknown" if c["deposit_required"] is None else ("deposit" if c["deposit_required"] else "no_deposit")

def acq_metric(rs):
    sn = sum(c.get("spend_new", 0) for c in rs); ftd = sum(c.get("ftd", 0) for c in rs); clm = sum(c.get("claimers", 0) for c in rs)
    return {"codes": len(rs), "spend": round(sum(c.get("spend", 0) for c in rs)),
            "cost_per_ftd": round(sn / ftd) if ftd else None, "ftd": ftd,
            "conversion": round(ftd / clm * 100, 1) if clm else None}

def money_metric(rs):
    sp = sum(c.get("spend", 0) for c in rs); ng = sum(c.get("ngr_lift", 0) for c in rs)
    return {"codes": len(rs), "spend": round(sp), "ngr_lift": round(ng),
            "ngr_lift_per_rm": round(ng / sp, 2) if sp else None}

def build(path, metric_fn, lane_filter=None):
    m = json.load(open(S / path, encoding="utf-8"))
    attach(m["codes"])
    pool = [c for c in m["codes"] if (lane_filter(c) if lane_filter else True)]
    groups = {}
    for g in ("deposit", "no_deposit", "unknown"):
        rs = [c for c in pool if group_key(c) == g]
        if rs: groups[g] = metric_fn(rs)
    # wagering cut over the no-deposit codes (does higher wagering recover the cost?)
    nd = [c for c in pool if group_key(c) == "no_deposit"]
    bands = {}
    for c in nd:
        bands.setdefault(wband(c["wagering_x"]), []).append(c)
    order = ["none (0×)", "low (1–4×)", "mid (5–7×)", "high (8×+)"]
    wager_bands = [dict(band=b, **metric_fn(bands[b])) for b in order if b in bands]
    m["deposit_split"] = {"groups": groups, "no_deposit_by_wagering": wager_bands,
                          "matched": sum(1 for c in pool if c["deposit_required"] is not None), "total": len(pool),
                          "basis": "Deposit-required vs no-deposit from BO promo config (min-deposit / deposit-requirement / % structure). Wagering = rollover/winover multiplier. No-deposit bonuses are pure cost up front; judge them on what they trigger, and read the wagering bands for whether the cost is recoverable."}
    json.dump(m, open(S / path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    return m["deposit_split"]

specs = [
    ("acq/acq-metrics-MY.json", acq_metric, None, "ACQUISITION (cost per new depositor, lower better)"),
    ("ret/ret-metrics-MY.json", money_metric, None, "RETENTION (net rev per RM1, higher better)"),
    ("vip/vip-metrics-MY.json", money_metric, (lambda c: c.get("lane") in ("A-performance", "D-engagement")), "VIP money-judged (net rev per RM1)"),
]
for path, fn, lf, label in specs:
    ds = build(path, fn, lf)
    g = ds["groups"]
    print(f"\n{label} — matched {ds['matched']}/{ds['total']}")
    for k in ("deposit", "no_deposit", "unknown"):
        if k in g:
            d = g[k]
            extra = (f"cost/FTD RM{d['cost_per_ftd']} · conv {d['conversion']}%" if "cost_per_ftd" in d else f"net rev/RM1 RM{d['ngr_lift_per_rm']}")
            print(f"  {k:11s} {d['codes']:>4} codes · RM{d['spend']:>10,} · {extra}")
    if ds["no_deposit_by_wagering"]:
        print("  no-deposit by wagering:")
        for b in ds["no_deposit_by_wagering"]:
            extra = (f"cost/FTD RM{b.get('cost_per_ftd')}" if "cost_per_ftd" in b else f"net rev/RM1 RM{b.get('ngr_lift_per_rm')}")
            print(f"    {b['band']:12s} {b['codes']:>4} codes · RM{b['spend']:>10,} · {extra}")
print("\nMerged deposit_split into all three pillar metrics.")

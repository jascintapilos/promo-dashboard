#!/usr/bin/env python3
"""Executive-overview roll-up (redesign gap A) — the cross-book management-actions layer.

Normalises each pillar's per-code decision vocab to the 5 exec categories
(SCALE / MAINTAIN / OPTIMIZE / REDUCE / STOP) + a WATCH/OTHER bucket for unscored
(too-new / perk / referral), and produces: decision counts (total + by pillar),
pillar spend + shares, a ranked top-5 actions list by spend-at-stake, and the
whole-book (money-judged) efficiency. Reads the already-built metrics (no DB).
Out: scratchpad/exec-{MK}.json.   Run: python bin/exec_rollup.py
"""
import json, os

SCR = os.environ.get("SCRATCH") or (
    r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad")

MAP = {
    "Scale": "SCALE",
    "Maintain": "MAINTAIN", "Keep": "MAINTAIN", "Hold": "MAINTAIN",
    "Optimise": "OPTIMIZE", "Optimize": "OPTIMIZE", "Review": "OPTIMIZE", "Tune": "OPTIMIZE",
    "Reduce": "REDUCE", "Trim": "REDUCE",
    "Stop": "STOP",
    "Watch-money": "WATCH", "Monitor": "WATCH", "Low volume": "WATCH",
    "Entitlement": "OTHER", "Referral": "OTHER", "Reload": "OTHER",
}
HEAD = ["SCALE", "MAINTAIN", "OPTIMIZE", "REDUCE", "STOP"]
MOVE_OUT = {"REDUCE", "STOP"}


def load(p):
    fp = os.path.join(SCR, p)
    return json.load(open(fp, encoding="utf-8")) if os.path.exists(fp) else None


def build(mk):
    acq, ret, vip = load(f"acq/acq-metrics-{mk}.json"), load(f"ret/ret-metrics-{mk}.json"), load(f"vip/vip-metrics-{mk}.json")
    if not (acq and ret and vip):
        return None
    sym = "RM" if mk == "MY" else "S$"
    pillars = [("Acquisition", acq), ("Retention", ret), ("VIP", vip)]
    counts = {c: 0 for c in HEAD + ["WATCH", "OTHER"]}
    by_pillar = {}
    pillar_spend = {}
    cat_spend = {}  # (pillar, cat) -> [codes, spend]
    for name, m in pillars:
        pc = {c: 0 for c in HEAD + ["WATCH", "OTHER"]}
        sp = 0.0
        for c in m["codes"]:
            cat = MAP.get(c.get("decision"), "WATCH")
            counts[cat] += 1
            pc[cat] += 1
            s = c.get("spend") or 0
            sp += s
            k = (name, cat)
            a = cat_spend.setdefault(k, [0, 0.0])
            a[0] += 1
            a[1] += s
        by_pillar[name] = pc
        pillar_spend[name] = round(sp)
    total = sum(pillar_spend.values())
    shares = {k: (round(100 * v / total, 1) if total else 0) for k, v in pillar_spend.items()}

    # top actions ranked by spend-at-stake (money to move out first, then scale)
    acts = []
    for (name, cat), (n, s) in cat_spend.items():
        if s <= 0:
            continue
        if cat == "STOP":
            acts.append({"pillar": name, "cat": cat, "codes": n, "spend": round(s), "verb": "Stop",
                         "text": f"Stop the {n} losing codes in {name} (~{sym}{round(s):,} exposed)"})
        elif cat == "REDUCE":
            acts.append({"pillar": name, "cat": cat, "codes": n, "spend": round(s), "verb": "Right-size",
                         "text": f"Right-size {name} — {n} codes at ~{sym}{round(s):,} (reduce, don't cut)"})
        elif cat == "SCALE":
            acts.append({"pillar": name, "cat": cat, "codes": n, "spend": round(s), "verb": "Scale",
                         "text": f"Scale the {n} winners in {name} (~{sym}{round(s):,})"})
    acts.sort(key=lambda a: -a["spend"])
    top_actions = acts[:5]

    # whole-book (money-judged) efficiency = ret+vip net-rev-lift per RM (Acq is cost-judged)
    ng = sum((c.get("ngr_lift") or 0) for c in ret["codes"]) + sum((c.get("ngr_lift") or 0) for c in vip["codes"])
    sp = sum((c.get("spend") or 0) for c in ret["codes"]) + sum((c.get("spend") or 0) for c in vip["codes"])
    wholebook = round(ng / sp, 2) if sp else None

    return {"market": mk, "sym": sym,
            "counts": counts, "by_pillar": by_pillar,
            "pillar_spend": pillar_spend, "pillar_share": shares, "total_spend": total,
            "top_actions": top_actions, "wholebook_per_rm": wholebook,
            "basis": ("Per-code decisions normalised to 5 categories across all pillars (WATCH = too new/thin, "
                      "OTHER = perk/referral). Spend-at-stake ranks the moves. Whole-book per-RM1 = net-revenue-lift / "
                      "spend across Retention + VIP (money-judged); Acquisition is cost-judged separately. Directional.")}


if __name__ == "__main__":
    for mk in ("MY", "SG"):
        r = build(mk)
        if not r:
            print(f"[{mk}] skip"); continue
        json.dump(r, open(os.path.join(SCR, f"exec-{mk}.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print(f"[{mk}] exec-{mk}.json — counts {[(c, r['counts'][c]) for c in ['SCALE','MAINTAIN','OPTIMIZE','REDUCE','STOP']]} "
              f"watch={r['counts']['WATCH']} other={r['counts']['OTHER']}")
        print(f"      spend {r['sym']}{r['total_spend']:,} (Acq {r['pillar_share']['Acquisition']}% / Ret {r['pillar_share']['Retention']}% / VIP {r['pillar_share']['VIP']}%) | whole-book {r['sym']}{r['wholebook_per_rm']}/RM")
        for a in r["top_actions"]:
            print("      *", a["text"])

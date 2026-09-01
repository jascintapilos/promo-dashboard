#!/usr/bin/env python3
"""Bonus value-over-tenure — the short-horizon (30/60/90) analysis, per pillar, per family.

Families split by the deposit flag (bin/bonus_family.family_of):
  give-back = no-min-deposit giveaway  -> also flags keeper vs hunter
  deposit   = min-deposit bonus        -> player already deposited, no "hunter"

For each pillar (Retention, VIP) x family the card answers Jascinta's question —
"do their deposits justify the length of time they stay?":
  * STAY (tenure): share of matured claims still depositing at 30/60/90, and the average
    number of deposit-active days in the window (dep_days_* = literally how long they stay).
  * WORTH-IT (value): net-revenue-lift per RM1 of bonus (payback), overall + by bonus size.
  * KEEPER vs HUNTER (give-back only): share of matured-30 claims that never deposited.

VIP excludes lane D-engagement (mini-games, program-judged elsewhere) from BOTH families;
the excluded spend is disclosed. Unclassified (no deposit flag) codes are disclosed, never
folded. LTV (YTD + lifetime) is a separate warehouse pass (lifetime_by_bonus.py).

Reads scratchpad ret/vip metrics + claim-rows (no DB). Writes scratchpad/bonus-{MK}.json.
Usage: python bin/bonus_value_analysis.py
"""
import json, os, sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bonus_family import family_of, mech_label

SCRATCH = os.environ.get("SCRATCH") or (
    r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad")

# money-denominated size bands: MYR edges, rescaled per market (S$1 ~ RM3.3). Never a symbol swap.
BAND_EDGES_MYR = [50, 100, 300, 700]
MYR_PER_UNIT = {"MY": 1.0, "SG": 3.3}


def band_defs(mk):
    """(label, lo, hi) bands in the market's own currency, rounded to a tidy step."""
    d = MYR_PER_UNIT[mk]
    step = 5 if d > 1 else 1
    e = [round(x / d / step) * step for x in BAND_EDGES_MYR]
    sym = "RM" if mk == "MY" else "S$"
    out, lo = [], 0
    for hi in e:
        out.append((f"under {sym}{e[0]}" if lo == 0 else f"{sym}{lo}-{hi}", lo, hi))
        lo = hi
    out.append((f"{sym}{e[-1]}+", e[-1], None))
    return out


def band_of(size, bands):
    if size is None:
        return None
    for label, lo, hi in bands:
        if size >= lo and (hi is None or size < hi):
            return label
    return None


def size_of(code, pillar):
    return code.get("avg_bonus_per_claim") if pillar == "retention" else code.get("avg_amount")


def per_rm(ng, sp):
    return round(ng / sp, 2) if sp else None


def analyse(mk):
    def _l(p):
        fp = os.path.join(SCRATCH, p)
        return json.load(open(fp, encoding="utf-8")) if os.path.exists(fp) else None
    ret, vip = _l(f"ret/ret-metrics-{mk}.json"), _l(f"vip/vip-metrics-{mk}.json")
    if not ret or not vip:
        print(f"[{mk}] skip — metrics missing")
        return None
    bands = band_defs(mk)
    out = {"market": mk, "sym": "RM" if mk == "MY" else "S$", "pillars": {}, "unclassified": {}}

    for pillar, m, claim_file in (("retention", ret, f"ret/claim-rows-{mk}.json"),
                                  ("vip", vip, f"vip/claim-rows-{mk}.json")):
        # VIP: drop lane D-engagement from the family analysis (program-judged elsewhere) — disclose it
        excluded = None
        codes = m["codes"]
        if pillar == "vip":
            dropped = [c for c in codes if c.get("lane") == "D-engagement"]
            excluded = {"lane": "D-engagement", "codes": len(dropped),
                        "spend": round(sum(c.get("spend") or 0 for c in dropped))}
            codes = [c for c in codes if c.get("lane") != "D-engagement"]

        # classify + per-code index for the claim-row pass
        idx = {}   # code -> (family, size, mechanic-label)
        fam_codes = defaultdict(list)
        unclass = {"codes": 0, "spend": 0.0}
        for c in codes:
            fam = family_of(c)
            idx[c["code"]] = (fam, size_of(c, pillar), mech_label(c.get("mechanic")))
            if fam == "unclassified":
                unclass["codes"] += 1
                unclass["spend"] += (c.get("spend") or 0)
                continue
            fam_codes[fam].append(c)
        unclass["spend"] = round(unclass["spend"])
        out["unclassified"][pillar] = unclass

        # claim-rows -> per-family stay/keeper-hunter
        claims = _l(claim_file) or []
        stay = {f: {w: {"mat": 0, "still": 0, "days": 0} for w in (30, 60, 90)} for f in ("give-back", "deposit")}
        kh = {"matured": 0, "hunters": 0}
        for r in claims:
            info = idx.get(r.get("code"))
            if not info:
                continue
            fam = info[0]
            if fam not in stay:
                continue
            for w in (30, 60, 90):
                if r.get(f"mature_{w}"):
                    s = stay[fam][w]
                    dd = r.get(f"dep_days_{w}") or 0
                    s["mat"] += 1
                    s["days"] += dd
                    if dd > 0:
                        s["still"] += 1
            if fam == "give-back" and r.get("mature_30"):
                kh["matured"] += 1
                if (r.get("dep_days_30") or 0) == 0:
                    kh["hunters"] += 1

        families = {}
        for fam, cs in fam_codes.items():
            spend = sum(c.get("spend") or 0 for c in cs)
            ng = sum(c.get("ngr_lift") or 0 for c in cs)
            # mechanic breakdown
            mech = defaultdict(lambda: [0, 0.0, 0.0])
            for c in cs:
                a = mech[mech_label(c.get("mechanic"))]
                a[0] += 1; a[1] += (c.get("spend") or 0); a[2] += (c.get("ngr_lift") or 0)
            mechs = [{"mechanic": k, "codes": v[0], "spend": round(v[1]), "per_rm": per_rm(v[2], v[1])}
                     for k, v in sorted(mech.items(), key=lambda x: -x[1][1])]
            # size bands
            acc = defaultdict(lambda: [0, 0.0, 0.0])
            for c in cs:
                b = band_of(size_of(c, pillar), bands)
                if b is None:
                    continue
                a = acc[b]; a[0] += 1; a[1] += (c.get("spend") or 0); a[2] += (c.get("ngr_lift") or 0)
            size_bands, flip, profitable = [], None, []
            for label, lo, hi in bands:
                if label in acc:
                    a = acc[label]
                    pr = per_rm(a[2], a[1])
                    size_bands.append({"band": label, "codes": a[0], "spend": round(a[1]), "per_rm": pr})
                    if pr is not None and pr >= 0:
                        profitable.append(label)
                    elif pr is not None and pr < 0 and flip is None:
                        flip = label
            # stay
            st = {}
            for w in (30, 60, 90):
                s = stay[fam][w]
                st[f"d{w}"] = {"matured": s["mat"],
                               "still_pct": round(100 * s["still"] / s["mat"], 1) if s["mat"] else None,
                               "avg_dep_days": round(s["days"] / s["mat"], 1) if s["mat"] else None}
            block = {"codes": len(cs), "spend": round(spend), "ngr_lift": round(ng), "per_rm": per_rm(ng, spend),
                     "mechanics": mechs, "size_bands": size_bands, "flip_band": flip,
                     "profitable_bands": profitable, "stay": st}
            if fam == "give-back":
                block["keeper_hunter"] = {
                    "matured": kh["matured"],
                    "hunter_pct": round(100 * kh["hunters"] / kh["matured"], 1) if kh["matured"] else None,
                    "keeper_pct": round(100 * (kh["matured"] - kh["hunters"]) / kh["matured"], 1) if kh["matured"] else None}
            families[fam] = block

        out["pillars"][pillar] = {"families": families, "excluded": excluded}
    return out


if __name__ == "__main__":
    for mk in ("MY", "SG"):
        res = analyse(mk)
        if not res:
            continue
        path = os.path.join(SCRATCH, f"bonus-{mk}.json")
        json.dump(res, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print(f"\n===== [{mk}] wrote {os.path.basename(path)} =====")
        for pillar, pd in res["pillars"].items():
            exc = pd["excluded"]
            print(f" {pillar.upper()}" + (f"  (excl {exc['lane']}: {exc['codes']}c/{exc['spend']:,})" if exc else ""))
            for fam, b in pd["families"].items():
                kh = b.get("keeper_hunter")
                khs = f" | hunters {kh['hunter_pct']}%" if kh else ""
                d90 = b["stay"]["d90"]
                print(f"   {fam:10s} {b['codes']:3d}c {res['sym']}{b['spend']:>9,} | {res['sym']}{b['per_rm']}/RM"
                      f" | stay90 {d90['still_pct']}% ~{d90['avg_dep_days']}d | flip {b['flip_band']}{khs}")
            uc = res["unclassified"][pillar]
            print(f"   unclassified {uc['codes']}c / {res['sym']}{uc['spend']:,}")

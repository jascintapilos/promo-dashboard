#!/usr/bin/env python3
"""Assemble the full explorer payload from the extracted sheet tables + source JSONs.

Reads scratchpad/explorer-data.json (faithful per-code union, money by-code, verification, seg grid)
and enriches each code with filter dimensions (bonus type, deposit band, tier) from verify-action +
who_targeted, then computes the aggregate tables (deposit-band summary, money summary by pillar x type,
calls distribution, the config ladder). Out: scratchpad/explorer-payload.json  (inlined into the HTML).
"""
import json, os, sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

SCR = Path(__import__("os").environ.get("PROMO_SCRATCH", r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad"))
# Per-code report window (DATA.period) comes from csir_config (START .. END_EXCL). Import is
# best-effort so the pure-local tail still runs if csir_config/clickhouse_connect is unavailable.
try:
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    import csir_config as _cfg
    PERIOD = f"{_cfg.START} .. {_cfg.END_EXCL}"
    WIN_EXPLICIT = bool(getattr(_cfg, "WINDOW_EXPLICIT", False))   # True = a custom window was picked (not the default auto-YTD)
except Exception:
    PERIOD = None
    WIN_EXPLICIT = False
def load(p):
    fp = SCR / p
    return json.load(open(fp, encoding="utf-8")) if fp.exists() else None

EX = load("explorer-data.json")

# ---- churn fall-rates + reactivation (from segment-migration-{mk}.json; observed 90d flow) ----
_STA = ["Active", "Cooling", "Lapsed", "Dormant"]; _BND = ["Whale", "High", "Mid", "Low"]
def derive_migration(mk):
    d = load(f"segment-migration-{mk}.json")
    if not d:
        return None
    tx = d["transitions"]; so = {s: i for i, s in enumerate(_STA)}; bo = {b: i for i, b in enumerate(_BND)}
    fromtot = {s: 0 for s in _STA}; mat = {s: {t: 0 for t in _STA} for s in _STA}
    for r in tx:
        fromtot[r["fs"]] += r["members"]; mat[r["fs"]][r["ts"]] += r["members"]
    cascade = [{"from": s, "base": fromtot[s],
                "pct": {t: (round(mat[s][t] / fromtot[s] * 100) if fromtot[s] else 0) for t in _STA}} for s in _STA]
    hv_from = hv_worse = hv_act = hv_act_fell = 0
    for r in tx:
        if r["fb"] in ("Whale", "High"):
            hv_from += r["members"]
            if so[r["ts"]] > so[r["fs"]]: hv_worse += r["members"]
            if r["fs"] == "Active":
                hv_act += r["members"]
                if r["ts"] != "Active": hv_act_fell += r["members"]
    down = up = same = 0
    for r in tx:
        if bo[r["tb"]] > bo[r["fb"]]: down += r["members"]
        elif bo[r["tb"]] < bo[r["fb"]]: up += r["members"]
        else: same += r["members"]
    dtot = down + up + same or 1
    pool = d["reactivation"]["pool_by_band"]; rows = d["reactivation"]["rows"]
    ret = {b: 0 for b in _BND}; rngr = {b: 0.0 for b in _BND}; buck = {}
    for r in rows:
        ret[r["band"]] += r["members"]; rngr[r["band"]] += r["recovered_ngr"]
        buck[r["bucket"]] = buck.get(r["bucket"], 0) + r["members"]
    tret = sum(buck.values()) or 1
    return {
        "tThen": d["meta"]["t_then"], "tNow": d["meta"]["t_now"], "horizon": d["meta"]["horizon_days"],
        "cohort": sum(fromtot.values()), "cascade": cascade,
        "hv": {"from": hv_from, "worse": hv_worse, "worsePct": round(hv_worse / (hv_from or 1) * 100),
               "activeThen": hv_act, "activeFell": hv_act_fell, "activeFellPct": round(hv_act_fell / (hv_act or 1) * 100)},
        "drift": {"down": down, "up": up, "same": same, "downPct": round(down / dtot * 100),
                  "upPct": round(up / dtot * 100), "samePct": round(same / dtot * 100)},
        "react": {"byBand": [{"band": b, "pool": pool.get(b, 0), "returned": ret[b],
                              "retPct": round(ret[b] / pool[b] * 100, 1) if pool.get(b) else 0, "ngr": round(rngr[b])} for b in _BND],
                  "speed": {k: round(buck.get(k, 0) / tret * 100) for k in ("<=7", "8-30", "31-60", ">60")}},
    }


def derive_trialband(mk):
    d = load(f"trial-band-{mk}.json")
    if not d:
        return None
    g = d["grid"]
    def seg(r):
        return r["tier"] if r["tier"] in ("Classic/None", "Bronze") else ("VIP-Trial" if r["trial"] else "VIP-Full")
    SEGS = ["Classic/None", "Bronze", "VIP-Trial", "VIP-Full"]
    bands = []
    for band in _BND:
        tot = sum(r["members"] for r in g if r["band"] == band)
        segs = {s: sum(r["members"] for r in g if r["band"] == band and seg(r) == s) for s in SEGS}
        bands.append({"band": band, "total": tot, "segs": segs, "ngr": round(sum(r["ngr"] for r in g if r["band"] == band))})
    vip = []
    for tier in ("Diamond", "Platinum", "Gold", "Silver"):
        full = sum(r["members"] for r in g if r["tier"] == tier and not r["trial"])
        trial = sum(r["members"] for r in g if r["tier"] == tier and r["trial"])
        if full + trial:
            vip.append({"tier": tier, "full": full, "trial": trial, "trialPct": round(trial / (full + trial) * 100)})
    low = next(b for b in bands if b["band"] == "Low"); whale = next(b for b in bands if b["band"] == "Whale")
    return {"sym": d["symbol"], "bands": bands, "vip": vip,
            "lowClassicPct": round(low["segs"]["Classic/None"] / (low["total"] or 1) * 100),
            "whaleClassicPct": round(whale["segs"]["Classic/None"] / (whale["total"] or 1) * 100),
            "fullVipTotal": sum(v["full"] for v in vip)}

def bt(m):
    m = (m or "").lower()
    if "spin" in m: return "Free spins"
    if "credit" in m or m == "fc": return "Free credit"
    if "cash" in m: return "Cashback"
    if "reload" in m or "match" in m or "deposit" in m: return "Deposit"
    return (m or "Other").title()
def band(md): return "Whale" if md >= 50000 else "High" if md >= 5000 else "Mid" if md >= 500 else "Low"
def derive_dep_alloc(mk, vmap):
    """Overlap-free deposits (equal-split across all codes) per code, group, pillar — sums to distinct at every window."""
    da = load(f"deposit-alloc-bycode-{mk}.json")
    if not da:
        return None
    tv = {c.strip(): v for c, v in vmap.items()}
    out = {"total": da["distinct"], "byCode": da["byWindow"], "byGroup": {}, "byPillar": {}}
    for W, byc in da["byWindow"].items():
        grp, pil = {}, {}
        for code, v in byc.items():
            vc = tv.get(code.strip()) or {}
            p = vc.get("pillar", "?"); t = bt(vc.get("mechanic"))
            grp[f"{p}||{t}"] = grp.get(f"{p}||{t}", 0) + v
            pil[p] = pil.get(p, 0) + v
        out["byGroup"][W] = {k: round(x) for k, x in grp.items()}
        out["byPillar"][W] = {k: round(x) for k, x in sorted(pil.items(), key=lambda kv: -kv[1])}
    return out
def derive_dep_classify(mk, vmap):
    """Design 3 — deposit-trigger classification (pre-funded / bonus-led / no deposit response) per code, group, pillar, total.
    Buckets are per-CLAIM and mutually exclusive, so claims and spend partition cleanly (spend buckets sum to Total bonus)."""
    dc = load(f"deposit-classify-{mk}.json")
    if not dc:
        return None
    tv = {c.strip(): v for c, v in vmap.items()}
    BUCK = ("prefunded", "bonusled", "noresp")
    def blank():
        b = {"prefunded": {"claims": 0, "spend": 0.0, "before_amt": 0.0},
             "bonusled": {"claims": 0, "spend": 0.0, "after_amt": 0.0},
             "noresp": {"claims": 0, "spend": 0.0}}
        b["dtu_claims"] = 0; b["react_claims"] = 0; b["react_ft_claims"] = 0; b["react_ret_claims"] = 0
        return b
    out = {"byCode": dc["byWindow"], "byGroup": {}, "byPillar": {}, "total": {}, "sym": dc.get("sym", ""), "timing": dc.get("timing")}
    for W, byc in dc["byWindow"].items():
        grp, pil, tot = {}, {}, blank()
        for code, d0 in byc.items():
            vc = tv.get(code.strip()) or {}
            if not vc.get("managed", True):   # byCode stays full (Tab-4 timing chips); Page-3 pillar/total aggregate is managed-only
                continue
            p = vc.get("pillar", "?"); g = f"{p}||{bt(vc.get('mechanic'))}"
            gg = grp.setdefault(g, blank()); pp = pil.setdefault(p, blank())
            for x in BUCK:
                if x in d0:
                    for agg in (gg, pp, tot):
                        agg[x]["claims"] += d0[x].get("claims", 0); agg[x]["spend"] += d0[x].get("spend", 0.0)
            dtu = d0.get("prefunded", {}).get("dtu_claims", 0); rc = d0.get("bonusled", {}).get("react_claims", 0)
            rcf = d0.get("bonusled", {}).get("react_firsttime_claims", 0); rcr = d0.get("bonusled", {}).get("react_returning_claims", 0)
            pfb = d0.get("prefunded", {}).get("before_amt", 0); bla = d0.get("bonusled", {}).get("after_amt", 0)
            for agg in (gg, pp, tot):
                agg["dtu_claims"] += dtu; agg["react_claims"] += rc
                agg["react_ft_claims"] += rcf; agg["react_ret_claims"] += rcr
                agg["prefunded"]["before_amt"] += pfb; agg["bonusled"]["after_amt"] += bla
        out["byGroup"][W] = grp
        out["byPillar"][W] = {k: v for k, v in sorted(pil.items(),
                              key=lambda kv: -(kv[1]["prefunded"]["spend"] + kv[1]["bonusled"]["spend"] + kv[1]["noresp"]["spend"]))}
        out["total"][W] = tot
    return out
MOVE = {"Whale": "PROTECT", "High": "GROW", "Mid": "CONVERT", "Low": "AUTOMATE"}
PAYS = {"Whale": "reload +2.4 (net) · giveaway ~0 · VIP no-deposit +3.1 (dep); cashback = pilot (unscored)",
        "High": "reload +1.8 (net) · giveaway 0.91 (dep) · VIP no-deposit +3.0 (dep); cashback = pilot (unscored)",
        "Mid": "giveaway 1.08 (dep, peak) · reload +1.4 (net) · VIP match loses",
        "Low": "reload +0.8 (net) · giveaway 0.55 (dep, weak)"}
CONFIG = [["Whale", "Deposit-match — cap the % (they hit the cap)", "Cashback (pilot)", "+2.4 net"],
          ["High", "Cashback (pilot) — lead here", "Deposit-match ≈ break-even", "+3.0 dep (no-deposit proxy; cashback unscored)"],
          ["Mid", "No-deposit giveaway — cheapest deposits", "Reload", "1.08 dep"],
          ["Low", "Small capped nudges only", "—", "+0.8 net"]]

def build_macro():
    """Brands-overview data: finalize scratchpad/macro_data.json (macro_pull.py output) into the
    served macro object — keep MY/SG/ID, fixed MY,SG,ID order, drop raw BonusAmount, add asOf label."""
    md = load("macro_data.json")
    if not md:
        return None
    MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    # Build a month-granular range label from the actual window. window_end is exclusive, so the
    # last COMPLETE month is the month before it (handles year rollover). The "YTD ·" prefix is only
    # truthful for the default auto-YTD window — a custom window just names its own range.
    sdt = datetime.fromisoformat(md["window_start"])
    edt = datetime.fromisoformat(md["window_end"])
    lm_year, lm_month = (edt.year, edt.month - 1) if edt.month > 1 else (edt.year - 1, 12)
    if (sdt.year, sdt.month) == (lm_year, lm_month):
        rng = f"{MON[sdt.month-1]} {lm_year}"                                   # single month
    elif sdt.year == lm_year:
        rng = f"{MON[sdt.month-1]}–{MON[lm_month-1]} {lm_year}"                 # within one year
    else:
        rng = f"{MON[sdt.month-1]} {sdt.year} – {MON[lm_month-1]} {lm_year}"    # spans years
    asof = rng if WIN_EXPLICIT else f"YTD · {rng}"
    KEEP = {"MYR", "SGD", "IDR"}; ORDER = {"MYR": 0, "SGD": 1, "IDR": 2}
    tbk = ("b", "d", "db", "fc", "fs", "rb", "ngr", "bon_pct", "br_pct", "mg")
    regions = [{"region": r["region"], "cur": r["cur"], "sym": r["sym"], "d": r["d"], "db": r["db"],
                "fc": r["fc"], "fs": r["fs"], "rb": r["rb"], "ngr": r["ngr"], "bon_pct": r["bon_pct"],
                "br_pct": r["br_pct"], "mg": r["mg"], "brands": [{k: x[k] for k in tbk} for x in r["brands"]]}
               for r in md["regions"] if r["cur"] in KEEP]
    regions.sort(key=lambda r: ORDER.get(r["cur"], 99))
    return {"asOf": asof, "window": f'{md["window_start"]} .. {md["window_end"]}',
            "company": md["company"], "regions": regions}

OUT = {}
for mk, sym in (("MY", "RM"), ("SG", "S$")):
    va = load(f"verify-allcodes-{mk}.json"); vac = va["codes"] if isinstance(va, dict) else va  # every code (managed + data-only)
    vmap = {c["code"]: c for c in vac}
    # MANAGED set — the ROI-scored codes with a firm call. The code UNIVERSE is now every code
    # (managed + data-only statistics rows for the Codes tab), but every ANALYSIS aggregate
    # (Page-3 money/timing, value bands, Spend-by-call, the exec book, the money reconciliation)
    # is ring-fenced to MGD so the analyses stay exactly on the codes we actually judged. Per-code
    # cell data (all tabs' columns) stays full for every code. Default True = backward-safe if a
    # code predates the managed flag.
    MGD = {c.strip() for c, v in vmap.items() if v.get("managed", True)}
    wt = load(f"who_targeted-{mk}.json") or {}
    dbc = (load(f"deposit-behaviour-bycode-{mk}.json") or {}).get("byCode", {})  # per-code deposit behaviour (30d)
    cp = load(f"code-players-{mk}.json") or {}  # gated per-player drill-down; _players = distinct claimers per code
    pcount = {k.strip(): len(v) for k, v in cp.items() if k != "_meta" and isinstance(v, list)}
    ex = EX[mk]
    codes = []
    band_agg = defaultdict(lambda: {"n": 0, "spend": 0.0})
    mon = defaultdict(lambda: {"codes": 0, "out": 0.0, "repeat": 0.0, "redep30": 0, "in30": 0.0})
    calls = defaultdict(lambda: {"n": 0, "sp": 0.0})
    # Per-code spend/type from the COMPLETE money rows (the Money-tab source). verify-action is a
    # scoped ROI pass that omits non-scored codes (check-ins / adhoc): on MY it matches money
    # byte-for-byte for every code, but on SG it leaves 16 codes at spend=0 / type="Other" and
    # diverges on the rest, breaking the exec-vs-Money reconciliation. Sourcing _spend/_type here
    # makes the exec book equal the Money tab on both markets (verified MY no-op). verify-action is
    # still used for _perrm / _tier only.
    money_by_code = {}
    for mrow in ex["money"]["rows"]:
        mc_code = (mrow.get("Promo code") or {}).get("d")
        if mc_code is not None:
            money_by_code[mc_code] = {"spend": (mrow.get("Total bonus") or {}).get("n") or 0,
                                      "type": (mrow.get("Bonus type") or {}).get("d") or ""}
    for rec in ex["codes"]:
        code = rec["Promo code"]["d"]
        vc = vmap.get(code, {})
        md = (wt.get(code) or {}).get("med_dep")
        pillar = rec["pillar"]
        typ = (money_by_code.get(code, {}).get("type")) or bt(vc.get("mechanic"))
        b = band(md) if md is not None else "Low"
        tier = (wt.get(code) or {}).get("dom_tier", "") or vc.get("r_tier", "")
        call = rec["The call"]["d"]
        spend = money_by_code[code]["spend"] if code in money_by_code else (vc.get("r_spend") or 0)
        cells = {k: v for k, v in rec.items() if k != "pillar"}
        bc = dbc.get(code)  # per-code deposit behaviour: qualifying deposit (dep) or come-back reactivation (give-away)
        if bc:
            if bc["type"] == "dep":
                cells["DEPOSITS BACK · Qualifying deposit (before)"] = {"d": f"{sym}{bc['qual_sum']:,.0f}", "n": bc["qual_sum"]}
            else:
                nn, pp = bc["recipients"], bc["cameback_pct"]
                if nn >= 100:   disp, srt = f"{pp}%  ·  n={nn:,}", pp
                elif nn >= 30:  disp, srt = f"{pp}%  ·  n={nn} (small)", pp
                else:           disp, srt = f"n={nn} — too few", None
                cells["DEPOSITS BACK · Came back & deposited (30d)"] = {"d": disp, "n": srt}
                cells["DEPOSITS BACK · No-deposit deposit (30d)"] = {"d": f"{sym}{bc.get('amount', 0):,.0f}", "n": bc.get("amount", 0)}
                cells["DEPOSITS BACK · Median days back"] = {"d": (f"{bc['speed']:.0f}d" if bc["speed"] else "—"), "n": bc["speed"] or None}
        mgd = code.strip() in MGD
        codes.append({"_pillar": pillar, "_type": typ, "_band": b, "_tier": tier, "_call": call,
                      "_managed": mgd,  # False = data-only statistics row (no firm call); excluded from the analyses below
                      "_spend": spend, "_perrm": vc.get("r_per_rm"),
                      "_players": pcount.get(code.strip()) or vc.get("r_claimers"),  # fall back to warehouse claimers (data-only codes skip the player drill-down pull)
                      "cells": cells})
        if mgd:  # value-band + Spend-by-call aggregates stay on the managed book
            if pillar != "Acquisition":
                a = band_agg[b]; a["n"] += 1; a["spend"] += spend
            calls[call]["n"] += 1; calls[call]["sp"] += spend
    # exec-vs-Money reconciliation guard: the exec book (sum of codes._spend) must equal the Money tab
    # Total bonus (sum of money rows). After sourcing _spend from the money rows above they tie by
    # construction; a divergence means a union-only code (in ex['codes'] with no money row -> r_spend
    # fallback) or a money row with no code rec. Warn loudly (non-fatal) so a rebuild surfaces it rather
    # than silently shipping an exec tile that contradicts the Money Total.
    # Reconciliation is on the MANAGED book — the exec tile + Money Total both reflect managed codes;
    # data-only statistics rows are excluded from both sides so the guard still means something.
    _code_set = {r["Promo code"]["d"] for r in ex["codes"] if r["Promo code"]["d"].strip() in MGD}
    _money_set = {k for k in money_by_code if k.strip() in MGD}
    _exec_book = round(sum(c["_spend"] for c in codes if c["_managed"]))
    _money_book = round(sum(v["spend"] for k, v in money_by_code.items() if k.strip() in MGD))
    if _code_set != _money_set or _exec_book != _money_book:
        import sys as _sys
        print(f"[{mk}] WARN exec-vs-Money reconcile: book {_exec_book} vs money {_money_book} "
              f"(delta {_exec_book - _money_book}); codes-only={sorted(_code_set - _money_set)[:8]} "
              f"money-only={sorted(_money_set - _code_set)[:8]}", file=_sys.stderr)
    # deposit-band summary (non-acq) + estate from the per-cell segment grid [vband,state,members,ngr,med_dep]
    est = defaultdict(float); estmem = defaultdict(int)
    for row in ex["segGrid"]:
        est[row[0]] += row[3] or 0; estmem[row[0]] += row[2] or 0
    est_tot = sum(est.values()) or 1
    tot_spend = sum(v["spend"] for v in band_agg.values()) or 1
    bands = []
    for b in ("Whale", "High", "Mid", "Low"):
        sp = band_agg[b]["spend"]
        bands.append({"band": b, "move": MOVE[b], "codes": band_agg[b]["n"], "spend": round(sp),
                      "spendPct": round(100 * sp / tot_spend), "players": estmem.get(b, 0),
                      "ngr": round(est.get(b, 0)), "ngrPct": round(100 * est.get(b, 0) / est_tot), "pays": PAYS[b]})
    # money in vs money out summary — aggregate ALL money columns from the by-code rows by pillar × type
    MONEYCOLS = ["Claims", "Unique claimers", "Repeat- claimers", "First-claim bonus", "Total bonus", "Repeat cost",
                 "Redepositors 7d", "Redepositors 30d", "Redepositors 90d", "Deposit amt 7d", "Deposit amt 30d", "Deposit amt 90d"]
    # Money tab (Page 3) is an ANALYSIS: ring-fence to managed codes. money_by_code above stays full so
    # the Codes tab shows every code's spend; only the Page-3 money rollups use the managed subset.
    money_rows_mgd = [r for r in ex["money"]["rows"] if ((r.get("Promo code") or {}).get("d") or "").strip() in MGD]
    monsum = defaultdict(lambda: defaultdict(float)); moncodes = defaultdict(int)
    for row in money_rows_mgd:
        p = row.get("Pillar", {}).get("d", ""); t = row.get("Bonus type", {}).get("d", "")
        moncodes[(p, t)] += 1
        for mc in MONEYCOLS:
            monsum[(p, t)][mc] += (row.get(mc, {}).get("n") or 0)
    money_summary = []
    for k in sorted(moncodes.keys()):
        e = {"pillar": k[0], "type": k[1], "codes": moncodes[k], "m": {mc: round(monsum[k][mc]) for mc in MONEYCOLS}}
        e["out"] = e["m"]["Total bonus"]; e["repeat"] = e["m"]["Repeat cost"]
        e["redep30"] = e["m"]["Redepositors 30d"]; e["in30"] = e["m"]["Deposit amt 30d"]
        money_summary.append(e)
    call_order = ["Scale", "Maintain", "Optimise", "Reduce", "Trim", "Stop"]
    calls_dist = [{"k": c, "n": calls[c]["n"], "sp": round(calls[c]["sp"])} for c in call_order if c in calls]
    # column schema for the Codes table (order = union; group/label/type/pillars inferred)
    colkeys = []
    for c in codes:
        for k in c["cells"]:
            if k not in colkeys: colkeys.append(k)
    cols = []
    for k in colkeys:
        grp = k.split(" · ")[0] if " · " in k else "Identity"
        lab = k.split(" · ")[-1]
        vals = [(c["cells"][k]["d"], c["cells"][k]["n"], c["_pillar"]) for c in codes if c["cells"].get(k)]
        pillars = sorted({p for d, n, p in vals if d not in ("", "—")})
        if k == "Promo code": typ = "code"
        elif k in ("The call", "CHECK · Verified"): typ = "chip"
        elif grp in ("WHAT TO DO", "REVIEW") or "Wai Yip" in k: typ = "text"
        elif any(d.startswith(("RM", "S$", "+RM", "-RM", "+S$", "-S$")) for d, n, p in vals): typ = "cur"
        elif any("%" in d for d, n, p in vals): typ = "pct"
        elif vals and all((n is not None or d in ("", "—")) for d, n, p in vals) and any(n is not None for d, n, p in vals): typ = "num"
        else: typ = "text"
        cols.append({"key": k, "group": grp, "label": lab, "type": typ, "pillars": pillars})
    OUT[mk] = {"sym": sym, "codes": codes, "columns": cols, "money": {**ex["money"], "rows": money_rows_mgd}, "moneySummary": money_summary,
               "depositTruth": load(f"deposit-truth-{mk}.json"),
               "depAlloc": derive_dep_alloc(mk, vmap),
               "depClassify": derive_dep_classify(mk, vmap),
               "depTimeDecay": load(f"deposit-timedecay-{mk}.json"),
               "depAfterSplit": load(f"deposit-afterclaim-split-{mk}.json"),
               "depositBehaviour": load(f"deposit-behaviour-{mk}.json"),
               "migration": derive_migration(mk),
               "trialBand": derive_trialband(mk),
               "moneycols": MONEYCOLS, "configFull": ex.get("configFull", []),
               "formulas": ex.get("formulas", []), "callsLevers": ex.get("callsLevers", []), "ripple": ex.get("ripple", {}),
               "verification": ex["verification"], "segGrid": ex["segGrid"], "bands": bands,
               "calls": calls_dist, "config": CONFIG,
               "meta": {"nCodes": len(codes), "nManaged": sum(1 for c in codes if c["_managed"]),
                        "book": round(sum(c["_spend"] for c in codes if c["_managed"]))}}  # exec book = managed only
    print(f"[{mk}] codes={len(codes)} bands={len(bands)} money_sum={len(money_summary)} calls={len(calls_dist)} book={sym}{OUT[mk]['meta']['book']:,}")

macro = build_macro()
PAYLOAD = {}
if PERIOD:
    PAYLOAD["period"] = PERIOD                      # non-macro tabs' date range (per-code report window)
if macro:
    PAYLOAD["macro"] = macro                        # Brands-overview tab
for _mk in ("MY", "SG"):
    PAYLOAD[_mk] = OUT[_mk]
PAYLOAD["builtAt"] = datetime.now(timezone.utc).isoformat()   # provenance for the "last refreshed" header

# ── code-name hygiene (ship clean) ───────────────────────────────────────────
# Strip control / zero-width / bidi characters and surrounding whitespace from every promo-code
# string that SHIPS in the payload. A single stray invisible char (seen live on FT_BR_RET_40PCT_12X_100)
# survives only in the stored name — the lookups above already .strip() for matching — and it (a) hides
# the whole summary row in Chrome's table parser and (b) splits the code between the Codes and Money tabs
# / breaks exact-code lookups. This is a no-op on already-clean names.
import re as _re
_INVIS = _re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f​-‏‪-‮⁠﻿]")
def _clean_code(s):
    return _INVIS.sub("", s).strip() if isinstance(s, str) else s
def _scrub_codes(mk):
    blk = PAYLOAD.get(mk)
    if not isinstance(blk, dict):
        return
    for rec in blk.get("codes", []):
        pc = (rec.get("cells") or {}).get("Promo code")
        if isinstance(pc, dict) and isinstance(pc.get("d"), str):
            pc["d"] = _clean_code(pc["d"])
    for row in ((blk.get("money") or {}).get("rows") or []):
        pc = row.get("Promo code")
        if isinstance(pc, dict) and isinstance(pc.get("d"), str):
            pc["d"] = _clean_code(pc["d"])
for _mk in ("MY", "SG"):
    _scrub_codes(_mk)

# ── per-run scoring thresholds (for the Tab-4 "Threshold Guide" card) ─────────
# Carry the live, run-dependent cutoffs the scoring engines actually used so the card can show them
# instead of a stale hardcoded snapshot: Acquisition cost-per-FTD percentiles + stick median (DRAFT,
# move each run), the Retention matrix floors/bands, and the VIP Lane-B per-tier cashback break-even
# verdicts. Fixed-constant rules (VIP Lane A, DEADBAND, giveaway tree) are not serialised anywhere, so
# the card hardcodes those from the python; this block only supplies what genuinely changes per run.
def _loadj(p):
    try:
        return json.load(open(p, encoding="utf-8"))
    except Exception:
        return None
for _mk in ("MY", "SG"):
    _blk = PAYLOAD.get(_mk)
    if not isinstance(_blk, dict):
        continue
    _acq = _loadj(SCR / "acq" / f"acq-metrics-{_mk}.json") or {}
    _ret = _loadj(SCR / "ret" / f"ret-metrics-{_mk}.json") or {}
    _cb = _loadj(SCR / "vip" / f"cashback-breakeven-{_mk}.json") or {}
    _blk["thresholds"] = {
        "acq": (_acq.get("thresholds") if isinstance(_acq, dict) else None) or None,
        "ret": (_ret.get("thresholds") if isinstance(_ret, dict) else None) or None,
        "vipCashback": (_cb.get("break_even") if isinstance(_cb, dict) else None) or None,
    }

# ── full VIP program (Lanes A/B/C/D) for the Tab-4 VIP lane filter ───────────
# The managed Codes/Money/Summary tables (ROI action codes only) are UNCHANGED — this is a SEPARATE,
# clearly-labelled population carried straight from the authoritative vip-metrics scoring output, so the
# lane filter can show Lanes B/C/D (which are excluded from the action book) with their OWN rules. Each
# lane keeps its own call (Keep/Review/Trim/Monitor/Entitlement); the Lane-A ROI matrix is never applied
# to B/C/D. Values are the scored outputs (missing/immature stays null, not 0).
for _mk in ("MY", "SG"):
    _blk = PAYLOAD.get(_mk)
    if not isinstance(_blk, dict):
        continue
    _vm = _loadj(SCR / "vip" / f"vip-metrics-{_mk}.json") or {}
    _cbv = (_loadj(SCR / "vip" / f"cashback-breakeven-{_mk}.json") or {}).get("break_even") or {}
    _lanes, _summ = [], {}
    for _c in (_vm.get("codes") or []):
        _L = (_c.get("lane") or "").split("-")[0].upper()        # A / B / C / D
        _tt = _c.get("tier_top")
        _be = (_cbv.get(_tt) or {}).get("verdict") if (_L == "B" and isinstance(_cbv, dict) and isinstance(_cbv.get(_tt), dict)) else None
        _lanes.append({
            "code": _clean_code(_c.get("code", "")), "name": _c.get("name", ""), "lane": _L,
            "decision": _c.get("decision"), "reason": _c.get("reason"), "do": _c.get("do"),
            "spend": _c.get("spend"), "claimers": _c.get("claimers"),
            "matured_30": _c.get("matured_30"), "matured_7": _c.get("matured_7"),
            "ggr_coverage": _c.get("ggr_coverage"), "tier": _tt,
            "breakeven": _be, "retention_after_loss": _c.get("retention_after_loss"), "fwd_ngr_30": _c.get("fwd_ngr_30"),
            "leakage_share": _c.get("leakage_share"), "downstream_ngr": _c.get("downstream_ngr"),
            "habitual_share": _c.get("habitual_share"), "pays_for_itself": _c.get("pays_for_itself"),
        })
        _s = _summ.setdefault(_L, {"codes": 0, "spend": 0})
        _s["codes"] += 1
        _s["spend"] += (_c.get("spend") or 0)
    _blk["vipLanes"] = _lanes
    _blk["vipLaneSummary"] = _summ
    _blk["vipPeriod"] = _vm.get("period")   # VIP scoring window (may differ from the macro period)

json.dump(PAYLOAD, open(SCR / "explorer-payload.json", "w", encoding="utf-8"), ensure_ascii=False)
print("wrote explorer-payload.json size", (SCR / "explorer-payload.json").stat().st_size,
      "| period:", PERIOD, "| macro:", ("yes" if macro else "no"), "| builtAt:", PAYLOAD["builtAt"])

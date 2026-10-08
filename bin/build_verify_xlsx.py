#!/usr/bin/env python3
"""Promo behaviour + verification workbook (for Wai Yip) — the main tool.

Built around the PURPOSE: how does each promo affect player behaviour (deposit / stickiness /
loyalty)? One tab per market x pillar, each code shown in ITS pillar's metric across horizons,
with the report-verification kept as a supporting "Verified" column.

Every pillar carries the keeps-players / deposits-again spine (came-back rate + points vs the
bonus-type norm) PLUS its own economic metric:
  * Acquisition — cost per new depositor + spine at 7/30 (+ lifetime NGR/player)
  * Retention   — cost per retained + back-per-RM1 + spine at 7/30/60/90/LTV (+ lifetime NGR)
  * VIP         — the "extra" incremental NGR lift (7d + 90d) + spine at 7/30/60/90/LTV (+ value)

Data (all on hand, no new pull): verify-action-{MK}.json, reproduce-perrm-{MK}.json,
keeps-horizon-{MK}.json. Run: python bin/build_verify_xlsx.py
"""
import json, re
from pathlib import Path
from datetime import date
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

SCR = Path(__import__("os").environ.get("PROMO_SCRATCH", r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad"))
OUT = Path(r"C:/Users/vdiuser/Downloads/promo-automation/outputs/action-code-verification.xlsx")

INK = "1F2933"; NAVY = "22304A"; MUTE = "52606D"; HEAD_FG = "FFFFFF"; BAND = "F4F6F9"
OK_BG = "E4F3E8"; OK_FG = "1E6B37"; WARN_BG = "FDF3D8"; WARN_FG = "8A6100"; CHK_BG = "FBE4E4"; CHK_FG = "9B1C1C"
YIP_BG = "FFF7E6"
HILITE_BG = "D6E4F5"; HILITE_FG = "1F4E79"   # holdout-candidate code highlight (blue = flagged to test)
G = {"id": "3B4657", "econ": "2A3F63", "back": "2F5D50", "roi": "334066", "keeps": "3A5A40", "loyal": "5A4A2A", "review": "5A2A4A", "action": "4A3A5A", "check": "8A5A00"}
GLABEL = {"id": "", "econ": "COSTS / EARNS",
          "back": "DEPOSITS BACK  (gross deposits in · not profit)",
          "roi": "BONUS ROI over time  (per RM1 · 0 = broke even)",
          "keeps": "KEEPS PLAYERS  (came back · vs same-type avg)",
          "loyal": "LOYALTY  (lifetime NGR vs same bonus type)",
          "review": "REVIEW", "action": "WHAT TO DO", "check": "CHECK"}
ROI_KEYS = {"roi7": "7", "roi30": "30", "roi60": "60", "roi90": "90", "roilife": "life"}
DEC = {"Stop": ("F3D7D7", "9B1C1C"), "Reduce": ("FBE7CF", "8A5200"), "Trim": ("FCF3CF", "7A6100"),
       "Optimise": ("FCF3CF", "7A6100"), "Maintain": ("D6E8F0", "1F5A6B"), "Scale": ("D9EDD9", "1E6B37")}
DEC_ORDER = {"Stop": 0, "Reduce": 1, "Trim": 2, "Optimise": 3, "Maintain": 4, "Scale": 5}
_side = Side(style="thin", color="D6DBE2")
BORDER = Border(left=_side, right=_side, top=_side, bottom=_side)

# per-pillar column plans -----------------------------------------------------------------
COMMON_TAIL = [("why", "Why this call", 34, "action"), ("lever", "The lever\n(mechanic + who to give it to)", 56, "action"),
               ("actual", "Who claimed\n(actual segment)", 32, "action"),
               ("ver", "Verified", 11, "check"), ("yip_v", "Wai Yip:\nagree?", 13, "check"), ("yip_n", "Wai Yip: notes", 30, "check")]
LOYAL = [("lval", "Lifetime NGR\n/ player", 15, "loyal"), ("lnorm", "Same-type\navg", 13, "loyal")]
PAYBACK = [("payback", "Pays back later?", 22, "review")]   # ret/VIP only
# gross deposits the code's claimers put back in the window AFTER claim (money-back yg asked for; a raw activity fact, NOT profit)
BACK = [("dep7", "7d", 11, "back"), ("dep30", "30d", 11, "back"), ("dep60", "60d", 11, "back"), ("dep90", "90d", 11, "back")]
PLANS = {
    "Acquisition": [("code", "Promo code", 34, "id"), ("call", "The call", 9, "id"),
                    ("cost_ftd", "Cost / new\ndepositor", 14, "econ"), ("paid", "Bonus paid\n(money out)", 13, "econ"), ("conv", "Claimed →\ndeposited", 16, "econ"), ("ggr", "House edge\n(GGR cover)", 13, "econ")] + BACK + [
                    ("stick7", "New players\ncame back (7d)", 16, "keeps"), ("stick30", "New players\ncame back (30d)", 18, "keeps")] + LOYAL + COMMON_TAIL,
    "Retention": [("code", "Promo code", 34, "id"), ("call", "The call", 9, "id"),
                  ("cost_ret", "Cost /\nretained", 12, "econ"), ("paid", "Bonus paid\n(money out)", 13, "econ"), ("ggr", "House edge\n(GGR cover)", 13, "econ")] + BACK + [
                  ("roi7", "7d", 9, "roi"), ("roi30", "30d", 9, "roi"), ("roi60", "60d", 9, "roi"), ("roi90", "90d", 9, "roi"), ("roilife", "Lifetime", 10, "roi"),
                  ("cb7", "7 days", 13, "keeps"), ("cb30", "30 days", 13, "keeps"), ("cb60", "60 days", 13, "keeps"),
                  ("cb90", "90 days", 13, "keeps"), ("cblife", "Lifetime", 13, "keeps"), ("redep", "Extra redeposits\nvs typical", 15, "keeps")] + LOYAL + PAYBACK + COMMON_TAIL,
    "VIP": [("code", "Promo code", 34, "id"), ("call", "The call", 9, "id"),
            ("paid", "Bonus paid\n(money out)", 13, "econ"), ("ggr", "House edge\n(GGR cover)", 13, "econ")] + BACK + [
            ("roi7", "7d", 9, "roi"), ("roi30", "30d", 9, "roi"), ("roi60", "60d", 9, "roi"), ("roi90", "90d", 9, "roi"), ("roilife", "Lifetime", 10, "roi"),
            ("cb7", "7 days", 13, "keeps"), ("cb30", "30 days", 13, "keeps"), ("cb60", "60 days", 13, "keeps"),
            ("cb90", "90 days", 13, "keeps"), ("cblife", "Lifetime", 13, "keeps"), ("redep", "Extra redeposits\nvs typical", 15, "keeps")] + LOYAL + PAYBACK + COMMON_TAIL,
}
CB_WIN = {"cb7": "7", "cb30": "30", "cb60": "60", "cb90": "90"}


def load(p):
    fp = SCR / p
    return json.load(open(fp, encoding="utf-8")) if fp.exists() else None


def merged(mk):
    va = load(f"verify-action-{mk}.json")
    rp = (load(f"reproduce-perrm-{mk}.json") or {}).get("codes", {})
    kh = (load(f"keeps-horizon-{mk}.json") or {}).get("codes", {})
    ggr = load(f"ggr-coverage-{mk}.json") or {}     # ret/acq house-edge (VIP already carries its own)
    roi = (load(f"roi-horizon-{mk}.json") or {}).get("codes", {})   # bonus ROI at 7/30/60/90/lifetime
    mbk = load(f"moneyback-{mk}.json") or {}                         # gross deposits back at 7/30/60/90d + 30d depositor count
    wtg = load(f"who_targeted-{mk}.json") or {}                       # per-code claimer profile (90d pre-claim deposit, YTD NGR, tier)
    acq_m = load(f"acq/acq-metrics-{mk}.json") or {}                       # acq: typical stickiness + per-code 7-day stick
    ret_m = load(f"ret/ret-metrics-{mk}.json") or {}
    vip_m = load(f"vip/vip-metrics-{mk}.json") or {}
    acq_thr = acq_m.get("thresholds", {}) or {}
    acq_med, acq_med7 = acq_thr.get("stick_median"), acq_thr.get("stick_median_7")
    acq_by = {c["code"]: c for c in acq_m.get("codes", [])}
    meta_by = {}                                                            # config for grounding the Lever column
    for m in (acq_m, ret_m, vip_m):
        for c in m.get("codes", []):
            mm = re.search(r"(\d+)\s*PCT|(\d+)%", (c["code"] + " " + str(c.get("name", ""))).upper())
            meta_by[c["code"]] = {"mechanic": c.get("mechanic"), "deposit_required": c.get("deposit_required"),
                                  "wagering_x": c.get("wagering_x"), "min_deposit": c.get("min_deposit"),
                                  "tier": c.get("tier_top"),   # the dominant membership tier (Bronze/Silver/Gold…)
                                  "avg_bonus": c.get("avg_bonus_per_claim") or c.get("avg_amount"),
                                  "bonus_pct": int(mm.group(1) or mm.group(2)) if mm else None}
    for o in va["codes"]:
        o["repro_per_rm"] = (rp.get(o["code"]) or {}).get("repro_per_rm")
        o["kh"] = kh.get(o["code"])
        o["roi"] = roi.get(o["code"])
        o["mb"] = mbk.get(o["code"])
        o["wt"] = wtg.get(o["code"])
        if o.get("r_ggr_coverage") is None:
            o["r_ggr_coverage"] = ggr.get(o["code"])
        mb = meta_by.get(o["code"], {})
        o["mechanic"] = mb.get("mechanic"); o["deposit_required"] = mb.get("deposit_required")
        o["wagering_x"] = mb.get("wagering_x"); o["min_deposit"] = mb.get("min_deposit")
        o["tier"] = mb.get("tier"); o["bonus_pct"] = mb.get("bonus_pct"); o["avg_bonus"] = mb.get("avg_bonus")
        if o.get("pillar") == "Acquisition":
            ac = acq_by.get(o["code"], {})
            o["r_stick_median"] = acq_med; o["r_stick_median_7"] = acq_med7
            o["r_stick_7"] = ac.get("stick_7")
            o["conversion"] = ac.get("conversion"); o["ftd"] = ac.get("ftd"); o["claimers"] = ac.get("claimers")
    return va


def relabel(text, sym):
    """RM -> market symbol in free text (SG), leaving quoted logic keys / acronyms alone."""
    if not text or sym == "RM":
        return text or ""
    return re.sub(r"(?<!['\"])(?<![A-Za-z])RM(?![A-Za-z])(?!['\"])", sym, text)


def pays_back_flag(o):
    """Full-circle review flag for LOSING calls (Stop/Reduce/Trim, ret+VIP): does the money recover
    over time, AND is that recovery corroborated (steady rise + players still depositing + house edge)
    rather than long-window baseline drift? Returns (text, level) where level in strong/weak/None."""
    if o["pillar"] not in ("Retention", "VIP") or o["decision"] not in ("Stop", "Reduce", "Trim"):
        return None, None
    roi = o.get("roi") or {}
    r7 = roi.get("7")
    if r7 is None or r7 >= 0:
        return None, None                      # not losing at the decision point — no payback question
    mat = [(w, roi.get(w)) for w in ("30", "60", "90")]     # matured windows (lifetime is too drift-prone to anchor on)
    cross = next((w for w, v in mat if v is not None and v >= 0.25), None)
    life = roi.get("life")
    if cross is None:
        if life is not None and life >= 0.25:
            return "Recovers on paper only — end it (don't revive)", "weak"
        return None, None                      # stays negative — genuine loser, the call stands
    pts = [v for _, v in [("7", r7)] + mat if v is not None]
    mono = all(pts[i + 1] >= pts[i] - 0.15 for i in range(len(pts) - 1))   # steadily rising, not a spike
    kh = o.get("kh") or {}
    up = ((kh.get("windows", {}) or {}).get("90") or kh.get("life") or {}).get("uplift")
    keeps_ok = (up is None) or (up > -10)      # players not deeply worse than their type at keeping
    ggr = o.get("r_ggr_coverage")
    edge_ok = (ggr is None) or (ggr >= 0.8)    # house edge broadly covered — not pure luck
    if mono and keeps_ok and edge_ok:
        return f"Test before cutting — recovers by {cross}d", "strong"
    return "Recovers on paper only — end it (don't revive)", "weak"


def todo_txt(o, sym):
    """The concrete action for the call — the report's `do` (ret/VIP); acquisition has no `do`,
    so its reason carries the how (\"test a smaller amount / aim it at the right players\")."""
    do = (o.get("do") or "").strip()
    txt = do if do else (o.get("reason") or "").strip()
    return re.sub(r"(-?\d+)\s*pp\b", r"\1 pts", relabel(txt, sym))


def _cut_text(o, sym):
    """Grounded 'cut the giveaway' phrase — bonus % if the name has one, else the RM value of the
    credit / spins (avg_bonus_per_claim), else a generic fallback."""
    pct, amt, mech = o.get("bonus_pct"), o.get("avg_bonus"), (o.get("mechanic") or "").lower()
    if pct:
        return f"cut the {pct}% bonus"
    if amt:
        if "credit" in mech:
            return f"cut the {sym}{amt:.0f} credit"
        if "spin" in mech:
            return f"trim the free spins ({sym}{amt:.0f})"
        return f"cut the {sym}{amt:.0f} bonus"
    return "cut the bonus amount"


def _shrink(o, sym):
    """Grounded 'make it less generous' lever — names the CURRENT giveaway/TO and only suggests a
    knob with room to move (TO only if <10x; add a min-deposit only if deposit-based and none yet)."""
    dr, mech = o.get("deposit_required"), (o.get("mechanic") or "").lower()
    dep_based = ("deposit" in mech) if dr is None else bool(dr)
    wx, md = o.get("wagering_x"), o.get("min_deposit")
    knobs = [_cut_text(o, sym)]
    if wx is not None and wx < 10:
        knobs.append(f"raise TO (now {wx:.0f}x)")
    if dep_based and (md == 0 or md is None):
        knobs.append("add a min-deposit")
    return "; ".join(knobs[:2])


def btype_of(o):
    """The bonus TYPE (Free-credit / Free-spins / Deposit) from the code's mechanic — the axis the
    Recommended-settings recipe is keyed on. reload/DepositBonus -> Deposit."""
    m = (o.get("mechanic") or "").lower()
    if "spin" in m:
        return "Free-spins"
    if "credit" in m:
        return "Free-credit"
    if "reload" in m or "deposit" in m:
        return "Deposit"
    return None


def _rc(size, s_lo, s_hi, to, t_lo, t_hi, md, games="Slots · PP", match=None):
    return {"size": size, "s_lo": s_lo, "s_hi": s_hi, "to": to, "t_lo": t_lo, "t_hi": t_hi,
            "md": md, "games": games, "match": match}


# The Recommended-settings recipe as data, keyed (pillar, bonus type, tier) -> full target config.
# s_lo/s_hi and t_lo/t_hi are numeric bounds so a code's live config can be diffed against target.
# t_hi 99 = "12x+" (no upper bound). match = deposit-match rate. "skip" = don't run this type here.
RECIPE_MY = {
    ("Retention", "Free-credit", "Bronze"): _rc("RM30–60", 30, 60, "5–8x", 5, 8, "none"),
    ("Retention", "Free-credit", "Silver"): _rc("RM30–60", 30, 60, "5–8x", 5, 8, "none"),
    ("Retention", "Free-credit", "Gold"): _rc("RM100–300", 100, 300, "5–8x", 5, 8, "none", games="Slots · PP + Live Casino"),
    ("Retention", "Free-credit", "Platinum"): _rc("RM100–300", 100, 300, "5–8x", 5, 8, "none", games="Slots · PP + Live Casino"),
    ("Retention", "Free-credit", "Diamond"): _rc("RM100–300", 100, 300, "5–8x", 5, 8, "none", games="Live Casino + Slots · PP"),
    ("Retention", "Free-spins", "Bronze"): _rc("RM30–60", 30, 60, "5–8x", 5, 8, "RM1–200"),
    ("Retention", "Free-spins", "Silver"): _rc("RM60–100", 60, 100, "8–12x", 8, 12, "RM1–200"),
    ("Retention", "Free-spins", "Gold"): {"skip": True},
    ("Retention", "Free-spins", "Platinum"): _rc("≤RM30", 0, 30, "5–8x", 5, 8, "—", games="Slots"),
    ("Retention", "Free-spins", "Diamond"): _rc("RM30–60", 30, 60, "5–8x", 5, 8, "—", games="Slots"),
    ("Retention", "Deposit", "Bronze"): _rc("RM30–60", 30, 60, "5–8x", 5, 8, "RM1–200", match="~30–50%", games="Slots · PP + Live Casino"),
    ("Retention", "Deposit", "Silver"): _rc("RM100–300", 100, 300, "8–12x", 8, 12, "RM200–500", match="~25–35%"),
    ("Retention", "Deposit", "Gold"): _rc("RM100–300", 100, 300, "8–12x", 8, 12, "RM200–500", match="~30%", games="Live Casino + Slots · PP"),
    ("Retention", "Deposit", "Platinum"): _rc("RM100–300", 100, 300, "8–12x", 8, 12, "RM200–500", match="~40–50%", games="Live Casino + Slots · PP"),
    ("Retention", "Deposit", "Diamond"): _rc("RM100–600", 100, 600, "12x+", 12, 99, "RM200–500", match="~10–20%", games="Live Casino + Slots · PP"),
    ("VIP", "Free-credit", "Silver"): _rc("RM300–600", 300, 600, "8–12x", 8, 12, "none", games="Slots"),
    ("VIP", "Free-credit", "Gold"): _rc("RM300–600", 300, 600, "8–12x", 8, 12, "none", games="Slots + Live Casino"),
    ("VIP", "Free-credit", "Diamond"): _rc("RM300–600", 300, 600, "5–8x", 5, 8, "none", games="Live Casino + Slots"),
    ("VIP", "Deposit", "Silver"): _rc("RM300–600", 300, 600, "8–12x", 8, 12, "RM500–1000", match="~35–50%", games="Slots"),
    ("VIP", "Deposit", "Gold"): _rc("RM300–600", 300, 600, "5–8x", 5, 8, "RM1000+", match="~40–50%", games="Live Casino + Slots"),
    ("VIP", "Deposit", "Diamond"): _rc("RM600–1000", 600, 1000, "8–12x", 8, 12, "RM1000+", match="~10–20%", games="Live Casino + Slots"),
}

# SG-specific recipe — its OWN tier × type × size / TO / match analysis (roi-horizon-SG + ret/vip-metrics-SG,
# spend-weighted Bonus ROI @28d). Differs from MY: reload match 30% (Bronze) / 45% (Gold-Plat); free-spins
# FAILS at Gold (−3.95) → skip; Platinum reload is the standout (+7.9, n7); VIP free-credit is ~100% cashback.
# Thin cells (n≤3 / no 28d) fall back to the nearest solid tier and are flagged directional in the notes.
RECIPE_SG = {
    ("Retention", "Free-credit", "Bronze"): _rc("S$30–60", 30, 60, "5–8x", 5, 8, "none"),
    ("Retention", "Free-credit", "Silver"): _rc("S$30–60", 30, 60, "5–8x", 5, 8, "none"),
    ("Retention", "Free-credit", "Gold"): _rc("S$100–300", 100, 300, "5–8x", 5, 8, "none"),
    ("Retention", "Free-credit", "Platinum"): _rc("S$100–300", 100, 300, "5–8x", 5, 8, "none"),
    ("Retention", "Free-credit", "Diamond"): _rc("S$100–300", 100, 300, "5–8x", 5, 8, "none"),
    ("Retention", "Free-spins", "Bronze"): _rc("S$30–60", 30, 60, "8–12x", 8, 12, "S$1–200"),
    ("Retention", "Free-spins", "Silver"): _rc("≤S$30", 0, 30, "5–8x", 5, 8, "S$1–200"),
    ("Retention", "Free-spins", "Gold"): {"skip": True},   # SG free-spins fails hard at Gold (ROI −3.95, n13)
    ("Retention", "Free-spins", "Platinum"): _rc("≤S$30", 0, 30, "5–8x", 5, 8, "—", games="Slots"),
    ("Retention", "Free-spins", "Diamond"): _rc("≤S$30", 0, 30, "5–8x", 5, 8, "—", games="Slots"),
    ("Retention", "Deposit", "Bronze"): _rc("S$100–300", 100, 300, "12x+", 12, 99, "S$200–500", match="~30%", games="Live Casino + Slots · PP"),
    ("Retention", "Deposit", "Silver"): _rc("S$100–300", 100, 300, "8–12x", 8, 12, "S$200–500", match="~30%"),
    ("Retention", "Deposit", "Gold"): _rc("S$100–300", 100, 300, "8–12x", 8, 12, "S$500–1000", match="~45%", games="Live Casino + Slots · PP"),
    ("Retention", "Deposit", "Platinum"): _rc("S$300–600", 300, 600, "8–12x", 8, 12, "S$1000+", match="~45%", games="Live Casino + Slots · PP"),
    ("Retention", "Deposit", "Diamond"): _rc("S$300–600", 300, 600, "8–12x", 8, 12, "S$1000+", match="~45%", games="Live Casino + Slots · PP"),
    ("VIP", "Free-credit", "Silver"): _rc("S$300–600", 300, 600, "8–12x", 8, 12, "none", match="~100% cashback", games="Slots"),
    ("VIP", "Free-credit", "Gold"): _rc("S$300–600", 300, 600, "8–12x", 8, 12, "none", match="~100% cashback", games="Slots"),
    ("VIP", "Free-credit", "Diamond"): _rc("S$600–1000", 600, 1000, "5–8x", 5, 8, "none", match="~100% cashback", games="Slots"),
    ("VIP", "Deposit", "Silver"): _rc("S$300–600", 300, 600, "8–12x", 8, 12, "S$1000+", match="~100%", games="Slots"),
    ("VIP", "Deposit", "Gold"): _rc("S$300–600", 300, 600, "8–12x", 8, 12, "S$1000+", match="~100%", games="Live Casino + Slots"),
    ("VIP", "Deposit", "Diamond"): _rc("S$600–1000", 600, 1000, "8–12x", 8, 12, "S$1000+", match="~100%", games="Live Casino + Slots"),
}


def recipe_dict(sym):
    return RECIPE_SG if sym == "S$" else RECIPE_MY


def recipe_for(o, sym="RM"):
    return recipe_dict(sym).get((o.get("pillar"), btype_of(o), o.get("tier")))


def mechanic_str(tgt, bt, sym):
    """The full target config spelled out — the 'mechanic' to actually build, not a pointer."""
    games = tgt.get("games", "Slots · PP")
    if bt == "Deposit":
        return f"{tgt.get('match') or '~match'} match, cap {tgt['size']} · TO {tgt['to']} · min-dep {tgt['md']} · {games}"
    if bt == "Free-credit":
        return f"{tgt['size']} free credit · TO {tgt['to']} · no deposit · {games}"
    if bt == "Free-spins":
        return f"{tgt['size']} in free spins · TO {tgt['to']} · min-dep {tgt['md']} · {games}"
    return f"{tgt['size']} · TO {tgt['to']} · {games}"


def segment_for(o):
    """The concrete target segment for the code — who to actually send it to (tier + behaviour +
    lapse window). Windows derive from the stickiness metric: stick_7 = redeposit within 7d, so the
    at-risk 'cooling' group is 7–30d since last deposit; winback targets the 30–90d lapsed."""
    pil, bt = o.get("pillar"), btype_of(o)
    t = o.get("tier"); tier = t if t and str(t).strip().lower() not in ("", "unknown", "none", "classic", "all") else "same-tier and deposit-size band"
    if pil == "Acquisition":
        return "new registrations with no prior deposit (and never-deposited sign-ups)"
    if bt == "Free-credit" and pil == "Retention":
        return f"lapsed {tier} players — last deposit 30–90d ago (winback)"
    if pil == "VIP" and bt == "Free-credit":
        return f"{tier} VIPs after a net loss (cashback trigger), or lapsed {tier} 30d+"
    if pil == "VIP":
        return f"active {tier} VIPs — top up before they cool"
    return f"cooling {tier} depositors — deposited 7–30d ago, no redeposit in the last 7d"


def recipe_lever(o, sym):
    """Diff the code's live config (size / TO / min-dep) against its tier × type recipe cell and
    return the concrete moves toward it (bare deltas, no suffix). Returns:
      (delta_text, tgt)  — off-recipe: e.g. 'raise TO 4x->8-12x; cut size RM500->RM100-300'
      (None, tgt)        — already on-recipe (config fine)
      (None, None/{skip})— no recipe cell / recipe says skip this type at this tier."""
    tgt = recipe_for(o, sym)
    if not tgt or tgt.get("skip"):
        return None, tgt
    amt, wx, md = o.get("avg_bonus"), o.get("wagering_x"), o.get("min_deposit")
    mech = (o.get("mechanic") or "").lower()
    dep_based = ("reload" in mech) or ("deposit" in mech)
    parts = []
    if amt is not None:
        if amt > tgt["s_hi"] * 1.05:
            parts.append(f"cut size {sym}{amt:.0f}→{tgt['size']}")
        elif amt < tgt["s_lo"] * 0.95 and tgt["s_lo"] > 0:
            parts.append(f"raise size {sym}{amt:.0f}→{tgt['size']}")
    if wx is not None:
        if wx < tgt["t_lo"]:
            parts.append(f"raise TO {wx:.0f}x→{tgt['to']}")
        elif wx > tgt["t_hi"]:
            parts.append(f"lower TO {wx:.0f}x→{tgt['to']}")
    if dep_based and tgt["md"] not in ("none", "—") and (md == 0 or md is None):
        parts.append(f"add min-dep {tgt['md']}")
    return ("; ".join(parts[:3]) if parts else None), tgt


def diagnose(o, sym):
    """(why, lever) — the code's SPECIFIC problem and the SPECIFIC, config-grounded fix, kept
    separate so the sheet shows 'Why this call' | 'The lever' with no overlap. Mechanic-aware:
    a NO-DEPOSIT code (free-credit / free-spins giveaway) never says 'raise/add min-deposit'.
    For Retention / VIP the lever is grounded in the Recommended-settings recipe (recipe_lever):
    off-recipe -> the moves toward the tier x type recipe; on-recipe -> the qualitative fix stands."""
    dec, pil = o.get("decision"), o.get("pillar")
    dr, mech = o.get("deposit_required"), (o.get("mechanic") or "").lower()
    dep_based = ("deposit" in mech) if dr is None else bool(dr)   # acq: DepositBonus=deposit; FreeCredit/FreeSpin=no-deposit
    giveaway = (not dep_based) and (("credit" in mech) or ("spin" in mech))   # no-deposit giveaway — judged on reactivation, NGR negative by design
    if dec == "Maintain":
        return (("Brings players back above the norm — reactivation lever (typically reads negative on Bonus ROI, a no-deposit cost)" if giveaway else "Profitable, keeps players"), "Keep as-is; re-check next cycle")
    if dec == "Scale":
        t = o.get("tier"); tgt = recipe_for(o, sym); bt = btype_of(o)
        keep = f"keep the mechanic ({mechanic_str(tgt, bt, sym)}); " if (tgt and not tgt.get("skip")) else ""
        widen = f"widen beyond {t}" if (t and str(t).strip().lower() not in ("", "all", "none", "unknown")) else "widen who's eligible"
        return (("Brings players back well above the norm — reactivation lever (typically negative on Bonus ROI, a no-deposit cost)" if giveaway else "Works and pays — brings players back"), f"Raise budget; {keep}{widen} — {segment_for(o)}")
    if dec == "Stop":
        tgt = recipe_for(o, sym); bt = btype_of(o)
        why_stop = "Doesn't bring players back or pull enough deposits" if giveaway else "Loses money and drives no extra redeposits"
        if tgt and not tgt.get("skip"):
            return (why_stop, f"End it. If you re-run the segment, use {mechanic_str(tgt, bt, sym)} · give it to: {segment_for(o)}")
        tail = "or replace with another mechanic" if dep_based else "or replace with a deposit-gated version"
        return (why_stop, f"End it, {tail}")
    if dec not in ("Optimise", "Reduce", "Trim"):
        return ("", "")

    if pil == "Acquisition":
        # Tune the EXISTING code. A mechanic switch (e.g. → free-spins) is a Stop/replace call, not an
        # Optimise — the free-spins-is-cheapest steer lives in the recommended-config tab, not bolted here.
        seg = segment_for(o)
        conv, stick, med = o.get("conversion"), o.get("r_stick_30"), o.get("r_stick_median")
        if conv is not None and conv < 20 and not dep_based:                          # cost is a CONVERSION leak
            return (f"Only {conv:.0f}% of claimers deposit", f"Add a first-deposit gate + tighten targeting. Give it to: {seg}")
        if stick is not None and med is not None and stick < med:                      # they don't STICK
            return (f"New players don't stick ({stick:.0f}%)", f"Aim at stickier acquisition sources. Give it to: {seg}")
        cut = _cut_text(o, sym)
        return ("Too expensive per new depositor", f"{cut[0].upper() + cut[1:]} + tighten targeting. Give it to: {seg}")

    # Retention / VIP — read the report's OWN per-code diagnosis (why), pair with the grounded fix (lever)
    txt = ((o.get("do") or "") + " | " + (o.get("reason") or "")).lower()
    _rr = o.get("roi") or {}
    signal = next((_rr.get(k) for k in ("30", "90", "7") if _rr.get(k) is not None), o.get("repro_per_rm"))
    losing = signal is not None and signal < 0              # DISPLAYED Bonus ROI is negative — never pair it with a profit-implying reason
    if giveaway:                                            # no-deposit giveaway on an Optimise/Reduce/Trim call — reactivation-framed why; lever comes from the recipe below (risk-reducers, no size-raise)
        why = ("Brings players back below the free-credit norm — too generous for the reactivation it buys" if dec in ("Reduce", "Trim")
               else "Brings players back about the norm — mostly reaching players who'd return anyway; right-size / tighten")
        lev = _shrink(o, sym)
    elif "barely pays" in txt or "right-size the offer" in txt:
        why, lev = "Barely pays for what it gives", _shrink(o, sym)
    elif "keeps fewer" in txt or "rework" in txt or "the reason they" in txt:
        why = "Loses money and drives fewer extra redeposits" if losing else "Makes money but drives fewer extra redeposits"
        lev = "Tighten targeting / rework the offer"
    elif "too generous" in txt or "trim the giveaway" in txt:
        why = "Keeps players but loses money — trim hard" if losing else "Keeps players but too generous to profit"
        lev = _shrink(o, sym)
    elif "deposit again anyway" in txt or "deposit anyway" in txt or "tighten who gets it" in txt:
        why, lev = "Reaching players who'd deposit anyway", "Tighten targeting (drop players who'd redeposit anyway)"
    elif "subtract what they'd" in txt:
        why, lev = "Not incremental — they'd play anyway", _shrink(o, sym)
    elif "not extra profit" in txt or "profitable but thin" in txt or "tighten targeting or right-size" in txt:
        why = "Loses money — not extra profit" if losing else "Profitable but thin / not extra profit"
        lev = "Tighten targeting or right-size"
    elif "loses money" in txt:
        why, lev = "Loses money; no extra redeposits vs its type", _shrink(o, sym)
    else:
        why, lev = ("Losing / thin" if losing else "Keeps players but too generous to profit"), _shrink(o, sym)
    # Apply the Recommended-settings recipe: if the code is OFF its tier x type recipe, the lever
    # becomes the concrete moves toward it; if ON recipe (config fine), the qualitative fix stands.
    rl, tgt = recipe_lever(o, sym)
    bt = btype_of(o); seg = segment_for(o)
    # The call here is Optimise / Reduce / Trim — a right-size or shrink verdict. It must NEVER tell the
    # operator to RAISE the giveaway: "raise size" toward the recipe cap directly contradicts the call
    # (a code can be scored weak on 7-day ROI yet sit below its config recipe's cap). Drop the size-raise
    # move; keep the risk-reducers (raise TO, add min-dep, cut size). Track that the code is merely under
    # the cap so we don't then mislabel it "already on config".
    undersized = False
    if rl:
        kept = [pp for pp in rl.split("; ") if not pp.lower().startswith("raise size")]
        undersized = len(kept) < len(rl.split("; "))
        rl = "; ".join(kept) if kept else None
    if tgt and tgt.get("skip"):                     # recipe says this type underperforms at this tier — right-size it; swapping the mechanic is a Stop/replace call, not a tune
        lev = f"{_shrink(o, sym)} — {(btype_of(o) or 'this type').lower()} pays weakly at {o.get('tier')}; keep it lean. Give it to: {seg}"
    elif tgt:
        m = mechanic_str(tgt, bt, sym)
        if rl:                                      # off-recipe risk-reducers + the full destination config + who
            lev = f"{rl} → target mechanic: {m}. Give it to: {seg}"
        elif undersized:                            # under the recipe cap, but a weak/losing call shouldn't grow it — re-test at the config, don't up-size this code
            lev = f"under the recommended {m} — but it's weak/losing as-is, so re-test at that config rather than up-sizing this code. Give it to: {seg}"
        elif dec in ("Reduce", "Trim"):             # on-recipe, but the call is to SHRINK — tighten/trim, never "keep"
            lev = f"config is right ({m}) but it under-performs — tighten the audience hard (drop players who'd return anyway) or trim the giveaway. Give it to: {seg}"
        else:                                       # on-recipe + Optimise: keep the config, sharpen who gets it
            lev = f"already on the recommended config ({m}) — sharpen the audience (tighten who gets it). Give it to: {seg}"
    else:                                           # no recipe cell (unknown/classic tier): keep shrink, name the segment
        lev = f"{lev}. Give it to: {seg}"
    if pil == "VIP":
        lev += " · don't kill (loyalty)"
    return (why, lev)


def money(sym, v, signed=False):
    if v is None:
        return "—"
    if v < 0:
        return f"-{sym}{abs(v):,.0f}" if not signed else f"-{sym}{abs(v):,.2f}"
    return (f"+{sym}{v:,.2f}" if signed else f"{sym}{v:,.0f}")


def wt_band(d):
    """90d-deposit band label for the 'who claimed' value axis."""
    return "whale" if d >= 50000 else "high" if d >= 5000 else "mid" if d >= 500 else "low"


def actual_str(o, sym):
    """Compact 'who ACTUALLY claimed' profile for the pillar-tab lever (recommended vs actual).
    Value axis = median 90-day pre-claim deposit (the axis that beat tier + NGR on stability)."""
    w = o.get("wt")
    if not w or not w.get("n"):
        return "—"
    d = w.get("med_dep", 0) or 0
    ngr = w.get("med_ngr", 0) or 0
    ngr_s = (f"+{sym}{ngr:,.0f}" if ngr >= 0 else f"-{sym}{abs(ngr):,.0f}")
    return f"Actual: {w.get('dom_tier', '?')} · {wt_band(d)}-deposit (~{sym}{d:,.0f}/90d) · med NGR {ngr_s}  (n={w['n']})"


def build_pillar_sheet(wb, mk, sym, pillar, codes):
    cols = PLANS[pillar]
    ws = wb.create_sheet(f"{mk} · {pillar[:3] if pillar!='VIP' else 'VIP'}" if False else f"{mk} · {pillar}")
    ws.sheet_view.showGridLines = False
    ncol = len(cols)

    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=ncol)
    subject = {"Acquisition": "do new players stick, and what did they cost to win",
               "Retention": "do players keep depositing, and what did they cost to retain",
               "VIP": "do top players stay, and is the money-back earning extra"}[pillar]
    t = ws.cell(row=1, column=1, value=f"{mk} · {pillar} — {subject}")
    t.font = Font(size=13, bold=True, color=NAVY); ws.row_dimensions[1].height = 24
    ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=ncol)
    horizons = "7 & 30 days" if pillar == "Acquisition" else "7 / 30 / 60 / 90 days and lifetime"
    sg = "  ·  SG is a small market with few promos — treat as a rough steer, not exact numbers." if mk == "SG" else ""
    roi_note = ("  ·  the call is scored on the first-week (7-day) Bonus ROI, so a losing call can sit next to a green 30/60/90-day or lifetime column — read the \"Pays back later?\" column for whether to test before cutting or end it"
                if pillar in ("Retention", "VIP") else "")
    ws.cell(row=2, column=1, value=(f"{len(codes)} codes with a management call.  Green = better than the same kind of promo, or the check holds up  ·  "
                                    f"amber = worse, or losing  ·  — = too recent to tell" + roi_note + "." + sg)).font = Font(size=10, italic=True, color=MUTE)
    ws.row_dimensions[2].height = 28 if pillar in ("Retention", "VIP") else 16
    # "The Call" legend — always visible (sits in the frozen header rows)
    ws.merge_cells(start_row=3, start_column=1, end_row=3, end_column=ncol)
    lg = ws.cell(row=3, column=1, value="The Call —  Scale: grow it  ·  Maintain: keep as-is  ·  Optimise: right-size  ·  Reduce / Trim: shrink it (too generous to profit)  ·  Stop: end or replace")
    lg.font = Font(size=9.5, color=NAVY); lg.alignment = Alignment(horizontal="left", vertical="center")
    ws.row_dimensions[3].height = 15

    # Terms legend — defines the shorthand used in the group labels and lever text (renders on BOTH MY & SG pillar tabs)
    ws.merge_cells(start_row=4, start_column=1, end_row=4, end_column=ncol)
    tl = ws.cell(row=4, column=1, value=("Terms —  TO = turnover (wagering) requirement — the bonus must be wagered this many times before withdrawal  ·  "
                                         "NGR = net gaming revenue — bets minus winnings minus bonuses (what the house keeps)  ·  GGR = gross gaming revenue — bets minus winnings, before bonuses  ·  "
                                         "match = % of deposit given as bonus  ·  cap = max bonus  ·  min-dep = minimum deposit  ·  PP = Pragmatic Play"))
    tl.font = Font(size=9, color=MUTE); tl.alignment = Alignment(horizontal="left", vertical="center")
    ws.row_dimensions[4].height = 15

    glabel = dict(GLABEL)
    if pillar == "Acquisition":   # acq "keeps" is stickiness among NEW depositors, judged vs the typical acq promo
        glabel["keeps"] = "STICKINESS  (new players who came back · vs typical)"
    elif pillar in ("Retention", "VIP"):   # keeps = came-back rate + the incremental redeposit lift the call is actually scored on
        glabel["keeps"] = "KEEPS PLAYERS  (came back + extra redeposits · vs typical)"
    gr, hr = 5, 6
    c = 1
    while c <= ncol:
        grp = cols[c - 1][3]; j = c
        while j < ncol and cols[j][3] == grp:
            j += 1
        if glabel[grp]:
            ws.merge_cells(start_row=gr, start_column=c, end_row=gr, end_column=j)
            g = ws.cell(row=gr, column=c, value=glabel[grp].replace("RM1", f"{sym}1"))
            g.fill = PatternFill("solid", fgColor=G[grp]); g.font = Font(size=9.5, bold=True, color=HEAD_FG)
            g.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
            for cc in range(c, j + 1):
                ws.cell(row=gr, column=cc).border = BORDER
        c = j + 1
    ws.row_dimensions[gr].height = 26
    for i, (k, name, w, grp) in enumerate(cols, start=1):
        cell = ws.cell(row=hr, column=i, value=name.replace("RM1", f"{sym}1"))
        cell.fill = PatternFill("solid", fgColor=G[grp]); cell.font = Font(size=9.5, bold=True, color=HEAD_FG)
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = BORDER; ws.column_dimensions[get_column_letter(i)].width = w
    ws.row_dimensions[hr].height = 30

    codes = sorted(codes, key=lambda o: (DEC_ORDER.get(o["decision"], 9), -(o.get("r_spend") or 0)))
    colidx = {k: i for i, (k, *_ ) in enumerate(cols, start=1)}

    def cb_val(o, win):
        kh = o.get("kh")
        if not kh:
            return None, None
        wd = kh["windows"].get(win) if win in ("7", "30", "60", "90") else kh.get("life")
        if not wd or wd.get("rate") is None:
            return None, None
        return wd["rate"], wd.get("uplift")

    r = hr + 1
    for o in codes:
        band = BAND if (r - hr) % 2 == 0 else "FFFFFF"
        kh = o.get("kh") or {}
        # verification
        spend_ok = (o.get("w_spend") is not None and o.get("r_spend") and abs(o["w_spend"] - o["r_spend"]) / max(o["r_spend"], 1) <= 0.02)
        ret_ok = (o.get("r_per_rm") is None) or (o.get("repro_per_rm") is not None and abs(o["repro_per_rm"] - o["r_per_rm"]) <= max(0.10, 0.05 * abs(o["r_per_rm"])))
        verified = spend_ok and ret_ok
        wy, lv = diagnose(o, sym)
        wy, lv = relabel(wy, sym), relabel(lv, sym)   # RM -> market symbol (S$ for SG); no-op for MY
        vals = {
            "code": o["code"], "call": o["decision"],
            "cost_ftd": money(sym, o.get("r_cost_per_ftd")), "cost_ret": money(sym, o.get("r_cost_per_retained")),
            "paid": money(sym, o.get("r_spend")),
            "perrm": money(sym, o.get("r_per_rm"), signed=True),
            "extra7": money(sym, o.get("r_per_rm"), signed=True), "extra90": money(sym, o.get("r_fwd_incr_per_rm_90"), signed=True),
            "ggr": (f"{o['r_ggr_coverage']:.1f}x" if o.get("r_ggr_coverage") is not None else "—"),
            "lval": (money(sym, kh.get("value", {}).get("per_player")) if kh else "—"),
            "lnorm": (money(sym, kh.get("value", {}).get("norm")) if kh else "—"),
            "why": wy, "lever": lv, "actual": actual_str(o, sym),
            "conv": (f"{o['conversion']:.0f}%  ·  {o.get('ftd')}/{o.get('claimers')}" if o.get("conversion") is not None else "—"),
            "payback": (pays_back_flag(o)[0] or ""),
            "ver": ("Verified" if verified else "Check"), "yip_v": None, "yip_n": None,
        }
        for i, (k, name, w, grp) in enumerate(cols, start=1):
            v = vals.get(k)
            if k in CB_WIN or k == "cblife" or k in ROI_KEYS or k in ("stick7", "stick30", "redep", "dep7", "dep30", "dep60", "dep90"):
                v = None  # filled below
            cell = ws.cell(row=r, column=i, value=v)
            cell.border = BORDER
            cell.fill = PatternFill("solid", fgColor=(YIP_BG if k in ("yip_v", "yip_n") else band))
            cell.font = Font(size=(9 if k in ("why", "lever", "actual") else 10), bold=(k == "lever"),
                             color=(MUTE if k in ("why", "actual") else (NAVY if k == "lever" else INK)))
            cell.alignment = Alignment(horizontal=("left" if k in ("code", "yip_n", "why", "payback", "lever", "actual") else "center"),
                                       vertical="center", wrap_text=(k in ("why", "payback", "lever", "actual")))
        why_lines = max(1, -(-len(wy or "") // 34))       # ceil: chars / col-width
        lev_lines = max(1, -(-len(lv or "") // 54))
        act_lines = max(1, -(-len(vals.get("actual") or "") // 30))
        ws.row_dimensions[r].height = min(120, max(30, max(why_lines, lev_lines, act_lines) * 13))
        # decision chip
        dc = ws.cell(row=r, column=colidx["call"])
        if o["decision"] in DEC:
            fill, font = DEC[o["decision"]]; dc.fill = PatternFill("solid", fgColor=fill); dc.font = Font(size=10, bold=True, color=font)
        # came-back cells
        for k in [c for c in colidx if c in CB_WIN or c == "cblife"]:
            win = CB_WIN.get(k, "life")
            rate, up = cb_val(o, win)
            cell = ws.cell(row=r, column=colidx[k])
            if rate is None:
                cell.value = "—"; cell.font = Font(size=10, color=MUTE)
            else:
                cell.value = (f"{rate:.0f}%  ({up:+.0f})" if up is not None else f"{rate:.0f}%")
                good = up is not None and up > 1; bad = up is not None and up < -1
                cell.font = Font(size=10, bold=(good or bad), color=(OK_FG if good else (WARN_FG if bad else INK)))
                if good or bad:
                    cell.fill = PatternFill("solid", fgColor=(OK_BG if good else WARN_BG))
        # acquisition stickiness — of the NEW depositors we won, share who came back (deposited again) within the window;
        # this IS the metric the acq call is made on (stick_30 = 30d; stick_7 = early read), vs the typical acq promo (median).
        for sk, sval, smed in (("stick7", o.get("r_stick_7"), o.get("r_stick_median_7")),
                               ("stick30", o.get("r_stick_30"), o.get("r_stick_median"))):
            if sk not in colidx:
                continue
            scell = ws.cell(row=r, column=colidx[sk])
            if sval is None:
                scell.value = "—"; scell.font = Font(size=10, color=MUTE)
            else:
                gap = (sval - smed) if smed is not None else None
                scell.value = (f"{sval:.0f}%  ({gap:+.0f})" if gap is not None else f"{sval:.0f}%")
                good = gap is not None and gap > 1; bad = gap is not None and gap < -1
                scell.font = Font(size=10, bold=(good or bad), color=(OK_FG if good else (WARN_FG if bad else INK)))
                if good or bad:
                    scell.fill = PatternFill("solid", fgColor=(OK_BG if good else WARN_BG))
            scell.alignment = Alignment(horizontal="center", vertical="center")
        # bonus-ROI-over-time cells — extra net revenue per RM1; 0 = broke even, positive = profit
        roi = o.get("roi") or {}
        for k, win in ROI_KEYS.items():
            if k not in colidx:
                continue
            val = roi.get(win)
            cell = ws.cell(row=r, column=colidx[k])
            if val is None:
                cell.value = "—"; cell.font = Font(size=10, color=MUTE)
            else:
                cell.value = f"{val:+.2f}"
                good = val > 0.05; bad = val < -0.05
                cell.font = Font(size=10, bold=(good or bad), color=(OK_FG if good else (WARN_FG if bad else INK)))
                if good or bad:
                    cell.fill = PatternFill("solid", fgColor=(OK_BG if good else WARN_BG))
            cell.alignment = Alignment(horizontal="center", vertical="center")
        # extra-redeposits (incremental redeposit lift vs typical) — the retention signal the Retention/VIP call is actually scored on
        if "redep" in colidx:
            rdu = o.get("r_redeposit_uplift")
            rcell = ws.cell(row=r, column=colidx["redep"])
            if rdu is None:
                rcell.value = "—"; rcell.font = Font(size=10, color=MUTE)
            else:
                rcell.value = f"{rdu:+.1f}"
                good = rdu > 1; bad = rdu < -1
                rcell.font = Font(size=10, bold=(good or bad), color=(OK_FG if good else (WARN_FG if bad else INK)))
                if good or bad:
                    rcell.fill = PatternFill("solid", fgColor=(OK_BG if good else WARN_BG))
            rcell.alignment = Alignment(horizontal="center", vertical="center")
        # deposits-back (gross RM the claimers put back in the window after claim) — a raw activity fact, NOT profit
        # (net profit per RM1 is the adjacent Bonus-ROI group); left uncoloured so it never reads as a good/bad signal
        mbk_o = o.get("mb") or {}
        for dk, wkey in (("dep7", "d7"), ("dep30", "d30"), ("dep60", "d60"), ("dep90", "d90")):
            if dk not in colidx:
                continue
            dcell = ws.cell(row=r, column=colidx[dk])
            dv = mbk_o.get(wkey)
            if dv is None:
                dcell.value = "—"; dcell.font = Font(size=10, color=MUTE)
            else:
                dcell.value = money(sym, dv); dcell.font = Font(size=10, color=INK)
            dcell.alignment = Alignment(horizontal="center", vertical="center")
        # who-claimed (actual) — flag VIP codes whose actual audience is low/mid deposit (mistargeted vs a VIP-value expectation)
        if "actual" in colidx and o.get("pillar") == "VIP":
            _w = o.get("wt") or {}
            if _w.get("n") and (_w.get("med_dep", 0) or 0) < 5000:
                ac = ws.cell(row=r, column=colidx["actual"])
                ac.fill = PatternFill("solid", fgColor=WARN_BG)
                ac.font = Font(size=9, color=WARN_FG)
        # pays-back-later review flag — green holdout candidate, amber unconfirmed rise, blank otherwise
        if "payback" in colidx:
            _pb_text, pb_level = pays_back_flag(o)
            pcell = ws.cell(row=r, column=colidx["payback"])
            if pb_level == "strong":
                pcell.fill = PatternFill("solid", fgColor=OK_BG); pcell.font = Font(size=9.5, bold=True, color=OK_FG)
                cc = ws.cell(row=r, column=colidx["code"])   # highlight the code itself (blue) so the 11 pop
                cc.fill = PatternFill("solid", fgColor=HILITE_BG); cc.font = Font(size=10, bold=True, color=HILITE_FG)
            elif pb_level == "weak":
                pcell.fill = PatternFill("solid", fgColor=WARN_BG); pcell.font = Font(size=9.5, color=WARN_FG)
        # lifetime-value vs type-avg colour — green clearly above (>=1.25x), amber clearly below (<=0.75x or negative);
        # wide band because the value is a whale-skewed mean, so small gaps are noise
        khv = (kh.get("value") or {})
        cv, nv = khv.get("per_player"), khv.get("norm")
        if "lval" in colidx and cv is not None and nv is not None and nv > 0:
            lc = ws.cell(row=r, column=colidx["lval"])
            if cv < 0 or cv <= 0.75 * nv:
                lc.fill = PatternFill("solid", fgColor=WARN_BG); lc.font = Font(size=10, color=WARN_FG)
            elif cv >= 1.25 * nv:
                lc.fill = PatternFill("solid", fgColor=OK_BG); lc.font = Font(size=10, bold=True, color=OK_FG)
        # verified chip
        vc = ws.cell(row=r, column=colidx["ver"])
        vc.fill = PatternFill("solid", fgColor=(OK_BG if verified else CHK_BG))
        vc.font = Font(size=10, bold=True, color=(OK_FG if verified else CHK_FG))
        # house-edge (GGR coverage) colour — >=1 the edge covered the bonus (bad NGR = luck), <1 structurally underwater
        if "ggr" in colidx:
            gc = o.get("r_ggr_coverage")
            gcell = ws.cell(row=r, column=colidx["ggr"])
            if gc is not None:
                gcell.font = Font(size=10, bold=True, color=(OK_FG if gc >= 1 else WARN_FG))
                gcell.fill = PatternFill("solid", fgColor=(OK_BG if gc >= 1 else WARN_BG))
        r += 1

    ws.freeze_panes = "C7"
    ws.sheet_view.zoomScale = 90
    return ws


def build_readme(wb, metas):
    ws = wb.create_sheet("How to read this", 0)
    ws.sheet_view.showGridLines = False
    ws.column_dimensions["A"].width = 2; ws.column_dimensions["B"].width = 26; ws.column_dimensions["C"].width = 98

    # two colours only: NAVY labels, BODY grey text, white ground — no fills. Thin borders + one body size.
    BODY = "44515F"
    BODYSZ = 10.5

    def line(r, b, c, *, height=22):
        cb = ws.cell(row=r, column=2, value=b); cc = ws.cell(row=r, column=3, value=c)
        cb.font = Font(size=BODYSZ, bold=True, color=NAVY); cc.font = Font(size=BODYSZ, color=BODY)
        cb.alignment = Alignment(vertical="center", wrap_text=True); cc.alignment = Alignment(vertical="center", wrap_text=True)
        cb.border = BORDER; cc.border = BORDER
        ws.row_dimensions[r].height = height

    def head(r, text):
        ws.merge_cells(start_row=r, start_column=2, end_row=r, end_column=3)
        ws.cell(row=r, column=2, value=text).font = Font(size=12, bold=True, color=NAVY)
        ws.cell(row=r, column=2).alignment = Alignment(vertical="center")
        for col in (2, 3):
            ws.cell(row=r, column=col).border = BORDER
        ws.row_dimensions[r].height = 22

    ws.merge_cells("B2:C2"); ws.cell(row=2, column=2, value="How to read this").font = Font(size=15, bold=True, color=NAVY); ws.row_dimensions[2].height = 26
    summary = ("A per-pillar effectiveness read on every managed promo — the per-promo figures reproduced directly from the warehouse.\n"
               "•  Acquisition — cost per new depositor + do new players stick (of the new depositors we won, share who deposit again within 7 & 30 days).\n"
               "•  Retention — cost per retained player + do they keep depositing (7/30/60/90/lifetime) + Bonus ROI (the extra net revenue per RM1, over time; 0 = broke even).\n"
               "•  VIP — the same Bonus ROI (the \"extra\") over time + do top players keep depositing.\n"
               "Every pillar also shows house edge (is a loss real, or just luck?) and lifetime NGR (who it reaches); Retention & VIP add a \"Pays back later?\" review flag.")
    ws.merge_cells("B3:C3"); sc = ws.cell(row=3, column=2, value=summary)
    sc.font = Font(size=BODYSZ, color=BODY); sc.alignment = Alignment(vertical="top", wrap_text=True)
    sc.border = BORDER; ws.cell(row=3, column=3).border = BORDER
    ws.row_dimensions[3].height = 96

    r = 5
    line(r, "The tabs", "Six data tabs — MY and SG × Acquisition / Retention / VIP. Each grades its promos on that pillar's job.", height=26); r += 1
    line(r, "Reading a row", "code → the call → what it costs or earns → does it keep players (share who deposited again at 7 / 30 / 60 / 90 days & "
         "lifetime, next to the average for the same kind of promo) → loyalty → what to do → verified.", height=40); r += 1
    line(r, "Only two colours", "Green = better than the same kind of promo, or the check holds up.  Amber = worse, or actually losing money.  \"—\" = too recent to tell yet.", height=26); r += 2

    head(r, "Each pillar's yardstick"); r += 1
    line(r, "Acquisition", "Cost per new depositor (cheaper = better) + do new players stick — of the new depositors we won, the share who came back within 7 & 30 days, vs the typical acquisition promo. The 30-day is the number the call is made on; the 7-day is an early read.", height=36); r += 1
    line(r, "Retention", "Cost per retained + does the money pay back over time (Bonus ROI) + do they keep depositing (7/30/60/90 & lifetime).", height=26); r += 1
    line(r, "VIP", "Does the money pay back over time (Bonus ROI) + do top players keep depositing (7/30/60/90 & lifetime).", height=24); r += 1
    line(r, "Bonus ROI over time", "The extra net revenue per RM1 of bonus at 7/30/60/90 days & lifetime. 0 = broke even, green = profit, amber = loss. THE CALL (Scale/Reduce/Stop…) IS SCORED ON THE FIRST-WEEK (7-day) figure — the report's reliable window — so a losing call can sit beside a green 30/60/90-day or lifetime number: the code lost in week 1, and later windows often drift up but are rougher (lifetime is roughest). When that happens the \"Pays back later?\" column judges whether the later recovery is real (test before cutting) or just drift (end it).", height=64); r += 1
    line(r, "House edge", "Did players win? If the house's built-in win covered the bonus, a bad result is mostly bad luck; if it didn't, it's a real loss.", height=26); r += 1
    line(r, "Pays back later?", "A REVIEW prompt for losing calls (Stop / Reduce), not a decision. Green \"test before cutting\" (code highlighted "
         "blue) = the Bonus ROI recovers to positive by a matured 30–60-day window AND the rise is backed up — it's steady (not a spike), players still come back, and the house edge covered the bonus. Worth a holdout test (keep a matched group off the promo and compare the two) before we cut. "
         "Amber \"Recovers on paper only — end it (don't revive)\" = the ROI number rises but the backing fails — the rise is spiky, players don't return, or it wasn't cash-safe (or it only turns positive at the drift-prone lifetime window). Likely baseline drift (the 'what they'd normally generate' comparison level moved on its own over the long window, not because of the promo), so the call stands. Blank = a genuine loser.", height=58); r += 1
    line(r, "Claimed → deposited", "Acquisition only — of everyone who claimed, the share who actually made a first deposit (with the counts). A LOW % next to a high cost/new-depositor means the code brings depositors but LEAKS — most claimers never deposit. That's a conversion problem, not a too-big-bonus problem.", height=36); r += 1
    line(r, "Why this call", "The specific PROBLEM behind the call — e.g. \"only 9% of claimers deposit\", \"makes money but keeps fewer players\", \"barely pays for what it gives\". Paired with the lever (its fix).", height=32); r += 1
    line(r, "The lever", "The specific FIX — the full target MECHANIC to build (size or match % · TO · min-deposit · eligible games, taken from the recommended-config tab — MY or SG by region — for this code's tier × type) PLUS the exact SEGMENT to give it to (tier + behaviour + lapse window). Codes off the config show what to turn; codes already on it show \"sharpen the audience\". No-deposit types never say \"raise min-deposit\".", height=52); r += 1
    line(r, "Verified & your bit", "Spend / claims reconcile and the return reproduces (re-pulled from the warehouse) — the Verification tab shows the proof, "
         "report figure vs fresh re-pull, per code. Then put Agree / Query in \"Wai Yip: agree?\" + notes; start at Stop / Reduce (biggest spend).", height=40); r += 2

    head(r, "Words used"); r += 1
    for term, desc in [
        ("Bonus type", "The kind of bonus: free credit (playable credit) · free spins (free slot spins) · reload / deposit match (a % top-up on a deposit). We compare within the same type — spins vs spins, reload vs reload."),
        ("Why type averages differ", "Each type reaches a different kind of player (a selection effect, not the promo's doing): deposit-based bonuses (reload / match) need real money in, so they reach higher-value depositors; free spins are the cheapest giveaway, reaching newer / casual players. That built-in gap is exactly why we compare within type — so a spins promo isn't punished for its category."),
        ("Same-type avg", "The average for all OTHER promos of the same bonus type. Above it = better than others of its kind, below = worse. The Lifetime-NGR cell is coloured on it — green clearly above (25%+), amber clearly below (or negative); a handful of very high-value players pull this average up, so most players are worth less than the figure shown, and small gaps are just noise."),
        ("The call", "Scale = grow · Maintain = keep as-is · Optimise = right-size · Reduce / Trim = shrink · Stop = end or replace."),
        ("Keeps players", "The share of players who came back and deposited again after taking the promo. On Acquisition this is measured only among the NEW depositors we actually won (not everyone who claimed) — so it reads the stickiness of real players, not the sign-up rate."),
        ("Redeposits vs baseline", "The redeposit rate of a Retention / VIP code's claimers versus the typical rate for a code of its type — the retention signal the call leans on. \"Came back\" says the player returned at all; \"redeposits vs baseline\" is the difference from the type norm: positive = returns above the norm, negative = below (they'd likely have come back anyway). Read as an estimated change vs the norm, not a proven cause. A code can show a high came-back rate yet be below the norm — common at saturated tiers (e.g. Diamond, where almost everyone returns), which is why the call leans on this, not the raw came-back rate."),
        ("NGR lift (incremental NGR)", "The estimated CHANGE in net revenue versus what players normally generate (their 14-day pre-claim baseline) — e.g. RM105 vs RM100 baseline = +RM5. An association / uplift estimate, not a proven causal effect."),
        ("Bonus ROI (NGR lift / RM1)", "The NGR lift vs baseline divided by the bonus spent — net-NGR change vs the player's own run-rate, per RM1 of bonus. Zero = no change vs baseline; positive = above baseline; negative = below. It is improvement vs baseline, NOT absolute profit. Also: return on bonus."),
        ("Bonus paid (money out)", "The total bonus we handed out on the code — what it cost us. The 'money out' side, shown next to Deposits back."),
        ("Deposits back (gross · 7/30/60/90d)", "The total money the code's claimers deposited in the days AFTER they claimed it — the 'money back' figure. It is GROSS deposit volume, NOT profit: a code can show many times its bonus in deposits back and still LOSE money once winnings and the bonus are netted off (e.g. RM381k back on a RM37k bonus, yet Bonus ROI negative). Always read it together with the Bonus ROI (per RM1) column right beside it, which is the profit answer."),
        ("Deposited (30d) — Verification tab", "Of the unique players who CLAIMED a code, how many actually deposited within 30 days. Sits beside Claims and unique-claimers so the claim → deposit gap is explicit (e.g. 420 claims · 245 people · 191 deposited) — a claim is not a deposit."),
        ("NGR — actual (30d / 90d)", "On the 'Money in vs money out' summary: the net gaming revenue these players ACTUALLY generated in the 30 / 90 days after claiming — a warehouse FACT, already net of all bonuses. It includes revenue they'd have generated anyway, so a big actual NGR next to a small or negative NGR lift means the bonus is NOT what caused it. 90d is the fuller player-value view (still accruing for the most recent codes)."),
        ("Repeat-claimers", "Members who claimed the SAME code 2+ times in the period. A high share (amber) flags players cycling the offer ('gaming us') — drill into the code to decide whether to cap it, re-target, or exclude them."),
        ("Who claimed (actual segment)", "Sits next to the lever (which says who a code SHOULD go to) so you read recommended vs actual in one line. It profiles who ACTUALLY claimed: dominant tier · value band by median DEPOSIT in the 90 days BEFORE they claimed (the value axis that beats tier and YTD NGR for stability) · median YTD NGR. Amber on a VIP code = its actual claimers are low/mid-deposit — it reached non-VIP-value players (mistargeting). This is who CLAIMED it (warehouse), not the CRM send-list (Smartico/FastTrack)."),
        ("Lifetime NGR / player", "How much net gaming revenue the players a promo brings in are worth to us, on average, over their whole time with us — their lifetime NGR, per player."),
        ("pts (a.k.a. pp)", "Percentage points — the gap between two rates. +3 pts = 48% came back vs 45% for the same kind of promo."),
        ("Thin / directional", "Only a few codes sit behind the number (a small sample — shown as a low 'n'), so read it as a hint of direction, not proof. Confirm with a holdout before acting."),
        ("NGR / GGR", "Net gaming revenue (NGR) = what we keep after paying out winnings AND the bonuses/rebates we gave out. Gross (GGR) = bets minus wins, before bonuses — so NGR = GGR minus bonuses/rebates."),
        ("Turnover / wagering (TO)", "How much a player must bet before they can withdraw a bonus, e.g. \"8x\" = bet 8 times the bonus. On the tabs and levers the betting requirement is shortened to 'TO'."),
        ("PP (Pragmatic Play)", "The default Slots game provider, shown as 'Slots · PP' in the lever and config tabs. Live Casino uses Evolution."),
        ("House edge (GGR cover)", "For every RM1 of bonus, how much the house won from their play in the next 7 days. 2x = won RM2 per RM1 (they lose to us) · under 1x = the win didn't cover the bonus · a minus = the house lost (players won that week). Pair with Bonus ROI: big house win but negative ROI = we're subsidising a player who loses to us anyway."),
        ("Holdout test", "The clean way to prove a promo worked: give it to some eligible players, withhold it from a matched group, and compare — the gap is the effect the promo actually caused. 'Confirm with a holdout' = don't trust a cross-code number until you've run this."),
        ("Revealed-preference", "Read from what players actually did (which games they wager on), not a controlled test — treat it as a strong hint and confirm with a holdout."),
        ("Attribution", "How we decide a promo gets the credit for money a player spends afterwards."),
    ]:
        line(r, term, desc, height=(30 if len(desc) > 92 else 20)); r += 1
    r += 1
    line(r, "Prepared", f"{date.today().isoformat()} · TBP Promo · independent recompute from the warehouse", height=18)
    ws.sheet_view.zoomScale = 110


def build_verification_sheet(wb, metas):
    """The proof behind the 'Verified' chip: the report's figure next to a fresh warehouse re-pull,
    per code — spend / claims / players (facts, must match) + Bonus ROI 7d (the model, reproduces)."""
    ws = wb.create_sheet("Verification")
    ws.sheet_view.showGridLines = False
    VC = [("mk", "Market", 8, "id"), ("pillar", "Pillar", 11, "id"), ("code", "Promo code", 30, "id"), ("call", "Call", 9, "id"),
          ("s_r", "report", 12, "spend"), ("s_w", "re-pull", 12, "spend"), ("s_m", "✓", 6, "spend"),
          ("c_r", "report", 9, "claims"), ("c_w", "re-pull", 9, "claims"), ("c_m", "✓", 6, "claims"),
          ("p_r", "report", 9, "players"), ("p_w", "re-pull", 9, "players"), ("p_m", "✓", 6, "players"),
          ("dep30n", "count", 10, "depd"),
          ("r_r", "report", 10, "ret"), ("r_w", "reproduced", 11, "ret"), ("r_m", "✓", 6, "ret"),
          ("ver", "Verified", 11, "check")]
    GB = {"id": G["id"], "spend": "2A3F63", "claims": "2A3F63", "players": "2A3F63", "depd": "2F5D50", "ret": "334066", "check": "8A5A00"}
    GL = {"id": "", "spend": "SPEND  (fact)", "claims": "CLAIMS  (fact)", "players": "PLAYERS · who claimed  (fact)",
          "depd": "DEPOSITED · 30d  (fact)",
          "ret": "BONUS ROI · 7d  (the model — reproduces)", "check": ""}
    ncol = len(VC)

    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=ncol)
    ws.cell(row=1, column=1, value="Verification — the report's figures vs a fresh, independent warehouse re-pull").font = Font(size=13, bold=True, color=NAVY)
    ws.row_dimensions[1].height = 24
    ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=ncol)
    ws.cell(row=2, column=1, value="Every managed code re-pulled straight from the raw warehouse, independent of the report. Spend / claims / players (= distinct players who CLAIMED the bonus, not deposit-only) are "
                                   "plain facts and must match exactly; the Bonus ROI (7-day) is the model and should reproduce. Green ✓ = matches. This is what the "
                                   "\"Verified\" column on each pillar tab is built on.").font = Font(size=10, italic=True, color=MUTE)
    ws.row_dimensions[2].height = 28

    gr, hr = 4, 5
    c = 1
    while c <= ncol:
        grp = VC[c - 1][3]; j = c
        while j < ncol and VC[j][3] == grp:
            j += 1
        if GL[grp]:
            ws.merge_cells(start_row=gr, start_column=c, end_row=gr, end_column=j)
            g = ws.cell(row=gr, column=c, value=GL[grp]); g.fill = PatternFill("solid", fgColor=GB[grp])
            g.font = Font(size=9.5, bold=True, color=HEAD_FG); g.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
            for cc in range(c, j + 1):
                ws.cell(row=gr, column=cc).border = BORDER
        c = j + 1
    ws.row_dimensions[gr].height = 22
    for i, (k, name, w, grp) in enumerate(VC, start=1):
        cell = ws.cell(row=hr, column=i, value=name); cell.fill = PatternFill("solid", fgColor=GB[grp])
        cell.font = Font(size=9.5, bold=True, color=HEAD_FG); cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = BORDER; ws.column_dimensions[get_column_letter(i)].width = w
    ws.row_dimensions[hr].height = 22

    rows = []
    for mk, d in metas:
        for o in d["codes"]:
            rows.append((mk, d["sym"], o))
    rows.sort(key=lambda t: (t[0], {"Acquisition": 0, "Retention": 1, "VIP": 2}.get(t[2]["pillar"], 9),
                             DEC_ORDER.get(t[2]["decision"], 9), -(t[2].get("r_spend") or 0)))
    colidx = {k: i for i, (k, *_ ) in enumerate(VC, start=1)}

    def put(r, key, val, align="center"):
        cell = ws.cell(row=r, column=colidx[key], value=val); cell.border = BORDER
        cell.font = Font(size=10, color=INK); cell.alignment = Alignment(horizontal=align, vertical="center")
        return cell

    def mark(r, key, ok):
        cell = ws.cell(row=r, column=colidx[key], value=("✓" if ok else "✗")); cell.border = BORDER
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.fill = PatternFill("solid", fgColor=(OK_BG if ok else CHK_BG)); cell.font = Font(size=10, bold=True, color=(OK_FG if ok else CHK_FG))

    r = hr + 1
    for mk, sym, o in rows:
        band = BAND if (r - hr) % 2 == 0 else "FFFFFF"
        s_ok = (o.get("w_spend") is not None and o.get("r_spend") and abs(o["w_spend"] - o["r_spend"]) / max(o["r_spend"], 1) <= 0.02)
        c_ok = o.get("w_claims") == o.get("r_claims")
        p_ok = o.get("w_claimers") == o.get("r_claimers")
        rp, rw = o.get("r_per_rm"), o.get("repro_per_rm")
        r_ok = (rp is None) or (rw is not None and abs(rw - rp) <= max(0.10, 0.05 * abs(rp)))
        verified = s_ok and c_ok and p_ok and r_ok
        put(r, "mk", mk); put(r, "pillar", o["pillar"]); put(r, "code", o["code"], "left")
        dc = put(r, "call", o["decision"])
        if o["decision"] in DEC:
            fill, font = DEC[o["decision"]]; dc.fill = PatternFill("solid", fgColor=fill); dc.font = Font(size=10, bold=True, color=font)
        put(r, "s_r", money(sym, o.get("r_spend"))); put(r, "s_w", money(sym, o.get("w_spend"))); mark(r, "s_m", bool(s_ok))
        put(r, "c_r", o.get("r_claims")); put(r, "c_w", o.get("w_claims")); mark(r, "c_m", c_ok)
        put(r, "p_r", o.get("r_claimers")); put(r, "p_w", o.get("w_claimers")); mark(r, "p_m", p_ok)
        _mbk = o.get("mb") or {}
        put(r, "dep30n", (_mbk.get("dep30") if _mbk.get("dep30") is not None else "—"))
        put(r, "r_r", (f"{sym}{rp:,.2f}" if rp is not None else "n/a"))
        put(r, "r_w", (f"{sym}{rw:,.2f}" if rw is not None else "n/a"))
        if rp is None:
            put(r, "r_m", "n/a").font = Font(size=9, color=MUTE)
        else:
            mark(r, "r_m", bool(r_ok))
        vc = ws.cell(row=r, column=colidx["ver"], value=("Verified" if verified else "Check"))
        vc.border = BORDER; vc.alignment = Alignment(horizontal="center", vertical="center")
        vc.fill = PatternFill("solid", fgColor=(OK_BG if verified else CHK_BG)); vc.font = Font(size=10, bold=True, color=(OK_FG if verified else CHK_FG))
        for k in ("mk", "pillar", "code"):
            ws.cell(row=r, column=colidx[k]).fill = PatternFill("solid", fgColor=band)
        r += 1
    ws.freeze_panes = "D6"
    ws.sheet_view.zoomScale = 90
    return ws


def build_moneyflow_sheet(wb, metas):
    """Money in vs money out — ONE tab per region.  Each tab: the roll-up SUMMARY (by pillar x bonus
    type), then the PER-CODE breakdown below it.  Two-sided ledger — MONEY OUT (bonus we gave, incl.
    the First-claim vs Total split whose gap = repeat-claim 'gaming' cost) vs MONEY IN (redepositors +
    deposit amount at 7/30/90 days after claim; cash-in, not profit).  Effectiveness -> pillar tabs."""
    from collections import defaultdict
    OUTBG, INBG = "2A3F63", "2F5D50"
    widths = [30, 12, 12, 11, 9, 10, 10, 12, 12, 12, 8, 8, 8, 12, 12, 13]
    NCOL = len(widths)
    OUT_HED = ["Claims", "Unique\nclaimers", "Repeat-\nclaimers", "First-claim\nbonus", "Total\nbonus", "Repeat\ncost"]
    IN_HED = ["Redepositors\n7d", "Redepositors\n30d", "Redepositors\n90d", "Deposit amt\n7d", "Deposit amt\n30d", "Deposit amt\n90d"]
    pill_ord = {"Acquisition": 0, "Retention": 1, "VIP": 2}

    def bt(m):
        m = (m or "").lower()
        if "spin" in m:
            return "Free spins"
        if "credit" in m or m == "fc":
            return "Free credit"
        if "cash" in m:
            return "Cashback"
        if "reload" in m or "match" in m or "deposit" in m:
            return "Deposit"
        return (m or "other").title()

    for mk, d in metas:
        sym = d["sym"]
        rc = load(f"repeatclaimers-{mk}.json") or {}
        dt = load(f"deposit-truth-{mk}.json") or {}
        bw = dt.get("byWindow") or {}
        dw7, dw30, dw90 = bw.get("7") or {}, bw.get("30") or {}, bw.get("90") or {}
        _bg = lambda w, lbl: ((w.get("byGroup") or {}).get(lbl) or {})
        ws = wb.create_sheet(f"{mk} · Bonus vs Deposits")
        ws.sheet_view.showGridLines = False
        for i, w in enumerate(widths, start=1):
            ws.column_dimensions[get_column_letter(i)].width = w

        def merge(r0, c0, r1, c1):
            ws.merge_cells(start_row=r0, start_column=c0, end_row=r1, end_column=c1)

        def banner(rr):
            for (c0, c1, label, color) in ((5, 10, "MONEY OUT — the bonus we gave", OUTBG), (11, 16, "MONEY IN — deposits back", INBG)):
                merge(rr, c0, rr, c1)
                gc = ws.cell(rr, c0, label)
                gc.fill = PatternFill("solid", fgColor=color)
                gc.font = Font(size=10, bold=True, color=HEAD_FG)
                gc.alignment = Alignment(horizontal="center", vertical="center")
                for cc in range(c0, c1 + 1):
                    ws.cell(rr, cc).border = BORDER
            ws.row_dimensions[rr].height = 18

        def header(rr, id_hed):
            HED = id_hed + OUT_HED + IN_HED
            HCOL = [None, None, None, None] + [OUTBG] * 6 + [INBG] * 6
            for i, name in enumerate(HED, start=1):
                hc = ws.cell(rr, i, name)
                hc.fill = PatternFill("solid", fgColor=(HCOL[i - 1] or "3B4657"))
                hc.font = Font(size=9, bold=True, color=HEAD_FG)
                hc.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
                hc.border = BORDER
            ws.row_dimensions[rr].height = 30

        def money_cells(a):
            rcost = a["tot"] - a["uniq"]
            return [money(sym, a["uniq"]), money(sym, a["tot"]), money(sym, rcost),
                    f"{a['dep7']:,}", f"{a['dep30']:,}", f"{a['dep90']:,}",
                    money(sym, a["d7"]), money(sym, a["d30"]), money(sym, a["d90"])]

        def money_cells_distinct(a, lbl):
            # BONUS SPEND (additive) from a; PLAYER DEPOSITS = WITHIN-GROUP distinct per window (dedup)
            g7, g30, g90 = _bg(dw7, lbl), _bg(dw30, lbl), _bg(dw90, lbl)
            rcost = a["tot"] - a["uniq"]
            return [money(sym, a["uniq"]), money(sym, a["tot"]), money(sym, rcost),
                    f"{int(g7.get('depositors', a['dep7'])):,}", f"{int(g30.get('depositors', a['dep30'])):,}", f"{int(g90.get('depositors', a['dep90'])):,}",
                    money(sym, g7.get('dep', a['d7'])), money(sym, g30.get('dep', a['d30'])), money(sym, g90.get('dep', a['d90']))]

        def rowfmt(rr, vals, band, left_cols):
            for i, v in enumerate(vals, start=1):
                cell = ws.cell(rr, i, v)
                cell.border = BORDER
                cell.fill = PatternFill("solid", fgColor=band)
                cell.font = Font(size=9.5, color=INK)
                cell.alignment = Alignment(horizontal=("left" if i in left_cols else "center"), vertical="center")

        agg = defaultdict(lambda: dict(n=0, tot=0, uniq=0, claims=0, clmrs=0, rep=0, dep7=0, dep30=0, dep90=0, d7=0, d30=0, d90=0))
        for o in d["codes"]:
            key = (o["pillar"], bt(o.get("mechanic")))
            a = agg[key]
            a["n"] += 1
            a["tot"] += o.get("r_spend") or 0
            rr = rc.get(o["code"]) or {}
            a["uniq"] += rr.get("unique_bonus", 0)
            a["rep"] += rr.get("repeat_claimers", 0)
            a["claims"] += o.get("r_claims") or 0
            a["clmrs"] += o.get("r_claimers") or 0
            mb = o.get("mb") or {}
            for w in ("dep7", "dep30", "dep90", "d7", "d30", "d90"):
                a[w] += mb.get(w, 0)
        T = {k: sum(a.get(k, 0) for a in agg.values()) for k in ("n", "tot", "uniq", "claims", "clmrs", "rep", "dep7", "dep30", "dep90", "d7", "d30", "d90")}

        r = 1
        merge(r, 1, r, NCOL)
        regname = {"MY": "Malaysia  (WS1 · RM)", "SG": "Singapore  (WS1 · S$ · small market — a rough steer)"}.get(mk, mk)
        ws.cell(r, 1, f"{regname} — money in vs money out").font = Font(size=14, bold=True, color=NAVY)
        ws.row_dimensions[r].height = 24
        r += 1
        merge(r, 1, r, NCOL)
        ws.cell(r, 1, ("MONEY OUT = the bonus we gave.  First-claim bonus = the bonus on each person's FIRST claim · Total bonus = across ALL claims · Repeat cost = Total − First-claim = the bonus spent because people claimed the same code again (the 'gaming' cost).  "
                       "MONEY IN = deposits back: Redepositors = distinct people who deposited, and Deposit amount, at 7 / 30 / 90 days after claiming (cash deposited — not gaming revenue or profit).  "
                       "Per-code figures OVERLAP (a deposit can sit within the window of several codes a player claimed, so it is counted under each) — the distinct, deduplicated total is shown below the tiles.  "
                       "Whether each bonus type earns its keep is judged on the pillar tabs, each on its own metric.")).font = Font(size=9, italic=True, color=MUTE)
        ws.row_dimensions[r].height = 46
        r += 2

        def tile(c0, c1, label, value):
            merge(r, c0, r, c1)
            merge(r + 1, c0, r + 1, c1)
            lc = ws.cell(r, c0, label)
            lc.font = Font(size=8.5, bold=True, color=MUTE)
            lc.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
            vc = ws.cell(r + 1, c0, value)
            vc.font = Font(size=13, bold=True, color=INK)
            vc.alignment = Alignment(horizontal="center", vertical="center")
            for rr in (r, r + 1):
                for cc in range(c0, c1 + 1):
                    ws.cell(rr, cc).fill = PatternFill("solid", fgColor=BAND)
                    ws.cell(rr, cc).border = BORDER

        tile(1, 6, "TOTAL BONUS — money out", money(sym, T["tot"]))
        tile(7, 11, "REPEAT COST — bonus on repeat claims", money(sym, T["tot"] - T["uniq"]))
        tile(12, NCOL, "DISTINCT DEPOSITS 30d — money in", money(sym, dw30.get("distinct") or T["d30"]))
        ws.row_dimensions[r].height = 16
        ws.row_dimensions[r + 1].height = 22
        r += 2
        tile(1, 6, "DISTINCT DEPOSITS 90d — money in", money(sym, dw90.get("distinct") or T["d90"]))
        tile(7, 11, "REDEPOSITORS 30d", f"{T['dep30']:,}")
        tile(12, NCOL, "REPEAT-CLAIMERS — claimed 2+×", f"{T['rep']:,}")
        ws.row_dimensions[r].height = 16
        ws.row_dimensions[r + 1].height = 22
        r += 3

        # DISTINCT DEPOSITS — the deduplicated truth (per-code/Total figures below OVERLAP and double-count)
        if dw30.get("distinct"):
            dist, ov = dw30["distinct"], (T["d30"] or 1)
            fac = ov / dist if dist else 0
            merge(r, 1, r, NCOL)
            ws.cell(r, 1, (f"DISTINCT DEPOSITS 30d (each deposit counted once) = {money(sym, dist)}  ·  {dw30.get('depositors', 0):,} distinct depositors  ·  "
                           f"whole book (all players) {money(sym, dt.get('wholeBook', 0))}.  The SUMMARY rows below count deposits once within each pillar × bonus type; a player active in "
                           f"several types is counted in each row, so the rows sum to more than this distinct total. The BY-CODE section still shows raw per-code figures, which overlap "
                           f"(their sum was {money(sym, ov)}, {fac:.2f}× the distinct).")).font = Font(size=9, bold=True, color=NAVY)
            ws.cell(r, 1).alignment = Alignment(wrap_text=True, vertical="center")
            ws.row_dimensions[r].height = 42
            r += 1
            byp = dw30.get("byPillar") or {}
            al = "  ·  ".join(f"{k} {money(sym, v)}" for k, v in byp.items())
            merge(r, 1, r, NCOL)
            ws.cell(r, 1, (f"Illustrative split of the {money(sym, dist)} distinct (equal share across the {dt.get('nDepReq', 0)} deposit-required promos — observed association, not a profit claim):  "
                           f"{al}  ·  Unattributed (deposits only near no-deposit give-aways) {money(sym, dw30.get('unattributed', 0))} ({dw30.get('unattrPct', 0)}%).")).font = Font(size=9, italic=True, color=MUTE)
            ws.cell(r, 1).alignment = Alignment(wrap_text=True, vertical="center")
            ws.row_dimensions[r].height = 30
            r += 2

        # SUMMARY — by pillar x bonus type
        merge(r, 1, r, NCOL)
        ws.cell(r, 1, "SUMMARY — by pillar × bonus type").font = Font(size=11, bold=True, color=NAVY)
        ws.row_dimensions[r].height = 18
        r += 1
        banner(r); r += 1
        header(r, ["", "Pillar", "Bonus type", "# codes"]); r += 1
        for bi, key in enumerate(sorted(agg.keys(), key=lambda k: (pill_ord.get(k[0], 9), -agg[k]["tot"]))):
            a = agg[key]
            band = BAND if bi % 2 == 0 else "FFFFFF"
            rcost = a["tot"] - a["uniq"]
            vals = ["", key[0], key[1], a["n"], f"{a['claims']:,}", f"{a['clmrs']:,}", f"{a['rep']:,}"] + money_cells_distinct(a, f"{key[0]}||{key[1]}")
            rowfmt(r, vals, band, (2, 3))
            if a["tot"] and rcost / a["tot"] > 0.25:
                cc = ws.cell(r, 10); cc.font = Font(size=9.5, bold=True, color=WARN_FG); cc.fill = PatternFill("solid", fgColor=WARN_BG)
            if a["clmrs"] and a["rep"] / a["clmrs"] > 0.20:
                cc = ws.cell(r, 7); cc.font = Font(size=9.5, bold=True, color=WARN_FG); cc.fill = PatternFill("solid", fgColor=WARN_BG)
            r += 1
        tdep = [money(sym, T["uniq"]), money(sym, T["tot"]), money(sym, T["tot"] - T["uniq"]),
                f"{int(dw7.get('depositors', T['dep7'])):,}", f"{int(dw30.get('depositors', T['dep30'])):,}", f"{int(dw90.get('depositors', T['dep90'])):,}",
                money(sym, dw7.get('distinct', T['d7'])), money(sym, dw30.get('distinct', T['d30'])), money(sym, dw90.get('distinct', T['d90']))]
        tvals = ["", "TOTAL (distinct)", "", T["n"], f"{T['claims']:,}", f"{T['clmrs']:,}", f"{T['rep']:,}"] + tdep
        for i, v in enumerate(tvals, start=1):
            cell = ws.cell(r, i, v)
            cell.border = BORDER
            cell.fill = PatternFill("solid", fgColor="E9EDF3")
            cell.font = Font(size=9.5, bold=True, color=NAVY)
            cell.alignment = Alignment(horizontal=("left" if i in (2, 3) else "center"), vertical="center")
        r += 1
        merge(r, 1, r, NCOL)
        ws.cell(r, 1, ("Whether each bonus type earns its keep is judged on the pillar tabs, each on its own metric — "
                       "Retention → Bonus ROI · Acquisition → cost per new depositor · Free credit → reactivation · VIP → loyalty.")).font = Font(size=9, italic=True, color=MUTE)
        r += 2

        # BY CODE — one row per code
        merge(r, 1, r, NCOL)
        ws.cell(r, 1, "BY CODE — one row per code (sorted by pillar, then total bonus)").font = Font(size=11, bold=True, color=NAVY)
        ws.row_dimensions[r].height = 18
        r += 1
        merge(r, 1, r, NCOL)
        ws.cell(r, 1, (f"Pillar call = each code's effectiveness verdict carried from its pillar tab, scored on first-week bonus ROI (incremental profit per {sym}1 of bonus) — "
                       "not a read on the deposits-back figures here; a code can deposit back more than it cost and still read Stop.")).font = Font(size=9, italic=True, color=MUTE)
        ws.row_dimensions[r].height = 28
        r += 1
        banner(r); r += 1
        header(r, ["Promo code", "Pillar", "Bonus type", "Pillar call\n· 7d ROI"]); r += 1
        codes = sorted(d["codes"], key=lambda o: (pill_ord.get(o["pillar"], 9), -(o.get("r_spend") or 0)))
        for bi, o in enumerate(codes):
            band = BAND if bi % 2 == 0 else "FFFFFF"
            rr = rc.get(o["code"]) or {}
            tot = o.get("r_spend") or 0
            uniq = rr.get("unique_bonus", 0)
            rcost = tot - uniq
            mb = o.get("mb") or {}
            adict = {"tot": tot, "uniq": uniq, "dep7": mb.get("dep7", 0), "dep30": mb.get("dep30", 0), "dep90": mb.get("dep90", 0),
                     "d7": mb.get("d7", 0), "d30": mb.get("d30", 0), "d90": mb.get("d90", 0)}
            vals = [o["code"], o["pillar"], bt(o.get("mechanic")), o.get("decision"),
                    f"{o.get('r_claims') or 0:,}", f"{o.get('r_claimers') or 0:,}", f"{rr.get('repeat_claimers', 0):,}"] + money_cells(adict)
            rowfmt(r, vals, band, (1, 2, 3))
            dc = ws.cell(r, 4)
            if o.get("decision") in DEC:
                fill, font = DEC[o["decision"]]
                dc.fill = PatternFill("solid", fgColor=fill); dc.font = Font(size=9.5, bold=True, color=font)
            if tot and rcost / tot > 0.25:
                cc = ws.cell(r, 10); cc.font = Font(size=9.5, bold=True, color=WARN_FG); cc.fill = PatternFill("solid", fgColor=WARN_BG)
            if (o.get("r_claimers") or 0) and rr.get("repeat_claimers", 0) / o["r_claimers"] > 0.20:
                cc = ws.cell(r, 7); cc.font = Font(size=9.5, bold=True, color=WARN_FG); cc.fill = PatternFill("solid", fgColor=WARN_BG)
            r += 1

        ws.freeze_panes = "E4"
        ws.sheet_view.zoomScale = 95

    return None


def build_moneyledger_bycode_sheet(wb, metas):
    """Per-code version of the Money in vs money out ledger — one row per managed code (MY + SG),
    same MONEY OUT / MONEY IN columns as the roll-up."""
    ws = wb.create_sheet("Ledger by code")
    ws.sheet_view.showGridLines = False
    OUTBG, INBG = "2A3F63", "2F5D50"
    widths = [7, 30, 11, 10, 9, 8, 9, 9, 12, 12, 12, 8, 8, 8, 12, 12, 13]
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w
    NCOL = len(widths)

    def bt(m):
        m = (m or "").lower()
        if "spin" in m:
            return "Free spins"
        if "credit" in m or m == "fc":
            return "Free credit"
        if "cash" in m:
            return "Cashback"
        if "reload" in m or "match" in m or "deposit" in m:
            return "Deposit"
        return (m or "other").title()

    r = 1
    ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=NCOL)
    ws.cell(r, 1, "Ledger by code — money in vs money out, one row per code").font = Font(size=14, bold=True, color=NAVY)
    ws.row_dimensions[r].height = 24
    r += 1
    ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=NCOL)
    ws.cell(r, 1, ("Same ledger as the roll-up, per code.  MONEY OUT = the bonus we gave (First-claim = each person's first claim · Total = all claims · Repeat cost = the gap = bonus on repeat claims).  "
                   "MONEY IN = deposits back (distinct redepositors + deposit amount, 7 / 30 / 90 days after claim — cash in, not profit).  Sorted by market, pillar, then total bonus.  "
                   "The call for each code lives on its pillar tab.")).font = Font(size=9, italic=True, color=MUTE)
    ws.row_dimensions[r].height = 32
    r += 2

    for (c0, c1, label, color) in ((6, 11, "MONEY OUT — the bonus we gave", OUTBG), (12, NCOL, "MONEY IN — deposits back", INBG)):
        ws.merge_cells(start_row=r, start_column=c0, end_row=r, end_column=c1)
        gc = ws.cell(r, c0, label)
        gc.fill = PatternFill("solid", fgColor=color); gc.font = Font(size=10, bold=True, color=HEAD_FG)
        gc.alignment = Alignment(horizontal="center", vertical="center")
        for cc in range(c0, c1 + 1):
            ws.cell(r, cc).border = BORDER
    ws.row_dimensions[r].height = 18
    r += 1
    HED = ["Market", "Promo code", "Pillar", "Type", "Call",
           "Claims", "Unique\nclaimers", "Repeat-\nclaimers", "First-claim\nbonus", "Total\nbonus", "Repeat\ncost",
           "Redepositors\n7d", "Redepositors\n30d", "Redepositors\n90d", "Deposit amt\n7d", "Deposit amt\n30d", "Deposit amt\n90d"]
    HCOL = [None, None, None, None, None, OUTBG, OUTBG, OUTBG, OUTBG, OUTBG, OUTBG, INBG, INBG, INBG, INBG, INBG, INBG]
    for i, name in enumerate(HED, start=1):
        hc = ws.cell(r, i, name)
        hc.fill = PatternFill("solid", fgColor=(HCOL[i - 1] or "3B4657"))
        hc.font = Font(size=9, bold=True, color=HEAD_FG)
        hc.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        hc.border = BORDER
    ws.row_dimensions[r].height = 30
    hdr_row = r
    r += 1

    pill_ord = {"Acquisition": 0, "Retention": 1, "VIP": 2}
    rows = []
    for mk, d in metas:
        sym = d["sym"]
        rc = load(f"repeatclaimers-{mk}.json") or {}
        for o in d["codes"]:
            rows.append((mk, sym, o, rc.get(o["code"]) or {}))
    rows.sort(key=lambda t: (t[0], pill_ord.get(t[2]["pillar"], 9), -(t[2].get("r_spend") or 0)))

    for bi, (mk, sym, o, rr) in enumerate(rows):
        band = BAND if bi % 2 == 0 else "FFFFFF"
        tot = o.get("r_spend") or 0
        uniq = rr.get("unique_bonus", 0)
        rcost = tot - uniq
        mb = o.get("mb") or {}
        vals = [mk, o["code"], o["pillar"], bt(o.get("mechanic")), o.get("decision"),
                f"{o.get('r_claims') or 0:,}", f"{o.get('r_claimers') or 0:,}", f"{rr.get('repeat_claimers', 0):,}",
                money(sym, uniq), money(sym, tot), money(sym, rcost),
                f"{mb.get('dep7', 0):,}", f"{mb.get('dep30', 0):,}", f"{mb.get('dep90', 0):,}",
                money(sym, mb.get("d7", 0)), money(sym, mb.get("d30", 0)), money(sym, mb.get("d90", 0))]
        for i, v in enumerate(vals, start=1):
            cell = ws.cell(r, i, v)
            cell.border = BORDER
            cell.fill = PatternFill("solid", fgColor=band)
            cell.font = Font(size=9.5, color=INK)
            cell.alignment = Alignment(horizontal=("left" if i in (2, 3, 4) else "center"), vertical="center")
        dc = ws.cell(r, 5)
        if o.get("decision") in DEC:
            fill, font = DEC[o["decision"]]
            dc.fill = PatternFill("solid", fgColor=fill); dc.font = Font(size=9.5, bold=True, color=font)
        if tot and rcost / tot > 0.25:
            cc = ws.cell(r, 11); cc.font = Font(size=9.5, bold=True, color=WARN_FG); cc.fill = PatternFill("solid", fgColor=WARN_BG)
        if (o.get("r_claimers") or 0) and rr.get("repeat_claimers", 0) / o["r_claimers"] > 0.20:
            cc = ws.cell(r, 8); cc.font = Font(size=9.5, bold=True, color=WARN_FG); cc.fill = PatternFill("solid", fgColor=WARN_BG)
        r += 1

    ws.freeze_panes = f"C{hdr_row + 1}"
    ws.sheet_view.zoomScale = 90
    return ws


def build_deposit_band_master_sheet(wb, metas):
    """Deposit-band master — every code re-sliced by WHO it reaches (the claimers' 90d deposit band),
    with the band's MOVE over each group and each code's CALL beside it, so strategy-vs-execution gaps
    (budget on the low-value tail; 'Reduce' calls on high-value audiences) are visible. Collapsed = the
    value spine (strategy); expanded = the codes. A 'by who' re-slice — reuses data, no new pull."""
    from openpyxl.worksheet.properties import Outline
    ws = wb.create_sheet("Deposit-band master")
    ws.sheet_view.showGridLines = False
    ws.sheet_properties.outlinePr = Outline(summaryBelow=False, summaryRight=False)
    widths = [13, 12, 34, 11, 18, 12, 30]
    NCOL = len(widths)
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w

    BANDS = ["whale", "high", "mid", "low"]
    MOVE = {"whale": "PROTECT", "high": "GROW", "mid": "CONVERT", "low": "AUTOMATE"}
    PAYS = {   # MY-measured per RM1: (net)=net revenue, (dep)=deposits pulled. Cashback = lever to PILOT, not scored here. Currency-neutral (no RM) so nothing leaks onto SG.
        "whale": "what pays: reload +2.4 (net) · giveaway wasted (~0) · VIP no-deposit +3.1 (dep) — pilot cashback",
        "high":  "what pays: reload +1.8 (net) · giveaway 0.91 (dep) · VIP no-deposit +3.0 (dep) — pilot cashback",
        "mid":   "what pays: giveaway 1.08 (dep, peak) · reload +1.4 (net) · VIP match loses",
        "low":   "what pays: reload +0.8 (net) · giveaway 0.55 (dep, weak)",
    }
    ACC = {"whale": "7A5C10", "high": "1F5C8B", "mid": "3B6B4A", "low": "5B6B7B"}
    LOSE = {"Stop", "Reduce", "Trim"}; GROWCALL = {"Scale", "Maintain"}

    def bt(m):
        m = (m or "").lower()
        if "spin" in m: return "Free spins"
        if "credit" in m or m == "fc": return "Free credit"
        if "cash" in m: return "Cashback"
        if "reload" in m or "match" in m or "deposit" in m: return "Deposit"
        return (m or "other").title()

    def merge(r0, c0, r1, c1): ws.merge_cells(start_row=r0, start_column=c0, end_row=r1, end_column=c1)

    r = 1
    merge(r, 1, r, NCOL)
    ws.cell(r, 1, "Deposit-band master — every code, re-sliced by who it reaches").font = Font(size=14, bold=True, color=NAVY)
    ws.row_dimensions[r].height = 24; r += 1
    merge(r, 1, r, NCOL)
    ws.cell(r, 1, ("Codes grouped by the deposit BAND of the players who actually claimed them (median 90-day pre-claim deposit). Each band carries its MOVE "
                   "(what the audience deserves); each code carries its CALL (the ROI verdict). Where they disagree is flagged. Collapse a band (▸) to see strategy only; expand for its codes. "
                   "This is the 'by who' cut — the pillar tabs are 'by purpose', the money tab is the cash ledger.")).font = Font(size=9, italic=True, color=MUTE)
    ws.row_dimensions[r].height = 42; r += 1

    for mk, d in metas:
        sym = d["sym"]
        seg = load(f"segment-map-{mk}.json") or {"grid": []}
        est = {}; est_mem = {}
        for vb, st, mem, ngr, md in seg["grid"]:
            b2 = vb.lower()
            est[b2] = est.get(b2, 0) + (ngr or 0)
            est_mem[b2] = est_mem.get(b2, 0) + (mem or 0)
        est_tot = sum(est.values()) or 1
        band_codes = {b: [] for b in BANDS}; acq = []
        for o in d["codes"]:
            if o.get("pillar") == "Acquisition":
                acq.append(o); continue
            w = o.get("wt") or {}; md = w.get("med_dep")
            band_codes[wt_band(md) if md is not None else "low"].append(o)
        band_spend = {b: sum((o.get("r_spend") or 0) for o in band_codes[b]) for b in BANDS}
        tot_spend = sum(band_spend.values()) or 1
        acq_spend = sum((o.get("r_spend") or 0) for o in acq)

        merge(r, 1, r, NCOL)
        c = ws.cell(r, 1, {"MY": "Malaysia  (WS1 · RM)", "SG": "Singapore  (WS1 · S$ · returns are the MY read — directional)"}.get(mk, mk))
        c.font = Font(size=12, bold=True, color=HEAD_FG)
        for cc in range(1, NCOL + 1): ws.cell(r, cc).fill = PatternFill("solid", fgColor=NAVY)
        ws.row_dimensions[r].height = 20; r += 1

        merge(r, 1, r, NCOL)
        ws.cell(r, 1, "SPEND vs VALUE — is the bonus budget going where the money is?").font = Font(size=11, bold=True, color=NAVY)
        ws.row_dimensions[r].height = 18; r += 1
        for i, h in enumerate(["Band", "Move", "# codes", "Bonus spend", "Spend %\n(90d-claimer band)", "Players\n(annual estate)", "Value — annual NGR\n(share)"], start=1):
            hc = ws.cell(r, i, h); hc.fill = PatternFill("solid", fgColor="3B4657"); hc.font = Font(size=9, bold=True, color=HEAD_FG)
            hc.alignment = Alignment(horizontal=("left" if i <= 2 else "center"), vertical="center", wrap_text=True); hc.border = BORDER
        ws.row_dimensions[r].height = 26; r += 1
        for bi, b in enumerate(BANDS):
            sp = band_spend[b]; est_pct = 100 * est.get(b, 0) / est_tot; sp_pct = 100 * sp / tot_spend
            for i, v in enumerate([b.capitalize(), MOVE[b], len(band_codes[b]), money(sym, sp), f"{sp_pct:.0f}%", f"{est_mem.get(b, 0):,}", f"{money(sym, est.get(b, 0))} · {est_pct:.0f}%"], start=1):
                cell = ws.cell(r, i, v); cell.border = BORDER; cell.font = Font(size=9.5, color=INK, bold=(i == 1))
                cell.alignment = Alignment(horizontal=("left" if i <= 2 else "center"), vertical="center")
                cell.fill = PatternFill("solid", fgColor=(BAND if bi % 2 == 0 else "FFFFFF"))
            if b == "low" and sp_pct > est_pct + 10:
                fc = ws.cell(r, 5); fc.fill = PatternFill("solid", fgColor=WARN_BG); fc.font = Font(size=9.5, bold=True, color=WARN_FG)
            r += 1
        for i, v in enumerate(["Acq (new)", "—", len(acq), money(sym, acq_spend), "—", "—", "first-deposit axis"], start=1):
            cell = ws.cell(r, i, v); cell.border = BORDER; cell.font = Font(size=9, italic=True, color=MUTE)
            cell.alignment = Alignment(horizontal=("left" if i <= 2 else "center"), vertical="center")
        r += 1

        crown = [o for bb in ("whale", "high") for o in band_codes[bb] if o.get("decision") in LOSE]
        crown_sp = sum((o.get("r_spend") or 0) for o in crown)
        tail = [o for o in band_codes["low"] if o.get("decision") in GROWCALL]
        tail_sp = sum((o.get("r_spend") or 0) for o in tail)
        merge(r, 1, r, NCOL)
        ws.cell(r, 1, (f"▶ Budget skews to low value: codes reaching low-deposit (90d) claimers take {100 * band_spend['low'] / tot_spend:.0f}% of spend ({money(sym, band_spend['low'])}), yet low-value players are ~{100 * est.get('low', 0) / est_tot:.0f}% of annual NGR; "
                       f"whale-reaching codes get {100 * band_spend['whale'] / tot_spend:.0f}% ({money(sym, band_spend['whale'])}), though Whales are {100 * est.get('whale', 0) / est_tot:.0f}% of annual value.")).font = Font(size=9.5, bold=True, color=WARN_FG)
        ws.row_dimensions[r].height = 28; r += 1
        merge(r, 1, r, NCOL)
        ws.cell(r, 1, (f"▶ {money(sym, crown_sp)} of bonus on Whale/High audiences carries a Stop/Reduce/Trim call ({len(crown)} codes) — the audience is your best, so REDESIGN the lever "
                       f"(VIP reload/free-credit loses here — shrink or PILOT a cashback variant), don't just withdraw. Only {money(sym, tail_sp)} ({len(tail)} codes) is actively Scaled/Maintained on the Low tail.")).font = Font(size=9, italic=True, color=MUTE)
        ws.row_dimensions[r].height = 30; r += 1

        merge(r, 1, r, NCOL)
        ws.cell(r, 1, "BY BAND — codes grouped by who they reach  (collapse ▸ for strategy only)").font = Font(size=11, bold=True, color=NAVY)
        ws.row_dimensions[r].height = 18; r += 1

        def coderow(o, reached, note, notefill, notefg, lvl=1):
            nonlocal r
            call = o.get("decision")
            for i, v in enumerate([o.get("pillar"), bt(o.get("mechanic")), o.get("code"), call, reached, money(sym, o.get("r_spend") or 0), note], start=1):
                cell = ws.cell(r, i, v); cell.border = BORDER; cell.font = Font(size=9, color=INK)
                cell.alignment = Alignment(horizontal=("left" if i in (1, 2, 3, 7) else "center"), vertical="center", wrap_text=(i in (3, 7)))
            if call in DEC:
                fill, font = DEC[call]; cc = ws.cell(r, 4); cc.fill = PatternFill("solid", fgColor=fill); cc.font = Font(size=9, bold=True, color=font)
            if notefill:
                nc = ws.cell(r, 7); nc.fill = PatternFill("solid", fgColor=notefill); nc.font = Font(size=8.5, bold=True, color=notefg)
            ws.row_dimensions[r].outlineLevel = lvl; r += 1

        for b in BANDS:
            merge(r, 1, r, NCOL)
            ws.cell(r, 1, f"  {b.upper()}  ·  MOVE: {MOVE[b]}  ·  {money(sym, est.get(b, 0))} annual NGR · {est_mem.get(b, 0):,} players ({100 * est.get(b, 0) / est_tot:.0f}% of value)  ·  {len(band_codes[b])} codes · {money(sym, band_spend[b])} spend").font = Font(size=10, bold=True, color=HEAD_FG)
            for cc in range(1, NCOL + 1): ws.cell(r, cc).fill = PatternFill("solid", fgColor=ACC[b]); ws.cell(r, cc).border = BORDER
            ws.row_dimensions[r].height = 18; r += 1
            merge(r, 1, r, NCOL)
            ws.cell(r, 1, f"     {PAYS[b]}").font = Font(size=9, italic=True, color=MUTE)
            ws.row_dimensions[r].height = 15; r += 1
            for i, h in enumerate(["Pillar", "Bonus type", "Code", "Call", "Reached (med dep/90d)", "Spend", "Note"], start=1):
                cc = ws.cell(r, i, h); cc.fill = PatternFill("solid", fgColor="EDEFF3"); cc.font = Font(size=8.5, bold=True, color=NAVY)
                cc.alignment = Alignment(horizontal=("left" if i in (1, 2, 3) else "center"), vertical="center", wrap_text=True); cc.border = BORDER
            ws.row_dimensions[r].outlineLevel = 1; r += 1
            cs = sorted(band_codes[b], key=lambda o: -(o.get("r_spend") or 0))
            if not cs:
                merge(r, 1, r, NCOL); ws.cell(r, 1, "   (no codes reach this band)").font = Font(size=9, italic=True, color=MUTE)
                ws.row_dimensions[r].outlineLevel = 1; r += 1
            for o in cs:
                md = (o.get("wt") or {}).get("med_dep") or 0
                call = o.get("decision"); note = ""; nf = None; nfg = MUTE
                if b in ("whale", "high") and call in LOSE:
                    note = "→ losing on best players — pilot cashback" if (o.get("pillar") == "VIP" and bt(o.get("mechanic")) in ("Deposit", "Free credit")) else "→ best players — fix the code, don't cut"
                    nf = WARN_BG; nfg = WARN_FG
                elif b == "low" and call in GROWCALL:
                    note = "review — growing the low tail"; nf = CHK_BG; nfg = CHK_FG
                reached = f"~{sym}0 · no prior dep" if md == 0 else f"{sym}{md:,.0f}"
                coderow(o, reached, note, nf, nfg)

        merge(r, 1, r, NCOL)
        ws.cell(r, 1, f"  ACQUISITION — new players (first-deposit axis, not a deposit band)  ·  {len(acq)} codes · {money(sym, acq_spend)} spend").font = Font(size=10, bold=True, color=HEAD_FG)
        for cc in range(1, NCOL + 1): ws.cell(r, cc).fill = PatternFill("solid", fgColor="2F5D50"); ws.cell(r, cc).border = BORDER
        ws.row_dimensions[r].height = 18; r += 1
        for o in sorted(acq, key=lambda o: -(o.get("r_spend") or 0)):
            coderow(o, "new player", "judged on cost/FTD + stick", None, MUTE)

        merge(r, 1, r, NCOL)
        ws.cell(r, 1, ("Basis: bands = the claimers' median 90-day pre-claim deposit (Whale ≥" + sym + "50k · High ≥" + sym + "5k · Mid ≥" + sym + "500 · Low <" + sym + "500) — the same axis as the config tabs. "
                       "Estate value % (YTD NGR) is the annual estate view (matches the Segment map), shown only for the spend-vs-value contrast; the two windows are labelled and never combined in one figure. "
                       "Spend = bonus cost. 'What pays' is MY-measured per RM1 of bonus — reload = net revenue (net); giveaway / VIP no-deposit = gross deposits pulled (dep); CASHBACK is the VIP lever to PILOT, not separately ROI-scored in this estate. SG borrows the MY read. "
                       "Each code sits under the band of its median claimer's 90d deposit (the typical claimer, not necessarily the most-numerous band). Directional own-baseline — confirm with a holdout.")).font = Font(size=8, italic=True, color=MUTE)
        ws.row_dimensions[r].height = 44; r += 2

    ws.freeze_panes = "A3"
    ws.sheet_view.zoomScale = 95
    return ws


def build_segment_map_sheet(wb, metas):
    """Easy segmentation view — the targetable base as a VALUE (YTD-deposit band) x STATE (recency)
    heat-grid of member counts, coloured by targeting priority, with each band's share of value."""
    ws = wb.create_sheet("Segment map")
    ws.sheet_view.showGridLines = False
    widths = [17, 13, 13, 13, 13, 11, 17, 46]
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w
    NCOL = len(widths)
    VB = ["Whale", "High", "Mid", "Low"]

    def vbl(sym):   # value-band labels — same YTD-deposit thresholds both regions, currency symbol per market
        return {"Whale": f"Whale ({sym}100k+)", "High": f"High ({sym}20–100k)", "Mid": f"Mid ({sym}2–20k)", "Low": f"Low (<{sym}2k)"}
    ST = ["Active", "Cooling", "Lapsed", "Dormant"]
    STL = {"Active": "Active\n≤30d", "Cooling": "Cooling\n31–60d", "Lapsed": "Lapsed\n61–90d", "Dormant": "Dormant\n90d+"}
    NOTE = {"Whale": "Guard hard — cashback / VIP care; reactivate the moment they cool.",
            "High": "Retention + reactivation; deposit bonuses.",
            "Mid": "Reload / free-spins; free-credit to win back when lapsed.",
            "Low": "Low value — cheap / capped only; don't chase the dormant tail."}

    def merge(r0, c0, r1, c1):
        ws.merge_cells(start_row=r0, start_column=c0, end_row=r1, end_column=c1)

    def cell_color(vi, si):
        if vi == 3:                      # Low value -> deprioritise
            return (BAND, INK)
        if si == 0:                      # valuable + active -> keep
            return (OK_BG, OK_FG)
        if si in (1, 2):                 # valuable + cooling/lapsed -> ACT (the prize)
            return (WARN_BG, WARN_FG)
        return (CHK_BG, CHK_FG)          # valuable + dormant -> winback / lost

    r = 1
    merge(r, 1, r, NCOL)
    ws.cell(r, 1, "Segment map — who your players are").font = Font(size=14, bold=True, color=NAVY)
    ws.row_dimensions[r].height = 24
    r += 1
    merge(r, 1, r, NCOL)
    ws.cell(r, 1, ("VALUE = YTD-deposit band (the value axis that beats tier and YTD NGR for stability).  STATE = recency (days since last deposit).  Each cell = number of members.  "
                   "Colour = targeting priority: green = valuable & active (keep) · amber = valuable but COOLING / LAPSED (reactivate — the prize) · red = valuable but DORMANT (winback or accept loss) · grey = low value (cheap / capped only).  "
                   "Depositors only (never-deposited = acquisition, out of scope here).")).font = Font(size=9, italic=True, color=MUTE)
    ws.row_dimensions[r].height = 44
    r += 2

    for mk, d in metas:
        sym = d["sym"]
        VBL = vbl(sym)
        data = load(f"segment-map-{mk}.json") or {"grid": []}
        cellm, celln = {}, {}
        for vb, st, mem, ngr, md in data["grid"]:
            cellm[(vb, st)] = mem
            celln[(vb, st)] = ngr
        grand_ngr = sum(celln.values()) or 1

        merge(r, 1, r, NCOL)
        ws.cell(r, 1, {"MY": "Malaysia  (WS1 · RM)", "SG": "Singapore  (WS1 · S$)"}.get(mk, mk)).font = Font(size=12, bold=True, color=HEAD_FG)
        for c in range(1, NCOL + 1):
            ws.cell(r, c).fill = PatternFill("solid", fgColor=NAVY)
        ws.row_dimensions[r].height = 20
        r += 1
        hdr = ["Value band"] + [STL[s] for s in ST] + ["Members", "YTD NGR (share)", "What to do"]
        for i, h in enumerate(hdr, start=1):
            hc = ws.cell(r, i, h)
            hc.fill = PatternFill("solid", fgColor="3B4657")
            hc.font = Font(size=9, bold=True, color=HEAD_FG)
            hc.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
            hc.border = BORDER
        ws.row_dimensions[r].height = 28
        r += 1
        for vi, vb in enumerate(VB):
            bmem = sum(cellm.get((vb, s), 0) for s in ST)
            bngr = sum(celln.get((vb, s), 0) for s in ST)
            vc = ws.cell(r, 1, VBL[vb])
            vc.font = Font(size=10, bold=True, color=INK)
            vc.alignment = Alignment(horizontal="left", vertical="center")
            vc.border = BORDER
            for si, st in enumerate(ST):
                bg, fg = cell_color(vi, si)
                cc = ws.cell(r, 2 + si, f"{cellm.get((vb, st), 0):,}")
                cc.fill = PatternFill("solid", fgColor=bg)
                cc.font = Font(size=10, bold=(bg == WARN_BG), color=fg)
                cc.alignment = Alignment(horizontal="center", vertical="center")
                cc.border = BORDER
            tm = ws.cell(r, 6, f"{bmem:,}")
            tm.font = Font(size=10, bold=True, color=INK)
            tm.alignment = Alignment(horizontal="center", vertical="center")
            tm.border = BORDER
            tn = ws.cell(r, 7, f"{money(sym, bngr)}  ({100 * bngr / grand_ngr:.0f}%)")
            tn.font = Font(size=9.5, color=INK)
            tn.alignment = Alignment(horizontal="center", vertical="center")
            tn.border = BORDER
            nt = ws.cell(r, 8, NOTE[vb])
            nt.font = Font(size=9, color=MUTE)
            nt.alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)
            nt.border = BORDER
            ws.row_dimensions[r].height = 26
            r += 1
        slip_m = sum(cellm.get((vb, s), 0) for vb in ("Whale", "High") for s in ("Cooling", "Lapsed"))
        slip_ngr = sum(celln.get((vb, s), 0) for vb in ("Whale", "High") for s in ("Cooling", "Lapsed"))
        merge(r, 1, r, NCOL)
        ws.cell(r, 1, f"   ▶  Reactivation priority: {slip_m:,} whale + high-value players are COOLING or LAPSING — {money(sym, slip_ngr)} of YTD NGR at risk (the amber zone).").font = Font(size=9.5, bold=True, color=WARN_FG)
        r += 2

    ws.sheet_view.zoomScale = 100
    ws.freeze_panes = "B4"
    return ws


def build_call_action_sheet(wb):
    """Reference tab: each call -> its definition + the specific action/lever it points to.
    Verified against the acq/ret/vip decision logic + the live 'What to do' action text."""
    ws = wb.create_sheet("Calls & levers", 1)
    ws.sheet_view.showGridLines = False
    for col, w in (("A", 2), ("B", 13), ("C", 50), ("D", 18), ("E", 46)):
        ws.column_dimensions[col].width = w
    BODY, BODYSZ = "44515F", 10.5

    ws.merge_cells("B2:E2")
    ws.cell(row=2, column=2, value="Calls & levers — how to act on each call").font = Font(size=15, bold=True, color=NAVY)
    ws.row_dimensions[2].height = 26
    ws.merge_cells("B3:E3")
    ic = ws.cell(row=3, column=2, value=("Every promo gets one call. Three are planning / budget moves (Scale, Maintain, Stop) — you don't retune the existing code's dials; you keep it, monitor it, or end it, and any replacement is a fresh build. "
                                         "Three are retune-the-offer moves (Optimise, Trim, Reduce) — the code stays, you adjust it."))
    ic.font = Font(size=BODYSZ, color=BODY); ic.alignment = Alignment(vertical="top", wrap_text=True)
    for col in range(2, 6):
        ws.cell(row=3, column=col).border = BORDER
    ws.row_dimensions[3].height = 40

    hr = 5
    for col, txt in ((2, "The call"), (3, "What it means"), (4, "Action type"), (5, "Specific lever(s)")):
        c = ws.cell(row=hr, column=col, value=txt)
        c.fill = PatternFill("solid", fgColor=NAVY); c.font = Font(size=10, bold=True, color="FFFFFF")
        c.alignment = Alignment(horizontal="left", vertical="center", wrap_text=True); c.border = BORDER
    ws.row_dimensions[hr].height = 20

    calls = [
        ("Scale", "Works AND pays — brings players back / cheap to acquire, and profitable.", "Plan / budget",
         "Raise budget, broaden who's eligible. Run it more, to more people. No mechanic change."),
        ("Maintain", "Profitable and keeps players, but not standout.", "Monitor",
         "None — keep as-is, re-check next cycle."),
        ("Optimise", "Works on ONE axis only — makes money but keeps few, or keeps players but barely profits, or reaches players who'd deposit anyway.", "Adjust mechanics",
         "Cut bonus amount, raise min-deposit, tighten targeting. Free-spins: change the game / spin count."),
        ("Trim", "Keeps players but MILDLY too generous to profit.", "Adjust mechanics",
         "Cut bonus size a little, raise the betting requirement (TO). A light shrink."),
        ("Reduce", "Keeps players but CLEARLY too generous — leaking margin.", "Adjust mechanics",
         "Cut bonus %, raise TO, raise min-deposit. A bigger shrink than Trim."),
        ("Stop", "Loses money AND doesn't keep players better than its type (acquisition: brings in nobody).", "Plan / end",
         "End it, or replace with a different kind of bonus. Remove from the plan."),
    ]
    r = hr + 1
    for call, means, atype, lever in calls:
        cc = ws.cell(row=r, column=2, value=call)
        fill, font = DEC.get(call, ("FFFFFF", NAVY))
        cc.fill = PatternFill("solid", fgColor=fill); cc.font = Font(size=10.5, bold=True, color=font)
        cc.alignment = Alignment(horizontal="left", vertical="center")
        for col, val in ((3, means), (4, atype), (5, lever)):
            x = ws.cell(row=r, column=col, value=val)
            x.font = Font(size=BODYSZ, bold=(col == 4), color=(NAVY if col == 4 else BODY))
            x.alignment = Alignment(vertical="center", wrap_text=True)
        for col in range(2, 6):
            ws.cell(row=r, column=col).border = BORDER
        ws.row_dimensions[r].height = 46
        r += 1

    def section(r, title, pairs, h=24):
        ws.merge_cells(start_row=r, start_column=2, end_row=r, end_column=5)
        ws.cell(row=r, column=2, value=title).font = Font(size=12, bold=True, color=NAVY)
        for col in range(2, 6):
            ws.cell(row=r, column=col).border = BORDER
        ws.row_dimensions[r].height = 22; r += 1
        for name, desc in pairs:
            b = ws.cell(row=r, column=2, value=name)
            ws.merge_cells(start_row=r, start_column=3, end_row=r, end_column=5)
            d = ws.cell(row=r, column=3, value=desc)
            b.font = Font(size=BODYSZ, bold=True, color=NAVY); d.font = Font(size=BODYSZ, color=BODY)
            b.alignment = Alignment(vertical="top", wrap_text=True); d.alignment = Alignment(vertical="top", wrap_text=True)
            for col in range(2, 6):
                ws.cell(row=r, column=col).border = BORDER
            ws.row_dimensions[r].height = h; r += 1
        return r + 1

    r = section(r + 1, "The six levers", [
        ("Bonus size / %", "How much you give. Cut it for Optimise / Trim / Reduce."),
        ("Betting requirement (TO)", "How much they must wager before they can withdraw. Raise it to make an offer less generous."),
        ("Minimum deposit", "The entry bar. Raise it to filter to real depositors."),
        ("Eligibility / targeting", "Who gets it. Broaden for Scale, tighten for Optimise."),
        ("Budget", "How much you spend on the code. Raise for Scale, remove for Stop."),
        ("Kind of bonus (mechanic)", "Free-credit / free-spins / reload / deposit-match. On Stop, replace with a new build."),
    ])
    section(r, "Two things to remember", [
        ("The metric differs by pillar", "Acquisition is judged on cost per new depositor + whether those new depositors come back and deposit again within 30 days; Retention & VIP on Bonus ROI + keeps-players. Same call word, pillar-specific evidence."),
        ("VIP loyalty exception", "A losing VIP code on big players gets Reduce (shrink the offer), NOT Stop — you don't yank a whale's perk."),
    ], h=34)
    return ws


def build_formula_sheet(wb):
    """Reference tab: how every metric on the sheet is worked out — plain formula + a worked example
    (real WS1 numbers) + how to read it. Verified against the acq/ret/vip/ggr computation code."""
    ws = wb.create_sheet("Formulas", 2)
    ws.sheet_view.showGridLines = False
    for col, w in (("A", 2), ("B", 24), ("C", 40), ("D", 44), ("E", 22)):
        ws.column_dimensions[col].width = w
    BODY, BODYSZ = "44515F", 10.5

    ws.merge_cells("B2:E2")
    ws.cell(row=2, column=2, value="How the numbers are worked out").font = Font(size=15, bold=True, color=NAVY)
    ws.row_dimensions[2].height = 26
    ws.merge_cells("B3:E3")
    ic = ws.cell(row=3, column=2, value=("Every metric on this sheet in plain words — what it's made of, a worked example, and how to read it. "
                                         "Only ONE number is modelled — Bonus ROI (and the NGR lift inside it); everything else is counted straight from the warehouse. (Examples in RM, illustrative.)"))
    ic.font = Font(size=BODYSZ, color=BODY); ic.alignment = Alignment(vertical="top", wrap_text=True)
    for col in range(2, 6):
        ws.cell(row=3, column=col).border = BORDER
    ws.row_dimensions[3].height = 42

    hr = 5
    for col, txt in ((2, "Metric"), (3, "Formula"), (4, "Worked example"), (5, "How to read it")):
        c = ws.cell(row=hr, column=col, value=txt)
        c.fill = PatternFill("solid", fgColor=NAVY); c.font = Font(size=10, bold=True, color="FFFFFF")
        c.alignment = Alignment(horizontal="left", vertical="center", wrap_text=True); c.border = BORDER
    ws.row_dimensions[hr].height = 20
    r = [hr + 1]

    def section(title, key):
        ws.merge_cells(start_row=r[0], start_column=2, end_row=r[0], end_column=5)
        cell = ws.cell(row=r[0], column=2, value=title)
        cell.fill = PatternFill("solid", fgColor=G[key]); cell.font = Font(size=10, bold=True, color="FFFFFF")
        cell.alignment = Alignment(horizontal="left", vertical="center")
        for col in range(2, 6):
            ws.cell(row=r[0], column=col).border = BORDER
        ws.row_dimensions[r[0]].height = 18; r[0] += 1

    def row(metric, formula, example, reads, h=40):
        for i, v in enumerate((metric, formula, example, reads)):
            cell = ws.cell(row=r[0], column=2 + i, value=v)
            cell.border = BORDER
            cell.font = Font(size=BODYSZ, bold=(i == 0), color=(NAVY if i == 0 else BODY))
            cell.alignment = Alignment(vertical="center", wrap_text=True)
        ws.row_dimensions[r[0]].height = h; r[0] += 1

    def note(text, h=34):
        ws.merge_cells(start_row=r[0], start_column=2, end_row=r[0], end_column=5)
        c = ws.cell(row=r[0], column=2, value=text)
        c.font = Font(size=9.5, italic=True, color=MUTE); c.alignment = Alignment(vertical="center", wrap_text=True)
        for col in range(2, 6):
            ws.cell(row=r[0], column=col).border = BORDER
        ws.row_dimensions[r[0]].height = h; r[0] += 1

    section("①  The building blocks — counted from the warehouse (facts)", "econ")
    row("Turnover (wagering)", "Total amount bet over the period", "Bets RM1,000 through the week → turnover RM1,000", "How much they played through")
    row("GGR — gross gaming revenue", "Total bets − total wins (before bonuses)", "Bet RM1,000, won RM900 back → GGR RM100", "What the house won at the table")
    row("NGR — net gaming revenue", "GGR − bonuses & rebates we gave out", "GGR RM100 − RM40 bonus → NGR RM60", "What we actually keep")
    row("Bonus spend", "Total bonus granted (redeemed / approved)", "welcomegift: 1,180 claims × ~RM50 → RM59,000", "What the promo cost")

    section("②  The economics — derived (Bonus ROI is the only model)", "roi")
    row("NGR lift (incremental NGR)", "net NGR in the forward window − the player's own 14-day pre-claim daily-average baseline", "Normally RM10/day; after the claim RM30/day → RM20/day above baseline", "Estimated change vs baseline (an association, not a proven cause)", h=48)
    row("Bonus ROI", "NGR lift vs baseline ÷ bonus spent", "PAYDAY 30%: RM653,751 lift ÷ RM202,080 → +3.24 (illustrative; see note)", "Per RM1 of bonus · 0 = no change vs baseline · + above baseline · − below — improvement vs the player's own run-rate, not absolute profit")
    row("House edge (GGR cover) — does the gross margin cover the bonus cost?", "7-day GGR (days 0–6 after claim) ÷ bonus spent", "welcomegift 0.6× (didn't cover) · 200% Welcome 19×", "≥ 1× = the gross margin covers the bonus cost")
    note("NGR lift & Bonus ROI use the report's own attribution method — the player's own 14-day pre-claim daily baseline, a forward window that counts later days for less (flat for lifetime), and credit split across any bonuses running at once — reproduced from raw claim rows. It is an ESTIMATED CHANGE vs each player's baseline, not a controlled-test effect and not absolute profit. The per-code tabs show Bonus ROI at 7 / 30 / 60 / 90 days and lifetime — the 7-day figure reproduces the report exactly, longer windows extend it (lifetime rough). Bonus ROI is the only modelled number; the pipeline treats NGR as already net of the bonus (data definition not independently re-verified against the warehouse). The PAYDAY example is arithmetically consistent with that code's displayed +3.24, but its underlying warehouse lift has not been independently re-run here. Config bands judged on the first-month (28-day) window.")

    section("③  Costs & funnel", "loyal")
    row("Cost / new depositor (acquisition)", "Bonus spent on new players ÷ new depositors", "welcomegift: RM51,200 ÷ 105 new depositors → RM488", "Cheaper = better")
    row("Claimed → deposited (conversion)", "First-time depositors ÷ claimers", "105 ÷ 1,180 → 8.9%", "Low % = leaks — most claimers never deposit")
    row("Cost / retained (retention)", "Bonus spent ÷ players retained (re-deposited within 30d)", "PAYDAY 30%: works out to RM212 per player kept", "Cheaper = better")

    section("④  Behaviour — do they come back", "keeps")
    row("New players came back (stickiness)", "Of new depositors (matured = had the full window elapsed), share who re-deposited within 7 / 30 days", "welcomegift: 59 of 103 matured → 57% at 30d", "Higher = they stay")
    row("Keeps players (came-back)", "Of claimers (matured), share who deposited again within the window", "PAYDAY 30%: 97.7% came back", "Shown with ± points vs the same-type avg")
    row("Same-type avg", "Average of the metric across OTHER codes of the same bonus type (free-credit / spins / reload)", "A free-spins code is judged only vs other free-spins codes", "The like-for-like benchmark", h=48)
    row("Lifetime NGR / player", "Average all-time NGR per player the code brought in", "welcomegift → RM124 per player", "What they're worth over time — a handful of very high-value players pull this average up, so most players are worth less than the figure shown")
    return ws


def build_sweetspot_sheet(wb, metas):
    """Reference tab: how big should the bonus be, and does it STICK? Retention money pillar (MY),
    codes binned by mechanic x size band, spend-weighted Bonus ROI across the first MONTH
    (7 / 14 / 21 / 28 days). Sweet spot ★ = the best 28-day band (did the effect hold through the
    month), with the weekly build-up shown so stickiness is visible (rising = they keep coming back)."""
    from collections import defaultdict
    va = dict(metas).get("MY") or {"codes": []}
    codes = [o for o in va["codes"] if o.get("pillar") == "Retention"]

    def band(a):
        if a is None:
            return None
        return ("< RM30" if a < 30 else "RM30–60" if a < 60 else "RM60–100" if a < 100 else "RM100–300" if a < 300
                else "RM300–600" if a < 600 else "RM600–1000" if a < 1000 else "RM1000+")
    BANDS = ["< RM30", "RM30–60", "RM60–100", "RM100–300", "RM300–600", "RM600–1000", "RM1000+"]
    MECHS = [("free-spins", "Free spins"), ("reload", "Reload / deposit-match"), ("free-credit", "Free credit")]
    WINS = ["7", "14", "21", "28"]
    VERDICT = {
        "free-spins": "Sweet spot: under RM30 — and it STICKS (gets stronger through the month, ~+2.6 by day 28). Keep TO low (5–8x). Above RM100: cut.",
        "reload": "Sweet spot moves UP over the month: RM30–60 wins at day 7, but RM60–100 by day 28 — bigger reloads pay back as players stick. It still pays up to RM300–600 (+0.9, but thin — 1 code); above RM600 it fades to ~break-even by day 28 (+0.5 → −0.1). TO 8–12x.",
        "free-credit": "Loses on Bonus ROI at every size — but that's the WRONG lens. Free-credit's job is reactivation, not week-1 ROI. On that lens it works — see the 'Free-credit reactivation' tab (sweet spot RM100–300, wins back high-value lapsed players).",
    }
    agg = defaultdict(lambda: {"n": 0, "sp": 0.0, "w": {w: [0.0, 0.0] for w in WINS}})
    for o in codes:
        mech = (o.get("mechanic") or "").lower(); amt = o.get("avg_bonus"); sp = o.get("r_spend") or o.get("w_spend") or 0
        roi = o.get("roi") or {}; b = band(amt)
        if not b or sp <= 0:
            continue
        a = agg[(mech, b)]; a["n"] += 1; a["sp"] += sp
        for w in WINS:
            v = roi.get(w)
            if v is not None:
                a["w"][w][0] += v * sp; a["w"][w][1] += sp

    ws = wb.create_sheet("Sweet spot — bonus size", 3)
    ws.sheet_view.showGridLines = False
    for col, wd in (("A", 2), ("B", 16), ("C", 7), ("D", 12), ("E", 9), ("F", 9), ("G", 9), ("H", 10)):
        ws.column_dimensions[col].width = wd
    BODY, BODYSZ = "44515F", 10.5
    ws.merge_cells("B2:H2")
    ws.cell(row=2, column=2, value="Sweet spot — how big, and does it stick?").font = Font(size=15, bold=True, color=NAVY)
    ws.row_dimensions[2].height = 26
    ws.merge_cells("B3:H3")
    ic = ws.cell(row=3, column=2, value=("Retention codes grouped by bonus size, within each mechanic (MY book). Bonus ROI shown WEEKLY across the first month "
                                         "(7 / 14 / 21 / 28 days) — the stickiness view: rising = players keep coming back, flat / falling = the effect fades. The sweet spot "
                                         "★ is the best 28-day band (held through the month). Cross-code, so directional — confirm a size change with a holdout."))
    ic.font = Font(size=BODYSZ, color=BODY); ic.alignment = Alignment(vertical="top", wrap_text=True)
    for col in range(2, 9):
        ws.cell(row=3, column=col).border = BORDER
    ws.row_dimensions[3].height = 70
    r = 5

    def roi_cell(row, coln, val):
        c = ws.cell(row=row, column=coln, value=(f"{val:+.2f}" if val is not None else "—"))
        c.border = BORDER; c.alignment = Alignment(horizontal="center", vertical="center")
        if val is None:
            c.font = Font(size=BODYSZ, color=MUTE)
        else:
            good = val > 0.5; bad = val < 0
            c.font = Font(size=BODYSZ, bold=(good or bad), color=(OK_FG if good else (WARN_FG if bad else INK)))
            if good or bad:
                c.fill = PatternFill("solid", fgColor=(OK_BG if good else WARN_BG))

    for mkey, mlabel in MECHS:
        rows = [(b, agg.get((mkey, b))) for b in BANDS if agg.get((mkey, b)) and agg[(mkey, b)]["n"] > 0]
        if not rows:
            continue
        # sweet spot = best 28-day band (held through the month) with >=3 codes
        cand = [(b, a["w"]["28"][0] / a["w"]["28"][1]) for b, a in rows if a["n"] >= 3 and a["w"]["28"][1]]
        best = max(cand, key=lambda x: x[1]) if cand else None
        sweet = best[0] if (best and best[1] > 0) else None    # no sweet spot if the best band still loses
        ws.merge_cells(start_row=r, start_column=2, end_row=r, end_column=8)
        h = ws.cell(row=r, column=2, value=mlabel)
        h.fill = PatternFill("solid", fgColor=G["keeps"]); h.font = Font(size=11, bold=True, color="FFFFFF")
        h.alignment = Alignment(horizontal="left", vertical="center")
        for col in range(2, 9):
            ws.cell(row=r, column=col).border = BORDER
        ws.row_dimensions[r].height = 20; r += 1
        for col, txt in ((2, "Size band"), (3, "Codes"), (4, "Spend"), (5, "ROI 7d"), (6, "14d"), (7, "21d"), (8, "28d")):
            c = ws.cell(row=r, column=col, value=txt)
            c.fill = PatternFill("solid", fgColor="EDEFF3"); c.font = Font(size=9.5, bold=True, color=NAVY)
            c.alignment = Alignment(horizontal=("left" if col == 2 else "center"), vertical="center", wrap_text=True); c.border = BORDER
        ws.row_dimensions[r].height = 16; r += 1
        for b, a in rows:
            is_sweet = (b == sweet)
            bc = ws.cell(row=r, column=2, value=(b + ("  ★ sweet spot" if is_sweet else "")))
            bc.border = BORDER; bc.alignment = Alignment(horizontal="left", vertical="center")
            bc.font = Font(size=BODYSZ, bold=is_sweet, color=(OK_FG if is_sweet else NAVY))
            if is_sweet:
                bc.fill = PatternFill("solid", fgColor=OK_BG)
            nc = ws.cell(row=r, column=3, value=a["n"]); nc.border = BORDER; nc.alignment = Alignment(horizontal="center"); nc.font = Font(size=BODYSZ, color=BODY)
            sc = ws.cell(row=r, column=4, value=f"RM{a['sp']:,.0f}"); sc.border = BORDER; sc.alignment = Alignment(horizontal="center"); sc.font = Font(size=BODYSZ, color=BODY)
            for w, coln in (("7", 5), ("14", 6), ("21", 7), ("28", 8)):
                wv = a["w"][w]
                roi_cell(r, coln, (wv[0] / wv[1]) if wv[1] else None)
            ws.row_dimensions[r].height = 16; r += 1
        ws.merge_cells(start_row=r, start_column=2, end_row=r, end_column=8)
        v = ws.cell(row=r, column=2, value="→ " + VERDICT[mkey])
        v.font = Font(size=9.5, italic=True, color=NAVY); v.alignment = Alignment(vertical="center", wrap_text=True)
        for col in range(2, 9):
            ws.cell(row=r, column=col).border = BORDER
        ws.row_dimensions[r].height = 30; r += 2

    note = ws.cell(row=r, column=2, value="Basis: spend-weighted Bonus ROI, weekly through the first month; ★ = best 28-day band (did it stick). Cross-code (different codes at different sizes), so directional — confirm a size change with a holdout test at 2–3 amounts.")
    ws.merge_cells(start_row=r, start_column=2, end_row=r, end_column=8)
    note.font = Font(size=9, italic=True, color=MUTE); note.alignment = Alignment(vertical="center", wrap_text=True)
    ws.row_dimensions[r].height = 28
    return ws


def build_reactivation_sheet(wb):
    """Reference tab: free-credit judged on its REAL job — reactivation, not Bonus ROI. Retention
    free-credit codes binned by size, showing reactivation rate + cost per reactivated + do they
    stay + value. On this lens (unlike ROI) free-credit works, and bigger wins back more."""
    from collections import defaultdict
    d = (load("ret/ret-metrics-MY.json") or {}).get("codes", [])
    kh = (load("keeps-horizon-MY.json") or {}).get("codes", {})
    fc = [c for c in d if (c.get("mechanic") or "") == "free-credit" and (c.get("spend") or 0) > 0]

    def bnd(a):
        if a is None:
            return None
        return "< RM30" if a < 30 else "RM30–60" if a < 60 else "RM60–100" if a < 100 else "RM100–300" if a < 300 else "RM300+"
    BANDS = ["< RM30", "RM30–60", "RM60–100", "RM100–300", "RM300+"]
    agg = defaultdict(lambda: {"n": 0, "sp": 0.0, "ret": 0, "mat": 0, "pw": 0.0, "pd": 0, "vn": 0.0, "vd": 0})
    for c in fc:
        b = bnd(c.get("avg_bonus_per_claim"))
        if not b:
            continue
        a = agg[b]; a["n"] += 1; a["sp"] += c.get("spend") or 0
        a["ret"] += c.get("retained") or 0; a["mat"] += c.get("matured_30") or 0
        p, m = c.get("persist_8_29"), c.get("matured_30") or 0
        if p is not None:
            a["pw"] += p * m; a["pd"] += m
        v = ((kh.get(c["code"]) or {}).get("value") or {}).get("per_player")
        if v is not None:
            a["vn"] += v * (c.get("claimers") or 0); a["vd"] += c.get("claimers") or 0
    rows = []
    for b in BANDS:
        a = agg.get(b)
        if not a or a["n"] == 0:
            continue
        rows.append((b, a["n"], a["sp"],
                     (a["ret"] / a["mat"] * 100 if a["mat"] else None),
                     (a["sp"] / a["ret"] if a["ret"] else None),
                     (a["pw"] / a["pd"] if a["pd"] else None),
                     (a["vn"] / a["vd"] if a["vd"] else None)))
    cand = [(rw[0], rw[3]) for rw in rows if rw[1] >= 3 and rw[3] is not None]
    sweet = max(cand, key=lambda x: x[1])[0] if cand else None

    ws = wb.create_sheet("Free-credit reactivation", 5)
    ws.sheet_view.showGridLines = False
    for col, wd in (("A", 2), ("B", 15), ("C", 7), ("D", 12), ("E", 13), ("F", 14), ("G", 15), ("H", 15)):
        ws.column_dimensions[col].width = wd
    BODY, BODYSZ = "44515F", 10.5
    ws.merge_cells("B2:H2")
    ws.cell(row=2, column=2, value="Free-credit — judged as reactivation, not ROI").font = Font(size=15, bold=True, color=NAVY)
    ws.row_dimensions[2].height = 26
    ws.merge_cells("B3:H3")
    ic = ws.cell(row=3, column=2, value=("Free-credit reads negative on Bonus ROI at every size — but that's the WRONG lens. Free-credit is a no-deposit cost, so the short-window "
                                         "net-NGR change it drives rarely recoups the bonus; a negative ROI here does not mean it failed. Its real job is REACTIVATION — winning a "
                                         "lapsed player back and keeping them. Judged on THAT (below), it works — the observed pattern is that bigger free-credit reaches more, higher-value players who stay (a holdout is the proof step)."))
    ic.font = Font(size=BODYSZ, color=BODY); ic.alignment = Alignment(vertical="top", wrap_text=True)
    for col in range(2, 9):
        ws.cell(row=3, column=col).border = BORDER
    ws.row_dimensions[3].height = 56

    r = 5
    for col, txt in ((2, "Bonus size"), (3, "Codes"), (4, "Spend"), (5, "Reactivation %"), (6, "Cost / reactivated"), (7, "Still playing 8–29d"), (8, "Value / player")):
        c = ws.cell(row=r, column=col, value=txt)
        c.fill = PatternFill("solid", fgColor=NAVY); c.font = Font(size=9.5, bold=True, color="FFFFFF")
        c.alignment = Alignment(horizontal=("left" if col == 2 else "center"), vertical="center", wrap_text=True); c.border = BORDER
    ws.row_dimensions[r].height = 26; r += 1
    for b, n, sp, react, cost, per, val in rows:
        is_s = (b == sweet)
        bc = ws.cell(row=r, column=2, value=(b + ("  ★ sweet spot" if is_s else "")))
        bc.font = Font(size=BODYSZ, bold=is_s, color=(OK_FG if is_s else NAVY)); bc.alignment = Alignment(horizontal="left", vertical="center")
        if is_s:
            bc.fill = PatternFill("solid", fgColor=OK_BG)
        vals = [n, f"RM{sp:,.0f}",
                (f"{react:.0f}%" if react is not None else "—"),
                (f"RM{cost:,.0f}" if cost is not None else "—"),
                (f"{per:.0f}%" if per is not None else "—"),
                (f"RM{val:,.0f}" if val is not None else "—")]
        for i, v in enumerate(vals):
            cc = ws.cell(row=r, column=3 + i, value=v); cc.alignment = Alignment(horizontal="center", vertical="center")
            cc.font = Font(size=BODYSZ, color=BODY)
        for col in range(2, 9):
            ws.cell(row=r, column=col).border = BORDER
        ws.row_dimensions[r].height = 17; r += 1
    r += 1
    ws.merge_cells(start_row=r, start_column=2, end_row=r, end_column=8)
    v = ws.cell(row=r, column=2, value=("→ Verdict: on Bonus ROI free-credit looks like a loser at every size — but that's the wrong metric. On REACTIVATION (its real job) it works: "
                                        "reactivation climbs with size (61% → 85%), and bigger free-credit wins back players who STAY longer and are worth far more. Sweet spot RM100–300 — "
                                        "reactivate high-value lapsed players cheaply (~RM148 to win back a player worth much more)."))
    v.font = Font(size=9.5, italic=True, color=NAVY); v.alignment = Alignment(vertical="center", wrap_text=True)
    for col in range(2, 9):
        ws.cell(row=r, column=col).border = BORDER
    ws.row_dimensions[r].height = 44; r += 2
    ws.merge_cells(start_row=r, start_column=2, end_row=r, end_column=8)
    n2 = ws.cell(row=r, column=2, value="Value/player is a mean that a handful of very high-value players pull up, so most players are worth less than the figure shown → directional. The true test is a holdout: give free-credit to some lapsed players, withhold from a matched group, and compare how many come back — that measures reactivation the promo actually caused.")
    n2.font = Font(size=9, italic=True, color=MUTE); n2.alignment = Alignment(vertical="center", wrap_text=True)
    ws.row_dimensions[r].height = 30
    return ws


def build_recipe_sheet(wb, game_category=False):
    """Reference tab: the sweet-spot SETTINGS for a NEW code, per pillar x mechanic, mapped to the
    promo-creation fields (size / TO / min-deposit / tier / eligible games). Best well-sampled band
    (>=5 codes) from the MY managed book — directional, confirm with a holdout. From recipe_engine."""
    ws = wb.create_sheet("MY recommended config", 3)
    ws.sheet_view.showGridLines = False
    for col, wd in (("A", 2), ("B", 15), ("C", 16), ("D", 14), ("E", 13), ("F", 21), ("G", 20), ("H", 16)):
        ws.column_dimensions[col].width = wd
    BODY, BODYSZ = "44515F", 10.5
    ws.merge_cells("B2:H2")
    ws.cell(row=2, column=2, value="MY recommended config — the sweet-spot settings for a new code (RM)").font = Font(size=15, bold=True, color=NAVY)
    ws.row_dimensions[2].height = 26
    ws.merge_cells("B3:H3")
    ic = ws.cell(row=3, column=2, value=("The recommended settings to CREATE a code — broken down by pillar × bonus type × membership tier, so you can read off "
                                         "what to give a Bronze vs a Silver vs a Diamond on each bonus type. Each pillar ALSO carries a 'By deposit band' ladder — "
                                         "the same config read off the player's DEPOSIT value (90d pre-claim; the value axis that beat tier on stability), added alongside tier. "
                                         "Each row is measured on Bonus ROI through the FIRST MONTH "
                                         "(28 days — did players stick, not just week 1); n = how many codes have MATURED behind it (completed the 28-day window, not the total live count). Directional where n is small — confirm a new config with a holdout."))
    ic.font = Font(size=BODYSZ, color=BODY); ic.alignment = Alignment(vertical="top", wrap_text=True)
    for col in range(2, 9):
        ws.cell(row=3, column=col).border = BORDER
    ws.row_dimensions[3].height = 66
    r = [5]

    def hdr(labels=("Mechanic", "Bonus size", "Turnover (TO)", "Min-deposit", "Member / tier", "Eligible games", "Expected · note")):
        for col, txt in enumerate(labels, start=2):
            c = ws.cell(row=r[0], column=col, value=txt)
            c.fill = PatternFill("solid", fgColor="EDEFF3"); c.font = Font(size=9.5, bold=True, color=NAVY)
            c.alignment = Alignment(horizontal="left", vertical="center", wrap_text=True); c.border = BORDER
        ws.row_dimensions[r[0]].height = 16; r[0] += 1

    def band(title, key):
        ws.merge_cells(start_row=r[0], start_column=2, end_row=r[0], end_column=8)
        c = ws.cell(row=r[0], column=2, value=title)
        c.fill = PatternFill("solid", fgColor=G[key]); c.font = Font(size=11, bold=True, color="FFFFFF")
        c.alignment = Alignment(horizontal="left", vertical="center")
        for col in range(2, 9):
            ws.cell(row=r[0], column=col).border = BORDER
        ws.row_dimensions[r[0]].height = 20; r[0] += 1

    def rows(data, h=42):
        for rowv in data:
            for i, v in enumerate(rowv):
                cell = ws.cell(row=r[0], column=2 + i, value=v)
                cell.border = BORDER; cell.alignment = Alignment(vertical="center", wrap_text=True)
                cell.font = Font(size=BODYSZ, bold=(i == 0), color=(NAVY if i == 0 else BODY))
            ws.row_dimensions[r[0]].height = h; r[0] += 1

    def subband(title):
        ws.merge_cells(start_row=r[0], start_column=2, end_row=r[0], end_column=8)
        c = ws.cell(row=r[0], column=2, value=title)
        c.fill = PatternFill("solid", fgColor="5B6B7B"); c.font = Font(size=10, bold=True, color="FFFFFF")
        c.alignment = Alignment(horizontal="left", vertical="center")
        for col in range(2, 9):
            ws.cell(row=r[0], column=col).border = BORDER
        ws.row_dimensions[r[0]].height = 17; r[0] += 1

    def tierhdr(first="Tier", labels=None, expected="Expected · Bonus ROI @ 28 days  (n = matured codes, not total live)"):
        cols = labels if labels else (first, "Bonus size", "Turnover (TO)", "Min-deposit", "Eligible games")
        for col, txt in enumerate(cols, start=2):
            c = ws.cell(row=r[0], column=col, value=txt)
            c.fill = PatternFill("solid", fgColor="EDEFF3"); c.font = Font(size=9.5, bold=True, color=NAVY)
            c.alignment = Alignment(horizontal="left", vertical="center", wrap_text=True); c.border = BORDER
        ws.merge_cells(start_row=r[0], start_column=7, end_row=r[0], end_column=8)
        c = ws.cell(row=r[0], column=7, value=expected)
        c.fill = PatternFill("solid", fgColor="EDEFF3"); c.font = Font(size=9.5, bold=True, color=NAVY)
        c.alignment = Alignment(horizontal="left", vertical="center", wrap_text=True); c.border = BORDER
        ws.cell(row=r[0], column=8).border = BORDER
        ws.row_dimensions[r[0]].height = 16; r[0] += 1

    def tierrows(data, h=28):
        for rv in data:
            for i, v in enumerate(rv[:5]):
                cell = ws.cell(row=r[0], column=2 + i, value=v)
                cell.border = BORDER; cell.alignment = Alignment(vertical="center", wrap_text=True)
                cell.font = Font(size=BODYSZ, bold=(i == 0), color=(NAVY if i == 0 else BODY))
            ws.merge_cells(start_row=r[0], start_column=7, end_row=r[0], end_column=8)
            ec = ws.cell(row=r[0], column=7, value=rv[5])
            ec.border = BORDER; ec.alignment = Alignment(vertical="center", wrap_text=True); ec.font = Font(size=BODYSZ, color=BODY)
            ws.cell(row=r[0], column=8).border = BORDER
            ws.row_dimensions[r[0]].height = h; r[0] += 1

    def note(text, h=16, color=MUTE):
        ws.merge_cells(start_row=r[0], start_column=2, end_row=r[0], end_column=8)
        c = ws.cell(row=r[0], column=2, value=text)
        c.font = Font(size=9, italic=True, color=color); c.alignment = Alignment(vertical="center", wrap_text=True)
        ws.row_dimensions[r[0]].height = h; r[0] += 1

    band("Retention  ·  Bonus ROI (per RM1) — measured through the first month (28 days)", "keeps")
    subband("Free-credit  ·  winback (no deposit)")
    tierhdr(expected="Expected · reactivation  (n = matured codes, not total live)")
    tierrows([
        ("Bronze",   "RM30–60",   "5–8x", "none", "Slots · PP", "reactivates 57% · RM61 each (n24) — keep the pack small"),
        ("Silver",   "RM30–60",   "5–8x", "none", "Slots · PP", "reactivates 75% · RM86 each (n26)"),
        ("Gold",     "RM100–300", "5–8x", "none", "Slots · PP + Live Casino", "reactivates 92% · RM93 each (n8) — worth a bigger pack"),
        ("Platinum", "RM100–300", "5–8x", "none", "Slots · PP + Live Casino", "reactivates 91% · RM176 each (n1 — thin)"),
        ("Diamond",  "RM100–300", "5–8x", "none", "Live Casino + Slots · PP", "reactivates 94% · RM267 each (n2 — thin)"),
    ], h=24)
    note("Free-credit is a WINBACK (no deposit required, TO kept low). The higher the tier, the better it reactivates (57% → 94%) and the bigger the pack that pays for itself — so size rises with tier. Across all tiers the size sweet spot is RM100–300 (85% reactivation; see the Free-credit reactivation evidence tab). Judged on REACTIVATION, not Bonus ROI — a no-deposit give-away is a cost its short-window margin rarely recoups, so it reads negative on ROI; that's the wrong lens for a winback. Confirm with a holdout.", h=38, color=BODY)
    subband("Free-spins  ·  reload (deposit-triggered)")
    tierhdr()
    tierrows([
        ("Bronze",   "RM30–60",  "5–8x",  "RM1–200", "Slots · PP", "+0.9  (n22) — weak; prefer a deposit bonus here"),
        ("Silver",   "RM60–100", "8–12x", "RM1–200", "Slots · PP", "+1.5  (n26) — free-spins works best at Silver"),
        ("Gold",     "—",        "—",     "—",       "—",          "−0.2  (n3) — thin & negative; skip free-spins on Gold"),
        ("Platinum", "≤ RM30",   "5–8x",  "—",       "Slots",      "+1.9  (n2) — thin, directional"),
        ("Diamond",  "RM30–60",  "5–8x",  "—",       "Slots",      "+1.6  (n1) — thin, directional"),
    ])
    subband("Deposit  ·  reload (deposit-match)")
    tierhdr(labels=("Tier", "Match % · max-bonus", "Turnover (TO)", "Min-deposit", "Eligible games"))
    tierrows([
        ("Bronze",   "~30–50% · RM30–60",   "5–8x",           "RM1–200",   "Slots · PP + Live Casino", "+2.8  (n16) — pays back on modest packs"),
        ("Silver ★", "~25–35% · RM100–300", "8–12x",          "RM200–500", "Slots · PP", "+2.9  (n11) — the sweet-spot tier"),
        ("Gold",     "~40–50% · RM100–300", "raise to 8–12x", "RM200–500", "Live Casino + Slots · PP", "+0.4  (n7) — TO<5x is the leak; match is high too, trim toward 30%"),
        ("Platinum", "~40–50% · RM100–300", "8–12x",          "RM200–500", "Live Casino + Slots · PP", "thin (n1) — follow Silver"),
        ("Diamond",  "~10–20% · RM100–600", "12x+",           "RM200–500", "Live Casino (lead) + Slots · PP", "+1.6  (n11) — big deposits, low %; CUT bonus above RM600"),
    ])
    note("Deposit rows read MATCH % · max-bonus cap — a player gets deposit × match %, capped at the RM figure. Match % FALLS as the tier rises (big deposits hit the cap, so Diamond runs ~10–20% while Bronze runs ~30–50%). Size cap: pays up to RM300–600 (1 code — directional); CUT above RM600.  ·  ELIGIBLE GAMES: top-tier deposit players skew LIVE CASINO (Diamond 65% · Gold 45% of segment bonus $) — allow Live Casino · Evolution, not only Slots (game-category pull, directional). Silver stays Slots-led.", h=44, color=BODY)
    subband("By deposit band  ·  the value axis (90d pre-claim deposit) — where the deposit-match pays")
    tierhdr(labels=("Deposit band (90d)", "Match % · max-bonus", "Turnover (TO)", "Min-deposit", "Eligible games"),
            expected="Expected · net revenue per RM1 of bonus  (deposit-required, matured 7d)")
    tierrows([
        ("Whale ≥RM50k",  "~10–20% · RM300–600", "8–12x", "RM1000+",    "Live Casino + Slots · PP", "+2.4 / RM — best return; big deposits, low % (cap the match)"),
        ("High RM5k–50k", "~25–35% · RM100–300", "8–12x", "RM500–1000", "Slots · PP + Live Casino", "+1.8 / RM — strong"),
        ("Mid RM500–5k",  "~30–40% · RM100–300", "5–8x",  "RM200–500",  "Slots · PP",               "+1.4 / RM — the reliable middle"),
        ("Low <RM500",    "~30–50% · RM30–100",  "5–8x",  "RM1–200",    "Slots · PP",               "+0.8 / RM — thin return; keep the pack small"),
    ], h=26)
    note("Deposit bonuses pay MORE the higher the depositor's value band (+2.4/RM on whales → +0.8/RM on the low tail), so match % falls and min-deposit rises as the band climbs (big deposits hit the cap). NO-deposit winback (free-credit / free-spins) flips it: most deposits attracted per RM at MID and HIGH (RM1.08 / RM0.91 per RM1), almost nothing on whales (they already deposit) and weak on the low tail — so aim giveaways at mid/high. Banded on 90d pre-claim deposit (the value axis that beat tier on stability); directional own-baseline — confirm with a holdout.", h=42, color=BODY)
    r[0] += 1

    band("VIP  ·  the 'extra' incremental NGR + loyalty — 28-day basis", "roi")
    subband("Free-credit  ·  loyalty / cashback")
    tierhdr()
    tierrows([
        ("Silver",  "RM300–600", "8–12x", "none", "Slots", "−0.4  (n11) — loyalty perk; negative on ROI, keep small"),
        ("Gold",    "RM300–600", "8–12x", "none", "Slots + Live Casino", "−1.4  (n5) — the most negative; shrink hard"),
        ("Diamond", "RM300–600", "5–8x",  "none", "Live Casino + Slots", "+1.2  (n2) — the only positive tier; only 2 matured so far (early read)"),
    ])
    note("These tiers are free-credit used as a PERK (negative on ROI — expected; treat as loyalty spend, keep small). VIP free-credit in the book is almost all CASHBACK (players keep playing after a loss ~97% at every tier — saturated, so it can't rank tiers on reactivation). For a genuine lapsed-VIP winback, borrow the Retention tier ladder: bigger pack for higher tiers (RM100–300+), low TO, no min-deposit, judged on whether they resume — not ROI. Confirm with a holdout.", h=36, color=BODY)
    subband("Free-spins  ·  reload")
    note("Only a handful of event / check-in free-spins in the book (no ROI signal to read) — not a core VIP mechanic. VIP runs on deposit + free-credit.", h=18, color=BODY)
    subband("Deposit  ·  reload (deposit-match)")
    tierhdr(labels=("Tier", "Match % · max-bonus", "Turnover (TO)", "Min-deposit", "Eligible games"))
    tierrows([
        ("Silver",  "~35–50% · RM300–600",  "raise to 8–12x", "RM500–1000", "Slots", "−0.6  (n5) — <5x TO leaks; raise it"),
        ("Gold",    "~40–50% · RM300–600",  "5–8x",           "RM1000+",    "Live Casino + Slots", "+0.5  (n6) — the one that pays; keep min-dep high (few % tagged — directional)"),
        ("Diamond", "~10–20% · RM600–1000", "raise TO",       "RM1000+",    "Live Casino (lead) + Slots", "−0.1  (n9) — big deposits, low %; ~break-even"),
    ])
    note("Deposit rows read MATCH % · max-bonus cap. VIP 'extra' is negative most months: treat it as loyalty spend, judge on retention, shrink don't kill.  ·  ELIGIBLE GAMES: VIP deposit players skew LIVE CASINO (Diamond 65% · Gold 45% of segment bonus $) — allow Live Casino · Evolution, not only Slots (game-category pull, directional). Same for the biggest free-credit (Diamond is 54% Live Casino).", h=32, color=BODY)
    subband("By deposit band  ·  90d pre-claim deposit — where VIP money actually pays")
    tierhdr(labels=("Deposit band (90d)", "Match % · max-bonus", "Turnover (TO)", "Min-deposit", "Eligible games"),
            expected="Expected · net rev per RM1 (deposit)  ·  cashback attracts per RM1")
    tierrows([
        ("Whale ≥RM50k",  "~10–20% · RM600–1000",      "5–8x", "RM1000+",    "Live Casino + Slots", "deposit +1.5/RM — the ONLY band it pays; cashback also attracts +3.1/RM"),
        ("High RM5k–50k", "cashback-led · RM300–600",  "8–12x", "RM500–1000", "Live Casino + Slots", "deposit ~0/RM (break-even) — lead with cashback: attracts +3.0/RM"),
        ("Mid RM500–5k",  "loyalty only · keep small", "5–8x", "—",           "Slots",               "deposit −0.2/RM — loses; cashback / loyalty only"),
        ("Low <RM500",    "minimal",                   "—",    "—",           "Slots",               "~break-even (+0.1/RM) — not a VIP focus"),
    ], h=26)
    note("VIP deposit-match pays ONLY on whales (+1.5/RM); at High/Mid it is break-even-to-negative — so lead High with CASHBACK (it attracts +3.0/RM of deposits) and treat Mid/Low as loyalty, kept small. Concentrate the VIP budget on Whale + High — that is where both deposit-match and cashback earn. Banded on 90d pre-claim deposit, money-judged lanes; directional — confirm with a holdout.", h=34, color=BODY)
    r[0] += 1

    band("Acquisition  ·  cost per new depositor + do they stick  —  new players have NO tier", "econ")
    note("New depositors haven't earned a membership tier yet, so acquisition can't be split by tier — the rows below are the bonus TYPE (same three as the other pillars), all in the WELCOME context for the whole new-player segment.", h=26, color=BODY)
    tierhdr(first="Bonus type", expected="Expected · cost per new depositor  (n = matured codes, not total live)")
    tierrows([
        ("Free-credit · welcome", "≤ RM50 (no-deposit)",  "n/a *", "n/a *", "Slots", "RM488 per new depositor — expensive; only ~9% convert, but converts stick 57%"),
        ("Free-spins · welcome",  "≤ RM30 (~88 spins)",   "n/a *", "n/a *", "Slots · PP (Gates of Olympus)", "RM23 per new depositor — the cheapest; ~35% stick at 30d"),
        ("Deposit · welcome",     "100–200% (RM100–300)", "n/a *", "n/a *", "Slots", "deposit-match — RM156 per new depositor (thin sample, directional)"),
    ])
    note("Free-credit here ACTIVATES a brand-new player to first deposit — the acquisition cousin of reactivation (no lapsed history yet). Costly per new depositor (RM488 vs RM23 for free-spins), so use sparingly, or as a winback for players who registered but never deposited. Judge on conversion + stick, not ROI.  ·  * no turnover / min-deposit grounded in the data for welcome offers.", h=32, color=BODY)
    subband("By first-deposit band  ·  new players have no prior deposit — band on the FIRST deposit they make")
    tierhdr(labels=("First-deposit band", "Best welcome type · size", "Cost / new depositor", "Sticks 30d", "Eligible games"),
            expected="Note")
    tierrows([
        ("<RM50 / no-deposit", "Free-spins welcome (~88 spins)",     "~RM45–63", "6–26%", "Slots · PP",            "cheap volume, low stick — the acquisition floor; free-spins is the cheapest FTD"),
        ("RM50–150",           "Free-spins / deposit-match",         "~RM87",    "26%",   "Slots · PP",            "mixed; free-spins still cheapest per FTD"),
        ("RM150–500 ★",        "Deposit-match 100–200% (RM100–300)", "~RM90",    "28%",   "Slots (+ Live Casino)", "the efficiency sweet spot — deposit-match buys these FTDs at ~RM90 each"),
        ("RM500–1500",         "Deposit-match (higher cap)",         "~RM232",   "49%",   "Slots + Live Casino",   "pricier but sticks — premium acquisition"),
        ("RM1500+",            "Deposit-match (high cap)",           "~RM190",   "68%",   "Live Casino + Slots",   "stickiest FTDs — worth the cost"),
    ], h=26)
    note("New players have no prior deposit, so acquisition bands on the FIRST deposit they make. Bigger first deposits stick far better (6% at <RM50 → 68% at RM1500+) — a RM500+ new depositor is worth much more than a <RM50 one even though it costs more to win. Free-spins is the cheapest per new depositor (~RM45) but buys the low-stick tail; a deposit-match welcome that pulls a RM150–500 first deposit is the efficiency sweet spot (~RM90 / FTD, better stick). MY / WS1, matured 30d; directional — confirm with a holdout.", h=40, color=BODY)
    r[0] += 1

    if game_category:
        band("Game details by segment  ·  the games each pillar × bonus type × tier actually plays  (revealed-preference — confirm with a holdout)", "id")
        note("For every segment above (same pillar → bonus type → tier order), WHO the players are by game category (share of that segment's bonus spend) and the eligible games to steer to. The category split is by TIER (game taste doesn't change with the promo pillar). KEY FINDING: DEPOSIT at the top tiers is LIVE-CASINO-led (Diamond deposit 65% Live Casino) — those codes should allow Live Casino, not only Slots. Free-spins is ~all Slots everywhere. Basis: MY / WS1, Jan–Aug 2026; confirm with a holdout.", h=52, color=BODY)

        def gc2hdr():
            for txt, c0, c1 in (("Tier", 2, 2), ("Players' dominant game categories (bonus $ share)", 3, 4), ("Recommendation  ·  which games to make the code eligible on", 5, 8)):
                if c1 > c0:
                    ws.merge_cells(start_row=r[0], start_column=c0, end_row=r[0], end_column=c1)
                cc = ws.cell(row=r[0], column=c0, value=txt); cc.fill = PatternFill("solid", fgColor="EDEFF3")
                cc.font = Font(size=9.5, bold=True, color=NAVY); cc.alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)
            for col in range(2, 9):
                ws.cell(row=r[0], column=col).border = BORDER
            ws.row_dimensions[r[0]].height = 26; r[0] += 1

        def gc2rows(data):
            for tier, cats, rec in data:
                ws.cell(row=r[0], column=2, value=tier)
                ws.merge_cells(start_row=r[0], start_column=3, end_row=r[0], end_column=4); ws.cell(row=r[0], column=3, value=cats)
                ws.merge_cells(start_row=r[0], start_column=5, end_row=r[0], end_column=8); ws.cell(row=r[0], column=5, value=rec)
                for col in range(2, 9):
                    cc = ws.cell(row=r[0], column=col); cc.border = BORDER; cc.alignment = Alignment(vertical="center", wrap_text=True)
                    cc.font = Font(size=BODYSZ, bold=(col == 2), color=(NAVY if col == 2 else BODY))
                ws.row_dimensions[r[0]].height = 24; r[0] += 1

        subband("Retention · Free-credit")
        gc2hdr()
        gc2rows([
            ("Bronze", "Slots 81% · Live Casino 14%", "Keep it on Slots · Pragmatic Play — 81% of these players are Slots players."),
            ("Silver", "Slots 74% · Live Casino 19%", "Keep it on Slots · Pragmatic Play — Slots-led."),
            ("Gold", "Slots 65% · Live Casino 29%", "Run it on Slots · PP, and add Live Casino · Evolution — ~29% of this tier's bonus $ is Live Casino play."),
            ("Platinum", "Slots 53% · Live Casino 39%", "Run it on Slots · PP + Live Casino · Evolution — nearly 40% of this tier's bonus $ is Live Casino play."),
            ("Diamond", "Live Casino 54% · Slots 41%", "Lead with Live Casino · Evolution, keep Slots · PP too — the majority (54%) of this tier's bonus $ is Live Casino play."),
        ])
        subband("Retention · Free-spins   (Slots-only mechanic)")
        gc2hdr()
        gc2rows([
            ("Bronze", "Slots 86% · Live Casino 11%", "Keep it on Slots · PP (Gates of Olympus) — free-spins only runs on Slots."),
            ("Silver", "Slots 79% · Live Casino 16%", "Keep it on Slots · PP (Gates of Olympus) — 79% Slots."),
            ("Platinum", "Slots 63% · Live Casino 29%", "Slots · PP only (thin sample — directional)."),
            ("Diamond", "Slots 54% · Live Casino 40%", "Slots · PP only (thin sample — directional)."),
        ])
        subband("Retention · Deposit")
        gc2hdr()
        gc2rows([
            ("Bronze", "Slots 49% · Live Casino 43%", "Allow both Slots · PP and Live Casino · Evolution — the split is near-even."),
            ("Silver", "Slots 60% · Live Casino 28%", "Lead with Slots · PP, add Live Casino as a secondary — 60% Slots."),
            ("Gold", "Live Casino 45% · Slots 42%", "Lead with Live Casino · Evolution + Slots · PP — Live Casino edges it (45%)."),
            ("Platinum", "Live Casino 44% · Slots 43%", "Lead with Live Casino · Evolution + Slots · PP — near-even, Live Casino slightly ahead."),
            ("Diamond", "Live Casino 65% · Slots 29%", "Lead with Live Casino · Evolution (Slots second) — 65% of this tier's bonus $ is Live Casino play."),
        ])
        subband("VIP · Free-credit")
        gc2hdr()
        gc2rows([
            ("Silver", "Slots 74% · Live Casino 19%", "Keep it on Slots · Pragmatic Play — Slots-led."),
            ("Gold", "Slots 65% · Live Casino 29%", "Run it on Slots · PP, and add Live Casino · Evolution — ~29% Live Casino."),
            ("Diamond", "Live Casino 54% · Slots 41%", "Lead with Live Casino · Evolution, keep Slots · PP — the majority (54%) are Live Casino."),
        ])
        subband("VIP · Deposit")
        gc2hdr()
        gc2rows([
            ("Silver", "Slots 60% · Live Casino 28%", "Lead with Slots · PP, add Live Casino as a secondary — 60% Slots."),
            ("Gold", "Live Casino 45% · Slots 42%", "Lead with Live Casino · Evolution + Slots · PP — Live Casino edges it (45%)."),
            ("Diamond", "Live Casino 65% · Slots 29%", "Lead with Live Casino · Evolution (Slots second) — 65% of this tier's bonus $ is Live Casino play."),
        ])
        subband("Acquisition · welcome   (new players — no tier)")
        gc2hdr()
        gc2rows([
            ("New player", "Slots 74% · Live Casino 17% · Sportsbook 4%", "Default Slots · PP (Gates of Olympus) — new players start on Slots (74%). Live Casino is the #2 new-player segment (17%) — worth testing a Live-Casino welcome variant."),
        ])
        note("The recommendation steers a code's ELIGIBLE GAMES to where that segment actually plays. Category split is by tier (a player's game taste is the same whichever pillar the promo serves) — so VIP and Retention rows at the same tier read alike. Sportsbook is deposit-led but small (<400 players); Fishing is free-credit heavy and small. Revealed-preference, not a controlled test → confirm with a holdout before re-steering. Basis: MY / WS1, Jan–Aug 2026.", h=40)
        r[0] += 2

    band("Budget & exposure  ·  bound the TOTAL spend before you launch", "econ")
    note("Every recommended config above is a PER-HEAD setting. To bound TOTAL spend:  MAX EXPOSURE per code = (players you send it to) × (per-head max-bonus, from the config row).  The figures below are what LIVE codes actually run — use them to sanity-check reach, set a hard max-total cap, and a money stop-loss.", h=32, color=BODY)
    for txt, c0, c1 in (("Pillar · bonus type", 2, 3), ("Reach / code", 4, 4), ("Spend / code", 5, 5), ("Suggested max-total cap", 6, 6), ("Stop-loss (pause the code when…)", 7, 8)):
        if c1 > c0:
            ws.merge_cells(start_row=r[0], start_column=c0, end_row=r[0], end_column=c1)
        cc = ws.cell(row=r[0], column=c0, value=txt); cc.fill = PatternFill("solid", fgColor="EDEFF3")
        cc.font = Font(size=9.5, bold=True, color=NAVY); cc.alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)
    for col in range(2, 9):
        ws.cell(row=r[0], column=col).border = BORDER
    ws.row_dimensions[r[0]].height = 26; r[0] += 1
    for label, reach, spend, cap, stop in [
        ("Retention · Deposit", "~15 (busy ~160)", "RM1.6k → 16k", "reach × per-head; a code tops ~RM16k (Gold/Diamond ~RM60k)", "28-day Bonus ROI < 0, or spend hits the cap"),
        ("Retention · Free-spins", "~35 (busy ~450)", "RM1k → 23k", "~RM25k / code", "28-day Bonus ROI < 0, or at the cap"),
        ("Retention · Free-credit (winback)", "~16 (busy ~900)", "RM0.9k → 43k", "~RM45k / code", "reactivation < 55%, or at the cap"),
        ("VIP · Deposit", "~82 (busy ~430)", "RM46k → 84k", "~RM90k / code (Gold ~RM185k)", "ROI < −0.3 (worse than loyalty tolerance)"),
        ("VIP · Free-credit (loyalty)", "~52 (busy ~180)", "RM1.6k → 6k", "cap the MONTHLY loyalty bucket ~RM200k", "the monthly loyalty bucket is exceeded"),
        ("Acquisition · Free-spins", "~14 (busy ~100)", "RM0.5k → 5k", "~RM10k / code — the cheap one, scale it", "cost per new depositor > RM50"),
        ("Acquisition · Deposit", "~6 (busy ~770)", "RM1k → 38k", "~RM40k / code", "cost per new depositor > RM200"),
        ("Acquisition · Free-credit", "~132 (busy ~770)", "RM8k → 40k", "cap TIGHT ~RM40k — expensive (RM488 per new depositor)", "cost per new depositor > RM200"),
    ]:
        ws.merge_cells(start_row=r[0], start_column=2, end_row=r[0], end_column=3); ws.cell(row=r[0], column=2, value=label)
        ws.cell(row=r[0], column=4, value=reach); ws.cell(row=r[0], column=5, value=spend); ws.cell(row=r[0], column=6, value=cap)
        ws.merge_cells(start_row=r[0], start_column=7, end_row=r[0], end_column=8); ws.cell(row=r[0], column=7, value=stop)
        for col in range(2, 9):
            cc = ws.cell(row=r[0], column=col); cc.border = BORDER; cc.alignment = Alignment(vertical="center", wrap_text=True)
            cc.font = Font(size=BODYSZ, bold=(col == 2), color=(NAVY if col == 2 else BODY))
        ws.row_dimensions[r[0]].height = 28; r[0] += 1
    note("Reach = players who claim per code (median → p90 'busy'). Spend/code = the code's total bonus cost (median → busy). Bigger tiers carry a bigger per-head cap, so exposure scales with tier. Expected NET if it works ≈ spend × the config's Bonus ROI (Retention deposit ~+1.6×, free-spins ~+1.4×); free-credit and VIP are judged on reactivation / loyalty, not net.", h=32)
    r[0] += 2

    band("Eligible games — where the house keeps the most, and where the segment plays", "loyal")
    hdr2 = [("Category · Provider", 2, 3), ("House margin (keeps per RM100 wagered)", 4, 4), ("GGR · bonus claimed", 5, 6), ("Steer it to", 7, 8)]
    for txt, c0, c1 in hdr2:
        ws.merge_cells(start_row=r[0], start_column=c0, end_row=r[0], end_column=c1)
        cc = ws.cell(row=r[0], column=c0, value=txt); cc.fill = PatternFill("solid", fgColor="EDEFF3")
        cc.font = Font(size=9.5, bold=True, color=NAVY); cc.alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)
        for col in range(2, 9):
            ws.cell(row=r[0], column=col).border = BORDER
    ws.row_dimensions[r[0]].height = 30; r[0] += 1
    for cat, hold, ggr, use in [
        ("Slots · Pragmatic Play", "4.9% · ~RM4.90", "RM20.2M GGR · RM7.0M (10.5K)", "★ Default — new players + Bronze/Silver + ALL free-spins. Best margin of the high-volume providers + biggest volume."),
        ("Slots · Playtech", "3.4% · ~RM3.40", "RM7.5M GGR", "Slots alternative — cuts the single-title risk (97% of free-spins sit on Gates of Olympus)."),
        ("Live Casino · Evolution", "3.7% · ~RM3.70", "RM14.5M GGR · RM4.9M (2.5K)", "NOT just secondary — the #2 bonus segment and the category for TOP-TIER deposit + free-credit (Diamond deposit 65% LC; bigger in SG). Lower margin — watch it."),
        ("Sportsbook · Saba", "8.1% · ~RM8.10", "RM2.5M GGR · RM0.5M (0.4K)", "Highest margin. Small in MY, but a real SG deposit segment (Silver–Platinum 19–26%) — allow it in SG codes."),
    ]:
        ws.merge_cells(start_row=r[0], start_column=2, end_row=r[0], end_column=3); ws.cell(row=r[0], column=2, value=cat)
        ws.cell(row=r[0], column=4, value=hold)
        ws.merge_cells(start_row=r[0], start_column=5, end_row=r[0], end_column=6); ws.cell(row=r[0], column=5, value=ggr)
        ws.merge_cells(start_row=r[0], start_column=7, end_row=r[0], end_column=8); ws.cell(row=r[0], column=7, value=use)
        for col in range(2, 9):
            cc = ws.cell(row=r[0], column=col); cc.border = BORDER; cc.alignment = Alignment(vertical="center", wrap_text=True)
            cc.font = Font(size=BODYSZ, bold=(col == 2), color=(NAVY if col == 2 else BODY))
        ws.row_dimensions[r[0]].height = 34; r[0] += 1
    ws.merge_cells(start_row=r[0], start_column=2, end_row=r[0], end_column=8)
    g = ws.cell(row=r[0], column=2, value="House margin = GGR ÷ turnover = the cut the house keeps of every ringgit wagered (4.9% ≈ RM4.90 per RM100). Steer eligible games by BOTH the margin AND where the target segment plays by tier: Slots for new / mass players + all free-spins; Live Casino for top-tier deposit + free-credit (even bigger in SG); Sportsbook mainly for SG deposits. Free-spins run only on Slots — 97% on one PP title (Gates of Olympus); test a second Slots title to cut single-title risk.")
    g.font = Font(size=9, italic=True, color=NAVY); g.alignment = Alignment(vertical="center", wrap_text=True)
    ws.row_dimensions[r[0]].height = 40
    return ws


def build_sg_recipe_sheet(wb):
    """SG-SPECIFIC recipe — its OWN tier × type × size / TO / match, measured on the SG book
    (roi-horizon-SG + ret/vip-metrics-SG, spend-weighted Bonus ROI @28d), NOT the MY bands relabelled.
    Same template as Recommended settings (pillar → bonus type → tier). SG named tiers are small, so
    thin cells are flagged directional. Draft-only tab."""
    ws = wb.create_sheet("SG recommended config")
    ws.sheet_view.showGridLines = False
    for col, wd in (("A", 2), ("B", 15), ("C", 20), ("D", 15), ("E", 13), ("F", 21), ("G", 20), ("H", 16)):
        ws.column_dimensions[col].width = wd
    BODY, BODYSZ = "44515F", 10.5
    r = [2]
    ws.merge_cells("B2:H2")
    ws.cell(row=2, column=2, value="SG recommended config — the sweet-spot settings for a new SG code (S$)").font = Font(size=15, bold=True, color=NAVY)
    ws.row_dimensions[2].height = 26
    ws.merge_cells("B3:H3")
    ic = ws.cell(row=3, column=2, value=("The SG-specific recommended config — measured on the SG book (Bonus ROI @ 28 days), NOT the MY bands relabelled. Read like the MY "
        "recommended config: pillar → bonus type → tier. Each pillar also carries a 'By deposit band' ladder (directional — it follows the MY measured gradient; SG has no member-level claim rows to score per band). "
        "SG differs from MY: reload match ~30% (Bronze) / ~45% (Gold–Platinum); "
        "free-spins FAILS at Gold (drop it); Platinum reload is the standout; VIP free-credit is ~100% cashback. SG named tiers are small — "
        "thin cells (small samples) are directional; confirm with a holdout."))
    ic.font = Font(size=BODYSZ, color=BODY); ic.alignment = Alignment(vertical="top", wrap_text=True)
    for col in range(2, 9):
        ws.cell(row=3, column=col).border = BORDER
    ws.row_dimensions[3].height = 56
    r[0] = 5

    def band(title, key):
        ws.merge_cells(start_row=r[0], start_column=2, end_row=r[0], end_column=8)
        c = ws.cell(row=r[0], column=2, value=title); c.fill = PatternFill("solid", fgColor=G[key])
        c.font = Font(size=11, bold=True, color="FFFFFF"); c.alignment = Alignment(horizontal="left", vertical="center")
        for col in range(2, 9):
            ws.cell(row=r[0], column=col).border = BORDER
        ws.row_dimensions[r[0]].height = 20; r[0] += 1

    def subband(title):
        ws.merge_cells(start_row=r[0], start_column=2, end_row=r[0], end_column=8)
        c = ws.cell(row=r[0], column=2, value=title); c.fill = PatternFill("solid", fgColor="5B6B7B")
        c.font = Font(size=10, bold=True, color="FFFFFF"); c.alignment = Alignment(horizontal="left", vertical="center")
        for col in range(2, 9):
            ws.cell(row=r[0], column=col).border = BORDER
        ws.row_dimensions[r[0]].height = 17; r[0] += 1

    def hdr(size_label="Bonus size", expected="Expected · Bonus ROI @ 28d (n = matured codes, not total live)", first="Tier"):
        for col, txt in enumerate((first, size_label, "Turnover (TO)", "Min-deposit", "Eligible games"), start=2):
            c = ws.cell(row=r[0], column=col, value=txt); c.fill = PatternFill("solid", fgColor="EDEFF3")
            c.font = Font(size=9.5, bold=True, color=NAVY); c.alignment = Alignment(horizontal="left", vertical="center", wrap_text=True); c.border = BORDER
        ws.merge_cells(start_row=r[0], start_column=7, end_row=r[0], end_column=8)
        c = ws.cell(row=r[0], column=7, value=expected); c.fill = PatternFill("solid", fgColor="EDEFF3")
        c.font = Font(size=9.5, bold=True, color=NAVY); c.alignment = Alignment(horizontal="left", vertical="center", wrap_text=True); c.border = BORDER
        ws.cell(row=r[0], column=8).border = BORDER
        ws.row_dimensions[r[0]].height = 16; r[0] += 1

    def rows(data, h=22):
        for rv in data:
            for i, v in enumerate(rv[:5]):
                cell = ws.cell(row=r[0], column=2 + i, value=v); cell.border = BORDER
                cell.alignment = Alignment(vertical="center", wrap_text=True)
                cell.font = Font(size=BODYSZ, bold=(i == 0), color=(NAVY if i == 0 else BODY))
            ws.merge_cells(start_row=r[0], start_column=7, end_row=r[0], end_column=8)
            ec = ws.cell(row=r[0], column=7, value=rv[5]); ec.border = BORDER
            ec.alignment = Alignment(vertical="center", wrap_text=True); ec.font = Font(size=BODYSZ, color=BODY)
            ws.cell(row=r[0], column=8).border = BORDER
            ws.row_dimensions[r[0]].height = h; r[0] += 1

    def note(text, h=26, color=MUTE):
        ws.merge_cells(start_row=r[0], start_column=2, end_row=r[0], end_column=8)
        c = ws.cell(row=r[0], column=2, value=text); c.font = Font(size=9, italic=True, color=color)
        c.alignment = Alignment(vertical="center", wrap_text=True)
        ws.row_dimensions[r[0]].height = h; r[0] += 1

    band("Retention  ·  Bonus ROI (per S$1) @ 28 days — the SG book", "keeps")
    subband("Free-credit  ·  winback (reactivation basis; ROI negative is expected)")
    hdr("Free-credit size", "Expected · note")
    rows([
        ("Bronze", "S$30–60", "5–8x", "none", "Slots · PP", "ROI −0.4 (n27) — judge on reactivation, not ROI"),
        ("Silver", "S$30–60", "5–8x", "none", "Slots · PP", "thin (n1) — follow Bronze"),
        ("Gold", "S$100–300", "5–8x", "none", "Slots · PP + Live Casino", "ROI −0.5 (n4) — reactivation basis"),
        ("Platinum", "S$100–300", "5–8x", "none", "Slots · PP + Live Casino", "ROI −0.55 (n6) — reactivation basis"),
        ("Diamond", "S$100–300", "5–8x", "none", "Live Casino + Slots · PP", "thin (n1) — directional"),
    ])
    subband("Free-spins  ·  reload  (Slots-only mechanic)")
    hdr("Free-spins size")
    rows([
        ("Bronze", "S$30–60", "8–12x", "S$1–200", "Slots · PP (Gates of Olympus)", "+0.31 (n47) — the only tier where FS pays"),
        ("Silver", "≤ S$30", "5–8x", "S$1–200", "Slots · PP", "thin (n1)"),
        ("Gold", "— drop it —", "—", "—", "—", "−3.95 (n13) — free-spins FAILS at Gold; run a deposit instead"),
        ("Platinum", "≤ S$30", "5–8x", "—", "Slots", "thin (n3) — directional"),
        ("Diamond", "≤ S$30", "5–8x", "—", "Slots", "thin (n1) — directional"),
    ])
    subband("Deposit  ·  reload (deposit-match)")
    hdr("Match % · max-bonus")
    rows([
        ("Bronze", "~30% · S$100–300", "12x+", "S$200–500", "Live Casino + Slots · PP", "+1.72 (n44) — pays; SG runs high TO here"),
        ("Silver", "~30% · S$100–300", "8–12x", "S$200–500", "Live Casino + Slots + Sportsbook", "thin (n1) — follow Bronze"),
        ("Gold", "~45% · S$100–300", "raise to 8–12x", "S$500–1000", "Live Casino + Slots · PP", "+0.26 (n13) — the leak is TO set <5x; raise it"),
        ("Platinum ★", "~45% · S$300–600", "raise to 8–12x", "S$1000+", "Live Casino + Slots · PP", "+7.9 (n7) — the SG standout; thin, confirm"),
        ("Diamond", "~45% · S$300–600", "raise TO", "S$1000+", "Live Casino + Slots · PP", "thin (n4) — directional"),
    ])
    note("SG reload differs from MY: match is ~30% (Bronze) rising to ~45% (Gold–Platinum), Bronze runs a HIGH turnover (12x+), and Platinum is the standout (+7.9, but n7 — treat as a test, not a rule). Gold/Platinum run TO < 5x today — the leak; raise it.", h=32, color=BODY)
    subband("By deposit band  ·  90d pre-claim deposit  (directional — follows the MY measured gradient; SG sample too thin to score per band)")
    hdr("Match % · max-bonus", "Direction · the MY measured return", first="Deposit band (90d)")
    rows([
        ("Whale ≥S$50k",  "~10–20% · S$300–600", "8–12x", "S$1000+",    "Live Casino + Slots · PP", "highest-return band in MY (+2.4/RM) — cap the match, high min-dep"),
        ("High S$5k–50k", "~30–45% · S$100–300", "8–12x", "S$500–1000", "Live Casino + Slots · PP", "strong in MY (+1.8/RM); SG runs higher match (~45%)"),
        ("Mid S$500–5k",  "~30–45% · S$100–300", "8–12x", "S$200–500",  "Live Casino + Slots · PP", "reliable middle (MY +1.4/RM)"),
        ("Low <S$500",    "~30% · S$30–100",     "12x+",  "S$1–200",    "Slots · PP",               "thin return (MY +0.8/RM); keep the pack small — SG runs high TO"),
    ])
    note("SG has no member-level claim rows to score returns per deposit band, so these FOLLOW the MY measured gradient (deposit-match pays more on higher-value depositors) fitted to SG's own settings — match ~30% (low) rising to ~45% (mid/high), high turnover. Reserve no-deposit winback for mid/high value. Directional — confirm with a holdout.", h=32, color=BODY)
    r[0] += 1

    band("VIP  ·  the 'extra' + loyalty @ 28 days — the SG book", "roi")
    subband("Free-credit  ·  cashback / loyalty  (~100% of net loss)")
    hdr("Cashback · size")
    rows([
        ("Silver", "~100% · S$300–600", "8–12x", "none", "Slots", "thin (n5) — cashback basis"),
        ("Gold", "~100% · S$300–600", "8–12x", "none", "Slots + Live Casino", "−2.07 (n81) — loyalty/cashback; judge on retention"),
        ("Diamond", "~100% · S$600–1000", "5–8x", "none", "Live Casino + Slots", "n71 — cashback (judged on retention, not ROI); keep, shrink don't kill"),
    ])
    subband("Deposit  ·  reload (deposit-match)")
    hdr("Match % · max-bonus")
    rows([
        ("Silver", "~100% · S$300–600", "8–12x", "S$1000+", "Slots", "thin — follow Gold"),
        ("Gold", "~100% · S$300–600", "raise to 8–12x", "S$1000+", "Live Casino + Slots", "−0.3 (n14) — TO < 5x leaks; raise it"),
        ("Diamond", "~100% · S$600–1000", "raise TO", "S$1000+", "Live Casino + Slots", "thin (n3) — directional"),
    ])
    note("VIP free-credit in SG is almost all CASHBACK (~100% of net loss) — a loyalty tool, judged on retention not ROI. VIP free-spins: only a few event codes, no ROI signal. Eligible games: top-tier VIP deposit/free-credit players skew Live Casino, same as MY.", h=32, color=BODY)
    subband("By deposit band  ·  90d pre-claim deposit  (directional — follows the MY pattern; SG is cashback-led)")
    hdr("Match % · max-bonus", "Direction · the MY measured return", first="Deposit band (90d)")
    rows([
        ("Whale ≥S$50k",  "~10–20% · S$600–1000",      "5–8x",  "S$1000+", "Live Casino + Slots", "only band VIP deposit pays in MY (+1.5/RM); cashback attracts hard"),
        ("High S$5k–50k", "cashback-led · S$300–600",  "8–12x", "S$1000+", "Live Casino + Slots", "deposit ~break-even in MY — lead with cashback (~100% of loss)"),
        ("Mid S$500–5k",  "loyalty only · keep small", "8–12x", "—",       "Slots",               "deposit loses in MY (−0.2/RM) — cashback / loyalty only"),
        ("Low <S$500",    "minimal",                   "—",     "—",       "Slots",               "not a VIP focus"),
    ])
    note("SG VIP is almost all CASHBACK (~100% of net loss) — a loyalty tool judged on retention, not ROI. Following the MY money read, deposit-match earns only on whales; lead High with cashback and keep Mid/Low small. No SG per-band scoring (thin) — directional; confirm with a holdout.", h=30, color=BODY)
    r[0] += 1

    band("Game details by segment (SG)  ·  which games to make the code eligible on  (revealed-preference — confirm with a holdout)", "id")
    note("SG is even MORE Live-Casino-led than MY: Live Casino is the #1 SG bonus segment (S$425K bonus vs Slots S$251K), and Sportsbook is a real SG segment (S$96K). Players grouped by the game category they wager most on; the recommendation steers a code's eligible games. Category split is by tier (VIP reads the same as Retention at that tier). Basis: SG book, Jan–Aug 2026; confirm with a holdout.", h=44, color=BODY)

    def gchdr():
        for txt, c0, c1 in (("Tier", 2, 2), ("Players' dominant game categories (bonus $ share)", 3, 4), ("Recommendation  ·  eligible games to allow", 5, 8)):
            if c1 > c0:
                ws.merge_cells(start_row=r[0], start_column=c0, end_row=r[0], end_column=c1)
            cc = ws.cell(row=r[0], column=c0, value=txt); cc.fill = PatternFill("solid", fgColor="EDEFF3")
            cc.font = Font(size=9.5, bold=True, color=NAVY); cc.alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)
        for col in range(2, 9):
            ws.cell(row=r[0], column=col).border = BORDER
        ws.row_dimensions[r[0]].height = 26; r[0] += 1

    def gcrows(data):
        for tier, cats, rec in data:
            ws.cell(row=r[0], column=2, value=tier)
            ws.merge_cells(start_row=r[0], start_column=3, end_row=r[0], end_column=4); ws.cell(row=r[0], column=3, value=cats)
            ws.merge_cells(start_row=r[0], start_column=5, end_row=r[0], end_column=8); ws.cell(row=r[0], column=5, value=rec)
            for col in range(2, 9):
                cc = ws.cell(row=r[0], column=col); cc.border = BORDER; cc.alignment = Alignment(vertical="center", wrap_text=True)
                cc.font = Font(size=BODYSZ, bold=(col == 2), color=(NAVY if col == 2 else BODY))
            ws.row_dimensions[r[0]].height = 24; r[0] += 1

    subband("Deposit  (Retention + VIP — same tier taste)")
    gchdr()
    gcrows([
        ("Bronze", "Live Casino 73% · Slots 20%", "Lead with Live Casino · Evolution — 73% of this tier's bonus $ is Live Casino play."),
        ("Silver", "Live Casino 43% · Slots 31% · Sportsbook 26%", "Very mixed — allow Live Casino + Slots + Sportsbook."),
        ("Gold", "Live Casino 52% · Sportsbook 22%", "Lead Live Casino · Evolution, add Sportsbook — 52% LC, 22% Sportsbook."),
        ("Platinum", "Live Casino 73% · Sportsbook 19%", "Lead Live Casino · Evolution, add Sportsbook — 73% Live Casino."),
        ("Diamond", "Live Casino 86% · Slots 14%", "Lead with Live Casino · Evolution — 86% of this tier's bonus $ is Live Casino play."),
    ])
    subband("Free-spins  (Slots-only mechanic)")
    gchdr()
    gcrows([
        ("Bronze", "Slots 72% · Live Casino 27%", "Keep it on Slots · PP (Gates of Olympus) — free-spins only runs on Slots."),
        ("Silver", "Slots 63% · Live Casino 32%", "Keep it on Slots · PP (Gates of Olympus)."),
    ])
    subband("Free-credit")
    gchdr()
    gcrows([
        ("Bronze", "Slots 52% · Live Casino 41%", "Allow Slots · PP + Live Casino · Evolution — near-even."),
        ("Silver", "Slots 51% · Live Casino 37%", "Lead Slots · PP, add Live Casino — Slots just edges it."),
        ("Gold", "Live Casino 45% · Slots 42%", "Allow Live Casino · Evolution + Slots · PP — an even split."),
        ("Platinum", "Live Casino 70% · Sportsbook 18%", "Lead with Live Casino · Evolution — 70% Live Casino."),
        ("Diamond", "Live Casino 74% · Slots 26%", "Lead with Live Casino · Evolution — 74% Live Casino."),
    ])
    subband("Acquisition · welcome  (new players — no tier)")
    gchdr()
    gcrows([
        ("New player", "Slots 59% · Live Casino 31% · Sportsbook 5%", "Default Slots · PP (Gates of Olympus). Live Casino is a big #2 for SG new players (31%) — a Live-Casino welcome is worth testing here."),
    ])
    note("Sportsbook is a meaningful SG deposit segment at Silver–Platinum (19–26%) — worth allowing there, unlike MY. GGR cover (how many times the gross gaming revenue the play generates covers the bonus cost) is lower in SG (~3–4× vs ~6–7× MY), so keep an eye on margin. Revealed-preference, not a controlled test → confirm before re-steering. Basis: SG book (WS1 · SGD), Jan–Aug 2026.", h=32)
    r[0] += 1

    note("Config basis: the SG book (WS1 · SGD), Bonus ROI @ 28 days, spend-weighted (bigger-spend codes count more); sizes / TO / match spend-weighted from live SG codes. SG named tiers are small — cells marked thin (small samples) are directional. Confirm a new config with a holdout at 2–3 settings. Acquisition not shown (thin in SG).", h=28)
    return ws


def main():
    metas = [(mk, merged(mk)) for mk in ("MY", "SG")]
    wb = Workbook(); wb.remove(wb.active)
    for mk, d in metas:
        sym = d["sym"]
        by = {}
        for o in d["codes"]:
            by.setdefault(o["pillar"], []).append(o)
        for pillar in ("Acquisition", "Retention", "VIP"):
            if by.get(pillar):
                build_pillar_sheet(wb, mk, sym, pillar, by[pillar])
    build_verification_sheet(wb, metas)
    build_moneyflow_sheet(wb, metas)   # 'money in vs money out' — one tab per region (summary + per-code)
    build_readme(wb, [d for _, d in metas])
    wb.move_sheet("How to read this", -(len(wb.sheetnames) - 1))
    build_call_action_sheet(wb)   # reference: call -> action/lever; inserted right after "How to read this"
    build_formula_sheet(wb)       # reference: how every metric is worked out; inserted as the 3rd tab
    build_segment_map_sheet(wb, metas)   # easy segmentation view — value x recency grid; sits just before the config tabs
    build_deposit_band_master_sheet(wb, metas)   # 'by who' cover — codes re-sliced by deposit band, move vs call, spend vs value
    build_recipe_sheet(wb, game_category=True)   # "MY recommended config" incl. Game-details-by-segment (evidence tabs stay in the draft)
    build_sg_recipe_sheet(wb)                     # SG-specific recipe tab
    wb.move_sheet("SG recommended config", (wb.sheetnames.index("MY recommended config") + 1) - wb.sheetnames.index("SG recommended config"))
    wb.move_sheet("MY · Bonus vs Deposits", 1 - wb.sheetnames.index("MY · Bonus vs Deposits"))   # region ledgers right after 'How to read this'
    wb.move_sheet("SG · Bonus vs Deposits", 2 - wb.sheetnames.index("SG · Bonus vs Deposits"))
    _s, _t = wb.sheetnames.index("Segment map"), wb.sheetnames.index("MY recommended config")
    wb.move_sheet("Segment map", (_t - 1 - _s) if _s < _t else (_t - _s))   # place right before "MY recommended config"
    wb.move_sheet("Deposit-band master", 1 - wb.sheetnames.index("Deposit-band master"))   # the 'by who' cover — first strategic tab, right after How to read
    OUT.parent.mkdir(parents=True, exist_ok=True)
    # Atomic write: save to a per-process temp in the same directory, then os.replace onto OUT, so a
    # concurrent reader (extract_explorer_data in another build, or a stolen-lock overlap) never sees a
    # half-written workbook -- it gets either the old complete file or the new complete one.
    import os as _os
    _tmp = OUT.with_name(OUT.stem + f".tmp-{_os.getpid()}" + OUT.suffix)
    wb.save(_tmp)
    _os.replace(_tmp, OUT)
    print("wrote", OUT, "| tabs:", wb.sheetnames)


if __name__ == "__main__":
    main()

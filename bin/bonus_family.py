#!/usr/bin/env python3
"""Bonus family classifier — the shared split key for the value-over-tenure analysis.

The organizing axis is NOT the mechanic name, it's whether the bonus requires a
minimum deposit to claim. Every mechanic (free credit, free spins, reload, welcome)
splits across it:

  give-back  = no-min-deposit slice  (a giveaway; the whole thing is at risk)
  deposit    = min-deposit slice     (player already deposited to claim)

deposit_required (bool) is the clean flag; fall back to min_deposit (0 -> give-back,
>0 -> deposit); if neither is present the code is `unclassified` and its spend is
disclosed, never silently folded (no silent caps).

Run standalone to print the per-market reconciliation table:
    python bin/bonus_family.py
"""
import json, os, sys
from collections import defaultdict

SCRATCH = os.environ.get("SCRATCH") or (
    r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad")

MECH_LABEL = {
    "free-credit": "Free credit", "FreeCredit": "Free credit",
    "reload": "Reload",
    "free-spins": "Free spins", "free-spin": "Free spins", "FreeSpinBonus": "Free spins",
    "DepositBonus": "Deposit bonus", "deposit-bonus": "Deposit bonus",
}


def mech_label(m):
    return MECH_LABEL.get(m, m or "(none)")


def family_of(code):
    """give-back | deposit | unclassified — deposit_required wins, min_deposit is the fallback."""
    dr = code.get("deposit_required")
    md = code.get("min_deposit")
    if dr is True:
        return "deposit"
    if dr is False:
        return "give-back"
    if md is not None and md > 0:
        return "deposit"
    if md == 0:
        return "give-back"
    return "unclassified"


def load(mk):
    def _l(p):
        fp = os.path.join(SCRATCH, p)
        return json.load(open(fp, encoding="utf-8")) if os.path.exists(fp) else None
    return _l(f"ret/ret-metrics-{mk}.json"), _l(f"vip/vip-metrics-{mk}.json")


def _reconcile(mk):
    ret, vip = load(mk)
    if not ret or not vip:
        print(f"[{mk}] skip — metrics missing")
        return
    for pillar, m in (("RET", ret), ("VIP", vip)):
        agg = defaultdict(lambda: defaultdict(lambda: [0, 0.0]))  # mech -> fam -> [codes, spend]
        unclass = [0, 0.0]
        for c in m["codes"]:
            fam = family_of(c)
            lab = mech_label(c.get("mechanic"))
            a = agg[lab][fam]
            a[0] += 1
            a[1] += (c.get("spend") or 0)
            if fam == "unclassified":
                unclass[0] += 1
                unclass[1] += (c.get("spend") or 0)
        print(f"=== [{mk}] {pillar} — mechanic x family (codes / spend) ===")
        for lab, fams in sorted(agg.items()):
            parts = ", ".join(f"{f}:{n}c/{sp:,.0f}" for f, (n, sp) in sorted(fams.items()))
            print(f"  {lab:14s} {parts}")
        print(f"  >> UNCLASSIFIED (no flag): {unclass[0]} codes / {mk} {unclass[1]:,.0f} spend — DISCLOSED\n")


if __name__ == "__main__":
    for mk in ("MY", "SG"):
        _reconcile(mk)

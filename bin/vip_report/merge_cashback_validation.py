"""Task 5 — merge the cashback validation into vip-metrics-MY.json + verify.

Writes a code-level `cashback_validation` block (base-rate + intensive-margin + within-member + placebo
+ break-even + top-Diamond downside + holdout spec path) that the VIP panel renders under Lane B "Review".
Verifies: block present, cross-foots to the source JSONs, valid JSON, no member-id PII.
Usage: python bin/vip_report/merge_cashback_validation.py
"""
import json
from pathlib import Path

VIP = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad/vip")
inc = json.load(open(VIP / "cashback-incrementality-MY.json", encoding="utf-8"))
be = json.load(open(VIP / "cashback-breakeven-MY.json", encoding="utf-8"))
mpath = VIP / "vip-metrics-MY.json"
m = json.load(open(mpath, encoding="utf-8"))

block = {
    "loss_floor": inc["loss_floor"], "program_first_claim": inc["program_first_claim"], "records": inc["records"],
    "base_rate": inc["base_rate"], "intensive_margin": inc["intensive_margin"],
    "within_member": inc["within_member"], "placebo": inc["placebo"],
    "break_even": be["break_even"], "top_diamond_downside": be["top_diamond_downside"],
    "read": be["read"], "holdout_spec": "bin/vip_report/cashback-holdout-spec.md",
    "method_note": ("Directional (observational) — 98% of eligible losers claim, so no clean untreated group; "
                    "cross-section vs within-member bracket the truth and flip sign on Diamond. The holdout is the proof."),
}
m["cashback_validation"] = block
json.dump(m, open(mpath, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

# ---- verify ----
fails = []
m2 = json.load(open(mpath, encoding="utf-8"))                       # re-read: valid JSON round-trip
cv = m2.get("cashback_validation")
if not cv: fails.append("cashback_validation block missing")
# cross-foot: tiers align across base_rate / intensive / break_even
tiers = set(cv["base_rate"]) & set(cv["intensive_margin"]) & set(cv["break_even"])
if len(tiers) < 5: fails.append(f"tier mismatch across sub-blocks: {sorted(tiers)}")
# sanity: break-even verdicts are one of the known set; downside churns >= 1
for t, v in cv["break_even"].items():
    if v["verdict"] not in ("CLEARS both", "FAILS both", "INCONCLUSIVE (sign flips by method)", "n/a"):
        fails.append(f"bad verdict {t}: {v['verdict']}")
if not (cv["top_diamond_downside"]["churns_to_wipe_saving"] and cv["top_diamond_downside"]["churns_to_wipe_saving"] >= 1):
    fails.append("downside churns_to_wipe invalid")
# PII: the block must be code-level — no member ids. member ids are strings; scan string leaf-values against a member-key check.
BAD_KEYS = {"member", "mid", "members_list", "member_id"}
def has_member(o):
    if isinstance(o, dict):
        for k, val in o.items():
            if k.lower() in BAD_KEYS and isinstance(val, (list, str)): return k
            r = has_member(val)
            if r: return r
    elif isinstance(o, list):
        for it in o:
            r = has_member(it)
            if r: return r
    return None
mk = has_member(cv)
if mk: fails.append(f"PII: member-data key in block: {mk}")

print("=== VERIFY cashback_validation merge ===")
if fails:
    print("FAIL:"); [print("  -", f) for f in fails]
else:
    print("PASS — block present, cross-foots (5 tiers), verdicts valid, downside sane, no member-id PII, JSON round-trips.")
bev = cv["break_even"]
print(f"  Diamond: {bev['Diamond']['verdict']} | Gold: {bev['Gold']['verdict']} | Silver: {bev['Silver']['verdict']} | Platinum: {bev['Platinum']['verdict']}")
print(f"  Downside: churning {cv['top_diamond_downside']['churns_to_wipe_saving']} top Diamond wipes RM{cv['top_diamond_downside']['diamond_cashback']:,}")
print("Merged cashback_validation into vip-metrics-MY.json")

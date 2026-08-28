"""Tag every promo code with owner / campaign / objective (rules + override + gap).

Reads the three pillar metrics' code lists + scratchpad/promo-config-MY.json + the
in-repo manual override file, and emits scratchpad/campaign-map-MY.json.
Spend/config only — no member data. Owner inference from prefix is a hypothesis
(confidence is recorded honestly); source teams own the truth.
Usage: python bin/campaign_tag.py
"""
import sys, json, re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
S = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad")
OVERRIDES = ROOT / "projects/promo-value-creation/campaign-map.overrides.json"

PILLAR_OBJ = {"acq": "Acquisition", "ret": "Retention", "vip": "VIP"}

# code -> {name, pillar, spend}
codes = {}
for f, pil in [("acq/acq-metrics-MY.json", "acq"), ("ret/ret-metrics-MY.json", "ret"), ("vip/vip-metrics-MY.json", "vip")]:
    m = json.load(open(S / f, encoding="utf-8"))
    for c in m["codes"]:
        codes.setdefault(c["code"], {"name": c.get("name", ""), "pillar": pil, "spend": c.get("spend", 0)})

def owner_of(blob):
    if "optimove" in blob: return "CRM"
    if re.search(r"^ft_vm|_vm_|\bvm\b|vip bonus|vip special", blob): return "VM"
    if re.search(r"^am_|_am_|\bam fs\b", blob): return "AM"
    if re.search(r"^wc_|world ?cup|fifa", blob): return "Marketing"
    if re.search(r"qpro|qp2|xsell|x-sell|cross.?sell", blob): return "Cross-sell"
    if "refer" in blob: return "Referral"
    return "Unknown"

# ordered campaign rules — first match wins; (pattern, campaign, objective-override-or-None)
CAMPAIGN_RULES = [
    (r"rescue", "Weekly Rescue", "VIP"),
    (r"^wc_|world ?cup|fifa|worldcup", "World Cup", None),
    (r"luckywheel|scratch|mysteryangpow|mini.?game|ang ?pow", "Mini-games", "VIP"),
    (r"refer", "Referral", "Acquisition"),
    (r"welcome|welcomegift|^ft_wel|first.?bet|first.?dep", "Welcome", "Acquisition"),
    (r"payday", "Payday", "Retention"),
    (r"bday|birthday", "Birthday", "Entitlement"),
    (r"membership|entitle", "Membership", "Entitlement"),
    (r"check.?in", "Daily Check-in", None),
    (r"dep\d+_get|deposit ?\d+ ?get|reload|_rel_|percentunlimited|\bpct\b|%|unlimited ?bonus", "Reload / deposit bonus", None),
    (r"_fs_|_fs\d|\bfs\d|\d+fs\b|free ?spin|gooss|_goo\b|olymp|_pp_|_pp\d|playtech", "Free-spins", None),
    (r"cashback|cash ?back", "Cashback", "VIP"),
    (r"churned|reactivat|win.?back|dormant", "Reactivation", None),
    (r"free ?credit|special free credit|_fc[_\d]|\bfc\d|vip .*credit|year end", "VIP Free Credit", "VIP"),
]

overrides = json.load(open(OVERRIDES, encoding="utf-8")) if OVERRIDES.exists() else {}

def classify(code, meta):
    blob = (code + " " + (meta["name"] or "")).lower()
    owner = owner_of(blob)
    obj_seed = PILLAR_OBJ.get(meta["pillar"], "?")
    for pat, camp, obj in CAMPAIGN_RULES:
        if re.search(pat, blob):
            return {"owner": owner, "campaign": camp, "objective": obj or obj_seed, "confidence": "rule-high"}
    return {"owner": owner, "campaign": "Unattributed", "objective": obj_seed, "confidence": "unattributed"}

out = {}
for code, meta in codes.items():
    if code in overrides:
        o = dict(overrides[code]); o.setdefault("confidence", "override"); o["confidence"] = "override"
        o.setdefault("owner", "Unknown"); o.setdefault("campaign", "Unattributed"); o.setdefault("objective", PILLAR_OBJ.get(meta["pillar"], "?"))
        out[code] = o
    else:
        out[code] = classify(code, meta)

json.dump(out, open(S / "campaign-map-MY.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)

# --- coverage report ---
from collections import defaultdict
tot_sp = sum(m["spend"] for m in codes.values())
attr_sp = sum(codes[c]["spend"] for c in out if out[c]["campaign"] != "Unattributed")
camp = defaultdict(lambda: {"n": 0, "sp": 0.0})
for c, t in out.items():
    d = camp[t["campaign"]]; d["n"] += 1; d["sp"] += codes[c]["spend"]
print(f"CAMPAIGN TAG — {len(out)} codes | attributed spend RM{round(attr_sp):,}/{round(tot_sp):,} ({round(attr_sp/tot_sp*100)}%) | overrides {len(overrides)}")
print("  by campaign (spend desc):")
for k, v in sorted(camp.items(), key=lambda kv: -kv[1]["sp"]):
    print(f"    {k:22s} {v['n']:>4} codes · RM{round(v['sp']):>11,}")
owner = defaultdict(lambda: {"n": 0, "sp": 0.0})
for c, t in out.items():
    d = owner[t["owner"]]; d["n"] += 1; d["sp"] += codes[c]["spend"]
print("  by owner:", " · ".join(f"{k} {v['n']}c/RM{round(v['sp']):,}" for k, v in sorted(owner.items(), key=lambda kv: -kv[1]["sp"])))
print("Saved scratchpad/campaign-map-MY.json")

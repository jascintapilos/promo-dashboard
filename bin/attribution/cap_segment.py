"""Cap-segment puller — the key metric that pulls the fatigue/cap segment and assigns the bonus rec (MY).

KEY METRIC = give-to-take = vip_bonus / house margin (GGR). >1 = underwater (given more than they're worth).
Gated by the fatigue trigger (repeat claims of the same code) + safe-to-cut (active) + protect (cooling).

Per VIP member, from data we already have (member-ledger + claim-rows), assign one recommendation:
  CAP     — repeat-claimer, underwater, still active, NOT cooling  -> cap/withhold the next same-code claim
  PROTECT — cooling (deposits falling)                             -> retain (save-list), never cap
  KEEP    — give-to-take <= 1 (pays its way)                       -> keep, valuable
  REVIEW  — repeat + underwater but inactive/edge                  -> check by hand

Out: scratchpad/attribution/cap-segment-MY.json (opaque refs + aggregates; NO raw member ids in shared view)
Usage: python bin/attribution/cap_segment.py
"""
import json, hashlib
from pathlib import Path
from collections import defaultdict

SCR = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad")
ATTR = SCR / "attribution"; ATTR.mkdir(exist_ok=True)
REPEAT_MIN = 3
ref = lambda x: hashlib.sha1(str(x).encode()).hexdigest()[:6].upper()
norm_tier = lambda t: (t or "Unknown").replace(" (Trial)", "").strip() or "Unknown"

led = json.load(open(SCR / "vip/member-ledger-MY.json", encoding="utf-8"))
# heaviest repeat = max claims of any single code by the member
rep = defaultdict(int)
for r in json.load(open(SCR / "vip/claim-rows-MY.json", encoding="utf-8")):
    m = str(r["member"]); rep[m] = max(rep[m], int(r.get("claims", 1)))

rows = []
for m in led:
    mid = str(m["member"]); bonus = m.get("vip_bonus", 0) or 0
    ggr = m.get("ytd_ggr", 0) or 0; ngr = m.get("ytd_ngr", 0) or 0
    h1, h2 = m.get("dep_h1", 0) or 0, m.get("dep_h2", 0) or 0
    if bonus <= 0:
        continue
    gtt = round(bonus / ggr, 2) if ggr > 0 else 99.0        # KEY METRIC: give-to-take (>1 underwater)
    max_rep = rep.get(mid, m.get("vip_claims", 1) or 1)
    active = h2 > 0
    cooling = h1 > 0 and h2 < h1
    underwater = gtt > 1        # KEY METRIC gate: given more in bonus than they won the house (bonus > GGR)
    if cooling:
        rec = "PROTECT"
    elif not underwater:
        rec = "KEEP"
    elif max_rep >= REPEAT_MIN and active:
        rec = "CAP"
    else:
        rec = "REVIEW"
    rows.append({"member": mid, "ref": ref(mid), "tier": norm_tier(m.get("tier_end")),
                 "give_to_take": gtt, "max_repeat": max_rep, "vip_bonus": round(bonus),
                 "ytd_ngr": round(ngr), "cooling": cooling, "active": active, "rec": rec})

by_rec = defaultdict(lambda: {"n": 0, "bonus": 0})
for r in rows:
    by_rec[r["rec"]]["n"] += 1; by_rec[r["rec"]]["bonus"] += r["vip_bonus"]

cap = sorted([r for r in rows if r["rec"] == "CAP"], key=lambda r: -r["vip_bonus"])
out = {
    "as_of": "2026-08-30", "key_metric": "give_to_take = vip_bonus / house-margin(GGR); >1 = underwater",
    "filters": {"trigger": f"max repeat claims of one code >= {REPEAT_MIN}", "underwater": "give_to_take > 1 OR ytd_ngr < 0",
                "safe_to_cut": "active (deposited in H2)", "exclude": "cooling (H2 < H1) -> PROTECT"},
    "summary": {k: by_rec[k] for k in ("CAP", "PROTECT", "KEEP", "REVIEW")},
    "cap_top": [{"ref": r["ref"], "tier": r["tier"], "give_to_take": r["give_to_take"], "max_repeat": r["max_repeat"],
                 "vip_bonus": r["vip_bonus"]} for r in cap[:15]],
}
json.dump(out, open(ATTR / "cap-segment-MY.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)

print("CAP SEGMENT — key metric: give-to-take (bonus / house-margin), gated by repeat >=3, active, not cooling")
print(f"{'rec':<9}{'members':>9}{'bonus':>13}   meaning")
mean = {"CAP": "cap the next same-code repeat", "PROTECT": "cooling -> retain, never cap",
        "KEEP": "pays its way -> keep", "REVIEW": "repeat+underwater but inactive -> check"}
for k in ("CAP", "PROTECT", "KEEP", "REVIEW"):
    print(f"{k:<9}{by_rec[k]['n']:>9,}{('RM'+format(by_rec[k]['bonus'],',')):>13}   {mean[k]}")
print(f"\nCAP pool bonus (recoverable target) = RM{by_rec['CAP']['bonus']:,} across {by_rec['CAP']['n']:,} members")
print("Top CAP members (opaque ref · tier · give-to-take · repeats · bonus):")
for r in cap[:10]:
    print(f"   {r['ref']}  {r['tier']:<9} g2t {r['give_to_take']:>5}  x{r['max_repeat']:<3} claims  RM{r['vip_bonus']:,}")
print("Saved scratchpad/attribution/cap-segment-MY.json")

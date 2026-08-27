"""Task 1 — VIP code universe + lane / sub-type taxonomy (MY).

Universe = TL-approved Pillar='VIP' (live All Codes tab -> scratchpad/vip/tl-vip-codes-MY.json,
pulled by pull_tl_vip_codes.mjs). Each code is classified into:
  - sub_type: rescue/win-back · vip-free-credit · vip-reload · vip-free-spins · check-in/engagement
              · birthday/gift · vip-welcome · other   (regex on CODE + name; win-back on the CODE)
  - lane:     A-performance (money) · B-winback (reactivation) · C-entitlement (not graded)
  - mechanic: reload / free-credit / free-spins  (from BonusType — for the tier x mechanic comparator)
  - is_winback flag
Enriched with redeemed claim volume + amount from GetBonus_ABC.

Out: scratchpad/vip/vip-codes-MY.json = [{code,name,type,sub_type,lane,mechanic,is_winback,claims,bonus_amt}]
Usage: python bin/vip_report/00_vip_codes.py
"""
import sys, json, re
from pathlib import Path
from collections import defaultdict

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from csir_config import get_client

SCR = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad")
VIP = SCR / "vip"
START, END1 = "2026-01-01", "2026-08-26"
STATUSES = "('Approved','Redeemed','Complete','Active','Completed','Low Balance 1','Low Balance 2')"

# "Weekly Rescue" (optimove) is a tiered LOSS-CASHBACK, confirmed by WY + data (98% of claimers
# were losing in the prior 7d; top tiers scale the payout with the loss). NOT win-back (claimers'
# median recency is 1 day — they never lapsed). Cashback is its own job: soften losses to retain.
CASHBACK = re.compile(r"rescue|optimove|cash\s*back|cashback", re.I)
BDAY    = re.compile(r"bday|birthday", re.I)
WELCOME = re.compile(r"membership|welcome|onboard", re.I)
CHECKIN = re.compile(r"check\s*[- ]?\s*in|checkin", re.I)
# WS1 mini-games (gamification: spin a wheel / scratch a card for a prize), confirmed by WY.
# Identity is in the CODE prefix. NOT performance rewards — folded into Engagement (Lane D):
# they build play-habit, and their prize concentration is a game mechanic, not bonus farming.
LUCKY    = re.compile(r"luckywheel|lucky\s*wheel", re.I)
SCRATCH  = re.compile(r"scratch", re.I)
ANGPOW   = re.compile(r"mysteryangpow|mystery\s*ang\s*pow|ang\s*pow", re.I)

def classify(name, btype, code):
    blob = f"{code} {name}"
    cb = bool(CASHBACK.search(blob))
    mg = bool(LUCKY.search(code) or SCRATCH.search(code) or ANGPOW.search(code))  # mini-game identity is in the CODE
    if cb: sub = "cashback"
    elif mg: sub = "lucky-wheel" if LUCKY.search(code) else "scratch-card" if SCRATCH.search(code) else "mystery-angpow"
    elif BDAY.search(blob): sub = "birthday/gift"
    elif WELCOME.search(blob): sub = "vip-welcome"
    elif CHECKIN.search(blob): sub = "check-in/engagement"
    elif btype == "DepositBonus": sub = "vip-reload"
    elif btype == "FreeCredit": sub = "vip-free-credit"
    elif btype == "FreeSpinBonus": sub = "vip-free-spins"
    else: sub = "other"
    if cb: lane = "B-cashback"                                  # loss-return -> judged on retention-after-loss + forward margin
    elif mg: lane = "D-engagement"                              # mini-game (gamification) -> engagement + break-even
    elif sub in ("birthday/gift", "vip-welcome"): lane = "C-entitlement"
    elif sub == "check-in/engagement": lane = "D-engagement"    # daily login habit -> engagement + break-even
    else: lane = "A-performance"
    mech = "reload" if btype == "DepositBonus" else "free-credit" if btype == "FreeCredit" else "free-spins" if btype == "FreeSpinBonus" else "other"
    return sub, lane, mech, cb, mg

tl = json.load(open(VIP / "tl-vip-codes-MY.json", encoding="utf-8"))
meta = {}
for r in tl:
    code = r["code"].strip()
    sub, lane, mech, cb, mg = classify(r.get("name", ""), r.get("type", ""), code)
    meta[code] = {"name": (r.get("name") or "").strip(), "type": r.get("type", ""),
                  "sub_type": sub, "lane": lane, "mechanic": mech, "is_cashback": cb, "is_minigame": mg}
codes = sorted(meta)

c = get_client(send_receive_timeout=180)
inlist = ",".join("'" + x.replace("'", "''") + "'" for x in codes)
q = f"""
SELECT BonusCode, count() AS claims, sum(BonusAmount) AS amt
FROM WORKSPACE.GetBonus_ABC
WHERE SITE_edit='WS1' AND Currency='MYR' AND BonusAmount>0 AND BonusStatus IN {STATUSES}
  AND BonusTime_gmt8 >= '{START} 00:00:00' AND BonusTime_gmt8 < '{END1} 00:00:00'
  AND BonusCode IN ({inlist})
GROUP BY BonusCode
"""
vol = {row[0].strip(): (int(row[1]), float(row[2])) for row in c.query(q).result_rows}

out = []
for code in codes:
    cl, amt = vol.get(code, (0, 0.0)); m = meta[code]
    out.append({"code": code, "name": m["name"], "type": m["type"], "sub_type": m["sub_type"],
                "lane": m["lane"], "mechanic": m["mechanic"], "is_cashback": m["is_cashback"],
                "is_minigame": m["is_minigame"], "claims": cl, "bonus_amt": round(amt)})
out.sort(key=lambda x: -x["bonus_amt"])
json.dump(out, open(VIP / "vip-codes-MY.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)

by_lane = defaultdict(lambda: {"n": 0, "claims": 0, "amt": 0})
by_sub = defaultdict(lambda: {"n": 0, "claims": 0, "amt": 0})
by_mech = defaultdict(lambda: {"n": 0, "amt": 0})
for r in out:
    for agg, key in ((by_lane, r["lane"]), (by_sub, r["sub_type"])):
        d = agg[key]; d["n"] += 1; d["claims"] += r["claims"]; d["amt"] += r["bonus_amt"]
    e = by_mech[r["mechanic"]]; e["n"] += 1; e["amt"] += r["bonus_amt"]
tot = sum(r["bonus_amt"] for r in out); cb = sum(1 for r in out if r["is_cashback"])
print(f"VIP codes (MY, TL Pillar=VIP): {len(out)} | claims {sum(r['claims'] for r in out):,} | spend RM{tot:,} | cashback {cb}")
print(f"\n  {'LANE':16s} {'CODES':>5} {'CLAIMS':>9} {'SPEND(RM)':>12} {'%':>4}")
for k, d in sorted(by_lane.items(), key=lambda x: -x[1]["amt"]):
    print(f"  {k:16s} {d['n']:>5} {d['claims']:>9,} {d['amt']:>12,} {d['amt']/tot*100:>3.0f}%")
print(f"\n  {'SUB-TYPE':22s} {'LANE':14s} {'CODES':>5} {'SPEND(RM)':>12}")
for k, d in sorted(by_sub.items(), key=lambda x: -x[1]["amt"]):
    lane = next(r["lane"] for r in out if r["sub_type"] == k)
    print(f"  {k:22s} {lane:14s} {d['n']:>5} {d['amt']:>12,}")
print(f"\n  by mechanic: " + " | ".join(f"{k} {v['n']}c RM{v['amt']:,}" for k, v in sorted(by_mech.items(), key=lambda x: -x[1]['amt'])))
print(f"\n  cashback (Lane B) codes:")
for r in [x for x in out if x["is_cashback"]]:
    print(f"    {r['code'][:44]:44s} claims {r['claims']:>5}  RM{r['bonus_amt']:>9,}  {r['name'][:28]}")

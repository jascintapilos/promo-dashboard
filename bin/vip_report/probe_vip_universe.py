"""VIP design probe — classify the 383 TL-VIP MY codes into sub-types + win-back flag, size each
by claims + redeemed spend. Grounds the metric-design decision (how much is win-back = the trap).
Usage: python bin/vip_report/probe_vip_universe.py
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

WINBACK = re.compile(r"rescue|optimove|churn|comeback|win\s*[- ]?\s*back|reactiv|dormant|lapse|miss\s*you|we\s*miss", re.I)
BDAY    = re.compile(r"bday|birthday", re.I)
WELCOME = re.compile(r"membership|welcome|onboard", re.I)
CHECKIN = re.compile(r"check\s*[- ]?\s*in|checkin", re.I)

def classify(name, btype, code):
    blob = f"{code} {name}"
    wb = bool(WINBACK.search(blob))
    if wb: sub = "rescue/win-back"
    elif BDAY.search(blob): sub = "birthday/gift"
    elif WELCOME.search(blob): sub = "vip-welcome"
    elif CHECKIN.search(blob): sub = "check-in/engagement"
    elif btype == "DepositBonus": sub = "vip-reload"
    elif btype == "FreeCredit": sub = "vip-free-credit"
    elif btype == "FreeSpinBonus": sub = "vip-free-spins"
    else: sub = "other"
    mech = "reload" if btype == "DepositBonus" else "free-credit" if btype == "FreeCredit" else "free-spins" if btype == "FreeSpinBonus" else "other"
    return sub, mech, wb

tl = json.load(open(VIP / "tl-vip-codes-MY.json", encoding="utf-8"))
meta = {}
for r in tl:
    code = r["code"].strip()
    sub, mech, wb = classify(r.get("name", ""), r.get("type", ""), code)
    meta[code] = {"name": (r.get("name") or "").strip(), "type": r.get("type", ""), "sub": sub, "mech": mech, "wb": wb}
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

by_sub = defaultdict(lambda: {"n": 0, "claims": 0, "amt": 0.0, "wb": 0})
by_mech = defaultdict(lambda: {"n": 0, "amt": 0.0})
for code in codes:
    cl, amt = vol.get(code, (0, 0.0)); m = meta[code]
    d = by_sub[m["sub"]]; d["n"] += 1; d["claims"] += cl; d["amt"] += amt; d["wb"] += 1 if m["wb"] else 0
    e = by_mech[m["mech"]]; e["n"] += 1; e["amt"] += amt

tot_amt = sum(v["amt"] for v in by_sub.values()); tot_cl = sum(v["claims"] for v in by_sub.values())
wb_n = sum(1 for code in codes if meta[code]["wb"]); wb_amt = sum(vol.get(code, (0, 0))[1] for code in codes if meta[code]["wb"])
print(f"VIP codes (MY): {len(codes)} | redeemed claims {tot_cl:,} | redeemed spend RM{tot_amt:,.0f}")
print(f"win-back (rescue/optimove): {wb_n} codes, RM{wb_amt:,.0f} = {wb_amt/tot_amt*100:.0f}% of VIP spend\n")
print(f"  {'SUB-TYPE':22s} {'CODES':>5} {'CLAIMS':>9} {'SPEND(RM)':>12} {'%SPEND':>7}")
for sub, d in sorted(by_sub.items(), key=lambda x: -x[1]["amt"]):
    print(f"  {sub:22s} {d['n']:>5} {d['claims']:>9,} {round(d['amt']):>12,} {d['amt']/tot_amt*100:>6.0f}%")
print(f"\n  by mechanic: " + " | ".join(f"{k} {v['n']}c RM{round(v['amt']):,}" for k, v in sorted(by_mech.items(), key=lambda x: -x[1]['amt'])))
print(f"\n  TOP 12 VIP CODES BY SPEND:")
tops = sorted(codes, key=lambda x: -vol.get(x, (0, 0))[1])[:12]
for code in tops:
    cl, amt = vol.get(code, (0, 0.0)); m = meta[code]
    print(f"    {m['sub'][:16]:16s} {code[:38]:38s} {cl:>7,} RM{round(amt):>9,}  {m['name'][:30]}")

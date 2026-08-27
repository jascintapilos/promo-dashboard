"""Task 1 — MY retention code universe + mechanic taxonomy.

Universe = TL-approved Pillar='Retention' (live All Codes tab -> scratchpad/ret/tl-ret-codes-MY.json).
Each code is bucketed into a MECHANIC (reload / cashback / free-credit / free-spins / win-back / other)
from BonusType + BonusName keywords, with a separate is_winback flag. Enriched with GetBonus claim volume.

Out: scratchpad/ret/ret-codes-MY.json = [{code,name,type,mechanic,is_winback,claims,bonus_amt}]
Usage: python bin/ret_report/00_ret_codes.py
"""
import sys, json, re
from pathlib import Path
from collections import defaultdict

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from csir_config import get_client

SCR = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad")
RET = SCR / "ret"
START, END1 = "2026-01-01", "2026-08-26"   # YTD claim window -> 2026-08-25 inclusive

# Win-back is a FLAG (gates the "Hold — judged on VIP" decision), NOT a mechanic. Detect it on the
# NAME *and* the CODE — win-back identity almost always lives in the code (CHURN/WCCHURNED/COMEBACK/
# OPTIMOVE), while the promo name is generic marketing copy. (Name-only detection missed 54 codes.)
WINBACK = re.compile(r"rescue|win\s*[- ]?\s*back|come\s*?back|miss\s*you|reactiv|dormant|optimove|churn|lapse|welcome\s*back|we\s*miss", re.I)
WINBACK_CODE = re.compile(r"churn|chrn|wcchurn|comeback|come_back|winback|win_back|reactiv|dormant|optimove|lapse|rescue", re.I)
CASHBACK = re.compile(r"cash\s*back|rebate|cashback", re.I)

def classify(name, btype, code):
    """Return (mechanic, is_winback). Mechanic reflects the real payout type (reload/free-credit/
    free-spins/cashback); win-back is an orthogonal flag so a churned-reload still books as 'reload'
    for the mechanic-stratified comparator, but is Held out of the money matrix."""
    n, cd = name or "", code or ""
    wb = bool(WINBACK.search(n) or WINBACK_CODE.search(cd))
    if CASHBACK.search(n): mech = "cashback"
    elif btype == "DepositBonus": mech = "reload"
    elif btype == "FreeCredit": mech = "free-credit"
    elif btype == "FreeSpinBonus": mech = "free-spins"
    else: mech = "other"
    return mech, wb

tl = json.load(open(RET / "tl-ret-codes-MY.json", encoding="utf-8"))
meta = {}
for r in tl:
    code = r["code"].strip()
    mech, wb = classify(r.get("name", ""), r.get("type", ""), code)
    meta[code] = {"name": (r.get("name") or "").strip(), "type": r.get("type", ""), "mechanic": mech, "is_winback": wb}
codes = sorted(meta)

# claim volume from GetBonus
c = get_client(send_receive_timeout=180)
inlist = ",".join("'" + x.replace("'", "''") + "'" for x in codes)
# redeemed/active statuses only — match the scored base used in 01/02 (avoid overstating claims with Rejected/Pending)
STATUSES = "('Approved','Redeemed','Complete','Active','Completed','Low Balance 1','Low Balance 2')"
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
    cl, amt = vol.get(code, (0, 0.0))
    m = meta[code]
    out.append({"code": code, "name": m["name"], "type": m["type"], "mechanic": m["mechanic"],
                "is_winback": m["is_winback"], "claims": cl, "bonus_amt": round(amt)})
out.sort(key=lambda x: -x["bonus_amt"])
json.dump(out, open(RET / "ret-codes-MY.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)

by_mech = defaultdict(lambda: {"n": 0, "claims": 0, "amt": 0})
for r in out:
    d = by_mech[r["mechanic"]]; d["n"] += 1; d["claims"] += r["claims"]; d["amt"] += r["bonus_amt"]
nz = sum(1 for r in out if r["claims"] > 0); wb = sum(1 for r in out if r["is_winback"])
print(f"Retention codes (MY, TL Pillar=Retention): {len(out)} | with claims in window: {nz} | win-back tagged: {wb}")
print(f"total claims: {sum(r['claims'] for r in out):,} | total raw bonus amount: RM{sum(r['bonus_amt'] for r in out):,}")
print(f"\n  {'MECHANIC':12s} {'CODES':>5} {'CLAIMS':>9} {'AMOUNT(RM)':>12}")
for m, d in sorted(by_mech.items(), key=lambda x: -x[1]["amt"]):
    print(f"  {m:12s} {d['n']:>5} {d['claims']:>9,} {d['amt']:>12,}")
print(f"\n  win-back codes ({wb}):")
for r in [x for x in out if x["is_winback"]][:12]:
    print(f"    {r['type'][:12]:12s} {r['code'][:34]:34s} claims {r['claims']:>6}  {r['name'][:40]}")

"""Task 2 — build the MY acquisition code list + metadata.

Acquisition universe = the TL-APPROVED ASSIGNED PILLAR = 'Acquisition' as it stands in the live
workbook's All Codes tab (pulled to scratchpad/acq/tl-acq-codes-MY.json by the sheet step). Code,
name and mechanic (Type) come from that TL classification; claim volume + raw amount are enriched
from GetBonus_ABC (WS1 / MYR, report window) for context.

Out: scratchpad/acq/acq-codes-MY.json  = [{code, name, mechanic, claims, bonus_amt}]
Usage: (1) node sheet step writes tl-acq-codes-MY.json  (2) python bin/acq_report/00_acq_codes.py
"""
import sys, json
from pathlib import Path
from collections import defaultdict

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from csir_config import get_client, CURRENCY, SITE_EDIT, SUF, SYMBOL, MARKET

SCR = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad")
ACQ = SCR / "acq"; ACQ.mkdir(parents=True, exist_ok=True)
START, END1 = "2026-01-01", "2026-08-26"   # claim window [start, end) -> 2026-08-25 inclusive

# --- classification: TL-approved assigned pillar = Acquisition (live All Codes tab) ---
tl_list = json.load(open(ACQ / f"tl-acq-codes-{SUF}.json", encoding="utf-8"))
acq = {r["code"].strip(): (r["name"] or "").strip() for r in tl_list}
mech_sheet = {r["code"].strip(): (r["mechanic"] or "").strip() for r in tl_list}
acq_codes = sorted(acq)

# --- claim volume + amount from GetBonus (context) ---
c = get_client(send_receive_timeout=180)
inlist = ",".join("'" + x.replace("'", "''") + "'" for x in acq_codes)
q = f"""
SELECT BonusCode, BonusType, count() AS claims, sum(BonusAmount) AS amt
FROM WORKSPACE.GetBonus_ABC
WHERE SITE_edit='{SITE_EDIT}' AND Currency='{CURRENCY}' AND BonusAmount>0
  AND BonusTime_gmt8 >= '{START} 00:00:00' AND BonusTime_gmt8 < '{END1} 00:00:00'
  AND BonusCode IN ({inlist})
GROUP BY BonusCode, BonusType
"""
by = defaultdict(lambda: {"claims": 0, "amt": 0.0, "types": defaultdict(int)})
for code, btype, claims, amt in c.query(q).result_rows:
    d = by[code.strip()]; d["claims"] += int(claims); d["amt"] += float(amt); d["types"][btype] += int(claims)

out, mism = [], []
for code in acq_codes:
    d = by.get(code)
    mech = mech_sheet.get(code, "")
    if not d:
        out.append({"code": code, "name": acq[code], "mechanic": mech or "(no claims in window)", "claims": 0, "bonus_amt": 0}); continue
    ch_mech = max(d["types"].items(), key=lambda x: x[1])[0]
    if mech and ch_mech and mech != ch_mech:
        mism.append((code, mech, ch_mech))
    out.append({"code": code, "name": acq[code], "mechanic": mech or ch_mech, "claims": d["claims"], "bonus_amt": round(d["amt"])})
out.sort(key=lambda x: -x["bonus_amt"])
json.dump(out, open(ACQ / f"acq-codes-{SUF}.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)

nz = [r for r in out if r["claims"] > 0]
print(f"Acquisition codes ({MARKET}) — TL-approved assigned pillar = Acquisition: {len(out)}  |  with claims in window: {len(nz)}")
print(f"  total acquisition claims: {sum(r['claims'] for r in out):,} | total raw bonus amount (all-status): {SYMBOL}{sum(r['bonus_amt'] for r in out):,}")
if mism:
    print(f"  mechanic (sheet vs claims) mismatches: {mism}")
print()
print(f"  {'MECHANIC':14s} {'CODE':36s} {'CLAIMS':>7} {'AMOUNT':>11}  NAME")
for r in out:
    print(f"  {str(r['mechanic'])[:14]:14s} {r['code'][:36]:36s} {r['claims']:>7,} {r['bonus_amt']:>11,}  {r['name'][:42]}")

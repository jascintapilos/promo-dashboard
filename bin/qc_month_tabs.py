"""QC the two 'Spend vs GGR vs NGR by Month' tabs. Independent checks:
  A. Write fidelity  — sheet cells == the generated file (no dropped/mangled cells)
  B. Cross-footing   — 'metric — total' row == sum of the 3 type rows; Total col == sum of months
  C. Independent spend — fresh ClickHouse sum(BonusAmount) by TL-pillar x type x month == sheet Spend block
  D. Perf-tab tie    — monthly totals per pillar == the MY/SG performance tab (separate full-period attribution)
"""
import json
from pathlib import Path
from collections import defaultdict
import sys

# CSIR endpoint, credentials and client all come from csir_config.py at the repo root.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from csir_config import get_client

SCR = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad")
MONTHS = ["2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01", "2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01"]
TYPE_LABEL = {"DepositBonus": "Deposit bonus", "FreeSpinBonus": "Free spins", "FreeCredit": "Free credit"}
PDISP = {"Acq": "Acquisition"}
fails = []


client = get_client(send_receive_timeout=180)
tl = json.load(open(SCR / "tl_pillars.json", encoding="utf-8"))


def pk(s):
    s = str(s or "").strip().replace(",", "").replace("K", "").replace("+", "")
    return 0 if s in ("", "-") else round(float(s)) * 1000


for CUR, MKT in [("MYR", "MY"), ("SGD", "SG")]:
    print(f"\n========== QC {MKT} ({CUR}) ==========")
    sheet = json.load(open(SCR / f"tab-{MKT}-cells.json", encoding="utf-8"))
    gen = json.load(open(SCR / f"spend-ggr-ngr-{MKT}.json", encoding="utf-8"))

    # ---- A. write fidelity: sheet == generated file ----
    mism = 0
    for i in range(max(len(sheet), len(gen))):
        srow = sheet[i] if i < len(sheet) else []
        grow = gen[i] if i < len(gen) else []
        for j in range(max(len(srow), len(grow))):
            sv = str(srow[j]) if j < len(srow) else ""
            gv = str(grow[j]) if j < len(grow) else ""
            if sv != gv:
                mism += 1
                if mism <= 5: print(f"  A MISMATCH r{i+1}c{j+1}: sheet={sv!r} gen={gv!r}")
    print(f"A. Write fidelity: {'PASS' if mism == 0 else f'FAIL ({mism} cells)'}")
    if mism: fails.append(f"{MKT} write fidelity")

    # ---- parse sheet into structured: block[(pillar,metric,type)] = [m1..m8, total] ----
    block = {}
    cur_p = cur_m = None
    for row in sheet[4:]:
        if not row or not any(str(c).strip() for c in row): continue
        p = str(row[0]).strip() or cur_p
        m = str(row[1]).strip() or cur_m
        t = str(row[2]).strip() if len(row) > 2 else ""
        if str(row[0]).strip(): cur_p = str(row[0]).strip()
        if str(row[1]).strip(): cur_m = str(row[1]).strip()
        if not t: continue
        vals = [pk(row[3 + k]) if 3 + k < len(row) else 0 for k in range(8)]
        tot = pk(row[11]) if len(row) > 11 else 0
        block[(cur_p, cur_m, t)] = vals + [tot]

    # ---- B. cross-footing ----
    bad = 0
    metrics = ["Spend", "GGR Lift", "NGR Lift"]
    pillars = sorted({k[0] for k in block})
    for p in pillars:
        for m in metrics:
            types = [k[2] for k in block if k[0] == p and k[1] == m and "total" not in k[2]]
            tkey = (p, m, f"{m} — total")
            if tkey not in block: continue
            for mi in range(8):
                s = sum(block[(p, m, t)][mi] for t in types)
                if abs(s - block[tkey][mi]) > 1500:
                    bad += 1
                    if bad <= 5: print(f"  B {p}/{m} month{mi+1}: types sum {s} != total {block[tkey][mi]}")
            # Total col == sum of months (for each type row + total row)
            for t in types + [f"{m} — total"]:
                r = block[(p, m, t)]
                if abs(sum(r[:8]) - r[8]) > 1500:
                    bad += 1
                    if bad <= 5: print(f"  B {p}/{m}/{t}: months sum {sum(r[:8])} != Total {r[8]}")
    print(f"B. Cross-footing: {'PASS' if bad == 0 else f'FAIL ({bad})'}")
    if bad: fails.append(f"{MKT} cross-foot")

    # ---- C. independent spend from fresh ClickHouse query ----
    q = client.query(f"""
        SELECT if(BonusCode='','Undefined',BonusCode) AS code, BonusType AS bt,
               toString(toStartOfMonth(toDate(BonusTime_gmt8))) AS mo, sum(BonusAmount) AS spend
        FROM WORKSPACE.GetBonus_ABC
        WHERE SITE_edit='WS1' AND Currency='{CUR}'
          AND BonusTime_gmt8 >= '2026-01-01 00:00:00' AND BonusTime_gmt8 < '2026-08-10 00:00:00'
          AND BonusStatus IN ('Approved','Redeemed','Complete','Active','Completed','Low Balance 1','Low Balance 2')
          AND BonusAmount > 0
        GROUP BY code, bt, mo
    """, settings={"readonly": 1, "max_execution_time": 120, "max_result_rows": 500000, "result_overflow_mode": "break"})
    ind = defaultdict(float)  # (pillar,type,monthidx) -> spend
    for code, bt, mo, spend in q.result_rows:
        p = tl.get(f"{MKT}||{code}")
        if not p: continue
        p = PDISP.get(p, p)
        t = TYPE_LABEL.get(bt, bt)
        if mo not in MONTHS: continue
        ind[(p, t, MONTHS.index(mo))] += float(spend or 0)
    cbad = 0
    for (p, m, t), r in block.items():
        if m != "Spend" or "total" in t: continue
        for mi in range(8):
            if abs(ind.get((p, t, mi), 0) - r[mi]) > 1500:
                cbad += 1
                if cbad <= 6: print(f"  C {p}/{t} m{mi+1}: sheet {r[mi]} vs CH {round(ind.get((p,t,mi),0))}")
    ind_total = sum(ind.values())
    sheet_spend_total = sum(r[8] for (p, m, t), r in block.items() if m == "Spend" and "total" not in t)
    print(f"C. Independent spend: {'PASS' if cbad == 0 else f'FAIL ({cbad} cells)'} | CH total {ind_total:,.0f} vs sheet {sheet_spend_total:,.0f}")
    if cbad: fails.append(f"{MKT} indep spend")

    # ---- D. tie monthly-total per pillar to perf-tl tab ----
    perf = json.load(open(SCR / f"perf-tl-{MKT}.json", encoding="utf-8"))
    # perf rows: [Pillar,Members,Claims,Spend,%,DepWin,GGRWin,NGRWin,DepLift,GGRLift,NGRLift,...]
    perf_map = {}
    for r in perf[5:]:
        if r and r[0] and r[0] not in ("All pillars",) and "Note" not in str(r[0]):
            perf_map[PDISP.get(r[0], r[0])] = {"Spend": pk(r[3]), "GGR Lift": pk(r[9]), "NGR Lift": pk(r[10])}
    dbad = 0
    for p in pillars:
        for m in metrics:
            tkey = (p, m, f"{m} — total")
            if tkey not in block or p not in perf_map: continue
            if abs(block[tkey][8] - perf_map[p][m]) > 3000:
                dbad += 1
                print(f"  D {p}/{m}: month-tab total {block[tkey][8]} vs perf tab {perf_map[p][m]}")
    print(f"D. Perf-tab tie: {'PASS' if dbad == 0 else f'FAIL ({dbad})'}")
    if dbad: fails.append(f"{MKT} perf tie")

    # grand totals
    gt = {m: sum(r[8] for (p, mm, t), r in block.items() if mm == m and "total" not in t) for m in metrics}
    print(f"Grand totals — Spend {gt['Spend']:,.0f} | GGR Lift {gt['GGR Lift']:,.0f} | NGR Lift {gt['NGR Lift']:,.0f}")

print("\n================ RESULT ================")
print("ALL CHECKS PASSED" if not fails else "FAILURES: " + "; ".join(fails))

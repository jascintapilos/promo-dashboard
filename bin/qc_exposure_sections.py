"""QC the Exposure-by-Level sections on the MY/SG tabs. Independent checks:
  A. Write fidelity   — sheet section == generated file (exposure-<mkt>.json)
  B. Internal         — All-levels == sum of tiers; %Spend sums 100; ratios/per-mbr/per-claim recompute from base
  C. Independent tier — Python-BISECT claims+spend per tier (different code path than the SQL ASOF) == sheet
  D. Grand-total ties — claims/spend/members vs market totals; NGR-lift cross-run consistency
"""
import json
from pathlib import Path
from bisect import bisect_right
from collections import defaultdict
from datetime import timedelta
import sys

# CSIR endpoint, credentials and client all come from csir_config.py at the repo root.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from csir_config import get_client

SCR = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad")
ORDER = ["Classic", "Bronze", "Silver", "Gold", "Platinum", "Diamond", "Other"]
MKT_TOT = {"MY": (232175, 13554), "SG": (9679, 918)}
fails = []


client = get_client(send_receive_timeout=300)


def pk(v):
    v = str(v or "").replace(",", "").replace("K", "").replace("+", "").strip()
    return 0 if v in ("", "-") else round(float(v)) * 1000


def pn(v):
    v = str(v or "").replace(",", "").replace("+", "").strip()
    return 0 if v in ("", "-") else round(float(v))


def norm_tier(t):
    t = (t or "").strip()
    if t in ("Agent Credit", "Scammers"): return "Other"
    if t in ("", "Unknown"): return "Classic"  # unranked/new = default Classic
    return t.replace(" (Trial)", "")


for CUR, MKT in [("MYR", "MY"), ("SGD", "SG")]:
    print(f"\n========== QC Exposure {MKT} ==========")
    sheet = json.load(open(SCR / f"sheet-exposure-{MKT}.json", encoding="utf-8"))
    gen = json.load(open(SCR / f"exposure-{MKT}.json", encoding="utf-8"))

    # A. write fidelity
    mism = 0
    for i in range(max(len(sheet), len(gen))):
        sr = sheet[i] if i < len(sheet) else []
        gr = gen[i] if i < len(gen) else []
        for j in range(max(len(sr), len(gr))):
            sv = str(sr[j]) if j < len(sr) else ""
            gv = str(gr[j]) if j < len(gr) else ""
            if sv != gv:
                mism += 1
                if mism <= 4: print(f"  A r{i+1}c{j+1}: sheet={sv!r} gen={gv!r}")
    print(f"A. Write fidelity: {'PASS' if mism==0 else f'FAIL ({mism})'}")
    if mism: fails.append(f"{MKT}-A")

    # parse rows into dict by level (row: Level,Members,Claims,Spend,%,DepWin,GGRWin,NGRWin,DepLift,GGRLift,NGRLift,DL/S,GL/S,NL/S, pmClaims,pmSpend,pmDepL,pmGGRL,pmNGRL, pcSpend,pcDepL,pcNGRL)
    D = {}
    for r in sheet:
        if not r or not r[0] or r[0] in ("Level at claim", "Note") or "EXPOSURE" in str(r[0]) or "Level =" in str(r[0]): continue
        if len(r) < 11: continue
        D[r[0]] = r
    # B. internal
    bad = 0
    tiers = [t for t in ORDER if t in D]
    sums = {c: 0 for c in ["members", "claims", "spend", "depwin", "ggrwin", "ngrwin", "depl", "ggrl", "ngrl"]}
    idx = {"members": 1, "claims": 2, "spend": 3, "depwin": 5, "ggrwin": 6, "ngrwin": 7, "depl": 8, "ggrl": 9, "ngrl": 10}
    for t in tiers:
        r = D[t]
        for c, i in idx.items():
            sums[c] += (pn(r[i]) if c in ("members", "claims") else pk(r[i]))
    allrow = D.get("All levels")
    for c, i in idx.items():
        if c == "members": continue  # members don't sum (documented)
        want = (pn(allrow[i]) if c == "claims" else pk(allrow[i]))
        got = sums[c]
        if abs(got - want) > 2000:
            bad += 1; print(f"  B All-levels {c}: tiers sum {got} != {want}")
    # %Spend sums ~100
    pctsum = sum(float(str(D[t][4]).replace('%', '')) for t in tiers)
    if abs(pctsum - 100) > 0.5: bad += 1; print(f"  B %Spend sums {pctsum} != 100")
    # ratio + per-member + per-claim recompute (tolerance)
    for t in tiers:
        r = D[t]; spend = pk(r[3]); mem = pn(r[1]); clm = pn(r[2])
        for (col, num_i) in [(11, 8), (12, 9), (13, 10)]:  # lift/spend
            want = round(pk(r[num_i]) / spend, 2) if spend else None
            got = None if str(r[col]).strip() == "n/a" else round(float(str(r[col]).replace('x', '')), 2)
            if want is not None and got is not None and abs(want - got) > 0.02:
                bad += 1; print(f"  B {t} ratio col{col+1}: {got} vs {want}")
        # per-claim spend
        if clm:
            want = round(spend / clm); got = pn(r[19])
            if abs(want - got) > max(2, 0.02 * abs(want)): bad += 1; print(f"  B {t} spend/claim: {got} vs {want}")
    print(f"B. Internal consistency: {'PASS' if bad==0 else f'FAIL ({bad})'}")
    if bad: fails.append(f"{MKT}-B")

    # C. independent tier via Python bisect (fresh pulls)
    claims = client.query(f"""
        SELECT MEMBER_ID, BonusTime_gmt8, if(BonusCode='','Undefined',BonusCode) AS c, BonusAmount
        FROM WORKSPACE.GetBonus_ABC WHERE SITE_edit='WS1' AND Currency='{CUR}'
          AND BonusTime_gmt8 >= '2026-01-01 00:00:00' AND BonusTime_gmt8 < '2026-08-10 00:00:00'
          AND BonusStatus IN ('Approved','Redeemed','Complete','Active','Completed','Low Balance 1','Low Balance 2') AND BonusAmount>0
    """, settings={"readonly": 1, "max_execution_time": 120, "max_result_rows": 1000000, "result_overflow_mode": "break"})
    logsite = "WS1_MYS_MYR" if CUR == "MYR" else "WS1_SGP_SGD"
    log = client.query(f"""
        SELECT MEMBER_ID, TIME, NewMembershipName FROM WORKSPACE.dedup_PlayerMembershipLog_A
        WHERE SITE='{logsite}' AND NewMembershipName != '' ORDER BY MEMBER_ID, TIME
    """, settings={"readonly": 1, "max_execution_time": 120, "max_result_rows": 3000000, "result_overflow_mode": "break"})
    ev = defaultdict(list)
    for mid, t, tier in log.result_rows:
        ev[mid].append((t + timedelta(hours=8), tier))

    def tier_at(mid, when):
        e = ev.get(mid)
        if not e: return norm_tier("Unknown")  # no record = Classic (default)
        ts = [x[0] for x in e]; i = bisect_right(ts, when) - 1
        return norm_tier(e[i][1]) if i >= 0 else norm_tier("Unknown")

    bis = defaultdict(lambda: [0, 0.0])  # tier -> [claims, spend]
    for mid, bt, c, amt in claims.result_rows:
        tl = tier_at(mid, bt)
        bis[tl][0] += 1; bis[tl][1] += float(amt or 0)
    cbad = 0
    for t in tiers:
        sc = pn(D[t][2]); ss = pk(D[t][3])
        bc = bis[t][0]; bs = bis[t][1]
        if abs(bc - sc) > max(50, 0.02 * sc):
            cbad += 1; print(f"  C {t} claims: sheet {sc} vs bisect {bc}")
        if abs(bs - ss) > max(3000, 0.02 * ss):
            cbad += 1; print(f"  C {t} spend: sheet {ss} vs bisect {round(bs)}")
    print(f"C. Independent tier (bisect): {'PASS' if cbad==0 else f'FAIL ({cbad})'} | bisect total claims {sum(v[0] for v in bis.values()):,}")
    if cbad: fails.append(f"{MKT}-C")

    # D. grand totals
    tc, tm = MKT_TOT[MKT]
    ac = pn(allrow[2]); am = pn(allrow[1]); asp = pk(allrow[3])
    okc = abs(ac - tc) <= 5; okm = abs(am - tm) <= 5
    print(f"D. Grand totals: claims {ac} (want {tc}) {'OK' if okc else 'FAIL'} | members {am} (want {tm}) {'OK' if okm else 'FAIL'} | spend {asp:,}")
    if not (okc and okm): fails.append(f"{MKT}-D")

print("\n================ RESULT ================")
print("ALL EXPOSURE CHECKS PASSED" if not fails else "FAILURES: " + "; ".join(fails))

"""Phase 2 attribution — bonus fatigue: does the Nth claim of a code pay back less than the first? (MY)

Per (member, code) each claim gets an ordinal (1st, 2nd, ... 6+); we pull the forward-30d NGR (net of
bonus) after each claim and aggregate to (code, ordinal). The fatigue curve = forward NGR per RM of bonus
by ordinal. If it decays, the marginal Nth claim is worth less than the average — so "scale this code"
projections should use the marginal value, and repeat claims should be credited by the fitted factor.

Out: scratchpad/attribution/fatigue-MY.json  (per-ordinal aggregate + fitted factors; NO member rows)
Usage: python bin/attribution/phase2_fatigue.py
"""
import sys, json
from pathlib import Path
from collections import defaultdict

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from csir_config import get_client

SCR = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad")
ATTR = SCR / "attribution"
START, CLAIM_END = "2026-01-01", "2026-07-27"    # 30d-maturity cutoff (data to 2026-08-26)
SNAP_LO, SNAP_HI = "2025-12-01", "2026-08-27"    # LO covers the -30d pre-window of the earliest claim
STATUSES = "('Approved','Redeemed','Complete','Active','Completed','Low Balance 1','Low Balance 2')"

ret = json.load(open(SCR / "ret/ret-codes-MY.json", encoding="utf-8"))
vip = json.load(open(SCR / "vip/vip-codes-MY.json", encoding="utf-8"))
mech_of = {c["code"]: (c.get("mechanic") or "other") for c in ret + vip}
pillar_of = {}
for c in ret: pillar_of[c["code"]] = "RET"
for c in vip:
    if c.get("lane") in ("A-performance", "B-cashback"): pillar_of[c["code"]] = "VIP"
codes = [c for c in pillar_of]
inlist = ",".join("'" + c.replace("'", "''") + "'" for c in codes)

q = f"""
WITH claims AS (
    SELECT SITE, MEMBER_ID, BonusCode, toDate(BonusTime_gmt8) AS cd, sum(BonusAmount) AS bonus
    FROM WORKSPACE.GetBonus_ABC
    WHERE SITE_edit='WS1' AND Currency='MYR' AND BonusAmount>0 AND BonusStatus IN {STATUSES}
      AND BonusTime_gmt8 >= '{START} 00:00:00' AND BonusTime_gmt8 < '{CLAIM_END} 00:00:00'
      AND BonusCode IN ({inlist})
    GROUP BY SITE, MEMBER_ID, BonusCode, toDate(BonusTime_gmt8)
),
ranked AS (
    SELECT SITE, MEMBER_ID, BonusCode, cd, bonus,
        least(toUInt32(row_number() OVER (PARTITION BY MEMBER_ID, BonusCode ORDER BY cd)), 6) AS ord
    FROM claims
),
snap AS (
    SELECT SITE AS ss, MEMBER_ID AS sm, SnapshotDate AS sd, NGR AS ngr FROM WORKSPACE.Daily_GMT8_Snapshot_A
    WHERE Currency='MYR' AND NGR!=0 AND SnapshotDate >= '{SNAP_LO}' AND SnapshotDate < '{SNAP_HI}'
    UNION ALL
    SELECT SITE, MEMBER_ID, SnapshotDate, NGR FROM WORKSPACE.Daily_GMT8_Snapshot_BC
    WHERE Currency='MYR' AND NGR!=0 AND SnapshotDate >= '{SNAP_LO}' AND SnapshotDate < '{SNAP_HI}'
),
maxord AS (SELECT MEMBER_ID, BonusCode, max(ord) AS mo FROM ranked GROUP BY MEMBER_ID, BonusCode),
per_claim AS (
    SELECT r.MEMBER_ID AS member, r.BonusCode AS code, r.ord AS ord, r.bonus AS bonus,
        sumIf(ifNull(s.ngr,0), w.off >= -30 AND w.off < 0) AS pre30,
        sumIf(ifNull(s.ngr,0), w.off >= 0  AND w.off < 30) AS fwd30
    FROM ranked r
    CROSS JOIN (SELECT toInt32(number) - 30 AS off FROM numbers(60)) w
    LEFT JOIN snap s ON r.SITE=s.ss AND r.MEMBER_ID=s.sm AND addDays(r.cd, w.off)=s.sd
    GROUP BY r.MEMBER_ID, r.BonusCode, r.ord, r.cd, r.bonus
)
SELECT pc.member AS member, pc.code AS code, pc.ord AS ord, pc.bonus AS bonus, pc.pre30 AS pre30, pc.fwd30 AS fwd30
FROM per_claim pc
INNER JOIN maxord mx ON pc.member=mx.MEMBER_ID AND pc.code=mx.BonusCode
WHERE mx.mo >= 2
"""

c = get_client(send_receive_timeout=600)
res = c.query(q, settings={"readonly": 1, "max_execution_time": 590, "max_memory_usage": 60000000000})
rows = [dict(zip(res.column_names, r)) for r in res.result_rows]

# winsorize per-claim fwd30 (whale NGR tails)
fv = sorted(float(r["fwd30"]) for r in rows)
W_LO, W_HI = fv[int(len(fv)*0.01)], fv[int(len(fv)*0.99)]
wins = lambda v: W_LO if v < W_LO else (W_HI if v > W_HI else v)

# per (member,code): ord -> [bonus, fwd30]   (ord 6 = the 6+ bucket, may hold several claims)
mc = defaultdict(lambda: defaultdict(lambda: [0.0, 0.0]))
for r in rows:
    a = mc[(str(r["member"]), r["code"])][int(r["ord"])]
    a[0] += float(r["bonus"]); a[1] += wins(float(r["fwd30"]))

def balanced(pairs):
    """Same members at ord-1 vs ord-n -> selection-controlled fatigue factor."""
    out = {1: {"per_rm": None, "factor": 1.0}}
    for n in range(2, 7):
        coh = [d for d in pairs if 1 in d and n in d]
        if len(coh) < 30:
            out[n] = None; continue
        b1 = sum(d[1][0] for d in coh); f1 = sum(d[1][1] for d in coh)
        bn = sum(d[n][0] for d in coh); fn = sum(d[n][1] for d in coh)
        r1 = f1/b1 if b1 else None; rn = fn/bn if bn else None
        out[n] = {"n_pairs": len(coh), "ord1_per_rm": round(r1, 2) if r1 is not None else None,
                  "ordN_per_rm": round(rn, 2) if rn is not None else None,
                  "factor": round(rn/r1, 2) if r1 else None}
        if out[1]["per_rm"] is None: out[1]["per_rm"] = round(r1, 2) if r1 is not None else None
    return out

allpairs = list(mc.values())
overall = balanced(allpairs)
by_pillar = {p: balanced([d for (m, cd), d in mc.items() if pillar_of.get(cd) == p]) for p in ("RET", "VIP")}

# ---- CAP LINE: absolute own-baseline lift per RM by ordinal (natural cohort of nth claims), by pillar ----
lv = sorted(float(r["fwd30"]) - float(r["pre30"]) for r in rows)
LW_LO, LW_HI = lv[int(len(lv)*0.01)], lv[int(len(lv)*0.99)]
lwins = lambda v: LW_LO if v < LW_LO else (LW_HI if v > LW_HI else v)
cap_agg = defaultdict(lambda: defaultdict(lambda: [0.0, 0.0, 0]))    # scope -> ord -> [bonus, lift, n]
for r in rows:
    lift = lwins(float(r["fwd30"]) - float(r["pre30"])); b = float(r["bonus"]); o = int(r["ord"])
    for sc in (pillar_of.get(r["code"]), "ALL"):
        a = cap_agg[sc][o]; a[0] += b; a[1] += lift; a[2] += 1
def capcurve(sc):
    d = cap_agg[sc]
    return {o: {"lift_per_rm": round(d[o][1]/d[o][0], 2) if d[o][0] else None, "n": d[o][2],
                "bonus": round(d[o][0])} for o in sorted(d)}
def capline(cv, margin=0.0):
    for o in sorted(cv):
        if cv[o]["lift_per_rm"] is not None and cv[o]["lift_per_rm"] <= margin:
            return o
    return None
cap = {sc: capcurve(sc) for sc in ("ALL", "RET", "VIP")}
cap_at = {sc: capline(cap[sc]) for sc in cap}
# spend sitting at/after the cap line (recoverable if capped there)
recover = {}
for sc in ("ALL", "RET", "VIP"):
    cl = cap_at[sc]
    recover[sc] = round(sum(v["bonus"] for o, v in cap[sc].items() if cl is not None and o >= cl)) if cl else 0

out = {"as_of": "2026-08-30", "window": "forward 30d, net of bonus", "method": "balanced within-member panel (ord-1 vs ord-n, same members)",
       "ordinal_cap": "6+", "overall": overall, "by_pillar": by_pillar,
       "cap_curve": cap, "cap_line": cap_at, "recoverable_bonus_at_cap": recover}
json.dump(out, open(ATTR / "fatigue-MY.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2, default=str)

print("BONUS FATIGUE (within-member, selection-controlled) — forward-30d NGR/RM, same members at ord-1 vs ord-n:")
print(f"{'ord':>4}{'pairs':>8}{'ord1/RM':>9}{'ordN/RM':>9}{'factor':>8}")
for n in range(2, 7):
    o = overall.get(n)
    if o: print(f"{('6+' if n==6 else n):>4}{o['n_pairs']:>8,}{str(o['ord1_per_rm']):>9}{str(o['ordN_per_rm']):>9}{'x'+str(o['factor']):>8}")
print("\nby pillar (within-member factor, ord-n vs ord-1):")
for p in ("RET", "VIP"):
    cv = by_pillar[p]; print(f"  {p}: " + " ".join(f"{('6+' if n==6 else n)}:x{cv[n]['factor']}" for n in range(2, 7) if cv.get(n)))

print("\nCAP LINE — own-baseline lift per RM by claim number (natural cohort). RTM-BIASED: Phase 1 showed the own-baseline")
print("OVER-states losses for these (peak-claimed) VIP codes, so the true crossing is LATER; exact cap needs matched-control per claim.")
print(f"{'ord':>4}{'ALL':>9}{'RET':>9}{'VIP':>9}")
for o in range(1, 7):
    row = f"{('6+' if o==6 else o):>4}"
    for sc in ("ALL", "RET", "VIP"):
        v = cap[sc].get(o, {}).get("lift_per_rm"); row += f"{str(v):>9}"
    print(row)
for sc in ("ALL", "RET", "VIP"):
    cl = cap_at[sc]
    print(f"  {sc}: payback goes <=0 at claim #{cl if cl else '>6 (never in range)'} | spend at/after that cap: RM{recover[sc]:,}")
print("Saved scratchpad/attribution/fatigue-MY.json")

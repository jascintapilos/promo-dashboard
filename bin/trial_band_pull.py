#!/usr/bin/env python3
"""Trial vs full members × deposit band — are Low-band players new/ramping (VIP trial) or established low-value?

Depositors only (YTD-deposit band, same basis as the segment map: Whale>=100k/High>=20k/Mid>=2k/Low).
Tier + trial flag from WORKSPACE.Members_Overview_ABC.Membership ("(Trial)" tag = probationary VIP).
Out: scratchpad/trial-band-{MK}.json = { grid:[{band,tier,trial,members,ngr,med_dep}], ... }
"""
import sys, json
from pathlib import Path

ROOT = Path(r"C:/Users/vdiuser/Downloads/promo-automation")
sys.path.insert(0, str(ROOT))
from csir_config import get_client, START, END_EXCL

SCR = Path(__import__("os").environ.get("PROMO_SCRATCH", r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad"))
MEMSITE = {"MY": "WS1_MYS_MYR", "SG": "WS1_SGP_SGD"}
BANDS = ["Whale", "High", "Mid", "Low"]

c = get_client(send_receive_timeout=600)

for MK, CUR in (("MY", "MYR"), ("SG", "SGD")):
    sym = "RM" if MK == "MY" else "S$"
    q = f"""
    WITH m AS (
      SELECT MEMBER_ID, sum(dep) AS ytd_dep, sum(ngr) AS ytd_ngr FROM (
        SELECT MEMBER_ID, DepositAmount dep, NGR ngr FROM WORKSPACE.Daily_GMT8_Snapshot_A  WHERE Currency='{CUR}' AND SnapshotDate>='{START}' AND SnapshotDate<'{END_EXCL}'
        UNION ALL
        SELECT MEMBER_ID, DepositAmount, NGR FROM WORKSPACE.Daily_GMT8_Snapshot_BC WHERE Currency='{CUR}' AND SnapshotDate>='{START}' AND SnapshotDate<'{END_EXCL}'
      ) GROUP BY MEMBER_ID HAVING ytd_dep > 0
    ),
    tier AS (
      SELECT MEMBER_ID,
        multiIf(Membership LIKE '%Diamond%','Diamond', Membership LIKE '%Platinum%','Platinum', Membership LIKE '%Gold%','Gold',
                Membership LIKE '%Silver%','Silver', Membership LIKE '%Bronze%','Bronze','Classic/None') AS tier,
        if(Membership LIKE '%Trial%', 1, 0) AS trial
      FROM WORKSPACE.Members_Overview_ABC WHERE SITE='{MEMSITE[MK]}'
    )
    SELECT
      multiIf(m.ytd_dep>=100000,'Whale', m.ytd_dep>=20000,'High', m.ytd_dep>=2000,'Mid','Low') AS band,
      if(empty(ti.tier),'Classic/None',ti.tier) AS tier,   -- LEFT JOIN fills '' (not NULL) for depositors with no membership record → Classic/None
      ti.trial AS trial,
      count() AS members, round(sum(m.ytd_ngr)) AS ngr, round(median(m.ytd_dep)) AS med_dep
    FROM m LEFT JOIN tier ti ON m.MEMBER_ID = ti.MEMBER_ID
    GROUP BY band, tier, trial
    """
    rows = c.query(q).result_rows
    grid = [{"band": b, "tier": t, "trial": int(tr), "members": int(mem), "ngr": float(n or 0), "med_dep": float(md or 0)}
            for b, t, tr, mem, n, md in rows]
    json.dump({"symbol": sym, "grid": grid}, open(SCR / f"trial-band-{MK}.json", "w", encoding="utf-8"), ensure_ascii=False)

    # ---- readout ----
    def money(v):
        v = float(v); a = abs(v); s = "-" if v < 0 else ""
        return f"{s}{sym}{a/1e6:.1f}M" if a >= 1e6 else (f"{s}{sym}{a/1e3:.0f}k" if a >= 1e3 else f"{s}{sym}{a:.0f}")
    tot = sum(g["members"] for g in grid)
    print("\n" + "=" * 66)
    print(f"{MK} · trial vs full × deposit band  ({tot:,} depositors)")
    print("=" * 66)
    # segment: Classic/None, Bronze, VIP-Trial, VIP-Full
    def seg(g):
        if g["tier"] in ("Classic/None", "Bronze"): return g["tier"]
        return "VIP-Trial" if g["trial"] else "VIP-Full"
    SEGS = ["VIP-Full", "VIP-Trial", "Bronze", "Classic/None"]
    for band in BANDS:
        bm = sum(g["members"] for g in grid if g["band"] == band) or 1
        parts = []
        for s in SEGS:
            mm = sum(g["members"] for g in grid if g["band"] == band and seg(g) == s)
            if mm: parts.append(f"{s} {mm:,} ({mm/bm*100:.0f}%)")
        print(f"  {band:6} {bm:>8,} members: " + " · ".join(parts))
    print("  --- VIP tiers only: trial vs full (all bands) ---")
    for tier in ("Diamond", "Platinum", "Gold", "Silver"):
        tr = sum(g["members"] for g in grid if g["tier"] == tier and g["trial"])
        fu = sum(g["members"] for g in grid if g["tier"] == tier and not g["trial"])
        if tr + fu:
            print(f"  {tier:9} full {fu:>5,} · trial {tr:>6,} ({tr/(tr+fu)*100:.0f}% trial)")
    # Low band deep-dive: median deposit of trial vs established
    low_trial = [g for g in grid if g["band"] == "Low" and g["trial"]]
    low_est = [g for g in grid if g["band"] == "Low" and not g["trial"] and g["tier"] not in ("Classic/None",)]
    lt_m = sum(g["members"] for g in low_trial); le_m = sum(g["members"] for g in low_est)
    print(f"  Low band: VIP-trial {lt_m:,} (new/ramping) vs established VIP-full {le_m:,}")
print("\nDONE.")

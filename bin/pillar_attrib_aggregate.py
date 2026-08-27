"""Aggregate per-code attribution (scratchpad/attrib-<cur>.json) by pillar, for
both the OLD pillars (validate against the screenshot) and the CORRECTED pillars.
Pulls distinct (member,code) to dedup members per pillar. Emits the rich table.

Usage: python bin/pillar_attrib_aggregate.py MYR
"""
import sys, json
from pathlib import Path
from collections import defaultdict

# CSIR endpoint, credentials and client all come from csir_config.py at the repo root.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from csir_config import get_client

CUR = sys.argv[1] if len(sys.argv) > 1 else "MYR"
MKT = "MY" if CUR == "MYR" else "SG"
ROOT = Path("C:/Users/vdiuser/Downloads/promo-automation")
OUT = ROOT / "outputs" / "pvc-csir-probe"
SCRATCH = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad")
PILLARS = ["Retention", "VIP", "Branding", "Acq", "Whale Detection"]
MET = ["members", "claims", "bonus_cost", "t1_dep", "t1_ggr", "t1_ngr", "dep_lift", "ggr_lift", "ngr_lift"]


client = get_client(send_receive_timeout=300)

attrib = json.load(open(SCRATCH / f"attrib-{CUR}.json", encoding="utf-8"))
recl = json.load(open(OUT / "reclassified.json", encoding="utf-8"))
old_of = {r["code"]: r["old_pillar"] for r in recl if r["market"] == MKT}
new_of = {r["code"]: r["new_pillar"] for r in recl if r["market"] == MKT}

# distinct (member, code) for member dedup per pillar
mc = client.query(f"""
    SELECT DISTINCT MEMBER_ID, if(BonusCode='','Undefined',BonusCode) AS BonusCode
    FROM WORKSPACE.GetBonus_ABC
    WHERE SITE_edit='WS1' AND Currency='{CUR}'
      AND BonusTime_gmt8 >= '2026-01-01 00:00:00' AND BonusTime_gmt8 < '2026-08-10 00:00:00'
      AND BonusStatus IN ('Approved','Redeemed','Complete','Active','Completed','Low Balance 1','Low Balance 2')
      AND BonusAmount > 0
""", settings={"readonly": 1, "max_execution_time": 120, "max_result_rows": 2000000, "result_overflow_mode": "break"})


def aggregate(pillar_of):
    agg = {p: defaultdict(float) for p in PILLARS}
    members = {p: set() for p in PILLARS}
    for r in attrib:
        p = pillar_of.get(r["BonusCode"])
        if p not in agg:
            continue
        for k in MET[1:]:
            agg[p][k] += float(r[k] or 0)
    for mid, code in mc.result_rows:
        p = pillar_of.get(code)
        if p in members:
            members[p].add(mid)
    for p in PILLARS:
        agg[p]["members"] = len(members[p])
    all_mem = set()
    for p in PILLARS:
        all_mem |= members[p]
    agg["__ALL_MEMBERS__"] = len(all_mem)
    return agg


def k(x):  # thousands, rounded
    return round(x / 1000)


def show(title, agg):
    print(f"\n=== {title} ({CUR}) ===")
    hdr = f"{'Pillar':16s}{'Members':>8s}{'Claims':>9s}{'Spend':>8s}{'DepWin':>9s}{'GGRWin':>8s}{'NGRWin':>8s}{'DepLift':>8s}{'GGRLift':>8s}{'NGRLift':>8s}"
    print(hdr)
    tot = defaultdict(float); tmem = 0
    for p in PILLARS:
        a = agg[p]
        print(f"{p:16s}{int(a['members']):>8d}{int(a['claims']):>9d}{k(a['bonus_cost']):>8d}{k(a['t1_dep']):>9d}{k(a['t1_ggr']):>8d}{k(a['t1_ngr']):>8d}{k(a['dep_lift']):>8d}{k(a['ggr_lift']):>8d}{k(a['ngr_lift']):>8d}")
        for kk in MET[1:]:
            tot[kk] += a[kk]
    return agg


old_agg = aggregate(old_of)
new_agg = aggregate(new_of)
show("OLD pillars (validate vs screenshot)", old_agg)
show("CORRECTED pillars", new_agg)

json.dump({"old": {p: dict(old_agg[p]) for p in PILLARS}, "old_all_members": old_agg["__ALL_MEMBERS__"],
           "new": {p: dict(new_agg[p]) for p in PILLARS}, "new_all_members": new_agg["__ALL_MEMBERS__"]},
          open(SCRATCH / f"pillar-agg-{CUR}.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print(f"\nSaved scratchpad/pillar-agg-{CUR}.json")

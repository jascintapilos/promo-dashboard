#!/usr/bin/env python3
"""Per-claimer 90d PRE-CLAIM deposit — the value axis for the deposit-banded recommended config.

For every managed code, emit each claimer's total DEPOSIT in the 90 days BEFORE their first claim
of that code (member-level). This is the SAME basis as the pillar tabs' "Who claimed (actual segment)"
column (who_targeted_pull.py) — reused here to BAND each claim row of the sweet-spot engine by the
depositor value the player had AT TARGETING time, not by membership tier.

Join key = (code, member). sweet_by_band.py reads this to attach a deposit band to each claim row.
Out: scratchpad/claimer-dep90-{MK}.json = { code: { member: dep90 } }
Run: python bin/claimer_dep90_pull.py
"""
import sys, json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from csir_config import get_client, SITE_EDIT, START, END_EXCL

STATUSES = "('Approved','Redeemed','Complete','Active','Completed','Low Balance 1','Low Balance 2')"
SCR = Path(__import__("os").environ.get("PROMO_SCRATCH", r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad"))


def load(p):
    fp = SCR / p
    return json.load(open(fp, encoding="utf-8")) if fp.exists() else None


def codes_from(p, key="codes"):
    d = load(p)
    if not d:
        return []
    lst = d.get(key) if isinstance(d, dict) else d
    return [str(co["code"]).strip() for co in (lst or []) if co.get("code")]


c = get_client(send_receive_timeout=900)

for MK, CUR in (("MY", "MYR"), ("SG", "SGD")):
    # union of ALL managed codes across pillars (verify-action is ROI-only and drops VIP D-engagement,
    # which would leave 90% of VIP claim rows unbanded) — cover every code the sweet-spot engine reads.
    codeset = set()
    for src in (f"verify-action-{MK}.json", f"ret/ret-metrics-{MK}.json",
                f"vip/vip-metrics-{MK}.json", f"acq/acq-metrics-{MK}.json", f"acq/acq-codes-{MK}.json"):
        codeset.update(codes_from(src))
    codes = sorted(c2 for c2 in codeset if c2)
    if not codes:
        print(f"[{MK}] skip — no codes found")
        continue
    inlist = ",".join("'" + x.replace("'", "''") + "'" for x in codes)

    q = f"""
    WITH fc AS (
      SELECT trimBoth(BonusCode) AS code, MEMBER_ID, min(toDate(BonusTime_gmt8)) AS fcd
      FROM WORKSPACE.GetBonus_ABC
      WHERE SITE_edit='{SITE_EDIT}' AND Currency='{CUR}' AND BonusAmount>0 AND BonusStatus IN {STATUSES}
        AND trimBoth(BonusCode) IN ({inlist}) AND toDate(BonusTime_gmt8) >= '{START}' AND toDate(BonusTime_gmt8) < '{END_EXCL}'
      GROUP BY code, MEMBER_ID
    ),
    dep_src AS (
      SELECT MEMBER_ID, SnapshotDate AS sd, DepositAmount AS dep FROM WORKSPACE.Daily_GMT8_Snapshot_A  WHERE SITE_edit='{SITE_EDIT}' AND Currency='{CUR}' AND DepositAmount>0 AND SnapshotDate >= '2025-10-01' AND SnapshotDate < '{END_EXCL}' AND MEMBER_ID IN (SELECT MEMBER_ID FROM fc)
      UNION ALL
      SELECT MEMBER_ID, SnapshotDate, DepositAmount FROM WORKSPACE.Daily_GMT8_Snapshot_BC WHERE SITE_edit='{SITE_EDIT}' AND Currency='{CUR}' AND DepositAmount>0 AND SnapshotDate >= '2025-10-01' AND SnapshotDate < '{END_EXCL}' AND MEMBER_ID IN (SELECT MEMBER_ID FROM fc)
    )
    SELECT f.code AS code, f.MEMBER_ID AS member, round(sum(d.dep)) AS dep90
    FROM fc f
    LEFT JOIN dep_src d ON f.MEMBER_ID = d.MEMBER_ID AND d.sd < f.fcd AND d.sd >= f.fcd - 90
    GROUP BY code, member
    """
    rows = c.query(q).result_rows
    out = {}
    for code, member, dep90 in rows:
        out.setdefault(code, {})[str(member)] = float(dep90 or 0)
    path = SCR / f"claimer-dep90-{MK}.json"
    json.dump(out, open(path, "w", encoding="utf-8"), ensure_ascii=False)
    npairs = sum(len(v) for v in out.values())
    print(f"[{MK}] wrote {path.name} — {len(out):,} codes, {npairs:,} (code,member) deposit values")

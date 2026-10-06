#!/usr/bin/env python3
"""Repeat-claimer pull — how many people claimed the SAME code 2+ times ("gaming us", YG 10 Sep).

Per managed code: total claim events, distinct claimers, and the count of distinct members who
claimed it 2+ times (plus the repeat-claim event count). Claims-only, no deposit join — fast.

Out: scratchpad/repeatclaimers-{MK}.json = { code: {claims, claimers, repeat_claimers, repeat_events} }
Run: python bin/repeat_claimers_pull.py
"""
import sys, json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from csir_config import get_client, SITE_EDIT, START, END_EXCL

# match the report's basis (else claims/claimers inflate ~2x — same filter as verify_action_codes.py)
STATUSES = "('Approved','Redeemed','Complete','Active','Completed','Low Balance 1','Low Balance 2')"

SCR = Path(__import__("os").environ.get("PROMO_SCRATCH", r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad"))


def load(p):
    fp = SCR / p
    return json.load(open(fp, encoding="utf-8")) if fp.exists() else None


c = get_client(send_receive_timeout=300)

for MK, CUR in (("MY", "MYR"), ("SG", "SGD")):
    va = load(f"verify-action-{MK}.json")
    if not va:
        print(f"[{MK}] skip — verify-action missing")
        continue
    codes = sorted({co["code"].strip() for co in va["codes"]})
    if not codes:
        print(f"[{MK}] skip — no action codes in this window (thin/recent)")
        continue   # empty IN (...) is a ClickHouse error; skip like the missing-verify-action case
    inlist = ",".join("'" + x.replace("'", "''") + "'" for x in codes)

    q = f"""
    SELECT code,
      sum(cnt)          AS claims,
      count()           AS claimers,
      countIf(cnt >= 2) AS repeat_claimers,
      sum(cnt - 1)      AS repeat_events,
      round(sum(mem_total)) AS total_bonus,
      round(sum(mem_first)) AS unique_bonus
    FROM (
      SELECT trimBoth(BonusCode) AS code, MEMBER_ID, count() AS cnt,
             sum(BonusAmount) AS mem_total,
             argMin(BonusAmount, BonusTime_gmt8) AS mem_first
      FROM WORKSPACE.GetBonus_ABC
      WHERE SITE_edit='{SITE_EDIT}' AND Currency='{CUR}' AND BonusAmount>0
        AND trimBoth(BonusCode) IN ({inlist}) AND BonusStatus IN {STATUSES}
        AND toDate(BonusTime_gmt8) >= '{START}' AND toDate(BonusTime_gmt8) < '{END_EXCL}'
      GROUP BY code, MEMBER_ID
    )
    GROUP BY code
    """
    rows = c.query(q).result_rows
    out = {}
    for code, claims, claimers, rc, re_ev, total_bonus, unique_bonus in rows:
        out[code] = {"claims": int(claims), "claimers": int(claimers),
                     "repeat_claimers": int(rc), "repeat_events": int(re_ev),
                     "total_bonus": float(total_bonus or 0), "unique_bonus": float(unique_bonus or 0)}
    path = SCR / f"repeatclaimers-{MK}.json"
    json.dump(out, open(path, "w", encoding="utf-8"), ensure_ascii=False)
    tc, trc = sum(v["claimers"] for v in out.values()), sum(v["repeat_claimers"] for v in out.values())
    print(f"[{MK}] wrote {path.name} — {len(out):,} codes; {trc:,}/{tc:,} claimer-rows are repeat-claimers "
          f"({round(100*trc/tc) if tc else 0}%)")

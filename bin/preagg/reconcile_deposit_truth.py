# -*- coding: utf-8 -*-
"""Reconciliation gate for the deposit-truth WHOLE-BOOK + OVERLAPPING/DISTINCT/DEPOSITORS stage.

Ports bin/deposit_truth_pull.py's Step-1/Step-2 scalars (whole_book + the per-W overlapping,
distinct, depositors) to DuckDB over store_b.parquet (member active-day) + store_claims.parquet
(WS1 claims), and proves the local recompute reproduces the live ClickHouse warehouse to the number.

Focus (this stage only — equal-split per-code / byGroup already covered by reconcile_equal_split.py):
  whole_book  = round(sum DepositAmount) over A UNION ALL BC, dep>0, in window, currency  (additive, any member)
  overlapping = round(sum any(dep)) over distinct (code, member, deposit-day) within W of that code's claim
  distinct    = round(sum any(dep)) over distinct (member, deposit-day) within W of ANY in-scope claim
  depositors  = count(distinct member) in that distinct set

ClickHouse->DuckDB: uniqExact->count(DISTINCT); any()->any_value() (deterministic here — deps is unique
per (member,sd)); toDate->CAST AS DATE; cd + W -> cd + INTERVAL W DAY; round(sum) stays.

Codes + window come from verify-action-{MK}.json + the csir_config window (set PROMO_START/PROMO_END).
Compares every number and times both sides.
"""
import sys, os, json, time
from pathlib import Path

ROOT = Path(r"C:/Users/vdiuser/Downloads/promo-automation")
sys.path.insert(0, str(ROOT))
import csir_config, duckdb

STORE = os.environ.get("PROMO_PREAGG",
    r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad/preagg")
SCR = Path(os.environ.get("PROMO_SCRATCH",
    r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad"))
CLAIMS = os.path.join(STORE, "store_claims.parquet").replace("\\", "/")
STOREB = os.path.join(STORE, "store_b.parquet").replace("\\", "/")
START, END_EXCL = csir_config.START, csir_config.END_EXCL
SITE = csir_config.SITE_EDIT
ST = "('Approved','Redeemed','Complete','Active','Completed','Low Balance 1','Low Balance 2')"
WINDOWS = (7, 30, 90)
client = csir_config.get_client(send_receive_timeout=900)


def inl(cs): return ",".join("'" + x.replace("'", "''") + "'" for x in cs)


# ---------------------------------------------------------------- WHOLE BOOK
def live_wholebook(CUR):
    q = f"""SELECT round(sum(dep)) FROM (
        SELECT DepositAmount AS dep FROM WORKSPACE.Daily_GMT8_Snapshot_A  WHERE Currency='{CUR}' AND DepositAmount>0 AND SnapshotDate>='{START}' AND SnapshotDate<'{END_EXCL}'
        UNION ALL
        SELECT DepositAmount AS dep FROM WORKSPACE.Daily_GMT8_Snapshot_BC WHERE Currency='{CUR}' AND DepositAmount>0 AND SnapshotDate>='{START}' AND SnapshotDate<'{END_EXCL}'
      )"""
    return float(client.query(q).result_rows[0][0] or 0)


def store_wholebook(CUR):
    q = f"""SELECT round(sum(dep)) FROM read_parquet('{STOREB}')
            WHERE cur='{CUR}' AND dep>0 AND sd>='{START}' AND sd<'{END_EXCL}'"""
    return float(duckdb.sql(q).fetchone()[0] or 0)


# ---------------------------------------------- OVERLAPPING / DISTINCT / DEPOSITORS
def live_scalars(CUR, inlist, W):
    q = f"""WITH claims AS (
        SELECT trimBoth(BonusCode) AS code, MEMBER_ID AS member, toDate(BonusTime_gmt8) AS cd
        FROM WORKSPACE.GetBonus_ABC
        WHERE SITE_edit='{SITE}' AND Currency='{CUR}' AND BonusAmount>0
          AND trimBoth(BonusCode) IN ({inlist}) AND BonusStatus IN {ST}
          AND toDate(BonusTime_gmt8) >= '{START}' AND toDate(BonusTime_gmt8) < '{END_EXCL}'),
      deps AS (
        SELECT MEMBER_ID AS member, SnapshotDate AS sd, sum(DepositAmount) AS dep FROM (
          SELECT MEMBER_ID, SnapshotDate, DepositAmount FROM WORKSPACE.Daily_GMT8_Snapshot_A  WHERE Currency='{CUR}' AND DepositAmount>0
          UNION ALL
          SELECT MEMBER_ID, SnapshotDate, DepositAmount FROM WORKSPACE.Daily_GMT8_Snapshot_BC WHERE Currency='{CUR}' AND DepositAmount>0
        ) WHERE MEMBER_ID IN (SELECT member FROM claims) GROUP BY MEMBER_ID, SnapshotDate),
      per_code AS (
        SELECT cl.code AS code, cl.member AS member, d.sd AS sd, any(d.dep) AS dep
        FROM claims cl INNER JOIN deps d ON cl.member=d.member
        WHERE d.sd > cl.cd AND d.sd <= cl.cd + {W} GROUP BY code, member, sd),
      distinct_deps AS (
        SELECT cl.member AS member, d.sd AS sd, any(d.dep) AS dep
        FROM claims cl INNER JOIN deps d ON cl.member=d.member
        WHERE d.sd > cl.cd AND d.sd <= cl.cd + {W} GROUP BY member, sd)
      SELECT (SELECT round(sum(dep)) FROM per_code),
             (SELECT round(sum(dep)) FROM distinct_deps),
             (SELECT uniqExact(member) FROM distinct_deps)"""
    ov, dist, deps_n = client.query(q).result_rows[0]
    return float(ov or 0), float(dist or 0), int(deps_n or 0)


def store_scalars(CUR, inlist, W):
    q = f"""WITH claims AS (
        SELECT code, member, CAST(cd AS DATE) cd FROM read_parquet('{CLAIMS}')
        WHERE cur='{CUR}' AND cd>='{START}' AND cd<'{END_EXCL}' AND code IN ({inlist})),
      deps AS (
        SELECT member, CAST(sd AS DATE) sd, sum(dep) dep FROM read_parquet('{STOREB}')
        WHERE cur='{CUR}' AND dep>0 AND member IN (SELECT member FROM claims) GROUP BY member, sd),
      per_code AS (
        SELECT cl.code code, cl.member member, d.sd sd, any_value(d.dep) dep
        FROM claims cl JOIN deps d ON cl.member=d.member
        WHERE d.sd > cl.cd AND d.sd <= cl.cd + INTERVAL {W} DAY GROUP BY cl.code, cl.member, d.sd),
      distinct_deps AS (
        SELECT cl.member member, d.sd sd, any_value(d.dep) dep
        FROM claims cl JOIN deps d ON cl.member=d.member
        WHERE d.sd > cl.cd AND d.sd <= cl.cd + INTERVAL {W} DAY GROUP BY cl.member, d.sd)
      SELECT (SELECT round(sum(dep)) FROM per_code),
             (SELECT round(sum(dep)) FROM distinct_deps),
             (SELECT count(DISTINCT member) FROM distinct_deps)"""
    ov, dist, deps_n = duckdb.sql(q).fetchone()
    return float(ov or 0), float(dist or 0), int(deps_n or 0)


print(f"window {START} .. {END_EXCL}")
allok = True
max_abs = 0.0
for MK, CUR in (("MY", "MYR"),):   # focus: MY only
    vp = SCR / f"verify-action-{MK}.json"
    if not vp.exists():
        print(f"[skip] {MK} — no verify-action-{MK}.json"); continue
    codes = sorted({c["code"].strip() for c in json.load(open(vp, encoding="utf-8"))["codes"]})
    if not codes:
        print(f"[skip] {MK} — no action codes (empty IN)"); continue
    inlist = inl(codes)

    # --- whole book (window-independent) ---
    tl = time.time(); Lwb = live_wholebook(CUR); twb_l = time.time() - tl
    ts = time.time(); Swb = store_wholebook(CUR); twb_s = time.time() - ts
    dwb = abs(Lwb - Swb); max_abs = max(max_abs, dwb)
    okwb = dwb <= 1.0; allok &= okwb
    print(f"[{'PASS' if okwb else 'FAIL'}] {MK} whole_book — live {Lwb:,.0f} store {Swb:,.0f} "
          f"· diff {dwb:,.0f} · live {twb_l*1000:.0f}ms store {twb_s*1000:.0f}ms ({(twb_l/twb_s if twb_s else 0):.1f}x)")

    # --- per-window overlapping / distinct / depositors ---
    for W in WINDOWS:
        tl = time.time(); Lov, Ldist, Ldep = live_scalars(CUR, inlist, W); tl_ms = (time.time() - tl) * 1000
        ts = time.time(); Sov, Sdist, Sdep = store_scalars(CUR, inlist, W); ts_ms = (time.time() - ts) * 1000
        d_ov, d_dist, d_dep = abs(Lov - Sov), abs(Ldist - Sdist), abs(Ldep - Sdep)
        max_abs = max(max_abs, d_ov, d_dist, d_dep)
        ok = d_ov <= 1.0 and d_dist <= 1.0 and d_dep == 0
        allok &= ok
        sp = (tl_ms / ts_ms) if ts_ms else 0
        print(f"[{'PASS' if ok else 'FAIL'}] {MK} W={W:>2} — "
              f"overlap live {Lov:,.0f} store {Sov:,.0f} (d{d_ov:.0f}) · "
              f"distinct live {Ldist:,.0f} store {Sdist:,.0f} (d{d_dist:.0f}) · "
              f"depositors live {Ldep:,} store {Sdep:,} (d{d_dep:.0f}) · "
              f"live {tl_ms:.0f}ms store {ts_ms:.0f}ms ({sp:.1f}x)")

print(f"\nmax_abs_diff = {max_abs:.2f}")
print(("DEPOSIT-TRUTH scalars reconcile — whole_book + overlapping/distinct/depositors reproduce the live warehouse."
       if allok else "DEPOSIT-TRUTH RECONCILE FAILED."))
sys.exit(0 if allok else 1)

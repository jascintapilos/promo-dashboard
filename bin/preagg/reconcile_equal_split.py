# -*- coding: utf-8 -*-
"""Reconciliation gate for the deposit EQUAL-SPLIT (the single most intricate SQL in the pipeline, and
the biggest Phase-3 correctness risk) — prove the local DuckDB recompute reproduces the live warehouse.

LIVE  = bin/deposit_alloc_bycode_pull.py's exact ClickHouse query.
STORE = the same CTE chain in DuckDB over store_claims.parquet (claims) + store_b.parquet (deposits).
Per-code allocation must match within ±1 (float-sum association + round); the per-code shares must still
sum to the distinct-deposit total (the invariant the stage exists to preserve). Also times both.

Codes + window come from verify-action-{MK}.json + the csir_config window (set PROMO_START/PROMO_END).
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
client = csir_config.get_client(send_receive_timeout=600)


def inl(cs): return ",".join("'" + x.replace("'", "''") + "'" for x in cs)


def live(CUR, inlist, W):
    q = f"""WITH claims AS (SELECT trimBoth(BonusCode) code, MEMBER_ID member, toDate(BonusTime_gmt8) cd FROM WORKSPACE.GetBonus_ABC
        WHERE SITE_edit='{SITE}' AND Currency='{CUR}' AND BonusAmount>0 AND trimBoth(BonusCode) IN ({inlist}) AND BonusStatus IN {ST}
          AND toDate(BonusTime_gmt8)>='{START}' AND toDate(BonusTime_gmt8)<'{END_EXCL}'),
      deps AS (SELECT MEMBER_ID member, SnapshotDate sd, sum(DepositAmount) dep FROM (
        SELECT MEMBER_ID,SnapshotDate,DepositAmount FROM WORKSPACE.Daily_GMT8_Snapshot_A WHERE Currency='{CUR}' AND DepositAmount>0
        UNION ALL SELECT MEMBER_ID,SnapshotDate,DepositAmount FROM WORKSPACE.Daily_GMT8_Snapshot_BC WHERE Currency='{CUR}' AND DepositAmount>0
      ) WHERE MEMBER_ID IN (SELECT member FROM claims) GROUP BY MEMBER_ID,SnapshotDate),
      distinct_deps AS (SELECT cl.member member, d.sd sd, any(d.dep) dep FROM claims cl INNER JOIN deps d ON cl.member=d.member WHERE d.sd>cl.cd AND d.sd<=cl.cd+{W} GROUP BY member,sd),
      pairs AS (SELECT dd.member member, dd.sd sd, cl.code code FROM distinct_deps dd INNER JOIN claims cl ON dd.member=cl.member AND dd.sd>cl.cd AND dd.sd<=cl.cd+{W} GROUP BY member,sd,code),
      cnt AS (SELECT member,sd,count() n FROM pairs GROUP BY member,sd)
      SELECT p.code, round(sum(dd.dep/c2.n)) alloc FROM pairs p INNER JOIN distinct_deps dd ON p.member=dd.member AND p.sd=dd.sd INNER JOIN cnt c2 ON p.member=c2.member AND p.sd=c2.sd GROUP BY code"""
    return {r[0].strip(): float(r[1] or 0) for r in client.query(q).result_rows}


def store(CUR, inlist, W):
    q = f"""WITH claims AS (SELECT code, member, CAST(cd AS DATE) cd FROM read_parquet('{CLAIMS}') WHERE cur='{CUR}' AND cd>='{START}' AND cd<'{END_EXCL}' AND code IN ({inlist})),
      deps AS (SELECT member, CAST(sd AS DATE) sd, sum(dep) dep FROM read_parquet('{STOREB}') WHERE cur='{CUR}' AND dep>0 AND member IN (SELECT member FROM claims) GROUP BY member,sd),
      distinct_deps AS (SELECT cl.member member, d.sd sd, any_value(d.dep) dep FROM claims cl JOIN deps d ON cl.member=d.member WHERE d.sd>cl.cd AND d.sd<=cl.cd+INTERVAL {W} DAY GROUP BY cl.member,d.sd),
      pairs AS (SELECT dd.member member, dd.sd sd, cl.code code FROM distinct_deps dd JOIN claims cl ON dd.member=cl.member AND dd.sd>cl.cd AND dd.sd<=cl.cd+INTERVAL {W} DAY GROUP BY dd.member,dd.sd,cl.code),
      cnt AS (SELECT member,sd,count(*) n FROM pairs GROUP BY member,sd)
      SELECT p.code, round(sum(dd.dep/c2.n)) alloc FROM pairs p JOIN distinct_deps dd ON p.member=dd.member AND p.sd=dd.sd JOIN cnt c2 ON p.member=c2.member AND p.sd=c2.sd GROUP BY p.code"""
    return {r[0].strip(): float(r[1] or 0) for r in duckdb.sql(q).fetchall()}


print(f"window {START} .. {END_EXCL}")
allok = True
for MK, CUR in (("MY", "MYR"), ("SG", "SGD")):
    vp = SCR / f"verify-action-{MK}.json"
    if not vp.exists():
        print(f"[skip] {MK} — no verify-action-{MK}.json"); continue
    codes = sorted({c["code"].strip() for c in json.load(open(vp, encoding="utf-8"))["codes"]})
    if not codes:
        print(f"[skip] {MK} — no action codes in this window (empty IN)"); continue
    inlist = inl(codes)
    for W in WINDOWS:
        tl = time.time(); L = live(CUR, inlist, W); tlive = time.time() - tl
        ts = time.time(); S = store(CUR, inlist, W); tstore = time.time() - ts
        diffs = [k for k in set(L) | set(S) if abs(L.get(k, 0) - S.get(k, 0)) > 1]
        Lt, St = round(sum(L.values())), round(sum(S.values()))
        ok = not diffs and abs(Lt - St) <= max(5, len(L))
        allok &= ok
        sp = (tlive / tstore) if tstore > 0 else 0
        print(f"[{'PASS' if ok else 'FAIL'}] {MK} W={W:>2} — {len(codes)} codes · total live {Lt:,} store {St:,} · {len(diffs)} per-code>1 · live {tlive*1000:.0f}ms store {tstore*1000:.0f}ms ({sp:.1f}x)")
        for k in diffs[:5]:
            print(f"         {k}: live={L.get(k,0):.0f} store={S.get(k,0):.0f}")
print("\n" + ("EQUAL-SPLIT reconciles — the hardest stage reproduces the live warehouse." if allok else "EQUAL-SPLIT RECONCILE FAILED."))
sys.exit(0 if allok else 1)

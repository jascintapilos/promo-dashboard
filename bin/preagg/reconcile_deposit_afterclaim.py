# -*- coding: utf-8 -*-
"""Reconciliation gate for deposit_afterclaim_split_pull.py — the overlap-free "deposits-after"
split into BONUS-LED vs PRE-FUNDED (Construction-B partition). Prove the local DuckDB recompute
over the Parquet stores reproduces the live ClickHouse warehouse to the number.

LIVE  = deposit_afterclaim_split_pull.py's exact ClickHouse CTE chain (claims/deps/distinct_deps/
        pairs/cnt/prefunded_days/nearest/claimtag/cnt_bl) + its 3 output queries.
STORE = the SAME chain in DuckDB over store_claims.parquet (claims) + store_b.parquet (deposits).

CRITICAL vs the equal-split port: this analysis's deps CTE is the RAW A-UNION-BC (NOT pre-summed),
and distinct_deps takes max(d.dep) per (member,sd) — NOT sum(). store_b.parquet is the raw union
(disjoint-ish brand partitions, ~3k MYR member-days carry 2-3 rows), so reading it raw + max()
reproduces live exactly. Pre-summing (as the equal-split does) would be the WRONG query here.

Compares EVERY output number for market MY, windows 30(primary)/7/90:
  (0) distinct_total          — sum(max-dep) over distinct after-deposit-days
  (B) per (code,bucket) alloc — partition split across ALL codes, each share tagged bonus-led/pre-funded
  (A) per code alloc          — subset split only among a day's bonus-led codes
Plus the internal invariant B.bonus_led + B.pre_funded == distinct_total on BOTH sides. Times both.

Codes + window from verify-action-MY.json + csir_config window (set PROMO_START/PROMO_END).
Run:  cd <repo> && PROMO_START=2026-09-01 PROMO_END=2026-10-01 PYTHONUTF8=1 python <this>
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
WINDOWS = (30, 7, 90)  # 30 = primary reconciliation gate
TOL = 1.0              # per-number float-assoc tolerance (division sum-order differs CH vs DuckDB)
client = csir_config.get_client(send_receive_timeout=900)


def inl(cs):
    return ",".join("'" + x.replace("'", "''") + "'" for x in cs)


# ── LIVE: deposit_afterclaim_split_pull.py's exact CTEs (ClickHouse) ───────────────
def live_ctes(CUR, inlist, W):
    return f"""
      WITH claims AS (
        SELECT trimBoth(BonusCode) code, MEMBER_ID member, toDate(BonusTime_gmt8) cd
        FROM WORKSPACE.GetBonus_ABC
        WHERE SITE_edit='{SITE}' AND Currency='{CUR}' AND BonusAmount>0
          AND trimBoth(BonusCode) IN ({inlist}) AND BonusStatus IN {ST}
          AND toDate(BonusTime_gmt8) >= '{START}' AND toDate(BonusTime_gmt8) < '{END_EXCL}'
      ),
      deps AS (
        SELECT MEMBER_ID member, SnapshotDate sd, DepositAmount dep FROM (
          SELECT MEMBER_ID, SnapshotDate, DepositAmount FROM WORKSPACE.Daily_GMT8_Snapshot_A  WHERE Currency='{CUR}' AND DepositAmount>0
          UNION ALL
          SELECT MEMBER_ID, SnapshotDate, DepositAmount FROM WORKSPACE.Daily_GMT8_Snapshot_BC WHERE Currency='{CUR}' AND DepositAmount>0
        ) WHERE MEMBER_ID IN (SELECT member FROM claims)
      ),
      distinct_deps AS (
        SELECT cl.member member, d.sd sd, max(d.dep) dep
        FROM claims cl INNER JOIN deps d ON cl.member=d.member
        WHERE d.sd > cl.cd AND d.sd <= cl.cd + {W} GROUP BY member, sd
      ),
      pairs AS (
        SELECT dd.member member, dd.sd sd, cl.code code
        FROM distinct_deps dd INNER JOIN claims cl ON dd.member=cl.member
        WHERE dd.sd > cl.cd AND dd.sd <= cl.cd + {W}
        GROUP BY member, sd, code
      ),
      cnt AS (SELECT member, sd, count() n FROM pairs GROUP BY member, sd),
      prefunded_days AS (
        SELECT cl.member member, cl.cd cd
        FROM claims cl INNER JOIN deps d ON cl.member=d.member
        WHERE d.sd >= cl.cd - {W} AND d.sd < cl.cd
        GROUP BY member, cd
      ),
      nearest AS (
        SELECT p.member member, p.sd sd, p.code code, max(cl.cd) cd
        FROM pairs p INNER JOIN claims cl ON p.member=cl.member AND p.code=cl.code
        WHERE cl.cd < p.sd AND cl.cd >= p.sd - {W}
        GROUP BY member, sd, code
      ),
      claimtag AS (
        SELECT member, sd, code,
               if((member, cd) IN (SELECT member, cd FROM prefunded_days), 'prefunded', 'bonusled') bucket
        FROM nearest
      ),
      cnt_bl AS (SELECT member, sd, count() nbl FROM claimtag WHERE bucket='bonusled' GROUP BY member, sd)
    """


def live(CUR, inlist, W):
    ctes = live_ctes(CUR, inlist, W)
    dt = float(client.query(ctes + "\nSELECT sum(dep) FROM distinct_deps").result_rows[0][0] or 0)
    rows_b = client.query(ctes + """
      SELECT ct.code code, ct.bucket bucket, sum(dd.dep / cn.n) alloc
      FROM claimtag ct
      INNER JOIN distinct_deps dd ON ct.member=dd.member AND ct.sd=dd.sd
      INNER JOIN cnt cn ON ct.member=cn.member AND ct.sd=cn.sd
      GROUP BY code, bucket
    """).result_rows
    rows_a = client.query(ctes + """
      SELECT ct.code code, sum(dd.dep / cb.nbl) alloc
      FROM claimtag ct
      INNER JOIN distinct_deps dd ON ct.member=dd.member AND ct.sd=dd.sd
      INNER JOIN cnt_bl cb ON ct.member=cb.member AND ct.sd=cb.sd
      WHERE ct.bucket='bonusled'
      GROUP BY code
    """).result_rows
    B = {(r[0].strip(), r[1]): float(r[2] or 0) for r in rows_b}
    A = {r[0].strip(): float(r[1] or 0) for r in rows_a}
    return {"distinct_total": dt, "B": B, "A": A}


# ── STORE: the SAME chain in DuckDB over the Parquet stores ────────────────────────
def store_ctes(CUR, inlist, W):
    return f"""
      WITH claims AS (
        SELECT code, member, CAST(cd AS DATE) cd FROM read_parquet('{CLAIMS}')
        WHERE cur='{CUR}' AND cd>='{START}' AND cd<'{END_EXCL}' AND code IN ({inlist})
      ),
      deps AS (
        SELECT member, CAST(sd AS DATE) sd, dep FROM read_parquet('{STOREB}')
        WHERE cur='{CUR}' AND dep>0 AND member IN (SELECT member FROM claims)
      ),
      distinct_deps AS (
        SELECT cl.member member, d.sd sd, max(d.dep) dep
        FROM claims cl JOIN deps d ON cl.member=d.member
        WHERE d.sd>cl.cd AND d.sd<=cl.cd+INTERVAL {W} DAY
        GROUP BY cl.member, d.sd
      ),
      pairs AS (
        SELECT dd.member member, dd.sd sd, cl.code code
        FROM distinct_deps dd JOIN claims cl ON dd.member=cl.member
        WHERE dd.sd>cl.cd AND dd.sd<=cl.cd+INTERVAL {W} DAY
        GROUP BY dd.member, dd.sd, cl.code
      ),
      cnt AS (SELECT member, sd, count(*) n FROM pairs GROUP BY member, sd),
      prefunded_days AS (
        SELECT cl.member member, cl.cd cd
        FROM claims cl JOIN deps d ON cl.member=d.member
        WHERE d.sd>=cl.cd-INTERVAL {W} DAY AND d.sd<cl.cd
        GROUP BY cl.member, cl.cd
      ),
      nearest AS (
        SELECT p.member member, p.sd sd, p.code code, max(cl.cd) cd
        FROM pairs p JOIN claims cl ON p.member=cl.member AND p.code=cl.code
        WHERE cl.cd<p.sd AND cl.cd>=p.sd-INTERVAL {W} DAY
        GROUP BY p.member, p.sd, p.code
      ),
      claimtag AS (
        SELECT n.member member, n.sd sd, n.code code,
               CASE WHEN pf.member IS NOT NULL THEN 'prefunded' ELSE 'bonusled' END bucket
        FROM nearest n
        LEFT JOIN prefunded_days pf ON n.member=pf.member AND n.cd=pf.cd
      ),
      cnt_bl AS (SELECT member, sd, count(*) nbl FROM claimtag WHERE bucket='bonusled' GROUP BY member, sd)
    """


def store(CUR, inlist, W):
    ctes = store_ctes(CUR, inlist, W)
    dt = float(duckdb.sql(ctes + "\nSELECT sum(dep) FROM distinct_deps").fetchone()[0] or 0)
    rows_b = duckdb.sql(ctes + """
      SELECT ct.code code, ct.bucket bucket, sum(dd.dep / cn.n) alloc
      FROM claimtag ct
      JOIN distinct_deps dd ON ct.member=dd.member AND ct.sd=dd.sd
      JOIN cnt cn ON ct.member=cn.member AND ct.sd=cn.sd
      GROUP BY ct.code, ct.bucket
    """).fetchall()
    rows_a = duckdb.sql(ctes + """
      SELECT ct.code code, sum(dd.dep / cb.nbl) alloc
      FROM claimtag ct
      JOIN distinct_deps dd ON ct.member=dd.member AND ct.sd=dd.sd
      JOIN cnt_bl cb ON ct.member=cb.member AND ct.sd=cb.sd
      WHERE ct.bucket='bonusled'
      GROUP BY ct.code
    """).fetchall()
    B = {(r[0].strip(), r[1]): float(r[2] or 0) for r in rows_b}
    A = {r[0].strip(): float(r[1] or 0) for r in rows_a}
    return {"distinct_total": dt, "B": B, "A": A}


def headline(R):
    bl = sum(v for (c, b), v in R["B"].items() if b == "bonusled")
    pf = sum(v for (c, b), v in R["B"].items() if b == "prefunded")
    return bl, pf


# ── compare ────────────────────────────────────────────────────────────────────────
print(f"window {START} .. {END_EXCL}  (market MY / MYR)")
CUR = "MYR"
vp = SCR / "verify-action-MY.json"
codes = sorted({c["code"].strip() for c in json.load(open(vp, encoding="utf-8"))["codes"]})
inlist = inl(codes)
print(f"{len(codes)} action codes\n")

allok = True
worst = 0.0
worst_where = ""
summary = []
for W in WINDOWS:
    tl = time.time(); L = live(CUR, inlist, W); tlive = time.time() - tl
    ts = time.time(); S = store(CUR, inlist, W); tstore = time.time() - ts

    # (0) distinct_total
    dt_d = abs(L["distinct_total"] - S["distinct_total"])
    # (B) every (code,bucket)
    bkeys = set(L["B"]) | set(S["B"])
    b_diffs = [(k, L["B"].get(k, 0.0), S["B"].get(k, 0.0)) for k in bkeys
               if abs(L["B"].get(k, 0.0) - S["B"].get(k, 0.0)) > TOL]
    # (A) every code
    akeys = set(L["A"]) | set(S["A"])
    a_diffs = [(k, L["A"].get(k, 0.0), S["A"].get(k, 0.0)) for k in akeys
               if abs(L["A"].get(k, 0.0) - S["A"].get(k, 0.0)) > TOL]

    for k in bkeys:
        d = abs(L["B"].get(k, 0.0) - S["B"].get(k, 0.0))
        if d > worst: worst, worst_where = d, f"B{k} W={W}"
    for k in akeys:
        d = abs(L["A"].get(k, 0.0) - S["A"].get(k, 0.0))
        if d > worst: worst, worst_where = d, f"A[{k}] W={W}"
    if dt_d > worst: worst, worst_where = dt_d, f"distinct_total W={W}"

    lbl, lpf = headline(L); slbl, spf = headline(S)
    # internal invariant: B parts foot to distinct_total on each side
    l_inv = abs((lbl + lpf) - L["distinct_total"])
    s_inv = abs((slbl + spf) - S["distinct_total"])

    ok = (dt_d <= TOL and not b_diffs and not a_diffs
          and l_inv <= max(5.0, len(codes)) and s_inv <= max(5.0, len(codes)))
    allok &= ok
    sp = (tlive / tstore) if tstore > 0 else 0.0
    tag = "PASS" if ok else "FAIL"
    print(f"[{tag}] W={W:>2}d  distinct live RM{L['distinct_total']:,.0f} store RM{S['distinct_total']:,.0f} (Δ{dt_d:.2f})")
    print(f"        B bonus-led live RM{lbl:,.0f} store RM{slbl:,.0f} | pre-funded live RM{lpf:,.0f} store RM{spf:,.0f}")
    print(f"        B foots: live Δ{l_inv:.2f} store Δ{s_inv:.2f}  | per-(code,bucket) diffs>{TOL}: {len(b_diffs)} | A per-code diffs>{TOL}: {len(a_diffs)}")
    print(f"        time: live {tlive*1000:.0f}ms  store {tstore*1000:.0f}ms  ({sp:.1f}x)")
    for (k, lv, sv) in (b_diffs + a_diffs)[:8]:
        print(f"          DIFF {k}: live={lv:.2f} store={sv:.2f} (Δ{abs(lv-sv):.2f})")
    summary.append((W, tag, L["distinct_total"], S["distinct_total"], tlive, tstore))

print(f"\nworst abs diff across all numbers: {worst:.4f}  @ {worst_where}")
print("AFTERCLAIM-SPLIT reconciles — bonus-led vs pre-funded reproduces the live warehouse."
      if allok else "AFTERCLAIM-SPLIT RECONCILE FAILED.")
sys.exit(0 if allok else 1)

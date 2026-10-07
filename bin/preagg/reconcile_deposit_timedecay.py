# -*- coding: utf-8 -*-
"""Reconciliation gate for the TIME-DECAY "deposits after claim" (bin/deposit_timedecay_pull.py) —
prove the local DuckDB recompute over the Parquet stores reproduces the live warehouse to the number.

MECHANISM (per deposit_timedecay_pull.py, LOCKED): for each distinct member-deposit-DAY sd within W days
AFTER a claim: equal-split the day's deposit 1/N across the in-scope codes the member claimed within W
BEFORE sd, then discount each share by 0.5^(gap/H) where gap = days from the code's NEAREST preceding
claim-day to sd (gap>=1). Reports per-code equal-split (eqs) and per-code decayed (dH) for each H, plus
the distinct-deposit total (the reconciliation anchor). Primary H=7 at W=7/30/90; H=3,14 at W=30.

LIVE  = deposit_timedecay_pull.py's exact ClickHouse CTE chain (raw deps + max(dep), deterministic).
STORE = the SAME chain in DuckDB over store_claims.parquet (claims) + store_b.parquet (deposits).

CRITICAL FIDELITY NOTE: the time-decay query's `deps` CTE is RAW (ungrouped) and distinct_deps uses
max(DepositAmount) per member-day — NOT sum(). 7,656 MY member-days have a member in BOTH brand
partitions (Snapshot_A and _BC) with DIFFERENT amounts; live takes the MAX, not the sum. So the store
port keeps store_b rows RAW (dep>0) and takes max(dep) — using the generic sum() hint would overcount
those days. store_b is the UNION ALL (ungrouped) of _A and _BC with filter dep>0 OR ngr!=0, so
re-applying dep>0 yields exactly the live deps rows.

ClickHouse -> DuckDB: toDate->CAST AS DATE; count()->count(*); max(dep) stays; cd+{W}->cd+INTERVAL {W} DAY;
dateDiff('day',cd,sd)->(sd-cd) [DATE-DATE=int days]; pow(0.5,x) stays; {float(H)} rendered identically.
No median/quantile here, so the CH-approximate-median caveat does not apply — this should be EXACT.

MY only, window from PROMO_START/PROMO_END (Sep: 2026-09-01..2026-10-01). Codes from verify-action-MY.json.
Times both sides; reports per-code, per-group(pillar), per-W, per-H max abs diff.
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

# W -> half-lives to compute for that window (mirrors deposit_timedecay_pull.py W_PLAN)
W_PLAN = {7: [7], 30: [7, 3, 14], 90: [7]}

client = csir_config.get_client(send_receive_timeout=900)


def inl(cs):
    return ",".join("'" + x.replace("'", "''") + "'" for x in cs)


# ---- LIVE (ClickHouse) — byte-for-byte the deposit_timedecay_pull.py CTE chain ----
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
      nearest AS (
        SELECT p.member member, p.sd sd, p.code code, max(cl.cd) cd
        FROM pairs p INNER JOIN claims cl ON p.member=cl.member AND p.code=cl.code
        WHERE cl.cd < p.sd AND cl.cd >= p.sd - {W}
        GROUP BY member, sd, code
      )"""


def live(CUR, inlist, W, Hs):
    decay = ",\n       ".join(
        f"sum(dd.dep / cn.n * pow(0.5, dateDiff('day', nr.cd, dd.sd) / {float(H)})) d{H}" for H in Hs)
    sel = (f"{live_ctes(CUR, inlist, W)}\n"
           "SELECT nr.code code, sum(dd.dep / cn.n) eqs,\n       " + decay + "\n"
           "FROM nearest nr\n"
           "INNER JOIN distinct_deps dd ON nr.member=dd.member AND nr.sd=dd.sd\n"
           "INNER JOIN cnt cn ON nr.member=cn.member AND nr.sd=cn.sd\n"
           "GROUP BY code")
    rows = client.query(sel).result_rows
    # {code: {'eqs':..., 'd7':..., ...}}
    out = {}
    for r in rows:
        code = r[0].strip()
        rec = {"eqs": float(r[1] or 0)}
        for i, H in enumerate(Hs):
            rec[f"d{H}"] = float(r[2 + i] or 0)
        out[code] = rec
    dtot = float(client.query(f"{live_ctes(CUR, inlist, W)}\nSELECT sum(dep) FROM distinct_deps").result_rows[0][0] or 0)
    return out, dtot


# ---- STORE (DuckDB over Parquet) — same chain, raw deps + max(dep) ----
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
        WHERE d.sd > cl.cd AND d.sd <= cl.cd + INTERVAL {W} DAY GROUP BY cl.member, d.sd
      ),
      pairs AS (
        SELECT dd.member member, dd.sd sd, cl.code code
        FROM distinct_deps dd JOIN claims cl ON dd.member=cl.member
        WHERE dd.sd > cl.cd AND dd.sd <= cl.cd + INTERVAL {W} DAY
        GROUP BY dd.member, dd.sd, cl.code
      ),
      cnt AS (SELECT member, sd, count(*) n FROM pairs GROUP BY member, sd),
      nearest AS (
        SELECT p.member member, p.sd sd, p.code code, max(cl.cd) cd
        FROM pairs p JOIN claims cl ON p.member=cl.member AND p.code=cl.code
        WHERE cl.cd < p.sd AND cl.cd >= p.sd - INTERVAL {W} DAY
        GROUP BY p.member, p.sd, p.code
      )"""


def store(CUR, inlist, W, Hs):
    decay = ",\n       ".join(
        f"sum(dd.dep / cn.n * pow(0.5, (dd.sd - nr.cd) / {float(H)})) d{H}" for H in Hs)
    sel = (f"{store_ctes(CUR, inlist, W)}\n"
           "SELECT nr.code code, sum(dd.dep / cn.n) eqs,\n       " + decay + "\n"
           "FROM nearest nr\n"
           "JOIN distinct_deps dd ON nr.member=dd.member AND nr.sd=dd.sd\n"
           "JOIN cnt cn ON nr.member=cn.member AND nr.sd=cn.sd\n"
           "GROUP BY nr.code")
    rows = duckdb.sql(sel).fetchall()
    out = {}
    for r in rows:
        code = r[0].strip()
        rec = {"eqs": float(r[1] or 0)}
        for i, H in enumerate(Hs):
            rec[f"d{H}"] = float(r[2 + i] or 0)
        out[code] = rec
    dtot = float(duckdb.sql(f"{store_ctes(CUR, inlist, W)}\nSELECT sum(dep) FROM distinct_deps").fetchone()[0] or 0)
    return out, dtot


# ---- run ----
MK, CUR = "MY", "MYR"
vp = SCR / f"verify-action-{MK}.json"
va = json.load(open(vp, encoding="utf-8"))
codes = sorted({c["code"].strip() for c in va["codes"]})
pillar_of = {c["code"].strip(): c.get("pillar", "?") for c in va["codes"]}
inlist = inl(codes)

print(f"window {START} .. {END_EXCL}  |  market {MK}/{CUR}  |  {len(codes)} action codes")
print("=" * 100)

overall_ok = True
global_max_abs = 0.0
worst = None  # (label, L, S, diff)
speedups = []

for W in (7, 30, 90):
    Hs = W_PLAN[W]
    tl = time.time(); L, Ldt = live(CUR, inlist, W, Hs); tlive = time.time() - tl
    ts = time.time(); S, Sdt = store(CUR, inlist, W, Hs); tstore = time.time() - ts
    sp = (tlive / tstore) if tstore > 0 else 0
    speedups.append(sp)

    allcodes = sorted(set(L) | set(S))
    # per-W quantities to compare: per-code eqs, per-code d{H} for each H, distinct_total, and rolled totals
    quantities = []  # (label, Lval, Sval)
    for code in allcodes:
        lr = L.get(code, {}); sr = S.get(code, {})
        quantities.append((f"W{W} {code} eqs", lr.get("eqs", 0.0), sr.get("eqs", 0.0)))
        for H in Hs:
            quantities.append((f"W{W} {code} d{H}", lr.get(f"d{H}", 0.0), sr.get(f"d{H}", 0.0)))
    # distinct total anchor
    quantities.append((f"W{W} distinct_total", Ldt, Sdt))
    # rolled totals per H + eqs total
    quantities.append((f"W{W} TOTAL eqs", sum(v.get("eqs", 0.0) for v in L.values()),
                       sum(v.get("eqs", 0.0) for v in S.values())))
    for H in Hs:
        quantities.append((f"W{W} TOTAL d{H}", sum(v.get(f"d{H}", 0.0) for v in L.values()),
                           sum(v.get(f"d{H}", 0.0) for v in S.values())))
    # pillar rollups (per H decayed + eqs) — the report groups by pillar
    for H in Hs:
        lp, spp = {}, {}
        for code in allcodes:
            p = pillar_of.get(code, "?")
            lp[p] = lp.get(p, 0.0) + L.get(code, {}).get(f"d{H}", 0.0)
            spp[p] = spp.get(p, 0.0) + S.get(code, {}).get(f"d{H}", 0.0)
        for p in sorted(set(lp) | set(spp)):
            quantities.append((f"W{W} pillar[{p}] d{H}", lp.get(p, 0.0), spp.get(p, 0.0)))

    # evaluate: round to integer (the pull's output grain). FAIL if any rounded diff > 1.
    w_max_abs = 0.0
    w_worst = None
    bad = []
    for label, lv, sv in quantities:
        d = abs(lv - sv)
        if d > w_max_abs:
            w_max_abs = d; w_worst = (label, lv, sv, d)
        if abs(round(lv) - round(sv)) > 1:   # "to the number" = rounded-integer within 1
            bad.append((label, lv, sv, d))
    ok = not bad
    overall_ok &= ok
    if w_max_abs > global_max_abs:
        global_max_abs = w_max_abs; worst = w_worst

    print(f"[{'PASS' if ok else 'FAIL'}] W={W:>2}  H={Hs}  | {len(codes)} codes · "
          f"distinct_total live {Ldt:,.0f} store {Sdt:,.0f} · "
          f"{len(quantities)} numbers compared, {len(bad)} rounded-diff>1 · "
          f"max_abs_diff {w_max_abs:.6f} · live {tlive*1000:.0f}ms store {tstore*1000:.0f}ms ({sp:.1f}x)")
    if w_worst:
        print(f"        worst abs diff: {w_worst[0]}  live={w_worst[1]:.6f} store={w_worst[2]:.6f} (|d|={w_worst[3]:.6f})")
    # per-H total lines for visibility
    for H in Hs:
        lt = sum(v.get(f"d{H}", 0.0) for v in L.values())
        st = sum(v.get(f"d{H}", 0.0) for v in S.values())
        et = sum(v.get("eqs", 0.0) for v in L.values())
        disc = 100.0 * (1.0 - lt / et) if et else 0.0
        print(f"           H={H:>2}: decayed live RM{lt:,.0f} store RM{st:,.0f}  (|d|={abs(lt-st):.4f}, discount {disc:.1f}% of eq-split RM{et:,.0f})")
    for label, lv, sv, d in bad[:8]:
        print(f"           DIFF {label}: live={lv:.4f} store={sv:.4f} |d|={d:.4f}")

print("=" * 100)
print(f"overall: {'RECONCILES — store reproduces live to the number.' if overall_ok else 'RECONCILE FAILED.'}")
print(f"global max_abs_diff = {global_max_abs:.10e}" + (f"  at {worst[0]} (live {worst[1]!r} / store {worst[2]!r})" if worst else ""))
print(f"median speedup = {sorted(speedups)[len(speedups)//2]:.1f}x  (per-W: " + ", ".join(f'{s:.1f}x' for s in speedups) + ")")
sys.exit(0 if overall_ok else 1)

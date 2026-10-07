# -*- coding: utf-8 -*-
"""Reconciliation gate for SECTION B of bin/deposit_behaviour_pull.py — the give-away
reactivation table (recipients / came-back / came-back% / median speed / returner amount),
per pillar||type group, windows 7/30/90.

LIVE  = deposit_behaviour_pull.py's exact Section B ClickHouse query (byte-for-byte CTE chain).
STORE = the same CTE chain re-expressed in DuckDB over
          store_claims.parquet  -> the `claims` CTE  (cd = toString(toDate(BonusTime_gmt8)),
                                    status/BonusAmount/SITE filters already baked in at build time)
          store_b.parquet       -> the `deps`  CTE  (member active-day; read with dep>0 + GROUP BY
                                    member,sd reproduces the live UNION-ALL sum(DepositAmount))

ClickHouse -> DuckDB mapping used below:
    uniqExact(x)              -> count(DISTINCT x)
    any(x) over grouped value -> any_value(x)          (deterministic — dep is constant per member,sd)
    median(gap)               -> median(gap)           (DuckDB EXACT; CH quantile is reservoir-APPROX
                                                         above 8192 rows -> small speed diffs = tolerance)
    dateDiff('day',a,b)       -> date_diff('day',a,b)
    d.sd <= cl.cd + {W}       -> d.sd <= cl.cd + INTERVAL {W} DAY
    toDate(x)                 -> CAST(x AS DATE)
    ifNull(x,0)               -> COALESCE(x,0)
    round(sum(dep))           -> round(sum(dep))        (CH banker's vs DuckDB half-up on a float sum
                                                         => tolerate +/-1 on the money column, like the
                                                         equal-split gate; counts must be EXACT)

Counts (recipients, cameback) must match EXACTLY. Amount tolerated +/-1. Speed (median days) EXACT
unless a cameback group exceeds CH's 8192 reservoir -> a few % diff = within-tolerance.

Section A (deposit-required: the nearest qualifying deposit strictly BEFORE each claim) is NOT
reconciled here: it needs dedup_Deposit_A exact TIME, which no store carries -> reported blocked.

Three passes per market/window, each run LIVE and STORE and compared number-by-number:
  prod         faithful give-away partition from dep_req() (what the pipeline ships)
  stress-group ALL verify-action codes forced into Section B, grouped pillar||type
               (exercises multi-code-per-group + multi-claim-per-member dedup at real volume)
  stress-code  ALL codes forced into Section B, each code its own group (finest grain)

Window + codes come from verify-action-{MK}.json + the csir_config window (set PROMO_START/PROMO_END).
"""
import sys, os, json, time, re
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
AMT_TOL = 1.0      # per-group money: CH round (banker's) vs DuckDB round (half-up) on a float sum
SPEED_TOL = 0.2    # per-group median speed: CH reservoir-approx vs DuckDB exact (days), rounded to .1
client = csir_config.get_client(send_receive_timeout=600)


def inl(cs):
    return ",".join("'" + x.replace("'", "''") + "'" for x in cs)


def bt(m):   # mechanic -> bonus-type label — copied verbatim from deposit_behaviour_pull.py
    m = (m or "").lower()
    if "spin" in m: return "Free spins"
    if "credit" in m or m == "fc": return "Free credit"
    if "cash" in m: return "Cashback"
    if "reload" in m or "match" in m or "deposit" in m: return "Deposit"
    return (m or "Other").title()


def load(p):
    fp = SCR / p
    return json.load(open(fp, encoding="utf-8")) if fp.exists() else None


def partitions(MK):
    """Reproduce deposit_behaviour_pull.py's code/group derivation, then build the 3 passes."""
    va = load(f"verify-action-{MK}.json")
    meta = {x["code"].strip(): x for x in va["codes"]}
    allcodes = sorted(meta)
    grp_of = {co: f"{meta[co]['pillar']}||{bt(meta[co]['mechanic'])}" for co in allcodes}
    cfg = load(f"promo-config-{MK}.json") or {}

    def dep_req(co):
        cc = cfg.get(co) or cfg.get(co.strip())
        if cc is not None:
            return bool(cc.get("deposit_required"))
        if bt(meta[co]["mechanic"]) == "Deposit":
            return True
        return bool(re.search(r'MD\d|DEP\d|GET\d|PCT|PAYDAY|_REL', co, re.I))

    ga = [co for co in allcodes if not dep_req(co)]

    def groups_of(codes, by):
        g = {}
        for co in codes:
            lbl = grp_of[co] if by == "pillar" else co
            g.setdefault(lbl, []).append(co)
        return g

    return meta, allcodes, {
        "prod":         (ga,       groups_of(ga, "pillar")),
        "stress-group": (allcodes, groups_of(allcodes, "pillar")),
        "stress-code":  (allcodes, groups_of(allcodes, "code")),
    }


def grp_case_ch(groups):
    if not groups:
        return "'other'"
    return "multiIf(" + ", ".join(f"trimBoth(BonusCode) IN ({inl(cs)}), '{lbl.replace(chr(39), chr(39)*2)}'"
                                  for lbl, cs in groups.items()) + ", 'other')"


def grp_case_duck(groups):
    if not groups:
        return "'other'"
    return "CASE " + " ".join(f"WHEN code IN ({inl(cs)}) THEN '{lbl.replace(chr(39), chr(39)*2)}'"
                              for lbl, cs in groups.items()) + " ELSE 'other' END"


def live_B(CUR, codes, groups, W):
    gc = grp_case_ch(groups)
    claim_where = (f"SITE_edit='{SITE}' AND Currency='{CUR}' AND BonusAmount>0 AND BonusStatus IN {ST} "
                   f"AND toDate(BonusTime_gmt8) >= '{START}' AND toDate(BonusTime_gmt8) < '{END_EXCL}'")
    q = f"""
      WITH claims AS (
        SELECT MEMBER_ID member, toDate(BonusTime_gmt8) cd, {gc} grp
        FROM WORKSPACE.GetBonus_ABC WHERE {claim_where} AND trimBoth(BonusCode) IN ({inl(codes)})
      ),
      deps AS (
        SELECT MEMBER_ID member, SnapshotDate sd, sum(DepositAmount) dep FROM (
          SELECT MEMBER_ID, SnapshotDate, DepositAmount FROM WORKSPACE.Daily_GMT8_Snapshot_A  WHERE Currency='{CUR}' AND DepositAmount>0
          UNION ALL
          SELECT MEMBER_ID, SnapshotDate, DepositAmount FROM WORKSPACE.Daily_GMT8_Snapshot_BC WHERE Currency='{CUR}' AND DepositAmount>0
        ) WHERE MEMBER_ID IN (SELECT member FROM claims) GROUP BY MEMBER_ID, SnapshotDate
      ),
      cb AS (
        SELECT cl.grp grp, cl.member member, min(dateDiff('day', cl.cd, d.sd)) gap
        FROM claims cl INNER JOIN deps d ON cl.member=d.member
        WHERE d.sd > cl.cd AND d.sd <= cl.cd + {W} GROUP BY grp, member
      ),
      amt AS (
        SELECT grp, round(sum(dep)) amount FROM (
          SELECT cl.grp grp, cl.member member, d.sd sd, any(d.dep) dep
          FROM claims cl INNER JOIN deps d ON cl.member=d.member
          WHERE d.sd > cl.cd AND d.sd <= cl.cd + {W} GROUP BY grp, member, sd
        ) GROUP BY grp
      )
      SELECT r.grp, r.recipients, ifNull(c2.cameback,0) cameback, ifNull(c2.speed,0) speed, ifNull(a.amount,0) amount
      FROM (SELECT grp, uniqExact(member) recipients FROM claims GROUP BY grp) r
      LEFT JOIN (SELECT grp, uniqExact(member) cameback, round(median(gap),1) speed FROM cb GROUP BY grp) c2 ON r.grp=c2.grp
      LEFT JOIN amt a ON r.grp=a.grp
    """
    return {r[0]: (int(r[1]), int(r[2]), float(r[3] or 0), float(r[4] or 0)) for r in client.query(q).result_rows}


def store_B(CUR, codes, groups, W):
    gc = grp_case_duck(groups)
    q = f"""
      WITH claims AS (
        SELECT member, CAST(cd AS DATE) cd, {gc} grp
        FROM read_parquet('{CLAIMS}') WHERE cur='{CUR}' AND cd>='{START}' AND cd<'{END_EXCL}' AND code IN ({inl(codes)})
      ),
      deps AS (
        SELECT member, CAST(sd AS DATE) sd, sum(dep) dep
        FROM read_parquet('{STOREB}') WHERE cur='{CUR}' AND dep>0 AND member IN (SELECT member FROM claims) GROUP BY member, sd
      ),
      cb AS (
        SELECT cl.grp grp, cl.member member, min(date_diff('day', cl.cd, d.sd)) gap
        FROM claims cl JOIN deps d ON cl.member=d.member
        WHERE d.sd > cl.cd AND d.sd <= cl.cd + INTERVAL {W} DAY GROUP BY cl.grp, cl.member
      ),
      amt AS (
        SELECT grp, round(sum(dep)) amount FROM (
          SELECT cl.grp grp, cl.member member, d.sd sd, any_value(d.dep) dep
          FROM claims cl JOIN deps d ON cl.member=d.member
          WHERE d.sd > cl.cd AND d.sd <= cl.cd + INTERVAL {W} DAY GROUP BY cl.grp, cl.member, d.sd
        ) GROUP BY grp
      )
      SELECT r.grp, r.recipients, COALESCE(c2.cameback,0) cameback, COALESCE(c2.speed,0) speed, COALESCE(a.amount,0) amount
      FROM (SELECT grp, count(DISTINCT member) recipients FROM claims GROUP BY grp) r
      LEFT JOIN (SELECT grp, count(DISTINCT member) cameback, round(median(gap),1) speed FROM cb GROUP BY grp) c2 ON r.grp=c2.grp
      LEFT JOIN amt a ON r.grp=a.grp
    """
    return {r[0]: (int(r[1]), int(r[2]), float(r[3] or 0), float(r[4] or 0)) for r in duckdb.sql(q).fetchall()}


def compare(L, S):
    """Return (count_diffs, amount_diffs, speed_tol, max_amt_diff, max_speed_diff, detail-lines)."""
    keys = sorted(set(L) | set(S))
    count_diffs, amount_diffs, speed_tol = [], [], []
    max_amt, max_spd, lines = 0.0, 0.0, []
    for k in keys:
        lr, lcb, lsp, lamt = L.get(k, (0, 0, 0.0, 0.0))
        sr, scb, ssp, samt = S.get(k, (0, 0, 0.0, 0.0))
        d_amt, d_spd = abs(lamt - samt), abs(lsp - ssp)
        max_amt = max(max_amt, d_amt); max_spd = max(max_spd, d_spd)
        if lr != sr or lcb != scb:
            count_diffs.append(k)
            lines.append(f"      COUNT  {k}: live(recip={lr},cb={lcb}) store(recip={sr},cb={scb})")
        if d_amt > AMT_TOL:
            amount_diffs.append(k)
            lines.append(f"      AMOUNT {k}: live={lamt:.0f} store={samt:.0f} d={d_amt:.0f}")
        if d_spd > 0:
            (speed_tol if d_spd <= SPEED_TOL else amount_diffs).append(k)   # big speed gap counts as a hard diff
            tag = "tol" if d_spd <= SPEED_TOL else "FAIL"
            lines.append(f"      SPEED[{tag}] {k}: live={lsp} store={ssp} d={d_spd:.1f}")
    return count_diffs, amount_diffs, speed_tol, max_amt, max_spd, lines


print(f"SECTION B reconcile · window {START} .. {END_EXCL}  (END exclusive)")
print(f"stores: {CLAIMS}\n        {STOREB}\n")
overall_ok = True
worst_amt = 0.0
worst_spd = 0.0
any_speed_tol = False
for MK, CUR in (("MY", "MYR"),):   # task scope: MY only
    vp = SCR / f"verify-action-{MK}.json"
    if not vp.exists():
        print(f"[skip] {MK} — no verify-action-{MK}.json"); continue
    meta, allcodes, passes = partitions(MK)
    if not allcodes:
        print(f"[skip] {MK} — no action codes in this window"); continue
    for pname, (codes, groups) in passes.items():
        if not codes:
            print(f"[skip] {MK}/{pname} — no codes in this pass"); continue
        print(f"=== {MK} · pass={pname} · {len(codes)} codes · {len(groups)} group(s) ===")
        for W in WINDOWS:
            tl = time.time(); L = live_B(CUR, codes, groups, W); tlive = time.time() - tl
            ts = time.time(); S = store_B(CUR, codes, groups, W); tstore = time.time() - ts
            cdiffs, adiffs, stol, m_amt, m_spd, lines = compare(L, S)
            ok = not cdiffs and not adiffs
            overall_ok &= ok
            worst_amt = max(worst_amt, m_amt); worst_spd = max(worst_spd, m_spd)
            any_speed_tol |= bool(stol)
            sp = (tlive / tstore) if tstore > 0 else 0
            status = "PASS" if ok else "FAIL"
            if ok and stol:
                status = "PASS*"   # exact on counts+money, median within CH-approx tolerance
            print(f"  [{status:5}] W={W:>2} · {len(groups)} grp · "
                  f"{len(cdiffs)} count-diff · {len(adiffs)} hard-diff · {len(stol)} speed-tol · "
                  f"maxΔamt={m_amt:.0f} maxΔspeed={m_spd:.1f} · "
                  f"live {tlive*1000:.0f}ms store {tstore*1000:.0f}ms ({sp:.0f}x)")
            for ln in lines[:12]:
                print(ln)
        print()

print("—" * 72)
print(f"worst money Δ (per group): {worst_amt:.0f}   worst speed Δ (days): {worst_spd:.1f}"
      + ("   [median within tolerance]" if any_speed_tol else ""))
print("SECTION A: BLOCKED — needs dedup_Deposit_A exact deposit TIME (nearest deposit strictly BEFORE"
      " each claim); no store carries sub-day deposit timestamps.")
print("\n" + ("SECTION B reconciles — the local DuckDB recompute reproduces the live warehouse."
             if overall_ok else "SECTION B RECONCILE FAILED."))
sys.exit(0 if overall_ok else 1)

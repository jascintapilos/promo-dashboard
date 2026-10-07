#!/usr/bin/env python3
"""STORE-BACKED producer for the Bonus-vs-Deposits tab (Steps 1 + 2), all 3 windows.

Byte-compatible local twin of bin/deposit_truth_pull.py: identical post-processing and
identical output JSON, but every warehouse query is swapped for the DuckDB-over-stores
equivalent so the parallel build engine can run it locally and fast. Reads:
  store_b.parquet      (member active-day: member, sd, cur, dep, ngr)  -> deposits
  store_claims.parquet (WS1 bonus claim:   member, code, cd, cur, bonus, bt) -> claims

Per market, per window W in (7,30,90):
  overlapping  = sum of per-code dW  (reproduces the report's summed 'Deposit amt Wd' — the double-count)
  distinct     = sum over each (member, deposit-day) counted ONCE if within W days after ANY in-scope claim
  depositors   = distinct members in that set
  alloc_*      = eligibility-aware EQUAL split of `distinct` across DEPOSIT-REQUIRED in-scope codes;
                 deposits with no deposit-required in-scope claim within W days -> UNATTRIBUTED.
                 sum(byPillar) + unattributed == distinct  (reconciles by construction).
wholeBook is window-independent (all deposits in window, any member).

Out: scratchpad/deposit-truth-{MK}.json   (consumed by assemble_explorer_payload.py -> depositTruth)

CH->DuckDB: uniqExact->count(DISTINCT); any()->any_value() (deterministic — deps pre-summed unique per
member,sd); toDate->CAST AS DATE; cd + W -> cd + INTERVAL W DAY; multiIf->CASE; round(sum) stays.
The DuckDB store columns are already filtered+trimmed (SITE_edit=WS1, Currency IN (MYR,SGD), BonusAmount>0,
BonusStatus IN (...), code=trimBoth(BonusCode)), so trimBoth(BonusCode) collapses to the `code` column.
"""
import sys, os, json
from pathlib import Path

ROOT = Path(r"C:/Users/vdiuser/Downloads/promo-automation")
sys.path.insert(0, str(ROOT))
from csir_config import SITE_EDIT, START, END_EXCL
import duckdb

SCR = Path(os.environ.get("PROMO_SCRATCH", r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad"))
STORE = os.environ.get("PROMO_PREAGG", r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad/preagg")
CLAIMS = os.path.join(STORE, "store_claims.parquet").replace("\\", "/")
STOREB = os.path.join(STORE, "store_b.parquet").replace("\\", "/")
STATUSES = "('Approved','Redeemed','Complete','Active','Completed','Low Balance 1','Low Balance 2')"  # (already applied in store build; kept for parity)
MK_CFG = {"MY": ("MYR", "RM"), "SG": ("SGD", "S$")}
WINDOWS = (7, 30, 90)


def bt(m):  # report's own bonus-type classifier (assemble_explorer_payload.py)
    m = (m or "").lower()
    if "spin" in m: return "Free spins"
    if "credit" in m or m == "fc": return "Free credit"
    if "cash" in m: return "Cashback"
    if "reload" in m or "match" in m or "deposit" in m: return "Deposit"
    return (m or "Other").title()


def load(p):
    fp = SCR / p
    return json.load(open(fp, encoding="utf-8")) if fp.exists() else None


def q1(sql):  # scalar
    return duckdb.sql(sql).fetchone()


for MK, (CUR, SYM) in MK_CFG.items():
    va = load(f"verify-action-{MK}.json")
    if va is None:
        print(f"[{MK}] skip — no verify-action-{MK}.json"); continue
    meta = {x["code"].strip(): x for x in va["codes"]}
    allcodes = sorted(meta)
    if not allcodes:
        print(f"[{MK}] skip — no action codes in this window (thin/recent)"); continue  # empty IN (...) is an error
    depreq = [k for k in allcodes if bt(meta[k]["mechanic"]) == "Deposit"]
    inlist = ",".join("'" + x.replace("'", "''") + "'" for x in allcodes)
    drlist = ",".join("'" + x.replace("'", "''") + "'" for x in depreq)
    # per-code group tag = "pillar||bonus-type" (for WITHIN-GROUP distinct per money-table row)
    def _inl(cs): return ",".join("'" + x.replace("'", "''") + "'" for x in cs)
    groups = {}
    for co in allcodes:
        groups.setdefault(f"{meta[co]['pillar']}||{bt(meta[co]['mechanic'])}", []).append(co)
    grp_case = "CASE " + " ".join(f"WHEN code IN ({_inl(cs)}) THEN '{lbl}'" for lbl, cs in groups.items()) + " ELSE 'other' END"

    whole_book = float(q1(f"""
      SELECT round(sum(dep)) FROM read_parquet('{STOREB}')
      WHERE cur='{CUR}' AND dep>0 AND sd>='{START}' AND sd<'{END_EXCL}'
    """)[0] or 0)

    out = {"sym": SYM, "wholeBook": whole_book, "nDepReq": len(depreq),
           "nGiveaway": len(allcodes) - len(depreq), "byWindow": {}}

    for W in WINDOWS:
        # overlapping + distinct + depositors
        ov, dist, deps_n = q1(f"""
          WITH claims AS (
            SELECT code, member, CAST(cd AS DATE) AS cd FROM read_parquet('{CLAIMS}')
            WHERE cur='{CUR}' AND cd >= '{START}' AND cd < '{END_EXCL}' AND code IN ({inlist})
          ),
          deps AS (
            SELECT member, CAST(sd AS DATE) AS sd, sum(dep) AS dep FROM read_parquet('{STOREB}')
            WHERE cur='{CUR}' AND dep>0 AND member IN (SELECT member FROM claims) GROUP BY member, sd
          ),
          per_code AS (
            SELECT cl.code AS code, cl.member AS member, d.sd AS sd, any_value(d.dep) AS dep
            FROM claims cl JOIN deps d ON cl.member=d.member
            WHERE d.sd > cl.cd AND d.sd <= cl.cd + INTERVAL {W} DAY GROUP BY cl.code, cl.member, d.sd
          ),
          distinct_deps AS (
            SELECT cl.member AS member, d.sd AS sd, any_value(d.dep) AS dep
            FROM claims cl JOIN deps d ON cl.member=d.member
            WHERE d.sd > cl.cd AND d.sd <= cl.cd + INTERVAL {W} DAY GROUP BY cl.member, d.sd
          )
          SELECT (SELECT round(sum(dep)) FROM per_code),
                 (SELECT round(sum(dep)) FROM distinct_deps),
                 (SELECT count(DISTINCT member) FROM distinct_deps)
        """)
        ov, dist, deps_n = float(ov or 0), float(dist or 0), int(deps_n or 0)

        # equal-split allocation over deposit-required in-scope codes
        rows = duckdb.sql(f"""
          WITH claims AS (
            SELECT code, member, CAST(cd AS DATE) AS cd FROM read_parquet('{CLAIMS}')
            WHERE cur='{CUR}' AND cd >= '{START}' AND cd < '{END_EXCL}' AND code IN ({inlist})
          ),
          dr_claims AS (SELECT code, member, cd FROM claims WHERE code IN ({drlist})),
          deps AS (
            SELECT member, CAST(sd AS DATE) AS sd, sum(dep) AS dep FROM read_parquet('{STOREB}')
            WHERE cur='{CUR}' AND dep>0 AND member IN (SELECT member FROM claims) GROUP BY member, sd
          ),
          distinct_deps AS (
            SELECT cl.member AS member, d.sd AS sd, any_value(d.dep) AS dep
            FROM claims cl JOIN deps d ON cl.member=d.member
            WHERE d.sd > cl.cd AND d.sd <= cl.cd + INTERVAL {W} DAY GROUP BY cl.member, d.sd
          ),
          dr_pairs AS (
            SELECT dd.member AS member, dd.sd AS sd, cl.code AS code
            FROM distinct_deps dd JOIN dr_claims cl
              ON dd.member=cl.member AND dd.sd > cl.cd AND dd.sd <= cl.cd + INTERVAL {W} DAY
            GROUP BY dd.member, dd.sd, cl.code
          ),
          dr_counts AS (SELECT member, sd, count(*) AS n FROM dr_pairs GROUP BY member, sd)
          SELECT p.code AS code, sum(dd.dep / c2.n) AS alloc_dep
          FROM dr_pairs p
          JOIN distinct_deps dd ON p.member=dd.member AND p.sd=dd.sd
          JOIN dr_counts   c2 ON p.member=c2.member AND p.sd=c2.sd
          GROUP BY p.code
        """).fetchall()

        by_code = {code: float(a or 0) for code, a in rows}
        alloc_total = sum(by_code.values())
        unattr = dist - alloc_total
        by_pillar = {}
        for code, a in by_code.items():
            p = meta[code]["pillar"]
            by_pillar[p] = by_pillar.get(p, 0.0) + a

        # WITHIN-GROUP distinct deposits per (pillar||bonus-type) — each money-table row deduplicated
        grows = duckdb.sql(f"""
          WITH claims AS (
            SELECT member, CAST(cd AS DATE) AS cd, {grp_case} AS grp FROM read_parquet('{CLAIMS}')
            WHERE cur='{CUR}' AND cd >= '{START}' AND cd < '{END_EXCL}' AND code IN ({inlist})
          ),
          deps AS (
            SELECT member, CAST(sd AS DATE) AS sd, sum(dep) AS dep FROM read_parquet('{STOREB}')
            WHERE cur='{CUR}' AND dep>0 AND member IN (SELECT member FROM claims) GROUP BY member, sd
          ),
          distinct_deps AS (
            SELECT cl.member AS member, d.sd AS sd, any_value(d.dep) AS dep
            FROM claims cl JOIN deps d ON cl.member=d.member
            WHERE d.sd > cl.cd AND d.sd <= cl.cd + INTERVAL {W} DAY GROUP BY cl.member, d.sd
          ),
          dep_grp AS (   -- distinct (member, deposit-day, group): a deposit-day within W of a claim of a code in that group
            SELECT dd.member AS member, dd.sd AS sd, cl.grp AS grp, any_value(dd.dep) AS dep
            FROM distinct_deps dd JOIN claims cl
              ON dd.member=cl.member AND dd.sd > cl.cd AND dd.sd <= cl.cd + INTERVAL {W} DAY
            GROUP BY dd.member, dd.sd, cl.grp
          )
          SELECT grp, round(sum(dep)) AS dep, count(DISTINCT member) AS depositors
          FROM dep_grp GROUP BY grp
        """).fetchall()
        by_group = {g: {"dep": float(dep or 0), "depositors": int(dpr or 0)} for g, dep, dpr in grows}

        out["byWindow"][str(W)] = {
            "overlapping": round(ov), "distinct": round(dist), "depositors": deps_n,
            "overlapFactor": round(ov / dist, 2) if dist else None,
            "allocTotal": round(alloc_total), "unattributed": round(unattr),
            "unattrPct": round(unattr / dist * 100, 1) if dist else None,
            "byPillar": {k: round(v) for k, v in sorted(by_pillar.items(), key=lambda kv: -kv[1])},
            "byGroup": {g: {"dep": round(v["dep"]), "depositors": v["depositors"]} for g, v in by_group.items()},
            "byCode": {k: round(v) for k, v in sorted(by_code.items(), key=lambda kv: -kv[1])} if W == 30 else None,
        }
        rec_ok = abs(alloc_total + unattr - dist) < 1.0
        print(f"[{MK}] W={W:>2}d  overlap {SYM}{ov:,.0f}  distinct {SYM}{dist:,.0f} ({deps_n:,})  "
              f"alloc {SYM}{alloc_total:,.0f}  unattr {SYM}{unattr:,.0f}  reconciles={rec_ok}")

    json.dump(out, open(SCR / f"deposit-truth-{MK}.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"[{MK}] wrote deposit-truth-{MK}.json  (whole-book {SYM}{whole_book:,.0f})")
print("\nDONE.")

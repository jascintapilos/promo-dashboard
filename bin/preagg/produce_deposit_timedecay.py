#!/usr/bin/env python3
"""STORE-BACKED PRODUCER for the time-decay "deposits after claim" stage.

A byte-compatible copy of bin/deposit_timedecay_pull.py with ONLY its warehouse
query swapped to the DuckDB-over-Parquet-stores equivalent. All post-processing and
the exact output JSON structure are identical to the original, so the parallel build
engine can run this locally and fast without touching the remote ClickHouse warehouse.

The swapped SQL is the VALIDATED chain from bin/preagg/reconcile_deposit_timedecay.py
(store_ctes/store), which reconciled 0-diff to the live warehouse. CRITICAL two-shape
note: the time-decay query keeps `deps` RAW (ungrouped, dep>0) and distinct_deps takes
max(dep) per member-day — NOT sum() — because member-days present in BOTH brand
partitions (Snapshot_A and _BC) with different amounts must take the MAX. store_b is the
raw UNION ALL of _A and _BC (dep>0 OR ngr!=0), so re-applying dep>0 recovers exactly the
live deps rows.

ClickHouse -> DuckDB: WORKSPACE.GetBonus_ABC -> read_parquet(store_claims) [SITE_edit=WS1,
BonusAmount>0, BonusStatus-set, trimmed code already baked into the store build];
Snapshot_A/_BC UNION -> read_parquet(store_b) [dep>0]; toDate -> CAST AS DATE; count() ->
count(*); cd+{W} -> cd+INTERVAL {W} DAY; dateDiff('day',cd,sd) -> (sd-cd) [DATE-DATE=int
days]; pow(0.5,x) stays; {float(H)} rendered identically. No median/quantile, so the
CH-approximate-median caveat does not apply — this is EXACT.

MECHANISM (per the original, LOCKED — time-decay only, no bonus-amount weighting, no baseline/lift):
  For each distinct member-deposit-DAY sd within W days AFTER a claim:
    N   = distinct in-scope codes the member claimed within W BEFORE sd (equal-split denominator)
    for each such code:
      cd   = that code's NEAREST preceding claim-DAY (<= sd, within [sd-W, sd))
      gap  = (sd - cd)  (>= 1 day; sd strictly > cd)
      contribution = (dep / N) * pow(0.5, gap / H)   (7-day half-life default)
  Sum contribution per code -> roll up to pillar + total.

Primary: H=7 at W=7/30/90. Sensitivity: H=3 and H=14 at W=30.

Out: scratchpad/deposit-timedecay-{MK}.json   (identical structure to the original stage)
"""
import sys, os, json
from pathlib import Path

ROOT = Path(r"C:/Users/vdiuser/Downloads/promo-automation")
sys.path.insert(0, str(ROOT))
# Same csir_config window seam as the original stage (START / END_EXCL / SITE_EDIT).
from csir_config import SITE_EDIT, START, END_EXCL
import duckdb

SCR = Path(os.environ.get("PROMO_SCRATCH", r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad"))
STORE = os.environ.get("PROMO_PREAGG", r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad/preagg")
CLAIMS = os.path.join(STORE, "store_claims.parquet").replace("\\", "/")
STOREB = os.path.join(STORE, "store_b.parquet").replace("\\", "/")
# BonusStatus-set, SITE_edit=WS1 and BonusAmount>0 are already applied in the store_claims
# build, so the status filter below is informational only (kept for parity with the original).
STATUSES = "('Approved','Redeemed','Complete','Active','Completed','Low Balance 1','Low Balance 2')"
MK_CFG = {"MY": ("MYR", "RM"), "SG": ("SGD", "S$")}

H_PRIMARY = 7
# W -> list of half-lives to compute for that window. H=7 across all windows; H=3 & H=14 only at W=30.
W_PLAN = {7: [7], 30: [7, 3, 14], 90: [7]}


def load(p):
    fp = SCR / p
    return json.load(open(fp, encoding="utf-8")) if fp.exists() else None


def col(H):
    """A safe SQL column alias + decay expression for half-life H (DuckDB: DATE-DATE = int gap days)."""
    # dd.dep / cn.n = equal-split share; pow(0.5, gap/H) = recency weight. gap = sd - cd (>=1).
    return (f"d{H}", f"sum(dd.dep / cn.n * pow(0.5, (dd.sd - nr.cd) / {float(H)})) d{H}")


for MK, (CUR, SYM) in MK_CFG.items():
    va = load(f"verify-action-{MK}.json")
    codes = sorted({co["code"].strip() for co in va["codes"]})
    if not codes:
        print(f"[{MK}] skip — no action codes in this window (thin/recent)"); continue  # empty IN (...) is an error
    pillar_of = {co["code"].strip(): co.get("pillar", "?") for co in va["codes"]}
    inlist = ",".join("'" + x.replace("'", "''") + "'" for x in codes)
    out = {"market": MK, "sym": SYM, "half_life_primary": H_PRIMARY,
           "definition": ("equal-split 1/N across codes claimed within W before each distinct after-deposit-day, "
                          "then each share discounted by 0.5^(gap_days/H); gap>=1 day (strictly after); OBSERVED, no size weighting, no lift"),
           "primary": {}, "sensitivity": {}}

    for W in (7, 30, 90):
        Hs = W_PLAN[W]
        # SAME grain as deposit_afterclaim_split_pull.py, ported to DuckDB over the Parquet stores
        # (validated in reconcile_deposit_timedecay.py). claims/deps/distinct_deps/pairs/cnt = the
        # overlap-free equal-split; `nearest` = nearest preceding claim-DAY per (member, sd, code).
        # deps kept RAW; distinct_deps uses max(dep) (deterministic); inequalities in WHERE.
        ctes = f"""
          WITH claims AS (
            SELECT code, member, CAST(cd AS DATE) cd FROM read_parquet('{CLAIMS}')
            WHERE cur='{CUR}' AND cd>='{START}' AND cd<'{END_EXCL}' AND code IN ({inlist})
          ),
          deps AS (
            SELECT member, CAST(sd AS DATE) sd, dep FROM read_parquet('{STOREB}')
            WHERE cur='{CUR}' AND dep>0 AND member IN (SELECT member FROM claims)
          ),
          distinct_deps AS (   -- each after-deposit-DAY once; max() deterministic across runs (any() is not)
            SELECT cl.member member, d.sd sd, max(d.dep) dep
            FROM claims cl JOIN deps d ON cl.member=d.member
            WHERE d.sd > cl.cd AND d.sd <= cl.cd + INTERVAL {W} DAY GROUP BY cl.member, d.sd
          ),
          pairs AS (   -- distinct (member, deposit-day, code): every code claimed within W before the deposit
            SELECT dd.member member, dd.sd sd, cl.code code
            FROM distinct_deps dd JOIN claims cl ON dd.member=cl.member
            WHERE dd.sd > cl.cd AND dd.sd <= cl.cd + INTERVAL {W} DAY
            GROUP BY dd.member, dd.sd, cl.code
          ),
          cnt AS (SELECT member, sd, count(*) n FROM pairs GROUP BY member, sd),
          nearest AS (   -- NEAREST preceding claim-DAY for each (member, sd, code); range in WHERE
            SELECT p.member member, p.sd sd, p.code code, max(cl.cd) cd
            FROM pairs p JOIN claims cl ON p.member=cl.member AND p.code=cl.code
            WHERE cl.cd < p.sd AND cl.cd >= p.sd - INTERVAL {W} DAY
            GROUP BY p.member, p.sd, p.code
          )
        """

        decay_cols = [col(H)[1] for H in Hs]
        select = ("SELECT nr.code code,\n"
                  "       sum(dd.dep / cn.n) eqs,\n"
                  "       " + ",\n       ".join(decay_cols) + "\n"
                  "FROM nearest nr\n"
                  "JOIN distinct_deps dd ON nr.member=dd.member AND nr.sd=dd.sd\n"
                  "JOIN cnt cn ON nr.member=cn.member AND nr.sd=cn.sd\n"
                  "GROUP BY nr.code")
        rows = duckdb.sql(ctes + "\n" + select).fetchall()

        # independent distinct total (each after-deposit-day counted once) — the reconciliation anchor
        distinct_total = float(duckdb.sql(ctes + "\nSELECT sum(dep) FROM distinct_deps").fetchone()[0] or 0)

        # assemble: per-code eqs + one decayed column per H in Hs
        # rows layout: [code, eqs, d<H0>, d<H1>, ...] in the order of Hs
        for H in Hs:
            idx = 2 + Hs.index(H)
            by_code = {}
            by_pillar = {}
            eq_total = 0.0
            dec_total = 0.0
            for r in rows:
                code = r[0].strip()
                eqs = float(r[1] or 0)
                dec = float(r[idx] or 0)
                by_code[code] = {"equal_split": round(eqs), "decayed": round(dec)}
                eq_total += eqs
                dec_total += dec
                pil = pillar_of.get(code, "?")
                pp = by_pillar.setdefault(pil, {"equal_split": 0.0, "decayed": 0.0})
                pp["equal_split"] += eqs
                pp["decayed"] += dec

            block = {
                "H": H, "W": W,
                "equal_split_total": round(eq_total),
                "decayed_total": round(dec_total),
                "distinct_total": round(distinct_total),
                "eqs_foots_to_distinct": abs(eq_total - distinct_total) <= 50.0,
                "eqs_residual": round(eq_total - distinct_total, 2),
                "decay_discount_pct": round(100.0 * (1.0 - dec_total / eq_total), 2) if eq_total else None,
                "decayed_pct_of_equal_split": round(100.0 * dec_total / eq_total, 2) if eq_total else None,
                "by_pillar": {k: {"equal_split": round(v["equal_split"]), "decayed": round(v["decayed"])}
                              for k, v in sorted(by_pillar.items())},
                "by_code": {k: by_code[k] for k in sorted(by_code)},
            }
            if H == H_PRIMARY:
                out["primary"][str(W)] = block
            if W == 30 and H in (3, 14):
                out["sensitivity"][f"H{H}"] = block

            print(f"[{MK}] H={H:>2} W={W:>2}d  eq-split {SYM}{eq_total:,.0f} (distinct {SYM}{distinct_total:,.0f}"
                  f" foots={block['eqs_foots_to_distinct']}) -> decayed {SYM}{dec_total:,.0f}"
                  f"  ({block['decayed_pct_of_equal_split']}% of eq-split, discount {block['decay_discount_pct']}%)")
            if H == H_PRIMARY and W == 30:
                for pil in sorted(by_pillar):
                    print(f"          - {pil:<12} eq-split {SYM}{by_pillar[pil]['equal_split']:>14,.0f} | "
                          f"decayed {SYM}{by_pillar[pil]['decayed']:>14,.0f}")

    json.dump(out, open(SCR / f"deposit-timedecay-{MK}.json", "w", encoding="utf-8"), ensure_ascii=False)
    print(f"[{MK}] wrote deposit-timedecay-{MK}.json\n")

print("DONE.")

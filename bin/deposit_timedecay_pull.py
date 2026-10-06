#!/usr/bin/env python3
"""Time-decay-ONLY "deposits after claim" — recency-weighted, overlap-free, OBSERVED.

Adapts deposit_afterclaim_split_pull.py (SAME source = Daily_GMT8_Snapshot_A+_BC, day-level).
Inherits its three ClickHouse-gotcha fixes:
  1. inequality conditions live in WHERE, never in the LEFT JOIN ON-clause (see `nearest`),
  2. tuple-IN set-membership tests (N/A here — no prefunded tag needed),
  3. deterministic max(DepositAmount) per member-deposit-day (never any()), so it is wobble-free.

MECHANISM (per the user's LOCKED decision — time-decay only, no bonus-amount weighting, no baseline/lift):
  For each distinct member-deposit-DAY sd within W days AFTER a claim:
    N   = distinct in-scope codes the member claimed within W BEFORE sd (equal-split denominator, = cnt.n)
    for each such code:
      cd   = that code's NEAREST preceding claim-DAY (<= sd, within [sd-W, sd))   (= nearest.cd)
      gap  = dateDiff('day', cd, sd)                                             (>= 1 day; sd strictly > cd)
      contribution = (dep / N) * pow(0.5, gap / H)                              (7-day half-life default)
  Sum contribution per code -> roll up to pillar + total.

So each distinct after-deposit-day is FIRST equal-split 1/N across the codes claimed before it (overlap-free,
foots to the distinct total RM208.5m MY 30d), THEN each share is discounted by that code's own gap-decay.
NO size weighting, NO baseline/lift. OBSERVED only.

Note on the same-day floor: the day-level "after" definition is strictly sd > cd, so the minimum gap is 1 day
(weight 0.5^(1/7) ~= 0.906 at H=7), not 0. Same-snapshot-day deposits are not counted as "after" here.

Primary: H=7 at W=7/30/90. Sensitivity: H=3 and H=14 at W=30.
Also reports the plain EQUAL-SPLIT total (no decay, foots to the distinct total) and the recency-weighted
total as a % of it (the decay discount).

Out: scratchpad/deposit-timedecay-{MK}.json
"""
import sys, json
from pathlib import Path

ROOT = Path(r"C:/Users/vdiuser/Downloads/promo-automation")
sys.path.insert(0, str(ROOT))
from csir_config import get_client, SITE_EDIT, START, END_EXCL

SCR = Path(__import__("os").environ.get("PROMO_SCRATCH", r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad"))
STATUSES = "('Approved','Redeemed','Complete','Active','Completed','Low Balance 1','Low Balance 2')"
MK_CFG = {"MY": ("MYR", "RM"), "SG": ("SGD", "S$")}

H_PRIMARY = 7
# W -> list of half-lives to compute for that window. H=7 across all windows; H=3 & H=14 only at W=30.
W_PLAN = {7: [7], 30: [7, 3, 14], 90: [7]}


def load(p):
    fp = SCR / p
    return json.load(open(fp, encoding="utf-8")) if fp.exists() else None


def col(H):
    """A safe SQL column alias + decay expression for half-life H."""
    # dd.dep / cn.n = equal-split share; pow(0.5, gap/H) = recency weight. gap = sd - cd (>=1).
    return (f"d{H}", f"sum(dd.dep / cn.n * pow(0.5, dateDiff('day', nr.cd, dd.sd) / {float(H)})) d{H}")


c = get_client(send_receive_timeout=900)

for MK, (CUR, SYM) in MK_CFG.items():
    va = load(f"verify-action-{MK}.json")
    codes = sorted({co["code"].strip() for co in va["codes"]})
    if not codes:
        print(f"[{MK}] skip — no action codes in this window (thin/recent)"); continue  # empty IN (...) is a ClickHouse error
    pillar_of = {co["code"].strip(): co.get("pillar", "?") for co in va["codes"]}
    inlist = ",".join("'" + x.replace("'", "''") + "'" for x in codes)
    out = {"market": MK, "sym": SYM, "half_life_primary": H_PRIMARY,
           "definition": ("equal-split 1/N across codes claimed within W before each distinct after-deposit-day, "
                          "then each share discounted by 0.5^(gap_days/H); gap>=1 day (strictly after); OBSERVED, no size weighting, no lift"),
           "primary": {}, "sensitivity": {}}

    for W in (7, 30, 90):
        Hs = W_PLAN[W]
        # CTE block identical in grain to deposit_afterclaim_split_pull.py (equal-split foots to distinct total).
        # claims/deps/distinct_deps/pairs/cnt = the overlap-free equal-split; `nearest` = nearest preceding
        # claim-DAY per (member, sd, code) for the gap. Inequalities are in WHERE (gotcha #1); max(dep) (gotcha #3).
        ctes = f"""
          WITH claims AS (
            SELECT trimBoth(BonusCode) code, MEMBER_ID member, toDate(BonusTime_gmt8) cd
            FROM WORKSPACE.GetBonus_ABC
            WHERE SITE_edit='{SITE_EDIT}' AND Currency='{CUR}' AND BonusAmount>0
              AND trimBoth(BonusCode) IN ({inlist}) AND BonusStatus IN {STATUSES}
              AND toDate(BonusTime_gmt8) >= '{START}' AND toDate(BonusTime_gmt8) < '{END_EXCL}'
          ),
          deps AS (
            SELECT MEMBER_ID member, SnapshotDate sd, DepositAmount dep FROM (
              SELECT MEMBER_ID, SnapshotDate, DepositAmount FROM WORKSPACE.Daily_GMT8_Snapshot_A  WHERE Currency='{CUR}' AND DepositAmount>0
              UNION ALL
              SELECT MEMBER_ID, SnapshotDate, DepositAmount FROM WORKSPACE.Daily_GMT8_Snapshot_BC WHERE Currency='{CUR}' AND DepositAmount>0
            ) WHERE MEMBER_ID IN (SELECT member FROM claims)
          ),
          distinct_deps AS (   -- each after-deposit-DAY once; max() deterministic across runs (any() is not)
            SELECT cl.member member, d.sd sd, max(d.dep) dep
            FROM claims cl INNER JOIN deps d ON cl.member=d.member
            WHERE d.sd > cl.cd AND d.sd <= cl.cd + {W} GROUP BY member, sd
          ),
          pairs AS (   -- distinct (member, deposit-day, code): every code claimed within W before the deposit
            SELECT dd.member member, dd.sd sd, cl.code code
            FROM distinct_deps dd INNER JOIN claims cl ON dd.member=cl.member
            WHERE dd.sd > cl.cd AND dd.sd <= cl.cd + {W}
            GROUP BY member, sd, code
          ),
          cnt AS (SELECT member, sd, count() n FROM pairs GROUP BY member, sd),
          nearest AS (   -- NEAREST preceding claim-DAY for each (member, sd, code); range in WHERE (gotcha #1)
            SELECT p.member member, p.sd sd, p.code code, max(cl.cd) cd
            FROM pairs p INNER JOIN claims cl ON p.member=cl.member AND p.code=cl.code
            WHERE cl.cd < p.sd AND cl.cd >= p.sd - {W}
            GROUP BY member, sd, code
          )
        """

        decay_cols = [col(H)[1] for H in Hs]
        select = ("SELECT nr.code code,\n"
                  "       sum(dd.dep / cn.n) eqs,\n"
                  "       " + ",\n       ".join(decay_cols) + "\n"
                  "FROM nearest nr\n"
                  "INNER JOIN distinct_deps dd ON nr.member=dd.member AND nr.sd=dd.sd\n"
                  "INNER JOIN cnt cn ON nr.member=cn.member AND nr.sd=cn.sd\n"
                  "GROUP BY code")
        rows = c.query(ctes + "\n" + select).result_rows

        # independent distinct total (each after-deposit-day counted once) — the reconciliation anchor
        distinct_total = float(c.query(ctes + "\nSELECT sum(dep) FROM distinct_deps").result_rows[0][0] or 0)

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

#!/usr/bin/env python3
"""STORE-BACKED producer for deposit_afterclaim_split_pull.py — overlap-FREE "Deposit after claim".

Byte-compatible twin of bin/deposit_afterclaim_split_pull.py: SAME post-processing, SAME output JSON
(scratchpad/deposit-afterclaim-split-{MK}.json), but the warehouse query is swapped for the VALIDATED
DuckDB-over-Parquet-stores chain from bin/preagg/reconcile_deposit_afterclaim.py (store_ctes), so the
parallel build engine can run it locally and fast instead of hitting the remote ClickHouse warehouse.

ONLY the data source changed:
  * ClickHouse WORKSPACE.GetBonus_ABC claims  -> store_claims.parquet (build filter SITE_edit=WS1,
    Currency IN (MYR,SGD), BonusAmount>0, BonusStatus IN {...}, date>=2025-11-01 ALREADY applied;
    filter cur + window + codes at read time).
  * ClickHouse Daily_GMT8_Snapshot_A UNION _BC deposits -> store_b.parquet (RAW A-UNION-BC, NOT
    pre-summed; distinct_deps takes max(d.dep) per member-day — the afterclaim shape, NOT the
    equal-split pre-sum shape).
WS1 SITE is constant per market (WS1_MYS_MYR / WS1_SGP_SGD), so the live SITE-join collapses to
member+date and SITE_edit is inlined 'WS1' in the store build — currency is the only market filter.

Everything downstream (distinct_total / construction_B_partition / construction_A_subset / by_code /
by_pillar / raw_bonusled_after_classify / reconciles gate / prints) is IDENTICAL to the original.
The deposit-classify-{MK}.json read (raw_bonusled) is a scratchpad JSON read, NOT a warehouse query,
so it is kept exactly as-is.

Out: scratchpad/deposit-afterclaim-split-{MK}.json
"""
import sys, os, json
from pathlib import Path

ROOT = Path(r"C:/Users/vdiuser/Downloads/promo-automation")
sys.path.insert(0, str(ROOT))
import duckdb
from csir_config import START, END_EXCL

SCR = Path(os.environ.get("PROMO_SCRATCH", r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad"))
STORE = os.environ.get("PROMO_PREAGG",
    r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad/preagg")
CLAIMS = os.path.join(STORE, "store_claims.parquet").replace("\\", "/")
STOREB = os.path.join(STORE, "store_b.parquet").replace("\\", "/")
MK_CFG = {"MY": ("MYR", "RM"), "SG": ("SGD", "S$")}
WINDOWS = (30, 7, 90)  # 30 = primary (reconciliation gate); 7/90 secondary


def load(p):
    fp = SCR / p
    return json.load(open(fp, encoding="utf-8")) if fp.exists() else None


def raw_bonusled(MK, W):
    """Restate the RAW (overlapping) bonus-led after_amt from deposit-classify-{MK}.json for comparison."""
    d = load(f"deposit-classify-{MK}.json")
    if not d:
        return None
    w = d.get("byWindow", {}).get(str(W), {})
    return round(sum(v.get("bonusled", {}).get("after_amt", 0) for v in w.values()))


def store_ctes(CUR, inlist, W):
    """VALIDATED DuckDB-over-stores equivalent of the original ClickHouse CTE chain.

    Copied verbatim from reconcile_deposit_afterclaim.py (store_ctes) — reconciled 0-diff to the live
    warehouse. RAW deps (store_b NOT pre-summed) + max(dep) per member-day is the afterclaim shape.
    CH->DuckDB: toDate->CAST AS DATE; cl.cd+{W}->cl.cd+INTERVAL {W} DAY; if(... IN prefunded)->LEFT
    JOIN prefunded_days + CASE WHEN pf.member IS NOT NULL; count()->count(*); any() not used (max()).
    """
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


for MK, (CUR, SYM) in MK_CFG.items():
    va = load(f"verify-action-{MK}.json")
    codes = sorted({co["code"].strip() for co in va["codes"]})
    if not codes:
        print(f"[{MK}] skip — no action codes in this window (thin/recent)"); continue  # empty IN (...) is an error
    pillar_of = {co["code"].strip(): co.get("pillar", "?") for co in va["codes"]}
    inlist = ",".join("'" + x.replace("'", "''") + "'" for x in codes)
    out = {"market": MK, "sym": SYM, "byWindow": {}}

    for W in WINDOWS:
        # DuckDB-over-stores CTE block (validated store_ctes) in place of the ClickHouse chain.
        # distinct_deps keeps deps RAW + max(dep) (afterclaim shape, NOT the equal-split pre-sum).
        ctes = store_ctes(CUR, inlist, W)

        # (0) independent distinct total = each after-deposit-day counted once
        distinct_total = float(duckdb.sql(ctes + "\nSELECT sum(dep) FROM distinct_deps").fetchone()[0] or 0)

        # (B) PARTITION: split across ALL codes, tag each share. Foots to distinct_total.
        rows_b = duckdb.sql(ctes + """
          SELECT ct.code code, ct.bucket bucket, sum(dd.dep / cn.n) alloc
          FROM claimtag ct
          JOIN distinct_deps dd ON ct.member=dd.member AND ct.sd=dd.sd
          JOIN cnt cn ON ct.member=cn.member AND ct.sd=cn.sd
          GROUP BY ct.code, ct.bucket
        """).fetchall()

        # (A) SUBSET: split each after-deposit-day ONLY among its bonus-led codes.
        rows_a = duckdb.sql(ctes + """
          SELECT ct.code code, sum(dd.dep / cb.nbl) alloc
          FROM claimtag ct
          JOIN distinct_deps dd ON ct.member=dd.member AND ct.sd=dd.sd
          JOIN cnt_bl cb ON ct.member=cb.member AND ct.sd=cb.sd
          WHERE ct.bucket='bonusled'
          GROUP BY ct.code
        """).fetchall()

        # ---- assemble B ----
        b_by_code = {}   # code -> {bonusled, prefunded}
        b_bl = b_pf = 0.0
        b_pillar = {}
        for code, bucket, alloc in rows_b:
            code = code.strip(); alloc = float(alloc or 0)
            b_by_code.setdefault(code, {"bonusled": 0.0, "prefunded": 0.0})
            key = "bonusled" if bucket == "bonusled" else "prefunded"
            b_by_code[code][key] += alloc
            if key == "bonusled":
                b_bl += alloc
            else:
                b_pf += alloc
            pil = pillar_of.get(code, "?")
            pp = b_pillar.setdefault(pil, {"bonusled": 0.0, "prefunded": 0.0})
            pp[key] += alloc

        # ---- assemble A ----
        a_by_code = {}
        a_total = 0.0
        a_pillar = {}
        for code, alloc in rows_a:
            code = code.strip(); alloc = float(alloc or 0)
            a_by_code[code] = a_by_code.get(code, 0.0) + alloc
            a_total += alloc
            pil = pillar_of.get(code, "?")
            a_pillar[pil] = a_pillar.get(pil, 0.0) + alloc

        b_sum = b_bl + b_pf
        reconciles = abs(b_sum - distinct_total) <= 50.0

        out["byWindow"][str(W)] = {
            "distinct_total": round(distinct_total),
            "construction_B_partition": {
                "bonus_led_after": round(b_bl),
                "prefunded_after": round(b_pf),
                "sum": round(b_sum),
                "reconciles": reconciles,
                "residual": round(b_sum - distinct_total, 2),
                "by_pillar": {k: {"bonusled": round(v["bonusled"]), "prefunded": round(v["prefunded"])}
                              for k, v in sorted(b_pillar.items())},
                "by_code": {k: {"bonusled": round(v["bonusled"]), "prefunded": round(v["prefunded"])}
                            for k, v in sorted(b_by_code.items())},
            },
            "construction_A_subset": {
                "bonus_led_after": round(a_total),
                "by_pillar": {k: round(v) for k, v in sorted(a_pillar.items())},
                "by_code": {k: round(v) for k, v in sorted(a_by_code.items())},
            },
            "raw_bonusled_after_classify": raw_bonusled(MK, W),
        }

        print(f"[{MK}] W={W:>2}d  distinct={SYM}{distinct_total:,.0f}")
        print(f"        B partition: bonus-led {SYM}{b_bl:,.0f} + pre-funded {SYM}{b_pf:,.0f} = {SYM}{b_sum:,.0f}"
              f"  reconciles={reconciles} (residual {b_sum-distinct_total:+.2f})")
        print(f"        A subset   : bonus-led {SYM}{a_total:,.0f}  (raw classify {SYM}{raw_bonusled(MK,W) or 0:,.0f})")
        for pil in sorted(b_pillar):
            print(f"          - {pil:<12} B bonus-led {SYM}{b_pillar[pil]['bonusled']:>13,.0f} | "
                  f"pre-funded {SYM}{b_pillar[pil]['prefunded']:>13,.0f} | A bonus-led {SYM}{a_pillar.get(pil,0):>13,.0f}")

    json.dump(out, open(SCR / f"deposit-afterclaim-split-{MK}.json", "w", encoding="utf-8"), ensure_ascii=False)
    print(f"[{MK}] wrote deposit-afterclaim-split-{MK}.json\n")

print("DONE.")

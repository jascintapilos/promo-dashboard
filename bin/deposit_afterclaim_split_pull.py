#!/usr/bin/env python3
"""Overlap-FREE "Deposit after claim" — offer-first consequent deposits, de-overlapped across codes.

Adapts deposit_alloc_bycode_pull.py (SAME source = Daily_GMT8_Snapshot_A+_BC, day-level, equal-split)
so everything is internally consistent and FOOTS to the distinct deposits-after total (RM208.5m MY 30d).

For each distinct member-deposit-DAY (sd) within W days AFTER a claim, the day's deposit is split
equally across the codes the member claimed in W BEFORE it. We TAG each (member, sd, code) share by
whether that code's NEAREST preceding claim-day (cd) was:
  - BONUS-LED : member had NO Daily-snapshot deposit in [cd-W, cd)   (offer came first)
  - PRE-FUNDED: member HAD a Daily-snapshot deposit in [cd-W, cd)     (money already coming in)

TWO constructions:
  B (PARTITION): existing equal-split unchanged (split across ALL codes) → each share tagged.
                 bonus_led_after(B) + prefunded_after(B) == distinct_total  (FOOTS to RM208m).
  A (SUBSET)   : each after-deposit-day split equally ONLY among its BONUS-LED codes (exclude
                 pre-funded). Standalone overlap-free total of "deposits following offer-first
                 claims". Does NOT foot to RM208m; it is a clean de-overlap of the raw RM7.4m.

RECONCILIATION GATE: B bonus_led + prefunded == distinct_total (±RM50). If not, the pull is wrong.

Out: scratchpad/deposit-afterclaim-split-{MK}.json
"""
import sys, json
from pathlib import Path

ROOT = Path(r"C:/Users/vdiuser/Downloads/promo-automation")
sys.path.insert(0, str(ROOT))
from csir_config import get_client, SITE_EDIT, START, END_EXCL

SCR = Path(__import__("os").environ.get("PROMO_SCRATCH", r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad"))
STATUSES = "('Approved','Redeemed','Complete','Active','Completed','Low Balance 1','Low Balance 2')"
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


c = get_client(send_receive_timeout=900)

for MK, (CUR, SYM) in MK_CFG.items():
    va = load(f"verify-action-{MK}.json")
    codes = sorted({co["code"].strip() for co in va["codes"]})
    if not codes:
        print(f"[{MK}] skip — no action codes in this window (thin/recent)"); continue  # empty IN (...) is a ClickHouse error
    pillar_of = {co["code"].strip(): co.get("pillar", "?") for co in va["codes"]}
    inlist = ",".join("'" + x.replace("'", "''") + "'" for x in codes)
    out = {"market": MK, "sym": SYM, "byWindow": {}}

    for W in WINDOWS:
        # Common CTE block: claims / deps / distinct_deps / pairs / cnt are IDENTICAL to
        # deposit_alloc_bycode_pull.py (so the equal-split foots to the distinct total).
        # nearest / claimtag / cnt_bl add the bonus-led vs pre-funded tag, day-level, same deps.
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
          distinct_deps AS (   -- each after-deposit-DAY once; max() is deterministic across runs (any() is not)
            SELECT cl.member member, d.sd sd, max(d.dep) dep
            FROM claims cl INNER JOIN deps d ON cl.member=d.member
            WHERE d.sd > cl.cd AND d.sd <= cl.cd + {W} GROUP BY member, sd
          ),
          pairs AS (   -- distinct (member, deposit-day, code): every code claimed within W before the deposit
            SELECT dd.member member, dd.sd sd, cl.code code
            FROM distinct_deps dd INNER JOIN claims cl
              ON dd.member=cl.member
            WHERE dd.sd > cl.cd AND dd.sd <= cl.cd + {W}
            GROUP BY member, sd, code
          ),
          cnt AS (SELECT member, sd, count() n FROM pairs GROUP BY member, sd),
          prefunded_days AS (   -- (member, claim-day) that HAD a Daily-snapshot deposit in [cd-W, cd)
            SELECT cl.member member, cl.cd cd
            FROM claims cl INNER JOIN deps d ON cl.member=d.member
            WHERE d.sd >= cl.cd - {W} AND d.sd < cl.cd
            GROUP BY member, cd
          ),
          nearest AS (   -- NEAREST preceding claim-day for each (member, sd, code); range in WHERE (proven pattern)
            SELECT p.member member, p.sd sd, p.code code, max(cl.cd) cd
            FROM pairs p INNER JOIN claims cl ON p.member=cl.member AND p.code=cl.code
            WHERE cl.cd < p.sd AND cl.cd >= p.sd - {W}
            GROUP BY member, sd, code
          ),
          claimtag AS (  -- bonus-led if the nearest preceding claim-day was NOT pre-funded
            SELECT member, sd, code,
                   if((member, cd) IN (SELECT member, cd FROM prefunded_days), 'prefunded', 'bonusled') bucket
            FROM nearest
          ),
          cnt_bl AS (SELECT member, sd, count() nbl FROM claimtag WHERE bucket='bonusled' GROUP BY member, sd)
        """

        # (0) independent distinct total = each after-deposit-day counted once
        distinct_total = float(c.query(ctes + "\nSELECT sum(dep) FROM distinct_deps").result_rows[0][0] or 0)

        # (B) PARTITION: split across ALL codes, tag each share. Foots to distinct_total.
        rows_b = c.query(ctes + """
          SELECT ct.code code, ct.bucket bucket, sum(dd.dep / cn.n) alloc
          FROM claimtag ct
          INNER JOIN distinct_deps dd ON ct.member=dd.member AND ct.sd=dd.sd
          INNER JOIN cnt cn ON ct.member=cn.member AND ct.sd=cn.sd
          GROUP BY code, bucket
        """).result_rows

        # (A) SUBSET: split each after-deposit-day ONLY among its bonus-led codes.
        rows_a = c.query(ctes + """
          SELECT ct.code code, sum(dd.dep / cb.nbl) alloc
          FROM claimtag ct
          INNER JOIN distinct_deps dd ON ct.member=dd.member AND ct.sd=dd.sd
          INNER JOIN cnt_bl cb ON ct.member=cb.member AND ct.sd=cb.sd
          WHERE ct.bucket='bonusled'
          GROUP BY code
        """).result_rows

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

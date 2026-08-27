"""PVC Performance Analysis — 3 queries in one pass:
   1. Per-code claim rate + cost + FTD (for D-004 pilot shortlist)
   2. Cap-audit: bonus paid vs cap distribution (for D-003 governance)
   3. Deposit-lift attribution prototype (for D-006 NGR unblock)

Scope: WS1_MYS_MYR (largest market, richest data).
"""

from __future__ import annotations

import json
from pathlib import Path
import sys

# CSIR endpoint, credentials and client all come from csir_config.py at the repo root.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import csir_config


OUT = Path(__file__).parent.parent / "outputs" / "pvc-csir-probe"


def get_client():
    return csir_config.get_client(send_receive_timeout=300)


def q(c, sql):
    return c.query(sql).result_rows, c.query(sql).column_names


def main():
    c = get_client()

    # -----------------------------------------------------------------
    # 1. Per-code claim rate + cost + members
    # -----------------------------------------------------------------
    print("=" * 70)
    print("1. PER-CODE PERFORMANCE (WS1_MYS_MYR)")
    print("=" * 70)
    perf_sql = """
    WITH prom_reward AS (
        SELECT
            p.PromotionId, p.PromotionCode, p.PromotionName, p.PromotionType,
            p.IsActive, p.PromotionStartDate, p.PromotionEndDate,
            r.RewardId, r.CapBonusAmount, r.BonusPercentage, r.RolloverMultiplier
        FROM WORKSPACE.`260722_ws1_myr_Promotion` p
        LEFT JOIN WORKSPACE.`260722_ws1_myr_PromotionReward` r ON r.PromotionId = p.PromotionId
    ),
    assigned AS (
        SELECT toString(RewardId) AS reward_id_s,
               count() AS assignments,
               uniq(MEMBER_ID) AS uniq_assigned_members
        FROM WORKSPACE.dedup_PlayerAssignedReward_A
        WHERE SITE = 'WS1_MYS_MYR' AND TIME >= '2026-01-01'
        GROUP BY reward_id_s
    ),
    claimed AS (
        SELECT toString(g.RewardId) AS reward_id_s,
               count() AS claim_events,
               uniq(g.MEMBER_ID) AS uniq_claim_members,
               sum(g.BonusAmount) AS total_bonus_paid,
               avg(g.BonusAmount) AS avg_bonus_paid,
               max(g.BonusAmount) AS max_bonus_paid,
               min(g.BonusAmount) AS min_bonus_paid
        FROM ENIGMA.GetDepositBonus_A g
        WHERE g.SITE = 'WS1_MYS_MYR' AND g.TIME >= '2026-01-01'
        GROUP BY reward_id_s
    )
    SELECT
        pr.PromotionCode, pr.PromotionName,
        pr.PromotionType, pr.IsActive,
        toDate(pr.PromotionStartDate) AS start_dt,
        pr.CapBonusAmount AS cap,
        pr.BonusPercentage AS pct,
        pr.RolloverMultiplier AS TO_x,
        a.assignments,
        a.uniq_assigned_members,
        c.claim_events,
        c.uniq_claim_members,
        if(a.uniq_assigned_members > 0, round(c.uniq_claim_members / a.uniq_assigned_members * 100, 2), 0) AS claim_rate_pct,
        round(c.total_bonus_paid, 0) AS total_paid,
        round(c.avg_bonus_paid, 2) AS avg_paid,
        round(c.max_bonus_paid, 0) AS max_paid
    FROM prom_reward pr
    LEFT JOIN assigned a ON a.reward_id_s = toString(pr.RewardId)
    LEFT JOIN claimed c ON c.reward_id_s = toString(pr.RewardId)
    WHERE a.assignments > 0 OR c.claim_events > 0
    ORDER BY c.total_bonus_paid DESC NULLS LAST
    LIMIT 300
    """
    rows, cols = q(c, perf_sql)
    print(f"\nRows: {len(rows)} codes with 2026-YTD activity\n")
    print(f"{'Code':<40} {'Assigned':>10} {'Claimed':>10} {'Rate%':>7} {'TotalRM':>12} {'AvgRM':>8} {'Cap':>7}")
    print("-" * 105)
    perf = []
    for r in rows[:60]:
        rec = dict(zip(cols, r))
        perf.append(rec)
        code = (rec['PromotionCode'] or '')[:38]
        print(f"{code:<40} {rec['assignments'] or 0:>10} {rec['claim_events'] or 0:>10} {rec['claim_rate_pct'] or 0:>7} {int(rec['total_paid'] or 0):>12,} {rec['avg_paid'] or 0:>8.2f} {int(rec['cap'] or 0):>7}")

    # Save
    OUT.mkdir(parents=True, exist_ok=True)
    all_perf = [dict(zip(cols, r)) for r in rows]
    (OUT / 'code-performance-my.json').write_text(json.dumps(all_perf, indent=2, default=str), encoding='utf-8')

    # -----------------------------------------------------------------
    # 2. Cap-audit (bonus paid vs cap distribution)
    # -----------------------------------------------------------------
    print("\n" + "=" * 70)
    print("2. CAP-AUDIT (bonus paid distribution vs cap)")
    print("=" * 70)
    cap_sql = """
    WITH prom_reward AS (
        SELECT p.PromotionCode, r.RewardId, r.CapBonusAmount AS cap
        FROM WORKSPACE.`260722_ws1_myr_Promotion` p
        JOIN WORKSPACE.`260722_ws1_myr_PromotionReward` r ON r.PromotionId = p.PromotionId
        WHERE r.CapBonusAmount > 0
    )
    SELECT
        pr.PromotionCode,
        pr.cap,
        count() AS claims,
        countIf(g.BonusAmount >= pr.cap * 0.95) AS at_or_near_cap,
        countIf(g.BonusAmount < pr.cap * 0.5) AS below_half_cap,
        round(avg(g.BonusAmount / pr.cap) * 100, 1) AS avg_utilization_pct,
        round(sum(g.BonusAmount), 0) AS total_paid
    FROM prom_reward pr
    JOIN ENIGMA.GetDepositBonus_A g ON toString(g.RewardId) = toString(pr.RewardId)
    WHERE g.SITE = 'WS1_MYS_MYR' AND g.TIME >= '2026-01-01'
    GROUP BY pr.PromotionCode, pr.cap
    HAVING claims >= 5
    ORDER BY total_paid DESC
    LIMIT 40
    """
    rows, cols = q(c, cap_sql)
    print(f"\n{'Code':<40} {'Cap':>7} {'Claims':>7} {'@cap%':>7} {'<50%':>6} {'AvgUtil%':>9} {'Total':>10}")
    print("-" * 92)
    cap_audit = []
    for r in rows:
        rec = dict(zip(cols, r))
        cap_audit.append(rec)
        code = (rec['PromotionCode'] or '')[:38]
        at_cap_pct = round((rec['at_or_near_cap'] or 0) / max(rec['claims'], 1) * 100)
        below_half = rec['below_half_cap'] or 0
        below_half_pct = round(below_half / max(rec['claims'], 1) * 100)
        print(f"{code:<40} {int(rec['cap']):>7} {rec['claims']:>7} {at_cap_pct:>6}% {below_half_pct:>5}% {rec['avg_utilization_pct']:>9} {int(rec['total_paid']):>10,}")
    (OUT / 'cap-audit-my.json').write_text(json.dumps(cap_audit, indent=2, default=str), encoding='utf-8')

    # -----------------------------------------------------------------
    # 3. Deposit-lift attribution prototype
    # -----------------------------------------------------------------
    print("\n" + "=" * 70)
    print("3. DEPOSIT-LIFT ATTRIBUTION PROTOTYPE")
    print("=" * 70)
    # For top-20 codes by claim volume, compute: avg deposit in [claim, claim+30d] vs [claim-30d, claim] per claimant
    lift_sql = """
    WITH top_claimed AS (
        SELECT toString(pr.RewardId) AS reward_id_s, p.PromotionCode
        FROM WORKSPACE.`260722_ws1_myr_Promotion` p
        JOIN WORKSPACE.`260722_ws1_myr_PromotionReward` pr ON pr.PromotionId = p.PromotionId
    ),
    claims AS (
        SELECT g.MEMBER_ID, g.TIME AS claim_time, toString(g.RewardId) AS reward_id_s
        FROM ENIGMA.GetDepositBonus_A g
        WHERE g.SITE = 'WS1_MYS_MYR' AND g.TIME >= '2026-01-01' AND g.TIME < '2026-07-01'
    ),
    joined AS (
        SELECT c.PromotionCode, cl.MEMBER_ID, cl.claim_time
        FROM claims cl
        JOIN top_claimed c USING (reward_id_s)
    ),
    -- compute pre and post deposit sums per (code, member, claim_time)
    lifts AS (
        SELECT
            j.PromotionCode,
            j.MEMBER_ID,
            j.claim_time,
            sumIf(d.PostProcessAmount, d.TIME BETWEEN j.claim_time AND j.claim_time + INTERVAL 30 DAY) AS post30_dep,
            sumIf(d.PostProcessAmount, d.TIME BETWEEN j.claim_time - INTERVAL 30 DAY AND j.claim_time) AS pre30_dep
        FROM joined j
        LEFT JOIN WORKSPACE.dedup_Deposit_A d
          ON d.MEMBER_ID = j.MEMBER_ID AND d.SITE = 'WS1_MYS_MYR'
        WHERE d.TransactionStatus IN ('Success','Approved','Completed') OR d.TransactionStatus = ''
        GROUP BY j.PromotionCode, j.MEMBER_ID, j.claim_time
    )
    SELECT
        PromotionCode,
        count() AS claim_windows,
        uniq(MEMBER_ID) AS uniq_claimants,
        round(avg(post30_dep), 0) AS avg_post30d_dep,
        round(avg(pre30_dep), 0) AS avg_pre30d_dep,
        round(avg(post30_dep - pre30_dep), 0) AS avg_lift,
        round(avgIf(post30_dep - pre30_dep, pre30_dep > 0), 0) AS avg_lift_active,
        round(avgIf(post30_dep, pre30_dep = 0), 0) AS avg_post30_reactivations
    FROM lifts
    GROUP BY PromotionCode
    HAVING claim_windows >= 20
    ORDER BY claim_windows DESC
    LIMIT 30
    """
    rows, cols = q(c, lift_sql)
    print(f"\n{'Code':<38} {'Claims':>7} {'Members':>8} {'PostDep':>9} {'PreDep':>8} {'Lift':>8} {'ReactDep':>9}")
    print("-" * 96)
    attr = []
    for r in rows:
        rec = dict(zip(cols, r))
        attr.append(rec)
        code = (rec['PromotionCode'] or '')[:36]
        def sn(v):
            try:
                if v is None: return 0
                v = float(v)
                if v != v: return 0  # NaN
                return int(v)
            except Exception: return 0
        print(f"{code:<38} {rec['claim_windows']:>7} {rec['uniq_claimants']:>8} {sn(rec['avg_post30d_dep']):>9,} {sn(rec['avg_pre30d_dep']):>8,} {sn(rec['avg_lift']):>8,} {sn(rec['avg_post30_reactivations']):>9,}")

    (OUT / 'deposit-lift-attribution-my.json').write_text(json.dumps(attr, indent=2, default=str), encoding='utf-8')
    print(f"\nAll outputs saved to {OUT}/")


if __name__ == "__main__":
    main()

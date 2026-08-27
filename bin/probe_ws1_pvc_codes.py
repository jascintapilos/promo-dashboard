"""Enrich 41 WS1 codes with execution + config evidence from CSIR."""

from __future__ import annotations

import json
import sys
from pathlib import Path

# CSIR endpoint, credentials and client all come from csir_config.py at the repo root.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import csir_config


CODES_TSM = [
    "FT_WELC_88FS_GOO", "FT_WELC_188FS_GOO", "FT_WELC_288FS_GOO",
    "FT_CASINO_50%_WB", "FT_WEL_SLOTS_120PCT",
    "QPRO3_159FS_XSELL_250325", "QPRO3_259FS_XSELL_250325",
    "QPRO3_299FS_XSELL_250325", "QPRO3_339FS_XSELL_250325",
    "QPRO3_XSELL_GOO_350FS", "QPRO3_XSELL_HIGH_BONUS1_250325",
    "QPRO3_XSELL_HIGH_BONUS4_250325", "QPRO3_XSELL_MED_BONUS1_250325",
    "FT_PP_108FS_DEP50_A", "FT_PP_128FS_FREE_A", "FT_PP_168FS_DEP80_B",
    "FT_PP_208FS_DEP100_C", "FT_PP_208FS_FREE_B", "FT_PP_258FS_FREE_C",
    "ACQ_TSM_WELC_108FS_FBGW_8X_V2", "ACQ_TSM_WELC_168FS_FBGW_8X",
    "ACQ_TSM_WELC_208FS_FBGW_8X", "ACQ_TSM_WELC_NODEP_128FS_MHLG_15X",
    "ACQ_TSM_WELC_NODEP_208FS_MHLG_15X", "ACQ_TSM_WELC_NODEP_258FS_MHLG_15X",
    "FT_FC50_MAX50_15X", "88FS_CROSS_FREE_SET-AA",
    "REL_199FS_GOO_CROSS_070525", "REL_299FS_GOO_CROSS_070525",
    "ACQ_TSM_REL_199FS_MHLG_5X",
]

CODES_AM_GAP = [
    "VM_DM_100_30_5X_14D", "VM_DM_100_50_2X_14D", "VM_DM_150_50_5X_14D",
    "VM_DM_200_100_2X_7D", "VM_DM_700_350_2X_14D", "VM_DM_1000_300_5X_14D",
    "VM_DM_1500_750_1X_14D", "VM_DM_2000_1000_2X_14D",
    "VM_FC_50_5X_14D", "VM_FC_188_5X_14D", "VM_FC_388_5X_14D",
]

ALL_CODES = CODES_TSM + CODES_AM_GAP
OUT_DIR = Path(__file__).parent.parent / "outputs" / "pvc-csir-probe"


def get_client():
    return csir_config.get_client(send_receive_timeout=120)


def q(client, sql):
    try:
        res = client.query(sql)
        return res.column_names, res.result_rows
    except Exception as e:
        return None, str(e)[:200]


def main():
    client = get_client()
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # 1. Look for ALL currency-partitioned promo snapshots (MYR/SGD/IDR/THB/KHR)
    print("=" * 70)
    print("STEP 1: All WS1 promotion snapshots by currency")
    print("=" * 70)
    _, rows = q(client, """
        SELECT database, name FROM system.tables
        WHERE database='WORKSPACE' AND lower(name) LIKE '%ws1%'
        ORDER BY name
    """)
    for r in rows:
        print(f"  {r[0]}.{r[1]}")

    # Also check for _sgd, _idr, _thb, _khr
    print("\nCurrency-specific snapshots (sgd/idr/thb/khr):")
    _, rows = q(client, """
        SELECT database, name FROM system.tables
        WHERE (lower(name) LIKE '%sgd_promotion%'
               OR lower(name) LIKE '%idr_promotion%'
               OR lower(name) LIKE '%thb_promotion%'
               OR lower(name) LIKE '%khr_promotion%'
               OR lower(name) LIKE '%sgd_campaign%'
               OR lower(name) LIKE '%idr_campaign%')
        ORDER BY database, name
    """)
    for r in rows:
        print(f"  {r[0]}.{r[1]}")

    # 2. Full match with reward config joined
    print("\n" + "=" * 70)
    print("STEP 2: Match 41 codes vs WS1 MYR — full config + reward join")
    print("=" * 70)
    codes_list = "', '".join(c.replace("'", "''") for c in ALL_CODES)
    sql = f"""
    SELECT
        p.PromotionCode,
        p.PromotionId,
        p.PromotionName,
        p.PromotionType,
        p.IsActive,
        p.IsDeleted,
        toDate(p.PromotionStartDate) AS start_date,
        toDate(p.PromotionEndDate) AS end_date,
        r.RewardId,
        r.RewardName,
        r.RewardType,
        r.BonusPercentage,
        r.MinimumActionAmount AS min_dep,
        r.CapBonusAmount AS max_bonus_cap,
        r.RolloverMultiplier AS TO_multiplier,
        r.FixedBonusAmount AS fixed_bonus,
        r.RedemptionType,
        r.DepositRequirement
    FROM WORKSPACE.`260722_ws1_myr_Promotion` p
    LEFT JOIN WORKSPACE.`260722_ws1_myr_PromotionReward` r ON r.PromotionId = p.PromotionId
    WHERE p.PromotionCode IN ('{codes_list}')
    ORDER BY p.PromotionCode
    """
    cols, rows = q(client, sql)
    print(f"\n{len(rows)} rows returned:\n")
    for r in rows:
        print(f"  {r[0]}")
        print(f"    id={r[1]} type={r[3]} active={r[4]} deleted={r[5]} start={r[6]} end={r[7]}")
        print(f"    reward={r[8]} name={r[9]} rtype={r[10]} pct={r[11]}% min_dep={r[12]} cap={r[13]} TO={r[14]}x fixed={r[15]}")

    # Save raw JSON for later use
    result = {"columns": cols, "rows": [list(map(str, r)) for r in rows]}
    (OUT_DIR / "ws1-myr-matches.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(f"\nSaved to {OUT_DIR}/ws1-myr-matches.json")

    # 3. Which codes were NOT found in WS1 MYR?
    matched_codes = {r[0] for r in rows}
    not_matched = [c for c in ALL_CODES if c not in matched_codes]
    print(f"\n{len(not_matched)} codes NOT found in WS1 MYR snapshot:")
    for c in not_matched:
        print(f"  MISS  {c}")

    # 4. Check execution data (WS1_V3_Campaign) — what does ID reference?
    print("\n" + "=" * 70)
    print("STEP 3: WS1_V3_Campaign sample by SITE partition")
    print("=" * 70)
    _, rows = q(client, """
        SELECT SITE, count() AS rows, uniq(ID) AS unique_ids, uniq(MEMBER_ID) AS unique_members
        FROM WORKSPACE.WS1_V3_Campaign GROUP BY SITE ORDER BY rows DESC
    """)
    for r in rows:
        print(f"  {r[0]:20} rows={r[1]:>10} unique_ids={r[2]:>6} members={r[3]:>6}")


if __name__ == "__main__":
    main()

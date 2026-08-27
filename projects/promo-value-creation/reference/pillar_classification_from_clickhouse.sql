-- ============================================================================
-- ⚠️ DEPRECATED (2026-08) — DO NOT RUN. Superseded by pillar_classification.sql
-- (self-contained, framework-correct). This file still carries the OLD
-- "VM/AM = VIP" business rule and pre-correction map corrections, which the
-- [Pillar_Team_Objective] framework reverses (pillar = objective; VM/AM are
-- teams; gamification/festive = Retention; Branding = production spend).
-- Kept only for historical reference. Use pillar_classification.sql instead.
-- ============================================================================
-- WS1 Pillar Classification — from ClickHouse (proper, join-based)
-- ============================================================================
-- Decides each claimed WS1 code's pillar by JOINING to the pillar table already
-- in ClickHouse (WORKSPACE.ws1_pillar_code_map), instead of guessing from names.
--
-- IMPORTANT: ws1_pillar_code_map is NOT ground truth. It is a stored name-based
-- classification that still contains known mislabels (verified 2026-08): e.g.
-- FT_PP_*FS tagged VIP (really TSM acquisition free spins); VM deposit-match
-- reloads tagged VIP; angpow/minigame giveaways tagged Retention; CRM_ACQ_REL
-- reloads tagged Acq. The corrections CTE layers the adversarially-verified
-- fixes on top, so this query returns the CORRECTED pillar.
--
-- BEST FIX (needs write access this read-only connection lacks): the owner of
-- ws1_pillar_code_map merges these corrections INTO the table; then the CTE is
-- unnecessary and every report agrees.
-- ============================================================================

WITH
corrections AS (
    SELECT 'EZUGI_ANGPAO_GIVEAWAY_FC230' AS BonusCode, 'Branding' AS Pillar
    UNION ALL SELECT 'EZUGI_ANGPAO_GIVEAWAY_FC30', 'Branding'
    UNION ALL SELECT 'EZUGI_ANGPAO_GIVEAWAY_FC450', 'Branding'
    UNION ALL SELECT 'EZUGI_ANGPAO_GIVEAWAY_FC74', 'Branding'
    UNION ALL SELECT 'EZUGI_ANGPAO_GIVEAWAY_FC89', 'Branding'
    UNION ALL SELECT 'EZUGI_ANGPAO_GIVEAWAY_FC90', 'Branding'
    UNION ALL SELECT 'FC_KYC_30', 'Retention'
    UNION ALL SELECT 'FC_MEMBERSHIP_DIAMOND', 'VIP'
    UNION ALL SELECT 'FC_MEMBERSHIP_GOLD', 'VIP'
    UNION ALL SELECT 'FC_MEMBERSHIP_SILVER', 'VIP'
    UNION ALL SELECT 'FC_minigames_RM188', 'Branding'
    UNION ALL SELECT 'FC_minigames_RM88', 'Branding'
    UNION ALL SELECT 'FC_minigames_SGD8_1', 'Branding'
    UNION ALL SELECT 'FT_3DAY_NODEP_188FS', 'Retention'
    UNION ALL SELECT 'FT_3DAY_NODEP_388FS', 'Retention'
    UNION ALL SELECT 'FT_88 Free Spins Bonus - Platinum/Diamond', 'Retention'
    UNION ALL SELECT 'FT_CASINO_50%_WB', 'Retention'
    UNION ALL SELECT 'FT_CRM_ACQ_REL_COMEBACK_BONUS_20PCT_5X', 'Retention'
    UNION ALL SELECT 'FT_CRM_ACQ_REL_COMEBACK_BONUS_30FS_5X', 'Retention'
    UNION ALL SELECT 'FT_CRM_ACQ_REL_COMEBACK_BONUS_50FS_5X', 'Retention'
    UNION ALL SELECT 'FT_CRM_ACQ_REL_COMEBACK_BONUS_50PCT_7X', 'Retention'
    UNION ALL SELECT 'FT_CRM_ACQ_REL_LC_25PCT_DC1toDC2', 'Retention'
    UNION ALL SELECT 'FT_CRM_ACQ_REL_LC_40PCT_DC1toDC2', 'Retention'
    UNION ALL SELECT 'FT_CRM_ACQ_REL_POWERUP_BONUS_188FS_5X', 'Retention'
    UNION ALL SELECT 'FT_CRM_ACQ_REL_POWERUP_BONUS_288FS_5X', 'Retention'
    UNION ALL SELECT 'FT_CRM_ACQ_REL_SLOTS_25PCT_DC1toDC2', 'Retention'
    UNION ALL SELECT 'FT_CRM_ACQ_REL_SLOTS_40PCT_DC1toDC2', 'Retention'
    UNION ALL SELECT 'FT_CRM_ACQ_REL_SPORTS_40PCT_DC1toDC2', 'Retention'
    UNION ALL SELECT 'FT_FC100_1X', 'Branding'
    UNION ALL SELECT 'FT_FC200_1X', 'Branding'
    UNION ALL SELECT 'FT_FC300_1X', 'Branding'
    UNION ALL SELECT 'FT_HIGHVALUE_NODEP_299FS', 'Retention'
    UNION ALL SELECT 'FT_LOWVALUE_NODEP_180FS', 'Retention'
    UNION ALL SELECT 'FT_MIDVALUE_NODEP_250FS', 'Retention'
    UNION ALL SELECT 'FT_MIGRATION_NODEP_180FS', 'Retention'
    UNION ALL SELECT 'FT_PP_108FS_DEP50_A', 'Acq'
    UNION ALL SELECT 'FT_PP_128FS_FREE_A', 'Acq'
    UNION ALL SELECT 'FT_PP_208FS_DEP100_C', 'Acq'
    UNION ALL SELECT 'FT_PP_258FS_FREE_C', 'Acq'
    UNION ALL SELECT 'FT_REL_98FS_CBS_5X', 'Branding'
    UNION ALL SELECT 'FT_REL_98FS_SC_5X', 'Branding'
    UNION ALL SELECT 'FT_VMFS_GOO_138', 'VIP'
    UNION ALL SELECT 'FT_VMFS_GOO_148', 'VIP'
    UNION ALL SELECT 'FT_VMFS_GOO_158', 'VIP'
    UNION ALL SELECT 'FT_VMFS_GOO_168', 'VIP'
    UNION ALL SELECT 'FT_VMFS_GOO_178', 'VIP'
    UNION ALL SELECT 'FT_VMFS_GOO_188', 'VIP'
    UNION ALL SELECT 'FT_VMFS_GOO_198', 'VIP'
    UNION ALL SELECT 'FT_VM_REL100PCT_X1', 'VIP'
    UNION ALL SELECT 'FT_WC26_DEP_30PCT_2K_PLTDMD', 'Retention'
    UNION ALL SELECT 'FT_WC26_FB_100_GLD', 'Retention'
    UNION ALL SELECT 'FT_WC26_FB_160_PLT', 'Retention'
    UNION ALL SELECT 'FT_WC26_FB_250_DMD', 'Retention'
    UNION ALL SELECT 'FT_WEL_200FS_GOO', 'Acq'
    UNION ALL SELECT 'Sportsbook_First_Bet_Tier_3', 'Retention'
    UNION ALL SELECT 'WELC_VIPMIGRATION_22X', 'VIP'

),
-- one pillar per (currency, code): the map carries many BonusName variants per code
pmap AS (
    SELECT Currency, trimBoth(BonusCode) AS bc, any(Pillar) AS Pillar
    FROM WORKSPACE.ws1_pillar_code_map
    GROUP BY Currency, bc
),
raw AS (
    SELECT Currency, BonusCode, if(BonusName='','Undefined',BonusName) AS BonusName,
           count() AS claims, sum(BonusAmount) AS bonus_cost
    FROM WORKSPACE.GetBonus_ABC
    WHERE SITE_edit='WS1' AND Currency IN ('MYR','SGD')
      AND BonusTime_gmt8 >= toDateTime('2026-01-01 00:00:00')
      AND BonusTime_gmt8 <  toDateTime('2026-08-10 00:00:00')
      AND BonusStatus IN ('Approved','Redeemed','Complete','Active','Completed','Low Balance 1','Low Balance 2')
      AND BonusAmount > 0
    GROUP BY Currency, BonusCode, BonusName
)
SELECT
    r.Currency AS Currency,
    trimBoth(r.BonusCode) AS BonusCode,
    r.BonusName AS BonusName,
    multiIf(
        -- Business rule: VM + AM (VIP-management teams) = VIP pillar, ANY such code
        hasAny(splitByChar('_', replaceRegexpOne(upper(trimBoth(r.BonusCode)),'^FT_','')), ['VM','AM'])
          OR position(upper(r.BonusCode),'VMFC') > 0 OR position(upper(r.BonusCode),'VMFS') > 0
          OR position(upper(r.BonusCode),'AMFC') > 0 OR position(upper(r.BonusCode),'AMFS') > 0
          OR position(upper(r.BonusCode),'_VM_') > 0 OR position(upper(r.BonusCode),'_AM_') > 0
          OR startsWith(upper(trimBoth(r.BonusCode)),'VM_') OR startsWith(upper(trimBoth(r.BonusCode)),'AM_'), 'VIP',
        c.Pillar != '', c.Pillar,
        m.Pillar != '', m.Pillar,
        'REVIEW — not in pillar map'
    ) AS Pillar,
    multiIf(
        hasAny(splitByChar('_', replaceRegexpOne(upper(trimBoth(r.BonusCode)),'^FT_','')), ['VM','AM'])
          OR position(upper(r.BonusCode),'VMFC') > 0 OR position(upper(r.BonusCode),'VMFS') > 0
          OR position(upper(r.BonusCode),'AMFC') > 0 OR position(upper(r.BonusCode),'AMFS') > 0
          OR position(upper(r.BonusCode),'_VM_') > 0 OR position(upper(r.BonusCode),'_AM_') > 0
          OR startsWith(upper(trimBoth(r.BonusCode)),'VM_') OR startsWith(upper(trimBoth(r.BonusCode)),'AM_'), 'business rule: VM/AM = VIP',
        c.Pillar != '', 'verified correction',
        m.Pillar != '', 'ws1_pillar_code_map (ClickHouse)',
        'unmapped') AS pillar_source,
    r.claims, r.bonus_cost
FROM raw r
LEFT JOIN corrections c ON trimBoth(r.BonusCode) = c.BonusCode
LEFT JOIN pmap m ON trimBoth(r.BonusCode) = m.bc AND r.Currency = m.Currency
ORDER BY Pillar, r.bonus_cost DESC;

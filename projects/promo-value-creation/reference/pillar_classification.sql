-- ============================================================================
-- WS1 Pillar Classification — ClickHouse
-- ============================================================================
-- Fetches every WS1 MY+SG bonus code (year-to-date) and assigns each to ONE
-- budget pillar by a deterministic, objective-based rule set that mirrors
-- bin/reclassify_pillars.py exactly (single source of truth).
--
-- GOVERNING DEFINITION — the official [Pillar_Team_Objective_Promo] framework.
-- The pillar is the FIRST token = the OBJECTIVE. VM / AM / CRM / TSM are TEAMS
-- (second token), NOT pillars — a team runs codes across every pillar, so the
-- team NEVER sets the pillar. Five pillars:
--   Acq              acquiring NEW players — welcome, first deposit/bet, sign-up,
--                    referral, no-deposit trials for new sign-ups (Paid Media/CPL/CPA)
--   Retention        keeping EXISTING players active — reload, payday/mid-month,
--                    cashback/rebate, churn/reactivation/win-back/rescue, AND
--                    general player promos: gamification (LuckyWheel/scratch/
--                    angpow/minigames), festive giveaways, sports-event campaigns
--   VIP              VIP Rebates + VIP Tier Rewards — VIP special free credit,
--                    VIP birthday, VIP-tier membership reward, VIP migration
--   Whale Detection  finding/grooming big spenders — whale probe/scout/groom
--   Branding         Production, Ambassador, Sponsorships, Paid-Media Distribution
--                    (brand-marketing SPEND, NOT player FC/FS giveaways). This
--                    spend lives OUTSIDE the bonus ledger, so this query returns
--                    ~0 Branding codes by design.
--
-- THE TWO RULES THAT WERE BROKEN IN THE OLD FILE:
--   (1) The pillar follows the promo's OBJECTIVE — NOT the team that ran it
--       (CRM/VM/TSM/AM) and NOT the tier of the player who claimed it. A VM
--       deposit-match reload is Retention; a VM no-deposit "VIP FREE CREDIT"
--       loyalty gift is VIP. There is NO "VM/AM = VIP" rule.
--   (2) Gamification / festive giveaways are player engagement promos =
--       Retention, NOT Branding (Branding is production/sponsorship spend).
--
-- Anything the rules cannot resolve is returned as 'REVIEW — needs business
-- input'. It is deliberately NOT guessed.
--
-- Params: date window and the 7 "counted claim" statuses are inlined below.
-- ============================================================================

WITH
-- 1. Manual overrides (optional, authoritative). Add rows here for any code the
--    rules get wrong; these WIN over the rule engine. Keep it small — the rules
--    should handle the vast majority. Format: (BonusCode, Pillar).
manual_override AS (
    -- Business decisions on codes the rules cannot resolve from code+name alone
    -- (the objective is genuinely ambiguous — e.g. no-deposit free spins that could
    -- be acquisition or reactivation). Assigned by Promotion. Add rows as needed.
    SELECT 'FT_LOWVALUE_NODEP_180FS' AS BonusCode, 'Retention' AS Pillar
    UNION ALL SELECT 'FT_MIDVALUE_NODEP_250FS', 'Retention'
    UNION ALL SELECT 'FT_HIGHVALUE_NODEP_299FS', 'Retention'
    UNION ALL SELECT 'FT_3DAY_NODEP_188FS', 'Retention'
    UNION ALL SELECT 'FT_3DAY_NODEP_388FS', 'Retention'
    UNION ALL SELECT 'FT_MIGRATION_NODEP_180FS', 'Retention'
    UNION ALL SELECT 'Sportsbook_First_Bet_Tier_3', 'Retention'
    -- Judgment call (~MYR 20k): ad-hoc 88 free-spin gift curated for the two top
    -- VIP tiers = a VIP Tier Reward. Flip to Retention if it was a one-off spin.
    UNION ALL SELECT 'FT_88 Free Spins Bonus - Platinum/Diamond', 'VIP'
    UNION ALL SELECT 'FT_WC26_FB_250_DMD', 'Retention'
    UNION ALL SELECT 'FT_WC26_FB_100_GLD', 'Retention'
    UNION ALL SELECT 'FT_WC26_FB_160_PLT', 'Retention'
    UNION ALL SELECT 'FT_WC26_DEP_30PCT_2K_PLTDMD', 'Retention'
    UNION ALL SELECT 'FT_WC26_DEP_30PCT_1K_GLD', 'Retention'
    -- FT_PP_*FS: named "VIP Exclusive Offer" but are TSM acquisition welcome free
    -- spins (same family later re-named ACQ_TSM_WELC_*). Confirmed via TSM code list.
    UNION ALL SELECT 'FT_PP_108FS_DEP50_A', 'Acq'
    UNION ALL SELECT 'FT_PP_128FS_FREE_A', 'Acq'
    UNION ALL SELECT 'FT_PP_168FS_DEP80_B', 'Acq'
    UNION ALL SELECT 'FT_PP_208FS_DEP100_C', 'Acq'
    UNION ALL SELECT 'FT_PP_208FS_FREE_B', 'Acq'
    UNION ALL SELECT 'FT_PP_258FS_FREE_C', 'Acq'
),

-- 2. Raw WS1 claims (year-to-date, counted statuses only).
raw AS (
    SELECT
        Currency,
        BonusCode,
        if(BonusName = '', 'Undefined', BonusName) AS BonusName,
        count()          AS claims,
        sum(BonusAmount) AS bonus_cost
    FROM WORKSPACE.GetBonus_ABC
    WHERE SITE_edit = 'WS1'
      AND Currency IN ('MYR', 'SGD')
      AND BonusTime_gmt8 >= toDateTime('2026-01-01 00:00:00')
      AND BonusTime_gmt8 <  toDateTime('2026-08-10 00:00:00')
      AND BonusStatus IN ('Approved','Redeemed','Complete','Active','Completed','Low Balance 1','Low Balance 2')
      AND BonusAmount > 0
    GROUP BY Currency, BonusCode, BonusName
),

-- 3. Normalise strings + tokenise the code (drop a leading FT_).
enriched AS (
    SELECT
        *,
        upper(BonusCode) AS C,
        upper(BonusName) AS N,
        concat(upper(BonusCode), ' ', upper(BonusName)) AS T,
        splitByChar('_', replaceRegexpOne(upper(BonusCode), '^FT_', '')) AS toks
    FROM raw
),

-- 4. Rule engine. FIRST match wins — order matters (gamification & prefixes are
--    checked before generic keyword/token rules so a stray word can't hijack).
rule_based AS (
    SELECT
        *,
        arrayElement(toks, 1) AS seg,
        multiIf(
            /* convention prefix: [FT_]PILLAR_... (pillar = first token) */
            seg = 'ACQ', 'Acq',
            seg = 'RET', 'Retention',
            seg = 'VIP', 'VIP',
            seg IN ('WHALE','WHA'), 'Whale Detection',
            seg = 'BRA', 'Branding',

            /* whale (probe / scout / grooming) */
            position(T,'WHALE') > 0 OR position(T,'HIGHROLLER') > 0 OR position(T,'HIGH ROLLER') > 0
              OR hasAny(toks, ['GROOM','PROBE','SCOUT']), 'Whale Detection',

            /* NOTE: there is deliberately NO "VM/AM = VIP" rule. VM/AM are TEAMS,
               not pillars; their codes are classified by objective below (a VM
               deposit-match reload -> Retention; a VM "VIP FREE CREDIT" -> VIP). */

            /* gamification -> RETENTION (player engagement giveaways; Branding is
               production/sponsorship spend, not player FC/FS). Both ANGPOW/ANGPAO
               spellings + minigames. */
            position(C,'LUCKYWHEEL') > 0 OR position(C,'MYSTERYANGPOW') > 0 OR position(C,'FIFAPREMIUM') > 0
              OR position(C,'FIFABASIC') > 0 OR position(C,'PREMIUMSCRATCH') > 0 OR position(C,'BASICSCRATCH') > 0
              OR position(C,'SCRATCH') > 0 OR position(C,'ANGPOW') > 0 OR position(C,'ANGPAO') > 0 OR position(C,'XMAS') > 0
              OR position(C,'MINIGAME') > 0 OR position(N,'MINIGAME') > 0
              OR position(N,'SCRATCH') > 0 OR position(N,'ANGPOW') > 0 OR position(N,'ANGPAO') > 0
              OR position(N,'ANG POW') > 0 OR position(N,'ANG PAO') > 0 OR position(N,'LUCKY WHEEL') > 0, 'Retention',
            position(C,'CHECKIN') > 0 OR position(N,'CHECK-IN') > 0 OR position(N,'CHECK IN') > 0, 'Retention',

            /* festive / seasonal giveaway -> RETENTION (Duit Raya = Malay festive gift, angpow's equivalent) */
            seg = 'CNY' OR position(N,' CNY') > 0 OR position(N,'DUIT RAYA') > 0 OR position(N,'HARI RAYA') > 0
              OR position(N,'RAYA') > 0 OR position(T,'XMAS') > 0 OR position(N,'CHRISTMAS') > 0
              OR position(N,'MOONCAKE') > 0 OR position(N,'DEEPAVALI') > 0, 'Retention',

            /* RETENTION objective FIRST — a reload / win-back token (REL / COMEBACK)
               beats a stray ACQ team-token, e.g. CRM_ACQ_REL_COMEBACK is a reload. */
            hasAny(toks, ['RET','CHURN','REACT','REL','RELOAD'])
              OR position(T,'CHURN') > 0 OR position(T,'REACT') > 0 OR position(T,'WINBACK') > 0
              OR position(T,'COMEBACK') > 0 OR position(N,'RESCUE') > 0, 'Retention',

            /* remaining objective tokens */
            has(toks,'ACQ'), 'Acq',
            has(toks,'VIP'), 'VIP',
            hasAny(toks, ['WHALE','WHA']), 'Whale Detection',
            hasAny(toks, ['BRA','BRAND']), 'Branding',

            /* welcome/acquisition (WEL or WELC) — but VIP welcome/migration/membership is VIP, not Acq */
            (has(toks,'WEL') OR position(C,'WELC') > 0 OR position(N,'WELCOME') > 0 OR position(N,'NEW MEMBER') > 0
              OR position(N,'REGISTER') > 0 OR position(T,'REFEREE') > 0 OR position(T,'REFERRER') > 0 OR position(T,'REFERRAL') > 0)
              AND (position(T,'VIP') > 0 OR position(T,'MIGRATION') > 0 OR position(C,'MEMBERSHIP') > 0), 'VIP',
            has(toks,'WEL') OR position(C,'WELC') > 0 OR position(N,'WELCOME') > 0 OR position(N,'NEW MEMBER') > 0
              OR position(N,'REGISTER') > 0 OR position(T,'REFEREE') > 0 OR position(T,'REFERRER') > 0 OR position(T,'REFERRAL') > 0, 'Acq',

            /* reload / retention keywords (incl. KYC/withdrawal friction bonuses) */
            position(C,'_REL') > 0 OR position(N,'RELOAD') > 0 OR position(T,'PAYDAY') > 0
              OR position(C,'MIDMONTH') > 0 OR position(C,'DOUBLEDATE') > 0 OR position(C,'DOUDLEDATE') > 0
              OR position(N,'CASHBACK') > 0 OR position(N,'REBATE') > 0
              OR position(N,'WITHDRAWAL') > 0 OR position(C,'KYC') > 0, 'Retention',

            /* deposit-match "Deposit X Get Y" -> Retention (existing-player redeposit,
               even when named "VIP BONUS" or run by the VM team — team never sets pillar) */
            match(C, 'DEP[0-9]+.*GET[0-9]+') OR (position(N,'DEPOSIT') > 0 AND position(N,'GET') > 0), 'Retention',

            /* VIP / loyalty (genuine: birthday, membership, tier reward) */
            position(T,'VIP') > 0 OR position(N,'BIRTHDAY') > 0 OR position(C,'BDAY') > 0 OR position(C,'MEMBERSHIP') > 0, 'VIP',

            /* no-deposit free spins to value/lapsed segments = reactivation */
            (position(C,'NODEP') > 0 OR position(N,'NO DEP') > 0 OR position(N,'NO DEPOSIT') > 0)
              AND (position(C,'FS') > 0 OR position(N,'FREE SPIN') > 0), 'Retention',

            /* sports-event campaigns (World Cup / WC26 / EURO) = event engagement */
            position(C,'WC26') > 0 OR position(N,'WORLD CUP') > 0 OR seg = 'EURO' OR position(C,'EURO2028') > 0, 'Retention',

            /* first-bet insurance / "You Lose We Pay" = sportsbook retention lever */
            position(C,'FIRST_BET') > 0 OR position(C,'FIRSTBET') > 0 OR position(N,'FIRST BET') > 0
              OR position(N,'YOU LOSE WE PAY') > 0 OR position(N,'LOSE WE PAY') > 0, 'Retention',

            /* fallback: a recognisable player FC/FS/free-bet giveaway with no other
               objective marker defaults to Retention/Promo (framework's general
               player-promo bucket). Only truly unparseable codes stay REVIEW. */
            has(toks,'FS') OR position(N,'FREE SPIN') > 0 OR position(N,'FREESPIN') > 0
              OR position(N,'FREE BET') > 0 OR position(C,'FREEBET') > 0 OR position(N,'FREE CREDIT') > 0
              OR match(C, 'FC[0-9]'), 'Retention',

            /* nothing matched — flag, do not guess */
            'REVIEW — needs business input'
        ) AS rule_pillar
    FROM enriched
)

-- 5. Final: manual override wins, else the rule engine.
SELECT
    r.Currency,
    r.BonusCode,
    r.BonusName,
    if(coalesce(mo.Pillar, '') != '', mo.Pillar, r.rule_pillar) AS Pillar,
    if(coalesce(mo.Pillar, '') != '', 'manual override', 'rule engine') AS classification_source,
    r.claims,
    r.bonus_cost
FROM rule_based r
LEFT JOIN manual_override mo ON trimBoth(r.BonusCode) = mo.BonusCode  -- trim: some raw codes carry a stray leading space
ORDER BY Pillar, r.bonus_cost DESC;

-- ----------------------------------------------------------------------------
-- Roll-up variant (swap the final SELECT for this to get pillar totals):
--
-- SELECT Currency, Pillar, count() AS codes, sum(claims) AS claims, sum(bonus_cost) AS bonus_cost
-- FROM ( ...the SELECT above without ORDER BY... )
-- GROUP BY Currency, Pillar
-- ORDER BY Currency, bonus_cost DESC;
-- ----------------------------------------------------------------------------

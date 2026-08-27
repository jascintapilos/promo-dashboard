"""
Bonus Performance Report — SQL Reference
=========================================

Source:  callbacks/bonus_performance_callbacks.py
Tables:  WORKSPACE schema (ClickHouse)
Author:  data team

PURPOSE
-------
Measures the effectiveness of bonus campaigns using a T1+T2 attribution model.

  T1 (Gross Attribution)
      Each member's actual deposit / NGR in the 7 days after receiving a bonus,
      weighted by their share of bonus on each day and a linear time-decay:
        weight = BonusAmount × (7 − day_offset) / 7
      Day 0 carries full weight; day 6 carries 1/7.

  T2 (Incremental Lift)
      T1 minus the member's 14-day pre-bonus daily average (their "baseline").
      Positive = the bonus drove genuine extra activity.
      Negative = the member spent less than they normally would have.

When a member holds multiple bonuses on the same day, credit is split
proportionally to each bonus's amount (denominator = total active bonus that day).

TWO SQL VARIANTS
----------------
  SQL_LOCAL — amounts in local currency (DepositAmount, NGR, BonusAmount)
              Works for any currency: IDR, MYR, THB, VND, etc.
  SQL_USD   — amounts in USD; BonusAmount is divided by dedup_CurrencyConversionRates,
              activity columns use DepositAmount_usd / NGR_usd

Both variants are identical in structure. Only the amount columns differ.

PLACEHOLDER SUBSTITUTION
------------------------
Before execution the dashboard replaces bracketed tokens in the SQL string.
See the PLACEHOLDER REFERENCE section at the bottom of this file for all
tokens, their derivation, and sample values.

OUTPUT COLUMNS
--------------
  SITE_edit         Site identifier
  BonusType         Campaign category  (Welcome, Reload, Referral, Cashback, …)
  BonusCode         Campaign code
  BonusName         Campaign name
  Stakeholder       Owner / team (present only when grouped by stakeholder)
  claims            Total bonus claims in the period
  unique_members    Distinct members who received the bonus
  bonus_cost        Total bonus amount paid out
  bonus_per_member  bonus_cost / unique_members
  avg_conf          Confidence 0–1; < 1 means some bonuses are too recent
                    to have a complete 7-day post-window → T1/T2 understated
  t1_deposits       T1 gross attributed deposit
  t1_ngr            T1 gross attributed NGR
  ngr_per_bonus     t1_ngr / bonus_cost  (gross NGR return per bonus unit)
  deposit_lift      T2 incremental deposit above baseline
  ngr_lift          T2 incremental NGR above baseline
  roi_perc          ngr_lift / bonus_cost  (incremental ROI; positive = profitable)
"""


# ─────────────────────────────────────────────────────────────────────────────
# VARIANT 1 — Local currency (IDR / MYR / THB / VND — any non-USD currency)
# ─────────────────────────────────────────────────────────────────────────────

SQL_LOCAL = """
WITH

-- ── Step 1: all_bonuses_raw ──────────────────────────────────────────────────
-- Pull every bonus claim in an extended window (start−7d → end+7d).
-- The ±7 day margin ensures bonuses near the boundary still have a complete
-- 7-day post-attribution window and a valid warm-up period.
-- Normalises empty BonusCode / BonusName to 'Undefined'.
-- Excludes: cancelled/expired statuses, zero-amount rows, and (optionally)
-- specific sites / bonus types / codes / names via the injected WHERE clauses.
all_bonuses_raw AS (
    SELECT SITE, SITE_edit, MEMBER_ID,
           BonusTime_gmt8,
           BonusType,
           if(BonusCode = '', 'Undefined', BonusCode) AS BonusCode,
           if(BonusName = '', 'Undefined', BonusName) AS BonusName,
           BonusAmount
    FROM WORKSPACE.GetBonus_ABC
    WHERE BonusTime_gmt8 >= '[analysis_start-7d] 00:00:00'
      AND BonusTime_gmt8 <  '[analysis_end+7d] 00:00:00'
      AND Currency        =  '[currency]'
      AND BonusStatus IN ('Approved','Redeemed','Complete','Active',
                          'Completed','Low Balance 1','Low Balance 2')
      AND BonusAmount > 0
      [site_where]
      [bonus_type_where]
      [bonus_code_where]
      [bonus_name_where]
),

-- ── Step 2: members_counts ───────────────────────────────────────────────────
-- Count distinct members per campaign within the analysis window only (not
-- the extended window). Used later for bonus_per_member.
-- WITH ROLLUP generates subtotal rows for every GROUP BY prefix level so the
-- dashboard can show group and grand-total rows without a second query.
members_counts AS (
    SELECT abr.SITE_edit,
           abr.BonusType,
           abr.BonusCode,
           abr.BonusName,
           [STK_SELECT_MC]
           count(DISTINCT concat(abr.SITE,'-',abr.MEMBER_ID)) AS n_members
    FROM all_bonuses_raw abr
    LEFT JOIN WORKSPACE.BrandStakeholders bsh ON abr.SITE_edit = bsh.SITE_edit
    WHERE abr.BonusTime_gmt8 >= '[analysis_start] 00:00:00'
      AND abr.BonusTime_gmt8 <  '[analysis_end+1] 00:00:00'
    GROUP BY [MC_GROUP_BY]
    WITH ROLLUP
),

-- ── Step 3: bonuses ──────────────────────────────────────────────────────────
-- Collapse all_bonuses_raw to one row per (member, date, campaign).
-- A member may receive the same bonus multiple times in a day; SUM gives
-- the total cost for that member/day/campaign combination.
bonuses AS (
    SELECT SITE, SITE_edit, MEMBER_ID,
           toDate(BonusTime_gmt8) AS bonus_date,
           BonusType, BonusCode, BonusName,
           SUM(BonusAmount) AS BonusAmount
    FROM all_bonuses_raw
    GROUP BY SITE, SITE_edit, MEMBER_ID, toDate(BonusTime_gmt8),
             BonusType, BonusCode, BonusName
),

-- ── Step 4: member_baseline ──────────────────────────────────────────────────
-- 14-day pre-bonus average deposit and NGR per member per bonus_date.
-- This is the counterfactual: what the member would have done without the bonus.
--
-- Technique: CROSS JOIN numbers(14) generates 14 offset rows per bonus_date,
-- each pointing to one baseline day (days −1 through −14 before the bonus).
-- The LEFT JOIN to Daily_GMT8_Snapshot looks up actual activity on each day.
-- Dividing the SUM by 14.0 gives the daily average.
-- Members with no pre-bonus activity get avg = 0 (LEFT JOIN → NULL → treated as 0).
member_baseline AS (
    SELECT b.SITE, b.MEMBER_ID, b.bonus_date,
           SUM(act.DepositAmount) / 14.0 AS avg_daily_deposit,
           SUM(act.NGR)           / 14.0 AS avg_daily_ngr
    FROM (
        SELECT src.SITE, src.MEMBER_ID, src.bonus_date,
               subtractDays(src.bonus_date, toUInt32(n.number) + 1) AS baseline_date
        FROM (SELECT DISTINCT SITE, MEMBER_ID, bonus_date FROM bonuses) src
        CROSS JOIN (SELECT number FROM numbers(14)) n   -- offsets 0..13 → days −1..−14
    ) b
    LEFT JOIN (
        SELECT SITE, MEMBER_ID, SnapshotDate, DepositAmount, NGR
        FROM WORKSPACE.Daily_GMT8_Snapshot_A
        WHERE SnapshotDate >= '[analysis_start-21d]' AND SnapshotDate < '[analysis_end]'
          AND Currency = '[currency]'
        UNION ALL
        SELECT SITE, MEMBER_ID, SnapshotDate, DepositAmount, NGR
        FROM WORKSPACE.Daily_GMT8_Snapshot_BC
        WHERE SnapshotDate >= '[analysis_start-21d]' AND SnapshotDate < '[analysis_end]'
          AND Currency = '[currency]'
    ) act ON b.SITE = act.SITE AND b.MEMBER_ID = act.MEMBER_ID
          AND b.baseline_date = act.SnapshotDate
    GROUP BY b.SITE, b.MEMBER_ID, b.bonus_date
),

-- ── Step 5: activity ─────────────────────────────────────────────────────────
-- Actual deposit and NGR per member per day in the post-bonus window
-- (analysis_start → analysis_end+6).
-- +6 days captures the full 7-day post window for bonuses claimed on the
-- last day of the analysis period.
-- Rows with zero deposit and zero NGR are excluded (no activity = no cost).
activity AS (
    SELECT a.SITE, a.MEMBER_ID, a.SnapshotDate,
           a.DepositAmount AS raw_deposit,
           a.NGR           AS raw_ngr
    FROM (
        SELECT SITE, MEMBER_ID, SnapshotDate, DepositAmount, NGR
        FROM WORKSPACE.Daily_GMT8_Snapshot_A
        WHERE SnapshotDate BETWEEN '[analysis_start]' AND '[analysis_end+6]'
          AND Currency = '[currency]'
          AND (DepositAmount > 0 OR NGR != 0)
        UNION ALL
        SELECT SITE, MEMBER_ID, SnapshotDate, DepositAmount, NGR
        FROM WORKSPACE.Daily_GMT8_Snapshot_BC
        WHERE SnapshotDate BETWEEN '[analysis_start]' AND '[analysis_end+6]'
          AND Currency = '[currency]'
          AND (DepositAmount > 0 OR NGR != 0)
    ) a
),

-- ── Step 6: member_day_totals ─────────────────────────────────────────────────
-- For each member and each day in their 7-day post-bonus window, sum the total
-- BonusAmount across ALL bonuses active on that day.
-- This is the denominator for attribution: if a member holds two bonuses worth
-- 50 and 100 on a given day, the 50-bonus gets 50/150 = 1/3 of that day's
-- activity credit, and the 100-bonus gets 2/3.
member_day_totals AS (
    SELECT b.SITE_edit, b.MEMBER_ID,
           addDays(b.bonus_date, toInt32(n.number)) AS SnapshotDate,
           SUM(b.BonusAmount) AS total_active_amount
    FROM bonuses b
    CROSS JOIN (SELECT number FROM numbers(7)) n   -- day offsets 0..6
    WHERE addDays(b.bonus_date, toInt32(n.number)) BETWEEN '[analysis_start]' AND '[analysis_end+6]'
    GROUP BY b.SITE_edit, b.MEMBER_ID, addDays(b.bonus_date, toInt32(n.number))
),

-- ── Step 7: joined ───────────────────────────────────────────────────────────
-- Core attribution join. For every (bonus × post-day) combination computes:
--
--   raw_deposit / raw_ngr   = member's actual activity that day
--   incr_deposit / incr_ngr = actual − baseline average  (T2 incremental)
--
--   time_decay_weight = BonusAmount × (7 − day_offset) / 7
--     day 0 → weight = BonusAmount × 7/7  (full weight, closest to bonus)
--     day 6 → weight = BonusAmount × 1/7  (minimal weight, 6 days later)
--
--   total_active_amount = sum of all bonuses the member holds that day
--     (used in Step 8 as the denominator to split credit across concurrencies)
joined AS (
    SELECT
        b.SITE_edit,
        b.MEMBER_ID,
        addDays(b.bonus_date, toInt32(days.number))          AS SnapshotDate,
        ifNull(a.a_dep, 0)                                    AS raw_deposit,
        ifNull(a.a_ngr, 0)                                    AS raw_ngr,
        ifNull(a.a_dep, 0) - ifNull(mb.avg_daily_deposit, 0) AS incr_deposit,
        ifNull(a.a_ngr, 0) - ifNull(mb.avg_daily_ngr,     0) AS incr_ngr,
        b.BonusType,
        b.BonusCode,
        b.BonusName,
        b.BonusAmount * (7.0 - toFloat64(days.number)) / 7.0 AS time_decay_weight,
        mdt.total_active_amount
    FROM bonuses b
    CROSS JOIN (SELECT number FROM numbers(7)) AS days
    LEFT JOIN (
        SELECT SITE AS a_site, MEMBER_ID AS a_mid,
               SnapshotDate AS a_date,
               raw_deposit  AS a_dep, raw_ngr AS a_ngr
        FROM activity
    ) a  ON b.SITE = a.a_site AND b.MEMBER_ID = a.a_mid
        AND addDays(b.bonus_date, toInt32(days.number)) = a.a_date
    LEFT JOIN (
        SELECT SITE AS mb_site, MEMBER_ID AS mb_mid,
               bonus_date AS mb_bdate,
               avg_daily_deposit, avg_daily_ngr
        FROM member_baseline
    ) mb ON b.SITE = mb.mb_site AND b.MEMBER_ID = mb.mb_mid
        AND b.bonus_date = mb.mb_bdate
    LEFT JOIN (
        SELECT SITE_edit AS mdt_se, MEMBER_ID AS mdt_mid,
               SnapshotDate AS mdt_date, total_active_amount
        FROM member_day_totals
    ) mdt ON b.SITE_edit = mdt.mdt_se AND b.MEMBER_ID = mdt.mdt_mid
          AND addDays(b.bonus_date, toInt32(days.number)) = mdt.mdt_date
    WHERE addDays(b.bonus_date, toInt32(days.number)) BETWEEN '[analysis_start]' AND '[analysis_end+6]'
      AND b.bonus_date >= '[analysis_start]'
      AND b.bonus_date <= '[analysis_end]'
),

-- ── Step 8: member_attrib ────────────────────────────────────────────────────
-- Aggregate the 7-day weighted activity to one row per (member, campaign).
-- Attribution formula (same for all four metrics):
--
--   attributed_value = SUM( daily_value × time_decay_weight / total_active_amount )
--
-- Dividing by total_active_amount splits credit proportionally when multiple
-- bonuses are active. Multiplying by time_decay_weight down-weights later days.
member_attrib AS (
    SELECT
        SITE_edit, MEMBER_ID, BonusType, BonusCode, BonusName,
        SUM(raw_deposit  * time_decay_weight / total_active_amount) AS t1_deposits,
        SUM(raw_ngr      * time_decay_weight / total_active_amount) AS t1_ngr,
        SUM(incr_deposit * time_decay_weight / total_active_amount) AS deposit_lift,
        SUM(incr_ngr     * time_decay_weight / total_active_amount) AS ngr_lift
    FROM joined
    GROUP BY SITE_edit, MEMBER_ID, BonusType, BonusCode, BonusName
),

-- ── Step 9: pml_base (Per-Member-Level base metrics) ─────────────────────────
-- Claims, total bonus cost, and confidence score per member per campaign.
--
-- conf_numerator: for each claim, least(7, days_since_claim) / 7.
--   A claim from today = 0/7 (no post-window data yet).
--   A claim from 7+ days ago = 7/7 (full window available).
-- Summing across all claims and dividing by claim count (in Step 10) gives
-- avg_conf ∈ [0,1], indicating how mature the attribution window is.
-- avg_conf < 1 means T1/T2 figures are understated for recent bonuses.
pml_base AS (
    SELECT
        SITE_edit, MEMBER_ID, BonusType, BonusCode, BonusName,
        count()                                                                 AS claims,
        sum(BonusAmount)                                                        AS bonus_cost,
        sum(least(7, dateDiff('day', toDate(BonusTime_gmt8), today())) / 7.0) AS conf_numerator
    FROM all_bonuses_raw
    WHERE BonusTime_gmt8 >= '[analysis_start] 00:00:00'
      AND BonusTime_gmt8 <  '[analysis_end+1] 00:00:00'
    GROUP BY SITE_edit, MEMBER_ID, BonusType, BonusCode, BonusName
),

-- ── Step 10: final_combined ──────────────────────────────────────────────────
-- Join attribution (member_attrib) with base metrics (pml_base) and aggregate
-- to the report grain (SITE_edit, BonusType, BonusCode, BonusName, Stakeholder).
-- WITH ROLLUP produces subtotals at each group level and a grand total row,
-- all in one pass.
final_combined AS (
    SELECT
        a.SITE_edit                                                    AS SITE_edit,
        a.BonusType                                                    AS BonusType,
        a.BonusCode                                                    AS BonusCode,
        a.BonusName                                                    AS BonusName,
        [STK_SELECT_FC]
        sum(ifNull(p.claims,         0))                               AS claims,
        sum(ifNull(p.bonus_cost,     0))                               AS bonus_cost,
        sum(ifNull(p.conf_numerator, 0))
            / nullIf(sum(ifNull(p.claims, 0)), 0)                      AS avg_conf,
        sum(a.t1_deposits)                                             AS t1_deposits,
        sum(a.t1_ngr)                                                  AS t1_ngr,
        sum(a.deposit_lift)                                            AS deposit_lift,
        sum(a.ngr_lift)                                                AS ngr_lift
    FROM member_attrib a
    INNER JOIN pml_base p
        ON  a.SITE_edit = p.SITE_edit AND a.MEMBER_ID = p.MEMBER_ID
        AND a.BonusType = p.BonusType AND a.BonusCode = p.BonusCode
        AND a.BonusName = p.BonusName
    LEFT JOIN WORKSPACE.BrandStakeholders bsh ON a.SITE_edit = bsh.SITE_edit
    GROUP BY [FC_GROUP_BY]
    WITH ROLLUP
)

-- ── Final SELECT ─────────────────────────────────────────────────────────────
-- Join final_combined with members_counts and compute derived KPIs:
--   bonus_per_member = bonus_cost / unique_members
--   ngr_per_bonus    = t1_ngr / bonus_cost   (gross NGR return per bonus unit)
--   roi_perc         = ngr_lift / bonus_cost  (incremental ROI)
SELECT
    fc.SITE_edit,
    fc.BonusType,
    fc.BonusCode,
    fc.BonusName,
    fc.Stakeholder,
    fc.claims,
    mc.n_members                      AS unique_members,
    fc.bonus_cost,
    fc.bonus_cost / mc.n_members      AS bonus_per_member,
    fc.avg_conf,
    fc.t1_deposits,
    fc.t1_ngr,
    fc.t1_ngr    / fc.bonus_cost      AS ngr_per_bonus,
    fc.deposit_lift,
    fc.ngr_lift,
    fc.ngr_lift  / fc.bonus_cost      AS roi_perc
FROM final_combined fc
LEFT JOIN members_counts mc
    ON  fc.SITE_edit = mc.SITE_edit   AND fc.BonusType = mc.BonusType
    AND fc.BonusCode = mc.BonusCode   AND fc.BonusName = mc.BonusName
    [STK_JOIN_COND]
[ROLLUP_WHERE]
"""


# ─────────────────────────────────────────────────────────────────────────────
# VARIANT 2 — USD
# Identical structure to SQL_LOCAL. Two differences:
#   1. all_bonuses_raw divides BonusAmount by the daily conversion rate.
#   2. member_baseline and activity use DepositAmount_usd / NGR_usd.
# ─────────────────────────────────────────────────────────────────────────────

SQL_USD = """
WITH

-- ── Step 1: all_bonuses_raw (USD variant) ────────────────────────────────────
-- Same as SQL_LOCAL Step 1 but joins dedup_CurrencyConversionRates to convert
-- BonusAmount to USD.
-- ConversionRate = units of local currency per 1 USD, so:
--   BonusAmount_usd = BonusAmount_local / ConversionRate
all_bonuses_raw AS (
    SELECT gb.SITE, gb.SITE_edit, gb.MEMBER_ID, gb.BonusTime_gmt8,
           gb.BonusType,
           if(gb.BonusCode = '', 'Undefined', gb.BonusCode) AS BonusCode,
           if(gb.BonusName = '', 'Undefined', gb.BonusName) AS BonusName,
           gb.BonusAmount / cr.ConversionRate AS BonusAmount
    FROM WORKSPACE.GetBonus_ABC gb
    LEFT JOIN WORKSPACE.dedup_CurrencyConversionRates cr
        ON  cr.FromCurrency   = 'USD'
        AND cr.ToCurrency     = gb.Currency
        AND cr.ConversionDate = toDate(gb.BonusTime_gmt8)
    WHERE gb.BonusTime_gmt8 >= '[analysis_start-7d] 00:00:00'
      AND gb.BonusTime_gmt8 <  '[analysis_end+7d] 00:00:00'
      AND gb.Currency        =  '[currency]'
      AND gb.BonusStatus IN ('Approved','Redeemed','Complete','Active',
                             'Completed','Low Balance 1','Low Balance 2')
      AND gb.BonusAmount > 0
      [site_where]
      [bonus_type_where]
      [bonus_code_where]
      [bonus_name_where]
),

-- Steps 2–3 are identical to SQL_LOCAL (members_counts, bonuses).
-- Steps 4–5 differ only in column names: DepositAmount_usd / NGR_usd.

members_counts AS (
    SELECT abr.SITE_edit, abr.BonusType, abr.BonusCode, abr.BonusName,
           [STK_SELECT_MC]
           count(DISTINCT concat(abr.SITE,'-',abr.MEMBER_ID)) AS n_members
    FROM all_bonuses_raw abr
    LEFT JOIN WORKSPACE.BrandStakeholders bsh ON abr.SITE_edit = bsh.SITE_edit
    WHERE abr.BonusTime_gmt8 >= '[analysis_start] 00:00:00'
      AND abr.BonusTime_gmt8 <  '[analysis_end+1] 00:00:00'
    GROUP BY [MC_GROUP_BY]
    WITH ROLLUP
),
bonuses AS (
    SELECT SITE, SITE_edit, MEMBER_ID,
           toDate(BonusTime_gmt8) AS bonus_date,
           BonusType, BonusCode, BonusName,
           SUM(BonusAmount) AS BonusAmount
    FROM all_bonuses_raw
    GROUP BY SITE, SITE_edit, MEMBER_ID, toDate(BonusTime_gmt8),
             BonusType, BonusCode, BonusName
),

-- ── Step 4 (USD): member_baseline ────────────────────────────────────────────
-- Uses DepositAmount_usd and NGR_usd instead of DepositAmount and NGR.
member_baseline AS (
    SELECT b.SITE, b.MEMBER_ID, b.bonus_date,
           SUM(act.DepositAmount_usd) / 14.0 AS avg_daily_deposit,
           SUM(act.NGR_usd)           / 14.0 AS avg_daily_ngr
    FROM (
        SELECT src.SITE, src.MEMBER_ID, src.bonus_date,
               subtractDays(src.bonus_date, toUInt32(n.number) + 1) AS baseline_date
        FROM (SELECT DISTINCT SITE, MEMBER_ID, bonus_date FROM bonuses) src
        CROSS JOIN (SELECT number FROM numbers(14)) n
    ) b
    LEFT JOIN (
        SELECT SITE, MEMBER_ID, SnapshotDate, DepositAmount_usd, NGR_usd
        FROM WORKSPACE.Daily_GMT8_Snapshot_A
        WHERE SnapshotDate >= '[analysis_start-21d]' AND SnapshotDate < '[analysis_end]'
          AND Currency = '[currency]'
        UNION ALL
        SELECT SITE, MEMBER_ID, SnapshotDate, DepositAmount_usd, NGR_usd
        FROM WORKSPACE.Daily_GMT8_Snapshot_BC
        WHERE SnapshotDate >= '[analysis_start-21d]' AND SnapshotDate < '[analysis_end]'
          AND Currency = '[currency]'
    ) act ON b.SITE = act.SITE AND b.MEMBER_ID = act.MEMBER_ID
          AND b.baseline_date = act.SnapshotDate
    GROUP BY b.SITE, b.MEMBER_ID, b.bonus_date
),

-- ── Step 5 (USD): activity ────────────────────────────────────────────────────
activity AS (
    SELECT a.SITE, a.MEMBER_ID, a.SnapshotDate,
           a.DepositAmount_usd AS raw_deposit,
           a.NGR_usd           AS raw_ngr
    FROM (
        SELECT SITE, MEMBER_ID, SnapshotDate, DepositAmount_usd, NGR_usd
        FROM WORKSPACE.Daily_GMT8_Snapshot_A
        WHERE SnapshotDate BETWEEN '[analysis_start]' AND '[analysis_end+6]'
          AND Currency = '[currency]'
          AND (DepositAmount_usd > 0 OR NGR_usd != 0)
        UNION ALL
        SELECT SITE, MEMBER_ID, SnapshotDate, DepositAmount_usd, NGR_usd
        FROM WORKSPACE.Daily_GMT8_Snapshot_BC
        WHERE SnapshotDate BETWEEN '[analysis_start]' AND '[analysis_end+6]'
          AND Currency = '[currency]'
          AND (DepositAmount_usd > 0 OR NGR_usd != 0)
    ) a
),

-- Steps 6–10 and Final SELECT are identical to SQL_LOCAL.
member_day_totals AS (
    SELECT b.SITE_edit, b.MEMBER_ID,
           addDays(b.bonus_date, toInt32(n.number)) AS SnapshotDate,
           SUM(b.BonusAmount) AS total_active_amount
    FROM bonuses b
    CROSS JOIN (SELECT number FROM numbers(7)) n
    WHERE addDays(b.bonus_date, toInt32(n.number)) BETWEEN '[analysis_start]' AND '[analysis_end+6]'
    GROUP BY b.SITE_edit, b.MEMBER_ID, addDays(b.bonus_date, toInt32(n.number))
),
joined AS (
    SELECT
        b.SITE_edit, b.MEMBER_ID,
        addDays(b.bonus_date, toInt32(days.number))          AS SnapshotDate,
        ifNull(a.a_dep, 0)                                    AS raw_deposit,
        ifNull(a.a_ngr, 0)                                    AS raw_ngr,
        ifNull(a.a_dep, 0) - ifNull(mb.avg_daily_deposit, 0) AS incr_deposit,
        ifNull(a.a_ngr, 0) - ifNull(mb.avg_daily_ngr,     0) AS incr_ngr,
        b.BonusType, b.BonusCode, b.BonusName,
        b.BonusAmount * (7.0 - toFloat64(days.number)) / 7.0 AS time_decay_weight,
        mdt.total_active_amount
    FROM bonuses b
    CROSS JOIN (SELECT number FROM numbers(7)) AS days
    LEFT JOIN (SELECT SITE AS a_site, MEMBER_ID AS a_mid, SnapshotDate AS a_date,
                      raw_deposit AS a_dep, raw_ngr AS a_ngr FROM activity
    ) a  ON b.SITE = a.a_site AND b.MEMBER_ID = a.a_mid
        AND addDays(b.bonus_date, toInt32(days.number)) = a.a_date
    LEFT JOIN (SELECT SITE AS mb_site, MEMBER_ID AS mb_mid, bonus_date AS mb_bdate,
                      avg_daily_deposit, avg_daily_ngr FROM member_baseline
    ) mb ON b.SITE = mb.mb_site AND b.MEMBER_ID = mb.mb_mid AND b.bonus_date = mb.mb_bdate
    LEFT JOIN (SELECT SITE_edit AS mdt_se, MEMBER_ID AS mdt_mid,
                      SnapshotDate AS mdt_date, total_active_amount FROM member_day_totals
    ) mdt ON b.SITE_edit = mdt.mdt_se AND b.MEMBER_ID = mdt.mdt_mid
          AND addDays(b.bonus_date, toInt32(days.number)) = mdt.mdt_date
    WHERE addDays(b.bonus_date, toInt32(days.number)) BETWEEN '[analysis_start]' AND '[analysis_end+6]'
      AND b.bonus_date >= '[analysis_start]'
      AND b.bonus_date <= '[analysis_end]'
),
member_attrib AS (
    SELECT SITE_edit, MEMBER_ID, BonusType, BonusCode, BonusName,
        SUM(raw_deposit  * time_decay_weight / total_active_amount) AS t1_deposits,
        SUM(raw_ngr      * time_decay_weight / total_active_amount) AS t1_ngr,
        SUM(incr_deposit * time_decay_weight / total_active_amount) AS deposit_lift,
        SUM(incr_ngr     * time_decay_weight / total_active_amount) AS ngr_lift
    FROM joined
    GROUP BY SITE_edit, MEMBER_ID, BonusType, BonusCode, BonusName
),
pml_base AS (
    SELECT SITE_edit, MEMBER_ID, BonusType, BonusCode, BonusName,
        count()                                                                 AS claims,
        sum(BonusAmount)                                                        AS bonus_cost,
        sum(least(7, dateDiff('day', toDate(BonusTime_gmt8), today())) / 7.0) AS conf_numerator
    FROM all_bonuses_raw
    WHERE BonusTime_gmt8 >= '[analysis_start] 00:00:00'
      AND BonusTime_gmt8 <  '[analysis_end+1] 00:00:00'
    GROUP BY SITE_edit, MEMBER_ID, BonusType, BonusCode, BonusName
),
final_combined AS (
    SELECT
        a.SITE_edit AS SITE_edit, a.BonusType AS BonusType,
        a.BonusCode AS BonusCode, a.BonusName AS BonusName,
        [STK_SELECT_FC]
        sum(ifNull(p.claims,         0))                               AS claims,
        sum(ifNull(p.bonus_cost,     0))                               AS bonus_cost,
        sum(ifNull(p.conf_numerator, 0))
            / nullIf(sum(ifNull(p.claims, 0)), 0)                      AS avg_conf,
        sum(a.t1_deposits) AS t1_deposits, sum(a.t1_ngr)    AS t1_ngr,
        sum(a.deposit_lift) AS deposit_lift, sum(a.ngr_lift) AS ngr_lift
    FROM member_attrib a
    INNER JOIN pml_base p
        ON  a.SITE_edit = p.SITE_edit AND a.MEMBER_ID = p.MEMBER_ID
        AND a.BonusType = p.BonusType AND a.BonusCode = p.BonusCode
        AND a.BonusName = p.BonusName
    LEFT JOIN WORKSPACE.BrandStakeholders bsh ON a.SITE_edit = bsh.SITE_edit
    GROUP BY [FC_GROUP_BY]
    WITH ROLLUP
)
SELECT
    fc.SITE_edit, fc.BonusType, fc.BonusCode, fc.BonusName, fc.Stakeholder,
    fc.claims,
    mc.n_members                      AS unique_members,
    fc.bonus_cost,
    fc.bonus_cost / mc.n_members      AS bonus_per_member,
    fc.avg_conf,
    fc.t1_deposits, fc.t1_ngr,
    fc.t1_ngr    / fc.bonus_cost      AS ngr_per_bonus,
    fc.deposit_lift, fc.ngr_lift,
    fc.ngr_lift  / fc.bonus_cost      AS roi_perc
FROM final_combined fc
LEFT JOIN members_counts mc
    ON  fc.SITE_edit = mc.SITE_edit   AND fc.BonusType = mc.BonusType
    AND fc.BonusCode = mc.BonusCode   AND fc.BonusName = mc.BonusName
    [STK_JOIN_COND]
[ROLLUP_WHERE]
"""


# ─────────────────────────────────────────────────────────────────────────────
# PLACEHOLDER REFERENCE — sample values for a typical query
# ─────────────────────────────────────────────────────────────────────────────
#
# Assumed UI selection for all examples below:
#   Date range : 2026-06-01 → 2026-06-30
#   Currency   : IDR
#   Sites      : SiteA, SiteB
#   Bonus type : Reload
#   Bonus code : (no filter)
#   Bonus name : (no filter)
#   Grouping   : SITE_edit + BonusType  (Stakeholder NOT selected)
#
# ── Date placeholders (produced by _compute_date_params()) ───────────────────
#
#   Placeholder            Sample value      Derivation
#   ─────────────────────────────────────────────────────────────────────────
#   [analysis_start]       2026-06-01        UI start date (as-is)
#   [analysis_end]         2026-06-30        UI end date (as-is)
#   [analysis_start-7d]    2026-05-25        start − 7 days  (warm-up margin)
#   [analysis_end+7d]      2026-07-07        end + 7 days    (cool-down margin)
#   [analysis_start-21d]   2026-05-11        start − 21 days (baseline window)
#   [analysis_end+1]       2026-07-01        end + 1 day     (exclusive upper bound)
#   [analysis_end+6]       2026-07-06        end + 6 days    (post-bonus activity window)
#
# ── Currency placeholder ─────────────────────────────────────────────────────
#
#   [currency]             IDR
#   Other production values: MYR, THB, VND
#   Note: in the USD variant this still filters source rows to one currency;
#   the amount is then divided by the daily conversion rate to normalise to USD.
#
# ── Filter placeholders (produced by _inject_all_filters()) ──────────────────
#
#   [site_where]
#     With filter:   AND SITE_edit IN ('SiteA','SiteB')
#     No filter:     (empty string — clause omitted entirely)
#     Production site names: e.g. 'SiteA-IDR', 'SiteB-MYR'
#     Single quotes inside names are escaped by doubling: O'Brien → O''Brien
#
#   [bonus_type_where]
#     With filter:   AND BonusType IN ('Reload')
#     No filter:     (empty string)
#     Common BonusType values in GetBonus_ABC:
#       'Welcome', 'Reload', 'Referral', 'Cashback', 'Free Spin', 'Commission'
#     Note: 'Commission' type is excluded from attribution in the dashboard UI
#     because it is agent-facing, not player-facing.
#
#   [bonus_code_where]  (text filter with three match modes)
#     exact match:       AND lower(BonusCode) = lower('RELOAD50')
#     startswith:        AND startsWith(lower(BonusCode), lower('RELOAD'))
#     contains:          AND positionCaseInsensitive(BonusCode, 'reload') > 0
#     No filter:         (empty string)
#
#   [bonus_name_where]  (same three match modes as bonus_code_where)
#     exact match:       AND lower(BonusName) = lower('June Reload Bonus')
#     contains:          AND positionCaseInsensitive(BonusName, 'reload') > 0
#     No filter:         (empty string)
#
# ── GROUP BY / ROLLUP placeholders (produced by _inject_rollup_order()) ───────
#
#   These vary based on which grouping dimensions are selected in the UI.
#   Available dimensions: SITE_edit, BonusType, BonusCode, BonusName, Stakeholder
#   Example below uses [SITE_edit, BonusType] (Stakeholder NOT selected).
#
#   [MC_GROUP_BY]
#     abr.SITE_edit,
#     abr.BonusType,
#     abr.BonusCode,
#     abr.BonusName,
#     if(bsh.Stakeholder = '', '-', bsh.Stakeholder)
#
#   [FC_GROUP_BY]
#     a.SITE_edit,
#     a.BonusType,
#     a.BonusCode,
#     a.BonusName,
#     if(bsh.Stakeholder = '', '-', bsh.Stakeholder)
#
#   [STK_SELECT_MC]  (Stakeholder NOT in grouping dims → use any() for non-group rows)
#     if(abr.SITE_edit = '', '',
#        any(if(bsh.Stakeholder = '', '-', bsh.Stakeholder))
#     ) AS Stakeholder,
#
#   [STK_SELECT_FC]  (same pattern, referencing a.SITE_edit)
#     if(a.SITE_edit = '', '',
#        any(if(bsh.Stakeholder = '', '-', bsh.Stakeholder))
#     ) AS Stakeholder,
#
#   [STK_JOIN_COND]
#     Stakeholder in dims:     AND fc.Stakeholder = mc.Stakeholder
#     Stakeholder NOT in dims: (empty string)
#
#   [ROLLUP_WHERE]
#     Keeps only meaningful WITH ROLLUP rows: leaf rows (all dims non-empty),
#     the grand total (all empty), and one subtotal per group level.
#     Also filters claims > 0 to suppress empty rollup combinations.
#
#     Example for dims [SITE_edit, BonusType, BonusCode, BonusName]:
#
#     WHERE
#         (
#             (fc.SITE_edit != '' AND fc.BonusType != '' AND fc.BonusCode != '' AND fc.BonusName != '')
#             OR (fc.SITE_edit = '' AND fc.BonusType = '' AND fc.BonusCode = '' AND fc.BonusName = '')
#             OR (fc.SITE_edit != '' AND fc.BonusType = '' AND fc.BonusCode = '' AND fc.BonusName = '')
#             OR (fc.SITE_edit != '' AND fc.BonusType != '' AND fc.BonusCode = '' AND fc.BonusName = '')
#             OR (fc.SITE_edit != '' AND fc.BonusType != '' AND fc.BonusCode != '' AND fc.BonusName = '')
#         )
#         AND fc.claims > 0
#
# ── Fully substituted example (ready to run in ClickHouse) ────────────────────
#
#   Replace every placeholder in SQL_LOCAL above with:

#
#     [analysis_start]       → 2026-06-01
#     [analysis_end]         → 2026-06-30
#     [analysis_start-7d]    → 2026-05-25
#     [analysis_end+7d]      → 2026-07-07
#     [analysis_start-21d]   → 2026-05-11
#     [analysis_end+1]       → 2026-07-01
#     [analysis_end+6]       → 2026-07-06
#     [currency]             → IDR
#     [site_where]           → AND SITE_edit IN ('SiteA','SiteB')
#     [bonus_type_where]     → AND BonusType IN ('Reload')
#     [bonus_code_where]     → (delete the line)
#     [bonus_name_where]     → (delete the line)
#     [STK_SELECT_MC]        → if(abr.SITE_edit='','',any(if(bsh.Stakeholder='','-',bsh.Stakeholder))) AS Stakeholder,
#     [STK_SELECT_FC]        → if(a.SITE_edit='','',any(if(bsh.Stakeholder='','-',bsh.Stakeholder))) AS Stakeholder,
#     [MC_GROUP_BY]          → abr.SITE_edit, abr.BonusType, abr.BonusCode, abr.BonusName, if(bsh.Stakeholder='','-',bsh.Stakeholder)
#     [FC_GROUP_BY]          → a.SITE_edit, a.BonusType, a.BonusCode, a.BonusName, if(bsh.Stakeholder='','-',bsh.Stakeholder)
#     [STK_JOIN_COND]        → (delete the line)
#     [ROLLUP_WHERE]         → WHERE (...leaf/subtotal/grandtotal conditions...) AND fc.claims > 0


# ─────────────────────────────────────────────────────────────────────────────
# SOURCE TABLE SCHEMAS
# ─────────────────────────────────────────────────────────────────────────────
#
# WORKSPACE.GetBonus_ABC
#   One row per bonus claim event.
#   SITE              VARCHAR   — raw site identifier (e.g. 'MySite01')
#   SITE_edit         VARCHAR   — display-friendly site name (e.g. 'SiteA-IDR')
#   MEMBER_ID         VARCHAR   — player identifier
#   BonusTime_gmt8    DATETIME  — claim timestamp in GMT+8
#   BonusType         VARCHAR   — 'Welcome','Reload','Referral','Cashback','Free Spin','Commission'
#   BonusCode         VARCHAR   — campaign code (may be empty string → normalise to 'Undefined')
#   BonusName         VARCHAR   — campaign name (may be empty string → normalise to 'Undefined')
#   BonusAmount       DECIMAL   — amount in local currency
#   BonusStatus       VARCHAR   — 'Approved','Redeemed','Complete','Active','Completed',
#                                 'Low Balance 1','Low Balance 2','Cancelled','Expired'
#                               — query only includes the first seven (active/completed)
#   Currency          VARCHAR   — 'IDR','MYR','THB','VND'
#
# WORKSPACE.Daily_GMT8_Snapshot_A   (table A covers one subset of brands)
# WORKSPACE.Daily_GMT8_Snapshot_BC  (table BC covers the remaining brands)
#   One row per member per day.  Always UNION ALL both tables to get full coverage.
#   SITE              VARCHAR
#   MEMBER_ID         VARCHAR
#   SnapshotDate      DATE      — GMT+8 calendar date
#   Currency          VARCHAR
#   DepositAmount     DECIMAL   — local currency deposit that day
#   NGR               DECIMAL   — net gaming revenue that day (can be negative)
#   BetAmount         DECIMAL   — total bet amount (used in retention query only)
#   DepositAmount_usd DECIMAL   — DepositAmount converted to USD
#   NGR_usd           DECIMAL   — NGR converted to USD
#
# WORKSPACE.BrandStakeholders
#   Maps each site to its owner/team.  LEFT JOIN on SITE_edit.
#   SITE_edit         VARCHAR
#   Stakeholder       VARCHAR   — may be empty string → normalise to '-' in SQL
#
# WORKSPACE.dedup_CurrencyConversionRates   (USD variant only)
#   Daily FX rates; one row per currency pair per date.
#   FromCurrency      VARCHAR   — always 'USD' in this query
#   ToCurrency        VARCHAR   — local currency code
#   ConversionDate    DATE
#   ConversionRate    DECIMAL   — units of local currency per 1 USD
#                               — BonusAmount_usd = BonusAmount_local / ConversionRate


# ─────────────────────────────────────────────────────────────────────────────
# PYTHON HELPER FUNCTIONS — PLACEHOLDER INJECTION
# ─────────────────────────────────────────────────────────────────────────────
#
# Copy these into your callbacks file. They are the only code needed to turn
# SQL_LOCAL / SQL_USD into a runnable ClickHouse query.

from datetime import date, timedelta

_ALL_DIMS = ['SITE_edit', 'BonusType', 'BonusCode', 'BonusName', 'Stakeholder']

# ── Column expressions used in GROUP BY for each CTE ─────────────────────────
# FC = final_combined CTE; MC = members_counts CTE
_DIM_EXPR_FC = {
    'SITE_edit':   'a.SITE_edit',
    'BonusType':   'a.BonusType',
    'BonusCode':   'a.BonusCode',
    'BonusName':   'a.BonusName',
    'Stakeholder': "if(bsh.Stakeholder = '', '-', bsh.Stakeholder)",
}
_DIM_EXPR_MC = {
    'SITE_edit':   'abr.SITE_edit',
    'BonusType':   'abr.BonusType',
    'BonusCode':   'abr.BonusCode',
    'BonusName':   'abr.BonusName',
    'Stakeholder': "if(bsh.Stakeholder = '', '-', bsh.Stakeholder)",
}


def _compute_date_params(start_date: str, end_date: str) -> dict:
    """Return all date placeholder → value mappings.

    start_date / end_date: ISO strings, e.g. '2026-06-01' / '2026-06-30'
    """
    d_start = date.fromisoformat(start_date)
    d_end   = date.fromisoformat(end_date)
    return {
        '[analysis_start]':    start_date,
        '[analysis_end]':      end_date,
        '[analysis_end+1]':    (d_end   + timedelta(days=1) ).isoformat(),
        '[analysis_end+6]':    (d_end   + timedelta(days=6) ).isoformat(),
        '[analysis_end+7d]':   (d_end   + timedelta(days=7) ).isoformat(),
        '[analysis_start-7d]': (d_start - timedelta(days=7) ).isoformat(),
        '[analysis_start-21d]':(d_start - timedelta(days=21)).isoformat(),
    }


def _inject_dates(sql: str, params: dict) -> str:
    """Replace every date placeholder and [currency] token in sql."""
    for k, v in params.items():
        sql = sql.replace(k, v)
    return sql


def _text_filter_sql(col: str, value: str, match_type: str) -> str:
    """Return a SQL AND clause for a text filter, or '' if no value.

    match_type: 'exact' | 'startswith' | 'contains'
    Single quotes in value are escaped by doubling.
    """
    if not value:
        return ''
    v = value.replace("'", "''")
    if match_type == 'exact':
        return f"AND lower({col}) = lower('{v}')"
    elif match_type == 'startswith':
        return f"AND startsWith(lower({col}), lower('{v}'))"
    else:
        return f"AND positionCaseInsensitive({col}, '{v}') > 0"


def _list_filter_sql(col: str, values: list) -> str:
    """Return AND col IN (...) clause, or '' if values is empty."""
    if not values:
        return ''
    escaped = ', '.join(f"'{v.replace(chr(39), chr(39)*2)}'" for v in values)
    return f"AND {col} IN ({escaped})"


def _inject_all_filters(sql: str, cache: dict) -> str:
    """Substitute all four filter placeholders from the UI selections stored in cache.

    cache keys used:
      selected_sites       list[str]  — SITE_edit values; [] = no filter
      selected_bonus_types list[str]  — BonusType values; [] = no filter
      bonus_code_filter    str        — text filter value; '' = no filter
      bonus_code_match     str        — 'exact' | 'startswith' | 'contains'
      bonus_name_filter    str        — text filter value
      bonus_name_match     str        — match mode
    """
    sql = sql.replace('[site_where]',
                      _list_filter_sql('SITE_edit', cache.get('selected_sites', [])))
    sql = sql.replace('[bonus_type_where]',
                      _list_filter_sql('BonusType', cache.get('selected_bonus_types', [])))
    sql = sql.replace('[bonus_code_where]',
                      _text_filter_sql('BonusCode',
                                       cache.get('bonus_code_filter', ''),
                                       cache.get('bonus_code_match', 'exact')))
    sql = sql.replace('[bonus_name_where]',
                      _text_filter_sql('BonusName',
                                       cache.get('bonus_name_filter', ''),
                                       cache.get('bonus_name_match', 'exact')))
    return sql


def _build_rollup_where(dims: list) -> str:
    """Build the WHERE clause that keeps only meaningful WITH ROLLUP rows.

    WITH ROLLUP produces a row for every GROUP BY prefix combination, including
    many that are nonsensical (e.g. BonusType filled but SITE_edit empty).
    This function keeps only:
      - Leaf rows           — all dims non-empty
      - Grand total row     — all dims empty
      - One subtotal per prefix level (dims[:1], dims[:2], …, dims[:n-1])
        where the prefix dims are non-empty and all trailing dims are empty

    When Stakeholder is NOT in dims it is excluded from the rollup sentinel logic
    because it uses any() in the SELECT (no empty-string '' marker in ROLLUP rows).

    Also filters claims > 0 to suppress zero-activity rollup combinations.
    """
    _NON_STK  = [d for d in _ALL_DIMS if d != 'Stakeholder']
    eff_dims  = _ALL_DIMS if 'Stakeholder' in dims else _NON_STK
    all_dims  = dims + [d for d in eff_dims if d not in dims]

    detail = ' AND '.join(f"fc.{d} != ''" for d in eff_dims)
    grand  = ' AND '.join(f"fc.{d} = ''"  for d in eff_dims)
    clauses = [f'({detail})', f'({grand})']

    for i in range(1, len(dims) + 1):
        filled = ' AND '.join(f"fc.{d} != ''" for d in all_dims[:i])
        empty  = ' AND '.join(f"fc.{d} = ''"  for d in all_dims[i:])
        if empty:
            clauses.append(f'({filled} AND {empty})')

    return ('WHERE\n    (\n        '
            + '\n        OR '.join(clauses)
            + '\n    )\n    AND fc.claims > 0')


def _inject_rollup_order(sql: str, dims: list) -> str:
    """Substitute the five GROUP BY / STK / ROLLUP_WHERE placeholders.

    dims: ordered list of user-selected grouping dimensions, e.g.
          ['SITE_edit', 'BonusType']   (outermost first)
    Valid dim names: 'SITE_edit', 'BonusType', 'BonusCode', 'BonusName', 'Stakeholder'
    Default (no selection): ['SITE_edit', 'BonusType']
    """
    _NON_STK     = [d for d in _ALL_DIMS if d != 'Stakeholder']
    stk_in_dims  = 'Stakeholder' in dims
    rollup_order = (dims + [d for d in _ALL_DIMS    if d not in dims]
                    if stk_in_dims
                    else dims + [d for d in _NON_STK if d not in dims])

    _stk_direct = "if(bsh.Stakeholder = '', '-', bsh.Stakeholder) AS Stakeholder,"
    stk_expr_mc = (_stk_direct if stk_in_dims
                   else "if(abr.SITE_edit = '', '', any(if(bsh.Stakeholder = '', '-', bsh.Stakeholder))) AS Stakeholder,")
    stk_expr_fc = (_stk_direct if stk_in_dims
                   else "if(a.SITE_edit = '', '', any(if(bsh.Stakeholder = '', '-', bsh.Stakeholder))) AS Stakeholder,")
    stk_join    = ("    AND fc.Stakeholder = mc.Stakeholder" if stk_in_dims else "")

    sql = sql.replace('[FC_GROUP_BY]',   ',\n        '.join(_DIM_EXPR_FC[d] for d in rollup_order))
    sql = sql.replace('[MC_GROUP_BY]',   ',\n             '.join(_DIM_EXPR_MC[d] for d in rollup_order))
    sql = sql.replace('[STK_SELECT_MC]', stk_expr_mc)
    sql = sql.replace('[STK_SELECT_FC]', stk_expr_fc)
    sql = sql.replace('[STK_JOIN_COND]', stk_join)
    sql = sql.replace('[ROLLUP_WHERE]',  _build_rollup_where(dims))
    return sql


# ── Putting it all together — building the final SQL ─────────────────────────
#
# Example: run the local-currency attribution query for June 2026, IDR, all sites.
#
#   start_date = '2026-06-01'
#   end_date   = '2026-06-30'
#   currency   = 'IDR'
#   dims       = ['SITE_edit', 'BonusType']   # outermost grouping first
#
#   date_params = _compute_date_params(start_date, end_date)
#   date_params['[currency]'] = currency       # add currency into the same dict
#
#   cache = {
#       'selected_sites':       ['SiteA', 'SiteB'],   # [] for all sites
#       'selected_bonus_types': ['Reload'],            # [] for all types
#       'bonus_code_filter':    '',
#       'bonus_code_match':     'exact',
#       'bonus_name_filter':    '',
#       'bonus_name_match':     'exact',
#   }
#
#   sql = _inject_rollup_order(
#       _inject_all_filters(
#           _inject_dates(SQL_LOCAL, date_params),
#           cache,
#       ),
#       dims,
#   )
#
#   # Execute with your ClickHouse client — e.g.:
#   df = clickhouse_client.execute_query(sql)


# ─────────────────────────────────────────────────────────────────────────────
# POST-QUERY PROCESSING — SPLITTING ROLLUP ROWS
# ─────────────────────────────────────────────────────────────────────────────
#
# WITH ROLLUP returns three categories of rows in a single result set.
# You must split them before rendering.
#
# ROLLUP row classification
# ─────────────────────────
# ClickHouse WITH ROLLUP fills in empty strings ('') for the GROUP BY columns
# that have been aggregated away at each rollup level.
#
# For dims = ['SITE_edit', 'BonusType', 'BonusCode', 'BonusName']:
#
#   Category        first_empty_dim_index   Example (SITE_edit | BonusType | BonusCode | BonusName)
#   ─────────────   ─────────────────────   ──────────────────────────────────────────────────────
#   Grand total     0 (all empty)           ''  | ''  | ''  | ''
#   Subtotal L1     1                       'SiteA' | '' | '' | ''
#   Subtotal L2     2                       'SiteA' | 'Reload' | '' | ''
#   Subtotal L3     3                       'SiteA' | 'Reload' | 'RELOAD50' | ''
#   Leaf row        4 (none empty)          'SiteA' | 'Reload' | 'RELOAD50' | 'June Reload Bonus'
#
# Note: Stakeholder is excluded from this check when not in dims, because it
# uses any() in SELECT and does NOT produce '' in ROLLUP rows.
#
# Python classification algorithm:
#
#   import pandas as pd
#
#   _NON_STK     = [d for d in _ALL_DIMS if d != 'Stakeholder']
#   rollup_order = (dims + [d for d in _ALL_DIMS    if d not in dims]
#                   if 'Stakeholder' in dims
#                   else dims + [d for d in _NON_STK if d not in dims])
#
#   leaf_rows  = []
#   gt_row     = None
#   subtotals  = {}   # frozenset(non-empty-dim-names) → {(val,…): row_dict}
#
#   for _, row in df.iterrows():
#       vals        = [str(row.get(d) or '').strip() for d in rollup_order]
#       first_empty = next((i for i, v in enumerate(vals) if not v), len(rollup_order))
#
#       if first_empty == 0:
#           gt_row = row.to_dict()                     # grand total
#       elif first_empty == len(rollup_order):
#           leaf_rows.append(row.to_dict())            # genuine leaf row
#       else:
#           non_empty = rollup_order[:first_empty]
#           key       = frozenset(non_empty)
#           subtotals.setdefault(key, {})[tuple(vals[:first_empty])] = row.to_dict()
#
#   leaf_df = pd.DataFrame(leaf_rows)
#
# DERIVED COLUMNS — compute from raw SQL output columns
# ──────────────────────────────────────────────────────
# The SQL returns raw ratio columns; the dashboard renames and scales them:
#
#   SQL column          Dashboard column    Transformation
#   ──────────────────  ──────────────────  ─────────────────────────────────
#   unique_members      claimants           rename only
#   bonus_per_member    cost_per_member     rename only
#   ngr_per_bonus       bonus_ngr_pct       × 100  (multiply by 100 for %)
#   roi_perc            roi_pct             × 100
#   avg_conf            confidence_pct      × 100
#
# Example:
#   leaf_df.rename(columns={'unique_members': 'claimants',
#                           'bonus_per_member': 'cost_per_member'}, inplace=True)
#   leaf_df['bonus_ngr_pct']  = (leaf_df['ngr_per_bonus'] * 100).round(1)
#   leaf_df['roi_pct']        = (leaf_df['roi_perc']      * 100).round(1)
#   leaf_df['confidence_pct'] = (leaf_df['avg_conf']      * 100).round(1)
#   leaf_df.drop(columns=['ngr_per_bonus', 'roi_perc', 'avg_conf'], inplace=True)
#
# SUBTOTAL & GRAND TOTAL ROWS — re-compute ratios from summed values
# ──────────────────────────────────────────────────────────────────
# SQL ratios (ngr_per_bonus, roi_perc) can be NULL for ROLLUP rows because
# the JOIN to members_counts doesn't always propagate them.
# Always re-compute them from the summed columns in Python:
#
#   for row_dict in subtotal_rows + [gt_row]:
#       bc       = float(row_dict.get('bonus_cost') or 0)
#       t1_ngr   = float(row_dict.get('t1_ngr')    or 0)
#       ngr_lift = float(row_dict.get('ngr_lift')  or 0)
#       row_dict['bonus_ngr_pct'] = round(t1_ngr   / bc * 100, 1) if bc else None
#       row_dict['roi_pct']       = round(ngr_lift  / bc * 100, 1) if bc else None

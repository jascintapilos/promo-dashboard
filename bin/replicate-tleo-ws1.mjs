#!/usr/bin/env node
// Replicate 10 FT_REL_TLEO_* codes to WS1 MY (kioskmy.best-in-asia.com).
// Uses iGMP API path with the auto-T&C builder. Note: iGMP /PM/AddBonus has
// no category-restriction field — LC/Slot narrowing isn't expressible at this
// level (would be a separate game-restriction config). Promo description
// preserves the source's "Live Casino only" / "Slot only" admin label for
// reference.
//
// Usage:
//   node bin/replicate-tleo-ws1.mjs --dry-run
//   node bin/replicate-tleo-ws1.mjs --commit
//   node bin/replicate-tleo-ws1.mjs --commit --code=FT_REL_TLEO_LC_20PCT_20MX_BR

import fs from 'node:fs';
import { parseArgs } from './_args.js';
import { buildIgmpPlan } from '../src/api-mapper-igmp.js';
import { igmpPost } from '../src/igmp-client.js';

const { flags } = parseArgs(process.argv.slice(2));
const commit = flags.commit === true;
const dryRun = !commit;
const codeFilter = flags.code ? String(flags.code) : null;

const SITE_ID = 'ws1-v3-my';
const raw = JSON.parse(fs.readFileSync('tmp/tleo-raw.json', 'utf8'));

// Build a `rec` for the IGMP mapper from each source code.
function buildIgmpRec(sourceCode, sourceData) {
  const m = sourceData.main;
  const srcMyr = sourceData.currencies.find((c) => c.currency === 'MYR') || sourceData.currencies[0];
  const min_deposit = Number(srcMyr.min_transfer);
  const max_bonus = Number(srcMyr.max_bonus);
  const to = m.target?.[0]?.multiplier ?? 0;
  const bonusRate = Number(m.bonus_rate) || 0;

  const nameEn = sourceData.names.find((n) => n.locale === 'MY_EN')?.promotion_name || sourceCode;
  const nameZh = sourceData.names.find((n) => n.locale === 'MY_ZH')?.promotion_name || nameEn;

  return {
    promo_code: sourceCode,                  // mapper auto-prefixes FT_ if missing (already has it)
    promotion_name: nameEn,
    promotion_name_en: nameEn,
    promotion_name_zh_id: nameZh,
    column_m: m.name,                        // source admin label → PromotionDescription
    description: m.name,
    bonus_type: 'Deposit',
    bonus_sub_type: 'Reload',
    min_deposit,
    bonus_pct: bonusRate,
    turnover_multiplier: to,
    cap_bonus_amount: max_bonus,
    max_bonus,
    reward_type: 0,                          // Percentage Based
    rollover_type: 0,                        // Percentage Based
    redeemable_quantity: 999999,
    redeemable_count: 0,
    kyc_level: 0,                            // BASIC,ADVANCED,PRO
    redeemable_days: null,                   // all-week
    redeemable_start_time: '00:00',
    redeemable_end_time: '23:59',
    expiry_minutes_ws1: 1440,                // 1 day
    withdrawal_cap: 0,
    maximum_balance: 0,
    fixed_bonus_amount: 0,
    fixed_rollover_amount: 0,
    region: 'MY',                            // for ZH T&C trigger
    currencies: ['MYR'],
    locales: ['MY_EN', 'MY_ZH'],
    parsed: {
      bonus_rate_pct: bonusRate,
      max_bonus,
      min_deposit,
      to_multiplier: to,
      game: 'All games',
    },
  };
}

const results = { mode: dryRun ? 'dry-run' : 'commit', site: SITE_ID, byCode: {} };
const codesToRun = codeFilter ? [codeFilter] : Object.keys(raw);

console.log(`\n━━━ WS1 MY (${SITE_ID}) ━━━`);
for (const code of codesToRun) {
  const sourceData = raw[code];
  if (!sourceData) { console.log(`  SKIP ${code}: not in source dataset`); continue; }
  try {
    const rec = buildIgmpRec(code, sourceData);
    const plan = buildIgmpPlan(rec, { siteId: SITE_ID });

    if (dryRun) {
      console.log(`  DRY ${code}: code=${plan.body.PromotionCode} min_dep=${plan.body.PromotionRewards[0].MinimumActionAmount} pct=${plan.body.PromotionRewards[0].BonusPercentage} cap=${plan.body.PromotionRewards[0].CapBonusAmount} RO=${plan.body.PromotionRewards[0].RolloverMultiplier} locales=${plan.body.PromotionRewards[0].PromotionRewardContents.map((c)=>c.Locale).join(',')}`);
      results.byCode[code] = { status: 'dry-run', body: plan.body };
      continue;
    }

    const res = await igmpPost(SITE_ID, plan.endpoint, plan.body);
    const success = res?.success === true || res?.data?.Promotion?.PromotionId != null;
    const promoId = res?.data?.Promotion?.PromotionId ?? res?.data?.PromotionId ?? null;
    if (success) {
      console.log(`  ✓ POST ${plan.endpoint} ← ${code}, PromotionId=${promoId ?? '(not in response)'}`);
      results.byCode[code] = { status: 'created', promotion_id: promoId, message: res?.message };
    } else {
      console.log(`  ✗ POST ${plan.endpoint} ← ${code}, failed: ${JSON.stringify(res).slice(0, 300)}`);
      results.byCode[code] = { status: 'error', response: res };
    }
  } catch (e) {
    console.log(`  ERROR ${code}: ${e.message.slice(0, 300)}`);
    results.byCode[code] = { status: 'error', error: String(e.message) };
  }
}

const outPath = dryRun ? 'tmp/tleo-ws1-dryrun.json' : 'tmp/tleo-ws1-results.json';
fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
console.log(`\nWrote ${outPath}`);

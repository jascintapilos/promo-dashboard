#!/usr/bin/env node
// Create FT_REL_TLEO_LC_45PCT_138MX on QPRO2.
// Uses the source data from FT_REL_TLEO_LC_45PCT_138MX_BR (id=442 on QPRO2)
// but registers it under the new code name without the _BR suffix.
// GP IDs used as-is (QPRO2 source ids need no mapping).
//
// Usage:
//   node bin/_create-138mx-qpro2.mjs --dry-run
//   node bin/_create-138mx-qpro2.mjs --commit

import fs from 'node:fs';
import { parseArgs } from './_args.js';
import {
  createPromotion, addPromotionName, createMessageTemplate,
  updatePromotion, findPromotionByCode, authedFetch,
} from '../src/api-client.js';
import { getSite } from '../src/sites.js';
import { buildApiPlan } from '../src/api-mapper-qpro.js';

const { flags } = parseArgs(process.argv.slice(2));
const commit = flags.commit === true;
const dryRun = !commit;

const CODE     = 'FT_REL_TLEO_LC_45PCT_138MX';
const TARGET   = { id: 'qpro2', brand: 'QPRO2', currencies: ['MYR', 'SGD'], locales: ['MY_EN', 'MY_ZH', 'SG_EN', 'SG_ZH'] };

const raw       = JSON.parse(fs.readFileSync('tmp/tleo-raw.json', 'utf8'));
const templates = JSON.parse(fs.readFileSync('tmp/tleo-templates.json', 'utf8'));
const sourceData = raw[CODE];
if (!sourceData) throw new Error(`${CODE} not found in tleo-raw.json`);

const m = sourceData.main;

// Source gp_ids are already QPRO2 IDs — use directly
const gpIds = m.target?.[0]?.game_provider_ids || [];
const arrayToIntObj = (arr) => Object.fromEntries(arr.map((id, i) => [String(i), id]));

const srcMyr = sourceData.currencies.find(c => c.currency === 'MYR');
const srcSgd = sourceData.currencies.find(c => c.currency === 'SGD');

const nameEn = sourceData.names.find(n => n.locale === 'MY_EN')?.promotion_name || CODE;
const nameZh = sourceData.names.find(n => n.locale === 'MY_ZH')?.promotion_name || nameEn;

const per_currency_overrides = {
  MYR: { min_deposit: Number(srcMyr.min_transfer), max_bonus: Number(srcMyr.max_bonus) },
  SGD: { min_deposit: Number(srcSgd?.min_transfer ?? srcMyr.min_transfer), max_bonus: Number(srcSgd?.max_bonus ?? srcMyr.max_bonus) },
};

const resolved = {
  promo_code: CODE,
  name_details_raw: m.name,
  bonus_type: 'Deposit',
  bonus_sub_type: 'Reload',
  validity_days: m.validity ?? 1,
  rewards_validity_days: m.reward_validity ?? 1,
  recurring: m.recurring === 1 || m.recurring === true,
  max_per_player: m.max_per_player ?? 999999,
  daily_max: m.daily_max ?? 999999,
  currencies: TARGET.currencies,
  locales: TARGET.locales,
  promotion_name_en: nameEn,
  promotion_name_zh_id: nameZh,
  inbox_message: true,
  popup_dialog: false,
  parsed: {
    bonus_rate_pct: Number(m.bonus_rate) || 45,
    max_bonus: Number(srcMyr.max_bonus),
    min_deposit: Number(srcMyr.min_transfer),
    to_multiplier: m.target?.[0]?.multiplier ?? 8,
    game: 'All games',
  },
  per_currency_overrides,
  instructions: {
    code_name_override: null,
    duplicate_source: null,
    tier_constraint: null,
    add_test_prefix: false,
    code_prefixes: [],
    categories_only: ['live casino'],
  },
};

const site = getSite(TARGET.id);
const plan = await buildApiPlan(resolved, { brand: TARGET.brand, site });

// Plug source gp_ids directly (no mapping needed — source IS QPRO2)
plan.promotion.game_provider_ids = arrayToIntObj(gpIds);
if (plan.promotion.target?.['0']) {
  plan.promotion.target['0'].game_provider_ids = arrayToIntObj(gpIds);
}

// Source MT details (locales 1=MY_EN, 3=MY_ZH, 6=SG_EN, 7=SG_ZH)
const mtId = m.message_template_id;
const tpl  = templates[mtId];
const localeToId = { MY_EN: '1', MY_ZH: '3', SG_EN: '6', SG_ZH: '7' };
if (tpl && plan.messageTemplate) {
  const details = {};
  for (const loc of TARGET.locales) {
    const lid = localeToId[loc];
    if (lid && tpl.details[lid]) details[lid] = {
      settings_locale_id: Number(lid),
      subject: tpl.details[lid].subject,
      message: tpl.details[lid].message,
    };
  }
  if (Object.keys(details).length) plan.messageTemplate.details = details;
}

console.log(`\n━━━ ${TARGET.brand} ━━━`);
console.log(`  Code:        ${CODE}`);
console.log(`  Currencies:  ${TARGET.currencies.join(', ')}`);
console.log(`  Locales:     ${TARGET.locales.join(', ')}`);
console.log(`  GP IDs:      ${gpIds.length} LC providers`);
console.log(`  MYR:         min=${srcMyr.min_transfer} max=${srcMyr.max_bonus}`);
console.log(`  SGD:         min=${srcSgd?.min_transfer} max=${srcSgd?.max_bonus}`);
console.log(`  MT locales:  ${plan.messageTemplate ? Object.keys(plan.messageTemplate.details).join(',') : 'none'}`);
console.log(`  Names:       ${plan.buildNames(99999).length}`);

if (dryRun) {
  console.log('\n  [DRY-RUN] No changes made. Re-run with --commit to create.');
  process.exit(0);
}

// Idempotency check
const existing = await findPromotionByCode(site, CODE);
if (existing) {
  console.log(`  SKIP: already exists id=${existing.id}`);
  process.exit(0);
}

// POST promotion
const created = await createPromotion(site, plan.promotion);
const promoId = created.data?.rows?.id || created.data?.id;
if (!promoId) throw new Error(`No id in createPromotion response: ${JSON.stringify(created).slice(0, 300)}`);
console.log(`  ✓ POST promotion → id=${promoId}`);

// POST message template
plan.messageTemplate.code = `PROMOTIONS.MESSAGE.${CODE}`;
plan.messageTemplate.name = CODE;
const mtRes = await createMessageTemplate(site, plan.messageTemplate);
const newMtId = mtRes.data?.rows?.id || mtRes.data?.id;
console.log(`  ✓ POST message_template → id=${newMtId}`);

// POST per-locale names
const nameBodies = plan.buildNames(promoId);
for (const nb of nameBodies) await addPromotionName(site, nb);
console.log(`  ✓ POST names × ${nameBodies.length}`);

// PUT to link MT
const putBody = plan.buildUpdate(promoId, newMtId, null);
await updatePromotion(site, promoId, putBody);
console.log(`  ✓ PUT → linked MT id=${newMtId}`);

// Apply blacklist sub-categories from the source Bronze code (id=442)
console.log(`\n  Applying blacklist from source id=442...`);
const srcDet = await authedFetch(site, `/api/bo/promotion/442`);
const blsc = srcDet.data.rows.blacklist_sub_categories || [];

if (blsc.length > 0) {
  // Build srcMap: provider_code → Set(lowercase sub_cat_names)
  const srcMap = {};
  for (const item of blsc) {
    const arr = Array.isArray(item.sub_category_name) ? item.sub_category_name : [item.sub_category_name];
    srcMap[item.game_provider_code] = new Set(arr.map(s => String(s).toLowerCase()));
  }

  // Fetch the blacklistgame list for new promo
  const bg = await authedFetch(site, '/api/bo/promotion/blacklistgame', {
    method: 'POST',
    body: { promotion_id: promoId, game_provider_ids: gpIds, categories: ['LIVE CASINO'] },
  });
  const rows = bg.data?.rows || [];

  let marked = 0;
  const providersHit = new Set();
  for (const r of rows) {
    const srcSubs = srcMap[r.game_provider_code];
    if (!srcSubs) continue;
    for (const sc of r.sub_categories) {
      if (srcSubs.has(String(sc.name).toLowerCase())) {
        sc.status = 1;
        marked++;
        providersHit.add(r.game_provider_code);
      }
    }
  }

  await authedFetch(site, '/api/bo/promotion/updateblacklistgame', {
    method: 'POST',
    body: { promotion_id: promoId, black_list_sub_categories: rows },
  });
  console.log(`  ✓ Blacklist: marked ${marked} sub-cats across ${providersHit.size} providers`);
} else {
  console.log(`  ℹ Blacklist: source id=442 has 0 entries — nothing to apply`);
}

// Final QC
const ck = await authedFetch(site, `/api/bo/promotion/${promoId}`);
const ckMain = ck.data.rows;
console.log(`\n  QC:`);
console.log(`    id:                    ${ckMain.id}`);
console.log(`    code:                  ${ckMain.code}`);
console.log(`    status:                ${ckMain.status}`);
console.log(`    bonus_rate:            ${ckMain.bonus_rate}`);
console.log(`    message_template_id:   ${ckMain.message_template_id}`);
console.log(`    blacklist_sub_cats:    ${(ckMain.blacklist_sub_categories||[]).length}`);
console.log(`    gp_ids (target[0]):    ${ckMain.target?.[0]?.game_provider_ids?.length}`);

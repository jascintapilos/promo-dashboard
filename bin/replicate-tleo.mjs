#!/usr/bin/env node
// Replicate 10 FT_REL_TLEO_* codes from QPRO2 → 5 QPRO targets (QPRO3/4/6/8/10) + WS1 MY.
//
// Usage:
//   node bin/replicate-tleo.mjs --dry-run               # build all plans, no network IO
//   node bin/replicate-tleo.mjs --dry-run --brand=qpro4 # one brand only
//   node bin/replicate-tleo.mjs --commit                # live (all targets, all codes)
//   node bin/replicate-tleo.mjs --commit --brand=qpro4  # live, one brand
//   node bin/replicate-tleo.mjs --commit --code=FT_REL_TLEO_LC_20PCT_20MX_BR --brand=qpro4
//
// Reads tmp/tleo-raw.json (source state), tmp/tleo-templates.json (source MTs),
// tmp/qpro2-catalog.json (source gp lookup), tmp/target-catalogs.json (per-target lookups).

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from './_args.js';
import {
  createPromotion, addPromotionName, createMessageTemplate,
  updatePromotion, findPromotionByCode,
} from '../src/api-client.js';
import { getSite } from '../src/sites.js';
import { buildApiPlan } from '../src/api-mapper-qpro.js';

const { flags } = parseArgs(process.argv.slice(2));
const commit = flags.commit === true;
const dryRun = flags['dry-run'] === true || !commit;
const brandFilter = flags.brand ? String(flags.brand).toLowerCase() : null;
const codeFilter = flags.code ? String(flags.code) : null;

const TARGETS = [
  { id: 'qpro3',  brand: 'QPRO3',  currencies: ['MYR', 'SGD'], locales: ['MY_EN', 'MY_ZH', 'SG_EN', 'SG_ZH'] },
  { id: 'qpro4',  brand: 'QPRO4',  currencies: ['MYR'],         locales: ['MY_EN', 'MY_ZH'] },
  { id: 'qpro6',  brand: 'QPRO6',  currencies: ['MYR'],         locales: ['MY_EN', 'MY_ZH'] },
  { id: 'qpro8',  brand: 'QPRO8',  currencies: ['MYR'],         locales: ['MY_EN', 'MY_ZH'] },
  { id: 'qpro10', brand: 'QPRO10', currencies: ['MYR'],         locales: ['MY_EN', 'MY_ZH'] },
];

const raw = JSON.parse(fs.readFileSync('tmp/tleo-raw.json', 'utf8'));
const templates = JSON.parse(fs.readFileSync('tmp/tleo-templates.json', 'utf8'));
const sourceCat = JSON.parse(fs.readFileSync('tmp/qpro2-catalog.json', 'utf8'));
const targetCats = JSON.parse(fs.readFileSync('tmp/target-catalogs.json', 'utf8'));

// Resolve source target.game_provider_ids → source provider CODES, then per-target → ids.
function mapGpIdsToTarget(sourceGpIds, targetId) {
  const targetCat = targetCats[targetId];
  if (!targetCat) throw new Error(`no catalog for target ${targetId}`);
  const resolved = [];
  const missingCodes = [];
  for (const id of sourceGpIds) {
    const srcProvider = sourceCat.providers_by_id[id];
    if (!srcProvider) { missingCodes.push(`id=${id}`); continue; }
    const code = String(srcProvider.code || '').toUpperCase();
    const targetEntry = targetCat.providers_by_code[code];
    if (!targetEntry) { missingCodes.push(code); continue; }
    resolved.push(targetEntry.id);
  }
  return { ids: resolved.sort((a, b) => a - b), missingCodes };
}

// Build the synthetic `resolved` record that drives buildApiPlan.
function buildResolved(sourceCode, sourceData, target) {
  const m = sourceData.main;
  const isLC = /_LC_|^FT_REL_TLEO_LC_/.test(sourceCode);

  // Per-currency overrides — copy source's MYR row only (SGD on source mirrors MYR per probe).
  const srcMyr = sourceData.currencies.find((c) => c.currency === 'MYR') || sourceData.currencies[0];
  const min_deposit = Number(srcMyr.min_transfer);
  const max_bonus = Number(srcMyr.max_bonus);

  const per_currency_overrides = {};
  for (const ccy of target.currencies) {
    const srcCcy = sourceData.currencies.find((c) => c.currency === ccy) || srcMyr;
    per_currency_overrides[ccy] = {
      min_deposit: Number(srcCcy.min_transfer),
      max_bonus: Number(srcCcy.max_bonus),
    };
  }

  // Source promotion_name rows — keep EN/ZH text identical
  const nameEn = sourceData.names.find((n) => n.locale === 'MY_EN')?.promotion_name || sourceCode;
  const nameZh = sourceData.names.find((n) => n.locale === 'MY_ZH')?.promotion_name || nameEn;

  const to = m.target?.[0]?.multiplier ?? (isLC ? 8 : 3);
  const bonusRate = Number(m.bonus_rate) || (sourceCode.match(/_(\d+)PCT_/) ? Number(sourceCode.match(/_(\d+)PCT_/)[1]) : 0);

  return {
    promo_code: sourceCode,             // already the target code (user-listed)
    name_details_raw: m.name,           // becomes BO admin `name`
    bonus_type: 'Deposit',
    bonus_sub_type: 'Reload',
    validity_days: m.validity ?? 1,
    rewards_validity_days: m.reward_validity ?? 1,
    recurring: m.recurring === 1 || m.recurring === true,
    max_per_player: m.max_per_player ?? 999999,
    daily_max: m.daily_max ?? 999999,
    currencies: target.currencies,
    locales: target.locales,
    promotion_name_en: nameEn,
    promotion_name_zh_id: nameZh,
    inbox_message: true,
    popup_dialog: false,
    parsed: {
      bonus_rate_pct: bonusRate,
      max_bonus,
      min_deposit,
      to_multiplier: to,
      game: 'All games',
    },
    per_currency_overrides,
    instructions: {
      code_name_override: null,
      duplicate_source: null,
      tier_constraint: null,
      add_test_prefix: false,
      code_prefixes: [],
      categories_only: isLC ? ['live casino'] : ['slots'],
    },
  };
}

// Build the source MT details adapted for the new target promo_code.
function buildMtDetailsFromSource(sourceData, target) {
  const mtId = sourceData.main.message_template_id;
  if (!mtId || !templates[mtId]) return null;
  const tpl = templates[mtId];
  const details = {};
  // Only locales that exist on target brand.
  const localeToId = { MY_EN: '1', MY_ZH: '3', SG_EN: '6', SG_ZH: '7' };
  for (const locale of target.locales) {
    const id = localeToId[locale];
    if (id && tpl.details[id]) details[id] = {
      settings_locale_id: Number(id),
      subject: tpl.details[id].subject,
      message: tpl.details[id].message,
    };
  }
  return Object.keys(details).length ? details : null;
}

// Build POST body for promotion — uses mapper plan + GP override.
async function buildPromotionPost(sourceCode, sourceData, target) {
  const resolved = buildResolved(sourceCode, sourceData, target);
  const site = getSite(target.id);
  const plan = await buildApiPlan(resolved, { brand: target.brand, site });
  // GP override: use source's per-bonus-type provider list, mapped to target brand IDs.
  const sourceTargetIds = sourceData.main.target?.[0]?.game_provider_ids || [];
  const { ids: gpIdsForTarget, missingCodes } = mapGpIdsToTarget(sourceTargetIds, target.id);
  if (missingCodes.length) {
    console.log(`    [GP-MAP] ${target.brand}/${sourceCode}: ${missingCodes.length} unmapped source providers: ${missingCodes.join(',')}`);
  }
  // Plug per-brand gp_ids into both top-level and target[0].
  const arrayToIntObj = (arr) => Object.fromEntries(arr.map((id, i) => [String(i), id]));
  plan.promotion.game_provider_ids = arrayToIntObj(gpIdsForTarget);
  if (plan.promotion.target && plan.promotion.target['0']) {
    plan.promotion.target['0'].game_provider_ids = arrayToIntObj(gpIdsForTarget);
  }
  // MT override: use source's actual subject/body content.
  if (plan.messageTemplate) {
    const sourceDetails = buildMtDetailsFromSource(sourceData, target);
    if (sourceDetails) {
      plan.messageTemplate.details = sourceDetails;
    }
  }
  return { plan, gpIdsForTarget, missingCodes };
}

async function executeReplication(target, sourceCode) {
  const sourceData = raw[sourceCode];
  if (!sourceData) { console.log(`  SKIP ${target.brand}/${sourceCode}: not in source dataset`); return null; }

  const site = getSite(target.id);
  // Idempotency check
  const existing = await findPromotionByCode(site, sourceCode);
  if (existing) {
    console.log(`  SKIP ${target.brand}/${sourceCode}: already exists id=${existing.id}`);
    return { status: 'exists', id: existing.id };
  }

  const { plan, gpIdsForTarget, missingCodes } = await buildPromotionPost(sourceCode, sourceData, target);

  if (dryRun) {
    console.log(`  DRY ${target.brand}/${sourceCode}: gp_ids=${gpIdsForTarget.length}, MT details=${plan.messageTemplate ? Object.keys(plan.messageTemplate.details).length : 0} locales, names=${plan.buildNames(99999).length}`);
    return {
      status: 'dry-run',
      promotion_body: plan.promotion,
      message_template_body: plan.messageTemplate,
      name_bodies_preview: plan.buildNames(99999),
      gp_ids_count: gpIdsForTarget.length,
      unmapped: missingCodes,
    };
  }

  // ── Live: POST promo
  const created = await createPromotion(site, plan.promotion);
  const promoId = created.data?.rows?.id || created.data?.id;
  if (!promoId) throw new Error(`createPromotion: no id in response: ${JSON.stringify(created).slice(0, 300)}`);
  console.log(`  POST promotion → id=${promoId}`);

  // POST MT
  let mtId = null;
  if (plan.messageTemplate) {
    // Make MT code+name unique per target brand (else BO 422 if same code already exists)
    plan.messageTemplate.code = `PROMOTIONS.MESSAGE.${sourceCode}`;
    plan.messageTemplate.name = sourceCode;
    const mtRes = await createMessageTemplate(site, plan.messageTemplate);
    mtId = mtRes.data?.rows?.id || mtRes.data?.id;
    console.log(`  POST message_template → id=${mtId}`);
  }

  // POST per-locale names
  const nameBodies = plan.buildNames(promoId);
  for (const nb of nameBodies) {
    await addPromotionName(site, nb);
  }
  console.log(`  POST names × ${nameBodies.length}`);

  // PUT to link MT
  if (mtId) {
    const putBody = plan.buildUpdate(promoId, mtId, null);
    await updatePromotion(site, promoId, putBody);
    console.log(`  PUT promotion → linked MT`);
  }

  return { status: 'created', id: promoId, mt_id: mtId, names: nameBodies.length };
}

// ── Main ─────────────────────────────────────────────────────────────────
const results = { mode: dryRun ? 'dry-run' : 'commit', byBrand: {} };
const targetsToRun = brandFilter ? TARGETS.filter((t) => t.id === brandFilter) : TARGETS;
const codesToRun = codeFilter ? [codeFilter] : Object.keys(raw);

for (const target of targetsToRun) {
  console.log(`\n━━━ ${target.brand} (${target.id}) — ${target.currencies.join('+')} ━━━`);
  results.byBrand[target.brand] = {};
  for (const code of codesToRun) {
    if (!raw[code]) { console.log(`  SKIP ${code}: not in source`); continue; }
    try {
      const r = await executeReplication(target, code);
      results.byBrand[target.brand][code] = r;
    } catch (e) {
      console.log(`  ERROR ${target.brand}/${code}: ${e.message.slice(0, 300)}`);
      results.byBrand[target.brand][code] = { status: 'error', error: String(e.message) };
    }
  }
}

const outPath = dryRun ? 'tmp/tleo-replication-dryrun.json' : 'tmp/tleo-replication-results.json';
fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
console.log(`\nWrote ${outPath}`);

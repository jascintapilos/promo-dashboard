#!/usr/bin/env node
// Replicate 9 WCF promo codes from QPRO4 (YE55, MY only) → QPRO3 (BX99, MY+SG).
//
// Fetches each code's live config from QPRO4, mirrors it to QPRO3 with SGD
// added as a 1:1 copy of MYR. MT content is cloned; SG_EN/SG_ZH locales are
// copied from MY_EN/MY_ZH respectively.
//
// Usage:
//   node bin/replicate-wcf-qpro4-to-qpro3.mjs               # dry-run (default)
//   node bin/replicate-wcf-qpro4-to-qpro3.mjs --commit       # live
//   node bin/replicate-wcf-qpro4-to-qpro3.mjs --commit --code=REL_20PCT_15X_WCF

import fs from 'node:fs';
import { parseArgs } from './_args.js';
import { getSite } from '../src/sites.js';
import {
  findPromotionByCode, authedFetch,
  createPromotion, addPromotionName, createMessageTemplate, updatePromotion,
} from '../src/api-client.js';
import { buildApiPlan } from '../src/api-mapper-qpro.js';

function bail(code) {
  process.exitCode = code;
  setTimeout(() => process.exit(code), 50).unref();
}

await (async () => {

const { flags } = parseArgs(process.argv.slice(2));
const commit    = flags.commit === true;
const dryRun    = !commit;
const codeFilter = flags.code ? String(flags.code) : null;

const SRC  = getSite('qpro4');
const TGT  = getSite('qpro3');
const TARGET_BRAND     = 'QPRO3';
const TARGET_CURRENCIES = ['MYR', 'SGD'];
const TARGET_LOCALES    = ['MY_EN', 'MY_ZH', 'SG_EN', 'SG_ZH'];

const WCF_CODES = [
  '50FS_5X_001_GOO_WCF',
  'REL_20PCT_15X_WCF',
  '10FC_12X_WCF',
  '50FS_8X_002_GOO_WCF',
  'REL_25PCT_15X_WCF',
  '50FC_12X_WCF',
  '100FS_8X_002_GOO_WCF',
  'REL_50PCT_15X_WCF',
  '88FC_12X_WCF',
];

const PROMO_TYPE_LABELS = { 2: 'Deposit', 3: 'Free Credit', 4: 'Free Spin' };

// Non-zero numeric coercion.
function nz(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n !== 0 ? n : null;
}

// Fetch full raw detail for one promotion ID: main + currencies + names + MT.
async function fetchSourceDetail(site, promoId) {
  const [d, c, n] = await Promise.all([
    authedFetch(site, `/api/bo/promotion/${promoId}`),
    authedFetch(site, `/api/bo/promotioncurrency?promotion_id=${promoId}`),
    authedFetch(site, `/api/bo/promotionname?promotion_id=${promoId}`),
  ]);
  const main       = d.data.rows;   // full promotion object
  const currencies = c.data.rows || [];
  const names      = n.data.rows || [];

  let mtDetails = null;
  if (main.message_template_id) {
    const mtRes = await authedFetch(site, `/api/bo/messagetemplate/${main.message_template_id}`);
    const mtData = mtRes?.data?.rows || mtRes?.data;
    mtDetails = mtData?.message_details || null;
  }

  return { main, currencies, names, mtDetails };
}

// Build a resolved record for buildApiPlan.
function buildResolved(code, src) {
  const { main, currencies, names, mtDetails } = src;

  // Per-currency from source (MYR block), mirrored to SGD.
  const srcMyr = currencies.find(c => c.currency === 'MYR') || currencies[0] || {};
  const myrBlock = {
    min_deposit:        nz(srcMyr.min_transfer),
    max_bonus:          nz(srcMyr.max_bonus),
    free_credit_amount: nz(srcMyr.free_credit_amount),
    spin_count:         srcMyr.rounds  || null,
    value_per_spin:     nz(srcMyr.amount_per_line),
    max_transfer_out:   nz(srcMyr.max_transfer_out),
  };
  const per_currency_overrides = {
    MYR: myrBlock,
    SGD: { ...myrBlock },  // 1:1 mirror
  };

  // Promotion names (consumer-facing).
  const nameEn = names.find(n => n.locale === 'MY_EN')?.promotion_name || code;
  const nameZh = names.find(n => n.locale?.endsWith('_ZH'))?.promotion_name || nameEn;

  // Bonus type from source promo_type integer.
  const bonusType = PROMO_TYPE_LABELS[main.promo_type] || 'Deposit';
  const isFs  = bonusType === 'Free Spin';
  const isFc  = bonusType === 'Free Credit';
  const bonusSubType = isFs ? 'Reload' : isFc ? 'Free Credit' : 'Reload';

  // For FS: pass game code in "<code> - x" format so resolveFsGameCode short-circuits
  // to the code portion without doing a name lookup.
  const gameInput = main.free_spin_game_code
    ? `${main.free_spin_game_code} - ${main.free_spin_game_code}`
    : null;

  // MT: clone QPRO4 content, extend to SG locales (copy MY→SG).
  // CRITICAL: QPRO MT bodies hardcode the brand's T&C domain (tncDomain from
  // data/brand-directory.json), NOT a :url placeholder. When cloning across
  // brands we MUST swap the source domain → target domain, else members on the
  // target brand get a T&C link pointing at the source brand's site.
  // QPRO4 (YE55) tncDomain = ye55my.com ; QPRO3 (BX99) tncDomain = bx99myr.com.
  const SRC_TNC_DOMAIN = 'ye55my.com';
  const TGT_TNC_DOMAIN = 'bx99myr.com';
  const swapDomain = (html) => String(html).split(SRC_TNC_DOMAIN).join(TGT_TNC_DOMAIN);
  let inline_mt_bodies = undefined;
  if (mtDetails && Object.keys(mtDetails).length > 0) {
    inline_mt_bodies = {};
    for (const [idStr, entry] of Object.entries(mtDetails)) {
      const id = Number(idStr);
      const message = swapDomain(entry.message);
      inline_mt_bodies[String(id)] = { settings_locale_id: id, subject: entry.subject, message };
      if (id === 1) inline_mt_bodies['6'] = { settings_locale_id: 6, subject: entry.subject, message }; // MY_EN → SG_EN
      if (id === 3) inline_mt_bodies['7'] = { settings_locale_id: 7, subject: entry.subject, message }; // MY_ZH → SG_ZH
    }
  }

  return {
    promo_code:           code,
    name_details_raw:     main.name,
    bonus_type:           bonusType,
    bonus_sub_type:       bonusSubType,
    validity_days:        main.validity        ?? 30,
    rewards_validity_days: main.reward_validity ?? main.validity ?? 30,
    recurring:            main.recurring === 1,
    max_per_player:       main.max_per_player  ?? 99999,
    daily_max:            main.daily_max       ?? 1,
    currencies:           TARGET_CURRENCIES,
    locales:              TARGET_LOCALES,
    promotion_name_en:    nameEn,
    promotion_name_zh_id: nameZh,
    inbox_message:        inline_mt_bodies != null,
    popup_dialog:         false,
    parsed: {
      bonus_rate_pct:     Number(main.bonus_rate) || null,
      max_bonus:          myrBlock.max_bonus,
      min_deposit:        myrBlock.min_deposit,
      to_multiplier:      main.target?.[0]?.multiplier ?? null,
      game:               gameInput,
      free_credit_amount: myrBlock.free_credit_amount,
      spin_count:         myrBlock.spin_count,
      value_per_spin:     myrBlock.value_per_spin,
    },
    per_currency_overrides,
    ...(inline_mt_bodies != null ? { inline_mt_bodies } : {}),
    instructions: {
      code_name_override: null,
      duplicate_source:   null,
      tier_constraint:    null,
      add_test_prefix:    false,
      code_prefixes:      [],
      categories_only:    null,
    },
  };
}

// ── Main loop ──────────────────────────────────────────────────────────────

const codesToRun = codeFilter ? [codeFilter] : WCF_CODES;
const results    = { mode: dryRun ? 'dry-run' : 'commit', codes: {} };

console.log(`\n━━━ Replicate WCF codes: QPRO4 → QPRO3 (${dryRun ? 'DRY-RUN' : 'COMMIT'}) ━━━\n`);

for (const code of codesToRun) {
  console.log(`── ${code}`);
  try {
    // 1. Idempotency: skip if already on QPRO3.
    const existing = await findPromotionByCode(TGT, code);
    if (existing) {
      console.log(`   SKIP: already exists on QPRO3 id=${existing.id}`);
      results.codes[code] = { status: 'exists', id: existing.id };
      continue;
    }

    // 2. Find source on QPRO4.
    const srcRow = await findPromotionByCode(SRC, code);
    if (!srcRow) {
      console.log(`   ERROR: not found on QPRO4`);
      results.codes[code] = { status: 'not-found-on-source' };
      continue;
    }

    // 3. Fetch full source detail.
    const srcDetail = await fetchSourceDetail(SRC, srcRow.id);
    const resolved  = buildResolved(code, srcDetail);

    // 4. Build plan for QPRO3.
    const plan = await buildApiPlan(resolved, { brand: TARGET_BRAND, site: TGT });

    // Report currency filter if FS dropped SGD.
    if (plan.currencyFilter?.dropped?.length) {
      console.log(`   [currency-filter] dropped: ${plan.currencyFilter.dropped.join(', ')}`);
    }

    if (dryRun) {
      const names = plan.buildNames(99999);
      const mtLocales = plan.messageTemplate ? Object.keys(plan.messageTemplate.details || {}).length : 0;
      console.log(`   DRY: type=${plan.promotion.promo_type}  currencies=${Object.keys(plan.promotion.promotion_currency || {}).length}  names=${names.length}  mt_locales=${mtLocales}`);
      results.codes[code] = {
        status: 'dry-run',
        promo_type: plan.promotion.promo_type,
        currencies: Object.keys(plan.promotion.promotion_currency || {}),
        names: names.length,
        mt_locales: mtLocales,
      };
      continue;
    }

    // 5. POST promotion.
    const created = await createPromotion(TGT, plan.promotion);
    const promoId = created.data?.rows?.id || created.data?.id;
    if (!promoId) throw new Error(`createPromotion: no id in response: ${JSON.stringify(created).slice(0, 200)}`);
    console.log(`   POST promotion  → id=${promoId}`);

    // 6. POST message template.
    let mtId = null;
    if (plan.messageTemplate) {
      const mtRes = await createMessageTemplate(TGT, plan.messageTemplate);
      mtId = mtRes.data?.rows?.id || mtRes.data?.id;
      console.log(`   POST MT         → id=${mtId}`);
    }

    // 7. POST per-locale names.
    const nameBodies = plan.buildNames(promoId);
    for (const nb of nameBodies) {
      await addPromotionName(TGT, nb);
    }
    console.log(`   POST names × ${nameBodies.length}`);

    // 8. PUT to link MT.
    if (mtId) {
      const putBody = plan.buildUpdate(promoId, mtId, null);
      await updatePromotion(TGT, promoId, putBody);
      console.log(`   PUT  → linked MT`);
    }

    results.codes[code] = { status: 'created', id: promoId, mt_id: mtId, names: nameBodies.length };

  } catch (e) {
    console.log(`   ERROR: ${e.message.slice(0, 300)}`);
    results.codes[code] = { status: 'error', error: String(e.message) };
  }
}

// ── Summary ────────────────────────────────────────────────────────────────
console.log('\n─── Summary ───');
for (const [c, r] of Object.entries(results.codes)) {
  const tag = r.status === 'created' ? '✓' : r.status === 'exists' ? '=' : r.status === 'dry-run' ? '~' : '✗';
  const detail = r.status === 'created' ? `id=${r.id}` : r.status === 'dry-run' ? `type=${r.promo_type} names=${r.names}` : r.status === 'exists' ? `id=${r.id}` : (r.error || '');
  console.log(`  ${tag} ${c.padEnd(32)} ${detail}`);
}

const outDir = 'tmp';
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const outFile = dryRun ? 'tmp/replicate-wcf-dryrun.json' : 'tmp/replicate-wcf-results.json';
fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
console.log(`\nWrote ${outFile}`);

})().catch((e) => { console.error(e); process.exitCode = 1; });

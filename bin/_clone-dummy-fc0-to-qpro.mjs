#!/usr/bin/env node
// Clone QP2D_dummy-fc0 (QP2D/SPADE66 id 134) → code "dummy-fc0" on QPRO3/4/10.
// Faithful FC0: Free Credit, zero economics, SLOTS category, TO x1.00 on KAYA
// only, validity 30 / reward 7, one-time, no blacklist template, no names,
// no inbox/SMS/popup, eligible to all Members (source member-targeting can't
// port). Per-brand currency = source[MYR,SGD] ∩ brand-supported.
//
// Dry-run by default. Pass --commit to POST. Processes brands sequentially
// and STOPS on first error so a bad body can't cascade across live brands.
import { authedFetch, createPromotion, findPromotionByCode, getAllCategories, getAllGameProviders } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

function argval(name, def) {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split('=').slice(1).join('=') : def;
}
const NEW_CODE = argval('code', 'dummy-fc0');
const NAME = 'Dummy FC0 for B1B2';
const SRC_CURRENCIES = ['MYR', 'SGD'];
const CURRENCY_TO_ID = { MYR: '1', SGD: '3' };
const TARGETS = argval('brands', 'qpro3,qpro4,qpro10').split(',').map((s) => s.trim()).filter(Boolean);
const COMMIT = process.argv.includes('--commit');

function nowYmdHms() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

function fcCurrencyBlock(label, i) {
  return {
    currency_id: CURRENCY_TO_ID[label],
    max_balance_claim: 0,
    max_total_applications: 0,
    max_total_bonus: 0,
    free_credit_amount: 0,
    status: '1',
    max_transfer_out: 0,
    promo_type: 3,
    currency: label,
    current_players: 0,
    used_budget: 0,
  };
}

function buildBody({ slotsCatId, kayaId, currencies }) {
  const promotion_currency = {};
  currencies.forEach((c, i) => { promotion_currency[String(i)] = fcCurrencyBlock(c, i); });
  return {
    code: NEW_CODE,
    name: NAME,
    free_spin_game_provider_id: 0,
    promotion_category_turnover: { '0': slotsCatId },
    promo_type: 3,                 // Free Credit
    promo_sub_type: '1',
    valid_from: nowYmdHms(),
    validity: 30,
    reward_validity: 7,
    frequency: [],
    frequency_type: '1',
    first_deposit: 0,
    last_deposit: 0,               // source = 0
    auto_approve: false,           // source auto_approve = 0
    visible_by_affiliate: 0,
    recurring: '0',                // one-time
    max_per_player: 0,             // unlimited (source null)
    daily_max: 9999999,            // mirror source
    limit_transfer_in: false,      // source = 0
    limit_transfer_out: false,     // source = 0
    restrict_claim_round_active: 0,
    restrict_same_provider_launch: false,
    auto_unlock: false,            // source auto_unlock = 0
    allow_cancel: 0,
    fixed_amount: 0,
    game_provider_ids: { '0': kayaId },   // KAYA only
    target: { '0': { type: 1, multiplier: 1, game_provider_ids: { '0': kayaId } } },
    deposit_count: 0,
    eligible_types: '1',           // Members
    telemarketer_ids: [],
    normal_account_manager_ids: [],
    vip_account_manager_ids: [],
    requires_email: false,
    requires_mobile: false,
    requires_dob: false,
    requires_fullname: false,
    transfer_unlock: false,
    kyc_basic: false,              // source: no KYC requirement
    kyc_advanced: false,
    kyc_pro: false,
    blacklist_id: null,            // source blacklist_template_id null
    black_list_sub_categories: [],
    dialog_popup_list: [],
    promotion_currency,
  };
}

const results = [];
for (const t of TARGETS) {
  const site = getSite(t);
  const tag = `${t} (${site.loginMerchantCode})`;
  console.log(`\n──── ${tag} ────`);

  // duplicate guard
  const existing = await findPromotionByCode(site, NEW_CODE);
  if (existing) {
    console.log(`  SKIP — "${NEW_CODE}" already exists (id=${existing.id}, status=${existing.status})`);
    results.push({ brand: t, status: 'skip-exists', id: existing.id });
    continue;
  }

  // resolve catalogs
  const [cats, gps, curRes] = await Promise.all([
    getAllCategories(site),
    getAllGameProviders(site),
    authedFetch(site, '/api/bo/currency').catch(() => null),
  ]);
  const slots = cats.find((c) => String(c.name || '').toUpperCase() === 'SLOTS');
  const kaya = gps.rows.find((r) => ['KAYA', '918KAYA'].includes(String(r.code || '').toUpperCase()) || ['KAYA', '918KAYA'].includes(String(r.name || '').toUpperCase()));
  const supported = new Set((curRes?.data?.rows || curRes?.data || []).map((c) => String(c.code || c.currency || c.name || '').toUpperCase()));
  const currencies = SRC_CURRENCIES.filter((c) => supported.has(c));
  if (!slots || !kaya || currencies.length === 0) {
    console.log(`  ⛔ catalog miss — slots=${slots?.id} kaya=${kaya?.id} currencies=${currencies.join(',')}`);
    results.push({ brand: t, status: 'catalog-miss' });
    break;
  }
  console.log(`  resolved: SLOTS=${slots.id}  KAYA=${kaya.id}  currencies=[${currencies.join(', ')}]`);

  const body = buildBody({ slotsCatId: slots.id, kayaId: kaya.id, currencies });
  if (!COMMIT) {
    console.log('  DRY-RUN body:');
    console.log(JSON.stringify(body, null, 2).split('\n').map((l) => '    ' + l).join('\n'));
    results.push({ brand: t, status: 'dry-run' });
    continue;
  }

  try {
    const res = await createPromotion(site, body);
    const id = res?.data?.rows?.id ?? res?.data?.id;
    console.log(`  ✅ CREATED id=${id}`);
    // read-back
    const back = await findPromotionByCode(site, NEW_CODE);
    console.log(`  read-back: ${back ? `id=${back.id} status=${back.status} type=${back.promo_type}` : 'NOT FOUND (!)'}`);
    results.push({ brand: t, status: 'created', id });
  } catch (e) {
    console.log(`  ❌ CREATE FAILED: ${e.message.slice(0, 400)}`);
    results.push({ brand: t, status: 'error', error: e.message });
    break; // stop on first error — don't cascade across live brands
  }
}

console.log('\n==== SUMMARY ====');
for (const r of results) console.log(`  ${r.brand}: ${r.status}${r.id ? ` (id=${r.id})` : ''}`);
console.log(COMMIT ? '\n(committed)' : '\n(dry-run — re-run with --commit to create)');

#!/usr/bin/env node
// Fix ibc22 TLEO SLOT promos:
//   1. Remove PP from game_provider_codes (keep PP2)
//   2. blacklist_template_id: bt=5 for slots (same as all-games on ibc22; FS also use bt=5)
//      bt=3 for LC (already correct on LC promos)
//      → only SLOT promos need PP fix; LC/all-games bt already correct
//
// ibc22 QP2 PUT requires promotion_currency — fetched via /api/bo/promotioncurrency

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const site = getSite('ibc22');

// Code→numeric PUT ID map (QP2A_TARGET_GAME_PROVIDER_CODES + QP2A_PUT_GAME_PROVIDER_IDS)
const CODE_TO_PUT_ID = {
  '365G':178,'9W':139,'AP':341,'AVI':196,'BG':15,'BOOM':268,'BNG':328,'BTG':292,
  'CMD':18,'CQ9':14,'EVOK':320,'EZ':25,'FS':122,'FP':304,'FC':184,'GXW':324,
  'HSG':197,'IM':23,'2BC':312,'JDB':110,'JILI':111,'JK':7,'KA':190,'LIVE':21,
  'LUCKY':284,'MAHA':313,'MGP':203,'MONKEY':274,'NET2':256,'NEXT':22,'NLC':257,
  'PNG':17,'AG':1,'PTI':308,'PP':35,'PP2':345,'RT2':258,'RG':349,'SA':13,
  'MAX':8,'SBO':34,'SBO2':353,'SEXY':31,'SIMPLE':10,'SG':9,'SPRIBE':187,
  'TF':117,'VIVO':332,'WBET':72,'WM':37,'XE':33,'YB':297,'YL':36,
};

function arrToObj(arr) {
  const o = {};
  (arr || []).forEach((v, i) => { o[String(i)] = v; });
  return o;
}

function codesToPutIds(codes) {
  const ids = codes.map(c => CODE_TO_PUT_ID[c]).filter(id => id !== undefined);
  return arrToObj(ids);
}

function catType(code) {
  if (/_LC_/.test(code) || /_LC$/.test(code)) return 'lc';
  if (/_SL_/.test(code) || /_SLOT_/.test(code) || /_SLOT$/.test(code)) return 'slots';
  return 'all';
}

// Fetch per-currency settings for a promo
async function getPromoCurrency(pid) {
  const r = await authedFetch(site, `/api/bo/promotioncurrency?promotion_id=${pid}&perPage=20&page=1`);
  const rows = r.data?.rows || [];
  return rows;
}

// Build promotion_currency indexed object for PUT from currency GET data
function buildPromoCurrencyForPut(currencyRows) {
  const cur = {};
  currencyRows.forEach((row, i) => {
    cur[String(i)] = {
      currency_id: String(row.settings_currency_id),
      bonus_amount: 0,
      bonus_rate: Number(row.bonus_rate),
      bypass_min_deposit: row.bypass_min_deposit ?? 0,
      max_balance_claim: null,
      status: String(row.status ?? 1),
      reset: row.reset ?? 0,
      start_time: row.start_time || '00:00:00',
      end_time: row.end_time || '23:59:59',
      min_transfer: Number(row.min_transfer ?? 0),
      min_deposit: Number(row.min_deposit ?? 0),
      max_withdraw_type: String(row.max_withdraw_type ?? 1),
      max_withdraw: row.max_withdraw,
      max_total_applications: 0,  // PUT validator requires int (not null)
      max_total_bonus: 0,          // PUT validator requires int (not null)
      bonus_type: row.bonus_type ?? 2,
      promo_type: row.promo_type ?? null,
      currency: row.currency,
      reset_name: row.reset_name || 'None',
      max_bonus: Number(row.max_bonus ?? 0),
      total_players: 0,
      current_players: 0,
      total_used_budget: 0,
      current_used_budget: 0,
      ...(row.deposit_options?.length ? { deposit_options: row.deposit_options } : {}),
    };
  });
  return cur;
}

// Build full QP2 PUT body from GET detail + currency rows + new codes
function buildQp2PutBody(p, currencyRows, newGpCodes) {
  const codes = newGpCodes ?? p.game_provider_codes ?? [];
  const gpPutIds = codesToPutIds(codes);  // numeric IDs for top-level
  const tgtCodes = arrToObj(codes);        // string codes for target

  // merchant_ids: GET returns [{id:1,...},...]; PUT needs {"0":1,"1":2,...}
  const merchantIds = arrToObj((p.merchant_ids || []).map(m => m.id ?? m));
  // member_group_ids: GET returns array of ints; PUT needs indexed object
  const memberGroupIds = arrToObj(p.member_group_ids || []);
  const promoCurrency = buildPromoCurrencyForPut(currencyRows);

  return {
    id:              p.id,
    bonus_settings:  p.bonus_settings,
    code:            p.code,
    name:            p.name,
    free_spin_game_provider_id: p.free_spin_game_provider_id ?? 0,
    ...(p.free_spin_game_code ? { free_spin_game_code: p.free_spin_game_code } : {}),
    blacklist_id: p.blacklist_id,        // GET/PUT field is blacklist_id
    promotion_category_ids: p.promotion_category_ids ?? [],
    promo_type:      p.promo_type,
    promo_sub_type:  p.promo_sub_type,
    promotion_ids:   [],
    valid_from:      p.valid_from ? String(p.valid_from).replace('T', ' ').replace(/\.\d+Z?$/, '') : null,
    validity:        p.validity,
    reward_validity: p.reward_validity,
    frequency:       p.frequency ?? [],
    frequency_type:  p.frequency_type,
    member_group_ids: memberGroupIds,
    members_only:    p.members_only ?? 0,
    fingerprint_check: p.fingerprint_check ?? 0,
    freespin_check:  p.freespin_check ?? 0,
    auto_approve:    p.auto_approve,
    auto_reward_activation: 0,  // mapper default
    recurring:       p.recurring,
    reset_frequency: p.reset_frequency,
    reset_month:     p.reset_month ?? 1,
    max_per_player:  p.max_per_player,
    daily_max:       p.daily_max,
    status:          p.status ?? 1,
    limit_transfer_in:  p.limit_transfer_in ?? 0,
    limit_transfer_out: p.limit_transfer_out ?? 0,
    bonus_rate:      0,
    auto_unlock:     p.auto_unlock,
    allow_cancel:    p.allow_cancel,
    withdrawal_unlock: p.withdrawal_unlock ?? 0,
    game_provider_codes: gpPutIds,
    target: {
      type:       (p.target?.[0]?.type) ?? 1,
      multiplier: String(Number(p.target?.[0]?.multiplier ?? 0).toFixed(2)),
      game_provider_codes: tgtCodes,
    },
    message_template_id:     p.message_template_id ?? 0,
    message_template_sms_id: p.message_template_sms_id ?? 0,
    deposit_count:   p.deposit_count ?? 0,
    active_period:   p.active_period ?? 0,
    merchant_ids:    merchantIds,
    allow_deposit:   p.allow_deposit ?? 0,
    allow_continuous_claim: p.allow_continuous_claim ?? 0,
    deposit_status:  p.last_deposit === 1 ? 4 : 1,
    eligible_types:  p.eligible_types ?? 1,
    affiliate_group_ids:  [],
    telemarketer_ids:     [],
    requires_mobile: p.requires_mobile ?? 0,
    requires_dob:    p.requires_dob ?? 0,
    requires_fullname: p.requires_fullname ?? 0,
    black_list_sub_categories: [],
    promotion_currency: promoCurrency,
    dialog_popup_list:  [],
  };
}

// ── Process all ibc22 TLEO promos ─────────────────────────────────────────────

console.log('=== ibc22 TLEO SLOT promo fix (remove PP from game_provider_codes) ===\n');

// Fetch all TLEO promos
const r = await authedFetch(site, '/api/bo/promotion?code=FT_REL_TLEO&perPage=200&page=1');
const rows = r.data?.rows || [];
const tleo = (Array.isArray(rows) ? rows : Object.values(rows)).filter(p => p.code?.includes('TLEO'));
console.log(`Found ${tleo.length} TLEO promos on ibc22\n`);

// Only process SLOT promos (the ones with PP issue)
const slotPromos = tleo.filter(p => catType(p.code) === 'slots');
console.log(`SLOT promos to fix: ${slotPromos.length}`);
for (const p of slotPromos) {
  console.log(`  pid=${p.id}  code=${p.code}`);
}
console.log();

let saved = 0, noChange = 0, errors = 0;

for (const promo of slotPromos) {
  const cat = catType(promo.code);

  // GET full detail
  let p;
  try {
    const r2 = await authedFetch(site, `/api/bo/promotion/${promo.id}`);
    p = r2.data?.rows;
  } catch (e) {
    console.error(`ERROR fetching pid=${promo.id}: ${e.message.split('\n')[0]}`);
    errors++;
    continue;
  }

  const currentCodes = p.game_provider_codes || [];
  const hadPP = currentCodes.includes('PP');

  if (!hadPP) {
    console.log(`OK   ${promo.code} (pid=${promo.id}) — PP not in codes, no change needed`);
    noChange++;
    continue;
  }

  // Fetch per-currency data
  let currencyRows = [];
  try {
    currencyRows = await getPromoCurrency(promo.id);
  } catch (e) {
    console.error(`ERROR fetching currency for pid=${promo.id}: ${e.message.split('\n')[0]}`);
    errors++;
    continue;
  }

  const newCodes = currentCodes.filter(c => c !== 'PP');
  const putBody = buildQp2PutBody(p, currencyRows, newCodes);

  console.log(`Fixing ${promo.code} (pid=${promo.id}):`);
  console.log(`  game_provider_codes: ${currentCodes.length} → ${newCodes.length} (removed PP)`);
  console.log(`  currencies: ${currencyRows.map(c => c.currency).join(', ')}`);
  console.log(`  merchant_ids: ${JSON.stringify(Object.values(putBody.merchant_ids))}`);

  try {
    await authedFetch(site, `/api/bo/promotion/${promo.id}`, { method: 'PUT', body: putBody });

    // Verify
    const verR = await authedFetch(site, `/api/bo/promotion/${promo.id}`);
    const verP = verR.data?.rows;
    const verCodes = verP.game_provider_codes || [];
    const verHasPP  = verCodes.includes('PP');
    const verHasPP2 = verCodes.includes('PP2');
    console.log(`  PUT OK. Verify: has_PP=${verHasPP}  has_PP2=${verHasPP2}  code_count=${verCodes.length}`);
    console.log(`  currencies_ids=${JSON.stringify(verP.currencies_ids)}  bt=${verP.blacklist_id}`);

    if (verHasPP) {
      console.error('  ✗ ERROR: PP still in codes after PUT!');
      errors++;
    } else {
      console.log(`  ✓ Confirmed PP removed`);
      saved++;
    }
  } catch (e) {
    console.error(`  ✗ PUT FAILED: ${e.message.split('\n')[0]}`);
    errors++;
  }
  console.log();
}

// Also log status for non-SLOT TLEO promos (check/confirm)
console.log('\n=== Non-SLOT ibc22 TLEO status ===');
const nonSlot = tleo.filter(p => catType(p.code) !== 'slots');
const btSummary = {};
for (const p of nonSlot) {
  const r2 = await authedFetch(site, `/api/bo/promotion/${p.id}`);
  const pd = r2.data?.rows;
  const cat = catType(p.code);
  const bt = pd?.blacklist_id ?? 'null';
  btSummary[cat] = btSummary[cat] || {};
  btSummary[cat][bt] = (btSummary[cat][bt] || 0) + 1;
}
for (const [cat, bts] of Object.entries(btSummary)) {
  console.log(`  cat=${cat}: bt distribution=${JSON.stringify(bts)}`);
}

console.log(`\n=== SUMMARY ===`);
console.log(`Saved: ${saved}  No-change: ${noChange}  Errors: ${errors}`);

#!/usr/bin/env node
// Fix the 3 QC items on QP2D (SPADE66, merchant_id/site_id = 4), ibc22 BO:
//   FIX 1: DELETE stray code FT_REL_TLEO_20PCT_228MX (id=1009, already status=0)
//   FIX 2: Create + link Login Popup for FT_REL_TLEO_50PCT_25MX_SLOT (id=1003)
//          (clones the 50% LC twin's popup #966 — identical display name/min-dep)
//   FIX 3: Rename FT_TLEO_FC228_10X (id=971) "no max transfer" → "no max withdrawal"
//
// SAFETY: full-body QP2 PUT reconstruction preserves every field from GET.
//   - faithful currency builder PRESERVES bonus_amount (FC free-credit value);
//     the slot-PP builder hardcoded 0 which would wipe 971's RM228.
//   - pre-flight asserts rebuilt currency matches GET on critical fields.
//   - post-PUT re-GETs and verifies the intended change + no collateral damage.
//
// Run: node bin/_fix-qp2d-qc-items.mjs --dry-run   (inspect, no writes)
//      node bin/_fix-qp2d-qc-items.mjs             (commit)

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const site = getSite('ibc22');
const DRY = process.argv.includes('--dry-run');
if (DRY) console.log('*** DRY RUN — no writes ***\n');

const STRAY_ID = 1009;       // FT_REL_TLEO_20PCT_228MX
const SLOT_ID  = 1003;       // FT_REL_TLEO_50PCT_25MX_SLOT (needs popup)
const LC_POPUP_ID = 966;     // 50% LC twin's popup to clone
const FC_ID    = 971;        // FT_TLEO_FC228_10X (name fix)
const SPADE66_SITE_ID = 4;

const FC_NAME_OLD = 'Slot and LC only, Silver 1-3, Free Credit 228 - 10X TO, no max transfer';
const FC_NAME_NEW = 'Slot and LC only, Silver 1-3, Free Credit 228 - 10X TO, no max withdrawal';

// ── code → numeric PUT id map (from _fix-ibc22-tleo-slot-pp.mjs) ──────────────
const CODE_TO_PUT_ID = {
  '365G':178,'9W':139,'AP':341,'AVI':196,'BG':15,'BOOM':268,'BNG':328,'BTG':292,
  'CMD':18,'CQ9':14,'EVOK':320,'EZ':25,'FS':122,'FP':304,'FC':184,'GXW':324,
  'HSG':197,'IM':23,'2BC':312,'JDB':110,'JILI':111,'JK':7,'KA':190,'LIVE':21,
  'LUCKY':284,'MAHA':313,'MGP':203,'MONKEY':274,'NET2':256,'NEXT':22,'NLC':257,
  'PNG':17,'AG':1,'PTI':308,'PP':35,'PP2':345,'RT2':258,'RG':349,'SA':13,
  'MAX':8,'SBO':34,'SBO2':353,'SEXY':31,'SIMPLE':10,'SG':9,'SPRIBE':187,
  'TF':117,'VIVO':332,'WBET':72,'WM':37,'XE':33,'YB':297,'YL':36,
};

function arrToObj(arr) { const o = {}; (arr || []).forEach((v, i) => { o[String(i)] = v; }); return o; }
function codesToPutIds(codes) { return arrToObj(codes.map(c => CODE_TO_PUT_ID[c]).filter(id => id !== undefined)); }
function nowYmdHms() { return new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, ''); }
function fmtDate(d) { return d ? String(d).replace('T', ' ').replace(/\.\d+Z?$/, '') : null; }

async function getDetail(id) { const r = await authedFetch(site, `/api/bo/promotion/${id}`); return r.data?.rows; }
async function getCurrency(id) {
  const r = await authedFetch(site, `/api/bo/promotioncurrency?promotion_id=${id}&perPage=20&page=1`);
  const rows = r.data?.rows || [];
  return Array.isArray(rows) ? rows : Object.values(rows);
}
async function getListRow(code, id) {
  const r = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(code)}&perPage=20&page=1`);
  const rows = r.data?.rows || [];
  const arr = Array.isArray(rows) ? rows : Object.values(rows);
  return arr.find(x => x.id === id);
}

// ── FAITHFUL currency builder — preserves bonus_amount (FC value!) ───────────
function buildFaithfulCurrency(rows) {
  const cur = {};
  rows.forEach((row, i) => {
    const block = {
      currency_id: String(row.settings_currency_id),
      bonus_amount: Number(row.bonus_amount ?? 0),         // PRESERVE (FC = 228)
      bonus_rate: Number(row.bonus_rate ?? 0),
      bypass_min_deposit: row.bypass_min_deposit ?? 0,
      max_balance_claim: row.max_balance_claim ?? null,
      status: String(row.status ?? 1),
      reset: row.reset ?? 0,
      start_time: row.start_time || '00:00:00',
      end_time: row.end_time || '23:59:59',
      min_transfer: Number(row.min_transfer ?? 0),
      min_deposit: Number(row.min_deposit ?? 0),
      max_withdraw_type: String(row.max_withdraw_type ?? 1),
      max_withdraw: row.max_withdraw,
      max_total_applications: row.max_total_applications == null ? 0 : Number(row.max_total_applications),
      max_total_bonus: row.max_total_bonus == null ? 0 : Number(row.max_total_bonus),
      bonus_type: row.bonus_type ?? 2,
      promo_type: row.promo_type ?? null,
      currency: row.currency,
      reset_name: row.reset_name || 'None',
      max_bonus: Number(row.max_bonus ?? 0),
      total_players: 0, current_players: 0, total_used_budget: 0, current_used_budget: 0,
    };
    if (row.deposit_options?.length) block.deposit_options = row.deposit_options;
    cur[String(i)] = block;
  });
  return cur;
}

// ── Full QP2 PUT body, faithful to GET, with overridable name + dialogList ───
function buildQp2PutBody(p, currencyRows, { name, dialogList } = {}) {
  const codes = p.game_provider_codes ?? [];
  return {
    id: p.id,
    bonus_settings: p.bonus_settings,
    code: p.code,
    name: name ?? p.name,
    free_spin_game_provider_id: p.free_spin_game_provider_id ?? 0,
    ...(p.free_spin_game_code ? { free_spin_game_code: p.free_spin_game_code } : {}),
    promotion_category_ids: p.promotion_category_ids ?? [],
    promo_type: p.promo_type,
    promo_sub_type: p.promo_sub_type,
    promotion_ids: [],
    valid_from: fmtDate(p.valid_from),
    validity: p.validity,
    reward_validity: p.reward_validity,
    frequency: p.frequency ?? [],
    frequency_type: p.frequency_type,
    member_group_ids: arrToObj(p.member_group_ids || []),
    members_only: p.members_only ?? 0,
    fingerprint_check: p.fingerprint_check ?? 0,
    freespin_check: p.freespin_check ?? 0,
    auto_approve: p.auto_approve,
    auto_reward_activation: p.auto_reward_activation ?? 0,
    recurring: p.recurring,
    reset_frequency: p.reset_frequency,
    reset_month: p.reset_month ?? 1,
    max_per_player: p.max_per_player,
    daily_max: p.daily_max,
    status: p.status ?? 1,
    limit_transfer_in: p.limit_transfer_in ?? 0,
    limit_transfer_out: p.limit_transfer_out ?? 0,
    bonus_rate: 0,
    auto_unlock: p.auto_unlock,
    allow_cancel: p.allow_cancel,
    withdrawal_unlock: p.withdrawal_unlock ?? 0,
    game_provider_codes: codesToPutIds(codes),
    target: {
      type: (p.target?.[0]?.type) ?? 1,
      multiplier: String(Number(p.target?.[0]?.multiplier ?? 0).toFixed(2)),
      game_provider_codes: arrToObj(p.target?.[0]?.game_provider_codes ?? codes),
    },
    message_template_id: p.message_template_id ?? 0,
    message_template_sms_id: p.message_template_sms_id ?? 0,
    deposit_count: p.deposit_count ?? 0,
    active_period: p.active_period ?? 0,
    merchant_ids: arrToObj((p.merchant_ids || []).map(m => m.id ?? m)),
    allow_deposit: p.allow_deposit ?? 0,
    allow_continuous_claim: p.allow_continuous_claim ?? 0,
    deposit_status: p.last_deposit === 1 ? 4 : 1,
    eligible_types: p.eligible_types ?? 1,
    affiliate_group_ids: [],
    telemarketer_ids: [],
    requires_mobile: p.requires_mobile ?? 0,
    requires_dob: p.requires_dob ?? 0,
    requires_fullname: p.requires_fullname ?? 0,
    black_list_sub_categories: [],
    promotion_currency: buildFaithfulCurrency(currencyRows),
    dialog_popup_list: dialogList ?? [],
  };
}

// Assert rebuilt currency preserves critical fields vs GET rows.
function assertCurrencyFaithful(label, rows, built) {
  const problems = [];
  rows.forEach((row, i) => {
    const b = built[String(i)];
    if (!b) { problems.push(`${row.currency}: missing rebuilt block`); return; }
    const checks = [
      ['bonus_amount', Number(row.bonus_amount ?? 0), b.bonus_amount],
      ['bonus_rate', Number(row.bonus_rate ?? 0), b.bonus_rate],
      ['min_deposit', Number(row.min_deposit ?? 0), b.min_deposit],
      ['max_bonus', Number(row.max_bonus ?? 0), b.max_bonus],
      ['bonus_type', row.bonus_type, b.bonus_type],
      ['deposit_options.len', (row.deposit_options || []).length, (b.deposit_options || []).length],
    ];
    for (const [f, exp, got] of checks) {
      if (exp !== got) problems.push(`${row.currency}.${f}: GET=${exp} built=${got}`);
    }
  });
  if (problems.length) {
    console.error(`  ✗ ${label}: currency reconstruction MISMATCH — ABORTING this fix:`);
    problems.forEach(p => console.error(`      ${p}`));
    return false;
  }
  console.log(`  ✓ ${label}: currency faithful (${rows.map(r => `${r.currency} bns_amt=${r.bonus_amount} rate=${r.bonus_rate}`).join(', ')})`);
  return true;
}

// ════════════════════════════════════════════════════════════════════════════
let okCount = 0, failCount = 0;

// ── FIX 1: DELETE stray 1009 ─────────────────────────────────────────────────
console.log('=== FIX 1: delete stray FT_REL_TLEO_20PCT_228MX (id=1009) ===');
try {
  const p = await getDetail(STRAY_ID);
  console.log(`  current: code=${p.code} status=${p.status} merchant_ids=${JSON.stringify((p.merchant_ids||[]).map(m=>m.id))} mt=${p.message_template_id} sms=${p.message_template_sms_id}`);
  // Safety: only delete if it really is the stray, deactivated, SPADE66-only, no config
  const safe = p.code === 'FT_REL_TLEO_20PCT_228MX' && p.status === 0
    && (p.merchant_ids||[]).every(m => m.id === 4)
    && !p.message_template_id && !p.message_template_sms_id;
  if (!safe) {
    console.error('  ✗ Safety check failed — NOT deleting. (expected stray status=0 SPADE66-only no-config)');
    failCount++;
  } else if (DRY) {
    console.log('  DRY: would DELETE /api/bo/promotion/1009');
  } else {
    await authedFetch(site, `/api/bo/promotion/${STRAY_ID}`, { method: 'DELETE' });
    const gone = await getListRow('FT_REL_TLEO_20PCT_228MX', STRAY_ID);
    if (!gone) { console.log('  ✓ Deleted; no longer in list.'); okCount++; }
    else { console.error(`  ✗ Still present after DELETE (status=${gone.status})`); failCount++; }
  }
} catch (e) { console.error(`  ✗ FIX 1 error: ${e.message.split('\n')[0]}`); failCount++; }

// ── FIX 2: popup for 1003 ─────────────────────────────────────────────────────
console.log('\n=== FIX 2: add Login Popup to FT_REL_TLEO_50PCT_25MX_SLOT (id=1003) ===');
try {
  const p = await getDetail(SLOT_ID);
  const cur = await getCurrency(SLOT_ID);
  // Clone popup 966 contents
  const lr = await authedFetch(site, `/api/bo/popups?perPage=300&page=2`);
  const popups = Object.values(lr.data?.rows || {});
  const src = popups.find(x => x.id === LC_POPUP_ID);
  if (!src) throw new Error(`source popup ${LC_POPUP_ID} not found on page 2`);
  const contents = {};
  for (const c of src.contents) {
    contents[String(c.locale_id)] = {
      locale_id: c.locale_id,
      content: c.content,
      title: c.title,
      mobile_link: null, desktop_link: null,
      video_mobile_link: null, video_desktop_link: null, media_type: null,
      cta_button_type: c.cta_button_type,
      cta_button_text_1: c.cta_button_text_1, cta_button_link_1: c.cta_button_link_1,
      cta_button_text_2: c.cta_button_text_2, cta_button_link_2: c.cta_button_link_2,
    };
  }
  const popupBody = {
    site_id: SPADE66_SITE_ID, platform: 1, start_date: nowYmdHms(), session: '3',
    position: 99, status: 1, location: 1, affiliates_visibility: 0, always_pop: 0,
    do_not_show_again: 0, contents,
  };
  console.log(`  popup clone: site_id=${SPADE66_SITE_ID} locales=${Object.keys(contents).join(',')} title="${src.contents[0].title}"`);

  const okCur = assertCurrencyFaithful('1003', cur, buildFaithfulCurrency(cur));
  if (!okCur) { failCount++; }
  else if (DRY) {
    console.log(`  DRY: would POST popup, then PUT 1003 with dialog_popup_list`);
    console.log(`       PUT preserves: gp_codes=${(p.game_provider_codes||[]).length} cats=${JSON.stringify(p.promotion_category_ids)} merchants=${JSON.stringify((p.merchant_ids||[]).map(m=>m.id))}`);
  } else {
    const pr = await authedFetch(site, '/api/bo/popups', { method: 'POST', body: popupBody });
    const row = pr.data?.rows || pr.data;
    if (!row?.id) throw new Error(`popup POST returned no id: ${JSON.stringify(pr.data).slice(0,150)}`);
    console.log(`  ✓ popup created id=${row.id} code=${row.code}`);
    const dialogList = { '0': { ...row, promotion_id: SLOT_ID } };
    const putBody = buildQp2PutBody(p, cur, { dialogList });
    await authedFetch(site, `/api/bo/promotion/${SLOT_ID}`, { method: 'PUT', body: putBody });
    // verify
    const after = await getListRow('FT_REL_TLEO_50PCT_25MX_SLOT', SLOT_ID);
    const dp = after?.dialog_popup_list;
    const hasPopup = Array.isArray(dp) ? dp.length > 0 : (dp && Object.keys(dp||{}).length > 0);
    const afterDetail = await getDetail(SLOT_ID);
    const afterCur = await getCurrency(SLOT_ID);
    const myr = afterCur.find(c => c.currency === 'MYR');
    console.log(`  verify: popup_linked=${hasPopup} gp_codes=${(afterDetail.game_provider_codes||[]).length} cats=${JSON.stringify(afterDetail.promotion_category_ids)} merchants=${JSON.stringify((afterDetail.merchant_ids||[]).map(m=>m.id))} MYR(rate=${myr?.bonus_rate},maxbns=${myr?.max_bonus})`);
    if (hasPopup && (afterDetail.game_provider_codes||[]).length === (p.game_provider_codes||[]).length) {
      console.log('  ✓ FIX 2 complete'); okCount++;
    } else { console.error('  ✗ FIX 2 verification failed'); failCount++; }
  }
} catch (e) { console.error(`  ✗ FIX 2 error: ${e.message.split('\n')[0]}`); failCount++; }

// ── FIX 3: rename 971 (transfer → withdrawal) ─────────────────────────────────
console.log('\n=== FIX 3: rename FT_TLEO_FC228_10X (id=971) ===');
try {
  const p = await getDetail(FC_ID);
  const cur = await getCurrency(FC_ID);
  console.log(`  current name: "${p.name}"`);
  if (p.name !== FC_NAME_OLD) {
    console.log(`  (name already differs from expected-old; will set to corrected value anyway)`);
  }
  const built = buildFaithfulCurrency(cur);
  const okCur = assertCurrencyFaithful('971', cur, built);
  // Hard guard: FC bonus_amount must be 228 in EVERY rebuilt block
  const fcAmtsOk = Object.values(built).every(b => b.bonus_amount === 228);
  if (!fcAmtsOk) {
    console.error(`  ✗ FC bonus_amount guard FAILED (rebuilt: ${Object.values(built).map(b=>b.bonus_amount).join(',')}) — ABORT`);
    failCount++;
  } else if (!okCur) {
    failCount++;
  } else if (DRY) {
    console.log(`  DRY: would PUT 971 name="${FC_NAME_NEW}" (bonus_amount preserved=228 both currencies)`);
    console.log(`       preserves: gp_codes=${(p.game_provider_codes||[]).length} cats=${JSON.stringify(p.promotion_category_ids)} merchants=${JSON.stringify((p.merchant_ids||[]).map(m=>m.id))} mt=${p.message_template_id} sms=${p.message_template_sms_id}`);
  } else {
    const putBody = buildQp2PutBody(p, cur, { name: FC_NAME_NEW });
    await authedFetch(site, `/api/bo/promotion/${FC_ID}`, { method: 'PUT', body: putBody });
    // verify
    const after = await getDetail(FC_ID);
    const afterCur = await getCurrency(FC_ID);
    const amts = afterCur.map(c => `${c.currency}=${c.bonus_amount}`).join(',');
    const nameOk = after.name === FC_NAME_NEW;
    const amtOk = afterCur.every(c => Number(c.bonus_amount) === 228);
    const gpOk = (after.game_provider_codes||[]).length === (p.game_provider_codes||[]).length;
    const catOk = JSON.stringify(after.promotion_category_ids) === JSON.stringify(p.promotion_category_ids);
    console.log(`  verify: name="${after.name}"`);
    console.log(`          bonus_amount(${amts}) gp_codes=${(after.game_provider_codes||[]).length} cats=${JSON.stringify(after.promotion_category_ids)} merchants=${JSON.stringify((after.merchant_ids||[]).map(m=>m.id))}`);
    if (nameOk && amtOk && gpOk && catOk) { console.log('  ✓ FIX 3 complete — name fixed, FC amount + config intact'); okCount++; }
    else { console.error(`  ✗ FIX 3 verification FAILED (nameOk=${nameOk} amtOk=${amtOk} gpOk=${gpOk} catOk=${catOk})`); failCount++; }
  }
} catch (e) { console.error(`  ✗ FIX 3 error: ${e.message.split('\n')[0]}`); failCount++; }

console.log(`\n=== SUMMARY ===  OK: ${okCount}  Failed: ${failCount}${DRY ? '  (DRY RUN)' : ''}`);

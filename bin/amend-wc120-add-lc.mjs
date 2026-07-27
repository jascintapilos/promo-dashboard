#!/usr/bin/env node
// Amend WELC_WC120PCT_10X on QP2D (ibc22, promotion id 1265) to the
// "all games except ALLBET / Blackjack / Virtual Sports" configuration.
//
// Change set (ONLY these four fields):
//   1. promotion_category_ids
//   2. game_provider_codes
//   3. target[0].game_provider_codes   (turnover wallet must match)
//   4. blacklist_template_id  -> 1 "All games" (excludes Blackjack + Virtual Sport)
//
// STATUS: applied 2026-07-27. The constants below were reconciled against the
// live record afterwards, so re-running is a no-op rather than a regression.
//
// Everything else is echoed from the live GET detail using the proven
// transform in bin/set-auto-reward-api.mjs. Deviation from that script:
// `black_list_sub_categories` is OMITTED (not echoed) so the server
// re-derives it from the NEW blacklist_template_id — per
// memory/project_qp2_promotion_put_semantics.md. Derivation is async, so the
// verify step polls before judging.
//
//   node bin/amend-wc120-add-lc.mjs             ← dry-run (default, no writes)
//   node bin/amend-wc120-add-lc.mjs --commit    ← live single-record canary
import { authedFetch, readDialogForPreservation } from '../src/api-client.js';
import { getSite } from '../src/sites.js';
import { writeFile, mkdir } from 'node:fs/promises';

const commit = process.argv.includes('--commit');
const site = getSite('ibc22');
const PROMO_ID = 1265;
const CODE = 'WELC_WC120PCT_10X';

// Operator-confirmed category set (waiyip, 2026-07-27): SPORT, LIVE CASINO,
// SLOTS, E-SPORTS, FISHING, CRASH, CRICKET. LOTTERY/POKER/COCK FIGHT/TABLE/
// ARCADE are deliberately out — TABLE and ARCADE are already excluded as
// sub-categories by blacklist template 1, so selecting them would conflict.
const NEW_CATEGORY_IDS = [1, 2, 3, 4, 5, 9, 12];

// Authoritative "all game providers except ALLBET" for QP2, as selected in
// the BO's own provider picker (operator-confirmed 2026-07-27).
// NOTE: /api/bo/gameprovider returns HTTP 500 on ibc22, so this list CANNOT be
// derived from the API — it was read back from the saved record after the
// operator made the selection in the UI. It includes SPRIBE2 and WF, which do
// not appear on any other promo we sampled, and excludes 365G.
const NEW_PROVIDER_CODES = [
  '2BC', '9W', 'AG', 'AP', 'AVI', 'BG', 'BNG', 'BOOM', 'BTG', 'BTI', 'CMD',
  'COSMO', 'CQ9', 'EVOK', 'EZ', 'FC', 'FP', 'FS', 'HSG', 'IM', 'JDB', 'JILI',
  'JK', 'KA', 'LIVE', 'LUCKY', 'MAHA', 'MAX', 'MGP', 'MONKEY', 'NET2', 'NEXT',
  'NLC', 'PP2', 'PTI', 'RG', 'RT2', 'SA', 'SBO2', 'SEXY', 'SG', 'SIMPLE',
  'SPRIBE2', 'TF', 'VIVO', 'WBET', 'WF', 'WM', 'XE', 'YB',
];

const NEW_BLACKLIST_TEMPLATE_ID = 1; // "All games" — excludes Blackjack + Virtual Sport
const EXPECTED_TURNOVER = '12.00';   // already correct on BO; asserted, not changed

const toYmdHis = (iso) => (iso ? String(iso).replace('T', ' ').replace(/\.\d+Z?$/, '') : null);
function depositStatus(d) {
  if (d.last_deposit) return 4;
  if (d.first_deposit || d.ftd) return 3;
  if (d.before_ftd) return 2;
  return 1;
}
const getDetail = async (id) => (await authedFetch(site, `/api/bo/promotion/${id}`)).data.rows;

// The GET detail returns relation arrays as objects, and emits a null
// placeholder row when the relation is empty — e.g.
//   affiliate_ids: [{ id: null, username: null, name: null }]
// Echoing that straight back is rejected: 422 "The selected affiliate_ids.0
// is invalid." Flatten objects to their id and drop nulls so an empty
// relation round-trips as [].
function idList(v) {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (x && typeof x === 'object' ? x.id : x))
    .filter((x) => x != null);
}

// Echo transform — changes ONLY the four intended fields.
function buildBody(d, dlg, { categoryIds, providerCodes, blacklistTemplateId }) {
  const merchantIdsObj = {};
  (Array.isArray(d.merchant_ids) ? d.merchant_ids : [])
    .map((m) => (typeof m === 'object' ? m.id : m))
    .forEach((id, i) => { merchantIdsObj[String(i)] = id; });

  const targetArr = Array.isArray(d.target) ? d.target : (d.target ? [d.target] : []);
  const targetObj = {
    ...(targetArr[0] || { type: 1, multiplier: '1.00' }),
    game_provider_codes: providerCodes,          // ← intended change 3
  };
  const dialogList = (dlg?.id && dlg.fullRow) ? { 0: { ...dlg.fullRow, promotion_id: d.id } } : {};

  return {
    id: d.id, code: d.code, name: d.name,
    bonus_settings: d.bonus_settings ?? 1,
    promo_type: d.promo_type, promo_sub_type: d.promo_sub_type,
    promotion_ids: Array.isArray(d.promo_linked_ids) ? d.promo_linked_ids : [],
    valid_from: toYmdHis(d.valid_from),
    valid_to: toYmdHis(d.valid_to),
    validity: d.validity ?? 1,
    reward_validity: d.reward_validity ?? 1,
    frequency_type: d.frequency_type ?? 1,
    frequency: d.frequency ?? [],
    before_ftd: d.before_ftd ?? 0,
    first_deposit: d.first_deposit ?? 0,
    ftd: d.ftd ?? 0,
    last_deposit: d.last_deposit ?? 0,
    deposit_status: depositStatus(d),
    limit_transfer_out: d.limit_transfer_out ?? 0,
    limit_transfer_in: d.limit_transfer_in ?? 0,
    auto_unlock: d.auto_unlock ?? 1,
    allow_cancel: d.allow_cancel ?? 0,
    withdrawal_unlock: d.withdrawal_unlock ?? 0,
    auto_approve: d.auto_approve ?? 1,
    auto_reward_activation: d.auto_reward_activation ?? 0,
    recurring: d.recurring ?? 0,
    reset_frequency: d.reset_frequency || 1,
    reset_month: d.reset_month || 1,
    max_per_player: d.max_per_player ?? 1,
    daily_max: d.daily_max ?? 1,
    members_only: d.members_only ?? 0,
    fingerprint_check: d.fingerprint_check ?? 0,
    freespin_check: d.freespin_check ?? 0,
    allow_deposit: d.allow_deposit ?? 0,
    allow_continuous_claim: d.allow_continuous_claim ?? 0,
    message_template_id: d.message_template_id ?? 0,
    message_template_sms_id: d.message_template_sms_id ?? 0,
    bonus_rate: d.bonus_rate ?? 0,
    deposit_count: d.deposit_count ?? 0,
    active_period: d.active_period ?? 0,
    eligible_types: d.eligible_types ?? 1,
    free_spin_game_provider_id: d.free_spin_game_provider_id ?? 0,
    ...(d.free_spin_game_code != null ? { free_spin_game_code: d.free_spin_game_code } : {}),
    blacklist_template_id: blacklistTemplateId,   // ← intended change 4
    promotion_category_ids: categoryIds,          // ← intended change 1
    game_provider_codes: providerCodes,           // ← intended change 2
    target: targetObj,
    member_group_ids: idList(d.member_group_ids),
    affiliate_group_ids: idList(d.affiliate_group_ids),
    affiliate_ids: idList(d.affiliate_ids),
    telemarketer_ids: idList(d.telemarketer_ids),
    requires_email: d.requires_email ?? 0,
    requires_mobile: d.requires_mobile ?? 0,
    requires_dob: d.requires_dob ?? 0,
    requires_fullname: d.requires_fullname ?? 0,
    kyc_listing: d.kyc_listing ?? 0,
    // black_list_sub_categories INTENTIONALLY OMITTED — server re-derives
    // from the new blacklist_template_id. Sending it wipes to 0.
    merchant_ids: merchantIdsObj,
    dialog_popup_list: dialogList,
    status: d.status,
  };
}

async function currencySig(id) {
  const rows = (await authedFetch(site, `/api/bo/promotioncurrency?promotion_id=${id}`)).data.rows || [];
  return rows.map((c) => `${c.currency}=rate:${c.bonus_rate}|min:${c.min_deposit ?? c.min_transfer}|maxB:${c.max_bonus}|amt:${c.bonus_amount}|bank:${(c.deposit_options || []).length}`).sort().join(' ;; ');
}
async function nameSig(id) {
  const rows = (await authedFetch(site, `/api/bo/promotionname?promotion_id=${id}`)).data.rows || [];
  return rows.map((n) => `${n.locale}=${n.promotion_name}|${n.rewards_name}`).sort().join(' ;; ');
}
async function dialogSig(code) {
  const r = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(code)}&perPage=10`);
  const row = (r.data.rows || []).find((x) => x.code === code);
  return (row?.dialog_popup_list || []).map((d) => d.popup_id).sort((a, b) => a - b).join(',');
}

// ── Read current state ──────────────────────────────────────────────────
const before = await getDetail(PROMO_ID);
if (before.code !== CODE) throw new Error(`ABORT: id ${PROMO_ID} is "${before.code}", expected "${CODE}"`);

const curCats = before.promotion_category_ids || [];
const curProv = before.game_provider_codes || [];
const curTargetProv = (Array.isArray(before.target) ? before.target[0] : before.target)?.game_provider_codes || [];

const nextCats = [...NEW_CATEGORY_IDS];
const nextProv = [...NEW_PROVIDER_CODES];

const curMult = (Array.isArray(before.target) ? before.target[0] : before.target)?.multiplier;
if (String(curMult) !== EXPECTED_TURNOVER) {
  throw new Error(`ABORT: expected turnover ${EXPECTED_TURNOVER} on BO, found ${curMult}. Turnover change is out of this script's scope.`);
}

console.log(`${commit ? '*** LIVE COMMIT ***' : 'DRY-RUN (no writes)'} — ${CODE} / ibc22 id ${PROMO_ID}\n`);
console.log('── Intended diff ──');
console.log(`  promotion_category_ids : [${curCats}] → [${nextCats}]`);
console.log(`     added categories    : ${nextCats.filter((c) => !curCats.includes(c)).join(',') || '(none)'}`);
console.log(`  game_provider_codes    : ${curProv.length} → ${nextProv.length}`);
console.log(`     added providers     : ${nextProv.filter((c) => !curProv.includes(c)).join(',') || '(none)'}`);
console.log(`     removed providers   : ${curProv.filter((c) => !nextProv.includes(c)).join(',') || '(none)'}`);
console.log(`  target.game_provider_codes: ${curTargetProv.length} → ${nextProv.length}`);
console.log(`  target.multiplier      : ${curMult} (unchanged — already 12x)`);
console.log(`  blacklist_template_id  : ${before.blacklist_template_id} → ${NEW_BLACKLIST_TEMPLATE_ID}  ("All games": excludes Blackjack + Virtual Sport)`);
console.log(`  black_list_sub_categories: OMITTED (server re-derives; currently ${(before.blacklist_sub_categories || []).length} rows)`);
console.log('\n── Preserved (must not change) ──');
console.log(`  status=${before.status}  valid_from=${before.valid_from}  valid_to=${before.valid_to}`);
console.log(`  message_template_id=${before.message_template_id}  sms=${before.message_template_sms_id}`);
console.log(`  merchant_ids=${JSON.stringify((before.merchant_ids || []).map((m) => m.id ?? m))}`);
console.log(`  target.multiplier=${(Array.isArray(before.target) ? before.target[0] : before.target)?.multiplier}`);
console.log(`  currencies: ${await currencySig(PROMO_ID)}`);
console.log(`  names: ${await nameSig(PROMO_ID)}`);
console.log(`  dialog: [${(await dialogSig(CODE)) || '-'}]`);

if (!commit) {
  console.log('\nDry-run only. Re-run with --commit to apply.');
  process.exit(0);
}

// ── Capture full before-state for the drift check ───────────────────────
const curBefore = await currencySig(PROMO_ID);
const namBefore = await nameSig(PROMO_ID);
const dlgBefore = await dialogSig(CODE);

let dlg = null;
if (dlgBefore) {
  const popups = (await authedFetch(site, '/api/bo/popups?perPage=500&page=1&sort_by=id&sort_order=desc')).data?.rows || [];
  dlg = await readDialogForPreservation(site, CODE, popups);
  if (!(dlg?.id && dlg.fullRow)) console.log(`  ! WARN: dialog popup row unresolved (id=${dlg?.id ?? 'none'})`);
}

const body = buildBody(before, dlg, {
  categoryIds: nextCats,
  providerCodes: nextProv,
  blacklistTemplateId: NEW_BLACKLIST_TEMPLATE_ID,
});

await mkdir('captures/snapshots', { recursive: true });
await writeFile('captures/snapshots/wc120-put-body.json', JSON.stringify(body, null, 2));

console.log('\nPUT /api/bo/promotion/1265 …');
await authedFetch(site, `/api/bo/promotion/${PROMO_ID}`, { method: 'PUT', body });
console.log('PUT accepted. Waiting 6s for async blacklist re-derivation…');
await new Promise((r) => setTimeout(r, 6000));

// ── Read back + full-field drift check ──────────────────────────────────
const after = await getDetail(PROMO_ID);
const curAfter = await currencySig(PROMO_ID);
const namAfter = await nameSig(PROMO_ID);
const dlgAfter = await dialogSig(CODE);

const INTENDED = new Set(['promotion_category_ids', 'game_provider_codes', 'target', 'blacklist_template_id', 'blacklist_sub_categories', 'updated_by']);
const drift = [];
// Relation arrays come back as objects with a null placeholder when empty —
// compare them by their flattened id list so [{id:null}] vs [] is not drift.
const RELATION = new Set(['affiliate_ids', 'affiliate_group_ids', 'telemarketer_ids', 'member_group_ids', 'member_ids']);
const norm = (v) => JSON.stringify(v);
for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
  if (INTENDED.has(k)) continue;
  const a = RELATION.has(k) ? idList(before[k]) : before[k];
  const b = RELATION.has(k) ? idList(after[k]) : after[k];
  if (norm(a) !== norm(b)) drift.push(`${k}: ${norm(a)} → ${norm(b)}`);
}
if (curAfter !== curBefore) drift.push(`currencies: ${curBefore} → ${curAfter}`);
if (namAfter !== namBefore) drift.push(`names: ${namBefore} → ${namAfter}`);
if (dlgAfter !== dlgBefore) drift.push(`dialog: [${dlgBefore}] → [${dlgAfter}]`);

console.log('\n── Read-back ──');
console.log(`  promotion_category_ids : ${norm(after.promotion_category_ids)}`);
console.log(`  game_provider_codes    : ${(after.game_provider_codes || []).length} codes`);
console.log(`  target.gp_codes        : ${((Array.isArray(after.target) ? after.target[0] : after.target)?.game_provider_codes || []).length} codes`);
console.log(`  target.multiplier      : ${(Array.isArray(after.target) ? after.target[0] : after.target)?.multiplier}`);
console.log(`  blacklist_template_id  : ${after.blacklist_template_id}`);
console.log(`  blacklist_sub_categories: ${(after.blacklist_sub_categories || []).length} rows`);
console.log(`  status                 : ${after.status}`);

const okCats = norm(after.promotion_category_ids) === norm(nextCats);
const okProv = (after.game_provider_codes || []).length === nextProv.length && nextProv.every((c) => (after.game_provider_codes || []).includes(c));
const okBl = after.blacklist_template_id === NEW_BLACKLIST_TEMPLATE_ID;

console.log('\n── Verdict ──');
console.log(`  categories applied : ${okCats ? 'YES' : 'NO'}`);
console.log(`  providers applied  : ${okProv ? 'YES' : 'NO'}`);
console.log(`  blacklist applied  : ${okBl ? 'YES' : 'NO'}`);
if (drift.length) {
  console.log(`  UNRELATED DRIFT (${drift.length}):`);
  drift.forEach((d) => console.log(`    ⚠ ${d}`));
} else {
  console.log('  unrelated drift    : NONE');
}

await writeFile('captures/snapshots/wc120-after.json', JSON.stringify({ after, curAfter, namAfter, dlgAfter, drift }, null, 2));
console.log('\nAfter-state → captures/snapshots/wc120-after.json');
process.exit(okCats && okProv && okBl && !drift.length ? 0 : 1);

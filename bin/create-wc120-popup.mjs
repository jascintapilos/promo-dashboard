#!/usr/bin/env node
// Create a Dialog Popup for WELC_WC120PCT_10X on QP2D (SPADE66) and link it
// to promotion 1265.
//
// Conventions follow live SPADE66 popups probed 2026-07-28 (ids 1941/1942):
//   position 99 · session 3 (After Login) · platform 1 · location 1
//   always_pop 0 · affiliates_visibility 0 · end_date open
//   DUAL CTA → CLAIM NOW /member/reward + READ MORE /member/message
// The CTA is uniform for ALL bonus types (memory feedback_popup_cta_always_
// claim_reward) — this deliberately does NOT use the mapper's older
// min_deposit>0 → /member/deposit branch, which is superseded.
//
// Linking re-uses the echo-PUT transform so the promo's categories,
// providers, blacklist and currencies cannot be collaterally wiped.
//
//   node bin/create-wc120-popup.mjs            ← dry-run
//   node bin/create-wc120-popup.mjs --commit   ← live
import { authedFetch, createDialogPopup } from '../src/api-client.js';
import { getSite } from '../src/sites.js';
import { writeFile, mkdir } from 'node:fs/promises';

const commit = process.argv.includes('--commit');
const site = getSite('ibc22');
const PROMO_ID = 1265;
const CODE = 'WELC_WC120PCT_10X';
const SITE_ID = 4; // SPADE66

const NAME_EN = '120% Welcome Bonus';
const NAME_ZH = '120% 迎新红利';

// locale_id -> { docKey, currency, minDeposit }
const LOCALES = {
  1: { code: 'MY_EN', dk: 'EN', ccy: 'MYR', min: 30 },
  3: { code: 'MY_ZH', dk: 'ZH', ccy: 'MYR', min: 30 },
  6: { code: 'SG_EN', dk: 'EN', ccy: 'SGD', min: 50 },
  7: { code: 'SG_ZH', dk: 'ZH', ccy: 'SGD', min: 50 },
};

const CTA = {
  EN: { t1: 'CLAIM NOW', t2: 'READ MORE' },
  ZH: { t1: '立即领取', t2: '阅读更多' },
};

function bodyEN(ccy, min, name) {
  return `<p><strong>How to Apply:</strong></p>
<ol>
  <li>Go to the [Transfer] page and select your game provider.</li>
  <li>Enter amount ${ccy} ${min} and above</li>
  <li>Choose <strong>[${name} ]</strong> under "Promotion" and click SUBMIT.</li>
</ol>
<p><strong><em><span style="color:#FF0000;">*For full promotion terms &amp; conditions, check your Inbox.</span></em></strong></p>`;
}
function bodyZH(ccy, min, name) {
  return `<p><strong>如何申请：</strong></p>
<ol>
  <li>前往[转账]页面并选择您的游戏提供商。</li>
  <li>输入 ${ccy} ${min} 或以上金额</li>
  <li>在"促销"下选择<strong>[${name} ]</strong>并点击提交。</li>
</ol>
<p><strong><em><span style="color:#FF0000;">*完整条款及条件，请查看您的收件箱。</span></em></strong></p>`;
}

// MUST be UTC. The BO stores the submitted "Y-m-d H:i:s" string as-if UTC,
// so local-time getters on this GMT+8 VDI produce a start_date 8 hours in
// the future and the popup silently fails validation with "The date validity
// interval has expired/has not reached the specified date period".
// Mirrors nowYmdHms() in src/api-mapper-qp2.js.
function nowYmdHms() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

const contents = {};
for (const [lid, L] of Object.entries(LOCALES)) {
  const name = L.dk === 'ZH' ? NAME_ZH : NAME_EN;
  contents[lid] = {
    locale_id: Number(lid),
    content: L.dk === 'ZH' ? bodyZH(L.ccy, L.min, name) : bodyEN(L.ccy, L.min, name),
    title: name,
    mobile_link: null,
    desktop_link: null,
    video_mobile_link: null,
    video_desktop_link: null,
    media_type: null,
    cta_button_type: 2,
    cta_button_text_1: CTA[L.dk].t1,
    cta_button_link_1: '/member/reward',
    cta_button_text_2: CTA[L.dk].t2,
    cta_button_link_2: '/member/message',
  };
}

const popupBody = {
  site_id: SITE_ID,
  platform: 1,
  start_date: nowYmdHms(),
  session: '3',
  position: 99,
  status: 1,
  contents,
  location: 1,
  affiliates_visibility: 0,
  always_pop: 0,
  do_not_show_again: 0,
  label: NAME_EN,
};

// ── Preflight ───────────────────────────────────────────────────────────
const before = (await authedFetch(site, `/api/bo/promotion/${PROMO_ID}`)).data.rows;
if (before.code !== CODE) throw new Error(`ABORT: id ${PROMO_ID} is "${before.code}"`);

const listRow = ((await authedFetch(site, `/api/bo/promotion?code=${CODE}&perPage=10`)).data.rows || [])
  .find((r) => r.id === PROMO_ID);
const existing = listRow?.dialog_popup_list || [];
console.log(`${commit ? '*** LIVE ***' : 'DRY-RUN (no writes)'} — dialog popup for ${CODE} / SPADE66\n`);
console.log(`  existing dialog links on promo: ${existing.length ? JSON.stringify(existing) : 'none'}`);
if (existing.length) {
  console.log('  ! A popup is already linked. Aborting so an existing link is never silently replaced.');
  process.exit(1);
}

console.log('\n── Popup to create ──');
console.log(`  site_id=${SITE_ID} (SPADE66)  position=99  session=3 (After Login)  platform=1  location=1`);
console.log(`  start=${popupBody.start_date}  end=(open)  always_pop=0  affiliates_visibility=0`);
console.log(`  label="${popupBody.label}"`);
for (const [lid, c] of Object.entries(contents)) {
  console.log(`\n  locale ${lid} (${LOCALES[lid].code}) title="${c.title}"`);
  console.log(`     CTA: "${c.cta_button_text_1}"→${c.cta_button_link_1}  |  "${c.cta_button_text_2}"→${c.cta_button_link_2}`);
  console.log(c.content.split('\n').map((l) => `     ${l}`).join('\n'));
}

if (!commit) {
  await mkdir('captures/snapshots', { recursive: true });
  await writeFile('captures/snapshots/wc120-popup-proposed.json', JSON.stringify(popupBody, null, 2));
  console.log('\nDry-run only → captures/snapshots/wc120-popup-proposed.json');
  process.exit(0);
}

// ── Create ──────────────────────────────────────────────────────────────
console.log('\nPOST /api/bo/popups …');
const created = await createDialogPopup(site, popupBody);
console.log(`  response: ${JSON.stringify(created?.message)}`);

// Resolve the saved row (no single-record GET — walk the listing).
const popups = (await authedFetch(site, '/api/bo/popups?perPage=500&page=1&sort_by=id&sort_order=desc')).data?.rows || [];
// NOTE: `label` is not persisted by this BO (every row reads back as the
// literal string "undefined"), so match on site_id + our exact locale titles.
const mine = popups
  .filter((p) => Number(p.site_id) === SITE_ID
    && (p.contents || []).length === 4
    && (p.contents || []).every((c) => c.title === NAME_EN || c.title === NAME_ZH))
  .sort((a, b) => b.id - a.id)[0];
if (!mine) throw new Error('ABORT: created popup not found in listing');
console.log(`  created popup id=${mine.id} code=${mine.code} locales=${(mine.contents || []).length}`);

// ── Link to the promotion via echo-PUT ──────────────────────────────────
const toYmdHis = (iso) => (iso ? String(iso).replace('T', ' ').replace(/\.\d+Z?$/, '') : null);
function idList(v) {
  if (!Array.isArray(v)) return [];
  return v.map((x) => (x && typeof x === 'object' ? x.id : x)).filter((x) => x != null);
}
function depositStatus(d) {
  if (d.last_deposit) return 4;
  if (d.first_deposit || d.ftd) return 3;
  if (d.before_ftd) return 2;
  return 1;
}
const d = before;
const merchantIdsObj = {};
idList(d.merchant_ids).forEach((id, i) => { merchantIdsObj[String(i)] = id; });
const targetObj = (Array.isArray(d.target) ? d.target[0] : d.target) || { type: 1, multiplier: '1.00' };

const putBody = {
  id: d.id, code: d.code, name: d.name,
  bonus_settings: d.bonus_settings ?? 1,
  promo_type: d.promo_type, promo_sub_type: d.promo_sub_type,
  promotion_ids: Array.isArray(d.promo_linked_ids) ? d.promo_linked_ids : [],
  valid_from: toYmdHis(d.valid_from), valid_to: toYmdHis(d.valid_to),
  validity: d.validity ?? 1, reward_validity: d.reward_validity ?? 1,
  frequency_type: d.frequency_type ?? 1, frequency: d.frequency ?? [],
  before_ftd: d.before_ftd ?? 0, first_deposit: d.first_deposit ?? 0,
  ftd: d.ftd ?? 0, last_deposit: d.last_deposit ?? 0,
  deposit_status: depositStatus(d),
  limit_transfer_out: d.limit_transfer_out ?? 0, limit_transfer_in: d.limit_transfer_in ?? 0,
  auto_unlock: d.auto_unlock ?? 1, allow_cancel: d.allow_cancel ?? 0,
  withdrawal_unlock: d.withdrawal_unlock ?? 0, auto_approve: d.auto_approve ?? 1,
  auto_reward_activation: d.auto_reward_activation ?? 0,
  recurring: d.recurring ?? 0, reset_frequency: d.reset_frequency || 1, reset_month: d.reset_month || 1,
  max_per_player: d.max_per_player ?? 1, daily_max: d.daily_max ?? 1,
  members_only: d.members_only ?? 0, fingerprint_check: d.fingerprint_check ?? 0,
  freespin_check: d.freespin_check ?? 0, allow_deposit: d.allow_deposit ?? 0,
  allow_continuous_claim: d.allow_continuous_claim ?? 0,
  message_template_id: d.message_template_id ?? 0,
  message_template_sms_id: d.message_template_sms_id ?? 0,
  bonus_rate: d.bonus_rate ?? 0, deposit_count: d.deposit_count ?? 0,
  active_period: d.active_period ?? 0, eligible_types: d.eligible_types ?? 1,
  free_spin_game_provider_id: d.free_spin_game_provider_id ?? 0,
  ...(d.free_spin_game_code != null ? { free_spin_game_code: d.free_spin_game_code } : {}),
  blacklist_template_id: d.blacklist_template_id,
  promotion_category_ids: d.promotion_category_ids ?? [],
  game_provider_codes: d.game_provider_codes ?? [],
  target: targetObj,
  member_group_ids: idList(d.member_group_ids),
  affiliate_group_ids: idList(d.affiliate_group_ids),
  affiliate_ids: idList(d.affiliate_ids),
  telemarketer_ids: idList(d.telemarketer_ids),
  requires_email: d.requires_email ?? 0, requires_mobile: d.requires_mobile ?? 0,
  requires_dob: d.requires_dob ?? 0, requires_fullname: d.requires_fullname ?? 0,
  kyc_listing: d.kyc_listing ?? 0,
  // black_list_sub_categories omitted — server re-derives from the template.
  merchant_ids: merchantIdsObj,
  dialog_popup_list: { 0: { ...mine, promotion_id: PROMO_ID } },
  status: d.status,
};

console.log(`\nPUT /api/bo/promotion/${PROMO_ID} — linking popup ${mine.code} …`);
await authedFetch(site, `/api/bo/promotion/${PROMO_ID}`, { method: 'PUT', body: putBody });
await new Promise((r) => setTimeout(r, 5000));

// ── Verify ──────────────────────────────────────────────────────────────
const after = (await authedFetch(site, `/api/bo/promotion/${PROMO_ID}`)).data.rows;
const afterList = ((await authedFetch(site, `/api/bo/promotion?code=${CODE}&perPage=10`)).data.rows || [])
  .find((r) => r.id === PROMO_ID);
const linked = afterList?.dialog_popup_list || [];

console.log('\n── Verify ──');
console.log(`  popup linked        : ${linked.length ? `YES (popup_id=${linked.map((x) => x.popup_id).join(',')})` : 'NO'}`);
console.log(`  categories intact   : ${JSON.stringify(after.promotion_category_ids)}`);
console.log(`  providers intact    : ${(after.game_provider_codes || []).length}`);
console.log(`  blacklist template  : ${after.blacklist_template_id}`);
console.log(`  blacklist sub rows  : ${(after.blacklist_sub_categories || []).length}`);
console.log(`  turnover            : ${(Array.isArray(after.target) ? after.target[0] : after.target)?.multiplier}`);
console.log(`  message_template_id : ${after.message_template_id}`);
console.log(`  status              : ${after.status}`);

const ok = linked.some((x) => x.popup_id === mine.id)
  && (after.game_provider_codes || []).length === (before.game_provider_codes || []).length
  && Number(after.blacklist_template_id) === Number(before.blacklist_template_id)
  && Number(after.status) === Number(before.status)
  && Number(after.message_template_id) === Number(before.message_template_id);

await mkdir('captures/snapshots', { recursive: true });
await writeFile('captures/snapshots/wc120-popup-after.json', JSON.stringify({ popup: mine, after, linked }, null, 2));
console.log(ok ? '\nPopup created and linked; promo config intact.' : '\nVERIFICATION FAILED — inspect before proceeding.');
process.exit(ok ? 0 : 1);

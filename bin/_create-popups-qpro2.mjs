#!/usr/bin/env node
// Create + link Login Popup for ALL TLEO codes on qpro2 (54 codes).
// qpro2 is the source-of-truth brand; MT subjects are already canonical
// (descriptive titles). Idempotent: skips codes already linked.
//
// Same proven shape as _create-popups-qpro3-4-10.mjs but scope = all TLEO
// codes on qpro2 (no TARGET_CODES filter).

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const BRAND = 'qpro2';
const DRY = process.argv.includes('--dry-run');
const CANARY = process.argv.includes('--canary');
if (DRY) console.log('*** DRY RUN ***\n');
if (CANARY) console.log('*** CANARY (1 code) ***\n');

const nowYmdHms = () => new Date().toISOString().replace('T',' ').replace(/\.\d+Z$/,'');
const intAmount = v => String(Math.round(Number(v)));
const arrToObj = a => { const o={}; (a||[]).forEach((v,i)=>{o[String(i)]=v;}); return o; };
const fmtDate = d => d ? String(d).replace('T',' ').replace(/\.\d+Z?$/,'') : d;
const b01 = v => (v===true?1:v===false?0:v);
const hasPopup = p => { const d = p.dialog_popup_list; return Array.isArray(d) ? d.length > 0 : (d && Object.keys(d || {}).length > 0); };

function buildEnContent(title, currency, minDep) {
  const amt = intAmount(minDep);
  return `<p><strong>How to Apply:</strong><br><br>1. Go to the [Transfer] page and select your game provider.<br>2. Enter amount ${currency} ${amt} and above<br>3. Choose [<strong>${title}</strong>] under "Promotion" and click SUBMIT.<br><br><span style="color:hsl(0,75%,60%);"><strong>*For full promotion terms &amp; conditions, check your Inbox.</strong></span></p>`;
}
function buildZhContent(titleZh, currency, minDep) {
  const amt = intAmount(minDep);
  return `<p><strong>如何申请：</strong></p><p>1. 点击 [转账] 页面并选择您的游戏提供商。<br>2. 输入金额 ${currency} ${amt} <span class="Y2IQFc" lang="zh-CN">以上</span><br>3. 在"促销"下选择 <strong>[${titleZh} ]</strong> 并点击提交。</p><p><span style="color:hsl(0,75%,60%);"><strong>*有关完整促销条款和条件，请查看您的收件箱。</strong></span></p>`;
}

function buildPopupPostBody(titleEn, titleZh, minDepMyr, minDepSgd) {
  // qpro2 has both MYR + SGD currencies — emit all 4 locales
  const contents = {
    '1': { locale_id: 1, title: titleEn, content: buildEnContent(titleEn, 'MYR', minDepMyr ?? minDepSgd ?? 0), mobile_link: null, desktop_link: null, video_mobile_link: null, video_desktop_link: null, media_type: null, cta_button_type: 2, cta_button_text_1: 'CLAIM NOW', cta_button_link_1: '/member/reward', cta_button_text_2: 'READ MORE', cta_button_link_2: '/member/message' },
    '3': { locale_id: 3, title: titleZh || titleEn, content: buildZhContent(titleZh || titleEn, 'MYR', minDepMyr ?? minDepSgd ?? 0), mobile_link: null, desktop_link: null, video_mobile_link: null, video_desktop_link: null, media_type: null, cta_button_type: 2, cta_button_text_1: '立即领取', cta_button_link_1: '/member/reward', cta_button_text_2: '阅读更多', cta_button_link_2: '/member/message' },
    '6': { locale_id: 6, title: titleEn, content: buildEnContent(titleEn, 'SGD', minDepSgd ?? minDepMyr ?? 0), mobile_link: null, desktop_link: null, video_mobile_link: null, video_desktop_link: null, media_type: null, cta_button_type: 2, cta_button_text_1: 'CLAIM NOW', cta_button_link_1: '/member/reward', cta_button_text_2: 'READ MORE', cta_button_link_2: '/member/message' },
    '7': { locale_id: 7, title: titleZh || titleEn, content: buildZhContent(titleZh || titleEn, 'SGD', minDepSgd ?? minDepMyr ?? 0), mobile_link: null, desktop_link: null, video_mobile_link: null, video_desktop_link: null, media_type: null, cta_button_type: 2, cta_button_text_1: '立即领取', cta_button_link_1: '/member/reward', cta_button_text_2: '阅读更多', cta_button_link_2: '/member/message' },
  };
  return {
    platform: 1, start_date: nowYmdHms(), session: 3, position: 99, status: 1, location: 1,
    affiliates_visibility: 0, always_pop: 0, label: titleEn, contents,
  };
}

function buildQproPutBody(p, dialogEntry) {
  const catTov = arrToObj((p.promotion_category || []).filter(c => c.target_type === 1).map(c => c.category_id));
  const targetObj = {};
  (p.target || []).forEach((t, i) => { targetObj[String(i)] = { type: t.type, multiplier: t.multiplier, game_provider_ids: arrToObj(t.game_provider_ids || []) }; });
  return {
    id: p.id, code: p.code, name: p.name,
    free_spin_game_provider_id: p.free_spin_game_provider_id ?? 0,
    ...(p.free_spin_game_code ? { free_spin_game_code: p.free_spin_game_code } : {}),
    promotion_category_turnover: catTov, promotion_category_winloss: [],
    promo_type: p.promo_type, promo_sub_type: Number(p.promo_sub_type), promotion_ids: [],
    valid_from: fmtDate(p.valid_from), validity: p.validity, reward_validity: p.reward_validity,
    frequency: p.frequency ?? [], frequency_type: Number(p.frequency_type),
    first_deposit: p.first_deposit ?? 0, member_group_ids: [],
    last_deposit: b01(p.last_deposit ?? 0), auto_approve: b01(p.auto_approve),
    visible_by_affiliate: p.visible_by_affiliate ?? 0, recurring: Number(p.recurring),
    max_per_player: p.max_per_player, daily_max: p.daily_max, status: p.status ?? 1,
    limit_transfer_in: b01(p.limit_transfer_in ?? 0), limit_transfer_out: b01(p.limit_transfer_out ?? 0),
    restrict_claim_round_active: b01(p.restrict_claim_round_active ?? 0),
    restrict_same_provider_launch: b01(p.restrict_same_provider_launch ?? 0),
    bonus_rate: p.bonus_rate != null ? String(Number(p.bonus_rate).toFixed(2)) : undefined,
    ...(p.reset_frequency != null ? { reset_frequency: p.reset_frequency } : {}),
    auto_unlock: b01(p.auto_unlock), allow_cancel: p.allow_cancel,
    game_provider_ids: arrToObj(p.game_provider_ids || []), target: targetObj,
    message_template_id: p.message_template_id ?? 0, message_template_sms_id: p.message_template_sms_id ?? 0,
    eligible_types: Number(p.eligible_types),
    affiliate_group_ids: [], telemarketer_ids: [], normal_account_manager_ids: [], vip_account_manager_ids: [],
    requires_email: p.requires_email ?? 0, requires_mobile: p.requires_mobile ?? 0,
    requires_dob: p.requires_dob ?? 0, requires_fullname: p.requires_fullname ?? 0,
    transfer_unlock: b01(p.transfer_unlock ?? 0),
    kyc_basic: p.kyc_basic ?? 1, kyc_advanced: p.kyc_advanced ?? 1, kyc_pro: p.kyc_pro ?? 1,
    blacklist_id: p.blacklist_id, black_list_sub_categories: [],
    currencies_ids: p.currencies_ids ?? [],
    dialog_popup_list: dialogEntry ? { '0': dialogEntry } : [],
  };
}

const mtCache = {};
async function getMtSubjects(site, mtId) {
  if (mtCache[mtId]) return mtCache[mtId];
  const r = await authedFetch(site, `/api/bo/messagetemplate/${mtId}`);
  const details = Object.values(r.data?.message_details || {});
  const subjects = {};
  details.forEach(d => { subjects[d.settings_locales_code] = d.subject; });
  mtCache[mtId] = subjects;
  return subjects;
}

const site = getSite(BRAND);
const r = await authedFetch(site, '/api/bo/promotion?code=TLEO&perPage=200&page=1');
let tleo = Object.values(r.data?.rows || {}).filter(p => p.code?.includes('TLEO'));
if (CANARY) tleo = [tleo.find(p => p.code === 'FT_REL_TLEO_LC_45PCT_48MX') || tleo[0]];
console.log(`Found ${tleo.length} TLEO codes on ${BRAND}\n`);

let ok = 0, skip = 0, err = 0; const report = [];

for (const promo of tleo) {
  if (hasPopup(promo)) { console.log(`  ⊘ ${promo.code}: already linked`); skip++; continue; }
  const r2 = await authedFetch(site, `/api/bo/promotion/${promo.id}`);
  const p = r2.data?.rows;
  const mtId = p.message_template_id;
  if (!mtId) { console.warn(`  SKIP ${promo.code} — no MT`); err++; report.push({code:promo.code,status:'NO_MT'}); continue; }
  let subjects;
  try { subjects = await getMtSubjects(site, mtId); }
  catch(e) { console.error(`  SKIP ${promo.code} — MT fetch: ${e.message.split('\n')[0]}`); err++; report.push({code:promo.code,status:'MT_ERR'}); continue; }
  const titleEn = subjects['MY_EN'] || subjects['SG_EN'];
  const titleZh = subjects['MY_ZH'] || subjects['SG_ZH'];
  if (!titleEn) { console.error(`  SKIP ${promo.code} — no EN subject`); err++; report.push({code:promo.code,status:'NO_EN'}); continue; }
  const rc = await authedFetch(site, `/api/bo/promotioncurrency?promotion_id=${promo.id}&perPage=20&page=1`);
  const crows = Object.values(rc.data?.rows || {});
  const myrRow = crows.find(c => c.currency === 'MYR');
  const sgdRow = crows.find(c => c.currency === 'SGD');
  const minDepMyr = myrRow?.min_transfer;
  const minDepSgd = sgdRow?.min_transfer;
  if (DRY) { console.log(`  DRY ${promo.code}  EN="${titleEn}"  myrMin=${minDepMyr ?? 'n/a'}  sgdMin=${minDepSgd ?? 'n/a'}`); ok++; continue; }

  const popupBody = buildPopupPostBody(titleEn, titleZh, minDepMyr, minDepSgd);
  let popup;
  try {
    const rp = await authedFetch(site, '/api/bo/popups', { method: 'POST', body: popupBody });
    const pd = rp.data?.rows || rp.data;
    if (!pd?.id) throw new Error(`No id in resp: ${JSON.stringify(rp.data)?.slice(0,200)}`);
    popup = { id: pd.id, code: pd.code, start_date: pd.start_date || nowYmdHms() };
  } catch(e) { console.error(`  ✗ popup POST ${promo.code}: ${e.message.split('\n')[0]}`); err++; report.push({code:promo.code,status:'POPUP_ERR'}); continue; }

  const dialogEntry = { id: popup.id, start_date: popup.start_date, end_date: null, promotion_id: promo.id, labelKey: `${popup.code} (${titleEn.slice(0,14)} . . . )`, code: popup.code };
  try {
    await authedFetch(site, `/api/bo/promotion/${promo.id}`, { method: 'PUT', body: buildQproPutBody(p, dialogEntry) });
    // verify
    const vl = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(promo.code)}&perPage=5`);
    const vrow = Object.values(vl.data?.rows || {}).find(x => x.id === promo.id);
    const linked = hasPopup(vrow);
    if (linked) { console.log(`  ✓ ${promo.code}  popup_id=${popup.id} (${popup.code})`); ok++; report.push({code:promo.code,status:'OK',popupId:popup.id}); }
    else { console.log(`  ⚠ ${promo.code}: PUT OK but not linked`); err++; report.push({code:promo.code,status:'NOT_LINKED',popupId:popup.id}); }
  } catch(e) { console.error(`  ✗ PUT link ${promo.code} (popup ${popup.id} orphan): ${e.message.split('\n')[0]}`); err++; report.push({code:promo.code,status:'PUT_ERR',popupId:popup.id}); }
}

console.log(`\n=== SUMMARY === OK: ${ok}  Errors: ${err}  Skipped: ${skip}`);
const errs = report.filter(r => r.status !== 'OK');
if (errs.length) errs.forEach(r => console.log(`  ${r.code}: ${r.status}${r.popupId?' (popup '+r.popupId+' orphan)':''}`));

#!/usr/bin/env node
// Create + link Login Popup dialogs for all TLEO promos on 6 QPRO sites.
//
// Content format (per screenshot + qpro2 popup reference):
//   Title  = MT subject per locale (MY_EN/MY_ZH/SG_EN/SG_ZH)
//   Body   = "How to Apply" template with min_deposit from promotioncurrency
//   CTAs   = CLAIM NOW → /member/reward  |  READ MORE → /member/message
//   Session= 3 (After Login)  Position=99  Platform=All
//
// Run: node bin/_add-dialog-popup-tleo.mjs [--dry-run]

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const QPRO_SITES = ['qpro2','qpro3','qpro4','qpro6','qpro8','qpro10'];
const DRY_RUN = process.argv.includes('--dry-run');

if (DRY_RUN) console.log('*** DRY RUN — no writes ***\n');

// ── helpers ───────────────────────────────────────────────────────────────────

function nowYmdHms() {
  return new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
}

function intAmount(val) {
  return String(Math.round(Number(val)));
}

function buildEnContent(title, currency, minDep) {
  const amt = intAmount(minDep);
  return `<p><strong>How to Apply:</strong><br><br>1. Go to the [Transfer] page and select your game provider.<br>2. Enter amount ${currency} ${amt} and above<br>3. Choose [<strong>${title}</strong>] under "Promotion" and click SUBMIT.<br><br><span style="color:hsl(0,75%,60%);"><strong>*For full promotion terms &amp; conditions, check your Inbox.</strong></span></p>`;
}

function buildZhContent(titleZh, currency, minDep) {
  const amt = intAmount(minDep);
  return `<p><strong>如何申请：</strong></p><p>1. 点击 [转账] 页面并选择您的游戟提供商。<br>2. 输入金额 ${currency} ${amt} <span class="Y2IQFc" lang="zh-CN">以上</span><br>3. 在"促销"下选择 <strong>[${titleZh} ]</strong> 并点击提交。</p><p><span style="color:hsl(0,75%,60%);"><strong>*有关完整促销条款和条件，请查看您的收件筱。</strong></span></p>`;
}

function buildPopupPostBody(titleEn, titleZh, minDep) {
  return {
    platform: 1,
    start_date: nowYmdHms(),
    session: 3,          // After Login — satisfies "Login Popup" QA requirement
    position: 99,
    status: 1,
    location: 1,
    affiliates_visibility: 0,
    always_pop: 0,
    label: titleEn,
    contents: {
      '1': {  // MY_EN
        locale_id: 1, title: titleEn,
        content: buildEnContent(titleEn, 'MYR', minDep),
        mobile_link: null, desktop_link: null,
        video_mobile_link: null, video_desktop_link: null, media_type: null,
        cta_button_type: 2,
        cta_button_text_1: 'CLAIM NOW',   cta_button_link_1: '/member/reward',
        cta_button_text_2: 'READ MORE',   cta_button_link_2: '/member/message',
      },
      '3': {  // MY_ZH
        locale_id: 3, title: titleZh || titleEn,
        content: buildZhContent(titleZh || titleEn, 'MYR', minDep),
        mobile_link: null, desktop_link: null,
        video_mobile_link: null, video_desktop_link: null, media_type: null,
        cta_button_type: 2,
        cta_button_text_1: '立即领取',    cta_button_link_1: '/member/reward',
        cta_button_text_2: '阅读更多',    cta_button_link_2: '/member/message',
      },
      '6': {  // SG_EN
        locale_id: 6, title: titleEn,
        content: buildEnContent(titleEn, 'SGD', minDep),
        mobile_link: null, desktop_link: null,
        video_mobile_link: null, video_desktop_link: null, media_type: null,
        cta_button_type: 2,
        cta_button_text_1: 'CLAIM NOW',   cta_button_link_1: '/member/reward',
        cta_button_text_2: 'READ MORE',   cta_button_link_2: '/member/message',
      },
      '7': {  // SG_ZH
        locale_id: 7, title: titleZh || titleEn,
        content: buildZhContent(titleZh || titleEn, 'SGD', minDep),
        mobile_link: null, desktop_link: null,
        video_mobile_link: null, video_desktop_link: null, media_type: null,
        cta_button_type: 2,
        cta_button_text_1: '立即领取',    cta_button_link_1: '/member/reward',
        cta_button_text_2: '阅读更多',    cta_button_link_2: '/member/message',
      },
    },
  };
}

// ── QPRO PUT body builder (preserves all current settings + adds popup link) ──

function arrToObj(arr) {
  const o = {};
  (arr || []).forEach((v, i) => { o[String(i)] = v; });
  return o;
}

function fmtDate(d) {
  return d ? String(d).replace('T', ' ').replace(/\.\d+Z?$/, '') : d;
}

function buildQproPutBody(p, dialogEntry) {
  const catTov = arrToObj(
    (p.promotion_category || []).filter(c => c.target_type === 1).map(c => c.category_id)
  );
  const targetObj = {};
  (p.target || []).forEach((t, i) => {
    targetObj[String(i)] = {
      type: t.type, multiplier: t.multiplier,
      game_provider_ids: arrToObj(t.game_provider_ids || []),
    };
  });
  const b01 = v => (v === true ? 1 : v === false ? 0 : v);
  return {
    id: p.id, code: p.code, name: p.name,
    free_spin_game_provider_id: p.free_spin_game_provider_id ?? 0,
    ...(p.free_spin_game_code ? { free_spin_game_code: p.free_spin_game_code } : {}),
    promotion_category_turnover: catTov, promotion_category_winloss: [],
    promo_type: p.promo_type, promo_sub_type: Number(p.promo_sub_type),
    promotion_ids: [],
    valid_from: fmtDate(p.valid_from),
    validity: p.validity, reward_validity: p.reward_validity,
    frequency: p.frequency ?? [], frequency_type: Number(p.frequency_type),
    first_deposit: p.first_deposit ?? 0, member_group_ids: [],
    last_deposit: b01(p.last_deposit ?? 0), auto_approve: b01(p.auto_approve),
    visible_by_affiliate: p.visible_by_affiliate ?? 0, recurring: Number(p.recurring),
    max_per_player: p.max_per_player, daily_max: p.daily_max,
    status: p.status ?? 1,
    limit_transfer_in: b01(p.limit_transfer_in ?? 0), limit_transfer_out: b01(p.limit_transfer_out ?? 0),
    restrict_claim_round_active: b01(p.restrict_claim_round_active ?? 0),
    restrict_same_provider_launch: b01(p.restrict_same_provider_launch ?? 0),
    bonus_rate: p.bonus_rate != null ? String(Number(p.bonus_rate).toFixed(2)) : undefined,
    ...(p.reset_frequency != null ? { reset_frequency: p.reset_frequency } : {}),
    auto_unlock: b01(p.auto_unlock), allow_cancel: p.allow_cancel,
    game_provider_ids: arrToObj(p.game_provider_ids || []),
    target: targetObj,
    message_template_id: p.message_template_id ?? 0,
    message_template_sms_id: p.message_template_sms_id ?? 0,
    eligible_types: Number(p.eligible_types),
    affiliate_group_ids: [], telemarketer_ids: [],
    normal_account_manager_ids: [], vip_account_manager_ids: [],
    requires_email: p.requires_email ?? 0, requires_mobile: p.requires_mobile ?? 0,
    requires_dob: p.requires_dob ?? 0, requires_fullname: p.requires_fullname ?? 0,
    transfer_unlock: b01(p.transfer_unlock ?? 0),
    kyc_basic: p.kyc_basic ?? 1, kyc_advanced: p.kyc_advanced ?? 1, kyc_pro: p.kyc_pro ?? 1,
    blacklist_id: p.blacklist_id,
    black_list_sub_categories: [],
    currencies_ids: p.currencies_ids ?? [],
    // Dialog popup link (QPRO 6-field shape, keyed by "0")
    dialog_popup_list: dialogEntry ? { '0': dialogEntry } : [],
  };
}

// ── MT subject cache (site+mtId keyed) ───────────────────────────────────────

const mtCache = {};

async function getMtSubjects(site, mtId) {
  const key = `${site.id || site}:${mtId}`;
  if (mtCache[key]) return mtCache[key];
  const r = await authedFetch(site, `/api/bo/messagetemplate/${mtId}`);
  const details = Object.values(r.data?.message_details || {});
  const subjects = {};
  details.forEach(d => { subjects[d.settings_locales_code] = d.subject; });
  mtCache[key] = subjects;
  return subjects;
}

// ── Main ──────────────────────────────────────────────────────────────────────

let totalOk = 0, totalErr = 0;
const report = [];

for (const siteId of QPRO_SITES) {
  const site = getSite(siteId);
  console.log(`\n=== ${siteId} ===`);

  const r = await authedFetch(site, '/api/bo/promotion?code=FT_REL_TLEO&perPage=200&page=1');
  const rows = r.data?.rows || [];
  const tleo = (Array.isArray(rows) ? rows : Object.values(rows)).filter(p => p.code?.includes('TLEO'));
  console.log(`  Found ${tleo.length} TLEO promos`);

  for (const promo of tleo) {
    // 1. GET full promo detail
    const r2 = await authedFetch(site, `/api/bo/promotion/${promo.id}`);
    const p = r2.data?.rows;
    const mtId = p.message_template_id;
    if (!mtId) {
      console.warn(`  SKIP ${promo.code} — no message_template_id`);
      totalErr++;
      report.push({ siteId, code: promo.code, pid: promo.id, status: 'NO_MT' });
      continue;
    }

    // 2. GET MT subjects per locale
    let subjects;
    try {
      subjects = await getMtSubjects(site, mtId);
    } catch(e) {
      console.error(`  SKIP ${promo.code} — MT fetch failed: ${e.message.split('\n')[0]}`);
      totalErr++;
      report.push({ siteId, code: promo.code, pid: promo.id, status: 'MT_ERR' });
      continue;
    }
    const titleEn = subjects['MY_EN'] || subjects['SG_EN'];
    const titleZh = subjects['MY_ZH'] || subjects['SG_ZH'];
    if (!titleEn) {
      console.error(`  SKIP ${promo.code} — no EN subject in MT ${mtId}`);
      totalErr++;
      report.push({ siteId, code: promo.code, pid: promo.id, status: 'NO_EN_SUBJ' });
      continue;
    }

    // 3. GET promotioncurrency → MYR min_transfer
    const rc = await authedFetch(site, `/api/bo/promotioncurrency?promotion_id=${promo.id}&perPage=20&page=1`);
    const crows = Array.isArray(rc.data?.rows) ? rc.data.rows : Object.values(rc.data?.rows || {});
    const myrRow = crows.find(c => c.currency === 'MYR');
    const minDep = myrRow?.min_transfer ?? '0';

    if (DRY_RUN) {
      console.log(`  DRY  ${promo.code}  title="${titleEn}"  minDep_MYR=${intAmount(minDep)}  zhTitle="${titleZh || '(none)'}"`);
      totalOk++;
      continue;
    }

    // 4. POST new popup
    const popupBody = buildPopupPostBody(titleEn, titleZh, minDep);
    let popup;
    try {
      const rp = await authedFetch(site, '/api/bo/popups', { method: 'POST', body: popupBody });
      const pd = rp.data?.rows || rp.data;
      if (!pd?.id) throw new Error(`No id in response: ${JSON.stringify(rp.data)?.slice(0,200)}`);
      popup = { id: pd.id, code: pd.code, start_date: pd.start_date || nowYmdHms() };
    } catch(e) {
      console.error(`  ✗ POST popup FAILED for ${promo.code}: ${e.message.split('\n')[0]}`);
      totalErr++;
      report.push({ siteId, code: promo.code, pid: promo.id, status: 'POPUP_POST_ERR' });
      continue;
    }

    // 5. PUT promo to link the popup via dialog_popup_list
    const dialogEntry = {
      id: popup.id,
      start_date: popup.start_date,
      end_date: null,
      promotion_id: promo.id,
      labelKey: `${popup.code} (${titleEn.slice(0, 14)} . . . )`,
      code: popup.code,
    };
    const putBody = buildQproPutBody(p, dialogEntry);
    try {
      await authedFetch(site, `/api/bo/promotion/${promo.id}`, { method: 'PUT', body: putBody });
      console.log(`  ✓  ${promo.code}  popup_id=${popup.id}  code=${popup.code}  minDep=${intAmount(minDep)}`);
      totalOk++;
      report.push({ siteId, code: promo.code, pid: promo.id, status: 'OK', popupId: popup.id, popupCode: popup.code });
    } catch(e) {
      console.error(`  ✗ PUT link FAILED for ${promo.code} (popup ${popup.id} created): ${e.message.split('\n')[0]}`);
      totalErr++;
      report.push({ siteId, code: promo.code, pid: promo.id, status: 'PUT_LINK_ERR', popupId: popup.id });
    }
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('\n\n=== SUMMARY ===');
console.log(`Total OK: ${totalOk}  Errors: ${totalErr}`);
console.log('\nBy site:');
for (const siteId of QPRO_SITES) {
  const sr = report.filter(r => r.siteId === siteId);
  const ok = sr.filter(r => r.status === 'OK').length;
  const err = sr.filter(r => r.status !== 'OK').length;
  console.log(`  ${siteId}: ${ok} OK, ${err} errors (total ${sr.length})`);
}
if (report.filter(r => r.status !== 'OK').length) {
  console.log('\nErrors:');
  report.filter(r => r.status !== 'OK').forEach(r =>
    console.log(`  ${r.siteId} pid=${r.pid} ${r.code}: ${r.status}${r.popupId ? ` (popup_id=${r.popupId} created but not linked)` : ''}`)
  );
}

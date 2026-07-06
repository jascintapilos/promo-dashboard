#!/usr/bin/env node
// Create World Cup themed Dialog popups for P005-P009 and link to both
// QP2D and QPRO2 saves. Short 3-step format (not full T&C), matching
// feedback_dialog_popup_how_to_apply_template.md convention.
//
// Usage: node bin/_wc26-create-dialogs.mjs           # dry-run
//        node bin/_wc26-create-dialogs.mjs --commit   # live

import { getSite } from '../src/sites.js';
import { authedFetch, findPromotionByCode, createDialogPopup } from '../src/api-client.js';

const COMMIT = process.argv.includes('--commit');

function nowYmdHms() {
  return new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
}

const TARGETS = [
  { rn: 'P005', code: 'VIP_100FC_5x_SPRTS',    brand: 'QP2D',  site: 'ibc22', merchantId: 4, siteIdQp2: 4, platform: 'qp2',  kind: 'fc',     amount: 100,  nameEn: '100 Free Credits',   nameZh: '100 免费体验金' },
  { rn: 'P005', code: 'VIP_100FC_5x_SPRTS',    brand: 'QPRO2', site: 'qpro2',                              platform: 'qpro', kind: 'fc',     amount: 100,  nameEn: '100 Free Credits',   nameZh: '100 免费体验金' },
  { rn: 'P006', code: 'VIP_160FC_5x_SPRTS',    brand: 'QP2D',  site: 'ibc22', merchantId: 4, siteIdQp2: 4, platform: 'qp2',  kind: 'fc',     amount: 160,  nameEn: '160 Free Credits',   nameZh: '160 免费体验金' },
  { rn: 'P006', code: 'VIP_160FC_5x_SPRTS',    brand: 'QPRO2', site: 'qpro2',                              platform: 'qpro', kind: 'fc',     amount: 160,  nameEn: '160 Free Credits',   nameZh: '160 免费体验金' },
  { rn: 'P007', code: 'VIP_250FC_5x_SPRTS',    brand: 'QP2D',  site: 'ibc22', merchantId: 4, siteIdQp2: 4, platform: 'qp2',  kind: 'fc',     amount: 250,  nameEn: '250 Free Credits',   nameZh: '250 免费体验金' },
  { rn: 'P007', code: 'VIP_250FC_5x_SPRTS',    brand: 'QPRO2', site: 'qpro2',                              platform: 'qpro', kind: 'fc',     amount: 250,  nameEn: '250 Free Credits',   nameZh: '250 免费体验金' },
  { rn: 'P008', code: 'VIP_REL_30PCT_12X_GLD', brand: 'QP2D',  site: 'ibc22', merchantId: 4, siteIdQp2: 4, platform: 'qp2',  kind: 'reload', maxMyr: 1000, maxSgd: 1000 },
  { rn: 'P008', code: 'VIP_REL_30PCT_12X_GLD', brand: 'QPRO2', site: 'qpro2',                              platform: 'qpro', kind: 'reload', maxMyr: 1000, maxSgd: 1000 },
  { rn: 'P009', code: 'VIP_REL_30PCT_12X_DMD', brand: 'QP2D',  site: 'ibc22', merchantId: 4, siteIdQp2: 4, platform: 'qp2',  kind: 'reload', maxMyr: 2000, maxSgd: 2000 },
  { rn: 'P009', code: 'VIP_REL_30PCT_12X_DMD', brand: 'QPRO2', site: 'qpro2',                              platform: 'qpro', kind: 'reload', maxMyr: 2000, maxSgd: 2000 },
];

// settings_locale_id → { region, lang }
const LOCALES = [
  { id: 1, region: 'MY', lang: 'en', ccy: 'MYR' },
  { id: 3, region: 'MY', lang: 'zh', ccy: 'MYR' },
  { id: 6, region: 'SG', lang: 'en', ccy: 'SGD' },
  { id: 7, region: 'SG', lang: 'zh', ccy: 'SGD' },
];

function fcBody(t, loc) {
  if (loc.lang === 'en') {
    return {
      title: `⚽ World Cup Kickoff — ${t.amount} Free Bet Credits!`,
      content: `<p>Score big this World Cup season! ⚽🏆</p>
<ol>
  <li>Head to the <strong>Reward</strong> page</li>
  <li>Search for <strong>Sports Free Bet FC${t.amount}</strong></li>
  <li>Click <strong>CLAIM</strong> — no deposit needed!</li>
</ol>
<p>Full details in your Inbox.</p>`,
    };
  }
  return {
    title: `⚽ 世界杯开踢 — ${t.amount}免费体验金！`,
    content: `<p>世界杯精彩开踢，助您赢取大奖！⚽🏆</p>
<ol>
  <li>前往 <strong>奖励</strong> 页面</li>
  <li>搜索 <strong>体育免费投注 FC${t.amount}</strong></li>
  <li>点击 <strong>领取</strong> — 无需存款！</li>
</ol>
<p>详情请查看您的收件箱。</p>`,
  };
}

function reloadBody(t, loc) {
  const max = loc.ccy === 'MYR' ? t.maxMyr : t.maxSgd;
  if (loc.lang === 'en') {
    return {
      title: `🏆 World Cup Reload Bonus — 30% Extra!`,
      content: `<p>Fuel your World Cup game! ⚽🏆</p>
<ol>
  <li>Head to the <strong>Deposit</strong> page</li>
  <li>Deposit min ${loc.ccy} 300</li>
  <li>Claim your <strong>30% Reload Bonus</strong> — up to ${loc.ccy} ${max}!</li>
</ol>
<p>Full details in your Inbox.</p>`,
    };
  }
  return {
    title: `🏆 世界杯充值奖励 — 额外30%！`,
    content: `<p>为您的世界杯征程加满油！⚽🏆</p>
<ol>
  <li>前往 <strong>存款</strong> 页面</li>
  <li>最低存款 ${loc.ccy} 300</li>
  <li>领取您的 <strong>30%充值奖励</strong> — 最高${loc.ccy} ${max}！</li>
</ol>
<p>详情请查看您的收件箱。</p>`,
  };
}

function buildContents(t) {
  const useDeposit = t.kind === 'reload';
  const ctaLeftLink = useDeposit ? '/member/deposit' : '/member/reward';
  const contents = {};
  for (const loc of LOCALES) {
    const b = t.kind === 'fc' ? fcBody(t, loc) : reloadBody(t, loc);
    const ctaText1 = useDeposit
      ? (loc.lang === 'en' ? 'DEPOSIT' : '存款')
      : (loc.lang === 'en' ? 'CLAIM NOW' : '立即领取');
    const ctaText2 = loc.lang === 'en' ? 'READ MORE' : '阅读更多';
    contents[String(loc.id)] = {
      locale_id: loc.id,
      content: b.content,
      title: b.title,
      mobile_link: null,
      desktop_link: null,
      video_mobile_link: null,
      video_desktop_link: null,
      media_type: null,
      cta_button_type: 2,
      cta_button_text_1: ctaText1,
      cta_button_link_1: ctaLeftLink,
      cta_button_text_2: ctaText2,
      cta_button_link_2: '/member/message',
    };
  }
  return contents;
}

// ── Promotion body normalizers (reused pattern from earlier deactivate scripts) ──
function isoToYmdHms(iso) {
  if (!iso || typeof iso !== 'string') return iso;
  return iso.replace('T', ' ').replace(/\.\d+Z?$/, '').replace(/Z$/, '');
}
function arrToIdxObj(arr) {
  if (!Array.isArray(arr)) return arr;
  return Object.fromEntries(arr.map((v, i) => [String(i), v]));
}
function normalizeQproBody(body, dialogArg) {
  if (body.valid_from) body.valid_from = isoToYmdHms(body.valid_from);
  if (body.valid_to)   body.valid_to   = isoToYmdHms(body.valid_to);
  const nullDrops = ['free_spin_game_code','promo_p1_id','promo_p2_id','promo_p2_code','promo_p2_name','reset_day','reset_month','free_spin_game_provider_id','blacklist_template_id','bonus_rate'];
  for (const k of nullDrops) if (body[k] == null) delete body[k];
  const getOnly = ['created_at','updated_at','created_by','updated_by','deleted_at','promotion_category','currencies','message_templates','sms_message_templates','bonus_type','member_group','target_type','game_provider','category','currencies_bonus_type','kyc_type','phase_game_provider_code','phase_game_provider_category','kyc_listing','bonus_settings','site_name','merchant_name','platform_name','frequency_text','before_ftd','ftd','deposit_count_reset_frequency','deposit_count_reset_day','fingerprint_check','freespin_check','allow_deposit','allow_continuous_claim','auto_reward_activation','withdrawal_unlock','active_period','members_only'];
  for (const k of getOnly) delete body[k];
  if (body.reset_frequency === 0) delete body.reset_frequency;
  body.dialog_popup_list = {
    '0': {
      id: dialogArg.id,
      start_date: dialogArg.start_date,
      end_date: null,
      promotion_id: body.id,
      labelKey: dialogArg.label ? `${dialogArg.code} (${dialogArg.label.slice(0,14)} . . . )` : dialogArg.code,
      code: dialogArg.code,
    },
  };
  return body;
}
function normalizeQp2Body(body, dialogArg, fullPopupRow) {
  if (body.valid_from) body.valid_from = isoToYmdHms(body.valid_from);
  if (body.valid_to)   body.valid_to   = isoToYmdHms(body.valid_to);
  if (body.deposit_status == null) body.deposit_status = body.last_deposit ? 4 : 1;
  if (body.deposit_count_reset_frequency == null) body.deposit_count_reset_frequency = 0;
  if (body.deposit_count_reset_day == null) body.deposit_count_reset_day = 0;
  if (Array.isArray(body.merchant_ids)) {
    body.merchant_ids = Object.fromEntries(body.merchant_ids.map((m,i)=>[String(i), typeof m==='object'?m.id:m]));
  }
  if (Array.isArray(body.target) && body.target[0]) {
    const t = body.target[0];
    body.target = { type: t.type, multiplier: Number(t.multiplier), game_provider_codes: arrToIdxObj(t.game_provider_codes) };
  }
  for (const k of ['game_provider_codes','promotion_category_ids','member_group_ids','currencies_ids','affiliate_ids','affiliate_group_ids','member_ids','telemarketer_ids','blacklist_sub_categories','promo_linked_ids']) {
    if (Array.isArray(body[k])) body[k] = arrToIdxObj(body[k]);
  }
  const dropKeys = ['created_at','updated_at','created_by','updated_by','deleted_at','promotion_category','currencies','message_templates','sms_message_templates','bonus_type','member_group','target_type','game_provider','category','currencies_bonus_type','kyc_type','phase_game_provider_code','phase_game_provider_category','kyc_listing','bonus_settings','site_name','merchant_name','platform_name','frequency_text','before_ftd','ftd','promo_p1_id','promo_p2_id','promo_p2_code','promo_p2_name'];
  for (const k of dropKeys) delete body[k];
  const nullDrops = ['free_spin_game_code','reset_day','reset_month','valid_to'];
  for (const k of nullDrops) if (body[k] == null) delete body[k];
  // GET returns 0 (=None) but PUT validator rejects 0 as "invalid reset frequency".
  if (body.reset_frequency === 0) delete body.reset_frequency;
  body.dialog_popup_list = {
    '0': { ...(fullPopupRow || {}), promotion_id: body.id },
  };
  return body;
}

console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`WC26 DIALOG CREATE + LINK — ${COMMIT ? 'LIVE (--commit)' : 'DRY-RUN'}`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

const rnFilterArg = process.argv.find(a => a.startsWith('--rn='));
const rnFilter = rnFilterArg ? rnFilterArg.split('=')[1].split(',') : null;
const filteredTargets = rnFilter ? TARGETS.filter(t => rnFilter.includes(t.rn)) : TARGETS;

const results = [];
for (const t of filteredTargets) {
  const site = getSite(t.site);
  const found = await findPromotionByCode(site, t.code, t.merchantId ? { merchantId: t.merchantId } : {});
  if (!found) { console.log(`${t.rn} ${t.brand}: promo NOT FOUND`); results.push({ ...t, ok: false }); continue; }

  console.log(`\n── ${t.rn} ${t.brand} (promo=${found.id}) ──`);
  const contents = buildContents(t);
  for (const [k, c] of Object.entries(contents)) {
    console.log(`  [locale=${k}] "${c.title}" CTA1="${c.cta_button_text_1}"→${c.cta_button_link_1}`);
  }

  if (!COMMIT) { results.push({ ...t, ok: true, dry: true }); continue; }

  // 1. POST the popup
  const popupBody = t.platform === 'qp2'
    ? { site_id: t.siteIdQp2, platform: 1, start_date: nowYmdHms(), session: '3', position: 99, status: 1, contents, location: 1, affiliates_visibility: 0, always_pop: 0, do_not_show_again: 0, label: t.kind === 'fc' ? `Sports Free Bet FC${t.amount}` : `30% Reload Bonus` }
    : { platform: 1, start_date: nowYmdHms(), session: '3', position: 99, status: 1, contents, location: 1, affiliates_visibility: 0, always_pop: 0, label: t.kind === 'fc' ? `Sports Free Bet FC${t.amount}` : `30% Reload Bonus` };

  let popRes;
  try {
    popRes = await createDialogPopup(site, popupBody);
  } catch (e) {
    console.log(`  ✗ POST /popups failed: ${e.message.split('\n')[0].slice(0,200)}`);
    results.push({ ...t, ok: false }); continue;
  }
  const popupId = popRes?.data?.rows?.id ?? popRes?.data?.id;
  const popupCode = popRes?.data?.rows?.code ?? popRes?.data?.code;
  if (!popupId) {
    console.log(`  ✗ POST /popups — no id in response: ${JSON.stringify(popRes).slice(0,300)}`);
    results.push({ ...t, ok: false }); continue;
  }
  console.log(`  ✓ popup created id=${popupId} code=${popupCode}`);

  // 2. GET current promotion detail, normalize, inject dialog link, PUT back
  const detail = await authedFetch(site, `/api/bo/promotion/${found.id}`);
  const body = detail?.data?.rows;
  if (!body) { console.log(`  ✗ GET promotion detail failed`); results.push({ ...t, ok: false }); continue; }

  const dialogArg = { id: popupId, code: popupCode || '', start_date: popupBody.start_date, label: popupBody.label };

  try {
    if (t.platform === 'qpro') {
      normalizeQproBody(body, dialogArg);
    } else {
      normalizeQp2Body(body, dialogArg, popRes?.data?.rows || null);
    }
    const putRes = await authedFetch(site, `/api/bo/promotion/${found.id}`, { method: 'PUT', body });
    const ok = putRes?.success !== false;
    console.log(`  → PUT promotion (link dialog): ${ok ? '✅ OK' : '❌ ' + JSON.stringify(putRes).slice(0,200)}`);
    results.push({ ...t, ok, popupId });
  } catch (e) {
    console.log(`  → PUT promotion: ❌ ${e.message.split('\n')[0].slice(0,300)}`);
    results.push({ ...t, ok: false, err: e.message });
  }
}

console.log(`\n\nSummary: ${results.filter(r=>r.ok).length}/${results.length} ${COMMIT ? 'created+linked' : 'would create+link'}`);
if (!COMMIT) console.log('Re-run with --commit to apply.');

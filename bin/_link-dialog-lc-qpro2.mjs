#!/usr/bin/env node
// Create + link dialog popups for LC Bronze codes on QPRO2.
// 138MX (id=493): min_dep=300 MYR/SGD  — same structure as source 138MX_BR popup 155
// 48MX  (id=494): min_dep=100 MYR/SGD  — new

import { authedFetch, createDialogPopup, updatePromotion } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const arrayToIntObj = (arr) => Object.fromEntries(arr.map((id, i) => [String(i), id]));
const isoToYmdHms  = (iso)  => { const m = String(iso).match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/); return m ? `${m[1]} ${m[2]}` : iso; };
const nowYmdHms    = ()     => new Date().toISOString().slice(0,19).replace('T',' ');

function buildContents(minMyr, minSgd) {
  return {
    '1': {
      locale_id: 1,
      title: 'Time Limited Exclusive Offer - 45% Reload Bonus',
      content: `<p><strong>How to Apply:</strong><br><br>1. Go to the [Transfer] page and select your game provider.<br>2. Enter amount MYR ${minMyr} and above<br>3. Choose [<strong>Time Limited Exclusive Offer - 45% Reload Bonus </strong>] under "Promotion" and click SUBMIT.<br><br><span style="color:hsl(0,75%,60%);"><strong>*For full promotion terms &amp; conditions, check your Inbox.</strong></span></p>`,
      mobile_link: null, desktop_link: null, video_mobile_link: null, video_desktop_link: null, media_type: null,
      cta_button_type: 2, cta_button_text_1: 'CLAIM NOW', cta_button_link_1: '/member/reward',
      cta_button_text_2: 'READ MORE', cta_button_link_2: '/member/message',
    },
    '3': {
      locale_id: 3,
      title: '限时独家优惠 - 45% 充値奖金',
      content: `<p><strong>如何申请：</strong></p><p>1. 点击 [转账] 页面并选择您的游戟提供商。<br>2. 输入金额 MYR ${minMyr} <span class="Y2IQFc" lang="zh-CN">以上</span><br>3. 在“促销”下选择 <strong>[限时独家优惠 - 45% 充値奖金 ]</strong> 并点击提交。</p><p><span style="color:hsl(0,75%,60%);"><strong>*有关完整促销条款和条件，请查看您的收件筱。</strong></span></p>`,
      mobile_link: null, desktop_link: null, video_mobile_link: null, video_desktop_link: null, media_type: null,
      cta_button_type: 2, cta_button_text_1: '立即领取', cta_button_link_1: '/member/reward',
      cta_button_text_2: '阅读更多', cta_button_link_2: '/member/message',
    },
    '6': {
      locale_id: 6,
      title: 'Time Limited Exclusive Offer - 45% Reload Bonus',
      content: `<p><strong>How to Apply:</strong><br><br>1. Go to the [Transfer] page and select your game provider.<br>2. Enter amount SGD ${minSgd} and above<br>3. Choose [<strong>Time Limited Exclusive Offer - 45% Reload Bonus </strong>] under "Promotion" and click SUBMIT.<br><br><span style="color:hsl(0,75%,60%);"><strong>*For full promotion terms &amp; conditions, check your Inbox.</strong></span></p>`,
      mobile_link: null, desktop_link: null, video_mobile_link: null, video_desktop_link: null, media_type: null,
      cta_button_type: 2, cta_button_text_1: 'CLAIM NOW', cta_button_link_1: '/member/reward',
      cta_button_text_2: 'READ MORE', cta_button_link_2: '/member/message',
    },
    '7': {
      locale_id: 7,
      title: '限时独家优惠 - 45% 充値奖金',
      content: `<p><strong>如何申请：</strong></p><p>1. 点击 [转账] 页面并选择您的游戟提供商。<br>2. 输入金额 SGD ${minSgd} <span class="Y2IQFc" lang="zh-CN">以上</span><br>3. 在“促销”下选择 <strong>[限时独家优惠 - 45% 充値奖金 ]</strong> 并点击提交。</p><p><span style="color:hsl(0,75%,60%);"><strong>*有关完整促销条款和条件，请查看您的收件筱。</strong></span></p>`,
      mobile_link: null, desktop_link: null, video_mobile_link: null, video_desktop_link: null, media_type: null,
      cta_button_type: 2, cta_button_text_1: '立即领取', cta_button_link_1: '/member/reward',
      cta_button_text_2: '阅读更多', cta_button_link_2: '/member/message',
    },
  };
}

const ITEMS = [
  { promoId: 493, code: 'FT_REL_TLEO_LC_45PCT_138MX', minMyr: 300, minSgd: 300 },
  { promoId: 494, code: 'FT_REL_TLEO_LC_45PCT_48MX',  minMyr: 100, minSgd: 100 },
];

const site = getSite('qpro2');

for (const item of ITEMS) {
  console.log(`\n[${item.code}]`);

  // Idempotency — check if already linked
  const listRes = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(item.code)}&perPage=5`);
  const listRow = (listRes.data?.rows || []).find(r => r.code === item.code);
  if (!listRow) { console.log('  NOT FOUND'); continue; }
  if (listRow.dialog_popup_list?.[0]?.popup_id) {
    console.log(`  SKIP: already linked popup_id=${listRow.dialog_popup_list[0].popup_id}`);
    continue;
  }

  // Create popup
  const popupRes = await createDialogPopup(site, {
    platform: 1, location: 1, start_date: nowYmdHms(), end_date: null,
    session: 1, position: 99, always_pop: 0, affiliates_visibility: 0, status: 1,
    label: 'Time Limited Exclusive Offer - 45% Reload Bonus',
    contents: buildContents(item.minMyr, item.minSgd),
  });
  const newPopup = popupRes.data?.rows || popupRes.data;
  if (!newPopup?.id) throw new Error(`No popup id: ${JSON.stringify(popupRes).slice(0,200)}`);
  console.log(`  ✓ POST popup → id=${newPopup.id} code=${newPopup.code}`);

  // Read promo detail
  const det = (await authedFetch(site, `/api/bo/promotion/${item.promoId}`)).data.rows;
  const gpIds = (det.target?.[0]?.game_provider_ids || []).map(Number);
  const catIds = (det.promotion_category || []).map(c => c.category_id);

  await updatePromotion(site, item.promoId, {
    code: det.code, name: det.name,
    free_spin_game_provider_id: det.free_spin_game_provider_id ?? 0,
    promotion_category_turnover: arrayToIntObj(catIds),
    promo_type: det.promo_type, promo_sub_type: String(det.promo_sub_type),
    valid_from: isoToYmdHms(det.valid_from), validity: det.validity, reward_validity: det.reward_validity,
    frequency: det.frequency || [], frequency_type: String(det.frequency_type ?? '1'),
    first_deposit: det.first_deposit ?? 0, last_deposit: det.last_deposit ?? 1,
    auto_approve: det.auto_approve ? 1 : 0, visible_by_affiliate: det.visible_by_affiliate ?? 0,
    recurring: String(det.recurring ?? 0), reset_frequency: det.reset_frequency ?? 1,
    max_per_player: det.max_per_player, daily_max: det.daily_max,
    limit_transfer_in: det.limit_transfer_in ? 1 : 0, limit_transfer_out: det.limit_transfer_out ? 1 : 0,
    restrict_claim_round_active: det.restrict_claim_round_active ?? 0,
    restrict_same_provider_launch: det.restrict_same_provider_launch ?? 0,
    auto_unlock: det.auto_unlock ? 1 : 0, allow_cancel: det.allow_cancel ?? 0, fixed_amount: 0,
    game_provider_ids: arrayToIntObj(gpIds),
    target: { '0': { type: det.target?.[0]?.type ?? 1, multiplier: det.target?.[0]?.multiplier ?? 8, game_provider_ids: arrayToIntObj(gpIds) }},
    deposit_count: 0, eligible_types: String(det.eligible_types ?? '1'),
    telemarketer_ids: det.telemarketer_ids || [], normal_account_manager_ids: det.normal_account_manager_ids || [],
    vip_account_manager_ids: det.vip_account_manager_ids || [],
    requires_email: det.requires_email ?? false, requires_mobile: det.requires_mobile ?? false,
    requires_dob: det.requires_dob ?? false, requires_fullname: det.requires_fullname ?? false,
    transfer_unlock: det.transfer_unlock ?? false,
    kyc_basic: det.kyc_basic ?? true, kyc_advanced: det.kyc_advanced ?? true, kyc_pro: det.kyc_pro ?? true,
    bonus_rate: Number(det.bonus_rate) || 45,
    message_template_id: det.message_template_id || 0,
    message_template_sms_id: det.message_template_sms_id || 0,
    dialog_popup_list: { '0': {
      id: newPopup.id, start_date: newPopup.start_date || nowYmdHms(), end_date: null,
      promotion_id: item.promoId,
      labelKey: `${newPopup.code} (Time Limited Ex . . . )`,
      code: newPopup.code,
    }},
  });
  console.log(`  ✓ PUT → linked popup id=${newPopup.id}`);
}

// QC
console.log('\nQC:');
console.log('Code'.padEnd(38) + 'ID'.padEnd(7) + 'Inbox'.padEnd(8) + 'SMS'.padEnd(8) + 'Dialog');
console.log('─'.repeat(72));
for (const item of ITEMS) {
  const listRes = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(item.code)}&perPage=5`);
  const row = (listRes.data?.rows || []).find(r => r.code === item.code);
  const det = (await authedFetch(site, `/api/bo/promotion/${row.id}`)).data.rows;
  const dpl = row.dialog_popup_list;
  const dlStr = dpl?.[0]?.popup_id ? `p_id=${dpl[0].popup_id} ✓` : '(none)';
  console.log(item.code.padEnd(38) + String(row.id).padEnd(7) +
    String(det.message_template_id).padEnd(8) + String(det.message_template_sms_id).padEnd(8) + dlStr);
}

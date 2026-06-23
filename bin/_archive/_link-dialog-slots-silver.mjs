#!/usr/bin/env node
// Create + link dialog popups for FT_REL_TLEO_45PCT_228MX and FT_REL_TLEO_45PCT_458MX
// on QPRO3, QPRO4, QPRO6, QPRO8, QPRO10.
//
// Source popup content cloned from QPRO2 popups 146 (228MX) and 147 (458MX).
// Both use session=1 (All), position=99, DUAL CTA (CLAIM NOW / READ MORE).

import { authedFetch, createDialogPopup, updatePromotion } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const arrayToIntObj = (arr) => Object.fromEntries(arr.map((id, i) => [String(i), id]));
const isoToYmdHms  = (iso)  => { const m = String(iso).match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/); return m ? `${m[1]} ${m[2]}` : iso; };
const nowYmdHms    = ()     => new Date().toISOString().slice(0,19).replace('T',' ');

// Source popup content from QPRO2 (min-dep amounts differ per code)
function buildContents(minMyr, minSgd) {
  return {
    '1': { // MY_EN
      locale_id: 1,
      title: 'Time Limited Exclusive Offer - 45% Reload Bonus',
      content: `<p><strong>How to Apply:</strong><br><br>1. Go to the [Transfer] page and select your game provider.<br>2. Enter amount MYR ${minMyr} and above<br>3. Choose [<strong>Time Limited Exclusive Offer - 45% Reload Bonus </strong>] under "Promotion" and click SUBMIT.<br><br><span style="color:hsl(0,75%,60%);"><strong>*For full promotion terms &amp; conditions, check your Inbox.</strong></span></p>`,
      mobile_link: null, desktop_link: null, video_mobile_link: null, video_desktop_link: null,
      media_type: null, cta_button_type: 2,
      cta_button_text_1: 'CLAIM NOW', cta_button_link_1: '/member/reward',
      cta_button_text_2: 'READ MORE', cta_button_link_2: '/member/message',
    },
    '3': { // MY_ZH
      locale_id: 3,
      title: '限时独家优惠 - 45% 充值奖金',
      content: `<p><strong>如何申请：</strong></p><p>1. 点击 [转账] 页面并选择您的游戏提供商。<br>2. 输入金额 MYR ${minMyr} <span class="Y2IQFc" lang="zh-CN">以上</span><br>3. 在"促销"下选择 <strong>[限时独家优惠 - 45% 充值奖金 ]</strong> 并点击提交。</p><p><span style="color:hsl(0,75%,60%);"><strong>*有关完整促销条款和条件，请查看您的收件箱。</strong></span></p>`,
      mobile_link: null, desktop_link: null, video_mobile_link: null, video_desktop_link: null,
      media_type: null, cta_button_type: 2,
      cta_button_text_1: '立即领取', cta_button_link_1: '/member/reward',
      cta_button_text_2: '阅读更多', cta_button_link_2: '/member/message',
    },
    '6': { // SG_EN
      locale_id: 6,
      title: 'Time Limited Exclusive Offer - 45% Reload Bonus',
      content: `<p><strong>How to Apply:</strong><br><br>1. Go to the [Transfer] page and select your game provider.<br>2. Enter amount SGD ${minSgd} and above<br>3. Choose [<strong>Time Limited Exclusive Offer - 45% Reload Bonus </strong>] under "Promotion" and click SUBMIT.<br><br><span style="color:hsl(0,75%,60%);"><strong>*For full promotion terms &amp; conditions, check your Inbox.</strong></span></p>`,
      mobile_link: null, desktop_link: null, video_mobile_link: null, video_desktop_link: null,
      media_type: null, cta_button_type: 2,
      cta_button_text_1: 'CLAIM NOW', cta_button_link_1: '/member/reward',
      cta_button_text_2: 'READ MORE', cta_button_link_2: '/member/message',
    },
    '7': { // SG_ZH
      locale_id: 7,
      title: '限时独家优惠 - 45% 充值奖金',
      content: `<p><strong>如何申请：</strong></p><p>1. 点击 [转账] 页面并选择您的游戏提供商。<br>2. 输入金额 SGD ${minSgd} <span class="Y2IQFc" lang="zh-CN">以上</span><br>3. 在"促销"下选择 <strong>[限时独家优惠 - 45% 充值奖金 ]</strong> 并点击提交。</p><p><span style="color:hsl(0,75%,60%);"><strong>*有关完整促销条款和条件，请查看您的收件箱。</strong></span></p>`,
      mobile_link: null, desktop_link: null, video_mobile_link: null, video_desktop_link: null,
      media_type: null, cta_button_type: 2,
      cta_button_text_1: '立即领取', cta_button_link_1: '/member/reward',
      cta_button_text_2: '阅读更多', cta_button_link_2: '/member/message',
    },
  };
}

const SOURCES = [
  { code: 'FT_REL_TLEO_45PCT_228MX', minMyr: 500,  minSgd: 500  },
  { code: 'FT_REL_TLEO_45PCT_458MX', minMyr: 1000, minSgd: 1000 },
];
const BRANDS = ['qpro3','qpro4','qpro6','qpro8','qpro10'];

for (const brand of BRANDS) {
  console.log(`\n${'━'.repeat(60)}`);
  console.log(`  ${brand.toUpperCase()}`);
  console.log('━'.repeat(60));

  const site = getSite(brand);

  for (const src of SOURCES) {
    console.log(`\n  [${src.code}]`);

    // 1. Fetch the promo by code
    const listRes = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(src.code)}&perPage=5`);
    const promoRow = (listRes.data?.rows || []).find(r => r.code === src.code);
    if (!promoRow) { console.log(`    SKIP: not found on ${brand}`); continue; }

    const promoId = promoRow.id;
    const existingDialog = promoRow.dialog_popup_list?.[0];
    if (existingDialog?.popup_id) {
      console.log(`    SKIP: already linked to popup_id=${existingDialog.popup_id}`);
      continue;
    }

    // 2. Read promo detail for PUT body
    const detRes = await authedFetch(site, `/api/bo/promotion/${promoId}`);
    const det = detRes.data.rows;

    // Resolve gp_ids from existing target (preserve exact list)
    const gpIds = (det.target?.[0]?.game_provider_ids || []).map(Number);
    const catIds = (det.promotion_category || []).map(c => c.category_id);

    // 3. POST new dialog popup
    const popupBody = {
      platform: 1,
      location: 1,
      start_date: nowYmdHms(),
      end_date: null,
      session: 1,
      position: 99,
      always_pop: 0,
      affiliates_visibility: 0,
      status: 1,
      label: 'Time Limited Exclusive Offer - 45% Reload Bonus',
      contents: buildContents(src.minMyr, src.minSgd),
    };
    const popupRes = await createDialogPopup(site, popupBody);
    const newPopup = popupRes.data?.rows || popupRes.data;
    if (!newPopup?.id) throw new Error(`No popup id returned: ${JSON.stringify(popupRes).slice(0,200)}`);
    console.log(`    ✓ POST popup → id=${newPopup.id} code=${newPopup.code}`);

    // 4. PUT promo to link the dialog popup (preserve gp_ids, no promotion_currency)
    const putBody = {
      code: det.code,
      name: det.name,
      free_spin_game_provider_id: det.free_spin_game_provider_id ?? 0,
      promotion_category_turnover: arrayToIntObj(catIds),
      promo_type: det.promo_type,
      promo_sub_type: String(det.promo_sub_type),
      valid_from: isoToYmdHms(det.valid_from),
      validity: det.validity,
      reward_validity: det.reward_validity,
      frequency: det.frequency || [],
      frequency_type: String(det.frequency_type ?? '1'),
      first_deposit: det.first_deposit ?? 0,
      last_deposit: det.last_deposit ?? 1,
      auto_approve: det.auto_approve ? 1 : 0,
      visible_by_affiliate: det.visible_by_affiliate ?? 0,
      recurring: String(det.recurring ?? 0),
      reset_frequency: det.reset_frequency ?? 1,
      max_per_player: det.max_per_player,
      daily_max: det.daily_max,
      limit_transfer_in: det.limit_transfer_in ? 1 : 0,
      limit_transfer_out: det.limit_transfer_out ? 1 : 0,
      restrict_claim_round_active: det.restrict_claim_round_active ?? 0,
      restrict_same_provider_launch: det.restrict_same_provider_launch ?? 0,
      auto_unlock: det.auto_unlock ? 1 : 0,
      allow_cancel: det.allow_cancel ?? 0,
      fixed_amount: 0,
      game_provider_ids: arrayToIntObj(gpIds),
      target: { '0': {
        type: det.target?.[0]?.type ?? 3,
        multiplier: det.target?.[0]?.multiplier ?? 3,
        game_provider_ids: arrayToIntObj(gpIds),
      }},
      deposit_count: 0,
      eligible_types: String(det.eligible_types ?? '1'),
      telemarketer_ids: det.telemarketer_ids || [],
      normal_account_manager_ids: det.normal_account_manager_ids || [],
      vip_account_manager_ids: det.vip_account_manager_ids || [],
      requires_email:    det.requires_email ?? false,
      requires_mobile:   det.requires_mobile ?? false,
      requires_dob:      det.requires_dob ?? false,
      requires_fullname: det.requires_fullname ?? false,
      transfer_unlock:   det.transfer_unlock ?? false,
      kyc_basic:    det.kyc_basic ?? true,
      kyc_advanced: det.kyc_advanced ?? true,
      kyc_pro:      det.kyc_pro ?? true,
      bonus_rate:   Number(det.bonus_rate) || 45,
      message_template_id: det.message_template_id,
      dialog_popup_list: {
        '0': {
          id: newPopup.id,
          start_date: newPopup.start_date || nowYmdHms(),
          end_date: null,
          promotion_id: promoId,
          labelKey: `${newPopup.code} (${newPopup.label?.slice(0,14) ?? ''} . . . )`,
          code: newPopup.code,
        },
      },
    };

    await updatePromotion(site, promoId, putBody);
    console.log(`    ✓ PUT → linked popup id=${newPopup.id}`);
  }
}

// Final QC
console.log(`\n${'━'.repeat(60)}`);
console.log('  QC — dialog_popup_list');
console.log('━'.repeat(60));
console.log('Code'.padEnd(38) + 'Brand'.padEnd(8) + 'ID'.padEnd(8) + 'Dialog');
console.log('─'.repeat(72));
for (const brand of BRANDS) {
  const site = getSite(brand);
  for (const src of SOURCES) {
    const res = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(src.code)}&perPage=5`);
    const row = (res.data?.rows || []).find(r => r.code === src.code);
    if (!row) { console.log(`${src.code.padEnd(38)}${brand.padEnd(8)}NOT FOUND`); continue; }
    const dpl = row.dialog_popup_list;
    const dlStr = (!dpl || dpl.length === 0) ? '(none)' : `popup_id=${dpl[0].popup_id} ✓`;
    console.log(`${src.code.padEnd(38)}${brand.padEnd(8)}${String(row.id).padEnd(8)}${dlStr}`);
  }
}

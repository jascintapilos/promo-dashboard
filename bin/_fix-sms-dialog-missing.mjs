#!/usr/bin/env node
// Fix 50 TLEO codes across QPRO3/4/6/8/10 that are missing SMS MT and dialog popup.
// All have inbox MT already. Creates dialog popup then PUTs promo with both.

import { authedFetch, createDialogPopup, updatePromotion } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const arrayToIntObj = (arr) => Object.fromEntries(arr.map((id, i) => [String(i), id]));
const isoToYmdHms  = (iso)  => { const m = String(iso).match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/); return m ? `${m[1]} ${m[2]}` : iso; };
const nowYmdHms    = ()     => new Date().toISOString().slice(0,19).replace('T',' ');

// 10 codes missing SMS + dialog across QPRO3/4/6/8/10
const MISSING_CODES = [
  { code: 'FT_REL_TLEO_45PCT_888MX',       minMyr: 2000, minSgd: 2000 },
  { code: 'FT_REL_TLEO_45PCT_688MX',        minMyr: 1500, minSgd: 1500 },
  { code: 'FT_REL_TLEO_LC_45PCT_458MX_BR', minMyr: 1000, minSgd: 1000 },
  { code: 'FT_REL_TLEO_LC_45PCT_228MX_BR', minMyr: 500,  minSgd: 500  },
  { code: 'FT_REL_TLEO_LC_45PCT_138MX',    minMyr: 300,  minSgd: 300  },
  { code: 'FT_REL_TLEO_20PCT_400MX_BR',    minMyr: 2000, minSgd: 2000 },
  { code: 'FT_REL_TLEO_20PCT_300MX_BR',    minMyr: 1500, minSgd: 1500 },
  { code: 'FT_REL_TLEO_LC_20PCT_400MX_BR', minMyr: 2000, minSgd: 2000 },
  { code: 'FT_REL_TLEO_LC_20PCT_300MX_BR', minMyr: 1500, minSgd: 1500 },
  { code: 'FT_REL_TLEO_LC_20PCT_20MX_BR',  minMyr: 100,  minSgd: 100  },
];

// GENERIC_BR SMS MT per brand
const BRAND_SMS_MT = {
  qpro3:  453,
  qpro4:  376,
  qpro6:  575,
  qpro8:  617,
  qpro10: 497,
};

function buildContents(minMyr, minSgd) {
  return {
    '1': {
      locale_id: 1,
      title: 'Time Limited Exclusive Offer - 45% Reload Bonus',
      content: `<p><strong>How to Apply:</strong><br><br>1. Go to the [Transfer] page and select your game provider.<br>2. Enter amount MYR ${minMyr.toLocaleString()} and above<br>3. Choose [<strong>Time Limited Exclusive Offer - 45% Reload Bonus </strong>] under "Promotion" and click SUBMIT.<br><br><span style="color:hsl(0,75%,60%);"><strong>*For full promotion terms &amp; conditions, check your Inbox.</strong></span></p>`,
      mobile_link: null, desktop_link: null, video_mobile_link: null, video_desktop_link: null, media_type: null,
      cta_button_type: 2, cta_button_text_1: 'CLAIM NOW', cta_button_link_1: '/member/reward',
      cta_button_text_2: 'READ MORE', cta_button_link_2: '/member/message',
    },
    '3': {
      locale_id: 3,
      title: '限时独家优惠 - 45% 充値奖金',
      content: `<p><strong>如何申请：</strong></p><p>1. 点击 [转账] 页面并选择您的游戏提供商。<br>2. 输入金额 MYR ${minMyr.toLocaleString()} <span class="Y2IQFc" lang="zh-CN">以上</span><br>3. 在“促销”下选择 <strong>[限时独家优惠 - 45% 充値奖金 ]</strong> 并点击提交。</p><p><span style="color:hsl(0,75%,60%);"><strong>*有关完整促销条款和条件，请查看您的收件筱。</strong></span></p>`,
      mobile_link: null, desktop_link: null, video_mobile_link: null, video_desktop_link: null, media_type: null,
      cta_button_type: 2, cta_button_text_1: '立即领取', cta_button_link_1: '/member/reward',
      cta_button_text_2: '阅读更多', cta_button_link_2: '/member/message',
    },
    '6': {
      locale_id: 6,
      title: 'Time Limited Exclusive Offer - 45% Reload Bonus',
      content: `<p><strong>How to Apply:</strong><br><br>1. Go to the [Transfer] page and select your game provider.<br>2. Enter amount SGD ${minSgd.toLocaleString()} and above<br>3. Choose [<strong>Time Limited Exclusive Offer - 45% Reload Bonus </strong>] under "Promotion" and click SUBMIT.<br><br><span style="color:hsl(0,75%,60%);"><strong>*For full promotion terms &amp; conditions, check your Inbox.</strong></span></p>`,
      mobile_link: null, desktop_link: null, video_mobile_link: null, video_desktop_link: null, media_type: null,
      cta_button_type: 2, cta_button_text_1: 'CLAIM NOW', cta_button_link_1: '/member/reward',
      cta_button_text_2: 'READ MORE', cta_button_link_2: '/member/message',
    },
    '7': {
      locale_id: 7,
      title: '限时独家优惠 - 45% 充値奖金',
      content: `<p><strong>如何申请：</strong></p><p>1. 点击 [转账] 页面并选择您的游戏提供商。<br>2. 输入金额 SGD ${minSgd.toLocaleString()} <span class="Y2IQFc" lang="zh-CN">以上</span><br>3. 在“促销”下选择 <strong>[限时独家优惠 - 45% 充値奖金 ]</strong> 并点击提交。</p><p><span style="color:hsl(0,75%,60%);"><strong>*有关完整促销条款和条件，请查看您的收件筱。</strong></span></p>`,
      mobile_link: null, desktop_link: null, video_mobile_link: null, video_desktop_link: null, media_type: null,
      cta_button_type: 2, cta_button_text_1: '立即领取', cta_button_link_1: '/member/reward',
      cta_button_text_2: '阅读更多', cta_button_link_2: '/member/message',
    },
  };
}

const BRANDS = ['qpro3','qpro4','qpro6','qpro8','qpro10'];
let saved = 0, skipped = 0, errors = 0;

for (const brand of BRANDS) {
  console.log(`\n${'━'.repeat(60)}\n  ${brand.toUpperCase()}\n${'━'.repeat(60)}`);
  const site = getSite(brand);
  const smsMtId = BRAND_SMS_MT[brand];

  for (const src of MISSING_CODES) {
    // Read from list endpoint (exposes dialog_popup_list)
    const listRes = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(src.code)}&perPage=5`);
    const listRow = (listRes.data?.rows || []).find(r => r.code === src.code);
    if (!listRow) { console.log(`  ${src.code}: NOT FOUND`); continue; }
    const promoId = listRow.id;

    const hasSms    = listRow.message_template_sms_id && listRow.message_template_sms_id !== 0;
    const hasDialog = listRow.dialog_popup_list?.[0]?.popup_id;
    if (hasSms && hasDialog) {
      console.log(`  SKIP id=${promoId} ${src.code}`);
      skipped++;
      continue;
    }

    try {
      // Create dialog popup
      const popupRes = await createDialogPopup(site, {
        platform: 1, location: 1, start_date: nowYmdHms(), end_date: null,
        session: 1, position: 99, always_pop: 0, affiliates_visibility: 0, status: 1,
        label: 'Time Limited Exclusive Offer - 45% Reload Bonus',
        contents: buildContents(src.minMyr, src.minSgd),
      });
      const newPopup = popupRes.data?.rows || popupRes.data;
      if (!newPopup?.id) throw new Error(`No popup id: ${JSON.stringify(popupRes).slice(0,150)}`);

      // Read promo detail
      const det = (await authedFetch(site, `/api/bo/promotion/${promoId}`)).data.rows;
      const gpIds  = (det.target?.[0]?.game_provider_ids || []).map(Number);
      const catIds = (det.promotion_category || []).map(c => c.category_id);

      await updatePromotion(site, promoId, {
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
        bonus_rate: Number(det.bonus_rate) || 0,
        message_template_id: det.message_template_id || 0,
        message_template_sms_id: smsMtId,
        dialog_popup_list: { '0': {
          id: newPopup.id, start_date: newPopup.start_date || nowYmdHms(), end_date: null,
          promotion_id: promoId,
          labelKey: `${newPopup.code} (Time Limited Ex . . . )`,
          code: newPopup.code,
        }},
      });
      console.log(`  ✓ id=${promoId} popup=${newPopup.id} sms=${smsMtId} | ${src.code}`);
      saved++;
    } catch (e) {
      console.error(`  ✗ id=${promoId} ${src.code}: ${e.message.slice(0,100)}`);
      errors++;
    }
  }
}

console.log(`\nDone: ${saved} saved, ${skipped} skipped, ${errors} errors`);

// QC summary
console.log('\nRunning QC...');
let allOk = 0, stillMissing = 0;
for (const brand of BRANDS) {
  const site = getSite(brand);
  for (const src of MISSING_CODES) {
    const res = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(src.code)}&perPage=5`);
    const row = (res.data?.rows || []).find(r => r.code === src.code);
    if (!row) continue;
    const hasSms = row.message_template_sms_id && row.message_template_sms_id !== 0;
    const hasDlg = row.dialog_popup_list?.[0]?.popup_id;
    const det = (await authedFetch(site, `/api/bo/promotion/${row.id}`)).data.rows;
    const hasMt = det.message_template_id && det.message_template_id !== 0;
    if (hasMt && hasSms && hasDlg) { allOk++; }
    else { stillMissing++; console.log(`  STILL GAP: ${brand} ${src.code} mt=${hasMt} sms=${hasSms} dlg=${hasDlg}`); }
  }
}
console.log(`QC: ${allOk}/50 all-OK, ${stillMissing} still missing`);

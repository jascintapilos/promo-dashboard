#!/usr/bin/env node
// Patch the 9 WCF dialog popups on QPRO1:
//   - SGD currency for SG locale content (locale_id=6/7)
//   - MYR unchanged for MY locales (1/3)
//
// Approach: read existing popup from listing → update content field only
//           → PUT full popup body back.
//
// Usage:
//   node bin/patch-wcf-dialog-qpro1.mjs            -- dry run
//   node bin/patch-wcf-dialog-qpro1.mjs --commit   -- live PUT

import { authedFetch } from '../src/api-client.js';
import { renderDialogBody } from '../src/message-template-renderer.js';

const COMMIT = process.argv.includes('--commit');
const SITE = 'qpro1';

const LOCALE_ID_TO_LOCALE = { 1: 'MY_EN', 3: 'MY_ZH', 6: 'SG_EN', 7: 'SG_ZH' };

// Promo code → { bonus_type, parsed } for re-rendering
const PROMOS = [
  { code: 'WCF_FREEBET5',      bonus_type: 'Free Credit',   promotion_name_en: 'World Cup Free Bet',     promotion_name_zh_id: '世界杯免费注码', parsed: { free_credit_amount: 5,    to_multiplier: 10 } },
  { code: 'WCF_FREEBET8',      bonus_type: 'Free Credit',   promotion_name_en: 'World Cup Free Bet',     promotion_name_zh_id: '世界杯免费注码', parsed: { free_credit_amount: 8,    to_multiplier: 10 } },
  { code: 'WCF_FREEBET10',     bonus_type: 'Free Credit',   promotion_name_en: 'World Cup Free Bet',     promotion_name_zh_id: '世界杯免费注码', parsed: { free_credit_amount: 10,   to_multiplier: 10 } },
  { code: 'WCF_VIP100GET20',   bonus_type: 'Deposit Bonus', promotion_name_en: 'World Cup Reload Bonus', promotion_name_zh_id: '世界杯充值奖励', parsed: { min_deposit: 100,  max_bonus: 20,  bonus_rate_pct: 100, to_multiplier: 15 } },
  { code: 'WCF_VIP200GET50',   bonus_type: 'Deposit Bonus', promotion_name_en: 'World Cup Reload Bonus', promotion_name_zh_id: '世界杯充值奖励', parsed: { min_deposit: 200,  max_bonus: 50,  bonus_rate_pct: 100, to_multiplier: 15 } },
  { code: 'WCF_VIP300GET60',   bonus_type: 'Deposit Bonus', promotion_name_en: 'World Cup Reload Bonus', promotion_name_zh_id: '世界杯充值奖励', parsed: { min_deposit: 300,  max_bonus: 60,  bonus_rate_pct: 100, to_multiplier: 15 } },
  { code: 'WCF_VIP400GET70',   bonus_type: 'Deposit Bonus', promotion_name_en: 'World Cup Reload Bonus', promotion_name_zh_id: '世界杯充值奖励', parsed: { min_deposit: 400,  max_bonus: 70,  bonus_rate_pct: 100, to_multiplier: 15 } },
  { code: 'WCF_VIP500GET88',   bonus_type: 'Deposit Bonus', promotion_name_en: 'World Cup Reload Bonus', promotion_name_zh_id: '世界杯充值奖励', parsed: { min_deposit: 500,  max_bonus: 88,  bonus_rate_pct: 100, to_multiplier: 15 } },
  { code: 'WCF_VIP1000GET888', bonus_type: 'Deposit Bonus', promotion_name_en: 'World Cup Reload Bonus', promotion_name_zh_id: '世界杯充值奖励', parsed: { min_deposit: 1000, max_bonus: 888, bonus_rate_pct: 100, to_multiplier: 15 } },
];

async function getPopupIdForPromo(code) {
  const r = await authedFetch(SITE, `/api/bo/promotion?code=${encodeURIComponent(code)}`);
  const rows = r?.data?.rows || r?.data || [];
  const promo = Array.isArray(rows) ? rows[0] : rows;
  const dpl = promo?.dialog_popup_list || [];
  return dpl[0]?.popup_id || null;
}

async function getPopupFromList(popupId) {
  // The list endpoint returns full contents; direct GET returns 405.
  const r = await authedFetch(SITE, `/api/bo/popups/${popupId - 5}?per_page=1`).catch(() => null);
  // Fall back: search by id range
  const r2 = await authedFetch(SITE, `/api/bo/popups?per_page=50`);
  const rows = r2?.data?.rows || [];
  return rows.find(p => p.id === popupId) || null;
}

async function run() {
  console.log(`\n=== WCF Dialog Popup patch — QPRO1 (${COMMIT ? 'LIVE' : 'DRY RUN'}) ===\n`);

  for (const promo of PROMOS) {
    const resolved = {
      promo_code: promo.code,
      bonus_type: promo.bonus_type,
      promotion_name_en: promo.promotion_name_en,
      promotion_name_zh_id: promo.promotion_name_zh_id,
      currencies: ['MYR', 'SGD'],
      parsed: promo.parsed,
    };

    // Get popup id from the promo record
    const popupId = await getPopupIdForPromo(promo.code);
    if (!popupId) { console.log(`[${promo.code}] No popup linked — skip\n`); continue; }

    const popupRow = await getPopupFromList(popupId);
    if (!popupRow) { console.log(`[${promo.code}] popup_id=${popupId} not found in listing — skip\n`); continue; }

    console.log(`[${promo.code}] popup_id=${popupId}  label="${popupRow.label}"`);

    // Build updated contents map
    const newContents = {};
    for (const existing of (popupRow.contents || [])) {
      const locale = LOCALE_ID_TO_LOCALE[existing.locale_id];
      const rendered = locale
        ? await renderDialogBody({ bonusType: promo.bonus_type, locale, resolved })
        : null;

      if (!rendered || rendered.skipped) {
        // Keep existing content unchanged
        newContents[String(existing.locale_id)] = {
          locale_id: existing.locale_id,
          content: existing.content,
          title: existing.title,
          mobile_link: existing.mobile_link ?? null,
          desktop_link: existing.desktop_link ?? null,
          video_mobile_link: existing.video_mobile_link ?? null,
          video_desktop_link: existing.video_desktop_link ?? null,
          media_type: existing.media_type ?? null,
          cta_button_type: existing.cta_button_type ?? 2,
          cta_button_text_1: existing.cta_button_text_1,
          cta_button_link_1: existing.cta_button_link_1,
          cta_button_text_2: existing.cta_button_text_2,
          cta_button_link_2: existing.cta_button_link_2,
        };
        console.log(`    locale=${locale || existing.locale_id}  [UNCHANGED]`);
        continue;
      }

      const curMatch = rendered.html?.match(/MYR|SGD/g);
      console.log(`    locale=${locale}  currency=${curMatch || 'none'}  new_start="${rendered.html?.slice(0,60).replace(/\n/g,' ')}"`);

      newContents[String(existing.locale_id)] = {
        locale_id: existing.locale_id,
        content: rendered.html,
        title: existing.title,
        mobile_link: existing.mobile_link ?? null,
        desktop_link: existing.desktop_link ?? null,
        video_mobile_link: existing.video_mobile_link ?? null,
        video_desktop_link: existing.video_desktop_link ?? null,
        media_type: existing.media_type ?? null,
        cta_button_type: existing.cta_button_type ?? 2,
        cta_button_text_1: existing.cta_button_text_1,
        cta_button_link_1: existing.cta_button_link_1,
        cta_button_text_2: existing.cta_button_text_2,
        cta_button_link_2: existing.cta_button_link_2,
      };
    }

    if (!COMMIT) { console.log(`    → DRY RUN: skipping PUT\n`); continue; }

    // API expects "Y-m-d H:i:s" (not ISO 8601 with T/Z suffix)
    const fmtDate = (iso) => iso ? iso.replace('T', ' ').replace(/\.\d+Z?$/, '') : null;

    const putBody = {
      affiliates_visibility: popupRow.affiliates_visibility ?? 0,
      always_pop: popupRow.always_pop ?? 0,
      platform: popupRow.platform ?? 1,
      label: popupRow.label,
      location: popupRow.location ?? 1,
      start_date: fmtDate(popupRow.start_date),
      end_date: popupRow.end_date ? fmtDate(popupRow.end_date) : null,
      session: String(popupRow.session ?? 3),
      position: popupRow.position ?? 99,
      status: popupRow.status ?? 1,
      contents: newContents,
    };

    const res = await authedFetch(SITE, `/api/bo/popups/${popupId}`, { method: 'PUT', body: putBody });
    const ok = res?.success === true || res?.code === 200 || res?.data != null;
    console.log(`    → PUT ${ok ? 'OK' : 'FAILED'}  raw=${JSON.stringify(res).slice(0, 150)}\n`);
  }

  console.log('Done.');
}

run().catch(err => { console.error(err); process.exit(1); });

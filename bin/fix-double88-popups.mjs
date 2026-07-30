#!/usr/bin/env node
// Fix QP2A/QP2D dialog popups for FT_RET_CRM_REL_88FS_GOO_AUG + 100FS
//
// Problems fixed:
//   QP2A: promo 1431/1432 were linked to stale KING333/SPADE66 Deposit popups → create new IBC22 FS popups
//   QP2D: popups 1970/1972 have correct FS content but CTA1="DEPOSIT"→"/member/deposit" → fix to "Spin Now"
//   Both: replace generic "How to Claim" template with campaign-specific Double 8.8 content
//
// Usage: node bin/fix-double88-popups.mjs [--commit]

import { authedFetch, createDialogPopup, updateDialogPopup, getPopupDetail, updatePromotion } from '../src/api-client.js';
import { getSite } from '../src/sites.js';
import { buildApiPlan } from '../src/api-mapper-qp2.js';

const COMMIT = process.argv.includes('--commit');
const site = getSite('qp2');

function nowYmdHms() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

// ─── Double 8.8 popup content ─────────────────────────────────────────────

function makeContents(spinCount, minDeposit) {
  const depStr = `RM${minDeposit} ($${minDeposit})`;
  const depStrSg = `S$${minDeposit}`;
  const spinEn = `${spinCount} UPGRADED FREE SPINS`;
  const spinZh = `${spinCount}升级免费旋转`;
  const body = (dep) => ({
    en: `<p>Double date, double luck \u{1F340}</p>\n<p>${dep} unlocks ${spinEn} \u{1F3B0}</p>\n<p><em>Happens once — 7–9 Aug only, don’t miss it \u{1F525}</em></p>`,
    zh: `<p>双日加倍好达 \u{1F340}</p>\n<p>${dep} 解锁 ${spinZh} \u{1F3B0}</p>\n<p><em>限时8月8日–9日，别错过 \u{1F525}</em></p>`,
  });
  const my = body(depStr);
  const sg = body(depStrSg);
  return {
    1: { locale_id: 1, content: my.en, title: '\u{1F389} Double 8.8 is here!', cta_button_type: 2, cta_button_text_1: 'Spin Now', cta_button_link_1: '/member/reward', cta_button_text_2: 'READ MORE', cta_button_link_2: '/member/message', desktop_link: null, mobile_link: null, media_type: null },
    3: { locale_id: 3, content: my.zh, title: '\u{1F389} 双 8.8 来啊！', cta_button_type: 2, cta_button_text_1: '立即旋转', cta_button_link_1: '/member/reward', cta_button_text_2: '阅读更多', cta_button_link_2: '/member/message', desktop_link: null, mobile_link: null, media_type: null },
    6: { locale_id: 6, content: sg.en, title: '\u{1F389} Double 8.8 is here!', cta_button_type: 2, cta_button_text_1: 'Spin Now', cta_button_link_1: '/member/reward', cta_button_text_2: 'READ MORE', cta_button_link_2: '/member/message', desktop_link: null, mobile_link: null, media_type: null },
    7: { locale_id: 7, content: sg.zh, title: '\u{1F389} 双 8.8 来啊！', cta_button_type: 2, cta_button_text_1: '立即旋转', cta_button_link_1: '/member/reward', cta_button_text_2: '阅读更多', cta_button_link_2: '/member/message', desktop_link: null, mobile_link: null, media_type: null },
  };
}

// ─── Promo configs ─────────────────────────────────────────────────────────

const PROMOS = [
  {
    promoId: 1431,
    code: 'FT_RET_CRM_REL_88FS_GOO_AUG',
    spinCount: 88,
    minDeposit: 50,
    qp2dPopupId: 1970,
    resolved: {
      bonus_type: 'Free Spin',
      bonus_sub_type: 'Reload',
      promo_code: 'FT_RET_CRM_REL_88FS_GOO_AUG',
      promotion_name_en: '88 Free Spins on Gates Of Olympus',
      validity_days: 1,
      rewards_validity_days: 1,
      recurring: true,
      max_per_player: 1,
      daily_max: 99999,
      currencies: ['MYR', 'SGD'],
      per_currency_overrides: {},
      locales: ['MY_EN', 'MY_ZH', 'SG_EN', 'SG_ZH'],
      parsed: { to_multiplier: 10, game: 'Gates of Olympus', game_provider: 'PP2', min_deposit: 50, spin_count: 88, amount_per_line: 0.02, value_per_spin: null },
    },
  },
  {
    promoId: 1432,
    code: 'FT_RET_CRM_REL_100FS_GOO_AUG',
    spinCount: 100,
    minDeposit: 100,
    qp2dPopupId: 1972,
    resolved: {
      bonus_type: 'Free Spin',
      bonus_sub_type: 'Reload',
      promo_code: 'FT_RET_CRM_REL_100FS_GOO_AUG',
      promotion_name_en: '100 Free Spins on Gates Of Olympus',
      validity_days: 1,
      rewards_validity_days: 1,
      recurring: true,
      max_per_player: 1,
      daily_max: 99999,
      currencies: ['MYR', 'SGD'],
      per_currency_overrides: {},
      locales: ['MY_EN', 'MY_ZH', 'SG_EN', 'SG_ZH'],
      parsed: { to_multiplier: 10, game: 'Gates of Olympus', game_provider: 'PP2', min_deposit: 100, spin_count: 100, amount_per_line: 0.03, value_per_spin: null },
    },
  },
];

// ─── Main ──────────────────────────────────────────────────────────────────

for (const promo of PROMOS) {
  const { promoId, code, spinCount, minDeposit, qp2dPopupId, resolved } = promo;
  console.log(`\n=== ${code} (promo ${promoId}) ===`);

  const contents = makeContents(spinCount, minDeposit);

  // ── Step 1: Update QP2D popup content + fix CTA ──
  const qp2dPopup = await getPopupDetail(site, qp2dPopupId);
  if (!qp2dPopup) { console.error(`  ✗ QP2D popup ${qp2dPopupId} not found`); continue; }
  console.log(`  QP2D popup ${qp2dPopupId} (site_id=${qp2dPopup.site_id}): updating content + CTA → Spin Now`);
  if (COMMIT) {
    await updateDialogPopup(site, qp2dPopup, { contentsOverrides: contents });
    console.log(`  ✓ QP2D popup ${qp2dPopupId} updated`);
  } else {
    console.log(`  DRY: would update QP2D popup ${qp2dPopupId}`);
  }

  // ── Step 2: Create new QP2A (site_id=1) popup ──
  const createBody = {
    site_id: 1,
    platform: 1,
    start_date: nowYmdHms(),
    session: '3',
    position: 99,
    status: 1,
    location: 1,
    affiliates_visibility: 0,
    always_pop: 0,
    do_not_show_again: 0,
    label: `${spinCount} Free Spins on Gates Of Olympus`,
    contents: Object.fromEntries(Object.entries(contents).map(([lid, c]) => [String(lid), c])),
  };
  console.log(`  Creating new QP2A (IBC22 site_id=1) popup...`);
  let newQp2aPopupId = null;
  if (COMMIT) {
    const cr = await createDialogPopup(site, createBody);
    newQp2aPopupId = cr?.data?.rows?.id;
    if (!newQp2aPopupId) { console.error(`  ✗ Create QP2A popup failed:`, JSON.stringify(cr?.errors || cr).slice(0, 200)); continue; }
    console.log(`  ✓ Created QP2A popup id=${newQp2aPopupId}`);
  } else {
    console.log(`  DRY: would create QP2A popup for site_id=1`);
    newQp2aPopupId = 0;
  }

  // ── Step 3: Build PUT body + relink dialog_popup_list ──
  const detailRes = await authedFetch(site, `/api/bo/promotion/${promoId}`);
  const detail = detailRes?.data?.rows;
  if (!detail) { console.error(`  ✗ Could not fetch promo detail for ${promoId}`); continue; }
  const merchantIds = (detail.merchant_ids || []).map((m) => (typeof m === 'object' ? m.id : m));
  const templateId = detail.message_template_id || 0;
  const listRes = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(code)}&perPage=10`);
  const listRow = (listRes?.data?.rows || []).find((r) => r.id === promoId);
  const smsMtId = listRow?.message_template_sms_id || 0;

  const plan = await buildApiPlan(resolved, { brand: 'QP2A', site, merchantIds });
  const putBody = plan.buildUpdate(promoId, templateId, null, smsMtId);
  putBody.merchant_ids = Object.fromEntries(merchantIds.sort((a, b) => a - b).map((id, i) => [String(i), id]));
  putBody.freespin_check = detail.freespin_check;   // preserve live value (1)

  if (COMMIT) {
    // Re-fetch both popup full rows for the dialog_popup_list
    const qp2aFull = await getPopupDetail(site, newQp2aPopupId);
    const qp2dFull = await getPopupDetail(site, qp2dPopupId);
    if (!qp2aFull || !qp2dFull) { console.error(`  ✗ Could not re-fetch popup rows`); continue; }
    const dl = {};
    let idx = 0;
    for (const [siteId, popup] of [[1, qp2aFull], [4, qp2dFull]]) {
      dl[String(idx++)] = { ...popup, promotion_id: promoId };
      console.log(`  dialog_popup_list[${idx - 1}]: site_id=${siteId} → popup_id=${popup.id}`);
    }
    putBody.dialog_popup_list = dl;
    await updatePromotion(site, promoId, putBody);

    // Verify
    const verRes = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(code)}&perPage=10`);
    const verRow = (verRes?.data?.rows || []).find((r) => r.id === promoId);
    const links = (verRow?.dialog_popup_list || []).sort((a, b) => a.site_id - b.site_id)
      .map((d) => `s${d.site_id}→${d.popup_id}`).join('  ');
    console.log(`  ✓ Relinked. Now: ${links}`);
  } else {
    console.log(`  DRY: would relink dialog_popup_list → s1→(new QP2A popup)  s4→${qp2dPopupId}`);
  }
}

if (!COMMIT) console.log('\n→ Dry-run complete. Add --commit to apply.');
else console.log('\nDone.');

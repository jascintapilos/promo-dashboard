#!/usr/bin/env node
// One-shot: create missing QP2 dialog popups for P034-P037 and link them.
//
// WHY: canary was idempotent-blocked (code already on BO) so the dialog
// create + link step never ran. No popups exist for any of the 4 promos × 4 sites.
//
// Usage:
//   node bin/_archive/fix-p034-p037-dialogs.mjs           # dry-run
//   node bin/_archive/fix-p034-p037-dialogs.mjs --commit  # live

import { authedFetch, createDialogPopup, updatePromotion } from '../../src/api-client.js';
import { buildApiPlan } from '../../src/api-mapper-qp2.js';
import { getSite } from '../../src/sites.js';
import { loadAllRequests, resolveDuplicates } from '../../src/planner.js';

const commit = process.argv.includes('--commit');

// ── Target promos ──────────────────────────────────────────────────────────
// promo_id from live BO probe done 2026-07-14
const PROMOS = [
  { handle: 'P034-r35', code: 'WHALE_CRM_PROBE_20PCT_100_FTD_LOSE_4', promoId: 1363, minDep: 100, maxBonus: 20 },
  { handle: 'P035-r36', code: 'WHALE_CRM_PROBE_20PCT_150_FTD_LOSE_4', promoId: 1364, minDep: 150, maxBonus: 30 },
  { handle: 'P036-r37', code: 'WHALE_CRM_PROBE_20PCT_200_FTD_LOSE_4', promoId: 1349, minDep: 200, maxBonus: 40 },
  { handle: 'P037-r38', code: 'WHALE_CRM_PROBE_20PCT_300_FTD_LOSE_4', promoId: 1350, minDep: 300, maxBonus: 60 },
];

// ── Site IDs ────────────────────────────────────────────────────────────────
// site_id 1=IBC22, 2=KING333, 3=ACE66, 4=SPADE66
const SITE_IDS = [1, 2, 3, 4];

const TITLE_EN = '20% Live Casino Reload Bonus';
const TITLE_ZH = '20% 真人娱乐场充值奖励';

function makeBody(siteId, minDep) {
  const myAmount = `MYR ${minDep}`;
  const sgAmount = `SGD ${minDep}`;

  const bodyEN = (amount) =>
    `<p><strong>How to Apply:</strong></p>\r\n<ol>\r\n  <li>Go to the [Transfer] page and select your game provider.</li>\r\n  <li>Enter amount ${amount} and above</li>\r\n  <li>Choose <strong>[${TITLE_EN} ]</strong> under "Promotion" and click SUBMIT.</li>\r\n</ol>\r\n<p><strong><em><span style="color:#FF0000;">*For full promotion terms &amp; conditions, check your Inbox.</span></em></strong></p>`;

  const bodyZH = (amount) =>
    `<p><strong>如何申请：</strong></p>\r\n<ol>\r\n  <li>前往[转账]页面并选择您的游戏提供商。</li>\r\n  <li>输入 ${amount} 或以上金额</li>\r\n  <li>在"促销"下选择<strong>[${TITLE_ZH} ]</strong>并点击提交。</li>\r\n</ol>\r\n<p><strong><em><span style="color:#FF0000;">*完整条款及条件，请查看您的收件箱。</span></em></strong></p>`;

  const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 19);

  return {
    site_id: siteId,
    platform: 1,
    start_date: nowStr,
    session: '3',
    position: 99,
    status: 1,
    location: 1,
    affiliates_visibility: 0,
    always_pop: 0,
    do_not_show_again: 0,
    label: TITLE_EN,
    contents: {
      '1': {
        locale_id: 1,
        content: bodyEN(myAmount),
        title: TITLE_EN,
        mobile_link: null,
        desktop_link: null,
        video_mobile_link: null,
        video_desktop_link: null,
        media_type: null,
        cta_button_type: 2,
        cta_button_text_1: 'DEPOSIT',
        cta_button_link_1: '/member/deposit',
        cta_button_text_2: 'READ MORE',
        cta_button_link_2: '/member/message',
      },
      '3': {
        locale_id: 3,
        content: bodyZH(myAmount),
        title: TITLE_ZH,
        mobile_link: null,
        desktop_link: null,
        video_mobile_link: null,
        video_desktop_link: null,
        media_type: null,
        cta_button_type: 2,
        cta_button_text_1: '存款',
        cta_button_link_1: '/member/deposit',
        cta_button_text_2: '阅读更多',
        cta_button_link_2: '/member/message',
      },
      '6': {
        locale_id: 6,
        content: bodyEN(sgAmount),
        title: TITLE_EN,
        mobile_link: null,
        desktop_link: null,
        video_mobile_link: null,
        video_desktop_link: null,
        media_type: null,
        cta_button_type: 2,
        cta_button_text_1: 'DEPOSIT',
        cta_button_link_1: '/member/deposit',
        cta_button_text_2: 'READ MORE',
        cta_button_link_2: '/member/message',
      },
      '7': {
        locale_id: 7,
        content: bodyZH(sgAmount),
        title: TITLE_ZH,
        mobile_link: null,
        desktop_link: null,
        video_mobile_link: null,
        video_desktop_link: null,
        media_type: null,
        cta_button_type: 2,
        cta_button_text_1: '存款',
        cta_button_link_1: '/member/deposit',
        cta_button_text_2: '阅读更多',
        cta_button_link_2: '/member/message',
      },
    },
  };
}

const site = getSite('ibc22');
const { byHandle, byId, byCode } = await loadAllRequests();

for (const promo of PROMOS) {
  console.log(`\n── ${promo.handle} (${promo.code}, promo_id=${promo.promoId}) ──`);
  const request = byHandle.get(promo.handle);
  if (!request) { console.error(`  Request not found — skipping`); continue; }
  const resolved = await resolveDuplicates(request, byCode, {});
  // Extract QP2 code from potential dual-format
  const m = String(resolved.promo_code || '').match(/^QP2:\s*(.+)$/m);
  const qp2Code = m ? m[1].trim() : resolved.promo_code;

  // Verify promo still has 0 dialogs
  const listResp = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(qp2Code)}&perPage=10`);
  const listRow = (listResp?.data?.rows || []).find(r => r.id === promo.promoId);
  const existing = listRow?.dialog_popup_list || [];
  if (existing.length > 0) {
    console.log(`  Already has ${existing.length} dialog(s) — skipping`);
    continue;
  }

  // Get full promo detail for PUT body
  const detail = (await authedFetch(site, `/api/bo/promotion/${promo.promoId}`)).data.rows;
  const templateId = detail.message_template_id || 0;
  const merchantIds = (detail.merchant_ids || []).map(m => typeof m === 'object' ? m.id : m);
  console.log(`  merchant_ids: [${merchantIds.join(',')}]  template_id: ${templateId}`);

  // Create 4 popups (one per site_id)
  const dl = {};
  for (const siteId of SITE_IDS) {
    const body = makeBody(siteId, promo.minDep);
    console.log(`  ${commit ? 'POST' : '[DRY]'} /api/bo/popups  site_id=${siteId}  locales=1,3,6,7`);
    if (!commit) continue;

    const resp = await createDialogPopup(site, body);
    const newPopup = resp?.data?.rows || resp?.data;
    const newId = newPopup?.id;
    if (!newId) { console.error(`  ✗ popup create failed for site_id=${siteId}`, resp); continue; }
    console.log(`    ✓ popup_id=${newId}`);

    // Fetch full row (needed for PUT shape)
    const listPage = await authedFetch(site, `/api/bo/popups?perPage=200&sort_by=id&sort_order=desc&page=1`);
    const fullRow = (listPage?.data?.rows || []).find(p => p.id === newId);
    if (!fullRow) { console.error(`  ✗ could not find popup ${newId} in listing`); continue; }

    dl[String(Object.keys(dl).length)] = { ...fullRow, promotion_id: promo.promoId };
  }

  if (!commit) {
    console.log(`  [DRY] Would PUT /api/bo/promotion/${promo.promoId} with dialog_popup_list (4 entries)`);
    continue;
  }
  if (Object.keys(dl).length === 0) { console.error('  No popups created — skipping PUT'); continue; }

  // Build PUT body using the mapper (preserves all existing fields)
  const plan = await buildApiPlan(resolved, { brand: 'QP2A', site, merchantIds });
  const putBody = plan.buildUpdate(promo.promoId, templateId, null);
  const mObj = {};
  merchantIds.forEach((id, idx) => { mObj[String(idx)] = id; });
  putBody.merchant_ids = mObj;
  putBody.dialog_popup_list = dl;

  console.log(`  PUT /api/bo/promotion/${promo.promoId}  dialog_popup_list entries: ${Object.keys(dl).length}`);
  const putResp = await updatePromotion(site, promo.promoId, putBody);
  const status = putResp?.status || putResp?.data?.status || '?';
  console.log(`  PUT response status: ${status}`);

  // Verify
  const verResp = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(qp2Code)}&perPage=10`);
  const vr = (verResp?.data?.rows || []).find(r => r.id === promo.promoId);
  const links = (vr?.dialog_popup_list || []).sort((a, b) => a.site_id - b.site_id)
    .map(d => `s${d.site_id}→${d.popup_id}`).join(' ');
  console.log(`  ✓ Verified: ${links || '(none!)'}`);
}

console.log('\nDone.' + (commit ? '' : ' Run with --commit to execute.'));

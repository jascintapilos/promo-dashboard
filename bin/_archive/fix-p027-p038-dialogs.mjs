#!/usr/bin/env node
// One-shot: create missing QP2 dialog popups for 6 promos (P027-P029, P030, P032, P038)
// and link them.
//
// Usage:
//   node bin/_archive/fix-p027-p038-dialogs.mjs           # dry-run
//   node bin/_archive/fix-p027-p038-dialogs.mjs --commit  # live

import { authedFetch, createDialogPopup, updatePromotion } from '../../src/api-client.js';
import { buildApiPlan } from '../../src/api-mapper-qp2.js';
import { getSite } from '../../src/sites.js';
import { loadAllRequests, resolveDuplicates } from '../../src/planner.js';

const commit = process.argv.includes('--commit');

const PROMOS = [
  { handle: 'P027-r28', code: 'WHALE_CRM_PROBE_88PCT_150_FTD_LOSE_2', promoId: 1346, templateId: 1272,
    minDepMYR: 150, minDepSGD: 150, nameEN: '88% Slots Reload Bonus', nameZH: '88% 老虎机充值奖励' },
  { handle: 'P028-r29', code: 'WHALE_CRM_PROBE_88PCT_200_FTD_LOSE_2', promoId: 1347, templateId: 1273,
    minDepMYR: 200, minDepSGD: 200, nameEN: '88% Slots Reload Bonus', nameZH: '88% 老虎机充值奖励' },
  { handle: 'P029-r30', code: 'WHALE_CRM_PROBE_88PCT_300_FTD_LOSE_2', promoId: 1348, templateId: 1274,
    minDepMYR: 300, minDepSGD: 300, nameEN: '88% Slots Reload Bonus', nameZH: '88% 老虎机充值奖励' },
  { handle: 'P030-r31', code: 'WHALE_CRM_PROBE_DEP_30PCT_88_FTD_LOSE_3', promoId: 1368, templateId: 1293,
    minDepMYR: 30, minDepSGD: 50, nameEN: '30% Reload Bonus', nameZH: '30% 充值奖励' },
  { handle: 'P032-r33', code: 'WHALE_CRM_PROBE_DEP_30PCT_138_FTD_LOSE_3', promoId: 1370, templateId: 1295,
    minDepMYR: 50, minDepSGD: 50, nameEN: '30% Reload Bonus', nameZH: '30% 充值奖励' },
  { handle: 'P038-r39', code: 'WHALE_CRM_PROBE_20PCT_100_FTD_WIN_2', promoId: 1351, templateId: 1277,
    minDepMYR: 100, minDepSGD: 100, nameEN: '20% Live Casino Reload Bonus', nameZH: '20% 真人娱乐场充值奖励' },
];

const SITE_IDS = [1, 2, 3, 4];

function makeBody(siteId, { minDepMYR, minDepSGD, nameEN, nameZH }) {
  const myAmt = `MYR ${minDepMYR}`;
  const sgAmt = `SGD ${minDepSGD}`;

  const bodyEN = (amt) =>
    `<p><strong>How to Apply:</strong></p>\r\n<ol>\r\n  <li>Go to the [Transfer] page and select your game provider.</li>\r\n  <li>Enter amount ${amt} and above</li>\r\n  <li>Choose <strong>[${nameEN} ]</strong> under "Promotion" and click SUBMIT.</li>\r\n</ol>\r\n<p><strong><em><span style="color:#FF0000;">*For full promotion terms &amp; conditions, check your Inbox.</span></em></strong></p>`;

  const bodyZH = (amt) =>
    `<p><strong>如何申请：</strong></p>\r\n<ol>\r\n  <li>前往[转账]页面并选择您的游戏提供商。</li>\r\n  <li>输入 ${amt} 或以上金额</li>\r\n  <li>在"促销"下选择<strong>[${nameZH} ]</strong>并点击提交。</li>\r\n</ol>\r\n<p><strong><em><span style="color:#FF0000;">*完整条款及条件，请查看您的收件箱。</span></em></strong></p>`;

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
    label: nameEN,
    contents: {
      '1': { locale_id: 1, content: bodyEN(myAmt), title: nameEN, mobile_link: null, desktop_link: null,
             video_mobile_link: null, video_desktop_link: null, media_type: null, cta_button_type: 2,
             cta_button_text_1: 'DEPOSIT', cta_button_link_1: '/member/deposit',
             cta_button_text_2: 'READ MORE', cta_button_link_2: '/member/message' },
      '3': { locale_id: 3, content: bodyZH(myAmt), title: nameZH, mobile_link: null, desktop_link: null,
             video_mobile_link: null, video_desktop_link: null, media_type: null, cta_button_type: 2,
             cta_button_text_1: '存款', cta_button_link_1: '/member/deposit',
             cta_button_text_2: '阅读更多', cta_button_link_2: '/member/message' },
      '6': { locale_id: 6, content: bodyEN(sgAmt), title: nameEN, mobile_link: null, desktop_link: null,
             video_mobile_link: null, video_desktop_link: null, media_type: null, cta_button_type: 2,
             cta_button_text_1: 'DEPOSIT', cta_button_link_1: '/member/deposit',
             cta_button_text_2: 'READ MORE', cta_button_link_2: '/member/message' },
      '7': { locale_id: 7, content: bodyZH(sgAmt), title: nameZH, mobile_link: null, desktop_link: null,
             video_mobile_link: null, video_desktop_link: null, media_type: null, cta_button_type: 2,
             cta_button_text_1: '存款', cta_button_link_1: '/member/deposit',
             cta_button_text_2: '阅读更多', cta_button_link_2: '/member/message' },
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
  const m = String(resolved.promo_code || '').match(/^QP2:\s*(.+)$/m);
  const qp2Code = m ? m[1].trim() : resolved.promo_code;

  // Verify current dialog count
  const listResp = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(qp2Code)}&perPage=10`);
  const listRow = (listResp?.data?.rows || []).find(r => r.id === promo.promoId);
  const existing = listRow?.dialog_popup_list || [];
  if (existing.length > 0) {
    console.log(`  Already has ${existing.length} dialog(s) — skipping`);
    continue;
  }

  const detail = (await authedFetch(site, `/api/bo/promotion/${promo.promoId}`)).data.rows;
  const merchantIds = (detail.merchant_ids || []).map(m => typeof m === 'object' ? m.id : m);
  console.log(`  merchant_ids: [${merchantIds.join(',')}]  template_id: ${promo.templateId}`);
  console.log(`  MYR min_dep: ${promo.minDepMYR}  SGD min_dep: ${promo.minDepSGD}`);
  console.log(`  name_EN: "${promo.nameEN}"  name_ZH: "${promo.nameZH}"`);

  const dl = {};
  for (const siteId of SITE_IDS) {
    const body = makeBody(siteId, promo);
    console.log(`  ${commit ? 'POST' : '[DRY]'} /api/bo/popups  site_id=${siteId}  locales=1,3,6,7`);
    if (!commit) continue;

    const resp = await createDialogPopup(site, body);
    const newPopup = resp?.data?.rows || resp?.data;
    const newId = newPopup?.id;
    if (!newId) { console.error(`  ✗ popup create failed for site_id=${siteId}`, JSON.stringify(resp).slice(0,200)); continue; }
    console.log(`    ✓ popup_id=${newId}`);

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

  const plan = await buildApiPlan(resolved, { brand: 'QP2A', site, merchantIds });
  const putBody = plan.buildUpdate(promo.promoId, promo.templateId, null);
  const mObj = {};
  merchantIds.forEach((id, idx) => { mObj[String(idx)] = id; });
  putBody.merchant_ids = mObj;
  putBody.dialog_popup_list = dl;

  console.log(`  PUT /api/bo/promotion/${promo.promoId}  dialog_popup_list entries: ${Object.keys(dl).length}`);
  await updatePromotion(site, promo.promoId, putBody);

  const verResp = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(qp2Code)}&perPage=10`);
  const vr = (verResp?.data?.rows || []).find(r => r.id === promo.promoId);
  const links = (vr?.dialog_popup_list || []).sort((a, b) => a.site_id - b.site_id)
    .map(d => `s${d.site_id}→${d.popup_id}`).join(' ');
  console.log(`  ✓ Verified: ${links || '(none!)'}`);
}

console.log('\nDone.' + (commit ? '' : ' Run with --commit to execute.'));

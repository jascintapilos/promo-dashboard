// Rewrite the dialog popups for P104-P105 (Free Credit) on QPRO3/4/5/9
// using the FC-specific "How to Apply" template (no deposit step).
//
// Deposit flow promos (P102/P103) keep the existing Deposit template.
// FC promos have min_dep=0 and route to /member/reward via CLAIM NOW.
//
// Convention captured in memory/feedback_fc_popup_template.md (2026-05-22).
//
// Usage: node bin/_fix-p104-p105-fc-popup-body.mjs [--commit]

import { updatePromotion, createDialogPopup } from '../src/api-client.js';
import { getSite } from '../src/sites.js';
import { buildApiPlan as buildQproPlan } from '../src/api-mapper-qpro.js';
import { loadAllRequests } from '../src/planner.js';

const COMMIT = process.argv.includes('--commit');
const { byHandle } = await loadAllRequests();

function nowYmdHms() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth()+1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

const LOCALE_LANG = { 1: 'EN', 3: 'ZH' };
const CTA = {
  EN: { claim: 'CLAIM NOW', right: 'READ MORE' },
  ZH: { claim: '立即领取', right: '阅读更多' },
};

// FC-specific "How to Apply" — no deposit, claim from Rewards.
function fcPopupContent(localeId, { promotionNameEn, promotionNameZh }) {
  const lang = LOCALE_LANG[localeId];
  if (lang === 'EN') {
    return `<p><strong>How to Apply:</strong><br><br>1. Login to your account and go to the [Rewards] page.<br>2. Find [<strong>${promotionNameEn}</strong>] in the available promotions list.<br>3. Click CLAIM NOW to receive your free credit instantly.<br><br><i><strong>*For full promotion terms &amp; conditions, please check your Inbox.</strong></i></p>`;
  }
  return `<p><strong>如何申请：</strong></p><p>1. 登录账户并前往[奖励]页面。<br>2. 在可用促销列表中找到 <strong>[${promotionNameZh}]</strong>。<br>3. 点击立即领取以即时获得您的免费体验金。</p><p><strong>*有关完整的促销条款和条件，请查看您的收件箱。</strong></p>`;
}

function buildFcPopupBody({ rec }) {
  const contents = {};
  for (const localeId of [1, 3]) {
    const lang = LOCALE_LANG[localeId];
    const cta = CTA[lang];
    const title = lang === 'ZH'
      ? (rec.promotion_name_zh_id || rec.promotion_name_en)
      : rec.promotion_name_en;
    contents[String(localeId)] = {
      locale_id: localeId,
      content: fcPopupContent(localeId, {
        promotionNameEn: rec.promotion_name_en,
        promotionNameZh: rec.promotion_name_zh_id || rec.promotion_name_en,
      }),
      title,
      mobile_link: null, desktop_link: null,
      video_mobile_link: null, video_desktop_link: null, media_type: null,
      cta_button_type: 2,
      cta_button_text_1: cta.claim, cta_button_link_1: '/member/reward',
      cta_button_text_2: cta.right, cta_button_link_2: '/member/message',
    };
  }
  return {
    platform: 1,
    start_date: nowYmdHms(),
    session: '3',
    position: 99,
    status: 1,
    contents,
    location: 1,
    affiliates_visibility: 0,
    always_pop: 0,
    label: rec.promotion_name_en,
  };
}

// Targets: P104/P105 only (FC). P102/P103 stay with the Deposit template.
const TARGETS = {
  P104: { handle: 'P104-r105', sites: {
    QPRO3: { promoId: 453, tmplId: 412, siteId: 'qpro3' },
    QPRO4: { promoId: 371, tmplId: 334, siteId: 'qpro4' },
    QPRO5: { promoId: 341, tmplId: 263, siteId: 'qpro5' },
    QPRO9: { promoId: 331, tmplId: 469, siteId: 'qpro9' },
  } },
  P105: { handle: 'P105-r106', sites: {
    QPRO3: { promoId: 454, tmplId: 413, siteId: 'qpro3' },
    QPRO4: { promoId: 372, tmplId: 335, siteId: 'qpro4' },
    QPRO5: { promoId: 342, tmplId: 264, siteId: 'qpro5' },
    QPRO9: { promoId: 332, tmplId: 470, siteId: 'qpro9' },
  } },
};

console.log(`Mode: ${COMMIT ? 'LIVE' : 'DRY-RUN'}`);

for (const [rn, {handle, sites}] of Object.entries(TARGETS)) {
  const rec = byHandle.get(handle);
  if (!rec) { console.error(`${rn}: fixture not found`); continue; }
  console.log(`\n${rn} (${rec.promo_code})`);

  for (const [brand, {promoId, tmplId, siteId}] of Object.entries(sites)) {
    try {
      const site = getSite(siteId);
      const popupBody = buildFcPopupBody({ rec });
      if (!COMMIT) {
        const en = popupBody.contents['1'].content;
        console.log(`  ${brand} id=${promoId} (dry-run) — EN: ${en.substring(0, 110)}...`);
        continue;
      }
      const r = await createDialogPopup(site, popupBody);
      const popupRow = r?.data?.rows;
      if (!popupRow?.id) throw new Error('no popup id');
      const plan = await buildQproPlan(rec, { brand, site });
      const body = plan.buildUpdate(promoId, tmplId, popupRow);
      await updatePromotion(site, promoId, body);
      console.log(`  ${brand} id=${promoId} ✓ new popup id=${popupRow.id} code=${popupRow.code}`);
    } catch (e) {
      console.log(`  ${brand} id=${promoId} ✗ ${e.message.split('\n')[0]}`);
    }
  }
}

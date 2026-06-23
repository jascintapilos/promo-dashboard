// Rewrite the dialog popups for P102-P105 on QPRO3/4/5/9 using the
// operator's "How to Apply" template. Replaces the long T&C-duplicating
// body the mapper currently emits. Re-links the new popup to the promo.
//
// MY-only locales (EN=1, ZH=3). CTA matches mapper convention:
//   min_deposit > 0 → DEPOSIT + /member/deposit  (P102/P103 Reload)
//   min_deposit = 0 → CLAIM NOW + /member/reward (P104/P105 FC)
//
// Usage: node bin/_fix-p102-p105-popups.mjs [--commit]

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
const CCY = 'RM';
const CTA = {
  EN: { deposit: 'DEPOSIT', claim: 'CLAIM NOW', right: 'READ MORE' },
  ZH: { deposit: '存款', claim: '立即领取', right: '阅读更多' },
};

function popupContentForLocale(localeId, { promotionNameEn, promotionNameZh, minDeposit }) {
  const lang = LOCALE_LANG[localeId];
  if (lang === 'EN') {
    return `<p><strong>How to Apply:</strong><br><br>1. Go to the [Transfer] page and select your game provider.<br>2. Enter amount ${CCY}${minDeposit} and above<br>3. Choose [<strong>${promotionNameEn}</strong>] under "Promotion" and click SUBMIT.<br><br><i><strong>*For full promotion terms &amp; conditions, please check your Inbox.</strong></i></p>`;
  }
  return `<p><strong>如何申请：</strong></p><p>1. 点击 [转账] 页面并选择您的游戏提供商。<br>2. 输入金额 ${CCY}${minDeposit} 以上<br>3. 在"促销"下选择 <strong>[${promotionNameZh}]</strong> 并点击提交。</p><p><strong>*有关完整的促销条款和条件，请查看您的收件箱。</strong></p>`;
}

function buildPopupBody({ rec }) {
  const minDeposit = Number(rec.parsed?.min_deposit || 0);
  const useDeposit = minDeposit > 0;
  const ctaLeftLink  = useDeposit ? '/member/deposit' : '/member/reward';
  const ctaRightLink = '/member/message';
  const contents = {};
  for (const localeId of [1, 3]) {
    const lang = LOCALE_LANG[localeId];
    const cta = CTA[lang];
    const title = lang === 'ZH'
      ? (rec.promotion_name_zh_id || rec.promotion_name_en)
      : rec.promotion_name_en;
    contents[String(localeId)] = {
      locale_id: localeId,
      content: popupContentForLocale(localeId, {
        promotionNameEn: rec.promotion_name_en,
        promotionNameZh: rec.promotion_name_zh_id || rec.promotion_name_en,
        minDeposit,
      }),
      title,
      mobile_link: null, desktop_link: null,
      video_mobile_link: null, video_desktop_link: null, media_type: null,
      cta_button_type: 2,
      cta_button_text_1: useDeposit ? cta.deposit : cta.claim,
      cta_button_link_1: ctaLeftLink,
      cta_button_text_2: cta.right,
      cta_button_link_2: ctaRightLink,
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

const TARGETS = {
  P102: { handle: 'P102-r103', sites: {
    QPRO3: { promoId: 451, tmplId: 410, siteId: 'qpro3' },
    QPRO4: { promoId: 369, tmplId: 332, siteId: 'qpro4' },
    QPRO5: { promoId: 339, tmplId: 261, siteId: 'qpro5' },
    QPRO9: { promoId: 329, tmplId: 467, siteId: 'qpro9' },
  } },
  P103: { handle: 'P103-r104', sites: {
    QPRO3: { promoId: 452, tmplId: 411, siteId: 'qpro3' },
    QPRO4: { promoId: 370, tmplId: 333, siteId: 'qpro4' },
    QPRO5: { promoId: 340, tmplId: 262, siteId: 'qpro5' },
    QPRO9: { promoId: 330, tmplId: 468, siteId: 'qpro9' },
  } },
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
  console.log(`\n${rn} (${rec.promo_code}, min=${rec.parsed?.min_deposit || 0})`);

  for (const [brand, {promoId, tmplId, siteId}] of Object.entries(sites)) {
    try {
      const site = getSite(siteId);
      const popupBody = buildPopupBody({ rec });
      if (!COMMIT) {
        const en = popupBody.contents['1'].content;
        console.log(`  ${brand} id=${promoId} (dry-run) — EN body preview: ${en.substring(0, 120)}...`);
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

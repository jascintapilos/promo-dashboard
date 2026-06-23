// Create + link missing dialog popups for P091-P096.
// QPRO4: P094-P096 missing. QP2C: all 6 missing.
// Reuses the "How to Apply" template proven by _fix-p075-p084-popups.mjs.

import { authedFetch, updatePromotion, createDialogPopup } from '../src/api-client.js';
import { getSite } from '../src/sites.js';
import { buildApiPlan as buildQproPlan } from '../src/api-mapper-qpro.js';
import { buildApiPlan as buildQp2Plan } from '../src/api-mapper-qp2.js';
import { loadAllRequests } from '../src/planner.js';

const { byHandle } = await loadAllRequests();

function nowYmdHms() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth()+1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

const LOCALE_CURRENCY = { 1: 'RM', 3: 'RM', 6: 'S$', 7: 'S$' };
const LOCALE_LANG = { 1: 'EN', 3: 'ZH', 6: 'EN', 7: 'ZH' };
const CTA = {
  EN: { left: 'CLAIM NOW', right: 'READ MORE' },
  ZH: { left: '立即领取',   right: '阅读更多' },
};
const LOCALES_FOUR = [1, 3, 6, 7];

function popupContentForLocale(localeId, { promotionNameEn, promotionNameZh, minDeposit }) {
  const ccy = LOCALE_CURRENCY[localeId];
  const lang = LOCALE_LANG[localeId];
  if (lang === 'EN') {
    const aboveClause = localeId === 6 ? '&amp; Above' : 'and above';
    return `<p><strong>How to Apply:</strong><br><br>1. Go to the [Transfer] page and select your game provider.<br>2. Enter amount ${ccy}${minDeposit} ${aboveClause}<br>3. Choose [<strong>${promotionNameEn}</strong>] under "Promotion" and click SUBMIT.<br><br><i><strong>*For full promotion terms &amp; conditions, please check your Inbox.</strong></i></p>`;
  }
  return `<p><strong>如何申请：</strong></p><p>1. 点击 [转账] 页面并选择您的游戏提供商。<br>2. 输入金额 ${ccy}${minDeposit} 以上<br>3. 在"促销"下选择 <strong>[${promotionNameZh}]</strong> 并点击提交。</p><p><strong>*有关完整的促销条款和条件，请查看您的收件箱。</strong></p>`;
}

function buildPopupBody({ rec }) {
  const minDeposit = Number(rec.parsed?.min_deposit || 0);
  const ctaLeftLink  = minDeposit > 0 ? '/member/deposit' : '/member/reward';
  const ctaRightLink = '/member/message';
  const contents = {};
  for (const localeId of LOCALES_FOUR) {
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
      cta_button_text_1: cta.left, cta_button_link_1: ctaLeftLink,
      cta_button_text_2: cta.right, cta_button_link_2: ctaRightLink,
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

// Targets: only rows missing popups per the audit just done.
const targets = [
  // P091-P093 QPRO4 already have popups; skip those
  { rn: 'P094', handle: 'P094-r95', qpro: { id: 366, tmpl: 329 }, qp2: { id: 1196, tmpl: 1061 } },
  { rn: 'P095', handle: 'P095-r96', qpro: { id: 367, tmpl: 330 }, qp2: { id: 1197, tmpl: 1062 } },
  { rn: 'P096', handle: 'P096-r97', qpro: { id: 368, tmpl: 331 }, qp2: { id: 1198, tmpl: 1063 } },
  // P091-P093 QP2C also need popups
  { rn: 'P091', handle: 'P091-r92', qpro: null,                   qp2: { id: 1193, tmpl: 1058 } },
  { rn: 'P092', handle: 'P092-r93', qpro: null,                   qp2: { id: 1194, tmpl: 1059 } },
  { rn: 'P093', handle: 'P093-r94', qpro: null,                   qp2: { id: 1195, tmpl: 1060 } },
];

const qproSite = getSite('qpro4');
const qp2Site  = getSite('ibc22');

for (const t of targets) {
  const rec = byHandle.get(t.handle);
  if (!rec) { console.error(`${t.rn}: fixture not found`); continue; }
  console.log(`\n${t.rn} (${rec.promo_code}, min=${rec.parsed?.min_deposit})`);

  if (t.qpro) {
    try {
      const popupBody = buildPopupBody({ rec });
      const r = await createDialogPopup(qproSite, popupBody);
      const popupRow = r?.data?.rows;
      if (!popupRow?.id) throw new Error('no popup id');
      const plan = await buildQproPlan(rec, { brand: 'QPRO4', site: qproSite });
      const body = plan.buildUpdate(t.qpro.id, t.qpro.tmpl, popupRow);
      await updatePromotion(qproSite, t.qpro.id, body);
      console.log(`  QPRO4 id=${t.qpro.id} ✓ popup id=${popupRow.id} code=${popupRow.code} linked`);
    } catch (e) {
      console.log(`  QPRO4 id=${t.qpro.id} ✗ ${e.message.split('\n')[0]}`);
    }
  }

  if (t.qp2) {
    try {
      const popupBody = buildPopupBody({ rec });
      popupBody.site_id = 3;
      popupBody.do_not_show_again = 0;
      const r = await createDialogPopup(qp2Site, popupBody);
      const popupRow = r?.data;
      if (!popupRow?.id) throw new Error('no popup id');
      popupRow.label = rec.promotion_name_en;
      popupRow.fullRow = { ...popupRow };
      delete popupRow.fullRow.fullRow;
      const plan = await buildQp2Plan(rec, { brand: 'QP2C', site: qp2Site });
      const body = plan.buildUpdate(t.qp2.id, t.qp2.tmpl, popupRow);
      await updatePromotion(qp2Site, t.qp2.id, body);
      console.log(`  QP2C  id=${t.qp2.id} ✓ popup id=${popupRow.id} code=${popupRow.code} linked`);
    } catch (e) {
      console.log(`  QP2C  id=${t.qp2.id} ✗ ${e.message.split('\n')[0]}`);
    }
  }
}

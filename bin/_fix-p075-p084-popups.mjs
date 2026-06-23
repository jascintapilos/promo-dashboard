// Rewrite the dialog popups for P075-P084 on QPRO4 + QP2C using the
// operator's "How to Apply" template (probed 2026-05-20 from popup id=91
// code=8RTOM on QPRO4 / YE55). Replaces the long T&C-duplicating body the
// mapper currently emits. Also re-links the popup to the promotion (the
// earlier category-fix PUT inadvertently wiped dialog_popup_list).
//
// Per-locale currency: MY→RM, SG→S$.
// CTA buttons preserved (DUAL: CLAIM NOW + READ MORE).

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

// Locale → currency symbol shown in popup body.
const LOCALE_CURRENCY = { 1: 'RM', 3: 'RM', 6: 'S$', 7: 'S$' };
// Locale → locale code (for routing EN vs ZH).
const LOCALE_LANG = { 1: 'EN', 3: 'ZH', 6: 'EN', 7: 'ZH' };
// CTA text per language.
const CTA = {
  EN: { left: 'CLAIM NOW', right: 'READ MORE' },
  ZH: { left: '立即领取', right: '阅读更多' },
};
// Settings_locale_id values to populate for the 4 standard QPRO/QP2 locales.
const LOCALES_FOUR = [1, 3, 6, 7];

function popupContentForLocale(localeId, { promotionNameEn, promotionNameZh, minDeposit }) {
  const ccy = LOCALE_CURRENCY[localeId];
  const lang = LOCALE_LANG[localeId];
  if (lang === 'EN') {
    const aboveClause = localeId === 6 ? '&amp; Above' : 'and above';
    return `<p><strong>How to Apply:</strong><br><br>1. Go to the [Transfer] page and select your game provider.<br>2. Enter amount ${ccy}${minDeposit} ${aboveClause}<br>3. Choose [<strong>${promotionNameEn}</strong>] under "Promotion" and click SUBMIT.<br><br><i><strong>*For full promotion terms &amp; conditions, please check your Inbox.</strong></i></p>`;
  }
  // ZH
  return `<p><strong>如何申请：</strong></p><p>1. 点击 [转账] 页面并选择您的游戏提供商。<br>2. 输入金额 ${ccy}${minDeposit} 以上<br>3. 在"促销"下选择 <strong>[${promotionNameZh}]</strong> 并点击提交。</p><p><strong>*有关完整的促销条款和条件，请查看您的收件箱。</strong></p>`;
}

function buildPopupBody({ rec, platform }) {
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
      mobile_link: null,
      desktop_link: null,
      video_mobile_link: null,
      video_desktop_link: null,
      media_type: null,
      cta_button_type: 2,  // DUAL
      cta_button_text_1: cta.left,
      cta_button_link_1: ctaLeftLink,
      cta_button_text_2: cta.right,
      cta_button_link_2: ctaRightLink,
    };
  }
  const base = {
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
  // QP2 popups need site_id; QPRO does not. Caller adds site_id if QP2.
  return base;
}

const targets = [
  { rn: 'P075', handle: 'P075-r76', qpro: { id: 353, tmpl: 316 }, qp2: { id: 1182, tmpl: 1047 } },
  { rn: 'P076', handle: 'P076-r77', qpro: { id: 354, tmpl: 317 }, qp2: { id: 1183, tmpl: 1048 } },
  { rn: 'P077', handle: 'P077-r78', qpro: { id: 355, tmpl: 318 }, qp2: { id: 1184, tmpl: 1049 } },
  { rn: 'P078', handle: 'P078-r79', qpro: { id: 356, tmpl: 319 }, qp2: { id: 1185, tmpl: 1050 } },
  { rn: 'P079', handle: 'P079-r80', qpro: { id: 357, tmpl: 320 }, qp2: { id: 1186, tmpl: 1051 } },
  { rn: 'P080', handle: 'P080-r81', qpro: { id: 358, tmpl: 321 }, qp2: { id: 1187, tmpl: 1052 } },
  { rn: 'P081', handle: 'P081-r82', qpro: { id: 359, tmpl: 322 }, qp2: { id: 1189, tmpl: 1054 } },
  { rn: 'P082', handle: 'P082-r83', qpro: { id: 360, tmpl: 323 }, qp2: { id: 1190, tmpl: 1055 } },
  { rn: 'P083', handle: 'P083-r84', qpro: { id: 361, tmpl: 324 }, qp2: { id: 1191, tmpl: 1056 } },
  { rn: 'P084', handle: 'P084-r85', qpro: { id: 362, tmpl: 325 }, qp2: { id: 1192, tmpl: 1057 } },
];

const qproSite = getSite('qpro4');
const qp2Site  = getSite('ibc22');

const onlyRn = process.argv[2];  // optional: limit to one RN for smoke test
const filtered = onlyRn ? targets.filter(t => t.rn === onlyRn) : targets;
for (const t of filtered) {
  const rec = byHandle.get(t.handle);
  if (!rec) { console.error(`${t.rn}: fixture not found`); continue; }
  console.log(`\n${t.rn} (${rec.promo_code}, min=${rec.parsed?.min_deposit})`);

  // ── QPRO4 ────────────────────────────────────────────────────────────
  try {
    const popupBody = buildPopupBody({ rec, platform: 'qpro' });
    const r = await createDialogPopup(qproSite, popupBody);
    const popupRow = r?.data?.rows;
    if (!popupRow?.id) throw new Error('no popup id in POST response');
    const plan = await buildQproPlan(rec, { brand: 'QPRO4', site: qproSite });
    const body = plan.buildUpdate(t.qpro.id, t.qpro.tmpl, popupRow);
    await updatePromotion(qproSite, t.qpro.id, body);
    console.log(`  QPRO4 id=${t.qpro.id} ✓ new popup id=${popupRow.id} code=${popupRow.code} linked`);
  } catch (e) {
    console.log(`  QPRO4 id=${t.qpro.id} ✗ ${e.message.split('\n')[0]}`);
  }

  // ── QP2C ─────────────────────────────────────────────────────────────
  try {
    const popupBody = buildPopupBody({ rec, platform: 'qp2' });
    // QP2 popups need site_id + do_not_show_again. QP2C → site_id 3 per
    // src/api-mapper-qp2.js QP2_BRAND_TO_IDS mapping.
    popupBody.site_id = 3;
    popupBody.do_not_show_again = 0;
    const r = await createDialogPopup(qp2Site, popupBody);
    // QP2 returns the popup row directly under `data` (not data.rows).
    const popupRow = r?.data;
    if (!popupRow?.id) throw new Error('no popup id in POST response');
    // The QP2 mapper uses dialogPopup.fullRow + dialogPopup.id when building
    // the dialog_popup_list PUT row. Pass a shallow copy as fullRow to avoid
    // circular reference when JSON.stringify-ed.
    popupRow.label = rec.promotion_name_en;
    popupRow.fullRow = { ...popupRow };
    delete popupRow.fullRow.fullRow;  // belt and suspenders
    const plan = await buildQp2Plan(rec, { brand: 'QP2C', site: qp2Site });
    const body = plan.buildUpdate(t.qp2.id, t.qp2.tmpl, popupRow);
    await updatePromotion(qp2Site, t.qp2.id, body);
    console.log(`  QP2C  id=${t.qp2.id} ✓ new popup id=${popupRow.id} code=${popupRow.code} linked`);
  } catch (e) {
    console.log(`  QP2C  id=${t.qp2.id} ✗ ${e.message.split('\n')[0]}`);
  }
}

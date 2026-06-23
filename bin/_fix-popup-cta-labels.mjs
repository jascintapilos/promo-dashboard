// Patch all P075-P096 dialog popups across QPRO4 + QP2C to use the correct
// CTA1 label per the new rule:
//   "CLAIM NOW"/"立即领取" → /member/reward
//   "DEPOSIT"/"立即存款"   → /member/deposit
// Since these are all Deposit/Reload bonuses, switch label to "DEPOSIT" / "立即存款"
// (keeping the existing /member/deposit link). Also rebuilds content with the
// "How to Apply" template if a popup is still on the old long-T&C shape (some
// QPRO4 P091-P096 popups slipped through with the old content).

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';
import { loadAllRequests } from '../src/planner.js';

const { byHandle } = await loadAllRequests();

function toYmd(s) { return s ? String(s).replace('T',' ').replace(/\.\d+Z?$/,'') : null; }

const LOCALE_CURRENCY = { 1: 'RM', 3: 'RM', 6: 'S$', 7: 'S$' };
const LOCALE_LANG = { 1: 'EN', 3: 'ZH', 6: 'EN', 7: 'ZH' };
// Deposit-bonus CTA labels (per feedback_dialog_popup_cta_label_link.md).
const CTA_DEPOSIT = { EN: 'DEPOSIT', ZH: '立即存款' };
const CTA_READ_MORE = { EN: 'READ MORE', ZH: '阅读更多' };

function howToApplyContent(localeId, { promotionNameEn, promotionNameZh, minDeposit }) {
  const ccy = LOCALE_CURRENCY[localeId];
  const lang = LOCALE_LANG[localeId];
  if (lang === 'EN') {
    const aboveClause = localeId === 6 ? '&amp; Above' : 'and above';
    return `<p><strong>How to Apply:</strong><br><br>1. Go to the [Transfer] page and select your game provider.<br>2. Enter amount ${ccy}${minDeposit} ${aboveClause}<br>3. Choose [<strong>${promotionNameEn}</strong>] under "Promotion" and click SUBMIT.<br><br><i><strong>*For full promotion terms &amp; conditions, please check your Inbox.</strong></i></p>`;
  }
  return `<p><strong>如何申请：</strong></p><p>1. 点击 [转账] 页面并选择您的游戏提供商。<br>2. 输入金额 ${ccy}${minDeposit} 以上<br>3. 在"促销"下选择 <strong>[${promotionNameZh}]</strong> 并点击提交。</p><p><strong>*有关完整的促销条款和条件，请查看您的收件箱。</strong></p>`;
}

const PROMO_HANDLE_BY_CODE = (() => {
  const map = new Map();
  for (const [handle, rec] of byHandle.entries()) {
    if (rec.promo_code) map.set(rec.promo_code, handle);
  }
  return map;
})();

async function patchPopup(site, popupId, rec) {
  // GET full popup row
  const res = await authedFetch(site, `/api/bo/popups?perPage=100`);
  const p = (res?.data?.rows || []).find(r => r.id === popupId);
  if (!p) throw new Error(`popup ${popupId} not in window`);

  const minDeposit = Number(rec.parsed?.min_deposit || 0);
  // Rebuild contents: update CTA1 label + ensure How-to-Apply body.
  const newContents = (p.contents || []).map((c) => {
    const lang = LOCALE_LANG[c.locale_id] || 'EN';
    return {
      ...c,
      content: howToApplyContent(c.locale_id, {
        promotionNameEn: rec.promotion_name_en,
        promotionNameZh: rec.promotion_name_zh_id || rec.promotion_name_en,
        minDeposit,
      }),
      title: lang === 'ZH' ? (rec.promotion_name_zh_id || rec.promotion_name_en) : rec.promotion_name_en,
      cta_button_type: 2,
      cta_button_text_1: CTA_DEPOSIT[lang],
      cta_button_link_1: '/member/deposit',
      cta_button_text_2: CTA_READ_MORE[lang],
      cta_button_link_2: '/member/message',
    };
  });

  const body = {
    ...p,
    start_date: toYmd(p.start_date),
    end_date: toYmd(p.end_date),
    label: rec.promotion_name_en,
    contents: newContents,
  };
  await authedFetch(site, `/api/bo/popups/${popupId}`, { method: 'PUT', body });
}

// Targets: 16 QPRO4 + 16 QP2C promo IDs from this session.
const targets = [
  { siteId: 'qpro4', promoIds: [353,354,355,356,357,358,359,360,361,362,363,364,365,366,367,368] },
  { siteId: 'ibc22', promoIds: [1182,1183,1184,1185,1186,1187,1189,1190,1191,1192,1193,1194,1195,1196,1197,1198] },
];

for (const { siteId, promoIds } of targets) {
  const site = getSite(siteId);
  const list = await authedFetch(site, '/api/bo/promotion?perPage=40');
  const rows = list?.data?.rows || [];
  for (const promoId of promoIds) {
    const r = rows.find(r => r.id === promoId);
    if (!r) { console.log(`${siteId} promo ${promoId} not in list window`); continue; }
    const popup = (r.dialog_popup_list || [])[0];
    if (!popup) { console.log(`${siteId} promo ${promoId} no popup linked`); continue; }
    const handle = PROMO_HANDLE_BY_CODE.get(r.code);
    const rec = handle ? byHandle.get(handle) : null;
    if (!rec) { console.log(`${siteId} promo ${promoId} code=${r.code} fixture not found`); continue; }
    try {
      await patchPopup(site, popup.popup_id, rec);
      console.log(`${siteId} promo=${promoId} code=${r.code} popup=${popup.popup_id} ✓`);
    } catch (e) {
      console.log(`${siteId} promo=${promoId} popup=${popup.popup_id} ✗ ${e.message.split('\n')[0]}`);
    }
  }
}

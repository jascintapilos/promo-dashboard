// Patch all P075-P096 message templates across QPRO4 + QP2C:
//   - Subject → "Exclusive Offer" / "独家优惠"
//   - Table column 2 changes from "Bonus Percentage"/"奖励" + "XX%"
//     to "Max Bonus"/"最高红利金额" + currency-amount
//   - Per-locale currency in the table value (RM for MY, S$ for SG)
// All other content (Bonus Condition Example, T&C) preserved verbatim.

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';
import { loadAllRequests } from '../src/planner.js';

const { byHandle } = await loadAllRequests();

const CCY_BY_LOCALE = { 1: 'MYR', 3: 'MYR', 6: 'S$', 7: 'S$' };

const PROMO_HANDLE_BY_CODE = new Map();
for (const [handle, rec] of byHandle.entries()) {
  if (rec.promo_code) PROMO_HANDLE_BY_CODE.set(rec.promo_code, handle);
}

// Replace the 2-row table in the message body.
// EN: thead "Bonus Percentage" → "Max Bonus"; tbody "XX%" → "<ccy> <max_bonus>"
// ZH: thead "奖励" → "最高红利金额"; tbody same
// Also rewrite the first tbody cell (Min Deposit value) to use per-locale ccy.
function patchTable(html, { localeId, minDep, maxBonus }) {
  const ccy = CCY_BY_LOCALE[localeId];
  const isZh = localeId === 3 || localeId === 7;
  let out = html;
  // Replace second <th> header label
  if (isZh) {
    out = out.replace(/(<th[^>]*><strong>)奖励(<\/strong><\/th>)/, '$1最高红利金额$2');
  } else {
    out = out.replace(/(<th[^>]*><strong>)Bonus Percentage(<\/strong><\/th>)/, '$1Max Bonus$2');
  }
  // Find the first <tbody>…</tbody>, replace its 2 <td> cells with current values.
  out = out.replace(/(<tbody>\s*<tr>\s*<td[^>]*>)[^<]*(<\/td>\s*<td[^>]*>)[^<]*(<\/td>\s*<\/tr>\s*<\/tbody>)/,
    `$1${ccy} ${minDep}$2${ccy} ${maxBonus}$3`);
  return out;
}

const SUBJECT_BY_LOCALE = { 1: 'Exclusive Offer', 3: '独家优惠', 6: 'Exclusive Offer', 7: '独家优惠' };

async function patchTemplate(site, templateId, rec) {
  const res = await authedFetch(site, `/api/bo/messagetemplate/${templateId}`);
  const mt = res.data.message_template;
  const md = res.data.message_details || {};
  const minDep = Number(rec.parsed?.min_deposit || 0);
  const maxBonus = Number(rec.parsed?.max_bonus || 0);

  const details = {};
  for (const k of Object.keys(md)) {
    const m = md[k];
    const localeId = m.settings_locale_id;
    details[String(localeId)] = {
      settings_locale_id: localeId,
      subject: SUBJECT_BY_LOCALE[localeId] || m.subject,
      message: patchTable(m.message || '', { localeId, minDep, maxBonus }),
    };
  }
  const body = { id: templateId, name: mt.name, section: mt.section, type: mt.type, status: mt.status, code: mt.code, details };
  await authedFetch(site, `/api/bo/messagetemplate/${templateId}`, { method: 'PUT', body });
}

const targets = [
  { siteId: 'qpro4', promoIds: [353,354,355,356,357,358,359,360,361,362,363,364,365,366,367,368] },
  { siteId: 'ibc22', promoIds: [1182,1183,1184,1185,1186,1187,1189,1190,1191,1192,1193,1194,1195,1196,1197,1198] },
];

for (const { siteId, promoIds } of targets) {
  const site = getSite(siteId);
  // promoId → templateId comes from the promotion detail
  for (const promoId of promoIds) {
    try {
      const det = (await authedFetch(site, `/api/bo/promotion/${promoId}`)).data.rows;
      const tmplId = det.message_template_id;
      if (!tmplId) { console.log(`${siteId} promo=${promoId} no template`); continue; }
      const handle = PROMO_HANDLE_BY_CODE.get(det.code);
      const rec = handle ? byHandle.get(handle) : null;
      if (!rec) { console.log(`${siteId} promo=${promoId} code=${det.code} fixture not found`); continue; }
      await patchTemplate(site, tmplId, rec);
      console.log(`${siteId} promo=${promoId} code=${det.code} tmpl=${tmplId} ✓`);
    } catch (e) {
      console.log(`${siteId} promo=${promoId} ✗ ${e.message.split('\n')[0]}`);
    }
  }
}

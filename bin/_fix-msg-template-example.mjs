// Patch the "Bonus Condition Example" calculation block in P075-P096
// message templates: drop the percentage label, use max_bonus as the bonus
// amount, recompute total + turnover. Per-locale currency (RM for MY, S$ for SG).

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';
import { loadAllRequests } from '../src/planner.js';

const { byHandle } = await loadAllRequests();
const PROMO_HANDLE_BY_CODE = new Map();
for (const [handle, rec] of byHandle.entries()) {
  if (rec.promo_code) PROMO_HANDLE_BY_CODE.set(rec.promo_code, handle);
}

const CCY_BY_LOCALE = { 1: 'MYR', 3: 'MYR', 6: 'S$', 7: 'S$' };

// Format a number with thousands separator + no decimals.
function fmt(n) { return Number(n).toLocaleString('en-US'); }

function exampleBlockEn({ ccy, minDep, maxBonus, turnover }) {
  const total = minDep + maxBonus;
  const tovReq = total * turnover;
  return `<ul>
  <li>Deposit [${ccy} ${fmt(minDep)} &amp; above]</li>
  <li>Bonus amount = ${ccy} ${fmt(maxBonus)}</li>
  <li>Total received amount [${ccy} ${fmt(minDep)} + ${ccy} ${fmt(maxBonus)}] = ${ccy} ${fmt(total)}</li>
  <li>Turnover requirement [${ccy} ${fmt(total)} x ${turnover}] = ${ccy} ${fmt(tovReq)}</li>
</ul>`;
}

function exampleBlockZh({ ccy, minDep, maxBonus, turnover }) {
  const total = minDep + maxBonus;
  const tovReq = total * turnover;
  return `<ul>
  <li>存款 [${ccy} ${fmt(minDep)} 或以上]</li>
  <li>奖金 = ${ccy} ${fmt(maxBonus)}</li>
  <li>存款 + 奖金 [${ccy} ${fmt(minDep)} + ${ccy} ${fmt(maxBonus)}] = ${ccy} ${fmt(total)}</li>
  <li>流水量需求 [${ccy} ${fmt(total)} x ${turnover}] = ${ccy} ${fmt(tovReq)}</li>
</ul>`;
}

function patchExample(html, { localeId, minDep, maxBonus, turnover }) {
  const ccy = CCY_BY_LOCALE[localeId];
  const isZh = localeId === 3 || localeId === 7;
  const newBlock = (isZh ? exampleBlockZh : exampleBlockEn)({ ccy, minDep, maxBonus, turnover });
  // Replace the <ul>...</ul> immediately after the "Bonus Condition Example" / "奖金计算示例" header.
  const headerRe = isZh
    ? /(<p><strong>奖金计算示例<\/strong><\/p>\s*)<ul>[\s\S]*?<\/ul>/
    : /(<p><strong>Bonus Condition Example<\/strong><\/p>\s*)<ul>[\s\S]*?<\/ul>/;
  return html.replace(headerRe, `$1${newBlock}`);
}

async function patchTemplate(site, templateId, rec) {
  const res = await authedFetch(site, `/api/bo/messagetemplate/${templateId}`);
  const mt = res.data.message_template;
  const md = res.data.message_details || {};
  const minDep = Number(rec.parsed?.min_deposit || 0);
  const maxBonus = Number(rec.parsed?.max_bonus || 0);
  const turnover = Number(rec.parsed?.to_multiplier || 1);

  const details = {};
  for (const k of Object.keys(md)) {
    const m = md[k];
    const localeId = m.settings_locale_id;
    details[String(localeId)] = {
      settings_locale_id: localeId,
      subject: m.subject,
      message: patchExample(m.message || '', { localeId, minDep, maxBonus, turnover }),
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

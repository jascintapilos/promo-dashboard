// Re-patch QP2C T&C item to the operator's canonical format:
//   EN: General :merchantname <a target="_blank" href=":url/terms-conditions">Terms and Conditions</a> apply.
//   ZH: 适用 :merchantname 一般<a target="_blank" href=":url/terms-conditions">条款与条件</a>。
// Drop the `?lang=<LOCALE>` param from earlier attempt. Keep Title Case "Terms and Conditions" (not lowercase).

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

function rebuildTncLi(localeId) {
  const isZh = localeId === 3 || localeId === 7;
  if (isZh) {
    return `<li>适用 :merchantname 一般<a target="_blank" href=":url/terms-conditions">条款与条件</a>。</li>`;
  }
  return `<li>General :merchantname <a target="_blank" href=":url/terms-conditions">Terms and Conditions</a> apply.</li>`;
}

// Replace the existing T&C item (in any of its forms — plain text, hyperlinked, etc.)
function patchTncLi(html, localeId) {
  const isZh = localeId === 3 || localeId === 7;
  const newLi = rebuildTncLi(localeId);
  if (isZh) {
    return html.replace(
      /<li>\s*适用\s*:(?:brand|merchant)name\s*一般[^<]*(?:条款|<a[\s\S]*?<\/a>)[^<]*<\/li>/,
      newLi,
    );
  }
  return html.replace(
    /<li>\s*General\s*:(?:brand|merchant)name\s*(?:Terms\s+and\s+Conditions|<a[\s\S]*?<\/a>)[^<]*<\/li>/i,
    newLi,
  );
}

async function patchTemplate(site, templateId) {
  const res = await authedFetch(site, `/api/bo/messagetemplate/${templateId}`);
  const mt = res.data.message_template;
  const md = res.data.message_details || {};
  const details = {};
  for (const k of Object.keys(md)) {
    const m = md[k];
    const localeId = m.settings_locale_id;
    details[String(localeId)] = {
      settings_locale_id: localeId,
      subject: m.subject,
      message: patchTncLi(m.message || '', localeId),
    };
  }
  const body = { id: templateId, name: mt.name, section: mt.section, type: mt.type, status: mt.status, code: mt.code, details };
  await authedFetch(site, `/api/bo/messagetemplate/${templateId}`, { method: 'PUT', body });
}

const site = getSite('ibc22');
const promoIds = [1182,1183,1184,1185,1186,1187,1189,1190,1191,1192,1193,1194,1195,1196,1197,1198];

for (const promoId of promoIds) {
  try {
    const det = (await authedFetch(site, `/api/bo/promotion/${promoId}`)).data.rows;
    const tmplId = det.message_template_id;
    if (!tmplId) { console.log(`promo=${promoId} no template`); continue; }
    await patchTemplate(site, tmplId);
    console.log(`promo=${promoId} code=${det.code} tmpl=${tmplId} ✓`);
  } catch (e) {
    console.log(`promo=${promoId} ✗ ${e.message.split('\n')[0]}`);
  }
}

// Hyperlink "Terms and Conditions" / "条款与条件" in T&C item 8 of every
// P075-P096 message template across QPRO4 + QP2C.
//
// Format per Directory (gid=1983898038):
//   QPRO4 (YE55): https://ye55my.com/<lang>-my/info-center/terms-and-conditions
//                 NO target="_blank"
//   QP2 (ACE66/IBC22): :url/terms-conditions?lang=<LOCALE_CODE>
//                 target="_blank"
//
// Per-locale path/lang code:
//   locale_id 1 (MY_EN) → en-my/  / lang=MY_EN
//   locale_id 3 (MY_ZH) → zh-my/  / lang=MY_ZH
//   locale_id 6 (SG_EN) → en-my/  / lang=SG_EN   (QPRO has no /en-sg/ subdomain)
//   locale_id 7 (SG_ZH) → zh-my/  / lang=SG_ZH

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

// QPRO brand → website domain map (from Directory).
const QPRO_DOMAIN = { qpro4: 'https://ye55my.com' };

const LOCALE_PATH = { 1: 'en-my', 3: 'zh-my', 6: 'en-my', 7: 'zh-my' };
const LOCALE_LANG = { 1: 'MY_EN', 3: 'MY_ZH', 6: 'SG_EN', 7: 'SG_ZH' };

function qproTnCAnchor(domain, localeId) {
  const path = LOCALE_PATH[localeId];
  return `https://${domain.replace(/^https?:\/\//, '')}/${path}/info-center/terms-and-conditions`;
}

function qp2TnCAnchor(localeId) {
  return `:url/terms-conditions?lang=${LOCALE_LANG[localeId]}`;
}

// Build the replacement <li> line per locale + platform.
function rebuildTncLi(platform, siteId, localeId) {
  const isZh = localeId === 3 || localeId === 7;
  if (platform === 'qpro') {
    const href = qproTnCAnchor(QPRO_DOMAIN[siteId], localeId);
    if (isZh) {
      return `<li>适用 :brandname 一般<a href="${href}">条款与条件</a>。</li>`;
    }
    return `<li>General :brandname <a href="${href}">terms and conditions</a> apply.</li>`;
  }
  // qp2
  const href = qp2TnCAnchor(localeId);
  if (isZh) {
    return `<li>适用 :merchantname 一般<a target="_blank" href="${href}">条款与条件</a>。</li>`;
  }
  return `<li>General :merchantname <a target="_blank" href="${href}">terms and conditions</a> apply.</li>`;
}

// Replace the last <li> in the <ol> T&C list with the hyperlinked version.
// The current shape (from existing templates) ends with one of:
//   EN: "<li>General :brandname Terms and Conditions apply.</li>"
//   ZH: "<li>适用 :brandname 一般条款与条件。</li>"
// We match these patterns specifically so other <li>s aren't touched.
function patchTncLi(html, platform, siteId, localeId) {
  const isZh = localeId === 3 || localeId === 7;
  const newLi = rebuildTncLi(platform, siteId, localeId);
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

async function patchTemplate(site, templateId, platform, siteId) {
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
      message: patchTncLi(m.message || '', platform, siteId, localeId),
    };
  }
  const body = { id: templateId, name: mt.name, section: mt.section, type: mt.type, status: mt.status, code: mt.code, details };
  await authedFetch(site, `/api/bo/messagetemplate/${templateId}`, { method: 'PUT', body });
}

const targets = [
  { platform: 'qpro', siteId: 'qpro4', promoIds: [353,354,355,356,357,358,359,360,361,362,363,364,365,366,367,368] },
  { platform: 'qp2',  siteId: 'ibc22', promoIds: [1182,1183,1184,1185,1186,1187,1189,1190,1191,1192,1193,1194,1195,1196,1197,1198] },
];

for (const { platform, siteId, promoIds } of targets) {
  const site = getSite(siteId);
  for (const promoId of promoIds) {
    try {
      const det = (await authedFetch(site, `/api/bo/promotion/${promoId}`)).data.rows;
      const tmplId = det.message_template_id;
      if (!tmplId) { console.log(`${siteId} promo=${promoId} no template`); continue; }
      await patchTemplate(site, tmplId, platform, siteId);
      console.log(`${siteId} promo=${promoId} code=${det.code} tmpl=${tmplId} ✓`);
    } catch (e) {
      console.log(`${siteId} promo=${promoId} ✗ ${e.message.split('\n')[0]}`);
    }
  }
}

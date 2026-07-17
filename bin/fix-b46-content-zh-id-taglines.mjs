// B46/BP9 (qpro1) content id=198 — second content-splitting defect, same root
// cause as the MY_EN fix (fix-b46-content-and-idlocale.mjs) but a different
// manifestation: MY_ZH (3) and ID_ID (9) have the title + tagline duplicated
// as the first two lines of `content` (as "<strong>title</strong><br><br>
// tagline<br><br>body...") while `description` holds a wrong fallback (a copy
// of the title). Title itself is already correct in its own field — leave it.
//
// Fix: extract the tagline from content, decodeEntities() it into
// `description` (title/description must be decoded per
// memory/feedback_promo_content_title_desc_decode.md — content must NOT be
// decoded), and set `content` to the remaining body only.

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const DRY_RUN = !process.argv.includes('--commit');
const SITE_ID = 'qpro1';
const CONTENT_ID = 198;
const SERVER_FIELDS = new Set(['id', 'promotion_content_id', 'settings_locale_code', 'created_at', 'updated_at']);
const TARGET_LOCALES = ['3', '9'];

function decodeEntities(str) {
  return (str || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
    .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
    .replace(/&rsquo;/g, '’').replace(/&ldquo;/g, '“').replace(/&rdquo;/g, '”');
}

const site = getSite(SITE_ID);
console.log(`[fix-b46-zh-id] mode=${DRY_RUN ? 'DRY-RUN' : 'COMMIT'}\n`);

const contentRes = await authedFetch(site, `/api/bo/promotioncontent/${CONTENT_ID}`);
const content = contentRes?.data?.content;
const details = JSON.parse(JSON.stringify(contentRes?.data?.details || {}));

if (!content || !details['3'] || !details['9']) {
  throw new Error('Unexpected content shape — aborting before any write.');
}

for (const locId of TARGET_LOCALES) {
  const d = details[locId];
  console.log(`── locale ${locId} (${d.settings_locale_code}) ──`);
  const m = (d.content || '').match(/^<strong>([\s\S]*?)<\/strong><br><br>([\s\S]*?)<br><br>([\s\S]*)$/);
  if (!m) {
    console.log('  NO MATCH — leaving untouched. content starts:', JSON.stringify((d.content || '').slice(0, 150)));
    continue;
  }
  const [, titleInContent, taglineRaw, remainingBody] = m;
  const newDescription = decodeEntities(taglineRaw);

  console.log('  title (unchanged):', JSON.stringify(d.title));
  console.log('  description BEFORE:', JSON.stringify(d.description));
  console.log('  description AFTER: ', JSON.stringify(newDescription));
  console.log('  content BEFORE (first 90):', JSON.stringify(d.content.slice(0, 90)));
  console.log('  content AFTER  (first 90):', JSON.stringify(remainingBody.slice(0, 90)));

  d.description = newDescription;
  d.content = remainingBody;
}

function cleanDetails(det) {
  const out = {};
  for (const [k, d] of Object.entries(det)) {
    if (!d) { out[k] = d; continue; }
    out[k] = Object.fromEntries(Object.entries(d).filter(([f]) => !SERVER_FIELDS.has(f)));
  }
  return out;
}

const categoryObj = Object.fromEntries((content.category_id || []).map((id, i) => [String(i), id]));
const contentTypeObj = Object.fromEntries((content.content_type || []).map((t) => [String(t), true]));
const contentPutBody = {
  code: content.code,
  category_id: categoryObj,
  content_type: contentTypeObj,
  member_visibility: content.member_visibility,
  position: content.position,
  apply_action: content.apply_action,
  allow_apply: content.allow_apply,
  status: content.status,
  max_application: content.max_application,
  details: cleanDetails(details),
};

console.log('\n--- PUT BODY locales:', Object.keys(contentPutBody.details).join(', '), '---');

if (!DRY_RUN) {
  const r = await authedFetch(site, `/api/bo/promotioncontent/${CONTENT_ID}`, { method: 'PUT', body: contentPutBody });
  console.log('PUT result:', JSON.stringify(r?.message || r?.success || r).slice(0, 300));
} else {
  console.log('[DRY-RUN] would PUT now — no write performed.');
}

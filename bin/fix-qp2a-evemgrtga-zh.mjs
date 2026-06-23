#!/usr/bin/env node
// Fix QP2A EVEMGRTGA (id=210) MY_ZH locale — three issues in one PUT:
//
//  1. title stored as HTML entities (&#33635;…) → decode to Unicode (MICROGAMING 荣耀之路)
//  2. description stored as HTML entities → decode to Unicode
//  3. content body: HTML entities + ZH T&C (pt 12) not hyperlinked
//     Plain:  :merchantname 一般条款与条件同样适用。
//     Target: :merchantname 一般<a target="_blank"
//               href="https://ibc22myr.com/terms-conditions?lang=MY_ZH">条款与条件</a>同样适用。
//
// Reference: EVEMGRTGB (id=206) ZH locale — title/desc/T&C all correct there.
//
// Run:      node bin/fix-qp2a-evemgrtga-zh.mjs
// Dry-run:  node bin/fix-qp2a-evemgrtga-zh.mjs --dry-run

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const DRY_RUN = process.argv.includes('--dry-run');
const delay   = (ms) => new Promise((r) => setTimeout(r, ms));

const SITE_ID    = 'ibc22';
const CONTENT_ID = 210;
const TC_DOMAIN  = 'https://ibc22myr.com';

function decodeHtmlEntities(str) {
  return str
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&amp;/gi,  '&')
    .replace(/&lt;/gi,   '<')
    .replace(/&gt;/gi,   '>')
    .replace(/&quot;/gi, '"')
    .replace(/&nbsp;/g,  ' ');
}

// Inject QP2 ZH T&C hyperlink (target="_blank", ?lang=MY_ZH, Chinese link text)
function fixZhTnC(content) {
  const link = `<a target="_blank" href="${TC_DOMAIN}/terms-conditions?lang=MY_ZH">条款与条件</a>`;
  return content.replace(
    /:merchantname\s+一般(?:<a[^>]*>条款与条件<\/a>|条款与条件)同样适用/g,
    `:merchantname 一般${link}同样适用`,
  );
}

console.log(`[fix-qp2a-evemgrtga-zh]  id=${CONTENT_ID}  site=${SITE_ID}  dry-run=${DRY_RUN}\n`);

const site = getSite(SITE_ID);

const detail  = await authedFetch(site, `/api/bo/promotioncontent/${CONTENT_ID}`);
const content = detail?.data?.content;
const details = JSON.parse(JSON.stringify(detail?.data?.details || {}));

const locRes    = await authedFetch(site, '/api/bo/locale?perPage=100');
const localeMap = Object.fromEntries((locRes?.data?.rows || []).map(r => [r.code, r.id]));
const ZH_ID     = String(localeMap['MY_ZH'] || 3);

const d = details[ZH_ID];
if (!d) { console.error('MY_ZH locale not found'); process.exit(1); }

// ── 1 & 2: Title + Description — decode HTML entities ────────────────────────
const titleBefore = d.title;
const descBefore  = d.description;
d.title       = decodeHtmlEntities(d.title || '');
d.description = decodeHtmlEntities(d.description || '');
console.log(`title:  "${titleBefore}"`);
console.log(`     →  "${d.title}"`);
console.log(`desc:   "${descBefore}"`);
console.log(`     →  "${d.description}"`);

// ── 3: Content — decode entities + inject ZH T&C link ────────────────────────
const decoded  = decodeHtmlEntities(d.content || '');
const fixed    = fixZhTnC(decoded);

const tnc_before = decoded.includes('一般条款与条件同样适用') && !decoded.includes('一般<a');
const tnc_after  = fixed.includes('一般<a');
console.log(`\ncontent: decode HTML entities + ZH T&C inject`);
console.log(`  T&C was plain: ${tnc_before}  →  linked: ${tnc_after}`);

d.content = fixed;

if (DRY_RUN) {
  console.log('\n[DRY-RUN] would PUT — no changes made.');
  process.exit(0);
}

// ── Build PUT body (QP2 requires site_id) ─────────────────────────────────────
const SERVER_FIELDS  = new Set(['id', 'promotion_content_id', 'settings_locale_code', 'created_at', 'updated_at']);
const categoryObj    = Object.fromEntries((content.category_id  || []).map((id, i) => [String(i), id]));
const contentTypeObj = Object.fromEntries((content.content_type || []).map(t        => [String(t), true]));

const cleanDetails = {};
for (const [k, det] of Object.entries(details)) {
  if (!det) { cleanDetails[k] = det; continue; }
  cleanDetails[k] = Object.fromEntries(Object.entries(det).filter(([f]) => !SERVER_FIELDS.has(f)));
}

const putBody = {
  site_id:           1,
  code:              content.code,
  category_id:       categoryObj,
  content_type:      contentTypeObj,
  member_visibility: content.member_visibility,
  position:          content.position,
  apply_action:      content.apply_action,
  allow_apply:       content.allow_apply,
  status:            content.status,
  max_application:   content.max_application,
  details:           cleanDetails,
};

await delay(1500);
const putRes = await authedFetch(site, `/api/bo/promotioncontent/${CONTENT_ID}`, { method: 'PUT', body: putBody });
const ok = putRes?.success !== false;
console.log(`\nPUT ${ok ? '✅ OK' : '❌ FAILED'} — ${JSON.stringify(putRes?.message || '')}`);

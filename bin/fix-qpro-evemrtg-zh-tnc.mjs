#!/usr/bin/env node
// Fix EVEMRTG MY_ZH T&C hyperlink on qpro15/16/17.
//
// The ZH Drive doc has the T&C in Chinese (not the English pattern matched by
// fix-qpro-evemrtg-tnc.mjs), so the earlier T&C fix left ZH un-hyperlinked.
//
// Stored plain text (after HTML-entity decode):
//   :brandname 一般条款与条件同样适用。
//
// Target (QPRO ZH format — /zh-my/ path, no target="_blank"):
//   :brandname 一般<a href="{domain}/zh-my/info-center/terms-and-conditions">条款与条件</a>同样适用。
//
// Run:      node bin/fix-qpro-evemrtg-zh-tnc.mjs
// Dry-run:  node bin/fix-qpro-evemrtg-zh-tnc.mjs --dry-run

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const DRY_RUN = process.argv.includes('--dry-run');
const delay   = (ms) => new Promise((r) => setTimeout(r, ms));

const JOBS = [
  { siteId: 'qpro15', contentId: 53, tcDomain: 'https://e688my.com'  },
  { siteId: 'qpro16', contentId: 53, tcDomain: 'https://ed98my.com'  },
  { siteId: 'qpro17', contentId: 52, tcDomain: 'https://xe38.com'    },
];

// Decode numeric HTML entities so Chinese text is matchable via regex
function decodeHtmlEntities(str) {
  return str
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi,  '<')
    .replace(/&gt;/gi,  '>')
    .replace(/&quot;/gi, '"')
    .replace(/&nbsp;/g,  ' ');
}

// Inject T&C hyperlink into ZH content.
// Matches both unlinked and already-wrong-domain forms.
function fixZhTnC(content, domain) {
  const link = `<a href="${domain}/zh-my/info-center/terms-and-conditions">条款与条件</a>`;
  // Match plain or already-hyperlinked (e.g. wrong domain) forms
  return content.replace(
    /:brandname\s+一般(?:<a[^>]*>条款与条件<\/a>|条款与条件)同样适用/g,
    `:brandname 一般${link}同样适用`,
  );
}

const SERVER_FIELDS = new Set(['id', 'promotion_content_id', 'settings_locale_code', 'created_at', 'updated_at']);

console.log(`[fix-qpro-evemrtg-zh-tnc]  dry-run=${DRY_RUN}\n`);

for (const { siteId, contentId, tcDomain } of JOBS) {
  const site = getSite(siteId);
  console.log(`── ${siteId}  content_id=${contentId}  domain=${tcDomain} ──`);

  const detail  = await authedFetch(site, `/api/bo/promotioncontent/${contentId}`);
  const content = detail?.data?.content;
  const details = JSON.parse(JSON.stringify(detail?.data?.details || {}));

  // Find MY_ZH locale id
  const locRes    = await authedFetch(site, '/api/bo/locale?perPage=100');
  const localeMap = Object.fromEntries((locRes?.data?.rows || []).map(r => [r.code, r.id]));
  const ZH_ID     = String(localeMap['MY_ZH'] || 3);

  const d = details[ZH_ID];
  if (!d?.content) {
    console.log(`  ZH locale (${ZH_ID}): no content — skip\n`);
    continue;
  }

  // Decode entities, apply fix, check
  const decoded = decodeHtmlEntities(d.content);
  const fixed   = fixZhTnC(decoded, tcDomain);

  if (fixed === decoded) {
    const hasLinked = /一般<a[^>]*>条款与条件<\/a>同样适用/.test(decoded);
    if (hasLinked) {
      console.log(`  ZH (${ZH_ID}): already hyperlinked — skip\n`);
    } else {
      console.log(`  ZH (${ZH_ID}): T&C pattern not found — skip\n`);
    }
    continue;
  }

  console.log(`  ZH (${ZH_ID}): T&C hyperlink injected`);
  details[ZH_ID].content = fixed;

  if (DRY_RUN) {
    console.log(`  [DRY-RUN] would PUT\n`);
    continue;
  }

  // Build PUT body (same shape as other QPRO fix scripts)
  const categoryObj    = Object.fromEntries((content.category_id  || []).map((id, i) => [String(i), id]));
  const contentTypeObj = Object.fromEntries((content.content_type || []).map(t        => [String(t), true]));

  const cleanDetails = {};
  for (const [k, det] of Object.entries(details)) {
    if (!det) { cleanDetails[k] = det; continue; }
    cleanDetails[k] = Object.fromEntries(Object.entries(det).filter(([f]) => !SERVER_FIELDS.has(f)));
  }

  const putBody = {
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
  const putRes = await authedFetch(site, `/api/bo/promotioncontent/${contentId}`, { method: 'PUT', body: putBody });
  const ok = putRes?.success !== false;
  console.log(`  PUT ${ok ? '✅ OK' : '❌ FAILED'} — ${JSON.stringify(putRes?.message || '')}\n`);
}

console.log('═══════════════════ DONE ═══════════════════');
if (DRY_RUN) console.log('  (dry-run — no changes made)');

#!/usr/bin/env node
// One-shot: inject the correct T&C hyperlink into EVEMRTG 3.3 Promotion Content
// on QPRO15 (E688), QPRO16 (ED98), QPRO17 (XE38).
//
// Problem: upload-promo.js uses fetchDocHtml on the Drive doc which has:
//   "General :brandname terms and conditions apply."  ← plain text, no hyperlink
//
// Target QPRO T&C format (confirmed from EVEMGLMPCR on each site):
//   General :brandname <a href="{domain}/en-my/info-center/terms-and-conditions">terms and conditions</a> apply.
//
// Domains extracted from existing content (EVEMGLMPCR T&C hrefs):
//   qpro15: https://e688my.com
//   qpro16: https://ed98my.com
//   qpro17: https://xe38.com
//
// Run:      node bin/fix-qpro-evemrtg-tnc.mjs
// Dry-run:  node bin/fix-qpro-evemrtg-tnc.mjs --dry-run

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const DRY_RUN = process.argv.includes('--dry-run');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const JOBS = [
  { siteId: 'qpro15', contentId: 53, tcDomain: 'https://e688my.com' },
  { siteId: 'qpro16', contentId: 53, tcDomain: 'https://ed98my.com' },
  { siteId: 'qpro17', contentId: 52, tcDomain: 'https://xe38.com'   },
];

// QPRO T&C format: no target="_blank", same URL for all locales
// Handles:
//   • plain text:    General :brandname terms and conditions apply.
//   • wrong domain:  General :brandname <a href="other.com/...">terms and conditions</a> apply.
function fixTnC(content, domain) {
  const link = `<a href="${domain}/en-my/info-center/terms-and-conditions">terms and conditions</a>`;
  return content.replace(
    /General\s+:brandname\s+(?:<a[^>]*>terms and conditions<\/a>|terms and conditions)\s+apply\./gi,
    `General :brandname ${link} apply.`,
  );
}

// SERVER_FIELDS stripped before PUT (same rule as fix-b16-b17-content.mjs)
const SERVER_FIELDS = new Set(['id', 'promotion_content_id', 'settings_locale_code', 'created_at', 'updated_at']);

console.log(`[fix-qpro-evemrtg-tnc] dry-run=${DRY_RUN}\n`);

for (const { siteId, contentId, tcDomain } of JOBS) {
  const site = getSite(siteId);
  console.log(`── ${siteId}  EVEMRTG id=${contentId}  domain=${tcDomain} ──`);

  // GET full record
  const detail = await authedFetch(site, `/api/bo/promotioncontent/${contentId}`);
  const content = detail?.data?.content;
  const details = JSON.parse(JSON.stringify(detail?.data?.details || {}));

  let changed = 0;
  for (const [locId, d] of Object.entries(details)) {
    if (!d?.content) continue;
    const fixed = fixTnC(d.content, tcDomain);
    if (fixed !== d.content) {
      console.log(`  locale ${locId}: T&C injected`);
      details[locId].content = fixed;
      changed++;
    } else {
      // Check if T&C sentence is present at all (might already be linked, or absent in ZH)
      const hasPlain = /General\s+:brandname\s+terms and conditions\s+apply\./i.test(d.content);
      const hasLinked = /General\s+:brandname\s+<a[^>]*>terms and conditions<\/a>/i.test(d.content);
      if (hasLinked) {
        console.log(`  locale ${locId}: already hyperlinked — skip`);
      } else if (!hasPlain) {
        console.log(`  locale ${locId}: T&C sentence not found — skip`);
      }
    }
  }

  if (!changed) {
    console.log(`  nothing to update — skipping PUT\n`);
    continue;
  }

  // Build PUT body
  const categoryObj    = Object.fromEntries((content.category_id   || []).map((id, i) => [String(i), id]));
  const contentTypeObj = Object.fromEntries((content.content_type  || []).map((t)      => [String(t), true]));

  const cleanDetails = {};
  for (const [k, d] of Object.entries(details)) {
    if (!d) { cleanDetails[k] = d; continue; }
    cleanDetails[k] = Object.fromEntries(Object.entries(d).filter(([f]) => !SERVER_FIELDS.has(f)));
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

  if (DRY_RUN) {
    console.log(`  [DRY-RUN] would PUT /api/bo/promotioncontent/${contentId} (${changed} locale(s) patched)\n`);
    continue;
  }

  await delay(1500);
  const putRes = await authedFetch(site, `/api/bo/promotioncontent/${contentId}`, {
    method: 'PUT',
    body: putBody,
  });
  const ok = putRes?.success !== false;
  console.log(`  PUT ${ok ? '✅ OK' : '❌ FAILED'} — ${JSON.stringify(putRes?.message || '')}\n`);
}

console.log('═══════════════════ DONE ═══════════════════');
if (DRY_RUN) console.log('  (dry-run — no changes made)');

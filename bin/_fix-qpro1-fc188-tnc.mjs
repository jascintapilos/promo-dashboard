#!/usr/bin/env node
// One-off: push the corrected T&C hyperlink (real tncDomain instead of the
// broken :url-in-href placeholder) to the live QPRO1 FT_188FC_5X message
// template, so it can be re-tested against the live Inbox rendering.
// See feedback memory on the QPRO MT T&C anchor regression (2026-06-23 → fixed 2026-07-06).
//
// Usage: node bin/_fix-qpro1-fc188-tnc.mjs           # dry-run
//        node bin/_fix-qpro1-fc188-tnc.mjs --commit  # live PUT

import { readFile } from 'node:fs/promises';
import { getSite } from '../src/sites.js';
import { authedFetch, findPromotionByCode } from '../src/api-client.js';
import { buildApiPlan } from '../src/api-mapper-qpro.js';

const COMMIT = process.argv.includes('--commit');
const CODE = 'FT_188FC_5X';
const BRAND = 'QPRO1';
const SITE = getSite('qpro1');

console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`FIX — QPRO1 FC188 T&C anchor — ${COMMIT ? 'LIVE (--commit)' : 'DRY-RUN'}`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

const resolved = JSON.parse(await readFile('captures/requests/P014-r15.json', 'utf-8'));

const found = await findPromotionByCode(SITE, CODE);
if (!found) { console.log(`${BRAND}: NOT FOUND (code=${CODE})`); process.exit(1); }

const detail = await authedFetch(SITE, `/api/bo/promotion/${found.id}`);
const mtId = detail?.data?.rows?.message_template_id;
if (!mtId) { console.log(`${BRAND}: no message_template_id on promotion ${found.id}`); process.exit(1); }

const plan = await buildApiPlan(resolved, { brand: BRAND, site: SITE });
const mt = plan.messageTemplate;
if (!mt) { console.log(`${BRAND}: buildMessageTemplateBody returned null`); process.exit(1); }

console.log(`${BRAND} (promo=${found.id}, mt=${mtId}):`);
for (const [localeId, d] of Object.entries(mt.details)) {
  const tncLine = (d.message.match(/<li>[^<]*(?::brandname)[\s\S]*?<\/li>/i) || [])[0] || '(no T&C li found)';
  console.log(`  locale ${localeId} (${d.settings_locales_code || d.settings_locale_id}):`);
  console.log(`    ${tncLine}`);
  console.log(`    contains literal :url? ${d.message.includes(':url')}`);
}

if (!COMMIT) { console.log('\nRe-run with --commit to PUT this to the live template.'); process.exit(0); }

const putBody = { name: mt.name, section: mt.section, type: mt.type, status: mt.status, details: mt.details };
const res = await authedFetch(SITE, `/api/bo/messagetemplate/${mtId}`, { method: 'PUT', body: putBody });
const ok = res?.success !== false;
console.log(`\n→ PUT messagetemplate/${mtId}: ${ok ? '✅ OK' : '❌ ' + JSON.stringify(res).slice(0, 300)}`);

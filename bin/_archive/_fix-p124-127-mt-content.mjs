#!/usr/bin/env node
// Fix #3: FS message-template content defects on P124-P127 (QPRO1-4 + QP2A).
// Wrong subject line ("N Claim Your Free Spins Before They're Gone"), missing
// Bet Value table, and undecoded HTML entities (&amp;amp; / &amp;gt;).
//
// Strategy: regenerate the correct subject+body via buildApiPlan()'s own
// messageTemplate builder (same renderer used for fresh correct creates),
// then PUT that content to the EXISTING message_template_id — this is a
// content-only fix, does not touch promotion config, dialog, or anything
// else already corrected today.
//
// Usage: node bin/_fix-p124-127-mt-content.mjs           # dry-run (prints new subject + entity/table check)
//        node bin/_fix-p124-127-mt-content.mjs --commit  # live

import { readFile } from 'node:fs/promises';
import { getSite } from '../src/sites.js';
import { authedFetch, findPromotionByCode } from '../src/api-client.js';
import { buildApiPlan as buildApiPlanQpro } from '../src/api-mapper-qpro.js';
import { buildApiPlan as buildApiPlanQp2 } from '../src/api-mapper-qp2.js';

const COMMIT = process.argv.includes('--commit');
const handleFilterArg = process.argv.find(a => a.startsWith('--handle='));
const handleFilter = handleFilterArg ? handleFilterArg.split('=')[1].split(',') : null;

const TARGETS = [
  { handle: 'P124-r125', qpro1Code: 'REL_BASE_60FS_GOOSS_12X_V2B', sharedCode: 'REL_BASE_60FS_GOOSS_12X_V2' },
  { handle: 'P125-r126', qpro1Code: 'REL_BOOSTER_80FS_GOOSS_15X_V2', sharedCode: 'REL_BOOSTER_80FS_GOOSS_15X' },
  { handle: 'P126-r127', qpro1Code: 'RET_GOOSS_BASE_50FS_10X_V2', sharedCode: 'RET_GOOSS_BASE_50FS_10X' },
  { handle: 'P127-r128', qpro1Code: 'RET_GOOSS_BOOST_60FS_12X_V2', sharedCode: 'RET_GOOSS_BOOST_60FS_12X' },
];

const QPRO_BRANDS = [
  { brand: 'QPRO1', site: 'qpro1' },
  { brand: 'QPRO2', site: 'qpro2' },
  { brand: 'QPRO3', site: 'qpro3' },
  { brand: 'QPRO4', site: 'qpro4' },
];

function decodeCheck(html) {
  const bad = ['&amp;amp;', '&amp;gt;', '&amp;lt;', '&amp;mdash;', '&amp;rsquo;', '&amp;nbsp;'];
  return bad.filter(b => html.includes(b));
}

console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`FIX #3 — FS MT CONTENT (P124-P127, QPRO1-4 + QP2A) — ${COMMIT ? 'LIVE (--commit)' : 'DRY-RUN'}`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

const filteredTargets = handleFilter ? TARGETS.filter(t => handleFilter.includes(t.handle)) : TARGETS;
const results = [];

async function fixOne({ handle, brand, site, code, resolved, buildPlan, merchantOpts }) {
  const found = await findPromotionByCode(site, code, merchantOpts || {});
  if (!found) { console.log(`  ${brand}: NOT FOUND (code=${code})`); results.push({ handle, brand, ok: false }); return; }

  const detail = await authedFetch(site, `/api/bo/promotion/${found.id}`);
  const mtId = detail?.data?.rows?.message_template_id;
  if (!mtId) { console.log(`  ${brand}: no message_template_id on promotion ${found.id}`); results.push({ handle, brand, ok: false }); return; }

  const plan = await buildPlan(resolved, { brand, site });
  const mt = plan.messageTemplate;
  if (!mt) { console.log(`  ${brand}: buildMessageTemplateBody returned null`); results.push({ handle, brand, ok: false }); return; }

  const enDetail = Object.values(mt.details).find(d => d.settings_locale_id === 6 || d.settings_locale_id === 1) || Object.values(mt.details)[0];
  const hasBetValue = Object.values(mt.details).some(d => /Bet Value/i.test(d.message));
  const badEntities = decodeCheck(JSON.stringify(mt.details));
  console.log(`  ${brand} (promo=${found.id}, mt=${mtId}):`);
  console.log(`    new subject: "${enDetail?.subject}"`);
  console.log(`    has Bet Value table: ${hasBetValue}`);
  console.log(`    raw entities remaining: ${badEntities.length ? badEntities.join(', ') : 'none'}`);

  if (!COMMIT) { results.push({ handle, brand, ok: true, dry: true }); return; }

  try {
    const putBody = { name: mt.name, section: mt.section, type: mt.type, status: mt.status, details: mt.details };
    const res = await authedFetch(site, `/api/bo/messagetemplate/${mtId}`, { method: 'PUT', body: putBody });
    const ok = res?.success !== false;
    console.log(`    → PUT messagetemplate/${mtId}: ${ok ? '✅ OK' : '❌ ' + JSON.stringify(res).slice(0,250)}`);
    results.push({ handle, brand, ok });
  } catch (e) {
    console.log(`    → PUT: ❌ ${e.message.split('\n')[0].slice(0,300)}`);
    results.push({ handle, brand, ok: false, err: e.message });
  }
}

for (const t of filteredTargets) {
  const resolved = JSON.parse(await readFile(`captures/requests/${t.handle}.json`, 'utf-8'));
  console.log(`\n══ ${t.handle} ══`);

  for (const qb of QPRO_BRANDS) {
    const code = qb.brand === 'QPRO1' ? t.qpro1Code : t.sharedCode;
    await fixOne({ handle: t.handle, brand: qb.brand, site: getSite(qb.site), code, resolved, buildPlan: buildApiPlanQpro });
  }
  await fixOne({ handle: t.handle, brand: 'QP2A', site: getSite('ibc22'), code: t.sharedCode, resolved, buildPlan: buildApiPlanQp2, merchantOpts: { merchantId: 1 } });
}

console.log(`\n\nSummary: ${results.filter(r=>r.ok).length}/${results.length} ${COMMIT ? 'fixed' : 'would fix'}`);
if (!COMMIT) console.log('Re-run with --commit to apply. Use --handle=P124-r125 to test a single handle first.');

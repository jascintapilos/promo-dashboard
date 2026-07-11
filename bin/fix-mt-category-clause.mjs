// Remove the inaccurate "except Blackjack and Virtual Sports" clause from QPRO9
// MT templates for P176-P179. The clause (original item 5) contradicts the live
// promo config which has no category restriction set (categories_only=null).
//
// Usage:
//   node bin/fix-mt-category-clause.mjs [--dry-run]

import { parseArgs } from './_args.js';
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const { flags } = parseArgs(process.argv.slice(2));
const dryRun = flags['dry-run'] === true;

const SITE_NAME = 'qpro9';
const site = getSite(SITE_NAME);

// QPRO9 templates for P176-P179 (FC88/FC118/FC138/FC148)
const TEMPLATES = [
  { handle: 'P176-r62', templateId: 518 },
  { handle: 'P177-r63', templateId: 519 },
  { handle: 'P178-r64', templateId: 520 },
  { handle: 'P179-r65', templateId: 521 },
];

// Clause 5 text that must be removed (EN and ZH variants).
const EN_CLAUSE = '<li>All game categories are eligible for this promotion except Blackjack and Virtual Sports.</li>';
const ZH_CLAUSE = '<li>除了 二十一点和虚拟体育 外，所有游戏类别均适用于此优惠活动。</li>';

function removeClause(html) {
  // Strip the clause item including any surrounding whitespace/newlines within the list.
  return html
    .replace(/\s*<li>All game categories are eligible for this promotion except Blackjack and Virtual Sports\.<\/li>/g, '')
    .replace(/\s*<li>除了 二十一点和虚拟体育 外，所有游戏类别均适用于此优惠活动。<\/li>/g, '');
}

let passed = 0, failed = 0;

for (const { handle, templateId } of TEMPLATES) {
  const label = `${handle} | QPRO9 | template ${templateId}`;

  // GET current template state.
  const getResp = await authedFetch(site, `/api/bo/messagetemplate/${templateId}`);
  const mt   = getResp?.data?.message_template;
  const dets = getResp?.data?.message_details;

  if (!mt || !dets) {
    console.error(`  ✗ ${label} — GET returned unexpected shape`);
    failed++;
    continue;
  }

  // Build corrected details object — process all locales.
  const details = {};
  let clauseFound = false;
  for (const [localeId, det] of Object.entries(dets)) {
    const original = det.message;
    const fixed = removeClause(original);
    if (fixed !== original) clauseFound = true;
    details[localeId] = {
      settings_locale_id: det.settings_locale_id,
      subject:            det.subject,
      message:            fixed,
    };
  }

  if (!clauseFound) {
    console.log(`  ✓ ${label} — clause not found, no change needed`);
    passed++;
    continue;
  }

  if (dryRun) {
    console.log(`DRY-RUN: ${label} — would remove clause from ${Object.keys(details).length} locales`);
    continue;
  }

  // PUT corrected template.
  const putBody = {
    name:    mt.name,
    section: mt.section,
    type:    mt.type,
    status:  mt.status,
    details,
  };

  try {
    const putResp = await authedFetch(site, `/api/bo/messagetemplate/${templateId}`, {
      method: 'PUT',
      body:   putBody,
    });
    if (!putResp?.success) throw new Error(JSON.stringify(putResp));
  } catch (err) {
    console.error(`  ✗ ${label} — PUT error: ${err.message}`);
    failed++;
    continue;
  }

  // Verify by re-fetching and checking the clause is gone.
  const verifyResp = await authedFetch(site, `/api/bo/messagetemplate/${templateId}`);
  const verifyDets = verifyResp?.message_details || {};
  const stillPresent = Object.values(verifyDets).some(
    d => d.message && (d.message.includes('Blackjack') || d.message.includes('二十一点'))
  );

  if (stillPresent) {
    console.error(`  ✗ ${label} — clause still present after PUT`);
    failed++;
  } else {
    console.log(`  ✓ ${label} — clause removed and verified`);
    passed++;
  }
}

if (!dryRun) console.log(`\nDone: ${passed} fixed/ok, ${failed} failed`);

#!/usr/bin/env node
// Fix TLEO T&C category clause in inbox message templates across QPRO + QP2.
//
// Three cases identified by QC:
//   wrong   — clause present but says "Slot only" / "Slots" for an all-games or LC code
//   missing — QC regex missed it (Format B "All game categories are eligible..." for LC codes)
//   no-MT   — no message template at all (1 case on QP2 — skip)
//
// Code detection:
//   _LC_ or _LC suffix → LC only
//   _SL_ or _SLOT suffix → Slots only (already correct per QC — leave alone)
//   otherwise → all-games
//
// Correct EN clause per category:
//   all  → "All game categories are eligible for this promotion, except for Blackjack and Virtual Sports."
//   lc   → "The eligible game categories for this promotion are Live Casino except for blackjack. "
//
// Correct ZH clause per category:
//   all  → "所有游戏类别均适用于此优惠，二十一点和虚拟体育除外。"
//   lc   → "本优惠仅适用于以下游戏类别：真人娱乐场 (Live Casino)。 除了二十一点。"

import { authedFetch } from '../src/api-client.js';
import { listSites, getSite } from '../src/sites.js';

// ── Category detection ───────────────────────────────────────────────────────

function catType(code) {
  if (/_LC_/.test(code) || /_LC$/.test(code)) return 'lc';
  if (/_SL_/.test(code) || /_SLOT$/.test(code)) return 'slots';
  return 'all';
}

// ── Correct clause texts ─────────────────────────────────────────────────────

const CORRECT_EN = {
  all:   'All game categories are eligible for this promotion, except for Blackjack and Virtual Sports.',
  lc:    'The eligible game categories for this promotion are Live Casino except for blackjack. ',
  slots: 'The eligible game categories for this promotion are Slots.',  // reference only — not changed
};

const CORRECT_ZH = {
  all:   '所有游戏类别均适用于此优惠，二十一点和虚拟体育除外。',
  lc:    '本优惠仅适用于以下游戏类别：真人娱乐场 (Live Casino)。 除了二十一点。',
  slots: '本优惠适用于以下游戏类别：老虎机。',  // reference only — not changed
};

// ── Patch helpers ────────────────────────────────────────────────────────────

// Returns true if this <li> text is the game-category clause (EN version)
function isEnCategoryClause(rawText) {
  const t = rawText.toLowerCase();
  return t.includes('eligible game categor') || t.includes('all game categories are eligible');
}

// Returns true if this <li> text is the game-category clause (ZH version)
function isZhCategoryClause(rawText) {
  return rawText.includes('老虎机') ||
         rawText.includes('真人娱乐场') ||
         rawText.includes('所有游戏类别') ||
         rawText.includes('除了 二十一点和虚拟体育') ||
         rawText.includes('除了二十一点和虚拟体育') ||
         rawText.includes('游戏类别均适用于此优惠');
}

// Determine if an EN clause needs replacing
function enNeedsReplace(rawText, catT) {
  const t = rawText.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').toLowerCase().trim();
  if (catT === 'lc')   return !t.includes('live casino');          // wrong if not LC
  if (catT === 'all')  return t.includes('slot') || t.includes('live casino');  // wrong if restricted
  return false; // slots — leave alone
}

// Determine if a ZH clause needs replacing
function zhNeedsReplace(rawText, catT) {
  const t = rawText.replace(/<[^>]+>/g, '').trim();
  if (catT === 'lc')   return !t.includes('真人娱乐场');    // wrong if not Live Casino ZH
  if (catT === 'all')  return t.includes('老虎机') || t.includes('真人娱乐场');  // wrong if restricted
  return false; // slots — leave alone
}

// Patch a single locale message HTML
function patchMessage(message, catT, isZh) {
  if (!message) return message;

  let changed = false;

  const patched = message.replace(/<li>([\s\S]*?)<\/li>/g, (match, inner) => {
    const rawText = inner.replace(/&nbsp;/g, ' ');

    if (isZh) {
      if (!isZhCategoryClause(rawText)) return match;
      if (!zhNeedsReplace(rawText, catT)) return match;
      changed = true;
      // Preserve trailing &nbsp;<br>&nbsp; if original had it
      const hasSuffix = inner.includes('&nbsp;<br>') || inner.includes('&nbsp;<br>&nbsp;');
      const suffix = hasSuffix ? '&nbsp;<br>&nbsp;' : '';
      return `<li>${CORRECT_ZH[catT]}${suffix}</li>`;
    } else {
      if (!isEnCategoryClause(rawText)) return match;
      if (!enNeedsReplace(rawText, catT)) return match;
      changed = true;
      const hasSuffix = inner.includes('&nbsp;<br>') || inner.includes('&nbsp;<br>&nbsp;');
      const suffix = hasSuffix ? '&nbsp;<br>&nbsp;' : '';
      return `<li>${CORRECT_EN[catT]}${suffix}</li>`;
    }
  });

  return { msg: patched, changed };
}

// ── Fetch helpers ────────────────────────────────────────────────────────────

async function fetchAllTleo(site) {
  let all = [], page = 1;
  while (true) {
    const res = await authedFetch(site, `/api/bo/promotion?code=FT_REL_TLEO&perPage=100&page=${page}`);
    const rows = res.data?.rows || [];
    all.push(...rows);
    if (rows.length < 100) break;
    page++;
  }
  return all;
}

async function getMt(site, mtId) {
  const res = await authedFetch(site, `/api/bo/messagetemplate/${mtId}`);
  return res.data;
}

async function putMt(site, mtId, body) {
  await authedFetch(site, `/api/bo/messagetemplate/${mtId}`, { method: 'PUT', body });
}

// ── Sites to process ─────────────────────────────────────────────────────────

const QPRO_IDS = ['qpro2', 'qpro3', 'qpro4', 'qpro6', 'qpro8', 'qpro10'];
const QP2_ID   = 'ibc22';

// ── Main ─────────────────────────────────────────────────────────────────────

let updated = 0, skipped = 0, errors = 0;

// Deduplicate templates per site — multiple promos can share the same mtId
const processedMtIds = new Set(); // reset per site

async function processSite(siteId, platform) {
  processedMtIds.clear();
  const site = getSite(siteId);
  const promos = await fetchAllTleo(site);
  process.stdout.write(`  ${promos.length} promos\n`);

  for (const promo of promos) {
    const catT = catType(promo.code);
    if (catT === 'slots') { skipped++; continue; } // slots already OK per QC

    if (!promo.message_template_id) {
      console.log(`  SKIP ${promo.code}: no message template`);
      skipped++;
      continue;
    }

    const mtId = promo.message_template_id;
    const dedupeKey = `${siteId}:${mtId}`;

    if (processedMtIds.has(dedupeKey)) {
      // Already processed this template for this site
      skipped++;
      continue;
    }
    processedMtIds.add(dedupeKey);

    try {
      const data = await getMt(site, mtId);
      const mt      = data.message_template;
      const details = data.message_details || {};

      const newDetails = {};
      let anyChanged = false;

      for (const [locKey, detail] of Object.entries(details)) {
        const locId = detail.settings_locale_id;
        const isZh  = locId === 3 || locId === 7;
        const { msg, changed } = patchMessage(detail.message, catT, isZh);
        newDetails[locKey] = {
          settings_locale_id: locId,
          subject:  detail.subject,
          message:  msg,
        };
        if (changed) anyChanged = true;
      }

      if (!anyChanged) {
        skipped++;
        continue;
      }

      const body = {
        id:      mtId,
        name:    mt.name,
        section: mt.section,
        type:    mt.type,
        status:  mt.status,
        code:    mt.code,
        details: newDetails,
      };

      await putMt(site, mtId, body);
      console.log(`  ✓ ${siteId} [${catT}] ${promo.code} mtId=${mtId}`);
      updated++;
    } catch (e) {
      console.error(`  ✗ ${siteId} ${promo.code} mtId=${mtId}: ${e.message.slice(0, 120)}`);
      errors++;
    }
  }
}

// ── QPRO ─────────────────────────────────────────────────────────────────────

for (const siteId of QPRO_IDS) {
  process.stdout.write(`\nProcessing ${siteId}...`);
  try {
    await processSite(siteId, 'QPRO');
  } catch (e) {
    console.error(`\n  ERR ${siteId}: ${e.message.slice(0, 80)}`);
  }
}

// ── QP2 ───────────────────────────────────────────────────────────────────────

process.stdout.write(`\nProcessing QP2 (${QP2_ID})...`);
try {
  await processSite(QP2_ID, 'QP2');
} catch (e) {
  console.error(`\n  ERR QP2: ${e.message.slice(0, 80)}`);
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(60)}`);
console.log(`Done: ${updated} templates updated, ${skipped} skipped, ${errors} errors`);

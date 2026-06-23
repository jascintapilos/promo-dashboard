#!/usr/bin/env node
// Add "QQPoker" to the T&C exclusion list of every 0.9% / Unlimited Cash
// Rebate promo content across QPRO + WS1 + WS2. Idempotent — skips records
// that already contain "QQPoker" in the exclusion section.
//
//   node bin/add-qqpoker-to-rebate-tnc.mjs                ← dry-run (default)
//   node bin/add-qqpoker-to-rebate-tnc.mjs --commit       ← apply
//   node bin/add-qqpoker-to-rebate-tnc.mjs --only=qpro    ← QPRO only
//   node bin/add-qqpoker-to-rebate-tnc.mjs --only=ws      ← WS1/WS2 only
//
// Required for WS1/WS2: BIA_PASSWORD env var.

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const COMMIT  = process.argv.includes('--commit');
const ONLY    = (process.argv.find(a => a.startsWith('--only=')) || '').replace('--only=', '');
const delay   = (ms) => new Promise((r) => setTimeout(r, ms));

// ── QPRO targets (siteId → 3.3 content id of EVEUCR) ────────────────────────
const QPRO_JOBS = [
  { siteId: 'qpro1',  contentId: 132, label: 'BP9'    },
  { siteId: 'qpro2',  contentId: 25,  label: '12HUAT' },
  { siteId: 'qpro3',  contentId: 26,  label: 'BX99'   },
  { siteId: 'qpro4',  contentId: 24,  label: 'YE55'   },
  { siteId: 'qpro5',  contentId: 25,  label: 'U388'   },
  { siteId: 'qpro6',  contentId: 25,  label: 'WYN8'   },
  { siteId: 'qpro7',  contentId: 25,  label: 'MBS66'  },
  { siteId: 'qpro8',  contentId: 25,  label: 'WILD33' },
  { siteId: 'qpro9',  contentId: 26,  label: 'MINT33' },
  { siteId: 'qpro10', contentId: 26,  label: 'UO8'    },
  { siteId: 'qpro12', contentId: 24,  label: 'SBO18'  },
  { siteId: 'qpro13', contentId: 19,  label: 'IBC7'   },
  { siteId: 'qpro15', contentId: 25,  label: 'E688'   },
  { siteId: 'qpro16', contentId: 25,  label: 'ED98'   },
  { siteId: 'qpro17', contentId: 25,  label: 'XE38'   },
];

// ── QP2 targets (4 merchants, Daily Cash Rebate 3.3 records) ──────────────
// QP2 BO uses /api/bo/promotioncontent with site_id in PUT body (= merchant id).
const QP2_JOBS = [
  { siteId: 'ibc22', merchantId: 1, contentId: 5,  label: 'IBC22'   },
  { siteId: 'ibc22', merchantId: 2, contentId: 26, label: 'KING333' },
  { siteId: 'ibc22', merchantId: 3, contentId: 27, label: 'ACE66'   },
  { siteId: 'ibc22', merchantId: 4, contentId: 56, label: 'SPADE66' },
];

// ── WS1/WS2 targets ─────────────────────────────────────────────────────────
const BIA_JOBS = [
  { siteId: 'ws1', host: 'https://cms.best-in-asia.com',     promoId: 8,   region: 'MYS' },
  { siteId: 'ws1', host: 'https://cms.best-in-asia.com',     promoId: 226, region: 'THA' },
  { siteId: 'ws1', host: 'https://cms.best-in-asia.com',     promoId: 185, region: 'SGP' },
  { siteId: 'ws1', host: 'https://cms.best-in-asia.com',     promoId: 216, region: 'KHM' },
  { siteId: 'ws1', host: 'https://cms.best-in-asia.com',     promoId: 195, region: 'IDN' },
  { siteId: 'ws2', host: 'https://ws2-cms.best-in-asia.com', promoId: 8,   region: 'MYS' },
];

// ── Patch functions ─────────────────────────────────────────────────────────
//
// QPRO pattern (all locales): existing list ends with "- 918KISS<br>".
// Add "&nbsp; &nbsp; - QQPoker<br>" right after it (before the blank <br><br>2).
function patchQproContent(content) {
  if (/QQPoker/i.test(content)) return { content, skipped: 'already-has-QQPoker' };
  const re = /(&nbsp; &nbsp; - 918KISS<br>)(?!&nbsp; &nbsp; - QQPoker)/;
  if (!re.test(content)) return { content, skipped: 'no-918KISS-anchor' };
  return { content: content.replace(re, '$1&nbsp; &nbsp; - QQPoker<br>'), skipped: null };
}

// WS1/WS2 dash-bullet pattern: insert before final </p> of the paragraph
// that contains the exclusion list (i.e., the paragraph holding item 1).
// The bullet uses 6 nbsp dashes matching the surrounding format.
function patchBiaDashList(content) {
  if (/QQPoker/i.test(content)) return { content, skipped: 'already-has-QQPoker' };
  // Anchor on the last existing dash-bullet exclusion entry; find its end-of-paragraph.
  // We accept any of MEGA888 | 918KAYA | 918KISS | JOKER | XE88 as the last item.
  const re = /(- (?:MEGA888|918KAYA|918KISS|JOKER|XE88)\s*<\/p>)/;
  if (!re.test(content)) return { content, skipped: 'no-bullet-anchor' };
  // The closing </p> position — splice BEFORE the </p>
  return {
    content: content.replace(re, (_, m) => {
      // m looks like "- 918KAYA</p>" — insert before the </p>
      const lastItem = m.replace(/<\/p>$/, '');
      return lastItem + '<br>&nbsp; &nbsp; &nbsp; - QQPoker</p>';
    }),
    skipped: null,
  };
}

// QP2 pattern. Extracts the prefix used by the existing 918KISS bullet
// (e.g. "&nbsp; &nbsp; &nbsp;- " on EN, "-" on ZH) and mirrors it for the new
// QQPoker line. Anchored on `</li>` which closes the T&C item-1 list.
function patchQp2Content(content) {
  if (/QQPoker/i.test(content)) return { content, skipped: 'already-has-QQPoker' };
  // Capture: <br>{prefix}918KISS</li>  where prefix is anything up to "918KISS"
  // since the previous <br>. Then re-emit with QQPoker using the same prefix.
  const re = /(<br>)((?:&nbsp;\s*)*-\s*)(918KISS)(<\/li>)/;
  const m = content.match(re);
  if (!m) return { content, skipped: 'no-918KISS-anchor' };
  const prefix = m[2];
  const replacement = `${m[1]}${prefix}${m[3]}<br>${prefix}QQPoker${m[4]}`;
  return { content: content.replace(re, replacement), skipped: null };
}

// WS1 IDN special: Roman numeral list. Two variants:
//   en:  "<br><span style="white-space: pre;"> </span>v. JOKER</p>"
//   id:  "<div><span style="white-space: pre;"> </span>v. JOKER</div>"
function patchBiaRomanList(content) {
  if (/QQPoker/i.test(content)) return { content, skipped: 'already-has-QQPoker' };
  // Detect numeric vs roman: find last numeral
  const enRe = /(<br><span[^>]*>\s*<\/span>v\. JOKER)(<\/p>)/;
  const idRe = /(<div><span[^>]*>\s*<\/span>v\. JOKER<\/div>)/;
  if (enRe.test(content)) {
    return {
      content: content.replace(
        enRe,
        '$1<br><span style="white-space: pre;"> </span>vi. QQPoker$2',
      ),
      skipped: null,
    };
  }
  if (idRe.test(content)) {
    return {
      content: content.replace(
        idRe,
        '$1<div><span style="white-space: pre;"> </span>vi. QQPoker</div>',
      ),
      skipped: null,
    };
  }
  return { content, skipped: 'no-roman-anchor' };
}

// ── QPRO PUT body builder (from fix-qpro-evemrtg-tnc.mjs) ───────────────────
const SERVER_FIELDS = new Set(['id', 'promotion_content_id', 'settings_locale_code', 'created_at', 'updated_at']);

function buildQp2PutBody(content, patchedDetails, merchantId) {
  const categoryObj    = Object.fromEntries((content.category_id  || []).map((id, i) => [String(i), id]));
  const contentTypeObj = Object.fromEntries((content.content_type || []).map((t)     => [String(t), true]));
  const cleanDetails = {};
  for (const [k, d] of Object.entries(patchedDetails)) {
    if (!d) { cleanDetails[k] = d; continue; }
    cleanDetails[k] = Object.fromEntries(Object.entries(d).filter(([f]) => !SERVER_FIELDS.has(f)));
  }
  return {
    site_id:           merchantId,    // QP2 PUT requires merchant id
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
}

function buildQproPutBody(content, patchedDetails) {
  const categoryObj    = Object.fromEntries((content.category_id  || []).map((id, i) => [String(i), id]));
  const contentTypeObj = Object.fromEntries((content.content_type || []).map((t)     => [String(t), true]));
  const cleanDetails = {};
  for (const [k, d] of Object.entries(patchedDetails)) {
    if (!d) { cleanDetails[k] = d; continue; }
    cleanDetails[k] = Object.fromEntries(Object.entries(d).filter(([f]) => !SERVER_FIELDS.has(f)));
  }
  return {
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
}

// ── BIA auth ────────────────────────────────────────────────────────────────
async function biaLogin(host) {
  const password = process.env.BIA_PASSWORD;
  if (!password) throw new Error('BIA_PASSWORD env var required');
  const r = await fetch(host + '/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'promo_testbot@client.com', password, mode: 'json' }),
  });
  if (!r.ok) throw new Error('BIA login ' + r.status + ': ' + (await r.text()).slice(0, 200));
  return (await r.json()).data.access_token;
}
const tokenCache = {};
async function getBiaToken(host) {
  if (!tokenCache[host]) tokenCache[host] = await biaLogin(host);
  return tokenCache[host];
}

// ── Per-platform handlers ───────────────────────────────────────────────────
let totalChecked = 0, totalPatched = 0, totalSkipped = 0, totalErrors = 0;

async function runQpro(job) {
  const site = getSite(job.siteId);
  console.log(`── QPRO ${job.siteId.padEnd(7)} ${job.label.padEnd(8)} id=${job.contentId} ──`);
  let detail;
  try {
    detail = await authedFetch(site, `/api/bo/promotioncontent/${job.contentId}`);
  } catch (e) {
    console.log('  ✗ GET failed: ' + e.message.slice(0, 120));
    totalErrors++;
    return;
  }
  const content = detail?.data?.content;
  const details = JSON.parse(JSON.stringify(detail?.data?.details || {}));
  if (!content) { console.log('  ✗ no content in response'); totalErrors++; return; }

  let recordPatched = false;
  for (const [locId, d] of Object.entries(details)) {
    totalChecked++;
    if (!d?.content) { totalSkipped++; continue; }
    const { content: newContent, skipped } = patchQproContent(d.content);
    if (skipped) {
      console.log(`  loc=${locId.padEnd(2)} (${(d.settings_locale_code || '?').padEnd(6)}) — skipped: ${skipped}`);
      totalSkipped++;
      continue;
    }
    details[locId].content = newContent;
    recordPatched = true;
    totalPatched++;
    console.log(`  loc=${locId.padEnd(2)} (${(d.settings_locale_code || '?').padEnd(6)}) — would add QQPoker`);
  }

  if (!recordPatched) { console.log('  → nothing to update\n'); return; }

  if (!COMMIT) {
    console.log(`  [DRY-RUN] would PUT /api/bo/promotioncontent/${job.contentId}\n`);
    return;
  }
  const body = buildQproPutBody(content, details);
  await delay(800);
  try {
    const putRes = await authedFetch(site, `/api/bo/promotioncontent/${job.contentId}`, { method: 'PUT', body });
    const ok = putRes?.success !== false;
    console.log(`  PUT ${ok ? '✅ OK' : '❌ FAILED — ' + JSON.stringify(putRes?.message || '')}\n`);
    if (!ok) totalErrors++;
  } catch (e) {
    console.log(`  PUT ✗ ${e.message.slice(0, 200)}\n`);
    totalErrors++;
  }
}

async function runQp2(job) {
  const site = getSite(job.siteId);
  console.log(`── QP2  ${job.label.padEnd(8)} id=${job.contentId} site_id=${job.merchantId} ──`);
  let detail;
  try {
    detail = await authedFetch(site, `/api/bo/promotioncontent/${job.contentId}`);
  } catch (e) {
    console.log('  ✗ GET failed: ' + e.message.slice(0, 120));
    totalErrors++;
    return;
  }
  const content = detail?.data?.content;
  const details = JSON.parse(JSON.stringify(detail?.data?.details || {}));
  if (!content) { console.log('  ✗ no content in response'); totalErrors++; return; }

  let recordPatched = false;
  for (const [locId, d] of Object.entries(details)) {
    totalChecked++;
    if (!d?.content) { totalSkipped++; continue; }
    const { content: newContent, skipped } = patchQp2Content(d.content);
    if (skipped) {
      console.log(`  loc=${locId.padEnd(2)} (${(d.settings_locale_code || '?').padEnd(6)}) — skipped: ${skipped}`);
      totalSkipped++;
      continue;
    }
    details[locId].content = newContent;
    recordPatched = true;
    totalPatched++;
    console.log(`  loc=${locId.padEnd(2)} (${(d.settings_locale_code || '?').padEnd(6)}) — would add QQPoker`);
  }

  if (!recordPatched) { console.log('  → nothing to update\n'); return; }

  if (!COMMIT) {
    console.log(`  [DRY-RUN] would PUT /api/bo/promotioncontent/${job.contentId}\n`);
    return;
  }
  const body = buildQp2PutBody(content, details, job.merchantId);
  await delay(800);
  try {
    const putRes = await authedFetch(site, `/api/bo/promotioncontent/${job.contentId}`, { method: 'PUT', body });
    const ok = putRes?.success !== false;
    console.log(`  PUT ${ok ? '✅ OK' : '❌ FAILED — ' + JSON.stringify(putRes?.message || '')}\n`);
    if (!ok) totalErrors++;
  } catch (e) {
    console.log(`  PUT ✗ ${e.message.slice(0, 200)}\n`);
    totalErrors++;
  }
}

async function runBia(job) {
  console.log(`── ${job.siteId.toUpperCase().padEnd(4)} ${job.region.padEnd(3)} promo=${job.promoId} ──`);
  const tok = await getBiaToken(job.host);
  const r = await fetch(job.host + `/items/promotions_translations?filter[promotions_id][_eq]=${job.promoId}&limit=-1`, {
    headers: { authorization: 'Bearer ' + tok },
  });
  if (!r.ok) { console.log('  ✗ GET ' + r.status); totalErrors++; return; }
  const j = await r.json();
  const rows = j.data || [];
  for (const t of rows) {
    totalChecked++;
    if (!t.content) { totalSkipped++; continue; }
    const patchFn = (job.region === 'IDN') ? patchBiaRomanList : patchBiaDashList;
    const { content: newContent, skipped } = patchFn(t.content);
    if (skipped) {
      console.log(`  row=${t.id} lang=${t.languages_code} — skipped: ${skipped}`);
      totalSkipped++;
      continue;
    }
    totalPatched++;
    console.log(`  row=${t.id} lang=${t.languages_code} — would add QQPoker`);
    if (!COMMIT) continue;
    await delay(400);
    try {
      const pr = await fetch(job.host + `/items/promotions_translations/${t.id}`, {
        method: 'PATCH',
        headers: { authorization: 'Bearer ' + tok, 'content-type': 'application/json' },
        body: JSON.stringify({ content: newContent }),
      });
      if (!pr.ok) {
        console.log(`    PATCH ✗ ${pr.status} ${(await pr.text()).slice(0, 200)}`);
        totalErrors++;
      } else {
        console.log(`    PATCH ✅`);
      }
    } catch (e) {
      console.log(`    PATCH ✗ ${e.message.slice(0, 200)}`);
      totalErrors++;
    }
  }
  console.log();
}

// ── Main ────────────────────────────────────────────────────────────────────
console.log('═'.repeat(72));
console.log(`  ADD QQPoker TO REBATE T&C  [${COMMIT ? 'LIVE COMMIT' : 'DRY-RUN'}]`);
console.log('═'.repeat(72));
console.log();

if (ONLY === '' || ONLY === 'qpro' || ONLY === 'all') {
  for (const job of QPRO_JOBS) await runQpro(job);
}
if (ONLY === '' || ONLY === 'qp2' || ONLY === 'all') {
  for (const job of QP2_JOBS) await runQp2(job);
}
if (ONLY === '' || ONLY === 'ws' || ONLY === 'bia' || ONLY === 'all') {
  for (const job of BIA_JOBS) await runBia(job);
}

console.log('═'.repeat(72));
console.log(`  Checked : ${totalChecked} locale-blocks`);
console.log(`  Patched : ${totalPatched}`);
console.log(`  Skipped : ${totalSkipped}`);
if (totalErrors) console.log(`  Errors  : ${totalErrors}`);
if (!COMMIT) console.log(`\n  Re-run with --commit to apply.`);
console.log('═'.repeat(72));

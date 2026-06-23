#!/usr/bin/env node
/**
 * V68 — Fix utilization tracker tab detection.
 *
 * Bug: parseUtilTracker_'s monthTabPattern requires the year:
 *   /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{4}/i
 *
 * Trackers found with tab names this rejects:
 *   • Bangun, Elyssa, Gaby — "MAY", "APRIL", "MAR", "FEB", etc. (no year)
 *   • Michelle — "Mac 2026" (Bahasa Malaysia "Mac" = March)
 *
 * Result: 0 hours synced for these 4 people.
 *
 * Fix: new pattern accepts:
 *   • Month-name prefix (optionally preceded by "Copy of")
 *   • Year is OPTIONAL (year comes from date cells inside the tab anyway)
 *   • Includes Bahasa Malaysia month aliases: Mac, Mei, Ogos, Okt, Dis
 *   • Explicit exclude list for non-month tabs (TRAINING LOG, Utilisation,
 *     Notes, Cumulative, Summary, etc.)
 */
import { getGoogleAuth } from '../src/google-auth.js';

const SCRIPT_ID     = '1Zw5W9LjmYL5hzFpHXdr0G_Q7oFRVCAGqZVTBmQCjiOmZIO2R7M6h8l6O';
const DEPLOYMENT_ID = 'AKfycbz8wysv66dtQuh4JsWiguglcsZUcsmLMd1N3ELdJQ9sYuXhoBsOuu9R6BeTjiIcAMYJPQ';

const { client } = await getGoogleAuth();
const tok = (await client.getAccessToken()).token;

async function api(method, url, body) {
  const r = await fetch(`https://script.googleapis.com/v1${url}`, {
    method,
    headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${method} ${url}: ${r.status} ${await r.text()}`);
  return r.json();
}

const proj = await api('GET', `/projects/${SCRIPT_ID}/content`);
const codeIdx = proj.files.findIndex(f => f.name === 'Code');
let code = proj.files[codeIdx].source;

// Replace the monthTabPattern detection + the per-sheet loop
const OLD_PATTERN_BLOCK = `  var hoursByDate = {};
  var monthTabPattern = /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\s+\\d{4}/i;

  sheets.forEach(function(sh) {
    var tabName = sh.getName();
    if (!monthTabPattern.test(tabName)) return;  // skip non-month tabs (e.g. TRAINING LOG)`;

const NEW_PATTERN_BLOCK = `  var hoursByDate = {};
  // V68: more permissive tab-name detection.
  // Accepts: "MAY", "May 2026", "APRIL", "Mac 2026" (Malay = March),
  //          "Mei 2026" (Malay = May), "Copy of Apr 2026", etc.
  // Excludes: TRAINING LOG, Utilisation, Summary, Notes, Cumulative, etc.
  function isMonthTab_(name) {
    var n = String(name || '').trim();
    if (!n) return false;
    // Hard exclude — non-month tabs that often live in these sheets
    if (/^(training|utilisation|utilization|summary|cumulative|notes|overview|template|sheet\\d+|untitled)/i.test(n)) return false;
    // Accept if starts with "Copy of " or a month name (English or Malay)
    return /^(copy\\s+of\\s+)?(jan(uary)?|januari|feb(ruary)?|februari|mar(ch)?|mac|apr(il)?|may|mei|jun(e)?|jul(y)?|julai|aug(ust)?|ogos|sep(t(ember)?)?|oct(ober)?|okt(ober)?|nov(ember)?|dec(ember)?|dis(ember)?)\\b/i.test(n);
  }

  sheets.forEach(function(sh) {
    var tabName = sh.getName();
    if (!isMonthTab_(tabName)) return;  // skip non-month tabs (e.g. TRAINING LOG)`;

if (!code.includes(OLD_PATTERN_BLOCK)) {
  console.error('✗ monthTabPattern anchor not found');
  process.exit(1);
}
code = code.replace(OLD_PATTERN_BLOCK, NEW_PATTERN_BLOCK);
console.log('✓ parseUtilTracker_: tab detection now accepts month-only names + Malay variants');

// ─── Push & promote ──────────────────────────────────────────────────────────
proj.files[codeIdx].source = code;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('✓ Content pushed');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V68: parseUtilTracker_ tab detection (no-year + Malay months) ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);

const dep = await api('PUT', `/projects/${SCRIPT_ID}/deployments/${DEPLOYMENT_ID}`, {
  deploymentConfig: {
    scriptId: SCRIPT_ID,
    versionNumber: v.versionNumber,
    manifestFileName: 'appsscript',
    description: 'V68: tracker tabs',
  },
});
console.log(`✓ Deployed V${dep.deploymentConfig.versionNumber}`);
console.log('\nClick ↻ Sync from Drive — Bangun, Elyssa, Gaby, Michelle should now show real hours.');
console.log('\nhttps://script.google.com/macros/s/AKfycbz8wysv66dtQuh4JsWiguglcsZUcsmLMd1N3ELdJQ9sYuXhoBsOuu9R6BeTjiIcAMYJPQ/exec');

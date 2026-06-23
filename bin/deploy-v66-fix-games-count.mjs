#!/usr/bin/env node
/**
 * V66 — Fix New Games count returning 0 for newer weekly reports.
 *
 * Bug: parseWeeklySheet_'s count() function decides log-vs-grid format
 * by whether the tab NAME contains "log". The "New Games" tab in 2026
 * weekly reports is in log format (one row per game) but its name
 * doesn't contain "log" → parser falls to grid path → looks for "Total"
 * row → finds none → returns 0.
 *
 * Fix: make the parser detect format by CONTENT, not name. Try grid
 * first (cheap "Total" row scan). If no Total row found, fall back
 * to counting non-empty data rows (log format).
 *
 * This is more robust and works for any tab regardless of naming.
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

// Replace the count function inside parseWeeklySheet_
const OLD_COUNT = `  function count(sheet) {
    if (!sheet) return 0;
    var name = sheet.getName().toLowerCase();
    var lr = sheet.getLastRow();
    var lc = Math.min(sheet.getLastColumn() || 1, 10);
    if (lr < 2) return 0;
    var vals = sheet.getRange(1, 1, Math.min(lr, 2000), lc).getValues();
    if (name.indexOf('log') >= 0) {
      var c = 0;
      for (var i = 1; i < vals.length; i++) {
        for (var j = 0; j < vals[i].length; j++) {
          if (vals[i][j] !== '' && vals[i][j] != null && String(vals[i][j]).trim() !== '') { c++; break; }
        }
      }
      return c;
    } else {
      for (var k = 0; k < vals.length; k++) {
        if (String(vals[k][0] || '').trim().toLowerCase() === 'total') {
          return parseInt(String(vals[k][1] || '0').replace(/,/g, ''), 10) || 0;
        }
      }
      return 0;
    }
  }`;

const NEW_COUNT = `  function count(sheet) {
    if (!sheet) return 0;
    var lr = sheet.getLastRow();
    var lc = Math.min(sheet.getLastColumn() || 1, 10);
    if (lr < 2) return 0;
    var vals = sheet.getRange(1, 1, Math.min(lr, 2000), lc).getValues();
    // V66: detect format by CONTENT not name.
    //   Strategy 1: scan for a "Total" row (old grid format → use col B number)
    for (var k = 0; k < vals.length; k++) {
      if (String(vals[k][0] || '').trim().toLowerCase() === 'total') {
        var n = parseInt(String(vals[k][1] || '0').replace(/,/g, ''), 10);
        if (!isNaN(n)) return n;
      }
    }
    //   Strategy 2: no Total row → count non-empty data rows (log format).
    //   Works for "Promo Code Log", "Banner Log", "CRM Assignment Log",
    //   "New Games" (no log suffix in newer files), etc.
    var c = 0;
    for (var i = 1; i < vals.length; i++) {
      for (var j = 0; j < vals[i].length; j++) {
        if (vals[i][j] !== '' && vals[i][j] != null && String(vals[i][j]).trim() !== '') { c++; break; }
      }
    }
    return c;
  }`;

if (!code.includes(OLD_COUNT)) {
  console.error('✗ count() function anchor not found inside parseWeeklySheet_');
  process.exit(1);
}
code = code.replace(OLD_COUNT, NEW_COUNT);
console.log('✓ parseWeeklySheet_.count(): grid-first, log fallback');

// ─── Push & promote ──────────────────────────────────────────────────────────
proj.files[codeIdx].source = code;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('✓ Content pushed');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V66: parseWeeklySheet_.count() format-by-content not name ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);

const dep = await api('PUT', `/projects/${SCRIPT_ID}/deployments/${DEPLOYMENT_ID}`, {
  deploymentConfig: {
    scriptId: SCRIPT_ID,
    versionNumber: v.versionNumber,
    manifestFileName: 'appsscript',
    description: 'V66: games count fix',
  },
});
console.log(`✓ Deployed V${dep.deploymentConfig.versionNumber}`);
console.log('\nClick ↻ Sync from Drive again — new games counts will populate correctly now.');
console.log('\nhttps://script.google.com/macros/s/AKfycbz8wysv66dtQuh4JsWiguglcsZUcsmLMd1N3ELdJQ9sYuXhoBsOuu9R6BeTjiIcAMYJPQ/exec');

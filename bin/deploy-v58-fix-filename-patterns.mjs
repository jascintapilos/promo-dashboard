#!/usr/bin/env node
/**
 * V58 — Fix parseWeeklySheet_ to handle two filename patterns that
 * are currently rejected with "filename does not match expected date":
 *
 *   1. Monthly summary files (e.g. "March 2026 Report", "December 2025
 *      Report") — these are NOT weekly reports, just monthly summaries
 *      sitting in the same folder. Should be silently skipped, not
 *      reported as errors.
 *
 *   2. Weekly files without year suffix (e.g. "Weekly Report (22/12-
 *      26/12)" — Dec 2025 weeks lack /YY in their date range). Should
 *      infer the year from the parent folder name (e.g. "Weekly Report
 *      (Dec 2025)" → 2025).
 *
 * Also: pass parent month folder name into parseWeeklySheet_ as a hint.
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

// ─── 1. Replace parseWeeklySheet_ ───────────────────────────────────────────
const OLD_PARSE_PATTERN = /function parseWeeklySheet_\([\s\S]*?\n\}/;

const NEW_PARSE = `function parseWeeklySheet_(ssId, fileName, monthHint) {
  // Silently skip monthly summary files (not weekly reports)
  if (/^\\s*(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|jun(e)?|jul(y)?|aug(ust)?|sep(tember)?|oct(ober)?|nov(ember)?|dec(ember)?)\\s+\\d{4}\\s+report/i.test(fileName)) {
    return { __skip: true };
  }

  function pad(n){ n = String(n); return n.length === 1 ? '0'+n : n; }
  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  var startDate, endDate, sm, em, sd, ed;

  // Try full pattern with year: DD/MM/YY-DD/MM/YY
  var m = fileName.match(/(\\d{1,2})\\/(\\d{1,2})\\/(\\d{2,4})\\s*[-–]\\s*(\\d{1,2})\\/(\\d{1,2})\\/(\\d{2,4})/);
  if (m) {
    function iso(d, mm, y){ if (String(y).length === 2) y = '20'+y; return y + '-' + pad(mm) + '-' + pad(d); }
    startDate = iso(m[1], m[2], m[3]);
    endDate   = iso(m[4], m[5], m[6]);
    sm = parseInt(m[2], 10); em = parseInt(m[5], 10);
    sd = parseInt(m[1], 10); ed = parseInt(m[4], 10);
  } else {
    // Fallback: DD/MM-DD/MM (no year) — infer year from parent folder name
    var m2 = fileName.match(/(\\d{1,2})\\/(\\d{1,2})\\s*[-–]\\s*(\\d{1,2})\\/(\\d{1,2})/);
    if (!m2) return null;
    var yr = '2026';
    if (monthHint) {
      var yMatch = String(monthHint).match(/(20\\d{2})/);
      if (yMatch) yr = yMatch[1];
    }
    startDate = yr + '-' + pad(m2[2]) + '-' + pad(m2[1]);
    endDate   = yr + '-' + pad(m2[4]) + '-' + pad(m2[3]);
    sm = parseInt(m2[2], 10); em = parseInt(m2[4], 10);
    sd = parseInt(m2[1], 10); ed = parseInt(m2[3], 10);
  }

  var moLabel = months[sm-1];
  var dLabel  = (sm === em)
    ? sd + '–' + ed + ' ' + months[sm-1]
    : sd + ' ' + months[sm-1] + '–' + (ed < 10 ? '0'+ed : ed) + ' ' + months[em-1];

  var ss = SpreadsheetApp.openById(ssId);
  var sheets = ss.getSheets();

  function findTab(patterns) {
    for (var i = 0; i < patterns.length; i++) {
      for (var j = 0; j < sheets.length; j++) {
        if (sheets[j].getName().toLowerCase().indexOf(patterns[i]) >= 0) return sheets[j];
      }
    }
    return null;
  }

  function count(sheet) {
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
  }

  var promoTab  = findTab(['promo code log','promo code','promo']);
  var bannerTab = findTab(['banner log','banner']);
  var crmTab    = findTab(['crm assignment','crm']);
  var gamesTab  = findTab(['new games','games']);

  return {
    d: dLabel,
    mo: moLabel,
    s: startDate,
    e: endDate,
    p: count(promoTab),
    b: count(bannerTab),
    c: count(crmTab),
    g: count(gamesTab),
  };
}`;

if (!OLD_PARSE_PATTERN.test(code)) {
  console.error('✗ parseWeeklySheet_ anchor not found');
  process.exit(1);
}
code = code.replace(OLD_PARSE_PATTERN, NEW_PARSE);
console.log('✓ parseWeeklySheet_ rewritten: skips monthly summaries + infers year');

// ─── 2. Update serverSyncWeeklyReportData to pass monthHint + honor __skip ──
const OLD_PARSE_CALL = `        try {
          var data = parseWeeklySheet_(f.getId(), f.getName());
          if (data) { allWeeks.push(data); parsed++; }
          else errors.push(f.getName() + ': filename does not match expected date pattern');
        } catch (parseErr) {
          errors.push(f.getName() + ': ' + parseErr.message);
        }`;

const NEW_PARSE_CALL = `        try {
          var data = parseWeeklySheet_(f.getId(), f.getName(), mf.getName());
          if (data && data.__skip) {
            // monthly summary file — intentionally skipped, no error
          } else if (data) { allWeeks.push(data); parsed++; }
          else errors.push(f.getName() + ': filename does not match expected date pattern');
        } catch (parseErr) {
          errors.push(f.getName() + ': ' + parseErr.message);
        }`;

if (!code.includes(OLD_PARSE_CALL)) {
  console.error('✗ parse-call anchor not found');
  process.exit(1);
}
code = code.replace(OLD_PARSE_CALL, NEW_PARSE_CALL);
console.log('✓ Sync loop now passes monthHint + honors __skip flag');

// ─── Push & promote ──────────────────────────────────────────────────────────
proj.files[codeIdx].source = code;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('✓ Content pushed');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V58: parseWeeklySheet_ skips monthly summaries + infers year ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);

const dep = await api('PUT', `/projects/${SCRIPT_ID}/deployments/${DEPLOYMENT_ID}`, {
  deploymentConfig: {
    scriptId: SCRIPT_ID,
    versionNumber: v.versionNumber,
    manifestFileName: 'appsscript',
    description: 'V58: parse filename fix',
  },
});
console.log(`✓ Deployed V${dep.deploymentConfig.versionNumber}`);
console.log('\nClick ↻ Sync from Drive — banner should show all green now.');
console.log('Dec 2025 weeks will be loaded too (4 more weeks added).');
console.log('\nhttps://script.google.com/macros/s/AKfycbz8wysv66dtQuh4JsWiguglcsZUcsmLMd1N3ELdJQ9sYuXhoBsOuu9R6BeTjiIcAMYJPQ/exec');

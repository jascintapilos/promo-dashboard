#!/usr/bin/env node
// GM01 (UNTUNG28) commission approval-queue reader.
//
// Reuses the saved, authorized Playwright session (storageState) and prints a
// per-category summary of the pending approval queue across ALL pages (the BO
// paginates at 100 rows/page). Flags duplicate (member, category) entries.
// Pauses for manual login only if the session is missing/expired. Never handles
// cookies by hand, never touches the CAPTCHA, never prints secrets.
//
// Usage:
//   node bin/gm01-pull-queue.mjs                 # Turnover queue (default)
//   node bin/gm01-pull-queue.mjs --bonusType=30  # Cashback

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { BASE, ensureAuthenticated, failScreenshot } from '../src/gm01-session.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CREDS_FILE = path.join(ROOT, 'gm01-credentials.local.json');

const cliArgs = {};
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) cliArgs[m[1]] = m[2] ?? true;
}
// searchBonusType on the approval page: 30=Cashback, 35=Turnover, 40=Ref1, 50=Ref2
const bonusType = String(cliArgs.bonusType ?? '35');
const LABELS = { '30': 'Cashback', '35': 'Turnover', '40': 'Referral 1', '50': 'Referral 2' };
const label = LABELS[bonusType] ?? `type ${bonusType}`;

// Credentials for the interactive fallback come from the gitignored creds file
// (or --user/--pass). Never hardcoded, never printed.
let savedCreds = {};
if (existsSync(CREDS_FILE)) {
  try { savedCreds = JSON.parse(readFileSync(CREDS_FILE, 'utf8')); } catch { /* ignore */ }
}
const USER = cliArgs.user ?? savedCreds.user;
const PASS = cliArgs.pass ?? savedCreds.pass;

const { browser, context } = await ensureAuthenticated({ user: USER, pass: PASS });

function parseRows(html) {
  const rows = [];
  for (const m of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const row = m[1];
    if (!row.includes('rejectIncentive') || row.includes('<th')) continue;
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
      .map(c => c[1].replace(/<[^>]+>/g, '').trim());
    if (cells.length < 6) continue;
    rows.push({ username: cells[3], category: cells[5] });
  }
  return rows;
}

try {
  // Walk every page (BO paginates at 100 rows). Stop once we've collected the
  // server-reported total or hit an empty page.
  const entries = [];
  let reportedTotal = 0;
  for (let page = 1; page <= 100; page++) {
    const url = `${BASE}/secure/credit/pending.incentive.xhtml`
      + `?currPage=${page}&searchEntity=-1&searchUsername=&sortAmount=&searchBonusType=${bonusType}`;
    const html = await context.request.get(url, { timeout: 20_000 }).then(r => r.text());
    const rows = parseRows(html);
    reportedTotal = Number(((html.match(/of\s+([\d,]+)\s+entries/i) || [])[1] || '0').replace(/,/g, ''));
    if (!rows.length) break;
    entries.push(...rows);
    if (reportedTotal && entries.length >= reportedTotal) break;
  }

  const byCat = {};
  const pairCounts = {};
  for (const e of entries) {
    byCat[e.category] = (byCat[e.category] || 0) + 1;
    const k = `${e.username}||${e.category}`;
    pairCounts[k] = (pairCounts[k] || 0) + 1;
  }
  const dups = Object.entries(pairCounts).filter(([, n]) => n > 1);

  console.log(`\n=== GM01 Commission — Approval Queue (${label}) ===`);
  console.log(`${'Category'.padEnd(20)} | Count`);
  console.log(`${''.padEnd(20, '-')}-+------`);
  if (!entries.length) {
    console.log('(no entries)');
  } else {
    Object.entries(byCat).sort((a, b) => b[1] - a[1])
      .forEach(([cat, n]) => console.log(`${cat.padEnd(20)} | ${n}`));
    console.log(`${''.padEnd(20, '-')}-+------`);
    console.log(`${'TOTAL (all pages)'.padEnd(20)} | ${entries.length}` +
      (reportedTotal && reportedTotal !== entries.length ? `  (server reports ${reportedTotal})` : ''));
    console.log(`Unique members       : ${new Set(entries.map(e => e.username)).size}`);
    console.log(dups.length
      ? `\n⚠ Duplicate (member+category): ${dups.map(([k, n]) => `${k.split('||')[0]}(${n})`).join(', ')}`
      : '\n✓ No duplicates.');
  }
} catch (err) {
  console.error(`\n✗ Queue pull failed: ${err.message}`);
  await failScreenshot(context, 'pull-queue-error');
  await browser.close().catch(() => {});
  process.exit(1);
}

await browser.close();

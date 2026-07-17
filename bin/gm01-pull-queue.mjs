#!/usr/bin/env node
// GM01 (UNTUNG28) commission approval-queue reader.
//
// Reuses the saved, authorized Playwright session (storageState) and prints a
// per-category summary of the pending Turnover approval queue. Pauses for manual
// login only if the session is missing/expired. Never handles cookies by hand,
// never touches the CAPTCHA, never prints secrets.
//
// Usage:
//   node bin/gm01-pull-queue.mjs                 # Turnover queue (default)
//   node bin/gm01-pull-queue.mjs --bonusType=35  # explicit searchBonusType

import { BASE, ensureAuthenticated, failScreenshot } from '../src/gm01-session.js';

const cliArgs = {};
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) cliArgs[m[1]] = m[2] ?? true;
}
// searchBonusType on the approval page: 30=Cashback, 35=Turnover, 40=Ref1, 50=Ref2
const bonusType = cliArgs.bonusType ?? '35';
const USER = cliArgs.user ?? '***REMOVED***';
const PASS = cliArgs.pass ?? '***REMOVED***';

const { browser, context } = await ensureAuthenticated({ user: USER, pass: PASS });

try {
  const res = await context.request.post(`${BASE}/secure/credit/pending.incentive.xhtml`, {
    form: { searchBonusType: bonusType },
    timeout: 20_000,
  });
  const html = await res.text();

  const entries = [];
  for (const m of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const row = m[1];
    if (!row.includes('rejectIncentive') || row.includes('<th')) continue;
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
      .map(c => c[1].replace(/<[^>]+>/g, '').trim());
    if (cells.length < 6) continue;
    entries.push({ username: cells[3], category: cells[5] });
  }

  const byCat = {};
  for (const e of entries) byCat[e.category] = (byCat[e.category] || 0) + 1;

  console.log('\n=== GM01 Commission — Approval Queue (Turnover) ===');
  console.log(`${'Category'.padEnd(20)} | Count`);
  console.log(`${''.padEnd(20, '-')}-+------`);
  if (!entries.length) {
    console.log('(no entries)');
  } else {
    Object.entries(byCat).sort((a, b) => b[1] - a[1])
      .forEach(([cat, n]) => console.log(`${cat.padEnd(20)} | ${n}`));
    console.log(`${''.padEnd(20, '-')}-+------`);
    console.log(`${'TOTAL'.padEnd(20)} | ${entries.length}`);
    console.log(`Unique members       : ${new Set(entries.map(e => e.username)).size}`);
  }
} catch (err) {
  console.error(`\n✗ Queue pull failed: ${err.message}`);
  await failScreenshot(context, 'pull-queue-error');
  await browser.close().catch(() => {});
  process.exit(1);
}

await browser.close();

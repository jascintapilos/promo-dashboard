#!/usr/bin/env node
// Warms up an AdsPower profile for the UG BO and waits for you to log in
// inside the AdsPower browser window (if not already logged in). AdsPower
// persists the session itself once you're in — there is nothing for this
// script to save locally, unlike a plain local-browser flow.
//
// Usage
// ─────
//   node bin/ug-login.mjs                  # UG01 / SBO28 (default)
//   node bin/ug-login.mjs --brand=UG02      # UG02 / MENANG7
//   node bin/ug-login.mjs --profile=<id>    # raw AdsPower profile id
//   node bin/ug-login.mjs --keep-open       # don't stop the profile when done

import { startProfile, stopProfile } from '../src/adspower-session.js';

const args = {};
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) args[m[1]] = m[2] === undefined ? true : m[2];
}

const brandOrProfile = args.profile || (args.brand || 'UG01').toUpperCase();
const keepOpen = !!args['keep-open'];
const BO_BASE = 'https://3m-ns3-admin.com';
const LOGIN_WAIT_MS = 10 * 60 * 1000;

function isLoggedInUrl(url) {
  return /3m-ns3-admin\.com\/(dashboard|Website|Member|Transaction)/i.test(url) && !/login/i.test(url);
}

const { browser, page, userId } = await startProfile(brandOrProfile);
console.log(`✓ AdsPower profile ${userId} connected`);

await page.goto(BO_BASE, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForTimeout(1500);

if (isLoggedInUrl(page.url())) {
  console.log(`✓ already logged in (${page.url()}) — AdsPower remembered the session.`);
} else {
  console.log('\n─────────────────────────────────────────────────────────');
  console.log(` Profile ${userId}'s AdsPower browser window is open on your desktop.`);
  console.log(' Please log in manually: username, password, and the');
  console.log(' "Validation" CAPTCHA image, then click LOG IN.');
  console.log(' AdsPower will remember this session for future runs.');
  console.log(`  (waiting up to ${LOGIN_WAIT_MS / 60000} minutes)`);
  console.log('─────────────────────────────────────────────────────────\n');

  const deadline = Date.now() + LOGIN_WAIT_MS;
  let loggedIn = false;
  while (Date.now() < deadline) {
    if (isLoggedInUrl(page.url())) { loggedIn = true; break; }
    await page.waitForTimeout(2000);
  }
  if (!loggedIn) {
    if (!keepOpen) await stopProfile(userId);
    console.error(`✗ timed out waiting for login (${LOGIN_WAIT_MS / 60000} min). Re-run when ready.`);
    process.exit(1);
  }
  console.log(`✓ logged in — landed on ${page.url()}`);
}

if (!keepOpen) {
  await stopProfile(userId);
  console.log(`✓ AdsPower profile ${userId} stopped (cloud data synced)`);
} else {
  console.log(`ℹ --keep-open set — leaving AdsPower profile ${userId} running`);
}
process.exit(0);

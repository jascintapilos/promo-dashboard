#!/usr/bin/env node
// Interactive one-time login capture for the UG BO (3MPLAY-NS3).
// Opens a visible browser, waits for you to log in (password + CAPTCHA),
// then saves the session to <brand>-session.local.json for reuse by
// bin/upload-ug-banner.mjs and any other UG script.
//
// Usage
// ─────
//   node bin/ug-login.mjs                 # UG01 / SBO28 (default)
//   node bin/ug-login.mjs --brand=UG02     # UG02 / MENANG7
//   node bin/ug-login.mjs --brand=UG01 --force   # re-login even if a session file exists

import { existsSync, unlinkSync } from 'node:fs';
import { getUgPage, sessionFilePath } from '../src/ug-session.js';

const args = {};
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) args[m[1]] = m[2] === undefined ? true : m[2];
}

const brand = (args.brand || 'UG01').toUpperCase();
const file = sessionFilePath(brand);

if (args.force && existsSync(file)) {
  unlinkSync(file);
  console.log(`removed existing session file for a fresh login: ${file}`);
}

const { browser, page } = await getUgPage({ brand });
console.log(`\n✓ ${brand} session ready. Landed on: ${page.url()}`);
console.log(`  Session file: ${sessionFilePath(brand)}`);
console.log('  Future runs of bin/upload-ug-banner.mjs will reuse it automatically.');
await browser.close();
process.exit(0);

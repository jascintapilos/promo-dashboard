#!/usr/bin/env node
/**
 * One-time setup for Smartico auto-login credentials.
 *
 * Saves username, password, and optional TOTP secret to smartico-creds.local.json
 * (gitignored). After running this once, capture-smartico-session.mjs runs fully
 * headless with no manual login.
 *
 * Usage:
 *   node bin/setup-smartico-creds.mjs
 */
import { createInterface } from 'node:readline';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const CREDS_FILE = path.resolve('smartico-creds.local.json');

function ask(rl, question) {
  return new Promise(res => rl.question(question, res));
}

const rl = createInterface({ input: process.stdin, output: process.stdout });

console.log('\n=== Smartico Auto-Login Setup ===');
console.log(`Credentials saved to: ${CREDS_FILE} (gitignored)\n`);

// Show existing if present (masked)
if (existsSync(CREDS_FILE)) {
  try {
    const existing = JSON.parse(readFileSync(CREDS_FILE, 'utf8'));
    console.log(`Existing: username=${existing.username}, password=***, totpSecret=${existing.totpSecret ? '***' : '(none)'}`);
    const overwrite = (await ask(rl, 'Overwrite? (y/n): ')).trim().toLowerCase();
    if (overwrite !== 'y') { rl.close(); process.exit(0); }
  } catch (_) {}
}

const username = (await ask(rl, 'Smartico username (e.g. Jascinta@enigma): ')).trim();
if (!username) { console.error('Username required.'); rl.close(); process.exit(1); }

const password = (await ask(rl, 'Password: ')).trim();
if (!password) { console.error('Password required.'); rl.close(); process.exit(1); }

const has2FA = (await ask(rl, 'Does this account use a 2FA authenticator app? (y/n): ')).trim().toLowerCase() === 'y';

let totpSecret = '';
if (has2FA) {
  console.log('\nTo find your TOTP Base32 secret:');
  console.log('  • Open Google Authenticator → tap the account → tap the pencil/edit icon');
  console.log('  • Or: export a QR-code screenshot and run: node bin/decode-ga-export.mjs <screenshot>');
  console.log('  • It looks like: JBSWY3DPEHPK3PXP (uppercase letters and 2-7 digits, no spaces)\n');
  totpSecret = (await ask(rl, 'TOTP Base32 secret: ')).trim().replace(/\s+/g, '').toUpperCase();
  if (!totpSecret) { console.warn('Warning: no TOTP secret entered — 2FA will not be automated.'); }
}

rl.close();

const creds = { username, password };
if (totpSecret) creds.totpSecret = totpSecret;

writeFileSync(CREDS_FILE, JSON.stringify(creds, null, 2));
console.log(`\nSaved → ${CREDS_FILE}`);
console.log('\nNext: node bin/capture-smartico-session.mjs');

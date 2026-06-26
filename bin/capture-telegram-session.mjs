/**
 * capture-telegram-session.mjs
 *
 * One-time interactive script to authenticate with Telegram and save a reusable
 * session string to telegram-session.local.json.
 *
 * Requires telegram-creds.local.json with:
 *   { "apiId": 12345678, "apiHash": "your_api_hash" }
 *
 * Get api_id + api_hash from: https://my.telegram.org → API development tools
 *
 * Usage (run ONCE, interactively in your own terminal):
 *   node bin/capture-telegram-session.mjs
 *
 * Output: telegram-session.local.json  (gitignored — never commit)
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { createInterface } from 'readline';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir  = dirname(fileURLToPath(import.meta.url));
const ROOT   = join(__dir, '..');
const CREDS  = join(ROOT, 'telegram-creds.local.json');
const SESSION = join(ROOT, 'telegram-session.local.json');

// ── Prompt helper ────────────────────────────────────────────────────────────
function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()); }));
}

// ── Load creds ───────────────────────────────────────────────────────────────
if (!existsSync(CREDS)) {
  console.error(`\n⛔ telegram-creds.local.json not found at ${CREDS}`);
  console.error(`\nCreate it with:`);
  console.error(`  { "apiId": <number from my.telegram.org>, "apiHash": "<string from my.telegram.org>" }`);
  process.exit(1);
}
const creds = JSON.parse(readFileSync(CREDS, 'utf8'));
if (!creds.apiId || !creds.apiHash) {
  console.error('⛔ telegram-creds.local.json must have "apiId" (number) and "apiHash" (string)');
  process.exit(1);
}

console.log(`\n━━ Telegram Session Capture ━━`);
console.log(`api_id: ${creds.apiId}`);
console.log(`\nThis will send a login code to your Telegram phone number.`);
console.log(`The session string is saved to telegram-session.local.json for future runs.\n`);

// ── GramJS auth ──────────────────────────────────────────────────────────────
const { TelegramClient } = await import('telegram');
const { StringSession }  = await import('telegram/sessions/index.js');

const existingSession = existsSync(SESSION)
  ? JSON.parse(readFileSync(SESSION, 'utf8')).session || ''
  : '';

const client = new TelegramClient(
  new StringSession(existingSession),
  Number(creds.apiId),
  creds.apiHash,
  { connectionRetries: 3 }
);

await client.start({
  phoneNumber: async () => prompt('Phone number (with country code, e.g. +601112223333): '),
  password:    async () => prompt('2FA password (leave blank if none): '),
  phoneCode:   async () => prompt('Telegram login code sent to your phone: '),
  onError:     (err) => { console.error('Auth error:', err.message); },
});

const sessionString = client.session.save();

writeFileSync(SESSION, JSON.stringify({ session: sessionString }, null, 2));
console.log(`\n✅ Session saved to telegram-session.local.json`);
console.log(`   Re-run pull-tg-tasks.mjs without authentication from now on.\n`);

// ── Discover team member IDs ──────────────────────────────────────────────────
console.log('Fetching your dialogs to help identify team groups...\n');
try {
  const dialogs = await client.getDialogs({ limit: 50 });
  const groups = dialogs.filter(d => d.isGroup || d.isChannel);
  if (groups.length) {
    console.log('Groups/channels you are in (last 50):');
    for (const g of groups) {
      console.log(`  id: ${g.id}  title: ${g.title}`);
    }
    console.log('\nNote the group ID(s) for the promo team group(s) — add them to pull-tg-tasks.mjs');
  } else {
    console.log('No groups found in first 50 dialogs.');
  }
} catch (e) {
  console.warn('Could not list dialogs:', e.message);
}

await client.disconnect();

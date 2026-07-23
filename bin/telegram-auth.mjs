/**
 * One-time Telegram auth — logs in as your user account and saves a session
 * string to telegram-config.local.json.
 *
 * Run: node bin/telegram-auth.mjs
 *
 * Prerequisites:
 *   1. Set your phone number in telegram-config.local.json
 *   2. Run this — it will ask for the code Telegram sends to your phone
 */

import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import * as readline from 'readline';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const CONFIG_FILE = path.join(ROOT, 'telegram-config.local.json');

const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = q => new Promise(r => rl.question(q, r));

console.log('\nConnecting to Telegram as user account...');

const client = new TelegramClient(
  new StringSession(config.session || ''),
  config.api_id,
  config.api_hash,
  { connectionRetries: 3 }
);

await client.start({
  phoneNumber: async () => {
    if (config.phone && config.phone !== '+601XXXXXXXX') return config.phone;
    return await ask('Your phone number (with country code, e.g. +60123456789): ');
  },
  password:  async () => await ask('2FA password (press Enter if none): '),
  phoneCode: async () => await ask('Code sent to your Telegram: '),
  onError:   e => console.error('Error:', e),
});

const session = client.session.save();
config.session = session;
fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));

console.log('\n✓ Logged in. Session saved to telegram-config.local.json');
console.log('You can now run: node bin/telegram-capture.mjs --dry-run');

rl.close();
await client.disconnect();

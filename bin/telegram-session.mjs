#!/usr/bin/env node
// One-time Telegram Web session capture.
//
// Opens a headed browser so you can log in to Telegram Web manually (QR code
// or phone number).  Once logged in, saves the browser storageState to
// telegram-session.local.json so headless runs can resume without logging in
// again.
//
// Usage:
//   node bin/telegram-session.mjs          # capture / refresh session
//
// The saved session file is gitignored.  Re-run this whenever Telegram logs
// you out (usually after several weeks of inactivity).

import { chromium } from 'playwright';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const SESSION_FILE = path.resolve('telegram-session.local.json');
const TELEGRAM_URL = 'https://web.telegram.org/k/';

console.log('\nTelegram session capture\n');

// Load existing session if present
const existingState = existsSync(SESSION_FILE)
  ? JSON.parse(readFileSync(SESSION_FILE, 'utf8'))
  : undefined;

if (existingState) {
  console.log(`  Found existing session at ${SESSION_FILE}`);
  console.log('  Re-opening browser to verify / refresh it...\n');
}

const browser = await chromium.launch({
  headless: false,
  channel: 'chrome',
  slowMo: 20,
  args: ['--start-maximized'],
});

const ctx = await browser.newContext({
  viewport: null,
  ...(existingState && { storageState: existingState }),
});

const page = await ctx.newPage();
await page.goto(TELEGRAM_URL, { waitUntil: 'domcontentloaded' });

console.log('  Browser opened. Waiting for Telegram to load...');
console.log('  If you see the QR code or phone login, complete the login now.\n');

// Wait until the chat list is visible (means we are logged in)
try {
  await page.waitForSelector('.chatlist-chat, .chat-list .chatlist-chat, [class*="chat-list"]', {
    timeout: 120_000, // 2 minutes to log in
  });
  console.log('  Logged in successfully.');
} catch {
  console.log('  Timed out waiting for chat list. Saving whatever state exists...');
}

// Give the app a moment to fully settle
await page.waitForTimeout(2000);

// Save storageState
const state = await ctx.storageState();
writeFileSync(SESSION_FILE, JSON.stringify(state, null, 2));
console.log(`\n  Session saved to: ${SESSION_FILE}`);
console.log('  You can now close the browser window, or it will close in 3 seconds.\n');

await page.waitForTimeout(3000);
await browser.close();
console.log('  Done. Run headless monitoring with:\n  node bin/telegram-monitor.mjs\n');

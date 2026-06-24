#!/usr/bin/env node
// Headless Telegram monitor — reads INFO CS WL [NS 3] for new event
// announcements and adds them to the Banner Schedule ID Google Sheet.
//
// Usage:
//   node bin/telegram-monitor.mjs           # run (dry-run by default)
//   node bin/telegram-monitor.mjs --commit  # write to live sheet
//   node bin/telegram-monitor.mjs --debug   # headed browser for troubleshooting
//
// Prerequisites:
//   1. Run node bin/telegram-session.mjs once to capture your Telegram login.
//   2. Google OAuth credentials must be set up (see docs/SHEETS-API-SETUP.md).
//
// The monitor is idempotent: it skips events already in the sheet.

import { chromium } from 'playwright';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { campaignExists, addBannerEntries } from '../src/banner-schedule-client.js';

const SESSION_FILE = path.resolve('telegram-session.local.json');
const TELEGRAM_URL = 'https://web.telegram.org/k/';
const GROUP_NAME   = 'INFO CS WL [NS 3]';

const args   = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const DEBUG  = args.includes('--debug');
const HEADLESS = !DEBUG;

// ── Helpers ───────────────────────────────────────────────────────────────────

function log(msg)  { console.log(`  ${msg}`); }
function ok(msg)   { console.log(`  ✓  ${msg}`); }
function warn(msg) { console.log(`  ⚠  ${msg}`); }
function fail(msg) { console.error(`  ✗  ${msg}`); }

// Parse "06 July - 27 September 2026" or "06 July 2026 - 27 September 2026"
function parsePeriod(periodStr) {
  const MONTHS = {
    january:1, february:2, march:3, april:4, may:5, june:6,
    july:7, august:8, september:9, october:10, november:11, december:12,
  };
  const ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // Split on dash/en-dash, allowing optional year on start
  const parts = periodStr.split(/\s*[-–]\s*/);
  if (parts.length < 2) return null;

  function toSheetDate(s, fallbackYear) {
    const m = s.trim().match(/^(\d{1,2})\s+(\w+)(?:\s+(\d{4}))?$/);
    if (!m) return null;
    const day  = parseInt(m[1], 10);
    const mon  = MONTHS[m[2].toLowerCase()];
    const year = m[3] || fallbackYear;
    if (!mon || !year) return null;
    return `${day}-${ABBR[mon - 1]}-${year}`;
  }

  // Extract year from end part first (it always has the year)
  const endYear = (parts[parts.length - 1].match(/\d{4}/) || [])[0];
  const start   = toSheetDate(parts[0], endYear);
  const end     = toSheetDate(parts[parts.length - 1], endYear);
  return (start && end) ? { start, end } : null;
}

// Parse an event announcement message block.
// Returns { provider, event_name, start_date, end_date } or null.
function parseAnnouncement(text) {
  if (!text.includes('Event name') && !text.includes('Event Period')) return null;

  const nameMatch   = text.match(/Event\s*name\s*[:\-]\s*(.+)/i);
  const periodMatch = text.match(/Event\s*Period\s*[:\-]\s*(.+)/i);
  const provMatch   = text.match(/Provider\s*[:\-]\s*(.+)/i);

  if (!nameMatch || !periodMatch) return null;

  const dates = parsePeriod(periodMatch[1].trim());
  if (!dates) return null;

  return {
    provider:   (provMatch?.[1] ?? '').trim(),
    event_name: nameMatch[1].trim(),
    start_date: dates.start,
    end_date:   dates.end,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log(`\nTelegram Monitor — ${GROUP_NAME}`);
console.log(`Mode: ${COMMIT ? 'LIVE (--commit)' : 'dry-run'}\n`);

if (!existsSync(SESSION_FILE)) {
  fail(`No Telegram session found at ${SESSION_FILE}`);
  fail('Run first:  node bin/telegram-session.mjs');
  process.exit(1);
}

const sessionState = JSON.parse(readFileSync(SESSION_FILE, 'utf8'));

const browser = await chromium.launch({
  headless: HEADLESS,
  channel: 'chrome',
  args: HEADLESS ? [] : ['--start-maximized'],
});

const ctx  = await browser.newContext({
  storageState: sessionState,
  viewport: { width: 1440, height: 900 },
});
const page = await ctx.newPage();

try {
  log('Opening Telegram Web…');
  await page.goto(TELEGRAM_URL, { waitUntil: 'domcontentloaded' });

  // Detect if we landed on the login page (session expired)
  const isLoginPage = await page.locator('.auth-form, .qr-container, [class*="login"]')
    .first().isVisible({ timeout: 6000 }).catch(() => false);

  if (isLoginPage) {
    fail('Telegram session has expired.');
    fail('Re-run:  node bin/telegram-session.mjs  to log in again.');
    process.exit(1);
  }

  // Wait for chat list
  await page.waitForSelector('.chatlist-chat', { timeout: 30_000 });
  log('Logged in. Searching for group…');

  // Search for the group
  await page.click('.input-search input, [placeholder*="Search"], .search-input input');
  await page.waitForTimeout(500);
  await page.keyboard.type('INFO CS WL', { delay: 60 });
  await page.waitForTimeout(1500);

  // Click on the matching group
  const groupLocator = page.locator(`.chatlist-chat:has-text("${GROUP_NAME}")`).first();
  const found = await groupLocator.isVisible({ timeout: 8000 }).catch(() => false);

  if (!found) {
    // Try partial match
    const partial = page.locator('.chatlist-chat:has-text("INFO CS WL")').first();
    const partialFound = await partial.isVisible({ timeout: 5000 }).catch(() => false);
    if (!partialFound) {
      fail(`Group "${GROUP_NAME}" not found in search results.`);
      fail('Make sure you are a member of this group.');
      process.exit(1);
    }
    await partial.click();
  } else {
    await groupLocator.click();
  }

  log(`Opened group. Reading messages…`);
  await page.waitForSelector('.bubble-content, .message, [class*="bubble"]', { timeout: 15_000 });
  await page.waitForTimeout(2000); // let messages render

  // Extract all visible message texts
  const rawMessages = await page.evaluate(() => {
    const selectors = [
      '.bubble:not(.is-out) .message',
      '.bubble .text-content',
      '.message-list-item .message',
    ];
    for (const sel of selectors) {
      const els = document.querySelectorAll(sel);
      if (els.length > 0) return Array.from(els).map(el => el.innerText || el.textContent || '');
    }
    // Fallback: get all text from the chat column
    const chat = document.querySelector('.chat-content, .messages-container, #column-center');
    if (chat) return [chat.innerText || ''];
    return [];
  });

  log(`Found ${rawMessages.length} message element(s). Scanning for announcements…`);

  // Parse each message
  const events = [];
  for (const msgText of rawMessages) {
    const parsed = parseAnnouncement(msgText);
    if (parsed && !events.some(e => e.event_name === parsed.event_name)) {
      events.push(parsed);
    }
  }

  if (events.length === 0) {
    log('No event announcements found in visible messages.');
    await browser.close();
    process.exit(0);
  }

  log(`Found ${events.length} event announcement(s):\n`);

  let addedCount = 0;

  for (const event of events) {
    console.log(`  Event:    ${event.event_name}`);
    console.log(`  Provider: ${event.provider}`);
    console.log(`  Dates:    ${event.start_date} → ${event.end_date}`);

    const exists = await campaignExists(event.event_name);
    if (exists) {
      warn(`Already in sheet — skipping.`);
      console.log();
      continue;
    }

    const slots = await addBannerEntries({
      campaign_title: event.event_name,
      start_date:     event.start_date,
      end_date:       event.end_date,
    }, { dryRun: !COMMIT });

    if (COMMIT) {
      ok(`Added: ${slots.map(s => `${s.banner_id}(${s.brand})`).join(', ')}`);
      addedCount++;
    } else {
      log(`Dry-run: would add ${slots.map(s => `${s.banner_id}(${s.brand})`).join(', ')}`);
    }
    console.log();
  }

  if (COMMIT) {
    ok(`Done. ${addedCount} event(s) added to Banner Schedule.`);
  } else {
    log(`Dry-run complete. Pass --commit to write to the live sheet.`);
  }

} finally {
  await browser.close();
}

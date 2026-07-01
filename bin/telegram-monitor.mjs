#!/usr/bin/env node
// Headless Telegram monitor — reads multiple groups for new event
// announcements and adds them to the Banner Schedule ID Google Sheet.
//
// Supports both English (INFO CS WL [NS 3]) and Indonesian (UPDATE PROMOTION ID)
// message formats. Deduplicates across groups and against the live sheet.
//
// Usage:
//   node bin/telegram-monitor.mjs           # dry-run (no sheet writes)
//   node bin/telegram-monitor.mjs --commit  # write to live sheet
//   node bin/telegram-monitor.mjs --debug   # headed browser for troubleshooting
//
// Prerequisites:
//   1. Run node bin/telegram-session.mjs once to capture your Telegram login.
//   2. Google OAuth credentials must be set up.

import { chromium } from 'playwright';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { campaignExists, addBannerEntries } from '../src/banner-schedule-client.js';

const SESSION_FILE = path.resolve('telegram-session.local.json');
const TELEGRAM_URL = 'https://web.telegram.org/k/';

// Groups to monitor — order determines priority for deduplication
const GROUPS = [
  'INFO CS WL [NS 3]',
  'UPDATE PROMOTION ID',
];

const args    = process.argv.slice(2);
const COMMIT  = args.includes('--commit');
const DEBUG   = args.includes('--debug');
const HEADLESS = !DEBUG;

// ── Helpers ───────────────────────────────────────────────────────────────────

function log(msg)  { console.log(`  ${msg}`); }
function ok(msg)   { console.log(`  ✓  ${msg}`); }
function warn(msg) { console.log(`  ⚠  ${msg}`); }
function fail(msg) { console.error(`  ✗  ${msg}`); }

// Parse "06 July - 27 September 2026" or "01 Juli 2026, 11.00 (GMT+8) - 08 Juli 2026, 10.59 (GMT+8)"
function parsePeriod(periodStr) {
  const MONTHS = {
    january:1, februari:2, february:2, march:3, april:4, may:5, mei:5, june:6, juni:6,
    july:7, juli:7, august:8, agustus:8, september:9, october:10, oktober:10,
    november:11, december:12, desember:12,
  };
  const ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // Strip time and timezone info e.g. ", 11.00 (GMT+8)"
  const clean = periodStr.replace(/,?\s*\d{1,2}[:.]\d{2}(\s*\(GMT[+-]\d+\))?/g, '').trim();

  const parts = clean.split(/\s*[-–]\s*/);
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

  const endYear = (parts[parts.length - 1].match(/\d{4}/) || [])[0];
  const start   = toSheetDate(parts[0], endYear);
  const end     = toSheetDate(parts[parts.length - 1], endYear);
  return (start && end) ? { start, end } : null;
}

// Parse an event announcement — handles both English and Indonesian formats.
//
// English (INFO CS WL [NS 3]):
//   Provider: BOOONGO
//   Event name: BNG Prize Drop
//   Event Period: 06 July - 27 September 2026
//   TnC link: https://...
//   Banner link: https://...
//
// Indonesian (UPDATE PROMOTION ID):
//   Nama Event : TANTANGAN GOL GLOBAL
//   Period
//   Date: 01 July - 19 July 2026
//   TnC : https://...
//   Banner : https://...
//
// Returns { provider, event_name, start_date, end_date, banner_link, tnc_link } or null.
function parseAnnouncement(text) {
  // Must contain at least one recognisable event keyword
  const hasKeyword = /Event\s*name|Nama\s*Event|Event\s*Period|Periode\s*[:\-]|Date\s*:/i.test(text);
  if (!hasKeyword) return null;

  // Period — English "Event Period: …", Indonesian "Periode : …", or "Date: …"
  const periodMatch = text.match(/Event\s*Period\s*[:\-]\s*(.+)/i)
                   ?? text.match(/Periode\s*[:\-]\s*(.+)/i)
                   ?? text.match(/Date\s*[:\-]\s*(.+)/i);
  if (!periodMatch) return null;

  // Event name — labeled ("Nama Event: X") or standalone ALL-CAPS line after provider
  const labeledName = text.match(/(?:Event\s*name|Nama\s*Event)\s*[:\-]\s*(.+)/i);
  const standaloneMatch = !labeledName
    ? text.match(/(?:Provider[^\n]*\n+)([A-Z0-9&' ]{3,})\n/i)  // ALL-CAPS line after provider
    : null;
  const nameMatch = labeledName ?? standaloneMatch;
  if (!nameMatch) return null;

  // Provider (optional)
  const provMatch = text.match(/Provider\s*[:\-]\s*(.+)/i);

  // Banner link — "Banner link:", "Banner :", "Banner:"
  const bannerMatch = text.match(/Banner\s*(?:link|url|image)?\s*[:\-]\s*(\S+)/i);

  // TnC link — "TnC link:", "TnC :", "T&C link:", "Terms & Conditions link:"
  const tncMatch = text.match(/T(?:n|&|and)C\s*(?:link|url)?\s*[:\-]\s*(\S+)/i)
                ?? text.match(/Terms?\s*(?:&|and)?\s*Conditions?\s*(?:link|url)?\s*[:\-]\s*(\S+)/i);

  const dates = parsePeriod(periodMatch[1].trim());
  if (!dates) return null;

  return {
    provider:    (provMatch?.[1]   ?? '').trim(),
    event_name:  nameMatch[1].trim(),
    start_date:  dates.start,
    end_date:    dates.end,
    banner_link: (bannerMatch?.[1] ?? '').trim(),
    tnc_link:    (tncMatch?.[1]    ?? '').trim(),
  };
}

// ── Group reader ──────────────────────────────────────────────────────────────

async function readGroup(page, groupName) {
  log(`Searching for "${groupName}"…`);

  // Clear search and type group name
  await page.click('.input-search input, [placeholder*="Search"], .search-input input');
  await page.waitForTimeout(400);
  await page.keyboard.press('Control+a');
  await page.keyboard.type(groupName.slice(0, 12), { delay: 60 }); // first 12 chars enough
  await page.waitForTimeout(1500);

  // Try exact match first, then partial
  const exactLocator   = page.locator(`.chatlist-chat:has-text("${groupName}")`).first();
  const partialLocator = page.locator(`.chatlist-chat:has-text("${groupName.slice(0, 10)}")`).first();

  const found = await exactLocator.isVisible({ timeout: 6000 }).catch(() => false)
             || await partialLocator.isVisible({ timeout: 3000 }).catch(() => false);

  if (!found) {
    warn(`Group "${groupName}" not found — skipping.`);
    return [];
  }

  const locator = await exactLocator.isVisible({ timeout: 1000 }).catch(() => false)
    ? exactLocator : partialLocator;
  await locator.click();

  await page.waitForSelector('.bubble-content, .message, [class*="bubble"]', { timeout: 15_000 });
  await page.waitForTimeout(2000);

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
    const chat = document.querySelector('.chat-content, .messages-container, #column-center');
    if (chat) return [chat.innerText || ''];
    return [];
  });

  log(`"${groupName}": ${rawMessages.length} message element(s) found.`);

  const events = [];
  for (const msgText of rawMessages) {
    const parsed = parseAnnouncement(msgText);
    if (parsed && !events.some(e => e.event_name === parsed.event_name)) {
      events.push(parsed);
    }
  }
  return events;
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log(`\nTelegram Monitor — ${GROUPS.join(', ')}`);
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

  const isLoginPage = await page.locator('.auth-form, .qr-container, [class*="login"]')
    .first().isVisible({ timeout: 6000 }).catch(() => false);

  if (isLoginPage) {
    fail('Telegram session has expired.');
    fail('Re-run:  node bin/telegram-session.mjs  to log in again.');
    process.exit(1);
  }

  await page.waitForSelector('.chatlist-chat', { timeout: 30_000 });
  log('Logged in.\n');

  // Collect events from all groups, deduplicating by event_name across groups
  const allEvents = [];
  for (const groupName of GROUPS) {
    const groupEvents = await readGroup(page, groupName);
    for (const event of groupEvents) {
      const key = event.event_name.toLowerCase().trim();
      if (!allEvents.some(e => e.event_name.toLowerCase().trim() === key)) {
        allEvents.push(event);
      } else {
        log(`  Duplicate across groups: "${event.event_name}" — keeping first occurrence.`);
      }
    }
    console.log();
  }

  if (allEvents.length === 0) {
    log('No event announcements found in any group.');
    await browser.close();
    process.exit(0);
  }

  log(`Total unique announcements found: ${allEvents.length}\n`);

  let addedCount = 0;

  for (const event of allEvents) {
    console.log(`  Event:    ${event.event_name}`);
    if (event.provider)    console.log(`  Provider: ${event.provider}`);
    console.log(`  Dates:    ${event.start_date} → ${event.end_date}`);
    if (event.banner_link) console.log(`  Banner:   ${event.banner_link}`);
    if (event.tnc_link)    console.log(`  T&C:      ${event.tnc_link}`);

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
      banner_link:    event.banner_link,
      tnc_link:       event.tnc_link,
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

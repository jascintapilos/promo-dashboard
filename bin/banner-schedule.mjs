#!/usr/bin/env node
// CLI for the Banner Schedule ID Google Sheet.
//
// Usage:
//   node bin/banner-schedule.mjs                                         # list all entries
//   node bin/banner-schedule.mjs --add --title="X" --start="Y" --end="Z" # dry-run
//   node bin/banner-schedule.mjs --add --title="X" --start="Y" --end="Z" --commit
//   node bin/banner-schedule.mjs --check --title="Campaign Title"         # exists check
//   node bin/banner-schedule.mjs --next-id                                # next available IDs
//
// All writes are dry-run by default; pass --commit to save to the live sheet.

import {
  readAllEntries,
  campaignExists,
  findNextSlots,
  addBannerEntries,
} from '../src/banner-schedule-client.js';

// ── Arg parsing ───────────────────────────────────────────────────────────────

const args  = process.argv.slice(2);
const flags = {};
for (const arg of args) {
  const m = arg.match(/^--([^=]+)(?:=(.+))?$/);
  if (m) flags[m[1]] = m[2] ?? true;
}

const MODE_ADD     = Boolean(flags.add);
const MODE_CHECK   = Boolean(flags.check);
const MODE_NEXT_ID = Boolean(flags['next-id']);
const COMMIT       = Boolean(flags.commit);
const LIST         = !MODE_ADD && !MODE_CHECK && !MODE_NEXT_ID;

// ── Helpers ───────────────────────────────────────────────────────────────────

function pad(s, n) { return String(s ?? '').padEnd(n); }
function ok(msg)   { console.log(`  ✓  ${msg}`); }
function info(msg) { console.log(`     ${msg}`); }
function warn(msg) { console.log(`  ⚠  ${msg}`); }
function err(msg)  { console.error(`  ✗  ${msg}`); }

function printEntry(e) {
  const status = e.status ? `[${e.status}]` : '[---]';
  console.log(
    `  ${pad(e.banner_id, 5)} ${pad(status, 12)} ${pad(e.brand, 6)}` +
    `  ${pad(e.campaign_title, 30)}  ${pad(e.start_date, 12)} → ${e.end_date}`
  );
}

// ── Commands ──────────────────────────────────────────────────────────────────

async function cmdList() {
  console.log('\nBanner Schedule ID — all entries\n');
  const entries = await readAllEntries();
  if (entries.length === 0) { info('Sheet is empty.'); return; }

  console.log(
    `  ${'ID'.padEnd(5)} ${'Status'.padEnd(12)} ${'Brand'.padEnd(6)}` +
    `  ${'Campaign Title'.padEnd(30)}  ${'Start'.padEnd(12)}   End`
  );
  console.log('  ' + '─'.repeat(90));

  const filled = entries.filter(e => e.campaign_title);
  const empty  = entries.filter(e => !e.campaign_title);
  for (const e of filled) printEntry(e);
  if (empty.length > 0) {
    console.log(`  ${'─'.repeat(90)}`);
    info(`${empty.length} pre-allocated slot(s) available: ${empty.map(e => e.banner_id).join(', ')}`);
  }
  console.log();
}

async function cmdCheck() {
  const title = flags.title;
  if (!title) { err('--title="Campaign Title" is required'); process.exit(1); }
  const exists = await campaignExists(title);
  if (exists) {
    warn(`"${title}" already exists in the sheet.`);
  } else {
    ok(`"${title}" is not in the sheet — safe to add.`);
  }
}

async function cmdNextId() {
  const slots = await findNextSlots(2);
  console.log('\nNext available Banner ID slots:\n');
  for (const s of slots) {
    info(`${s.banner_id}  (row ${s.row})`);
  }
  console.log();
}

async function cmdAdd() {
  const title    = flags.title;
  const start    = flags.start;
  const end      = flags.end;
  const requestor  = flags.requestor;
  const type       = flags.type;
  const platform   = flags.platform;
  const brandsRaw  = flags.brands;
  const bannerLink = flags['banner-link'];
  const tncLink    = flags['tnc-link'];

  if (!title) { err('--title is required');  process.exit(1); }
  if (!start) { err('--start is required');  process.exit(1); }
  if (!end)   { err('--end is required');    process.exit(1); }

  const brands = brandsRaw ? brandsRaw.split(',').map(s => s.trim()) : ['UG01', 'UG02'];

  const entry = {
    campaign_title: title,
    start_date:     start,
    end_date:       end,
    ...(requestor  && { requestor              }),
    ...(type       && { type                   }),
    ...(platform   && { platform               }),
    ...(bannerLink && { banner_link: bannerLink }),
    ...(tncLink    && { tnc_link:    tncLink    }),
    brands,
  };

  // Existence check before writing
  if (await campaignExists(title)) {
    warn(`"${title}" already exists in the sheet. No rows added.`);
    process.exit(0);
  }

  const slots = await addBannerEntries(entry, { dryRun: !COMMIT });

  if (!COMMIT) {
    console.log('\nDry-run — rows that WOULD be written (pass --commit to save):\n');
  } else {
    console.log('\nRows written to Banner Schedule:\n');
  }

  for (const s of slots) {
    info(`${s.banner_id}  row ${s.row}  brand=${s.brand}  "${s.campaign_title}"`);
    info(`        ${start} → ${end}  requestor=${entry.requestor ?? 'Gab'}  type=${entry.type ?? 'Vendor'}`);
  }
  console.log();

  if (COMMIT) {
    ok(`${slots.length} row(s) saved to the sheet.`);
  } else {
    info('Run with --commit to write to the live sheet.');
  }
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

(async () => {
  try {
    if (LIST)         await cmdList();
    else if (MODE_CHECK)   await cmdCheck();
    else if (MODE_NEXT_ID) await cmdNextId();
    else if (MODE_ADD)     await cmdAdd();
  } catch (e) {
    err(e.message);
    if (process.env.DEBUG) console.error(e.stack);
    process.exit(1);
  }
})();

/**
 * Pull banners from QPRO + QP2 BOs and append new rows directly to the
 * Weekly Report 'Banner Log' tab (deduplicates against existing entries).
 *
 * DRY RUN by default. Pass --write to commit.
 *
 * Coverage: QPRO (17 BOs) + QP2 (4 merchants).
 * NOT covered: WS1/WS2 — their banners live in the BIA/Directus CMS.
 *
 * Region is derived from banner images[].settings_locale_id:
 *   1 (MY_EN) or 3 (MY_ZH) → MY
 *   6 (SG_EN) or 7 (SG_ZH) → SG
 *   8 (ID_EN) or 9 (ID_ID)  → ID
 *
 * Usage:
 *   node bin/pull-bo-banners-to-sheet.mjs               # last 7 days, dry run
 *   node bin/pull-bo-banners-to-sheet.mjs --from=2026-06-08 --to=2026-06-15
 *   node bin/pull-bo-banners-to-sheet.mjs --from=2026-06-08 --to=2026-06-15 --write
 *   node bin/pull-bo-banners-to-sheet.mjs --all         # no date filter, all banners
 */
import { getAllBanners } from '../src/api-client.js';
import { QP2_BRAND_TO_IDS } from '../src/api-mapper-qp2.js';
import { getSheetsClient } from '../src/sheets-client.js';
import { getOpsSheetId } from '../src/ops-sheet.js';
import { parseArgs } from './_args.js';

const { flags } = parseArgs(process.argv.slice(2));
const WRITE     = flags.write === true;
const ALL_DATES = flags.all === true;
const SLEEP_MS  = 350;

const SHEET_ID   = getOpsSheetId();
const BANNER_TAB = 'Banner Log';

const JUNK_RX = /(^|[_\s])(TEST|CANARY|DUMMY|SAMPLE|DEMO|QC|XXX|ABC123)([_\s]|$)/i;

// settings_locale_id → region
const LOCALE_TO_REGION = { 1: 'MY', 3: 'MY', 6: 'SG', 7: 'SG', 8: 'ID', 9: 'ID' };
const REGION_ORDER = ['MY', 'SG', 'ID', 'TH', 'KH', 'AU'];

function regionFromImages(images) {
  const regions = (images || [])
    .map((im) => LOCALE_TO_REGION[im.settings_locale_id])
    .filter(Boolean);
  const uniq = [...new Set(regions)].sort((a, b) => REGION_ORDER.indexOf(a) - REGION_ORDER.indexOf(b));
  return uniq.join(' + ');
}

// ── Date window ──────────────────────────────────────────────────────────
function ymd(d) { return d.toISOString().slice(0, 10); }
const today   = new Date();
const defFrom = new Date(today.getTime() - 6 * 864e5);
const FROM    = String(flags.from || ymd(defFrom));
const TO      = String(flags.to   || ymd(today));
const FROM_MS = new Date(FROM + 'T00:00:00Z').getTime();
const TO_MS   = new Date(TO   + 'T23:59:59Z').getTime();
const inWindow = (dt) => {
  if (!dt) return false;
  const t = new Date(dt).getTime();
  return t >= FROM_MS && t <= TO_MS;
};

function ddmmyyyy(dt) {
  const d = new Date(dt);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}
function fmtBoDate(s) {
  if (!s) return '';
  const d = new Date(s.replace(' ', 'T') + 'Z');
  return isNaN(d) ? s.slice(0, 10) : ddmmyyyy(d);
}

const QPRO_BRANDS    = Array.from({ length: 17 }, (_, i) => ({ brand: `QPRO${i + 1}`, siteId: `qpro${i + 1}` }));
const QP2_MERCHANTS  = Object.entries(QP2_BRAND_TO_IDS).map(([brand, ids]) => ({ brand, siteId: 'ibc22', merchantId: ids.merchantId }));

const sleep     = (ms) => new Promise((r) => setTimeout(r, ms));
const collected = [];
const errors    = [];

console.log(`\nPulling QPRO + QP2 banners ${ALL_DATES ? '(all dates)' : `started ${FROM} … ${TO}`}  (${WRITE ? 'WRITE' : 'DRY RUN'})\n`);

// ── QPRO ──────────────────────────────────────────────────────────────────
for (const { brand, siteId } of QPRO_BRANDS) {
  process.stdout.write(`  ${brand.padEnd(8)} `);
  try {
    const { rows } = await getAllBanners(siteId);
    const win = rows.filter((r) => ALL_DATES || inWindow(r.created_at || r.start_datetime));
    for (const r of win) {
      collected.push({
        uploaded:   fmtBoDate(r.created_at || r.start_datetime),
        start:      fmtBoDate(r.start_datetime),
        brand,
        region:     regionFromImages(r.images),
        title:      r.label || '',
        end:        fmtBoDate(r.end_datetime),
        status:     r.status === 1 ? 'Active' : 'Draft',
        uploadedBy: r.created_by || '',
      });
    }
    process.stdout.write(`→ ${win.length} in window (of ${rows.length} total)\n`);
  } catch (err) {
    errors.push(`${brand}: ${err.message}`);
    process.stdout.write(`→ ERROR ${err.message.slice(0, 60)}\n`);
  }
  await sleep(SLEEP_MS);
}

// ── QP2 (dedupe by label+brand across 4 merchants) ───────────────────────
process.stdout.write(`  QP2      `);
try {
  const seen = new Map();
  for (const { brand, siteId, merchantId } of QP2_MERCHANTS) {
    const { rows } = await getAllBanners(siteId, { extra: { merchant_id: String(merchantId) } });
    for (const r of rows) {
      if (!ALL_DATES && !inWindow(r.created_at || r.start_datetime)) continue;
      const key = `${r.label}|||QP2`;
      if (!seen.has(key)) seen.set(key, { row: r, brand });
      else if (r.created_at && (!seen.get(key).row.created_at || r.created_at > seen.get(key).row.created_at))
        seen.set(key, { row: r, brand });
    }
    await sleep(SLEEP_MS);
  }
  for (const [, { row, brand }] of seen) {
    collected.push({
      uploaded:   fmtBoDate(row.created_at || row.start_datetime),
      start:      fmtBoDate(row.start_datetime),
      brand,
      region:     regionFromImages(row.images),
      title:      row.label || '',
      end:        fmtBoDate(row.end_datetime),
      status:     row.status === 1 ? 'Active' : 'Draft',
      uploadedBy: row.created_by || '',
    });
  }
  process.stdout.write(`→ ${seen.size} unique in window\n`);
} catch (err) {
  errors.push(`QP2: ${err.message}`);
  process.stdout.write(`→ ERROR ${err.message.slice(0, 60)}\n`);
}

// ── Dedupe against Banner Log ─────────────────────────────────────────────
const { sheets } = await getSheetsClient();

async function readBannerLogKeys() {
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `'${BANNER_TAB}'!A:G` });
    const rows = res.data.values || [];
    const hdr = rows[0] || [];
    const cTitle = hdr.findIndex((c) => /banner.?title/i.test(String(c)));
    const cBrand = hdr.findIndex((c) => /brand/i.test(String(c)));
    const cStart = hdr.findIndex((c) => /^start/i.test(String(c)));
    const keys = new Set();
    for (const r of rows.slice(1)) {
      const title = (r[cTitle] || '').trim(), brand = (r[cBrand] || '').trim(), start = (r[cStart] || '').trim();
      if (title) keys.add(`${title}|||${brand}|||${start}`);
    }
    return keys;
  } catch { return new Set(); }
}

const known = await readBannerLogKeys();

const fresh = [], dupes = [], junkSkipped = [];
for (const row of collected) {
  if (JUNK_RX.test(row.title)) { junkSkipped.push(row); continue; }
  (known.has(`${row.title}|||${row.brand}|||${row.start}`) ? dupes : fresh).push(row);
}

// ── Report ────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(72)}`);
console.log(`Collected ${collected.length} · NEW: ${fresh.length} · dupes: ${dupes.length} · junk skipped: ${junkSkipped.length}`);
console.log('─'.repeat(72));
if (fresh.length) {
  console.log('\nNEW rows → Banner Log:\n');
  console.log(`  ${'Start'.padEnd(11)}${'Brand'.padEnd(8)}${'Region'.padEnd(10)}${'Title'.padEnd(40)}Status`);
  for (const r of fresh) {
    console.log(`  ${r.start.padEnd(11)}${r.brand.padEnd(8)}${(r.region || '—').padEnd(10)}${r.title.slice(0, 39).padEnd(40)}${r.status}`);
  }
}
if (errors.length) console.log(`\n⚠ Errors:\n  ${errors.join('\n  ')}`);

// ── Write ─────────────────────────────────────────────────────────────────
if (WRITE && fresh.length) {
  const values = fresh.map((r) => [r.uploaded, r.start, r.brand, r.region, r.title, r.end, r.status, r.uploadedBy]);
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `'${BANNER_TAB}'!A:H`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values },
  });
  console.log(`\n✅ Appended ${values.length} rows directly to '${BANNER_TAB}'.`);
} else if (!WRITE) {
  console.log(`\n(DRY RUN — re-run with --write to append ${fresh.length} new rows to '${BANNER_TAB}'.)`);
}

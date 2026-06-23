/**
 * Backfill real "Uploaded Date" into Banner Log column A.
 * Re-fetches all banners from QPRO/QP2 BOs + WS1/WS2 CMS and matches them
 * against existing rows by (title|||brand) or (title|||brand|||start).
 *
 * Usage:
 *   node bin/backfill-banner-uploaded-date.mjs          # dry run
 *   node bin/backfill-banner-uploaded-date.mjs --write  # apply
 */
import { getAllBanners } from '../src/api-client.js';
import { QP2_BRAND_TO_IDS } from '../src/api-mapper-qp2.js';
import { cmsClient, loadCmsCreds } from '../src/cms-client.js';
import { getSheetsClient } from '../src/sheets-client.js';
import { getOpsSheetId } from '../src/ops-sheet.js';
import { parseArgs } from './_args.js';

const { flags } = parseArgs(process.argv.slice(2));
const WRITE = flags.write === true;

const SHEET_ID   = getOpsSheetId();
const BANNER_TAB = 'Banner Log';
const SLEEP_MS   = 300;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function ddmmyyyy(dt) {
  if (!dt) return '';
  const d = new Date(dt);
  if (isNaN(d)) return '';
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}
function isoDate(s) { return String(s || '').slice(0, 10); }
function baseTitle(name) {
  return String(name || '').replace(/\b(mobile|desktop)\b/gi, '').replace(/\s+/g, ' ').trim();
}

// ── 1. Read existing Banner Log ───────────────────────────────────────────
const { sheets } = await getSheetsClient();
const logRes = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `'${BANNER_TAB}'!A:H` });
const logRows = logRes.data.values || [];
const hdr = logRows[0] || [];
const ci = re => hdr.findIndex(c => re.test(String(c)));
const cUpload = ci(/uploaded.?date/i);
const cStart  = ci(/^start/i);
const cBrand  = ci(/brand/i);
const cTitle  = ci(/banner.?title/i);

console.log(`Banner Log: ${logRows.length - 1} rows  |  cols: UploadedDate=${cUpload} Start=${cStart} Brand=${cBrand} Title=${cTitle}`);

// Build index: rowNum → {title, brand, start, currentUploaded}
const sheetIndex = [];
for (let i = 1; i < logRows.length; i++) {
  const r = logRows[i];
  sheetIndex.push({
    rowNum: i + 1,
    title:    String(r[cTitle]  || '').trim(),
    brand:    String(r[cBrand]  || '').trim(),
    start:    String(r[cStart]  || '').trim(),
    current:  String(r[cUpload] || '').trim(),
  });
}

// ── 2. Fetch real uploaded dates from QPRO/QP2 ───────────────────────────
// key: title|||brand → earliest created_at (DD/MM/YYYY)
const boMap = new Map();

const QPRO_BRANDS = Array.from({length:17},(_,i)=>({brand:`QPRO${i+1}`,siteId:`qpro${i+1}`}));
const QP2_MERCHANTS = Object.entries(QP2_BRAND_TO_IDS).map(([brand,ids])=>({brand,siteId:'ibc22',merchantId:ids.merchantId}));

process.stdout.write('\nFetching QPRO banners…\n');
for (const { brand, siteId } of QPRO_BRANDS) {
  process.stdout.write(`  ${brand.padEnd(8)} `);
  try {
    const { rows } = await getAllBanners(siteId);
    for (const r of rows) {
      const key = `${r.label||''}|||${brand}`;
      const date = ddmmyyyy(r.created_at || r.start_datetime);
      if (date && (!boMap.has(key) || date < boMap.get(key))) boMap.set(key, date);
    }
    process.stdout.write(`→ ${rows.length}\n`);
  } catch (err) { process.stdout.write(`→ ERROR ${err.message.slice(0,50)}\n`); }
  await sleep(SLEEP_MS);
}
process.stdout.write('Fetching QP2 banners…\n');
try {
  // For each merchant, build title|||QP2X keys matching what pull-bo-banners-to-sheet writes to the sheet
  for (const { brand, siteId, merchantId } of QP2_MERCHANTS) {
    const { rows } = await getAllBanners(siteId, { extra: { merchant_id: String(merchantId) } });
    for (const r of rows) {
      const key = `${r.label||''}|||${brand}`;  // e.g. "Some Title|||QP2A"
      const date = ddmmyyyy(r.created_at || r.start_datetime);
      if (date && (!boMap.has(key) || date < boMap.get(key))) boMap.set(key, date);
    }
    await sleep(SLEEP_MS);
  }
  const qp2count = [...boMap.keys()].filter(k=>k.includes('|||QP2')).length;
  process.stdout.write(`  QP2: ${qp2count} banner-merchant combos\n`);
} catch (err) { process.stdout.write(`  QP2: ERROR ${err.message.slice(0,50)}\n`); }

// ── 3. Fetch real uploaded dates from CMS (WS1/WS2) ──────────────────────
// key: title|||brand|||start → created timestamp
const cmsMap = new Map();

const creds = loadCmsCreds();
const HOSTS = [
  { brand:'WS1', host: creds.hosts?.MB8   || 'https://cms.best-in-asia.com' },
  { brand:'WS2', host: creds.hosts?.RWS77 || 'https://ws2-cms.best-in-asia.com' },
];
process.stdout.write('Fetching CMS banners…\n');
for (const { brand, host } of HOSTS) {
  process.stdout.write(`  ${brand.padEnd(6)} `);
  try {
    const cms = await cmsClient(host, creds);
    const [cars, imgs, activity] = await Promise.all([
      cms.get('/items/UICarousel?limit=-1&fields=id,component_name,status').then(r=>r.data||[]),
      cms.get('/items/UICarousel_images?limit=-1&fields=id,startDate,UICarousel_id').then(r=>r.data||[]),
      cms.get('/activity?filter[collection][_eq]=UICarousel_images&filter[action][_eq]=create&limit=-1&fields=item,timestamp&sort=timestamp').then(r=>r.data||[]).catch(()=>[]),
    ]);
    const carById = new Map(cars.map(c=>[c.id,c]));
    const tsMap = new Map(); // imageId → timestamp
    for (const a of activity) if (a.item && !tsMap.has(String(a.item))) tsMap.set(String(a.item), a.timestamp);

    let count = 0;
    for (const im of imgs) {
      const car = carById.get(im.UICarousel_id);
      if (!car) continue;
      const title = baseTitle(car.component_name);
      const start = isoDate(im.startDate);
      const key = `${title}|||${brand}|||${start}`;
      const ts = tsMap.get(String(im.id));
      const uploaded = ts ? ddmmyyyy(new Date(ts)) : '';
      if (uploaded && !cmsMap.has(key)) { cmsMap.set(key, uploaded); count++; }
    }
    process.stdout.write(`→ ${count} with upload date\n`);
  } catch (err) { process.stdout.write(`→ ERROR ${err.message.slice(0,60)}\n`); }
}

// ── 4. Match and build updates ────────────────────────────────────────────
const updates = []; // {rowNum, uploaded}
let matched = 0, noMatch = 0, alreadyReal = 0;

for (const row of sheetIndex) {
  // Skip rows that already have a meaningful date (not today's backfill date)
  // We overwrite today's date since that was our placeholder
  const boKey  = `${row.title}|||${row.brand}`;
  const cmsKey = `${row.title}|||${row.brand}|||${row.start}`;
  const date = boMap.get(boKey) || cmsMap.get(cmsKey) || '';
  if (date) {
    updates.push({ rowNum: row.rowNum, uploaded: date });
    matched++;
  } else {
    noMatch++;
  }
}

console.log(`\nMatched: ${matched}  |  No match: ${noMatch}`);
if (noMatch > 0) {
  const sample = sheetIndex.filter(r => !boMap.has(`${r.title}|||${r.brand}`) && !cmsMap.has(`${r.title}|||${r.brand}|||${r.start}`)).slice(0,5);
  console.log('Sample unmatched rows:');
  sample.forEach(r => console.log(`  row ${r.rowNum}: "${r.title}" | ${r.brand} | ${r.start}`));
}

if (!WRITE) { console.log('\nDRY RUN — re-run with --write to apply.'); process.exit(0); }

// ── 5. Write in batches ───────────────────────────────────────────────────
const CHUNK = 500;
for (let i = 0; i < updates.length; i += CHUNK) {
  const chunk = updates.slice(i, i + CHUNK);
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: chunk.map(u => ({ range: `'${BANNER_TAB}'!A${u.rowNum}`, values: [[u.uploaded]] })),
    },
  });
  console.log(`  wrote rows ${chunk[0].rowNum}–${chunk[chunk.length-1].rowNum}`);
}
console.log(`\n✅ Updated ${updates.length} rows with real uploaded dates.`);

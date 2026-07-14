/**
 * Pull WS1 (MB8) + WS2 (RWS77) banners from the Directus CMS into 'Banner Log'.
 *
 * CMS banner model = UICarousel (placement, e.g. "MB8 MYS Poker TOP Mobile")
 * containing UICarousel_images (timed slides with startDate/endDate). We take
 * each slide with startDate >= --from (default 2026-01-01), resolve its parent
 * carousel for title + region + status, and MERGE the Mobile/Desktop pair of
 * the same banner into one row (per the team's "logical banner" definition).
 *
 * Creator attribution via the Directus activity log (UICarousel_images creates).
 * Non-team creators (Admin User / superadmin) are left blank.
 *
 * Idempotent: dedupes against existing Banner Log rows (Title|||Brand|||Start).
 * DRY RUN by default; --write appends new rows.
 *
 * Usage:
 *   node bin/pull-cms-banners.mjs                 # dry run, from 2026-01-01
 *   node bin/pull-cms-banners.mjs --from=2026-01-01 --write
 */
import { cmsClient, loadCmsCreds } from '../src/cms-client.js';
import { getSheetsClient } from '../src/sheets-client.js';
import { getOpsSheetId } from '../src/ops-sheet.js';
import { enforceDateFormat } from '../src/sheet-date-format.js';
import { parseArgs } from './_args.js';

const { flags } = parseArgs(process.argv.slice(2));
const WRITE = flags.write === true;
const FROM = String(flags.from || '2026-01-01');

const SHEET_ID = getOpsSheetId();
const BANNER_TAB = 'Banner Log';

function ddmmyyyy(dt) {
  const d = new Date(dt);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

// CMS country token in the carousel name → dashboard region.
const NAME_TO_REGION = { MYS: 'MY', SGP: 'SG', THA: 'TH', IDN: 'ID', KHM: 'KH' };
function regionFromName(name) {
  const up = String(name || '').toUpperCase();
  const hits = Object.entries(NAME_TO_REGION).filter(([tok]) => new RegExp(`\\b${tok}\\b`).test(up)).map(([, r]) => r);
  return [...new Set(hits)].join(' + ');
}
// Strip the device word so Mobile/Desktop of the same banner collapse to one.
function baseTitle(name) {
  return String(name || '').replace(/\b(mobile|desktop)\b/gi, '').replace(/\s+/g, ' ').trim();
}
// Derive a human-readable title from a slide's linkUrl slug, e.g.
// "/promotion/info/mb8-playtech-golden-chip-challenge" + "mb8-" → "Playtech Golden Chip Challenge"
function slugToTitle(linkUrl, brandPrefix) {
  if (!linkUrl) return '';
  const slug = String(linkUrl).split('/').pop();
  const s = (brandPrefix && slug.startsWith(brandPrefix)) ? slug.slice(brandPrefix.length) : slug;
  return s.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// Fetch imageId → linkUrl (EN preferred) from all slide translations.
async function fetchTranslationMap(cms) {
  try {
    const r = await cms.get('/items/UICarousel_images_translations?limit=-1&fields=UICarousel_images_id,languages_code,linkUrl');
    const map = new Map();
    for (const row of (r.data || [])) {
      const id = String(row.UICarousel_images_id);
      if (!map.has(id) || row.languages_code === 'en') map.set(id, row.linkUrl || '');
    }
    return map;
  } catch { return new Map(); }
}
const isoDate = (s) => String(s || '').slice(0, 10);

// Normalise CMS display names → canonical team names.
// Keys are lowercase first_name or last_name from the Directus user record.
const CMS_NAME_MAP = {
  elyssa: 'Elyssa', alyssa: 'Alysa', alysa: 'Alysa',
  wen: 'Wen', gabrielle: 'Gaby', gaby: 'Gaby',
  jascinta: 'Jascinta', bangun: 'Bangun',
  waiyip: 'Wai Yip', michelle: 'Michelle', loren: 'Michelle',
};
const NON_TEAM = new Set(['admin', 'superadmin', 'promo_']);
function cmsCreator(user) {
  if (!user) return '';
  const first = String(user.first_name || '').trim().toLowerCase();
  const last = String(user.last_name || '').trim().toLowerCase();
  if (NON_TEAM.has(first) || first.startsWith('admin')) return '';
  return CMS_NAME_MAP[first] || CMS_NAME_MAP[last] || user.first_name || '';
}

// Fetch imageId → creator map from activity log.
async function fetchCreatorMap(cms, fromDate) {
  try {
    const r = await cms.get(
      `/activity?filter[collection][_eq]=UICarousel_images&filter[action][_eq]=create` +
      `&filter[timestamp][_gte]=${fromDate}T00:00:00&limit=500` +
      `&fields=item,timestamp,user.first_name,user.last_name&sort=timestamp`
    );
    const map = new Map();
    for (const row of (r.data || [])) {
      if (row.item && !map.has(row.item)) {
        map.set(String(row.item), { creator: cmsCreator(row.user), uploaded: ddmmyyyy(new Date(row.timestamp)) });
      }
    }
    return map;
  } catch { return new Map(); }
}

const creds = loadCmsCreds();
const HOSTS = [
  { brand: 'WS1', host: creds.hosts?.MB8   || 'https://cms.best-in-asia.com',        slugPrefix: 'mb8-' },
  { brand: 'WS2', host: creds.hosts?.RWS77 || 'https://ws2-cms.best-in-asia.com',    slugPrefix: 'rws77-' },
];

const collected = [];
const errors = [];

console.log(`\nPulling WS1/WS2 CMS banners with startDate >= ${FROM}  (${WRITE ? 'WRITE' : 'DRY RUN'})\n`);

for (const { brand, host, slugPrefix } of HOSTS) {
  process.stdout.write(`  ${brand.padEnd(6)} `);
  try {
    const cms = await cmsClient(host, creds);
    const [cars, imgs, creatorMap, transMap] = await Promise.all([
      cms.get('/items/UICarousel?limit=-1&fields=id,component_name,status').then((r) => r.data || []),
      cms.get('/items/UICarousel_images?limit=-1&fields=id,startDate,endDate,UICarousel_id').then((r) => r.data || []),
      fetchCreatorMap(cms, FROM),
      fetchTranslationMap(cms),
    ]);
    const carById = new Map(cars.map((c) => [c.id, c]));

    const merged = new Map(); // title|||region|||start → row
    let slides = 0;
    for (const im of imgs) {
      if (isoDate(im.startDate) < FROM) continue;
      const car = carById.get(im.UICarousel_id);
      if (!car) continue;
      slides++;
      const carouselTitle = baseTitle(car.component_name);
      const title = slugToTitle(transMap.get(String(im.id)), slugPrefix) || carouselTitle;
      const region = regionFromName(car.component_name);
      const start = isoDate(im.startDate);
      const key = `${title}|||${region}|||${start}`;
      const act = creatorMap.get(String(im.id)) || {};
      const creator = act.creator || '';
      const uploaded = act.uploaded || '';
      if (!merged.has(key)) {
        merged.set(key, {
          uploaded, start, brand, region, title, carouselTitle,
          end: isoDate(im.endDate),
          status: car.status === 'published' ? 'Active' : 'Draft',
          creator,
        });
      } else {
        // Fill in creator/uploaded from the other device variant if first was blank
        if (!merged.get(key).creator && creator) merged.get(key).creator = creator;
        if (!merged.get(key).uploaded && uploaded) merged.get(key).uploaded = uploaded;
      }
    }
    for (const row of merged.values()) collected.push(row);
    const withCreator = [...merged.values()].filter((r) => r.creator).length;
    process.stdout.write(`→ ${slides} slides · ${merged.size} merged banners · ${withCreator} with creator\n`);
  } catch (err) {
    errors.push(`${brand}: ${err.message}`);
    process.stdout.write(`→ ERROR ${err.message.slice(0, 70)}\n`);
  }
}

// ── Dedupe against existing Banner Log ──
const { sheets } = await getSheetsClient();
async function existingKeys() {
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `'${BANNER_TAB}'!A:G` });
    const rows = res.data.values || [];
    const hdr = rows[0] || [];
    const ci = (re) => hdr.findIndex((c) => re.test(String(c)));
    const cS = ci(/^start/i), cB = ci(/brand/i), cT = ci(/banner.?title/i);
    const keys = new Set();
    for (const r of rows.slice(1)) {
      const t = (r[cT] || '').trim(), b = (r[cB] || '').trim(), s = (r[cS] || '').trim();
      if (t) keys.add(`${t}|||${b}|||${s}`);
    }
    return keys;
  } catch { return new Set(); }
}
const known = await existingKeys();
// A row is already logged if either its creative title OR its legacy carousel title matches.
// The legacy check handles rows written before this patch used generic "MB8 MYS Homepage" titles.
const fresh = collected.filter((r) =>
  !known.has(`${r.title}|||${r.brand}|||${r.start}`) &&
  !known.has(`${r.carouselTitle}|||${r.brand}|||${r.start}`)
);

console.log(`\n${'─'.repeat(72)}`);
console.log(`Collected ${collected.length} CMS banners · ${fresh.length} NEW for Banner Log · ${collected.length - fresh.length} already logged`);
if (fresh.length) {
  console.log(`\n  ${'Start'.padEnd(12)}${'Brand'.padEnd(7)}${'Region'.padEnd(9)}${'Creator'.padEnd(12)}${'Title'.padEnd(30)}Status`);
  for (const r of fresh.slice(0, 40)) {
    console.log(`  ${r.start.padEnd(12)}${r.brand.padEnd(7)}${(r.region || '—').padEnd(9)}${(r.creator || '—').padEnd(12)}${r.title.slice(0, 29).padEnd(30)}${r.status}`);
  }
  if (fresh.length > 40) console.log(`  … +${fresh.length - 40} more`);
}
if (errors.length) console.log(`\n⚠ Errors:\n  ${errors.join('\n  ')}`);

if (WRITE && fresh.length) {
  const values = fresh.map((r) => [r.uploaded || ddmmyyyy(new Date(r.start)), r.start, r.brand, r.region, r.title, r.end, r.status, r.creator]);
  const appendRes = await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID, range: `'${BANNER_TAB}'!A:H`,
    valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS',
    requestBody: { values },
  });
  console.log(`\n✅ Appended ${values.length} CMS banners to '${BANNER_TAB}'.`);

  // Same append-formatting gap as pull-bo-banners-to-sheet.mjs — force the
  // date format on exactly the rows just written.
  await enforceDateFormat(sheets, SHEET_ID, BANNER_TAB, appendRes.data.updates.updatedRange, [0, 1, 5]);
} else if (!WRITE) {
  console.log(`\n(DRY RUN — nothing written. Re-run with --write to append ${fresh.length} rows.)`);
}

/**
 * Pull promo codes from QPRO + QP2 + WS1/WS2 BOs and stage them for the
 * Weekly Report sheet ("Promo Code Log" tab), to reduce manual entry.
 *
 * DRY RUN by default — prints the rows it WOULD append and flags which already
 * exist in the sheet. Pass --write to actually append.
 *
 * Coverage: QPRO (17 BOs) + QP2 (4 merchants) + WS1 (5 country BOs) + WS2.
 * NOT covered: G8, UG/NX.
 *
 * WS1/WS2 note: requires cookie sessions in igmp-sessions.local.json.
 *   Run: node bin/igmp-keepalive.mjs   to refresh stale sessions.
 *   Sites with no session are skipped with a warning (not a fatal error).
 *   No date-window filter for WS1/WS2 (created_at not in list) — all active
 *   promos not already staged/logged are queued. Dedup handles idempotency.
 *
 * Usage:
 *   node bin/pull-bo-to-sheet.mjs                       # current week, dry run
 *   node bin/pull-bo-to-sheet.mjs --from=2026-06-08 --to=2026-06-15
 *   node bin/pull-bo-to-sheet.mjs --from=2026-06-08 --to=2026-06-15 --write
 *   node bin/pull-bo-to-sheet.mjs --include-test
 *   node bin/pull-bo-to-sheet.mjs --skip-igmp          # QPRO+QP2 only
 */
import { getAllPromotions, getPromotionDetail } from '../src/api-client.js';
import { QP2_BRAND_TO_IDS } from '../src/api-mapper-qp2.js';
import { igmpPost } from '../src/igmp-client.js';
import { getSheetsClient } from '../src/sheets-client.js';
import { getOpsSheetId } from '../src/ops-sheet.js';
import { parseArgs } from './_args.js';

const { flags } = parseArgs(process.argv.slice(2));
const WRITE        = flags.write === true;
const INCLUDE_TEST = flags['include-test'] === true;
const SKIP_IGMP    = flags['skip-igmp'] === true;
const SLEEP_MS     = 350;

// Permanent PromoOps Data sheet (created once by setup-permanent-sheet.mjs)
const SHEET_ID    = getOpsSheetId();
const PROMO_TAB   = 'Promo Code Log';        // live log (read-only here, for dedup)
const STAGING_TAB = 'BO Auto-pull (Promo)';  // where pulled rows land for team review

const CUR_TO_REGION = { MYR: 'MY', SGD: 'SG', IDR: 'ID', THB: 'TH', KHR: 'KH', AUD: 'AU' };
const REGION_ORDER  = ['MY', 'SG', 'ID', 'TH', 'KH', 'AU'];

// ── Date window (default: last 7 days incl. today, UTC) ───────────────────
function ymd(d) { return d.toISOString().slice(0, 10); }
const today = new Date();
const defFrom = new Date(today.getTime() - 6 * 864e5);
const FROM = String(flags.from || ymd(defFrom));
const TO   = String(flags.to   || ymd(today));
const FROM_MS = new Date(FROM + 'T00:00:00Z').getTime();
const TO_MS   = new Date(TO   + 'T23:59:59Z').getTime();
const inWindow = (createdAt) => {
  const t = new Date(createdAt).getTime();
  return t >= FROM_MS && t <= TO_MS;
};

function ddmmyyyy(createdAt) {
  const d = new Date(createdAt);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

const QPRO_BRANDS = Array.from({ length: 17 }, (_, i) => ({ brand: `QPRO${i + 1}`, siteId: `qpro${i + 1}` }));
const QP2_MERCHANTS = Object.entries(QP2_BRAND_TO_IDS).map(([brand, ids]) => ({ brand, merchantId: ids.merchantId }));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function regionFor(siteId, promoId, merchantId) {
  try {
    const detail = await getPromotionDetail(siteId, promoId);
    const regions = (detail.currencies || [])
      .map((c) => CUR_TO_REGION[c])
      .filter(Boolean);
    const uniq = [...new Set(regions)].sort((a, b) => REGION_ORDER.indexOf(a) - REGION_ORDER.indexOf(b));
    return uniq.join(' + ');
  } catch {
    return '';
  }
}

// Collected promo rows: { date, code, brand, region, createdBy, type, status }
const collected = [];
const errors = [];

console.log(`\nPulling QPRO + QP2 promos created ${FROM} … ${TO}  (${WRITE ? 'WRITE' : 'DRY RUN'})\n`);

// ── QPRO ──────────────────────────────────────────────────────────────────
for (const { brand, siteId } of QPRO_BRANDS) {
  process.stdout.write(`  ${brand.padEnd(8)} `);
  try {
    const { rows } = await getAllPromotions(siteId, { perPage: 500, status: 1, sortBy: 'id', sortOrder: 'desc' });
    const win = rows.filter((r) => r.created_at && inWindow(r.created_at) && (INCLUDE_TEST || !/^TEST_/i.test(r.code)));
    for (const r of win) {
      const region = await regionFor(siteId, r.id);
      collected.push({
        date: ddmmyyyy(r.created_at), code: r.code, brand, region,
        createdBy: 'promo test bot', type: ({1:'Deposit',2:'Cashback',3:'Free Credit',4:'Free Spin',5:'Rebate'}[r.promo_type] || `type_${r.promo_type}`),
        status: 'Created',
      });
    }
    process.stdout.write(`→ ${win.length} in window\n`);
  } catch (err) {
    errors.push(`${brand}: ${err.message}`);
    process.stdout.write(`→ ERROR ${err.message.slice(0, 60)}\n`);
  }
  await sleep(SLEEP_MS);
}

// ── QP2 (one BO, 4 merchants, dedupe by code) ─────────────────────────────
process.stdout.write(`  QP2      `);
try {
  const seen = new Map(); // code → {row, brand, merchantId}
  for (const { brand, merchantId } of QP2_MERCHANTS) {
    const { rows } = await getAllPromotions('ibc22', { perPage: 500, status: 1, merchantId, sortBy: 'id', sortOrder: 'desc' });
    for (const r of rows) {
      if (!r.created_at || !inWindow(r.created_at)) continue;
      if (!INCLUDE_TEST && /^TEST_/i.test(r.code)) continue;
      if (!seen.has(r.code)) seen.set(r.code, { row: r, brand, merchantId });
    }
    await sleep(SLEEP_MS);
  }
  for (const [, { row, brand, merchantId }] of seen) {
    const region = await regionFor('ibc22', row.id, merchantId);
    collected.push({
      date: ddmmyyyy(row.created_at), code: row.code, brand, region,
      createdBy: 'promo test bot', type: ({1:'Deposit',2:'Cashback',3:'Free Credit',4:'Free Spin',5:'Rebate'}[row.promo_type] || `type_${row.promo_type}`),
      status: 'Created',
    });
  }
  process.stdout.write(`→ ${seen.size} unique in window\n`);
} catch (err) {
  errors.push(`QP2: ${err.message}`);
  process.stdout.write(`→ ERROR ${err.message.slice(0, 60)}\n`);
}

// ── WS1 / WS2 (IGMP) ─────────────────────────────────────────────────────
// No date-window filter here — GetPromotionsList has no created_at.
// All active promos not already in staging/live will be queued.
// Sites without a valid session in igmp-sessions.local.json are skipped.
const IGMP_SITES = [
  { siteId: 'ws1-v3-my', brand: 'WS1', region: 'MY' },
  { siteId: 'ws1-v3-sg', brand: 'WS1', region: 'SG' },
  { siteId: 'ws1-v3-id', brand: 'WS1', region: 'ID' },
  { siteId: 'ws1-v3-th', brand: 'WS1', region: 'TH' },
  { siteId: 'ws1-v3-kh', brand: 'WS1', region: 'KH' },
  { siteId: 'ws2',        brand: 'WS2', region: 'MY' },
];
const IGMP_TYPE_LABEL = { Bonus: 'Deposit', FreeCredit: 'Free Credit', FreeSpin: 'Free Spin' };

// Parse IGMP DD-MM-YYYY [HH:MM:SS] → DD/MM/YYYY for the sheet
function igmpDateFmt(ds) {
  if (!ds || typeof ds !== 'string') return '';
  const m = ds.match(/^(\d{2})-(\d{2})-(\d{4})/);
  return m ? `${m[1]}/${m[2]}/${m[3]}` : '';
}

if (!SKIP_IGMP) {
  // Collect by code+brand so the same promo on multiple WS1 country BOs
  // merges into one row with combined regions (e.g. MY + SG + ID).
  const igmpSeen = new Map(); // `code|||brand` → { row, regions: string[] }
  for (const { siteId, brand, region } of IGMP_SITES) {
    process.stdout.write(`  ${(brand + '/' + region).padEnd(10)} `);
    try {
      const all = [];
      for (let pg = 1; pg <= 40; pg++) {
        const r = await igmpPost(siteId, `/PM/GetPromotionsList?pageNum=${pg}&rowPerPage=200`,
          // PromotionType MUST be '' (all types) — 0 silently filters to Bonus-only
          // and drops every FreeCredit/FreeSpin promo (confirmed live 2026-07-05).
          { PromotionCode: '', PromotionName: '', PromotionType: '', IsActive: '', IsPublished: '' });
        const rows = r?.data || [];
        if (!rows.length) break;
        all.push(...rows);
        if (rows.length < 200) break;
      }
      const active = all.filter((p) =>
        p.IsActive &&
        (INCLUDE_TEST || !/^TEST_/i.test(p.PromotionCode))
      );
      for (const row of active) {
        const key = `${row.PromotionCode}|||${brand}`;
        if (!igmpSeen.has(key)) {
          igmpSeen.set(key, { row, brand, regions: [region] });
        } else {
          const existing = igmpSeen.get(key);
          if (!existing.regions.includes(region)) existing.regions.push(region);
        }
      }
      process.stdout.write(`→ ${active.length} active\n`);
    } catch (err) {
      const msg = err.message || '';
      if (/no cookie/i.test(msg) || /no session/i.test(msg) || /igmp-sessions/i.test(msg)) {
        process.stdout.write(`→ SKIP (no session — run igmp-keepalive.mjs first)\n`);
      } else {
        errors.push(`IGMP ${siteId}: ${msg.slice(0, 80)}`);
        process.stdout.write(`→ ERROR ${msg.slice(0, 60)}\n`);
      }
    }
    await sleep(SLEEP_MS);
  }
  for (const [, { row, brand, regions }] of igmpSeen) {
    const sortedRegions = regions.slice().sort((a, b) => REGION_ORDER.indexOf(a) - REGION_ORDER.indexOf(b));
    collected.push({
      date: igmpDateFmt(row.PromotionStartDate),
      code: row.PromotionCode,
      brand,
      region: sortedRegions.join(' + '),
      createdBy: '',
      type: IGMP_TYPE_LABEL[row.PromotionType] || row.PromotionType || '',
      status: 'Active',
    });
  }
}

// ── Dedupe against the live log AND the staging tab ───────────────────────
const { sheets } = await getSheetsClient();

async function readCodeBrandKeys(tab) {
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `'${tab}'!A:H` });
    const rows = res.data.values || [];
    const hdr = rows.find((r) => r.map((c) => String(c).toLowerCase().trim()).includes('code')) || [];
    const cCode  = hdr.findIndex((c) => String(c).toLowerCase().trim() === 'code');
    const cBrand = hdr.findIndex((c) => String(c).toLowerCase().trim() === 'brand');
    const keys = new Set();
    for (const r of rows) {
      const code = (r[cCode] || '').trim(), brand = (r[cBrand] || '').trim();
      if (code && code.toLowerCase() !== 'code') keys.add(`${code}|||${brand}`);
    }
    return keys;
  } catch { return new Set(); } // tab may not exist yet
}

const liveKeys    = await readCodeBrandKeys(PROMO_TAB);
const stagingKeys = await readCodeBrandKeys(STAGING_TAB);
const known = new Set([...liveKeys, ...stagingKeys]);

const fresh = [], dupes = [];
for (const row of collected) {
  (known.has(`${row.code}|||${row.brand}`) ? dupes : fresh).push(row);
}

// ── Report ────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(72)}`);
console.log(`Collected ${collected.length} in window · ${fresh.length} NEW for staging · ${dupes.length} already logged/staged`);
console.log('─'.repeat(72));
if (fresh.length) {
  console.log('\nNEW rows → staging tab:\n');
  console.log(`  ${'Date'.padEnd(11)}${'Code'.padEnd(26)}${'Brand'.padEnd(8)}${'Region'.padEnd(10)}${'Type'.padEnd(13)}Status`);
  for (const r of fresh) {
    console.log(`  ${r.date.padEnd(11)}${r.code.padEnd(26)}${r.brand.padEnd(8)}${(r.region||'—').padEnd(10)}${r.type.padEnd(13)}${r.status}`);
  }
}
if (errors.length) console.log(`\n⚠ Errors:\n  ${errors.join('\n  ')}`);

// ── Ensure staging tab exists (create + header if missing) ────────────────
async function ensureStagingTab() {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID, fields: 'sheets.properties(title)' });
  const exists = (meta.data.sheets || []).some((s) => s.properties.title === STAGING_TAB);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: STAGING_TAB } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID, range: `'${STAGING_TAB}'!A1`, valueInputOption: 'RAW',
      requestBody: { values: [['Date', 'Code', 'Brand', 'Region', 'Created By', 'Type', 'Status', 'Pulled at']] },
    });
    console.log(`\n(created staging tab '${STAGING_TAB}')`);
  }
}

// ── Write to staging ──────────────────────────────────────────────────────
if (WRITE && fresh.length) {
  await ensureStagingTab();
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const values = fresh.map((r) => [r.date, r.code, r.brand, r.region, r.createdBy, r.type, r.status, stamp]);
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID, range: `'${STAGING_TAB}'!A:H`,
    valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS',
    requestBody: { values },
  });
  console.log(`\n✅ Appended ${values.length} rows to staging tab '${STAGING_TAB}'. Team can review & copy into '${PROMO_TAB}'.`);
} else if (!WRITE) {
  console.log(`\n(DRY RUN — no rows written. Re-run with --write to stage the ${fresh.length} new rows in '${STAGING_TAB}'.)`);
}

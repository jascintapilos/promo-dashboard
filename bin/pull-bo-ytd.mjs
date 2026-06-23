/**
 * YTD backfill: pull every TEAM-created promo (per src/promo-team.js) created
 * since --from (default 2026-01-01) from QPRO + QP2, and write the full set
 * directly into the dashboard's 'Promo Code Log' tab.
 *
 * Fast: region + real creator both come from the LIST row (currencies,
 * created_by), so there is NO per-promo detail call. Fetches status=1 (active)
 * AND status=0 (inactive/ended) so promos created this year that have since
 * expired are still counted.
 *
 * On --write this REPLACES the 'Promo Code Log' contents (header kept) with the
 * authoritative YTD set — the data is 100% reproducible from BO, not
 * hand-entered, so a clean rewrite is safe and avoids placeholder-creator dupes
 * from the older incremental pull.
 *
 * Usage:
 *   node bin/pull-bo-ytd.mjs                      # dry run, from 2026-01-01
 *   node bin/pull-bo-ytd.mjs --from=2026-01-01    # explicit start
 *   node bin/pull-bo-ytd.mjs --write              # rewrite Promo Code Log
 *   node bin/pull-bo-ytd.mjs --include-nonteam    # skip the team filter (audit)
 */
import { getAllPromotions } from '../src/api-client.js';
import { QP2_BRAND_TO_IDS } from '../src/api-mapper-qp2.js';
import { igmpPost } from '../src/igmp-client.js';
import { getSheetsClient } from '../src/sheets-client.js';
import { getOpsSheetId } from '../src/ops-sheet.js';
import { isTeam, displayName, currenciesToRegion, PROMO_TYPE_LABEL } from '../src/promo-team.js';
import { parseArgs } from './_args.js';

const { flags } = parseArgs(process.argv.slice(2));
const WRITE = flags.write === true;
const FROM = String(flags.from || '2026-01-01');
const INCLUDE_NONTEAM = flags['include-nonteam'] === true;
const SKIP_IGMP = flags['skip-igmp'] === true;
const SLEEP_MS = 300;

const SHEET_ID = getOpsSheetId();
const PROMO_TAB = 'Promo Code Log';

const QPRO_BRANDS = Array.from({ length: 17 }, (_, i) => ({ brand: `QPRO${i + 1}`, siteId: `qpro${i + 1}` }));
const QP2_MERCHANTS = Object.entries(QP2_BRAND_TO_IDS).map(([brand, ids]) => ({ brand, merchantId: ids.merchantId }));

// WS1 (5 country BOs) + WS2. No created_at/created_by on GetPromotionsList, so
// we use PromotionStartDate as the YTD date proxy and leave Created By blank.
// These ARE the team's promo-automation scope, so no creator filter applies.
const IGMP_SITES = [
  { siteId: 'ws1-v3-my', brand: 'WS1', region: 'MY' },
  { siteId: 'ws1-v3-sg', brand: 'WS1', region: 'SG' },
  { siteId: 'ws1-v3-id', brand: 'WS1', region: 'ID' },
  { siteId: 'ws1-v3-th', brand: 'WS1', region: 'TH' },
  { siteId: 'ws1-v3-kh', brand: 'WS1', region: 'KH' },
  { siteId: 'ws2',        brand: 'WS2', region: 'MY' },
];
const IGMP_TYPE_LABEL = { Bonus: 'Deposit', FreeCredit: 'Free Credit', FreeSpin: 'Free Spin' };
const IGMP_BRANDS = ['WS1', 'WS2'];
const REGION_ORDER = ['MY', 'SG', 'ID', 'TH', 'KH', 'AU'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// IGMP dates: "DD-MM-YYYY HH:MM:SS" (LogTimeStamp) or "DD/MM/YYYY" (start).
function igmpDateToYmd(ds) {
  const m = String(ds || '').match(/^(\d{2})[/-](\d{2})[/-](\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}
function igmpDateToDdmmyyyy(ds) {
  const m = String(ds || '').match(/^(\d{2})[/-](\d{2})[/-](\d{4})/);
  return m ? `${m[1]}/${m[2]}/${m[3]}` : '';
}

// Detail endpoint per promo type — returns the real created date + creator from
// the promo's Log (GetPromotionsList omits these; start date is unreliable).
const IGMP_DETAIL_EP = { Bonus: '/PM/GetBonusInfo', FreeCredit: '/PM/GetFreeCreditInfo', FreeSpin: '/PM/GetFreeSpinPromotionInfo' };
// FS returns data flat at d.data; Deposit + FC wrap theirs in d.data.Promotion
async function igmpCreatedInfo(siteId, p) {
  const ep = IGMP_DETAIL_EP[p.PromotionType] || IGMP_DETAIL_EP.Bonus;
  const d = await igmpPost(siteId, ep, { PromotionId: p.PromotionId });
  const raw = d?.data || {};
  const pr = raw.Promotion || raw;
  return { created: pr.LogTimeStamp || '', createdBy: pr.CreatedBy?.ActorLogin || '' };
}

// Bounded-concurrency map (be gentle on the BO — small pool).
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; try { out[idx] = await fn(items[idx], idx); } catch { out[idx] = null; } }
  }));
  return out;
}
const inYtd = (createdAt) => createdAt && String(createdAt).slice(0, 10) >= FROM;

function ddmmyyyy(createdAt) {
  const d = new Date(createdAt);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

// Fetch active + inactive for a site/merchant, merge, dedupe by id.
async function fetchAllStatuses(siteId, merchantId) {
  const out = new Map();
  for (const status of [1, 0]) {
    const { rows } = await getAllPromotions(siteId, { perPage: 500, status, merchantId, sortBy: 'created_at', sortOrder: 'desc' });
    for (const r of rows) if (!out.has(r.id)) out.set(r.id, r);
    await sleep(SLEEP_MS);
  }
  return [...out.values()];
}

function toRow(r, brand) {
  return {
    date: ddmmyyyy(r.created_at),
    code: r.code,
    brand,
    region: currenciesToRegion(r.currencies),
    createdBy: displayName(r.created_by),
    type: PROMO_TYPE_LABEL[r.promo_type] || `type_${r.promo_type}`,
    status: r.status === 1 ? 'Active' : 'Ended',
    _createdAt: r.created_at,
  };
}

const collected = [];
const errors = [];
const creatorTally = {};

console.log(`\nYTD backfill — team promos created since ${FROM}  (${WRITE ? 'WRITE' : 'DRY RUN'})\n`);

// ── QPRO ──
for (const { brand, siteId } of QPRO_BRANDS) {
  process.stdout.write(`  ${brand.padEnd(8)} `);
  try {
    const all = await fetchAllStatuses(siteId);
    let kept = 0;
    for (const r of all) {
      if (!inYtd(r.created_at)) continue;
      if (!INCLUDE_NONTEAM && !isTeam(r.created_by)) continue;
      creatorTally[r.created_by] = (creatorTally[r.created_by] || 0) + 1;
      collected.push(toRow(r, brand));
      kept++;
    }
    process.stdout.write(`→ ${all.length} total · ${kept} team YTD\n`);
  } catch (err) {
    errors.push(`${brand}: ${err.message}`);
    process.stdout.write(`→ ERROR ${err.message.slice(0, 60)}\n`);
  }
}

// ── QP2 (shared BO 'ibc22', dedupe by code across merchants) ──
process.stdout.write(`  QP2      `);
try {
  const seen = new Map(); // code → { row, brand }
  for (const { brand, merchantId } of QP2_MERCHANTS) {
    const all = await fetchAllStatuses('ibc22', merchantId);
    for (const r of all) {
      if (!inYtd(r.created_at)) continue;
      if (!INCLUDE_NONTEAM && !isTeam(r.created_by)) continue;
      if (!seen.has(r.code)) seen.set(r.code, { row: r, brand });
    }
  }
  for (const [, { row, brand }] of seen) {
    creatorTally[row.created_by] = (creatorTally[row.created_by] || 0) + 1;
    collected.push(toRow(row, brand));
  }
  process.stdout.write(`→ ${seen.size} team YTD (unique codes)\n`);
} catch (err) {
  errors.push(`QP2: ${err.message}`);
  process.stdout.write(`→ ERROR ${err.message.slice(0, 60)}\n`);
}

// ── WS1 / WS2 (IGMP) ──
// GetPromotionsList has no created date/creator and PromotionStartDate is
// unreliable (backdated — e.g. created Nov-2025 but start 01/01/2025). So for
// every active non-TEST promo we fetch the detail Log (LogTimeStamp = created,
// CreatedBy.ActorLogin = creator) and YTD-filter on the REAL created date.
// Merged across the 5 WS1 country BOs into one row per code (earliest created,
// combined regions). No team filter — WS1/WS2 is wholly the team's scope.
let igmpAnySuccess = false;
const igmpCreatorTally = {};
if (!SKIP_IGMP) {
  const igmpSeen = new Map(); // `code|||brand` → { regions:Set, created, createdBy, type }
  for (const { siteId, brand, region } of IGMP_SITES) {
    process.stdout.write(`  ${(brand + '/' + region).padEnd(10)} `);
    try {
      // Fetch all 3 bonus types: 0=Deposit, 4=FreeCredit, 11=FreeSpin
      const all = [];
      for (const promoType of [0, 4, 11]) {
        for (let pg = 1; pg <= 40; pg++) {
          const r = await igmpPost(siteId, `/PM/GetPromotionsList?pageNum=${pg}&rowPerPage=200`,
            { PromotionCode: '', PromotionName: '', PromotionType: promoType, IsActive: '', IsPublished: '' });
          const rows = r?.data || [];
          if (!rows.length) break;
          all.push(...rows);
          if (rows.length < 200) break;
        }
      }
      igmpAnySuccess = true;
      const active = all.filter((p) => p.IsActive && !/^TEST_/i.test(p.PromotionCode) && !/\bTEST\b/i.test(p.PromotionCode));
      // Fetch created date + creator for each (bounded concurrency).
      const infos = await mapLimit(active, 5, (p) => igmpCreatedInfo(siteId, p));
      let kept = 0;
      active.forEach((p, idx) => {
        const info = infos[idx];
        if (!info) return;
        const ymd = igmpDateToYmd(info.created);
        if (!ymd || ymd < FROM) return;               // YTD filter on REAL created date
        const key = `${p.PromotionCode}|||${brand}`;
        if (!igmpSeen.has(key)) {
          igmpSeen.set(key, { regions: new Set([region]), created: info.created, createdBy: info.createdBy, type: p.PromotionType });
        } else {
          const e = igmpSeen.get(key);
          e.regions.add(region);
          if (igmpDateToYmd(info.created) < igmpDateToYmd(e.created)) { e.created = info.created; e.createdBy = info.createdBy; }
        }
        kept++;
      });
      process.stdout.write(`→ ${all.length} listed · ${active.length} active · ${kept} created YTD\n`);
    } catch (err) {
      const msg = err.message || '';
      if (/no cookie|no session|igmp-sessions/i.test(msg)) {
        process.stdout.write(`→ SKIP (no session — run igmp-keepalive.mjs)\n`);
      } else {
        errors.push(`IGMP ${siteId}: ${msg.slice(0, 80)}`);
        process.stdout.write(`→ ERROR ${msg.slice(0, 50)}\n`);
      }
    }
    await sleep(SLEEP_MS);
  }
  for (const [key, { regions, created, createdBy, type }] of igmpSeen) {
    const [code, brand] = key.split('|||');
    const sorted = [...regions].sort((a, b) => REGION_ORDER.indexOf(a) - REGION_ORDER.indexOf(b));
    igmpCreatorTally[createdBy || '(blank)'] = (igmpCreatorTally[createdBy || '(blank)'] || 0) + 1;
    collected.push({
      date: igmpDateToDdmmyyyy(created),
      code, brand,
      region: sorted.join(' + '),
      createdBy: displayName(createdBy),
      type: IGMP_TYPE_LABEL[type] || type || '',
      status: 'Active',
      _createdAt: igmpDateToYmd(created),
    });
  }
  console.log(`  WS1/WS2  → ${igmpSeen.size} created YTD (unique code×brand)`);
  const tally = Object.entries(igmpCreatorTally).sort((a, b) => b[1] - a[1]);
  if (tally.length) console.log('    WS1/WS2 creators: ' + tally.map(([c, n]) => `${c}:${n}`).join(', '));
}

// ── Carry-forward safeguard ──
// The write REPLACES Promo Code Log. WS1/WS2 can fail independently (stale
// IGMP session) — if it did (or was skipped), preserve the WS1/WS2 rows already
// in the sheet so a bad-session run doesn't wipe them. QPRO/QP2 always refresh.
if (SKIP_IGMP || !igmpAnySuccess) {
  try {
    const { sheets } = await getSheetsClient();
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `'${PROMO_TAB}'!A:G` });
    const rows = res.data.values || [];
    const hdr = rows[0] || [];
    const ci = (name) => hdr.findIndex((c) => String(c).toLowerCase().trim() === name);
    const [cd, cc, cb, cr, ce, ct, cs] = ['date','code','brand','region','created by','type','status'].map(ci);
    let carried = 0;
    for (const r of rows.slice(1)) {
      if (!IGMP_BRANDS.includes((r[cb] || '').trim())) continue;
      collected.push({
        date: r[cd] || '', code: r[cc] || '', brand: (r[cb] || '').trim(), region: r[cr] || '',
        createdBy: r[ce] || '', type: r[ct] || '', status: r[cs] || '', _createdAt: '',
      });
      carried++;
    }
    if (carried) console.log(`  (carried forward ${carried} existing WS1/WS2 rows — IGMP ${SKIP_IGMP ? 'skipped' : 'unavailable'})`);
  } catch { /* sheet may be empty/new — nothing to carry */ }
}

// ── Dedupe by code|||brand (a code can recur across QPRO brands) ──
const byKey = new Map();
for (const row of collected) {
  const k = `${row.code}|||${row.brand}`;
  if (!byKey.has(k)) byKey.set(k, row);
}
const finalRows = [...byKey.values()].sort((a, b) => (b._createdAt || '').localeCompare(a._createdAt || ''));

console.log(`\n${'─'.repeat(72)}`);
console.log(`Collected ${collected.length} · ${finalRows.length} unique team promos created since ${FROM}`);
console.log('Creator tally:');
for (const [c, n] of Object.entries(creatorTally).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${displayName(c).padEnd(16)} (${String(c).padEnd(16)}) ${n}`);
}
if (errors.length) console.log(`\n⚠ Errors:\n  ${errors.join('\n  ')}`);

// ── Write: replace Promo Code Log contents ──
if (WRITE && finalRows.length) {
  const { sheets } = await getSheetsClient();
  const header = ['Date', 'Code', 'Brand', 'Region', 'Created By', 'Type', 'Status'];
  const values = finalRows.map((r) => [r.date, r.code, r.brand, r.region, r.createdBy, r.type, r.status]);
  // Clear old contents (header + data), then write fresh.
  await sheets.spreadsheets.values.clear({ spreadsheetId: SHEET_ID, range: `'${PROMO_TAB}'!A:Z` });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID, range: `'${PROMO_TAB}'!A1`, valueInputOption: 'USER_ENTERED',
    requestBody: { values: [header, ...values] },
  });
  console.log(`\n✅ Rewrote '${PROMO_TAB}' with ${values.length} YTD team promos.`);
} else if (!WRITE) {
  console.log(`\n(DRY RUN — nothing written. Re-run with --write to rewrite '${PROMO_TAB}' with ${finalRows.length} rows.)`);
}

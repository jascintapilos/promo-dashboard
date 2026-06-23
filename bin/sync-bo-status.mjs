#!/usr/bin/env node
/**
 * sync-bo-status.mjs
 *
 * Fetches live promo + banner counts from every QPRO / QP2 back-office and
 * writes the aggregated results to the BO_Status tab of the PromoOps_Control_Layer
 * Google Sheet (16iI85GrAqldbBcGhpvAwJT3_3JJDqLemLaGhjPXMlQk).
 *
 * The Apps Script dashboard reads this tab via serverGetBOStatus() to show
 * live BO health on the Reports page.
 *
 * Usage:
 *   node bin/sync-bo-status.mjs                           # sync all sites
 *   node bin/sync-bo-status.mjs --dry-run                 # print, skip sheet write
 *   node bin/sync-bo-status.mjs --sites=qpro1,qpro2,ibc22 # subset only
 *   node bin/sync-bo-status.mjs --concurrency=5           # parallel sites (default 3)
 *
 * Prerequisites:
 *   node bin/sheets-oauth.mjs   ← run once to get OAuth token with spreadsheets scope
 */

import { listSites } from '../src/sites.js';
import { getAllPromotions, getAllBanners } from '../src/api-client.js';
import { getGoogleAuth, loadGoogleapis } from '../src/google-auth.js';

// ── CLI args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const sitesArg  = args.find(a => a.startsWith('--sites='));
const concurArg = args.find(a => a.startsWith('--concurrency='));
const CONCURRENCY = concurArg ? Math.max(1, Number(concurArg.split('=')[1]) || 3) : 3;
const siteFilter  = sitesArg ? new Set(sitesArg.slice('--sites='.length).split(',').map(s => s.trim())) : null;

// ── Constants ───────────────────────────────────────────────────────────────
const CONTROL_LAYER_ID = '16iI85GrAqldbBcGhpvAwJT3_3JJDqLemLaGhjPXMlQk';
const BO_STATUS_TAB    = 'BO_Status';

const HEADERS = [
  'site_id', 'merchant_code', 'label', 'platform',
  'promo_active', 'promo_inactive', 'promo_total',
  'banner_active', 'banner_inactive', 'banner_total',
  'last_sync', 'sync_status', 'sync_error',
];

// ── Site selection ──────────────────────────────────────────────────────────
// WS1/WS2 use the BIA platform (Directus CMS) — no QPRO/QP2 API, skip them.
const allSites = listSites().filter(s => s.platform === 'qpro' || s.platform === 'qp2');
const sites    = siteFilter ? allSites.filter(s => siteFilter.has(s.id)) : allSites;

if (sites.length === 0) {
  console.error('No matching sites. Check --sites= values or bo-sites.json.');
  process.exit(1);
}

console.log(`\n━━ BO Status Sync — ${new Date().toISOString()} ━━`);
console.log(`Sites      : ${sites.length} (${sites.map(s => s.id).join(', ')})`);
console.log(`Concurrency: ${CONCURRENCY}`);
if (DRY_RUN) console.log('Mode       : DRY-RUN (no sheet write)');
console.log('');

// ── Per-site fetch ──────────────────────────────────────────────────────────
async function syncSite(site) {
  const tag = `[${site.id.padEnd(8)}]`;
  try {
    process.stdout.write(`${tag} fetching…\r`);
    // Run all 4 counts in parallel; catch per-call so a banner 404 doesn't
    // abort the promo count (and vice-versa).
    const [promoActive, promoInactive, bannerActive, bannerInactive] = await Promise.all([
      getAllPromotions(site, { status: 1 }).catch(e => ({ total: -1, _err: `promoActive: ${e.message}` })),
      getAllPromotions(site, { status: 0 }).catch(e => ({ total: -1, _err: `promoInactive: ${e.message}` })),
      getAllBanners(site,    { status: 1 }).catch(e => ({ total: -1, _err: `bannerActive: ${e.message}` })),
      getAllBanners(site,    { status: 0 }).catch(e => ({ total: -1, _err: `bannerInactive: ${e.message}` })),
    ]);

    const errors = [promoActive._err, promoInactive._err, bannerActive._err, bannerInactive._err]
      .filter(Boolean);

    const pa = typeof promoActive.total  === 'number' && promoActive.total  >= 0 ? promoActive.total  : null;
    const pi = typeof promoInactive.total === 'number' && promoInactive.total >= 0 ? promoInactive.total : null;
    const ba = typeof bannerActive.total  === 'number' && bannerActive.total  >= 0 ? bannerActive.total  : null;
    const bi = typeof bannerInactive.total === 'number' && bannerInactive.total >= 0 ? bannerInactive.total : null;

    const statusSymbol = errors.length === 0 ? '✓' : '⚠';
    console.log(`${tag} ${statusSymbol} promos: ${pa ?? '?'}/${pi ?? '?'} (active/inactive) | banners: ${ba ?? '?'}/${bi ?? '?'}${errors.length ? '  ERR: ' + errors[0] : ''}`);

    return {
      site_id:         site.id,
      merchant_code:   site.loginMerchantCode || site.id,
      label:           site.label,
      platform:        site.platform,
      promo_active:    pa ?? '',
      promo_inactive:  pi ?? '',
      promo_total:     pa != null && pi != null ? pa + pi : '',
      banner_active:   ba ?? '',
      banner_inactive: bi ?? '',
      banner_total:    ba != null && bi != null ? ba + bi : '',
      last_sync:       new Date().toISOString(),
      sync_status:     errors.length === 0 ? 'ok' : 'partial',
      sync_error:      errors.join(' | ').slice(0, 300),
    };
  } catch (e) {
    console.error(`${tag} ✗ ${e.message.split('\n')[0]}`);
    return {
      site_id:         site.id,
      merchant_code:   site.loginMerchantCode || site.id,
      label:           site.label,
      platform:        site.platform,
      promo_active: '', promo_inactive: '', promo_total: '',
      banner_active: '', banner_inactive: '', banner_total: '',
      last_sync:       new Date().toISOString(),
      sync_status:     'error',
      sync_error:      e.message.slice(0, 300),
    };
  }
}

// ── Batched concurrent processing ───────────────────────────────────────────
const rows = [];
for (let i = 0; i < sites.length; i += CONCURRENCY) {
  const batch = sites.slice(i, i + CONCURRENCY);
  const batchResults = await Promise.all(batch.map(syncSite));
  rows.push(...batchResults);
}

// ── Summary ─────────────────────────────────────────────────────────────────
console.log('\n── Summary ──────────────────────────────────────');
const okCount      = rows.filter(r => r.sync_status === 'ok').length;
const partialCount = rows.filter(r => r.sync_status === 'partial').length;
const errorCount   = rows.filter(r => r.sync_status === 'error').length;
const totalPromoActive  = rows.reduce((s, r) => s + (Number(r.promo_active)  || 0), 0);
const totalBannerActive = rows.reduce((s, r) => s + (Number(r.banner_active) || 0), 0);
console.log(`Sync: ✓ ${okCount} ok  ⚠ ${partialCount} partial  ✗ ${errorCount} error`);
console.log(`Totals: ${totalPromoActive} active promos | ${totalBannerActive} active banners`);

if (DRY_RUN) {
  console.log('\nDRY-RUN — rows that would be written to sheet:');
  console.table(rows.map(r => ({
    site:    r.site_id,
    code:    r.merchant_code,
    P_act:   r.promo_active,
    P_ina:   r.promo_inactive,
    B_act:   r.banner_active,
    B_ina:   r.banner_inactive,
    status:  r.sync_status,
  })));
  process.exit(errorCount > 0 ? 1 : 0);
}

// ── Google Sheet write ───────────────────────────────────────────────────────
console.log('\nConnecting to Google Sheets…');
let sheetsApi;
try {
  const { client, email, mode } = await getGoogleAuth();
  const { google } = await loadGoogleapis();
  sheetsApi = google.sheets({ version: 'v4', auth: client });
  console.log(`  Auth: ${mode}  email: ${email || '(unknown)'}`);
} catch (e) {
  console.error('Auth failed:', e.message);
  console.error('  Run: node bin/sheets-oauth.mjs   to refresh the OAuth token.');
  process.exit(1);
}

// ── Ensure BO_Status tab exists ──────────────────────────────────────────────
let sheetTitles;
try {
  const meta = await sheetsApi.spreadsheets.get({
    spreadsheetId: CONTROL_LAYER_ID,
    fields: 'sheets.properties(title)',
  });
  sheetTitles = (meta.data.sheets || []).map(s => s.properties.title);
} catch (e) {
  console.error('Failed to read spreadsheet metadata:', e.message);
  process.exit(1);
}

if (!sheetTitles.includes(BO_STATUS_TAB)) {
  try {
    await sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId: CONTROL_LAYER_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: BO_STATUS_TAB } } }] },
    });
    console.log(`  Created new tab: ${BO_STATUS_TAB}`);
  } catch (e) {
    console.error(`Failed to create tab "${BO_STATUS_TAB}":`, e.message);
    process.exit(1);
  }
}

// ── Write header + data rows in one call ────────────────────────────────────
const values = [
  HEADERS,
  ...rows.map(r => HEADERS.map(h => r[h] ?? '')),
];

try {
  await sheetsApi.spreadsheets.values.update({
    spreadsheetId: CONTROL_LAYER_ID,
    range: `'${BO_STATUS_TAB}'!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values },
  });
  console.log(`✓ ${values.length} rows written to ${BO_STATUS_TAB} (${rows.length} brands + 1 header)`);
} catch (e) {
  console.error('Sheet write failed:', e.message);
  process.exit(1);
}

console.log(`\nSheet: https://docs.google.com/spreadsheets/d/${CONTROL_LAYER_ID}`);
console.log('Done.\n');
process.exit(errorCount > 0 ? 1 : 0);

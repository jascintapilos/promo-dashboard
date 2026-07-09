#!/usr/bin/env node
// banner-health-check.mjs
//
// Probes every live QPRO + QP2 Back Office for banner-maintenance problems
// and reports them.
//
// HOMEPAGE COMPOSITION (the primary intent) — per brand/merchant, looking at the
// banners that are Active AND live right now on the user portal:
//   TOO_FEW_BANNERS      Fewer than --min (default 5) live homepage banners.
//   OUT_OF_ORDER         Banners not arranged in-house -> PP -> other-provider by
//                        position. Provider is read from the label by keyword
//                        (Pragmatic Play -> PP; a named provider like Microgaming/
//                        FastSpin/Playtech -> other; anything with no provider word,
//                        incl. brand events & notices -> in-house).
//
// DATE / ACTIVATION (housekeeping) — four flag types:
//
//   ALREADY_EXPIRED      Active banner whose end_datetime is already in the
//                        past -- a dead banner still occupying a carousel slot.
//                        Scoped to banners that expired within --lookback days
//                        (default 30); older stale-active banners are a standing
//                        backlog, not an alert, and are counted, not listed.
//   EXPIRING_SOON        Active banner ending within --expiring days (default 3)
//                        -- gives the team lead time to prep a replacement.
//   NOT_ACTIVATED        Inactive/Draft banner whose live window [start,end] is
//                        open RIGHT NOW and that was scheduled within --lookback
//                        days -- i.e. recently set up but never activated.
//                        (Evergreen parked drafts from years ago are excluded.)
//   ENDS_BEFORE_CAMPAIGN Active banner that comes down before its campaign's
//                        End Date (Banner Schedule sheet, col L) -- the promo
//                        runs on with no banner. Heuristic: matches banner ->
//                        campaign by brand + overlapping date window, so the
//                        named campaign is a best guess for a human to confirm.
//   UNTRACKED_LIVE_BANNER  A banner that is Active AND live on the homepage
//                        right now, but has no B-ID entry anywhere in the
//                        Banner Schedule sheet (current + previous month tabs)
//                        covering its brand + date window -- i.e. it did not
//                        go through the tracked upload pipeline (banner-pre-qc/
//                        banner-deep-qc never saw it, since both are scoped to
//                        B-IDs in the sheet). Scoped to banners that STARTED
//                        within --lookback days -- banners predating the B-ID
//                        tracking convention are a standing backlog, not a
//                        process gap, and are counted, not listed.
//
// The first three are pure BO-row logic (no sheet). ENDS_BEFORE_CAMPAIGN and
// UNTRACKED_LIVE_BANNER need the Banner Schedule sheet; pass --no-sheet to
// skip both (and the Google auth).
//
//   node bin/banner-health-check.mjs                 # all live QPRO+QP2, console
//   node bin/banner-health-check.mjs --site=qpro1    # one site
//   node bin/banner-health-check.mjs --min=5         # min live homepage banners per brand
//   node bin/banner-health-check.mjs --expiring=5    # expiring-soon window (days)
//   node bin/banner-health-check.mjs --lookback=14   # recency window for the
//                                                    # ALREADY_EXPIRED / NOT_ACTIVATED backlog filter
//   node bin/banner-health-check.mjs --no-sheet      # BO-only, skip campaign x-ref
//   node bin/banner-health-check.mjs --include-canary # also probe qpro11/qpro13
//   node bin/banner-health-check.mjs --json          # machine-readable to stdout
//   node bin/banner-health-check.mjs --dashboard      # append a digest row to the
//                                                     # PromoOps Control Layer Notifications
//                                                     # tab (surfaces in the dashboard feed)
//   node bin/banner-health-check.mjs --slack --slack-channel=C07KKVD1GTE
//
// WS1/WS2 (BIA/Directus) banners are probed via src/cms-client.js (JWT auth
// against the MB8/RWS77 Directus hosts). Credentials in cms-creds.local.json.
// ws1-classic-my (kiosk) is skipped -- it shares the same MB8 CMS as ws1.

import { parseArgs } from './_args.js';
import { listSites, getSite } from '../src/sites.js';
import { getSession, getAllBanners } from '../src/api-client.js';
import { lookupBrand } from '../src/banner-schedule.js';
import { cmsClient, loadCmsCreds } from '../src/cms-client.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const { flags } = parseArgs(process.argv.slice(2));
const EXPIRING_DAYS = Number(flags.expiring) > 0 ? Number(flags.expiring) : 3;
const LOOKBACK_DAYS = Number(flags.lookback) > 0 ? Number(flags.lookback) : 30;
const HOMEPAGE_MIN = Number(flags.min) > 0 ? Number(flags.min) : 5;
const USE_SHEET = !flags['no-sheet'];
const INCLUDE_CANARY = !!flags['include-canary'];
const AS_JSON = !!flags.json;
const POST_SLACK = !!flags.slack;
const POST_DASHBOARD = !!flags.dashboard;

// qpro11 (MSB66) and qpro13 (IBC7) are flagged NOT LIVE / canary in bo-sites.json.
const CANARY_SITES = new Set(['qpro11', 'qpro13']);

// QP2 multi-merchant BO: reverse-map the BO merchant displayName → brand label (QP2A…QP2D).
// Source: data/brand-directory.json qp2 section (displayName = BO merchant name).
const _brandDir = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../data/brand-directory.json'), 'utf8'));
const QP2_MERCHANT_LABEL = Object.fromEntries(
  Object.entries(_brandDir.qp2 || {}).map(([label, info]) => [info.displayName, label])
);
// { IBC22: 'QP2A', KING333: 'QP2B', ACE66: 'QP2C', SPADE66: 'QP2D' }

const NOW = Date.now();
const EXPIRING_WINDOW_MS = EXPIRING_DAYS * 86400000;
const LOOKBACK_MS = LOOKBACK_DAYS * 86400000;
// Banners end at 23:59 local (GMT+8) while a sheet End Date is a whole day, so a
// banner ending the same calendar day as its campaign is correct, not early.
// Only flag ENDS_BEFORE_CAMPAIGN when the gap exceeds one day.
const ENDS_BEFORE_GRACE_MS = 86400000;

const log = (...a) => { if (!AS_JSON) console.log(...a); };

// -- Date parsing ----------------------------------------------------------

// Banner datetimes look like "2026-06-26T15:59:00.000000Z" (6-digit fractional
// seconds). Drop the fractional part so Date() parses reliably everywhere.
function parseBoDate(s) {
  if (!s) return null;
  const d = new Date(String(s).replace(/\.\d+Z$/, 'Z'));
  return Number.isNaN(d.getTime()) ? null : d;
}

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

// Schedule dates are "D-Mon-YYYY" (e.g. "3-May-2026", "11-Jun-2026"). Interpret
// at the GMT+8 day boundary so they line up with how banners are timed: a Start
// Date is 00:00:00+08:00, an End Date is 23:59:59+08:00.
function parseScheduleDate(s, edge /* 'start' | 'end' */) {
  const m = String(s || '').trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (!m) return null;
  const mon = MONTHS[m[2].toLowerCase()];
  if (!mon) return null;
  const day = String(m[1]).padStart(2, '0');
  const time = edge === 'end' ? '23:59:59' : '00:00:00';
  const d = new Date(`${m[3]}-${String(mon).padStart(2, '0')}-${day}T${time}+08:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// BIA/Directus dates are "YYYY-MM-DD" stored in the team's GMT+8 timezone.
function parseBiaDate(s, edge /* 'start' | 'end' */) {
  const iso = String(s || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const time = edge === 'end' ? '23:59:59' : '00:00:00';
  const d = new Date(`${iso}T${time}+08:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// -- Provider classification (homepage composition) --------------------------
// Read the provider off the banner label by keyword. Pragmatic Play -> 'pp';
// any other named provider -> 'other'; no provider word (brand events, generic
// promos, notices) -> 'inhouse'. The desired homepage order is in-house first,
// then PP, then other providers — encoded as ascending RANK.
const PP_RE = /\bpragmatic\s*play\b|pragmaticplay|\bpp\b/i;
const PROVIDER_OTHER = [
  'microgaming', 'fastspin', 'fast spin', 'playtech', 'pg soft', 'pgsoft', 'pocket games',
  'habanero', 'evolution', 'ezugi', 'spadegaming', 'spade gaming', 'jili', 'cq9', 'joker',
  'jdb', 'live22', 'playstar', 'advantplay', 'nextspin', 'dragoon', 'naga', 'booongo', 'bng',
  'red tiger', 'redtiger', 'netent', 'yggdrasil', 'relax gaming', 'hacksaw', 'nolimit', 'no limit',
  'funky games', 'kingmaker', 'sbobet', 'saba', 'dream gaming', 'wm casino', 'big gaming',
  'allbet', 'sexy', 'simpleplay', 'simple play', 'play n go', 'playngo', 'playson', 'fa chai',
  'fachai', 'bgaming', 'ka gaming', 'kagaming', 'micro gaming', 'rich88', 'mega888', '918kiss',
];
const RANK = { inhouse: 0, pp: 1, other: 2 };
const CAT_LABEL = { inhouse: 'in-house', pp: 'PP', other: 'other' };

function classifyProvider(label) {
  const s = String(label || '');
  if (PP_RE.test(s)) return 'pp';
  const lc = s.toLowerCase();
  if (PROVIDER_OTHER.some((k) => lc.includes(k))) return 'other';
  return 'inhouse';
}

// -- Banner Schedule cross-reference index -----------------------------------
// Returns a Map: siteId -> [{ bId, campaign, merchantKey, start, end }].
// merchantKey is the uppercased brand merchant name (QP2 only; null for QPRO
// and BIA, which are single-brand per BO/site). Empty map if the sheet read is
// skipped/fails.
//
// Reads the current-month tab AND the previous-month tab. A single tab isn't
// enough for the UNTRACKED_LIVE_BANNER check below: a campaign entered near
// the end of last month (e.g. started 28-Jun) lives in last month's tab even
// though the banner is still live today in July -- reading only "this month"
// would make every such banner look untracked. Two months covers the full
// --lookback window (default 30d) with room to spare.

const SCHEDULE_SHEET_ID = '1vpyjhqiKzcn2XHovcN2tEa4UkzUMqTmFsUZ59m-n8_E';

async function loadScheduleIndex() {
  const { getGoogleAuth, loadGoogleapis } = await import('../src/google-auth.js');
  const { client } = await getGoogleAuth();
  const { google } = await loadGoogleapis();
  const sheets = google.sheets({ version: 'v4', auth: client });

  const meta = await sheets.spreadsheets.get({
    spreadsheetId: SCHEDULE_SHEET_ID,
    fields: 'sheets.properties(title)',
  });
  const titles = (meta.data.sheets || []).map((s) => s.properties.title);

  const now = new Date();
  const wantCurrent = now.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }); // "Jun 2026"
  const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const wantPrev = prevMonthDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

  const tabCurrent = titles.find((t) => t.toLowerCase() === wantCurrent.toLowerCase())
    || titles.find((t) => /^[A-Za-z]{3}\s+\d{4}$/.test(t));
  if (!tabCurrent) throw new Error(`no month tab found; tabs: ${titles.join(', ')}`);
  const tabPrev = titles.find((t) => t.toLowerCase() === wantPrev.toLowerCase());

  // Dedupe: if there's no tab for the current month yet, tabCurrent falls back
  // to the first month-pattern tab in the sheet, which can coincide with
  // tabPrev -- don't read (or report) the same tab twice.
  const tabsToRead = [...new Set([tabCurrent, tabPrev].filter(Boolean))];
  const index = new Map();
  let campaigns = 0;
  for (const tab of tabsToRead) {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SCHEDULE_SHEET_ID,
      range: `'${tab}'!A1:P200`,
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'FORMATTED_STRING',
    });
    const rows = res.data.values || [];
    for (const r of rows) {
      const bId = String(r[1] ?? '').trim();          // col B
      if (!/^B\d+$/i.test(bId)) continue;             // header / blank / separator
      const brandRaw = String(r[8] ?? '').trim();     // col I
      const start = parseScheduleDate(r[10], 'start'); // col K
      const end = parseScheduleDate(r[11], 'end');     // col L
      if (!start || !end) continue;                   // undated row -- can't compare
      const info = lookupBrand(brandRaw);
      if (!info?.siteId) continue;                    // unmapped / not yet configured -- skip
      const entry = {
        bId: bId.toUpperCase(),
        campaign: String(r[2] ?? '').trim(),          // col C
        merchantKey: info.platform === 'qp2' ? info.merchantName.toUpperCase() : null,
        start,
        end,
      };
      if (!index.has(info.siteId)) index.set(info.siteId, []);
      index.get(info.siteId).push(entry);
      campaigns++;
    }
  }
  return { index, tab: tabsToRead.join(' + '), campaigns };
}

// True if any schedule entry's date window overlaps [start, end] for the given
// merchant (QP2 only -- null merchantKey on either side always matches, since
// QPRO/BIA are single-brand per site). Used to test whether a live banner has
// ANY B-ID covering it -- existence, not identity, so no grace period is
// needed the way findOverrunCampaign needs one.
function hasScheduleCoverage(scheduleEntries, { merchantKey, start, end }) {
  if (!scheduleEntries || !start || !end) return true; // can't evaluate -- don't flag on missing data
  const bStart = start.getTime();
  const bEnd = end.getTime();
  return scheduleEntries.some((c) => {
    if (c.merchantKey && merchantKey && c.merchantKey !== merchantKey) return false;
    return c.start.getTime() <= bEnd && c.end.getTime() >= bStart;
  });
}

// Find the campaign a banner overruns, if any. Returns the overlapping campaign
// with the latest End Date when that end is > 1 day after the banner's end.
function findOverrunCampaign(scheduleEntries, { merchantKey, start, end }) {
  if (!scheduleEntries || !end) return null;
  const bEnd = end.getTime();
  const bStart = start ? start.getTime() : bEnd;
  let latest = null;
  for (const c of scheduleEntries) {
    if (c.merchantKey && c.merchantKey !== merchantKey) continue; // QP2 merchant mismatch
    const overlaps = c.start.getTime() <= bEnd && c.end.getTime() >= bStart;
    if (!overlaps) continue;
    if (!latest || c.end.getTime() > latest.end.getTime()) latest = c;
  }
  if (latest && latest.end.getTime() - bEnd > ENDS_BEFORE_GRACE_MS) return latest;
  return null;
}

// -- Per-site probe ----------------------------------------------------------

const FLAG_LABEL = {
  TOO_FEW_BANNERS: `HOMEPAGE < ${HOMEPAGE_MIN}`,
  OUT_OF_ORDER: 'OUT OF ORDER',
  UNTRACKED_LIVE_BANNER: 'UNTRACKED',
  NOT_ACTIVATED: 'NOT ACTIVATED',
  ENDS_BEFORE_CAMPAIGN: 'ENDS < CAMPAIGN',
  ALREADY_EXPIRED: 'ALREADY EXPIRED',
  EXPIRING_SOON: `EXPIRING <=${EXPIRING_DAYS}d`,
};
// Composition first (the primary intent), then date/activation housekeeping.
const REPORT_ORDER = [
  'TOO_FEW_BANNERS', 'OUT_OF_ORDER', 'UNTRACKED_LIVE_BANNER', 'NOT_ACTIVATED',
  'ENDS_BEFORE_CAMPAIGN', 'ALREADY_EXPIRED', 'EXPIRING_SOON',
];

function fmtDate(d) {
  return d ? d.toISOString().slice(0, 16).replace('T', ' ') + 'Z' : '--';
}

async function probeSite(site, scheduleIndex) {
  const session = await getSession(site);
  // QP2 BOs are multi-merchant -- map a banner's site_id back to its brand. QPRO
  // BOs are single-brand, so every banner belongs to the one merchant.
  const merchantById = new Map(session.merchants.map((m) => [m.id, m.name]));
  const soleMerchant = session.merchants[0]?.name || site.id;
  const isQp2 = site.platform === 'qp2';

  // Fetch active and inactive separately so NOT_ACTIVATED sees drafts regardless
  // of the BO's default status filter.
  const [active, inactive] = await Promise.all([
    getAllBanners(site, { status: 1 }),
    getAllBanners(site, { status: 0 }),
  ]);

  const merchantOf = (row) =>
    isQp2 ? (merchantById.get(row.site_id) || `site_id=${row.site_id}`) : soleMerchant;

  const scheduleEntries = scheduleIndex?.index.get(site.id) || null;
  const findings = [];
  // Banners past their end that are still Active, but expired longer ago than
  // the lookback window -- a standing housekeeping backlog, counted not listed.
  let staleBacklog = 0;
  // Live homepage banners with no covering Banner Schedule B-ID, but that
  // started before the lookback window -- pre-dates the B-ID tracking
  // convention, a standing backlog rather than a current process gap.
  let untrackedBacklog = 0;

  for (const row of active.rows || []) {
    const start = parseBoDate(row.start_datetime);
    const end = parseBoDate(row.end_datetime);
    const merchant = merchantOf(row);
    const flags = [];

    if (end && end.getTime() < NOW) {
      if (end.getTime() >= NOW - LOOKBACK_MS) flags.push({ type: 'ALREADY_EXPIRED' });
      else staleBacklog++;
    } else if (end && end.getTime() <= NOW + EXPIRING_WINDOW_MS) {
      flags.push({ type: 'EXPIRING_SOON' });
    }

    if (scheduleEntries) {
      const overrun = findOverrunCampaign(scheduleEntries, {
        merchantKey: isQp2 ? merchant.toUpperCase() : null,
        start,
        end,
      });
      if (overrun) {
        flags.push({
          type: 'ENDS_BEFORE_CAMPAIGN',
          campaign: `${overrun.bId} ${overrun.campaign}`.trim(),
          campaignEnd: overrun.end,
        });
      }
    }

    for (const f of flags) findings.push({ row, merchant, start, end, ...f });
  }

  // Drafts whose live window is open now but were scheduled long ago -- parked
  // evergreen banners, not a forgotten activation. Counted, not listed.
  let parkedDrafts = 0;
  for (const row of inactive.rows || []) {
    const start = parseBoDate(row.start_datetime);
    const end = parseBoDate(row.end_datetime);
    if (start && end && start.getTime() <= NOW && end.getTime() >= NOW) {
      if (start.getTime() >= NOW - LOOKBACK_MS) {
        findings.push({ row, merchant: merchantOf(row), start, end, type: 'NOT_ACTIVATED' });
      } else {
        parkedDrafts++;
      }
    }
  }

  // -- Homepage composition: per merchant, the banners that are Active AND live
  // right now on the user portal. Check count and in-house -> PP -> other order.
  const liveByMerchant = new Map();
  for (const row of active.rows || []) {
    if (row.platform_type_id !== 1) continue; // user portal only
    const start = parseBoDate(row.start_datetime);
    const end = parseBoDate(row.end_datetime);
    if (!(start && end && start.getTime() <= NOW && end.getTime() >= NOW)) continue;
    const m = merchantOf(row);
    if (!liveByMerchant.has(m)) liveByMerchant.set(m, []);
    liveByMerchant.get(m).push(row);
  }
  for (const [merchant, list] of liveByMerchant) {
    const sorted = list
      .map((r) => ({ r, cat: classifyProvider(r.label), position: Number(r.position) || 0 }))
      .sort((a, b) => (a.position - b.position) || (a.r.id - b.r.id));

    if (sorted.length < HOMEPAGE_MIN) {
      findings.push({
        type: 'TOO_FEW_BANNERS', merchant, row: null, count: sorted.length,
        detail: `${sorted.length} live homepage banner(s), want >=${HOMEPAGE_MIN}`,
      });
    }

    // An inversion = a higher-rank category (e.g. 'other') sitting at a lower
    // position than a lower-rank one (e.g. 'PP') — i.e. out of in-house->PP->other order.
    const inversions = [];
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        if (RANK[sorted[i].cat] > RANK[sorted[j].cat]) inversions.push([sorted[i], sorted[j]]);
      }
    }
    if (inversions.length) {
      const seq = sorted.map((x) => `${CAT_LABEL[x.cat]}#${x.r.id}@p${x.position}`).join(' -> ');
      const detail = inversions.slice(0, 3).map(([hi, lo]) =>
        `${CAT_LABEL[hi.cat]} '${hi.r.label}' (pos ${hi.position}) above ${CAT_LABEL[lo.cat]} '${lo.r.label}' (pos ${lo.position})`,
      ).join('; ');
      findings.push({ type: 'OUT_OF_ORDER', merchant, row: null, detail, sequence: seq });
    }

    // Cross-reference each live banner against the Banner Schedule sheet. One
    // with no covering B-ID at all bypassed the tracked upload pipeline --
    // banner-pre-qc/banner-deep-qc are both scoped to B-IDs in the sheet, so
    // neither ever saw it. Only recently-started banners are flagged; older
    // ones predate the B-ID tracking convention and are backlog, not a gap.
    if (scheduleEntries) {
      for (const row of list) {
        const start = parseBoDate(row.start_datetime);
        const end = parseBoDate(row.end_datetime);
        const covered = hasScheduleCoverage(scheduleEntries, {
          merchantKey: isQp2 ? merchant.toUpperCase() : null,
          start, end,
        });
        if (covered) continue;
        if (start && start.getTime() >= NOW - LOOKBACK_MS) {
          findings.push({ row, merchant, start, end, type: 'UNTRACKED_LIVE_BANNER' });
        } else {
          untrackedBacklog++;
        }
      }
    }
  }

  // Per-merchant snapshot for the dashboard's "Homepage banner" view: count of
  // live homepage banners + their labels (sorted by carousel position).
  const merchantsSnap = [];
  for (const [merchant, list] of liveByMerchant) {
    const sorted = list
      .slice()
      .sort((a, b) => ((Number(a.position) || 0) - (Number(b.position) || 0)) || (a.id - b.id));
    merchantsSnap.push({
      merchant,
      activeCount: sorted.length,
      bannerNames: sorted.map((r) => `#${r.id} ${r.label || '(no label)'}`),
    });
  }

  return {
    siteId: site.id,
    label: site.label || site.id,
    scanned: (active.rows?.length || 0) + (inactive.rows?.length || 0),
    findings,
    staleBacklog,
    parkedDrafts,
    untrackedBacklog,
    merchants: merchantsSnap,
  };
}

// -- WS1/WS2 probe via Directus CMS ------------------------------------------
// site.id 'ws2' → RWS77 host; everything else (ws1, ws1-classic-my) → MB8 host.
// Returns the same shape as probeSite so the main loop and write-backs are
// platform-agnostic.
async function probeBiaSite(site, scheduleIndex) {
  const creds = loadCmsCreds();
  const host = site.id === 'ws2'
    ? (creds.hosts?.RWS77 || 'https://ws2-cms.best-in-asia.com')
    : (creds.hosts?.MB8   || 'https://cms.best-in-asia.com');
  const brandLabel = siteToLabel(site.id); // 'WS1' or 'WS2'

  const cms = await cmsClient(host, creds);
  const [carousels, images] = await Promise.all([
    cms.get('/items/UICarousel?limit=-1&fields=id,component_name,status').then((r) => r.data || []),
    cms.get('/items/UICarousel_images?limit=-1&fields=id,startDate,endDate,UICarousel_id').then((r) => r.data || []),
  ]);
  const carById = new Map(carousels.map((c) => [c.id, c]));

  const scheduleEntries = scheduleIndex?.index.get(site.id) || null;
  const findings = [];
  let staleBacklog = 0;
  let parkedDrafts = 0;
  let untrackedBacklog = 0;
  const liveNow = []; // published carousel images whose date window is open right now

  for (const img of images) {
    const car = carById.get(img.UICarousel_id);
    if (!car) continue;
    const start = parseBiaDate(img.startDate, 'start');
    const end   = parseBiaDate(img.endDate, 'end');
    if (!start || !end) continue;

    const row = { id: img.id, label: car.component_name || `carousel_${img.UICarousel_id}` };
    const isPublished = car.status === 'published';

    if (isPublished) {
      if (end.getTime() < NOW) {
        if (end.getTime() >= NOW - LOOKBACK_MS) {
          findings.push({ row, merchant: brandLabel, start, end, type: 'ALREADY_EXPIRED' });
        } else {
          staleBacklog++;
        }
      } else if (end.getTime() <= NOW + EXPIRING_WINDOW_MS) {
        findings.push({ row, merchant: brandLabel, start, end, type: 'EXPIRING_SOON' });
      }
      if (start.getTime() <= NOW && end.getTime() >= NOW) liveNow.push({ img, car });
    } else {
      // Draft/archived carousel with an open date window — not activated.
      if (start.getTime() <= NOW && end.getTime() >= NOW) {
        if (start.getTime() >= NOW - LOOKBACK_MS) {
          findings.push({ row, merchant: brandLabel, start, end, type: 'NOT_ACTIVATED' });
        } else {
          parkedDrafts++;
        }
      }
    }
  }

  if (liveNow.length < HOMEPAGE_MIN) {
    findings.push({
      type: 'TOO_FEW_BANNERS', merchant: brandLabel, row: null, count: liveNow.length,
      detail: `${liveNow.length} live carousel slide(s), want >=${HOMEPAGE_MIN}`,
    });
  }

  // Cross-reference each live slide against the Banner Schedule sheet -- same
  // check as probeSite. BIA brands (WS1 (MB8), WS1 (CLASSIC MB8), WS2 (RWS77))
  // are mapped in src/banner-schedule.js BIA_BRANDS, so schedule coverage
  // applies here too, not just QPRO/QP2.
  if (scheduleEntries) {
    for (const { img, car } of liveNow) {
      const start = parseBiaDate(img.startDate, 'start');
      const end = parseBiaDate(img.endDate, 'end');
      const covered = hasScheduleCoverage(scheduleEntries, { merchantKey: null, start, end });
      if (covered) continue;
      const row = { id: img.id, label: car.component_name || `carousel_${img.UICarousel_id}` };
      if (start && start.getTime() >= NOW - LOOKBACK_MS) {
        findings.push({ row, merchant: brandLabel, start, end, type: 'UNTRACKED_LIVE_BANNER' });
      } else {
        untrackedBacklog++;
      }
    }
  }

  const merchants = [{
    merchant: brandLabel,
    activeCount: liveNow.length,
    bannerNames: liveNow
      .sort((a, b) => new Date(a.img.startDate) - new Date(b.img.startDate))
      .map(({ img, car }) => `#${img.id} ${car.component_name || '(no label)'}`),
  }];

  return {
    siteId: site.id,
    label: site.label || site.id,
    scanned: images.length,
    findings,
    staleBacklog,
    parkedDrafts,
    untrackedBacklog,
    merchants,
  };
}

// -- Slack --------------------------------------------------------------------

function loadSlackToken() {
  if (process.env.SLACK_TOKEN) return process.env.SLACK_TOKEN;
  try {
    const dir = dirname(fileURLToPath(import.meta.url));
    return JSON.parse(readFileSync(join(dir, '..', 'slack-token.local.json'), 'utf8')).token;
  } catch { return null; }
}

async function postToSlack(channel, text) {
  const token = loadSlackToken();
  if (!token) throw new Error('SLACK_TOKEN not set and slack-token.local.json not found');
  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ channel, text, unfurl_links: false, unfurl_media: false }),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`Slack chat.postMessage error: ${json.error}`);
  return json;
}

// ── Dashboard write-back ─────────────────────────────────────────────────────
// The PromoOps Control Layer's Notifications tab feeds the unified dashboard's
// activity feed (it renders the last ~15 rows — see apps-script Code.gs
// getDashboardData). We append ONE digest row per run, not one per finding, so
// the feed isn't flooded. No Apps Script redeploy needed — the feed renders
// whatever rows are present. Schema: Timestamp|Type|Title|Message|Related_Task|
// Source|Sent_To_Slack.
const CONTROL_LAYER_ID = '16iI85GrAqldbBcGhpvAwJT3_3JJDqLemLaGhjPXMlQk';

async function appendDashboardNotification({ type, title, message }) {
  const { getGoogleAuth, loadGoogleapis } = await import('../src/google-auth.js');
  const { client } = await getGoogleAuth();
  const { google } = await loadGoogleapis();
  const sheets = google.sheets({ version: 'v4', auth: client });
  const row = [new Date().toISOString(), type, title, message, '', 'banner-health-check', 'FALSE'];
  await sheets.spreadsheets.values.append({
    spreadsheetId: CONTROL_LAYER_ID,
    range: "'Notifications'!A1",
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });
}

// Convert a siteId + optional merchant name to the readable brand label shown in
// the dashboard Brand column. For QP2's single multi-merchant BO (ibc22), the
// merchant name (IBC22/KING333/ACE66/SPADE66) maps to QP2A/B/C/D via brand-directory.
function siteToLabel(siteId, merchant = null) {
  if (merchant && QP2_MERCHANT_LABEL[merchant]) return QP2_MERCHANT_LABEL[merchant];
  const s = (siteId || '').toLowerCase();
  if (s.startsWith('qpro')) return 'QPRO' + s.slice(4);
  if (s.startsWith('qp2')) return 'QP2' + s.slice(3).toUpperCase();
  if (s.startsWith('ws1')) return 'WS1';
  if (s.startsWith('ws2')) return 'WS2';
  return siteId.toUpperCase();
}

// Per-merchant homepage banner snapshot — one row per merchant, with the
// active banner count, the list of banner names, and a status message.
// Surfaces on the dashboard's "Homepage banner" detail table.
async function writeMerchantStatusToWeeklyReport(siteResults, allFindings) {
  const { getSheetsClient } = await import('../src/sheets-client.js');
  const { getOpsSheetId } = await import('../src/ops-sheet.js');
  const { sheets } = await getSheetsClient();
  const OPS_ID = getOpsSheetId();
  const TAB = 'Homepage Banner Status';
  const NOW = new Date().toISOString();

  // Ensure tab exists
  const meta = await sheets.spreadsheets.get({ spreadsheetId: OPS_ID, fields: 'sheets.properties.title' });
  if (!meta.data.sheets.some((s) => s.properties.title === TAB)) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: OPS_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: TAB } } }] },
    });
  }

  // Build per-merchant rows. Key by siteId|merchant — unique per BO/merchant.
  const rows = [];
  for (const sr of siteResults) {
    const siteFindings = allFindings.filter((f) => f.siteId === sr.siteId);
    for (const m of (sr.merchants || [])) {
      const merchFindings = siteFindings.filter((f) => f.merchant === m.merchant);
      const statusParts = [];
      // Composition issues
      const tooFew = merchFindings.find((f) => f.type === 'TOO_FEW_BANNERS');
      if (tooFew) statusParts.push(`Need ${HOMEPAGE_MIN - m.activeCount} more banner${HOMEPAGE_MIN - m.activeCount !== 1 ? 's' : ''}`);
      const outOfOrder = merchFindings.find((f) => f.type === 'OUT_OF_ORDER');
      if (outOfOrder) statusParts.push('Out of order');
      const untracked = merchFindings.filter((f) => f.type === 'UNTRACKED_LIVE_BANNER').length;
      if (untracked) statusParts.push(`${untracked} untracked`);
      // Action-needed flags
      const notAct = merchFindings.filter((f) => f.type === 'NOT_ACTIVATED').length;
      if (notAct) statusParts.push(`${notAct} draft live now`);
      const endsBefore = merchFindings.filter((f) => f.type === 'ENDS_BEFORE_CAMPAIGN').length;
      if (endsBefore) statusParts.push(`${endsBefore} ends before campaign`);
      // Time-based
      const expiring = merchFindings.filter((f) => f.type === 'EXPIRING_SOON').length;
      if (expiring) statusParts.push(`${expiring} expiring soon`);
      const expired = merchFindings.filter((f) => f.type === 'ALREADY_EXPIRED').length;
      if (expired) statusParts.push(`${expired} expired`);
      const status = statusParts.length ? statusParts.join(' · ') : 'OK';
      rows.push([
        NOW,
        sr.siteId,
        siteToLabel(sr.siteId, m.merchant),
        String(m.activeCount),
        m.bannerNames.join('\n'),
        status,
      ]);
    }
  }

  const header = ['Timestamp', 'Site', 'Brand', 'Active Count', 'Banner Names', 'Status'];
  await sheets.spreadsheets.values.clear({ spreadsheetId: OPS_ID, range: `'${TAB}'!A:Z` });
  await sheets.spreadsheets.values.update({
    spreadsheetId: OPS_ID,
    range: `'${TAB}'!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [header, ...rows] },
  });
  return rows.length;
}

// Write detailed findings to the Weekly Report's 'Banner Health' tab so they
// surface on the team dashboard. This REPLACES the tab content each run — only
// the latest scan's findings are shown; historical findings live in git log via
// the Slack channel + Control Layer feed.
async function writeBannerHealthToWeeklyReport(findings) {
  const { getSheetsClient } = await import('../src/sheets-client.js');
  const { getOpsSheetId } = await import('../src/ops-sheet.js');
  const { sheets } = await getSheetsClient();
  const OPS_ID = getOpsSheetId();
  const TAB = 'Banner Health';
  const NOW = new Date().toISOString();

  // Ensure tab exists
  const meta = await sheets.spreadsheets.get({ spreadsheetId: OPS_ID, fields: 'sheets.properties.title' });
  if (!meta.data.sheets.some((s) => s.properties.title === TAB)) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: OPS_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: TAB } } }] },
    });
  }

  const header = ['Timestamp', 'Type', 'Site', 'Brand', 'Banner ID', 'Label', 'End Date', 'Detail'];
  const rows = findings.map((f) => [
    NOW,
    f.type,
    f.siteId || '',
    f.merchant || '',
    f.row?.id ? String(f.row.id) : '',
    f.row?.label || '',
    f.end ? fmtDate(f.end) : (f.campaignEnd ? fmtDate(f.campaignEnd) : ''),
    findingLine(f),
  ]);

  await sheets.spreadsheets.values.clear({ spreadsheetId: OPS_ID, range: `'${TAB}'!A:Z` });
  await sheets.spreadsheets.values.update({
    spreadsheetId: OPS_ID,
    range: `'${TAB}'!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [header, ...rows] },
  });
}

// One-line rendering of any finding (shared by dashboard digest + Slack). Brand-
// level composition findings have no single banner row; per-banner findings do.
function findingLine(f) {
  const who = `${f.siteId}/${f.merchant}`;
  switch (f.type) {
    case 'TOO_FEW_BANNERS': return `${who} -- ${f.detail}`;
    case 'OUT_OF_ORDER': return `${who} -- out of order: ${f.detail}`;
    case 'NOT_ACTIVATED': return `${who} #${f.row.id} ${f.row.label || '(no label)'} -- draft live now, not activated (${fmtDate(f.start)} -> ${fmtDate(f.end)})`;
    case 'ENDS_BEFORE_CAMPAIGN': return `${who} #${f.row.id} ${f.row.label || '(no label)'} -- ends ${fmtDate(f.end)} before campaign ${fmtDate(f.campaignEnd)} [${f.campaign}]`;
    case 'UNTRACKED_LIVE_BANNER': return `${who} #${f.row.id} ${f.row.label || '(no label)'} -- LIVE (${fmtDate(f.start)} -> ${fmtDate(f.end)}) but no B-ID found in Banner Schedule -- confirm it went through the tracked pipeline or backfill a B-ID`;
    default: return `${who} #${f.row.id} ${f.row.label || '(no label)'} -- ends ${fmtDate(f.end)}`;
  }
}

// Build the one-line-per-actionable-item digest that lands in the feed. The
// bulk date-based findings are summarized as a count; the composition issues and
// NOT_ACTIVATED / ENDS_BEFORE_CAMPAIGN (the items a human must act on) are listed.
function buildDashboardDigest() {
  const parts = [order_summary(counts) || 'no issues'];
  const ACTIONABLE = ['TOO_FEW_BANNERS', 'OUT_OF_ORDER', 'UNTRACKED_LIVE_BANNER', 'NOT_ACTIVATED', 'ENDS_BEFORE_CAMPAIGN'];
  const actionable = REPORT_ORDER.filter((t) => ACTIONABLE.includes(t))
    .flatMap((t) => allFindings.filter((f) => f.type === t));
  if (actionable.length) {
    parts.push('Action needed:');
    for (const f of actionable.slice(0, 14)) {
      parts.push(`- ${findingLine(f)}`);
    }
    if (actionable.length > 14) parts.push(`...and ${actionable.length - 14} more`);
  }
  if (staleBacklog || parkedDrafts || untrackedBacklog) {
    parts.push(`(suppressed backlog: ${staleBacklog} stale-active expired, ${parkedDrafts} parked drafts, ${untrackedBacklog} untracked pre-dating B-ID tracking)`);
  }
  if (biaSkipped.length) parts.push(`(not covered: ${biaSkipped.join(', ')})`);
  return parts.join('\n');
}

// -- Main -------------------------------------------------------------------

const targets = (flags.site ? [getSite(flags.site)] : listSites())
  .filter((s) => s.platform === 'qpro' || s.platform === 'qp2' || (s.platform === 'bia' && s.id !== 'ws1-classic-my'))
  .filter((s) => INCLUDE_CANARY || !CANARY_SITES.has(s.id));

// ws1-classic-my is the kiosk variant of WS1 on the same MB8 CMS — probing it
// separately would duplicate the results from the 'ws1' probe.
const biaSkipped = (flags.site ? [getSite(flags.site)] : listSites())
  .filter((s) => s.platform === 'bia' && s.id === 'ws1-classic-my')
  .map((s) => s.id);

log(`\n== Banner Health Check -- ${new Date().toISOString()} ==`);
const _biaTargets = targets.filter((s) => s.platform === 'bia');
const _qpTargets  = targets.filter((s) => s.platform !== 'bia');
log(`Sites   : ${_qpTargets.length} (QPRO+QP2) + ${_biaTargets.length} (WS1/WS2)${INCLUDE_CANARY ? ' incl. canary' : ''}`);
log(`Windows : expiring <=${EXPIRING_DAYS}d | backlog lookback ${LOOKBACK_DAYS}d`);

// Load the schedule cross-reference once (shared across sites).
let scheduleIndex = null;
if (USE_SHEET) {
  try {
    scheduleIndex = await loadScheduleIndex();
    log(`Schedule: '${scheduleIndex.tab}' -- ${scheduleIndex.campaigns} dated campaign(s) indexed`);
  } catch (e) {
    log(`Schedule: x-ref unavailable (${e.message.split('\n')[0]}) -- ENDS_BEFORE_CAMPAIGN and UNTRACKED_LIVE_BANNER disabled`);
  }
} else {
  log('Schedule: skipped (--no-sheet) -- ENDS_BEFORE_CAMPAIGN and UNTRACKED_LIVE_BANNER disabled');
}
log('');

const siteResults = [];
const errors = [];
for (const site of targets) {
  try {
    const r = site.platform === 'bia'
      ? await probeBiaSite(site, scheduleIndex)
      : await probeSite(site, scheduleIndex);
    siteResults.push(r);
    const n = r.findings.length;
    log(`${n ? '!' : 'OK'} ${site.id.padEnd(8)} ${String(r.scanned).padStart(4)} banners scanned | ${n} flag(s)`);
  } catch (e) {
    errors.push({ siteId: site.id, error: e.message.split('\n')[0] });
    log(`x  ${site.id.padEnd(8)} probe failed: ${e.message.split('\n')[0]}`);
  }
}

const allFindings = siteResults.flatMap((r) =>
  r.findings.map((f) => ({ siteId: r.siteId, label: r.label, ...f })));

const counts = allFindings.reduce((acc, f) => { acc[f.type] = (acc[f.type] || 0) + 1; return acc; }, {});
const staleBacklog = siteResults.reduce((n, r) => n + (r.staleBacklog || 0), 0);
const parkedDrafts = siteResults.reduce((n, r) => n + (r.parkedDrafts || 0), 0);
const untrackedBacklog = siteResults.reduce((n, r) => n + (r.untrackedBacklog || 0), 0);

function order_summary(c) {
  return REPORT_ORDER.filter((t) => c[t]).map((t) => `${c[t]} ${FLAG_LABEL[t]}`).join(' | ');
}

// Top-level `await`s below run to completion, then the script falls off the end
// and Node drains naturally. We set process.exitCode rather than calling
// process.exit() -- an abrupt exit while undici keep-alive sockets are still open
// trips a libuv teardown assertion on Windows.

if (AS_JSON) {
  const out = {
    checkedAt: new Date().toISOString(),
    expiringDays: EXPIRING_DAYS,
    lookbackDays: LOOKBACK_DAYS,
    sites: targets.map((s) => s.id),
    biaNotCovered: biaSkipped,
    counts,
    suppressed: { staleActiveBacklog: staleBacklog, parkedDrafts, untrackedBacklog },
    errors,
    findings: allFindings.map((f) => ({
      site: f.siteId,
      merchant: f.merchant,
      flag: f.type,
      banner_id: f.row?.id ?? null,
      label: f.row?.label ?? null,
      link: f.row?.link ?? null,
      status: f.row?.status_name ?? null,
      start: f.start ? f.start.toISOString() : null,
      end: f.end ? f.end.toISOString() : null,
      campaign: f.campaign || null,
      campaign_end: f.campaignEnd ? f.campaignEnd.toISOString() : null,
      count: f.count ?? null,
      detail: f.detail ?? null,
      sequence: f.sequence ?? null,
    })),
  };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
} else {
  // -- Console report ---------------------------------------------------------
  log('\n--------------------------------------------------------------');
  if (!allFindings.length) {
    log('No banner issues found across all scanned sites. OK');
  } else {
    log(`FLAGGED BANNERS (${allFindings.length})\n`);
    for (const type of REPORT_ORDER) {
      const group = allFindings.filter((f) => f.type === type);
      if (!group.length) continue;
      log(`* ${FLAG_LABEL[type]} (${group.length})`);
      for (const f of group) {
        const tag = `${f.siteId}/${f.merchant}`.padEnd(20);
        if (type === 'TOO_FEW_BANNERS') {
          log(`   ${tag} ${f.detail}`);
          continue;
        }
        if (type === 'OUT_OF_ORDER') {
          log(`   ${tag} ${f.detail}`);
          log(`   ${' '.repeat(20)}   seq: ${f.sequence}`);
          continue;
        }
        const lbl = (f.row.label || '(no label)').slice(0, 42).padEnd(42);
        let tail = `ends ${fmtDate(f.end)}`;
        if (type === 'NOT_ACTIVATED') tail = `window ${fmtDate(f.start)} -> ${fmtDate(f.end)}`;
        if (type === 'ENDS_BEFORE_CAMPAIGN') tail = `ends ${fmtDate(f.end)} < campaign ${fmtDate(f.campaignEnd)} [${f.campaign}]`;
        if (type === 'UNTRACKED_LIVE_BANNER') tail = `live ${fmtDate(f.start)} -> ${fmtDate(f.end)} -- no B-ID in Banner Schedule`;
        log(`   ${tag} #${String(f.row.id).padEnd(5)} ${lbl} ${tail}`);
      }
      log('');
    }
  }

  log('Summary: ' + (order_summary(counts) || 'clean'));
  if (staleBacklog || parkedDrafts || untrackedBacklog) {
    const bits = [];
    if (staleBacklog) bits.push(`${staleBacklog} stale-active expired >${LOOKBACK_DAYS}d ago`);
    if (parkedDrafts) bits.push(`${parkedDrafts} evergreen parked draft(s)`);
    if (untrackedBacklog) bits.push(`${untrackedBacklog} untracked (pre-dates B-ID tracking)`);
    log(`Suppressed (backlog, not alerted): ${bits.join(' | ')} -- raise --lookback to include`);
  }
  if (errors.length) log(`Probe errors: ${errors.map((e) => e.siteId).join(', ')}`);
  if (biaSkipped.length) log(`Not covered (kiosk variant, same CMS as WS1): ${biaSkipped.join(', ')}`);
  log('');

  // -- Slack alert (opt-in, outward-facing) -----------------------------------
  if (POST_SLACK) {
    const channel = flags['slack-channel'] || process.env.SLACK_ALERT_CHANNEL;
    if (!channel) {
      console.error('--slack requires a channel: pass --slack-channel=C... or set SLACK_ALERT_CHANNEL');
      process.exitCode = 2;
    } else if (!allFindings.length) {
      log('Slack: nothing to report (no findings) -- skipping post.');
    } else {
      const lines = [`*Banner Health Check* -- ${order_summary(counts)}`];
      for (const type of REPORT_ORDER) {
        const group = allFindings.filter((f) => f.type === type);
        if (!group.length) continue;
        lines.push(`\n*${FLAG_LABEL[type]}* (${group.length})`);
        for (const f of group.slice(0, 15)) lines.push(`• ${findingLine(f)}`);
        if (group.length > 15) lines.push(`  ...and ${group.length - 15} more`);
      }
      try {
        await postToSlack(channel, lines.join('\n'));
        log(`Slack: posted ${allFindings.length} finding(s) to ${channel}`);
      } catch (e) {
        console.error(`Slack post failed: ${e.message}`);
        process.exitCode = 2;
      }
    }
  }

  // ── Dashboard write-back (opt-in) ──────────────────────────────────────────
  if (POST_DASHBOARD) {
    const type = allFindings.length ? 'warning' : 'info';
    const title = allFindings.length
      ? `Banner Health -- ${allFindings.length} flag(s)`
      : 'Banner Health -- all clear';
    try {
      await appendDashboardNotification({ type, title, message: buildDashboardDigest() });
      log('Dashboard: digest appended to Control Layer Notifications feed');
    } catch (e) {
      console.error(`Control Layer write failed: ${e.message}`);
      process.exitCode = 2;
    }
    try {
      await writeBannerHealthToWeeklyReport(allFindings);
      log(`Dashboard: ${allFindings.length} finding(s) written to Weekly Report 'Banner Health' tab`);
    } catch (e) {
      console.error(`Weekly Report write failed: ${e.message}`);
      process.exitCode = 2;
    }
    try {
      const n = await writeMerchantStatusToWeeklyReport(siteResults, allFindings);
      log(`Dashboard: ${n} merchant row(s) written to 'Homepage Banner Status' tab`);
    } catch (e) {
      console.error(`Merchant status write failed: ${e.message}`);
      process.exitCode = 2;
    }
  }
}

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
//
// The first three are pure BO-row logic (no sheet). ENDS_BEFORE_CAMPAIGN needs
// the Banner Schedule sheet; pass --no-sheet to skip it (and the Google auth).
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
// WS1/WS2 (BIA/Directus) banners are NOT covered yet -- they use a different
// CMS and auth scheme with no banner-read helper in src/. They're listed in
// the report footer as a known gap.

import { parseArgs } from './_args.js';
import { listSites, getSite } from '../src/sites.js';
import { getSession, getAllBanners } from '../src/api-client.js';
import { lookupBrand } from '../src/banner-schedule.js';
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
// merchantKey is the uppercased brand merchant name (QP2 only; null for QPRO,
// which is single-brand per BO). Empty map if the sheet read is skipped/fails.

const SCHEDULE_SHEET_ID = '1vpyjhqiKzcn2XHovcN2tEa4UkzUMqTmFsUZ59m-n8_E';

async function loadScheduleIndex() {
  const { getGoogleAuth, loadGoogleapis } = await import('../src/google-auth.js');
  const { client } = await getGoogleAuth();
  const { google } = await loadGoogleapis();
  const sheets = google.sheets({ version: 'v4', auth: client });

  // Resolve the current-month tab ("Jun 2026"). Fall back to the first tab
  // whose title parses as a month if today's exact label isn't present.
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: SCHEDULE_SHEET_ID,
    fields: 'sheets.properties(title)',
  });
  const titles = (meta.data.sheets || []).map((s) => s.properties.title);
  const want = new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' }); // "Jun 2026"
  const tab = titles.find((t) => t.toLowerCase() === want.toLowerCase())
    || titles.find((t) => /^[A-Za-z]{3}\s+\d{4}$/.test(t));
  if (!tab) throw new Error(`no month tab found; tabs: ${titles.join(', ')}`);

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SCHEDULE_SHEET_ID,
    range: `'${tab}'!A1:P200`,
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING',
  });
  const rows = res.data.values || [];

  const index = new Map();
  let campaigns = 0;
  for (const r of rows) {
    const bId = String(r[1] ?? '').trim();          // col B
    if (!/^B\d+$/i.test(bId)) continue;             // header / blank / separator
    const brandRaw = String(r[8] ?? '').trim();     // col I
    const start = parseScheduleDate(r[10], 'start'); // col K
    const end = parseScheduleDate(r[11], 'end');     // col L
    if (!start || !end) continue;                   // undated row -- can't compare
    const info = lookupBrand(brandRaw);
    if (!info?.siteId) continue;                    // unmapped / BIA-only -- skip
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
  return { index, tab, campaigns };
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
  NOT_ACTIVATED: 'NOT ACTIVATED',
  ENDS_BEFORE_CAMPAIGN: 'ENDS < CAMPAIGN',
  ALREADY_EXPIRED: 'ALREADY EXPIRED',
  EXPIRING_SOON: `EXPIRING <=${EXPIRING_DAYS}d`,
};
// Composition first (the primary intent), then date/activation housekeeping.
const REPORT_ORDER = [
  'TOO_FEW_BANNERS', 'OUT_OF_ORDER', 'NOT_ACTIVATED', 'ENDS_BEFORE_CAMPAIGN',
  'ALREADY_EXPIRED', 'EXPIRING_SOON',
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
  }

  return {
    siteId: site.id,
    label: site.label || site.id,
    scanned: (active.rows?.length || 0) + (inactive.rows?.length || 0),
    findings,
    staleBacklog,
    parkedDrafts,
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

// One-line rendering of any finding (shared by dashboard digest + Slack). Brand-
// level composition findings have no single banner row; per-banner findings do.
function findingLine(f) {
  const who = `${f.siteId}/${f.merchant}`;
  switch (f.type) {
    case 'TOO_FEW_BANNERS': return `${who} -- ${f.detail}`;
    case 'OUT_OF_ORDER': return `${who} -- out of order: ${f.detail}`;
    case 'NOT_ACTIVATED': return `${who} #${f.row.id} ${f.row.label || '(no label)'} -- draft live now, not activated (${fmtDate(f.start)} -> ${fmtDate(f.end)})`;
    case 'ENDS_BEFORE_CAMPAIGN': return `${who} #${f.row.id} ${f.row.label || '(no label)'} -- ends ${fmtDate(f.end)} before campaign ${fmtDate(f.campaignEnd)} [${f.campaign}]`;
    default: return `${who} #${f.row.id} ${f.row.label || '(no label)'} -- ends ${fmtDate(f.end)}`;
  }
}

// Build the one-line-per-actionable-item digest that lands in the feed. The
// bulk date-based findings are summarized as a count; the composition issues and
// NOT_ACTIVATED / ENDS_BEFORE_CAMPAIGN (the items a human must act on) are listed.
function buildDashboardDigest() {
  const parts = [order_summary(counts) || 'no issues'];
  const ACTIONABLE = ['TOO_FEW_BANNERS', 'OUT_OF_ORDER', 'NOT_ACTIVATED', 'ENDS_BEFORE_CAMPAIGN'];
  const actionable = REPORT_ORDER.filter((t) => ACTIONABLE.includes(t))
    .flatMap((t) => allFindings.filter((f) => f.type === t));
  if (actionable.length) {
    parts.push('Action needed:');
    for (const f of actionable.slice(0, 14)) {
      parts.push(`- ${findingLine(f)}`);
    }
    if (actionable.length > 14) parts.push(`...and ${actionable.length - 14} more`);
  }
  if (staleBacklog || parkedDrafts) {
    parts.push(`(suppressed backlog: ${staleBacklog} stale-active expired, ${parkedDrafts} parked drafts)`);
  }
  if (biaSkipped.length) parts.push(`(not covered: ${biaSkipped.join(', ')})`);
  return parts.join('\n');
}

// -- Main -------------------------------------------------------------------

const targets = (flags.site ? [getSite(flags.site)] : listSites())
  .filter((s) => s.platform === 'qpro' || s.platform === 'qp2')
  .filter((s) => INCLUDE_CANARY || !CANARY_SITES.has(s.id));

const biaSkipped = (flags.site ? [getSite(flags.site)] : listSites())
  .filter((s) => s.platform === 'bia')
  .map((s) => s.id);

log(`\n== Banner Health Check -- ${new Date().toISOString()} ==`);
log(`Sites   : ${targets.length} (QPRO+QP2)${INCLUDE_CANARY ? ' incl. canary' : ''}`);
log(`Windows : expiring <=${EXPIRING_DAYS}d | backlog lookback ${LOOKBACK_DAYS}d`);

// Load the schedule cross-reference once (shared across sites).
let scheduleIndex = null;
if (USE_SHEET) {
  try {
    scheduleIndex = await loadScheduleIndex();
    log(`Schedule: '${scheduleIndex.tab}' -- ${scheduleIndex.campaigns} dated campaign(s) indexed`);
  } catch (e) {
    log(`Schedule: x-ref unavailable (${e.message.split('\n')[0]}) -- ENDS_BEFORE_CAMPAIGN disabled`);
  }
} else {
  log('Schedule: skipped (--no-sheet) -- ENDS_BEFORE_CAMPAIGN disabled');
}
log('');

const siteResults = [];
const errors = [];
for (const site of targets) {
  try {
    const r = await probeSite(site, scheduleIndex);
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
    suppressed: { staleActiveBacklog: staleBacklog, parkedDrafts },
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
        log(`   ${tag} #${String(f.row.id).padEnd(5)} ${lbl} ${tail}`);
      }
      log('');
    }
  }

  log('Summary: ' + (order_summary(counts) || 'clean'));
  if (staleBacklog || parkedDrafts) {
    const bits = [];
    if (staleBacklog) bits.push(`${staleBacklog} stale-active expired >${LOOKBACK_DAYS}d ago`);
    if (parkedDrafts) bits.push(`${parkedDrafts} evergreen parked draft(s)`);
    log(`Suppressed (backlog, not alerted): ${bits.join(' | ')} -- raise --lookback to include`);
  }
  if (errors.length) log(`Probe errors: ${errors.map((e) => e.siteId).join(', ')}`);
  if (biaSkipped.length) log(`Not covered (Directus/BIA -- separate tool): ${biaSkipped.join(', ')}`);
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
      console.error(`Dashboard write failed: ${e.message}`);
      process.exitCode = 2;
    }
  }
}

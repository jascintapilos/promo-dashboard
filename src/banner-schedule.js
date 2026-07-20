// Banner Schedule sheet parser.
//
// Source: https://docs.google.com/spreadsheets/d/1vpyjhqiKzcn2XHovcN2tEa4UkzUMqTmFsUZ59m-n8_E
//         (gid 1055566688)
//
// 16-column schema A through P. One row per (b_id, brand) — the same campaign
// often spans multiple B-IDs across different brand families.
//
// Hyperlinks in column D ("Promo Drafts Link") are stripped by the Drive read
// API; only the visible label survives (e.g. `[MB8] Playtech x MB8 Free Spin
// Challenge`). To get the underlying folder URL, the caller resolves the label
// via Drive search_files by title in the agent session.
//
// Brand mapping extends src/ingest.js BRAND_TO_SITE with the Best-in-Asia
// (WS1/WS2) family, which uses platform='bia' and a different auth scheme
// from QPRO/QP2.

import { splitMarkdownRow, BRAND_TO_SITE as PROMO_BRAND_TO_SITE } from './ingest.js';

export const SCHEDULE_COLUMN_INDEX = {
  section_no:         0,
  b_id:               1,
  campaign:           2,
  draft_folder_label: 3,
  status:             4,
  region:             5,
  requestor_class:    6,
  promo_type:         7,
  brand:              8,
  placement:          9,
  start_date:        10,
  end_date:          11,
  submitted_at:      12,
  requested_by:      13,
  ready_by:          14,
  notes:             15,
};

// ── Brand → bo-sites.json site id ─────────────────────────────────────────
// Reuses the QPRO/QP2 mapping from ingest.js and adds the BIA (Best-in-Asia)
// family used for banner work on WS1/WS2. Keys are normalized: uppercase,
// collapsed whitespace.

const BIA_BRANDS = {
  'WS1 (MB8)':         { siteId: 'ws1',            platform: 'bia', merchantName: 'MB8'         },
  'WS1 (CLASSIC MB8)': { siteId: 'ws1-classic-my', platform: 'bia', merchantName: 'Classic MB8' },
  'WS2 (RWS77)':       { siteId: 'ws2',            platform: 'bia', merchantName: 'RWS77'       },
};

// Brands with known BOs in the directory but not yet probed. Listed here so
// lookupBrand returns a meaningful "not yet supported" pointer rather than
// silent null. Update as new platforms come online.
const UNCONFIGURED_BRANDS = {
  'SBO28':    { siteId: null, platform: null, note: 'BO at https://3m-ns3-admin.com/ (UG01) — not yet probed' },
  'WARUNG18': { siteId: null, platform: null, note: 'BO at https://bo-wa1.nex2wlb.com/Auth/Login (NX01) — not yet probed' },
  'UG02':     { siteId: null, platform: null, note: 'BO not in directory yet' },
  'MENANG7':  { siteId: null, platform: null, note: 'BO not in directory yet' },
  'QPLY':     { siteId: 'ibc22', platform: 'qp2', note: 'Alias for all QP2 merchants (QP2A-D). parseBrands expands QPLY → QP2A,QP2B,QP2C,QP2D.' },
};

export const BANNER_BRAND_TO_SITE = {
  ...PROMO_BRAND_TO_SITE,
  ...BIA_BRANDS,
  ...UNCONFIGURED_BRANDS,
};

export function normalizeBrand(raw) {
  return (raw || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

export function lookupBrand(rawBrand) {
  const key = normalizeBrand(rawBrand);
  return BANNER_BRAND_TO_SITE[key] || null;
}

// ── Range parser ──────────────────────────────────────────────────────────
// Accepts: "B01-B03", "B07", "B01,B03,B07", "B01 B03 B07"
// Throws on unparseable tokens — silent skip masks user typos.

export function parseBannerIdRange(input) {
  const s = String(input || '').trim();
  if (!s) return [];
  const out = new Set();
  for (const token of s.split(/[,\s]+/).filter(Boolean)) {
    const range = token.match(/^B(\d+)-B?(\d+)$/i);
    if (range) {
      const a = +range[1];
      const b = +range[2];
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      for (let i = lo; i <= hi; i++) out.add(formatBId(i));
      continue;
    }
    const single = token.match(/^B(\d+)$/i);
    if (single) {
      out.add(formatBId(+single[1]));
      continue;
    }
    throw new Error(`Cannot parse banner id token: "${token}". Expected B##, B##-B##, or comma list.`);
  }
  return [...out].sort();
}

function formatBId(n) {
  return n < 100 ? `B${String(n).padStart(2, '0')}` : `B${n}`;
}

// ── Row → record ──────────────────────────────────────────────────────────

export function parseScheduleRow(line) {
  const cells = splitMarkdownRow(line);
  if (!cells || cells.length < 16) return null;
  const get = (k) => (cells[SCHEDULE_COLUMN_INDEX[k]] ?? '').trim();

  const bIdRaw = get('b_id');
  if (!/^B\d+$/i.test(bIdRaw)) return null; // header / separator / continuation row

  const bId = bIdRaw.toUpperCase();
  const brandRaw = get('brand');
  const brandInfo = lookupBrand(brandRaw);

  return {
    b_id:               bId,
    section_no:         get('section_no'),
    campaign:           get('campaign'),
    draft_folder_label: get('draft_folder_label'),
    status:             get('status'),
    regions:            get('region').split(/[,\s]+/).filter(Boolean),
    requestor_class:    get('requestor_class'),
    promo_type:         get('promo_type'),
    brand_raw:          brandRaw,
    site_id:            brandInfo?.siteId       || null,
    platform:           brandInfo?.platform     || null,
    merchant_name:      brandInfo?.merchantName || null,
    placement:          get('placement'),
    start_date:         get('start_date'),
    end_date:           get('end_date'),
    submitted_at:       get('submitted_at'),
    requested_by:       get('requested_by'),
    ready_by:           get('ready_by'),
    notes:              get('notes'),
    _brand_unconfigured_note: brandInfo?.note || null,
  };
}

// ── Whole-table parse ─────────────────────────────────────────────────────
// Walks the markdown dump and returns a Map keyed by b_id. Later occurrences
// of the same b_id win (lets archived → current overrides take effect).

export function parseScheduleTable(markdown) {
  const out = new Map();
  for (const line of markdown.split('\n')) {
    const rec = parseScheduleRow(line);
    if (rec) out.set(rec.b_id, rec);
  }
  return out;
}

// ── ClickUp task-id extraction ────────────────────────────────────────────
// Extracts the bare task ID from https://app.clickup.com/t/<id> or the
// team/list-scoped variant https://app.clickup.com/t/<team_id>/<id> — the
// task ID is always the LAST path segment after /t/, regardless of how many
// ID segments precede it. Also tolerates an optional trailing slash and/or
// an optional trailing query string and/or fragment (e.g. "?view=abc",
// "#comment-123") — those previously caused a silent null on an otherwise
// valid task URL. Returns null when the URL doesn't contain a /t/ segment.

export function extractClickupTaskId(url) {
  if (!url) return null;
  const m = url.match(/\/t\/(?:[^/?#]+\/)*([a-z0-9]+)\/?(?:[?#].*)?$/i);
  return m ? m[1] : null;
}

// ── Hyperlink extraction (ClickUp + Drive) ────────────────────────────────
// Uses Sheets API includeGridData to read embedded hyperlinks that values.get()
// strips out. Col C (campaign) carries the ClickUp task URL; col D (draft folder
// label) carries the Google Drive folder URL — but only on the first row of each
// campaign group (sibling B-IDs inherit the same task/folder from their parent).
//
// Returns Map<bId, { clickup_url, clickup_task_id, drive_folder_url }>
// Missing links are null — don't throw.

export async function readBannerLinks(sheetsClient, bIds, tab) {
  const bIdSet = new Set(bIds.map((b) => b.toUpperCase()));
  const SHEET_ID = '1vpyjhqiKzcn2XHovcN2tEa4UkzUMqTmFsUZ59m-n8_E';

  const res = await sheetsClient.sheets.spreadsheets.get({
    spreadsheetId: SHEET_ID,
    ranges: [`'${tab}'!A1:P500`],
    includeGridData: true,
  });

  const rows = res.data.sheets?.[0]?.data?.[0]?.rowData || [];
  const links = new Map();

  // Track the last seen ClickUp URL — sibling rows inherit it
  let lastClickupUrl = null;

  for (const row of rows) {
    const cells = row.values || [];
    const bId = (cells[1]?.formattedValue || '').trim().toUpperCase();
    if (!bId || !/^B\d+$/.test(bId)) { lastClickupUrl = null; continue; }

    // Extract link from textFormatRuns (inline hyperlink) or top-level hyperlink
    const getLink = (cell) => {
      if (!cell) return null;
      if (cell.hyperlink) return cell.hyperlink;
      const runs = cell.textFormatRuns || [];
      for (const r of runs) { if (r.format?.link?.uri) return r.format.link.uri; }
      return null;
    };

    const colC = cells[2]; // campaign column
    const colD = cells[3]; // draft folder label column

    const clickupUrl    = getLink(colC) || null;
    const driveFolderUrl = getLink(colD) || null;

    // Siblings inherit the ClickUp URL from the first row in their group
    if (clickupUrl) lastClickupUrl = clickupUrl;
    const resolvedClickup = clickupUrl || lastClickupUrl || null;

    if (!bIdSet.has(bId)) continue;

    const taskId = extractClickupTaskId(resolvedClickup);

    links.set(bId, {
      clickup_url:      resolvedClickup,
      clickup_task_id:  taskId,
      drive_folder_url: driveFolderUrl,
    });
  }

  return links;
}

// ── Dynamic tab detection ─────────────────────────────────────────────────
// resolveMonthTab is the single source of truth for "which month tab do we
// use" — it replaces two divergent copies of this logic that used to live
// separately in bin/upload-promo.js (supported --month, threw when nothing
// resolved) and here (no override, abbreviated-month-only match, and a
// tabs[0] fallback that could silently pick an unrelated month tab with zero
// warning). Pure and synchronous so it's directly unit-testable.

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTH_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];

export function resolveMonthTab(tabs, options = {}) {
  const { monthOverride = null, referenceDate = new Date() } = options;

  if (monthOverride) {
    const match = tabs.find((t) => t.toLowerCase() === String(monthOverride).toLowerCase());
    if (!match) {
      throw new Error(
        `Month override "${monthOverride}" not found among available tabs: ${tabs.join(', ')}`
      );
    }
    return match;
  }

  const monthIndex = referenceDate.getMonth();
  const year = referenceDate.getFullYear();
  const abbrForm = `${MONTH_ABBR[monthIndex]} ${year}`;
  const fullForm = `${MONTH_FULL[monthIndex]} ${year}`;

  const exact = tabs.find(
    (t) => t.toLowerCase() === abbrForm.toLowerCase() || t.toLowerCase() === fullForm.toLowerCase()
  );
  if (exact) return exact;

  // Fallback: sweep for a "<letters> <4-digit year>"-shaped tab (so full
  // month names match too, not just exactly 3 letters) whose month token
  // case-insensitively equals THIS month's abbreviated or full-word name.
  // This is what stops the sweep from grabbing an arbitrary
  // "SomeOtherMonth 2026"-shaped tab — the exact bug in the old tabs[0]
  // fallback.
  const currentMonthNames = [MONTH_ABBR[monthIndex].toLowerCase(), MONTH_FULL[monthIndex].toLowerCase()];
  const swept = tabs.find((t) => {
    const m = t.match(/^([A-Za-z]+)\s+(\d{4})$/);
    if (!m) return false;
    return currentMonthNames.includes(m[1].toLowerCase());
  });
  if (swept) return swept;

  throw new Error(
    `No month tab found for "${abbrForm}" / "${fullForm}"; available tabs: ${tabs.join(', ')}`
  );
}

export async function resolveScheduleTab(sheetsClient, { monthOverride } = {}) {
  const SHEET_ID = '1vpyjhqiKzcn2XHovcN2tEa4UkzUMqTmFsUZ59m-n8_E';
  const meta = await sheetsClient.sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const tabs = meta.data.sheets.map((s) => s.properties.title);
  return resolveMonthTab(tabs, { monthOverride });
}

// ── B-ID lookup with bucketed result ──────────────────────────────────────
// Returns three buckets:
//   found       — record + configured site, ready to upload
//   unsupported — record exists but brand has no site yet (probe needed)
//   missing     — id not in the schedule

export function findByIds(records, bIds) {
  const found = [];
  const missing = [];
  const unsupported = [];
  for (const id of bIds) {
    const rec = records.get(id);
    if (!rec) { missing.push(id); continue; }
    if (!rec.site_id) {
      unsupported.push({ id, brand: rec.brand_raw, note: rec._brand_unconfigured_note });
      continue;
    }
    found.push(rec);
  }
  return { found, missing, unsupported };
}

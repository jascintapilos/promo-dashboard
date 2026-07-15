// XLSX-based ingest. Lives alongside the markdown parser in src/ingest.js
// but is the preferred source — XLSX never silently drops rows the way
// markdown parsing did, and column positions are auto-detected from the
// header row so spreadsheet layout changes (like the Mar 2026 column
// reorder) don't break the bot.
//
// The XLSX is unzipped at `captures/sheet-extracted/` — the dir produced
// by `bin/refresh-sheet.mjs` after downloading from Drive. Inside:
//   xl/workbook.xml          ← tab names + sheetN.xml mapping
//   xl/sharedStrings.xml     ← string pool referenced by cells
//   xl/worksheets/sheetN.xml ← one per tab
//
// Public API:
//   loadWorkbook(extractedDir)        → { tabs: [{name, sheetFile}], sharedStrings }
//   parseSheet(extractedDir, sheetFile, sharedStrings) → [{ row, cells }]
//   findCurrentMonthTab(tabs, today)  → tab object (auto by name match)
//   findColumnIndex(headerRow, name)  → number (auto-detect by header label)
//   ingestCurrentMonth(extractedDir, options) → [record, …]
//
// Output records follow the same shape as src/ingest.js parseRow output
// so downstream consumers (planner.js, mappers) work unchanged.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  parseBonusType, parseBrands, parseRegions, regionsToCurrenciesAndLocales,
  parseRecurring, parseValidityDays, parseDetails, parseInstructions,
  BRAND_TO_SITE,
} from './ingest.js';

import { OWNER_CODES } from './campaign-prefix-rules.js';

// ── XLSX XML parsing ────────────────────────────────────────────────────

async function loadSharedStrings(extractedDir) {
  const xml = await readFile(path.join(extractedDir, 'xl', 'sharedStrings.xml'), 'utf8');
  const out = [];
  const re = /<si>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    // <si> can contain <t>…</t> or <r><t>…</t></r> runs. Strip tags + decode.
    const raw = m[1].replace(/<[^>]+>/g, '');
    out.push(decodeXmlEntities(raw));
  }
  return out;
}

function decodeXmlEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#10;/g, '\n')
    .replace(/&#13;/g, '\r')
    .replace(/&#9;/g, '\t');
}

export async function loadWorkbook(extractedDir) {
  const wbXml = await readFile(path.join(extractedDir, 'xl', 'workbook.xml'), 'utf8');
  const relXml = await readFile(path.join(extractedDir, 'xl', '_rels', 'workbook.xml.rels'), 'utf8');
  // Parse sheet entries from workbook.xml: <sheet name="..." sheetId="..." r:id="rIdN"/>
  // Use [^>]*? rather than [^/]*? because Type="http://..." attribute values
  // contain '/'.
  const tabs = [];
  const sheetRe = /<sheet\s+[^>]*?name="([^"]+)"[^>]*?sheetId="(\d+)"[^>]*?r:id="([^"]+)"/g;
  let m;
  while ((m = sheetRe.exec(wbXml)) !== null) {
    tabs.push({ name: m[1], sheetId: Number(m[2]), rId: m[3], sheetFile: null });
  }
  // Resolve rId → sheet target (e.g. rId6 → "worksheets/sheet2.xml").
  const relRe = /<Relationship\s+[^>]*?Id="([^"]+)"[^>]*?Target="([^"]+)"/g;
  while ((m = relRe.exec(relXml)) !== null) {
    const tab = tabs.find((t) => t.rId === m[1]);
    if (tab) tab.sheetFile = m[2];
  }
  const sharedStrings = await loadSharedStrings(extractedDir);
  return { tabs, sharedStrings };
}

// Column ref like "A1" / "AC42" → column index (0-based) + row number.
function parseCellRef(ref) {
  const m = ref.match(/^([A-Z]+)(\d+)$/);
  if (!m) return null;
  const colLetters = m[1];
  let col = 0;
  for (const ch of colLetters) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col: col - 1, row: Number(m[2]) };
}

export async function parseSheet(extractedDir, sheetFile, sharedStrings) {
  const xml = await readFile(path.join(extractedDir, 'xl', sheetFile), 'utf8');
  const rows = [];
  // <row r="N">…cells…</row>
  const rowRe = /<row\s+[^>]*?r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
  let rm;
  while ((rm = rowRe.exec(xml)) !== null) {
    const rowNum = Number(rm[1]);
    const cells = [];
    const cellRe = /<c\s+([^>]+?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm;
    while ((cm = cellRe.exec(rm[2])) !== null) {
      const attrs = cm[1];
      const inner = cm[2] || '';
      const refMatch = attrs.match(/r="([A-Z]+\d+)"/);
      if (!refMatch) continue;
      const refParts = parseCellRef(refMatch[1]);
      if (!refParts) continue;
      const tMatch = attrs.match(/t="([^"]+)"/);
      const t = tMatch ? tMatch[1] : null;
      const vMatch = inner.match(/<v>([\s\S]*?)<\/v>/);
      const isMatch = inner.match(/<is><t[^>]*>([\s\S]*?)<\/t><\/is>/);
      let value = null;
      if (vMatch) {
        if (t === 's') {
          value = sharedStrings[parseInt(vMatch[1], 10)] ?? '';
        } else {
          value = decodeXmlEntities(vMatch[1]);
        }
      } else if (isMatch) {
        value = decodeXmlEntities(isMatch[1]);
      }
      cells[refParts.col] = value ?? '';
    }
    rows.push({ row: rowNum, cells });
  }
  return rows;
}

// ── Tab + column auto-detection ──────────────────────────────────────────

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function findCurrentMonthTab(tabs, today = new Date()) {
  const y = today.getFullYear();
  const mShort = MONTH_NAMES[today.getMonth()];
  const mFull = MONTH_FULL[today.getMonth()];
  // Match patterns: "May 2026", "May2026", "Mai 2026", "March 2026" (full
  // month names are used for some months in the operator's sheet).
  const patterns = [
    new RegExp(`^${mShort}\\s*${y}$`, 'i'),
    new RegExp(`^${mFull}\\s*${y}$`, 'i'),
  ];
  for (const p of patterns) {
    const hit = tabs.find((t) => p.test(t.name));
    if (hit) return hit;
  }
  // Fallback: pick the newest month tab by parsing tab names.
  const monthTabs = tabs
    .map((t) => {
      const m = t.name.match(/^(\w+)\s+(\d{4})$/);
      if (!m) return null;
      const monthIdx = MONTH_NAMES.findIndex((mn) => mn.toLowerCase() === m[1].slice(0, 3).toLowerCase());
      if (monthIdx < 0) return null;
      return { tab: t, sortKey: Number(m[2]) * 12 + monthIdx };
    })
    .filter(Boolean)
    .sort((a, b) => b.sortKey - a.sortKey);
  return monthTabs[0]?.tab || null;
}

// Header-row aliases per logical field. Each entry's value is an array of
// regexes; the first matching column wins. This is the layer that lets the
// bot survive future spreadsheet renames / column reorderings.
// Headers are matched with case-insensitive prefix patterns. The operator's
// sheet attaches descriptive subtitles to many headers (e.g.
// "Remark (Type \"Info Ready\"...)") so we anchor to the start of the cell
// and let the rest be anything.
const HEADER_ALIASES = {
  status:               [/^status\b/i],
  remark:               [/^remark\b/i, /^remarks\b/i, /^notes?\b/i],
  banner_needed:        [/^banner/i],
  request_number:       [/^request\s*number/i, /^rn\b/i, /^request_?id\b/i],
  requestor:            [/^request[oe]r\b/i],
  date:                 [/^date\b/i],
  priority:             [/^priority\b/i],
  deadline:             [/^deadline\b/i],
  brand:                [/^brand/i],
  region:               [/^region/i],
  campaign:             [/^campaign/i],
  bonus_type:           [/^bonus\s*type/i],
  name_details:         [/^name.*details/i, /^name\/?details/i, /^details/i],
  promo_code:           [/^promo\s*code/i],
  promotion_name_en:    [/^promotion\s*names?\s*\(en\)/i, /^name\s*\(en\)/i],
  promotion_name_zh_id: [/^promotion\s*names?\s*\(zh.*id\)/i, /^promotion\s*names?\s*\(zh\)/i, /^name\s*\(zh/i],
  inbox_message:        [/^inbox\s*message/i],
  popup_dialog:         [/^pop.?up\s*dialog/i, /^popup/i],
  validity:             [/^validity\b/i],
  rewards_validity:     [/^reward(s)?\s*validity/i],
  expiry_minutes_ws1:   [/^expiry/i],
  recurring:            [/^recurring/i, /^claim\s*cadence/i, /^claim\s*frequency/i],
  change_type:          [/^change\s*type/i],
  // The May 2026 tab labels this column "Details to Change (if any)".
  change_details:       [/^change\s*details/i, /^details\s*to\s*change/i],
  max_per_player:       [/^max\s*per\s*player/i],
  // New-convention columns added 2026-07-07 (Z/AA/AB on July 2026 tab).
  stakeholder:          [/^stakeholder/i],
  no_deposit:           [/^no\s*deposit/i],
  suggested_prefix:     [/^suggested\s*prefix/i],
};

export function detectColumnMap(headerCells) {
  const map = {};
  for (const [field, patterns] of Object.entries(HEADER_ALIASES)) {
    for (let i = 0; i < headerCells.length; i++) {
      const cell = String(headerCells[i] ?? '').replace(/\s+/g, ' ').trim();
      if (patterns.some((p) => p.test(cell))) {
        map[field] = i;
        break;
      }
    }
  }
  return map;
}

// ── Row → record (mirrors src/ingest.js parseRow shape) ──────────────────

function unescape(s) { return String(s ?? '').replace(/\\([_])/g, '$1'); }

// Excel stores dates as serial numbers (days since 1900-01-01, with a
// 1900-leap-year bug baked in). Detect numeric-looking date cells and
// convert to "DD MMM YYYY" for readability. Non-date numeric cells pass
// through unchanged.
const EXCEL_EPOCH_OFFSET = 25569;  // days between Excel 1900-01-01 and Unix 1970-01-01
const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function maybeExcelDate(value) {
  const s = String(value ?? '').trim();
  if (!/^\d{4,5}(\.\d+)?$/.test(s)) return s;  // not a serial-date-shaped number
  const n = Number(s);
  if (n < 30000 || n > 80000) return s;        // outside reasonable date range (1982–2118)
  const ms = (n - EXCEL_EPOCH_OFFSET) * 86400 * 1000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return s;
  return `${d.getUTCDate()} ${MONTH_ABBR[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// Col T cell shape can be:
//   "99999\n100"         → lifetime 99999, daily 100
//   "99999"              → lifetime 99999, daily 99999 (same cap)
//   "99999 / 100"        → lifetime 99999, daily 100 (slash separator)
//   ""                   → both undefined (mapper defaults apply)
export function parseMaxPlayerCaps(raw) {
  if (!raw) return { lifetime: undefined, daily: undefined };
  const parts = String(raw).split(/[\n\r/,]+/).map((s) => s.trim()).filter(Boolean);
  const num = (s) => {
    const n = Number(s.replace(/[^\d.]/g, ''));
    return Number.isFinite(n) ? n : undefined;
  };
  if (parts.length >= 2) return { lifetime: num(parts[0]), daily: num(parts[1]) };
  if (parts.length === 1) {
    const n = num(parts[0]);
    return { lifetime: n, daily: n };
  }
  return { lifetime: undefined, daily: undefined };
}

export function rowToRecord(cells, colMap, sourceLine) {
  const get = (k) => {
    const idx = colMap[k];
    return idx == null ? '' : (cells[idx] ?? '');
  };
  const requestId = String(get('request_number') ?? '').trim();
  if (!/^[PB]\d{3,}$/.test(requestId)) return null;
  // Status may be empty for in-progress rows (operator hasn't dropdown-set
  // "QC Completed" yet). We still parse the record so the bot can dry-run
  // those rows; the canary's brand safe-list + idempotency check are the
  // real safety gates.
  const status = String(get('status') ?? '').trim();
  const remark = String(get('remark') ?? '');
  const brands = parseBrands(get('brand'));
  const regions = parseRegions(get('region'));
  const { currencies, locales, unknownRegions } = regionsToCurrenciesAndLocales(regions);
  const bonus = parseBonusType(get('bonus_type'));
  const promoCode = unescape(get('promo_code'));
  const detailsRaw = String(get('name_details') ?? '');
  const detailsParsed = parseDetails(detailsRaw, {
    bonusType: get('bonus_type'),
    promoCode,
  });
  const platforms = [...new Set(brands.map((b) => BRAND_TO_SITE[b]?.platform).filter(Boolean))];
  const unknownBrands = brands.filter((b) => !BRAND_TO_SITE[b]);
  const recurring = parseRecurring(get('recurring'));
  // Col T = "Max per Player (Lifetime) \n\n Daily Max" — two stacked numbers
  // in one cell. Parse rules:
  //   - If two non-empty lines: line 1 = lifetime, line 2 = daily
  //   - If one number: treat as both lifetime AND daily (operator's shorthand
  //     for "same cap for both")
  //   - If empty: leave undefined; the canary mapper falls back to defaults
  const maxPlayerRaw = String(get('max_per_player') ?? '').trim();
  const maxPlayerCaps = parseMaxPlayerCaps(maxPlayerRaw);

  // New convention (2026-07-07): Requestor column doubles as campaign owner
  // when it holds one of the owner codes. Person-name requestors → null
  // (legacy row; campaign prefix falls back to CAMPAIGN_PREFIX_RULES).
  const requestorRaw = String(get('requestor') ?? '');
  const ownerCandidate = requestorRaw.trim().toUpperCase();
  const campaignOwner = OWNER_CODES.includes(ownerCandidate) ? ownerCandidate : null;

  const record = {
    request_id: requestId,
    status,
    remark,
    requestor: requestorRaw,
    campaign_owner: campaignOwner,
    stakeholder: String(get('stakeholder') ?? '').trim() || null,
    no_deposit: /^yes$/i.test(String(get('no_deposit') ?? '').trim()),
    suggested_prefix: String(get('suggested_prefix') ?? '').trim() || null,
    date: maybeExcelDate(get('date')),
    priority: String(get('priority') ?? ''),
    deadline: maybeExcelDate(get('deadline')),
    brands,
    regions,
    currencies,
    locales,
    campaign: String(get('campaign') ?? ''),
    bonus_type: bonus.type,
    bonus_sub_type: bonus.subType,
    name_details_raw: detailsRaw,
    promo_code: promoCode,
    promotion_name_en: String(get('promotion_name_en') ?? ''),
    promotion_name_zh_id: String(get('promotion_name_zh_id') ?? ''),
    // inbox_message / popup_dialog: any non-blank non-"no/false" content
    // enables. Operator may write "true" OR free-text (e.g. a reference to
    // an existing inbox code on another brand).
    inbox_message: !/^\s*(|no|false|n\/a|na|-)\s*$/i.test(String(get('inbox_message') ?? '')),
    inbox_message_raw: String(get('inbox_message') ?? '').trim() || null,
    popup_dialog: !/^\s*(|no|false|n\/a|na|-)\s*$/i.test(String(get('popup_dialog') ?? '')),
    popup_dialog_raw: String(get('popup_dialog') ?? '').trim() || null,
    validity_days: parseValidityDays(get('validity')),
    rewards_validity_days: parseValidityDays(get('rewards_validity')),
    recurring,
    max_per_player: maxPlayerCaps.lifetime,
    daily_max: maxPlayerCaps.daily,
    change_type: String(get('change_type') ?? '') || null,
    change_details: String(get('change_details') ?? '') || null,
    platforms,
    parsed: detailsParsed.parsed,
    per_currency_overrides: detailsParsed.perCurrencyOverrides,
    instructions: parseInstructions(remark, detailsRaw, String(get('change_details') ?? ''), String(get('inbox_message') ?? '')),
    gaps: [
      ...(unknownBrands.length ? [`unknown_brand: ${unknownBrands.join(', ')}`] : []),
      ...(unknownRegions.length ? [`unknown_region: ${unknownRegions.join(', ')}`] : []),
      ...detailsParsed.gaps,
    ],
    source_line: sourceLine,
    handle: `${requestId}-r${sourceLine}`,
  };
  return record;
}

// ── Public entry — ingest the current-month tab ──────────────────────────

export async function ingestCurrentMonth(extractedDir = 'captures/sheet-extracted', { today, onlyQcCompleted = false, tabNameOverride } = {}) {
  const { tabs, sharedStrings } = await loadWorkbook(extractedDir);
  const tab = tabNameOverride
    ? tabs.find((t) => t.name === tabNameOverride)
    : findCurrentMonthTab(tabs, today || new Date());
  if (!tab) {
    throw new Error(`No matching tab found for current month (${(today || new Date()).toISOString().slice(0, 7)}). Tabs: ${tabs.map((t) => t.name).join(', ')}`);
  }
  if (!tab.sheetFile) {
    throw new Error(`Tab "${tab.name}" has no resolved sheetFile`);
  }
  const sheetRows = await parseSheet(extractedDir, tab.sheetFile, sharedStrings);
  if (sheetRows.length === 0) return { tab: tab.name, records: [], colMap: {} };
  // First row is the header — detect column positions.
  const header = sheetRows[0].cells;
  const colMap = detectColumnMap(header);
  // Iterate from row 2 onwards.
  const records = [];
  for (const { row, cells } of sheetRows.slice(1)) {
    const rec = rowToRecord(cells, colMap, row);
    if (!rec) continue;
    if (onlyQcCompleted && !/qc.*complete/i.test(rec.status)) continue;
    records.push(rec);
  }
  return { tab: tab.name, records, colMap };
}

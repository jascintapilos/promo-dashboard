// Collector item 5: cached, read-only Promo Request Sheet fallback for
// expected-source resolution. Used ONLY when the local filesystem-based
// resolver (expected-source.js — captures/requests + captures/qc-bundles)
// finds nothing, e.g. an older approved request that was never locally
// ingested, or a WS1_ID/TH/KH promo this repo has no bundle history for.
//
// Runs ONLY where the existing OAuth Sheets integration already works (the
// VDI) — reuses src/sheets-ingest.js / src/sheets-client.js exactly as the
// daily ingest does, no new auth path. Any failure (missing token file,
// network, sheet-shape change) is caught and treated as "fallback
// unavailable", never thrown into a QC run and never a reason to derive an
// expectation from anything else. The raw sheet rows and OAuth client never
// leave this process — only the single matched request RECORD (the same
// shape captures/requests/*.json already exposes to the rest of the
// pipeline) is returned to the caller.
//
// CIRCULARITY GUARD: this reads the SHEET — the human-approved source of
// truth — never the live BO. It must never be used to manufacture an
// expectation from what the live BO currently shows.
//
// Handle lookups only ever check the CURRENT-month tab, matching the
// standing rule elsewhere in this codebase (memory:
// feedback_promo_request_sheet_current_month.md — "P### repeats across
// months," so a bare handle is not safe to search across history). Exact
// promo_code+brand lookups (no handle) may search a few recent months,
// since promo_code — unlike a P### handle — is designed to be unique.

import { ingestCurrentMonthFromSheet } from '../sheets-ingest.js';
import { getSheetsClient, listTabs } from '../sheets-client.js';

const DEFAULT_TTL_MS = 5 * 60 * 1000; // same "briefly" rationale as catalogues.js
const MONTH_SHORT = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const tabCache = new Map(); // tabName (or '__current__') -> { result, fetchedAtMs }

function isFresh(entry, ttlMs, now) {
  return Boolean(entry) && (now - entry.fetchedAtMs) < ttlMs;
}

async function getTabRecordsCached(tabName, { ttlMs, now, ingestImpl }) {
  const key = tabName || '__current__';
  const cached = tabCache.get(key);
  if (isFresh(cached, ttlMs, now)) return cached.result;
  const ingest = ingestImpl || ingestCurrentMonthFromSheet;
  const result = await ingest({ tabNameOverride: tabName || undefined });
  tabCache.set(key, { result, fetchedAtMs: now });
  return result;
}

// Recent month tabs, newest first, EXCLUDING the current month (which the
// caller always tries first via tabNameOverride: undefined). Reads the
// spreadsheet's real tab list rather than constructing guessed names, so it
// tolerates whatever short/full month-name convention the operator's sheet
// actually uses.
let _tabsListCache = null; // { tabs, fetchedAtMs } — separate from the per-tab record cache below

async function listTabsCached(now, ttlMs, { listTabsImpl, sheetsClientImpl } = {}) {
  if (isFresh(_tabsListCache, ttlMs, now)) return _tabsListCache.tabs;
  const client = sheetsClientImpl ? await sheetsClientImpl() : await getSheetsClient();
  const tabs = listTabsImpl ? await listTabsImpl(client) : await listTabs(client);
  _tabsListCache = { tabs, fetchedAtMs: now };
  return tabs;
}

async function recentMonthTabs(count, { listTabsImpl, sheetsClientImpl, nowMs, ttlMs } = {}) {
  if (count <= 0) return [];
  const tabs = await listTabsCached(nowMs, ttlMs, { listTabsImpl, sheetsClientImpl });
  const now = new Date();
  const currentSortKey = now.getFullYear() * 12 + now.getMonth();
  const parsed = tabs
    .map((t) => {
      const m = String(t.name || '').match(/^([A-Za-z]+)\s*(\d{4})$/);
      if (!m) return null;
      const idx = MONTH_SHORT.indexOf(m[1].slice(0, 3).toLowerCase());
      if (idx < 0) return null;
      return { name: t.name, sortKey: Number(m[2]) * 12 + idx };
    })
    .filter(Boolean)
    .filter((t) => t.sortKey < currentSortKey) // strictly PAST months only — current month is tried separately
    .sort((a, b) => b.sortKey - a.sortKey);
  return parsed.slice(0, count).map((t) => t.name);
}

function dedupeByKey(items, keyFn) {
  const seen = new Map();
  for (const it of items) {
    const k = keyFn(it);
    if (!seen.has(k)) seen.set(k, it);
  }
  return [...seen.values()];
}

// Mirrors expected-source.js's _hydrate() return shape exactly, so
// compare-flow.js can treat a sheet-sourced result identically to a
// filesystem-sourced one (same `.source` shape either way — sheets-ingest.js
// already produces records "interchangeable with ingest-xlsx.js output").
function toResolvedSource({ rec, tab, brand, expectedCode }) {
  const sourceCode = rec.promo_code;
  if (expectedCode && sourceCode && sourceCode !== expectedCode) {
    return { sourceType: 'not-found', reason: `sheet row code "${sourceCode}" does not match requested "${expectedCode}"` };
  }
  return {
    sourceType: 'sheet',
    sourceId: `sheet:${tab}::${rec.handle}`,
    sourcePath: null,
    sourceTs: null,
    approvalStatus: rec.status || null,
    handle: rec.handle,
    promoCode: sourceCode,
    brand,
    source: rec,
    liveStateFromBundle: null,
    promotionId: null,
  };
}

// Public API — same call shape as expected-source.js's resolveExpectedSource.
// monthsToSearch only applies to the no-handle (exact promo_code) path.
export async function resolveExpectedSourceFromSheet({
  brand, code, handle = null, monthsToSearch = 2, ttlMs = DEFAULT_TTL_MS, now = Date.now(),
  ingestImpl, listTabsImpl, sheetsClientImpl,
} = {}) {
  if (!brand) return { sourceType: 'invalid', reason: 'brand required' };
  if (!code && !handle) return { sourceType: 'invalid', reason: 'code or handle required' };

  let pastTabs = [];
  if (!handle && monthsToSearch > 1) {
    try { pastTabs = await recentMonthTabs(monthsToSearch - 1, { listTabsImpl, sheetsClientImpl, nowMs: now, ttlMs }); }
    catch { pastTabs = []; } // sheet unreachable — current-month attempt below still tries, and will also fail gracefully
  }
  const tabsToTry = [undefined, ...pastTabs]; // undefined = current month, resolved by ingestCurrentMonthFromSheet itself

  const matches = [];
  for (const tabName of tabsToTry) {
    let result;
    try {
      result = await getTabRecordsCached(tabName, { ttlMs, now, ingestImpl });
    } catch {
      continue; // this tab/credentials unavailable this call — try the next tab, or fall through to not-found
    }
    for (const rec of (result.records || [])) {
      if (!rec.promo_code || !Array.isArray(rec.brands)) continue;
      const brandOk = rec.brands.includes(brand);
      if (!brandOk) continue;
      if (handle ? rec.handle === handle : rec.promo_code === code) {
        matches.push({ rec, tab: result.tab });
      }
    }
    if (handle && matches.length) break; // handle lookups stop at the first (current-month) hit by design
  }

  if (matches.length === 0) {
    return { sourceType: 'not-found', reason: `no sheet row found for brand="${brand}" ${handle ? `handle="${handle}"` : `code="${code}"`}` };
  }
  const distinct = dedupeByKey(matches, (m) => `${m.tab}::${m.rec.handle}`);
  if (distinct.length > 1) {
    return {
      sourceType: 'ambiguous',
      reason: `multiple sheet rows match brand="${brand}" ${handle ? `handle="${handle}"` : `code="${code}"`} across tabs [${distinct.map((m) => m.tab).join(', ')}] — resolve by passing an exact handle`,
      matches: distinct.map((m) => ({ tab: m.tab, handle: m.rec.handle })),
    };
  }
  return toResolvedSource({ rec: distinct[0].rec, tab: distinct[0].tab, brand, expectedCode: code });
}

export function _clearSheetsFallbackCache() { tabCache.clear(); _tabsListCache = null; }

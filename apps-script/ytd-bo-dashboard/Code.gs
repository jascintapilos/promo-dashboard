/**
 * Promo Operations Hub — Interactive BO-direct Dashboard
 *
 * Reads two tabs from the source sheet:
 *   - Data:        period | platform | brand | metric | count | meta(json)
 *   - PeriodIndex: period | from | to | label | group  (YTD / Monthly / Weekly)
 *
 * Adding new metrics or platforms = append more rows. Frontend filters
 * + charts adapt automatically.
 */
const SOURCE_SHEET_ID = '1ceJuO2moCKaLf3Uk3EK3DCFgxLXKNCmib6B1wqZLOSQ';
const DATA_TAB        = 'Data';
const PERIOD_TAB      = 'PeriodIndex';
const CACHE_KEY       = 'promo_ops_hub_v3';
const CACHE_TTL_SEC   = 300;

function doGet() {
  return HtmlService.createTemplateFromFile('dashboard')
    .evaluate()
    .setTitle('Promo Operations Hub')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getRows() {
  const cache = CacheService.getScriptCache();
  const c = cache.get(CACHE_KEY);
  if (c) return JSON.parse(c);

  const ss = SpreadsheetApp.openById(SOURCE_SHEET_ID);
  const data = readTabAsObjects_(ss.getSheetByName(DATA_TAB));
  const periods = readTabAsObjects_(ss.getSheetByName(PERIOD_TAB));

  // Parse JSON meta
  for (const r of data) {
    if (typeof r.meta === 'string' && r.meta.startsWith('{')) {
      try { r.meta = JSON.parse(r.meta); } catch (_) {}
    }
  }
  const payload = {
    rows: data,
    periods: periods,
    generatedAt: new Date().toISOString(),
    sourceSheet: `https://docs.google.com/spreadsheets/d/${SOURCE_SHEET_ID}/edit`,
  };
  cache.put(CACHE_KEY, JSON.stringify(payload), CACHE_TTL_SEC);
  return payload;
}

function readTabAsObjects_(sheet) {
  if (!sheet) return [];
  const lr = sheet.getLastRow(), lc = sheet.getLastColumn();
  if (lr < 2) return [];
  const values = sheet.getRange(1, 1, lr, lc).getValues();
  const headers = values[0].map(String);
  const out = [];
  for (let i = 1; i < values.length; i++) {
    const obj = {};
    for (let j = 0; j < headers.length; j++) obj[headers[j]] = values[i][j];
    out.push(obj);
  }
  return out;
}

function clearCache() {
  CacheService.getScriptCache().remove(CACHE_KEY);
  return 'OK';
}

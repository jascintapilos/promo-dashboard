// Promo Codes tab — pure parsing + BO-status logic (no I/O, no imports).
//
// Used on the VDI by bin/push-promo-codes.mjs to turn the three team code sheets
// (CEE / Sales / CRM) into one normalised row list, and to stamp each row with
// its live BO status per brand. Kept dependency-free so it is unit-testable and
// never drags the promo write-path into the dashboard. See docs/plans/promo-codes-tab.md.

// Sales tabs in priority order. "Index (All Teams)" is NOT complete (2026-10-20:
// 160 of 397 codes), so every tab is read and a code is taken from the first tab
// that lists it; later tabs only add codes not seen before.
export const SALES_TABS = Object.freeze([
  'Index (All Teams)', 'VM - All Codes (BO)', 'TSM - Codes by Segment x Brand', 'AM - Codes by Campaign',
  'VM - Live Codes by Campaign', 'Bonus Menu',
]);

// The sheets and the tabs read from each. CRM's "All CRM Codes" and CEE's single
// tab already hold everything (the per-person CRM tabs are subsets).
export const PROMO_CODE_SOURCES = Object.freeze([
  { source: 'CEE', spreadsheetId: '1gCXe0wzYySMG-usZHvXAFVqq3SL2UmHhPjpvDemToKA', tabs: ['CEE Codes'] },
  { source: 'Sales', spreadsheetId: '1Teg9TiKlubOjNF-0mjoHA9QLmWiI6EoiivMzjJgNm8s', tabs: SALES_TABS },
  { source: 'CRM', spreadsheetId: '1-ZjgA3ietUyh7TpotivVID1GgLZ9CyV7nIpy-PRA1HU', tabs: ['All CRM Codes'] },
]);

// BO status values carried per brand key.
export const BO = Object.freeze({ ACTIVE: 'active', EXPIRED: 'expired', INACTIVE: 'inactive', UNCHECKED: 'unchecked' });

const cell = (row, i) => (i >= 0 && row[i] != null ? String(row[i]).trim() : '');
const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

// First row containing every wanted header (case/space-insensitive). The sheets
// carry a title row and blank rows above the header, so never assume row 1.
export function findHeaderRow(values, wanted) {
  const want = wanted.map(norm);
  for (let r = 0; r < Math.min(values.length, 30); r++) {
    const cells = (values[r] || []).map(norm);
    if (want.every((w) => cells.includes(w))) return { index: r, cols: cells };
  }
  return null;
}

// "QP2A, QP2B, QPRO1-4" / "QPRO2-3, QPRO5" / "QP2A-D" / "WS1" → ['QP2A','QP2B','QPRO1',…].
// Unknown shapes pass through upper-cased so they show as "not checked", never vanish.
export function expandBrands(text) {
  const out = [];
  for (const raw of String(text || '').replace(/\bonly\b/gi, '').split(/[,\n;/]+/)) {
    const t = raw.trim().toUpperCase().replace(/\s+/g, '');
    if (!t || t === '—' || t === '-') continue;
    let m = t.match(/^(WS[12])(MY|SG|ID|TH|KH)$/);              // "WS1 MY" — region comes from the Region column
    if (m) { out.push(m[1]); continue; }
    m = t.match(/^([A-Z]+)(\d+)-(?:\1)?(\d+)$/);                // QPRO1-4, QPRO1-QPRO4
    if (m) {
      const [, p, a, b] = m; const lo = Number(a); const hi = Number(b);
      if (hi >= lo && hi - lo < 40) { for (let i = lo; i <= hi; i++) out.push(`${p}${i}`); continue; }
    }
    m = t.match(/^(QP2)([A-D])-(?:QP2)?([A-D])$/);              // QP2A-D
    if (m) {
      for (let c = m[2].charCodeAt(0); c <= m[3].charCodeAt(0); c++) out.push(`QP2${String.fromCharCode(c)}`);
      continue;
    }
    out.push(t);
  }
  return [...new Set(out)];
}

export function parseRegions(text) {
  return [...new Set(String(text || '').toUpperCase().split(/[^A-Z]+/).filter((r) => /^(MY|SG|ID|TH|KH)$/.test(r)))];
}

// Pulls labelled brand lists out of a free-text status cell, e.g.
// "Active (13 brands) Live: QPRO1-10, QPRO15-17 Inactive: QP2A-D" or
// "Active on BO: QP2A, QP2B Switched off on BO: QPRO2-4".
const STATUS_LABELS = [
  ['on', /still active on bo:/i], ['on', /active on bo:/i], ['on', /live:/i],
  ['off', /switched off on bo:/i], ['off', /inactive:/i],
  ['skip', /not checked:/i],
];
export function parseStatusSegments(text) {
  const s = String(text || '');
  const hits = [];
  for (const [kind, re] of STATUS_LABELS) {
    const g = new RegExp(re.source, 'gi');
    let m;
    while ((m = g.exec(s))) {
      // "still active on bo:" also matches "active on bo:" — keep the longest match only.
      if (hits.some((h) => m.index >= h.start && m.index < h.end)) continue;
      hits.push({ kind, start: m.index, end: m.index + m[0].length });
    }
  }
  hits.sort((a, b) => a.start - b.start);
  const seg = { on: [], off: [], skip: [] };
  hits.forEach((h, i) => {
    const body = s.slice(h.end, i + 1 < hits.length ? hits[i + 1].start : s.length);
    seg[h.kind].push(...expandBrands(body));
  });
  return seg;
}

const RETIRED_RE = /not in use|crossed out|retired|discontinued/i;
const OFF_STATUS_RE = /^\s*(inactive|expired|dead|not live|switched off|off)\b/i;

// The Sales index names groups, not brands: "ALL (QP2/QPRO)", "ALL (except WS1)",
// "QP2/QPRO + WS", "21 brands". For those the named brands come from the status
// cell's Live/Inactive lists; every QPRO/QP2 brand (+ WS1/WS2 when the label says
// WS) is still checked, but only as information.
export function brandScope(text) {
  const t = String(text || '').trim();
  const all = /^all\b/i.test(t) || /^\d+\s+brands?$/i.test(t) || /^qp2\s*\/\s*qpro\b/i.test(t);
  return { all, ws: all && /\bws\d?\b/i.test(t) && !/except\s+ws/i.test(t) };
}

// Builds one normalised row.
function makeRow({ source, group = '', pic = '', section = '', code, wsCode = '', brandText, regionText, type = '', offer = '', sheetStatus = '', note = '', noClaim: forceNoClaim = false }) {
  const seg = parseStatusSegments(sheetStatus);
  const scope = brandScope(brandText);
  const isAll = scope.all;
  const brands = isAll ? [] : expandBrands(brandText);
  // "Not checked: QPRO11-14" means the sheet makes no claim for those brands, so
  // they are not added (on an ALL row they still show, as informational, via allBrandKeys).
  for (const b of [...seg.on, ...seg.off]) if (!brands.includes(b)) brands.push(b);
  const retired = RETIRED_RE.test(section) || RETIRED_RE.test(note) || OFF_STATUS_RE.test(sheetStatus);
  // "Not checked WS1, WS2 BO not reachable" — the sheet makes no claim, so BO can't disagree with it.
  // A WS1/WS2 twin code (Bonus Menu / Live Codes by Campaign) does not say which WS brand carries it: no claim either.
  const noClaim = forceNoClaim || /^\s*not checked\b/i.test(sheetStatus);
  // Brands the sheet says should be OFF. A retired row expects every brand off,
  // even when its status cell says "⚠ Still active on BO" (that IS the problem).
  const expectedOff = retired ? [...brands] : [...new Set(seg.off)];
  return {
    source, group, pic, section, code, wsCode, brands, brandsAll: isAll, brandsAllWs: scope.ws,
    regions: parseRegions(regionText), type, offer, sheetStatus, note, retired, noClaim, expectedOff,
  };
}

// "1 · Deposit-match  (81)" → "Deposit-match"
const cleanGroup = (t) => t.replace(/\s*\(\d+\)\s*$/, '').replace(/^\d+[a-z]?\s*·\s*/i, '').trim();

// map(row, col, section) returns a row, an array of rows, or null (title, blank
// and group-heading rows). A row with text only in column A is a group heading;
// its text is passed on as `section` to the rows under it.
function rowsFrom(values, header, map) {
  const out = [];
  const col = (name) => header.cols.indexOf(norm(name));
  let section = '';
  for (let r = header.index + 1; r < values.length; r++) {
    const row = values[r] || [];
    const built = map(row, col, section);
    if (built) { for (const b of [].concat(built)) out.push(makeRow(b)); continue; }
    if (cell(row, 0) && row.slice(1).every((c) => !String(c ?? '').trim())) section = cleanGroup(cell(row, 0));
  }
  return out;
}

export function parseCeeCodes(values) {
  const header = findHeaderRow(values, ['Section', 'Live Code (BO)', 'Brands']);
  if (!header) throw new Error('CEE Codes: header row not found');
  return rowsFrom(values, header, (row, col) => {
    const code = cell(row, col('Live Code (BO)'));
    if (!code) return null;
    return {
      source: 'CEE', group: 'CEE', section: cell(row, col('Section')), code,
      brandText: cell(row, col('Brands')), regionText: cell(row, col('Region')),
      type: cell(row, col('Game Category')), offer: cell(row, col('Offer (from CEE list)')),
      sheetStatus: cell(row, col('Status')), note: cell(row, col('Note')),
    };
  });
}

export function parseSalesIndex(values) {
  const header = findHeaderRow(values, ['Team', 'Live Code (BO)', 'Status']);
  if (!header) throw new Error('Sales Index: header row not found');
  return rowsFrom(values, header, (row, col) => {
    const code = cell(row, col('Live Code (BO)'));
    if (!code) return null;
    return {
      source: 'Sales', group: cell(row, col('Team')), code,
      brandText: cell(row, col('Brand / Platform')), regionText: cell(row, col('Region')),
      offer: cell(row, col('Bonus Name / Offer')), sheetStatus: cell(row, col('Status')),
    };
  });
}

export function parseCrmAll(values) {
  const header = findHeaderRow(values, ['Stakeholder', 'Live Code (BO)', 'Brands']);
  if (!header) throw new Error('All CRM Codes: header row not found');
  return rowsFrom(values, header, (row, col) => {
    const code = cell(row, col('Live Code (BO)'));
    if (!code) return null;
    return {
      source: 'CRM', group: cell(row, col('Stakeholder')), pic: cell(row, col('CRM PIC')),
      section: cell(row, col('Mechanic')), code,
      brandText: cell(row, col('Brands')), regionText: cell(row, col('Region')),
      type: cell(row, col('Type')), offer: cell(row, col('Bonus Name')), sheetStatus: cell(row, col('Status')),
    };
  });
}

export function parseVmAllCodes(values) {
  const header = findHeaderRow(values, ['Mechanic', 'Live Code (BO)', 'QP2/QPRO Brands']);
  if (!header) throw new Error('Sales "VM - All Codes (BO)": header row not found');
  return rowsFrom(values, header, (row, col, section) => {
    const code = cell(row, col('Live Code (BO)'));
    if (!code) return null;
    return {
      source: 'Sales', group: 'VM', section, code,
      brandText: cell(row, col('QP2/QPRO Brands')), regionText: cell(row, col('Region')),
      type: cell(row, col('Type')), offer: cell(row, col('Bonus Name')), sheetStatus: cell(row, col('Status')),
    };
  });
}

export function parseTsmCodes(values) {
  const header = findHeaderRow(values, ['Segment', 'Brand / Platform', 'Live Code (BO)']);
  if (!header) throw new Error('Sales "TSM - Codes by Segment x Brand": header row not found');
  return rowsFrom(values, header, (row, col, section) => {
    const code = cell(row, col('Live Code (BO)'));
    if (!code) return null;
    return {
      source: 'Sales', group: 'TSM', section, code,
      brandText: cell(row, col('Brand / Platform')), regionText: cell(row, col('Region')),
      offer: cell(row, col('Offer')), sheetStatus: cell(row, col('Status')),
    };
  });
}

export function parseAmCodes(values) {
  const header = findHeaderRow(values, ['Campaign', 'Live Code (BO)', 'Brand coverage']);
  if (!header) throw new Error('Sales "AM - Codes by Campaign": header row not found');
  return rowsFrom(values, header, (row, col, section) => {
    const code = cell(row, col('Live Code (BO)'));
    if (!code) return null;
    // "Brand coverage" is a count ("21 brands"); the named brands come from the Status cell.
    return {
      source: 'Sales', group: 'AM', section, code,
      brandText: cell(row, col('Brand coverage')), regionText: cell(row, col('Region')),
      offer: cell(row, col('Bonus Name')), note: cell(row, col('Note')), sheetStatus: cell(row, col('Status')),
    };
  });
}

// One line can carry two codes: the QP2/QPRO code and its FT_ WS1/WS2 twin.
export function parseVmLiveByCampaign(values) {
  const header = findHeaderRow(values, ['Campaign', 'Code — QP2/QPRO', 'Code — WS1/WS2']);
  if (!header) throw new Error('Sales "VM - Live Codes by Campaign": header row not found');
  return rowsFrom(values, header, (row, col, section) => {
    const code = cell(row, col('Code — QP2/QPRO'));
    const ws = cell(row, col('Code — WS1/WS2'));
    if (!code && !ws) return null;
    const base = { source: 'Sales', group: 'VM', section, regionText: cell(row, col('Region')), offer: cell(row, col('Bonus Name')) };
    const out = [];
    if (code) out.push({ ...base, code, wsCode: ws && ws !== code ? ws : '', brandText: cell(row, col('QP2/QPRO Brands')) });
    if (ws && ws !== code) out.push({ ...base, code: ws, brandText: 'WS1, WS2', noClaim: true });
    return out;
  });
}

export function parseBonusMenu(values) {
  const header = findHeaderRow(values, ['Promo Code', 'Promo Code for WS1 + WS2', 'Bonus Name']);
  if (!header) throw new Error('Sales "Bonus Menu": header row not found');
  const statusCol = header.cols.findIndex((c) => c.startsWith('status')); // "Status (BO 2026-09-07)"
  return rowsFrom(values, header, (row, col) => {
    const code = cell(row, col('Promo Code'));
    const ws = cell(row, col('Promo Code for WS1 + WS2'));
    if (!code && !ws) return null;
    const base = { source: 'Sales', group: 'VM', section: 'Bonus Menu', offer: cell(row, col('Bonus Name')), note: cell(row, col('Remark')), sheetStatus: cell(row, statusCol) };
    const out = [];
    // The menu applies to every QP2/QPRO brand; the same code in both columns means WS too.
    if (code) out.push({ ...base, code, wsCode: ws && ws !== code ? ws : '', brandText: ws === code ? 'ALL (QP2/QPRO) + WS' : 'ALL (QP2/QPRO)' });
    if (ws && ws !== code) out.push({ ...base, code: ws, brandText: 'WS1, WS2', noClaim: true });
    return out;
  });
}

const SALES_PARSERS = Object.freeze({
  'Index (All Teams)': parseSalesIndex, 'VM - All Codes (BO)': parseVmAllCodes, 'TSM - Codes by Segment x Brand': parseTsmCodes,
  'AM - Codes by Campaign': parseAmCodes, 'VM - Live Codes by Campaign': parseVmLiveByCampaign, 'Bonus Menu': parseBonusMenu,
});

// All Sales tabs; the first tab (in SALES_TABS order) that lists a code wins. Rows
// of the same code within that tab are all kept (e.g. one Index row per brand).
export function parseSalesAll(valuesByTab) {
  const seen = new Set();
  const out = [];
  for (const tab of SALES_TABS) {
    if (!valuesByTab[tab]) throw new Error(`Sales tab "${tab}" not found`);
    const rows = SALES_PARSERS[tab](valuesByTab[tab]);
    out.push(...rows.filter((r) => !seen.has(r.code.toUpperCase())));
    for (const r of rows) seen.add(r.code.toUpperCase());
  }
  return out;
}

// Each takes { [tabName]: values } for its source's tabs.
export const PARSERS = Object.freeze({
  CEE: (v) => parseCeeCodes(v['CEE Codes']),
  Sales: parseSalesAll,
  CRM: (v) => parseCrmAll(v['All CRM Codes']),
});

// ── BO status ────────────────────────────────────────────────────────────────

// Sheet brand → the BO keys that cover it. WS1 is one IGMP site per region, so a
// WS1 row listed for MY + SG checks WS1_MY and WS1_SG separately.
export function boKeysFor(brand, regions, igmpSites) {
  if (brand === 'WS1') {
    const sites = igmpSites.filter((s) => s.brand.startsWith('WS1_'));
    const picked = regions.length ? sites.filter((s) => regions.includes(s.region)) : sites;
    return picked.map((s) => s.brand);
  }
  return [brand];
}

const isPast = (v, now) => {
  const t = Date.parse(String(v || '').replace(' ', 'T'));
  return Number.isFinite(t) && t < now;
};

// liveCodes: fetchAllLiveCodes().codes (active only). checkedBrands: every BO key
// that was successfully listed this run. Returns rows with `bo` + `mismatch` added.
export function applyBoStatus(rows, { liveCodes, checkedBrands, igmpSites, allBrandKeys, now = Date.now() }) {
  const live = new Map(); // `${boKey}::${CODE}` → code record
  for (const c of liveCodes) live.set(`${c.brand}::${String(c.code).trim().toUpperCase()}`, c);
  const checked = new Set(checkedBrands);
  return rows.map((row) => {
    const codes = [row.code, row.wsCode].filter(Boolean).map((c) => c.toUpperCase());
    // "ALL (QP2/QPRO)" rows: check every QPRO/QP2 brand (+ WS1/WS2 when the label
    // says WS), plus any the sheet named.
    const sheetBrands = row.brandsAll
      ? [...new Set([...allBrandKeys, ...(row.brandsAllWs ? ['WS1', 'WS2'] : []), ...row.brands])]
      : row.brands;
    const bo = {};
    const mismatches = [];
    for (const brand of sheetBrands) {
      for (const key of boKeysFor(brand, row.regions, igmpSites)) {
        let status = BO.UNCHECKED;
        if (checked.has(key)) {
          const hit = codes.map((c) => live.get(`${key}::${c}`)).find(Boolean);
          status = !hit ? BO.INACTIVE : (isPast(hit.validTo || hit.endDate, now) || hit.isExpired ? BO.EXPIRED : BO.ACTIVE);
        }
        bo[key] = status;
        if (status === BO.UNCHECKED || row.noClaim) continue;
        const wantOff = row.expectedOff.includes(brand);
        // ALL rows only flag brands the sheet actually named; the rest are informational.
        const named = !row.brandsAll || row.brands.includes(brand);
        if (!named) continue;
        if (wantOff && status === BO.ACTIVE) mismatches.push(`${key}: still active on BO`);
        if (!wantOff && status !== BO.ACTIVE) mismatches.push(`${key}: ${status === BO.EXPIRED ? 'end date passed' : 'not active on BO'}`);
      }
    }
    return { ...row, bo, mismatch: mismatches };
  });
}

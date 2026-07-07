/**
 * Check FT QP2 segments in CRM Assignment Log vs what was pulled.
 * Columns: Date=0, Brand=1, Region=2, CRM Tool=3, Segment Name=4, Created By=5
 */
import { getSheetsClient } from '../src/sheets-client.js';
import { getOpsSheetId } from '../src/ops-sheet.js';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from './_args.js';

const { flags } = parseArgs(process.argv.slice(2));
const VERBOSE = flags.verbose === true;

const SHEET_ID = getOpsSheetId();
const TAB = 'CRM Assignment Log';
const TMP = path.resolve('tmp-ft-browser-pull-qp2.json');

const TBP_TEAM = new Set([
  'Alysa', 'Elyssa', 'Jascinta', 'Wai Yip', 'WY', 'Boon Inn', 'Michelle', 'Bangun', 'Gaby', 'Gabrielle',
]);

const c = await getSheetsClient();

console.log('Reading CRM Assignment Log (QP2 rows)...');
const resp = await c.sheets.spreadsheets.values.get({
  spreadsheetId: SHEET_ID,
  range: `'${TAB}'!A:F`,
  valueRenderOption: 'UNFORMATTED_VALUE',
});
const rows = resp.data.values || [];
const [header, ...dataRows] = rows;

const qp2Rows = dataRows.filter(r => (r[3] || '').includes('QP2'));
const qp2SegNames = new Set(qp2Rows.map(r => r[4]));
console.log(`FastTrack QP2 rows: ${qp2Rows.length}`);

// Brand/Region breakdown
const brandDist = {};
const regionDist = {};
const blankBrand = qp2Rows.filter(r => !r[1]);
const blankRegion = qp2Rows.filter(r => !r[2]);

qp2Rows.forEach(r => {
  brandDist[r[1] || '(blank)'] = (brandDist[r[1]||'(blank)'] || 0) + 1;
  regionDist[r[2] || '(blank)'] = (regionDist[r[2]||'(blank)'] || 0) + 1;
});

console.log('\nBrand breakdown:');
Object.entries(brandDist).sort((a, b) => b[1] - a[1]).forEach(([b, n]) => console.log(`  ${String(n).padStart(4)}  ${b}`));

console.log('\nRegion breakdown:');
Object.entries(regionDist).sort((a, b) => b[1] - a[1]).forEach(([r, n]) => console.log(`  ${String(n).padStart(4)}  ${r || '(blank)'}`));

console.log(`\nRows with blank brand: ${blankBrand.length}`);
console.log(`Rows with blank region: ${blankRegion.length}`);

if (blankBrand.length > 0) {
  console.log('\nBlank brand rows (first 10):');
  blankBrand.slice(0, 10).forEach(r => console.log(`  [${r[0]}] "${r[4]}" by ${r[5]}`));
}
if (blankRegion.length > 0) {
  console.log('\nBlank region rows (first 20):');
  blankRegion.slice(0, 20).forEach(r => console.log(`  [${r[0]}] ${r[1]} | "${r[4]}" by ${r[5]}`));
}

// Compare against pulled data
if (!existsSync(TMP)) {
  console.log('\ntmp-ft-browser-pull-qp2.json not found — cannot compare.');
  process.exit(0);
}

const pulled = JSON.parse(readFileSync(TMP, 'utf8'));
const { activities, segments, users, changelogs } = pulled;

const segMap = {};
(segments || []).forEach(s => { segMap[s.SegmentId] = s.SegmentName; });

const userMap = {};
(users || []).forEach(u => { userMap[u.UserId] = (u.Name || u.Username || '').trim(); });
userMap[71] = 'FT Team';

const YEAR = String(new Date().getFullYear());
const ytdActs = (activities || []).filter(a => {
  const d = a.SignedDate || a.ExecutionDateTime || '';
  return d.slice(0, 4) === YEAR && a.TriggerTypeId === 2;
});

const creatorByActId = {};
for (const a of ytdActs) {
  const entries = changelogs?.[String(a.ActivityId)];
  if (!entries) continue;
  const createEntry = [...entries].reverse().find(e => e.operationType === 'create');
  const entry = createEntry || entries[entries.length - 1];
  if (entry?.userId) creatorByActId[a.ActivityId] = userMap[entry.userId] || `uid:${entry.userId}`;
}

const teamActs = ytdActs.filter(a => {
  const creator = creatorByActId[a.ActivityId] || userMap[a.SignedBy];
  return creator && TBP_TEAM.has(creator);
});

const seen = new Set();
const deduped = [];
for (const a of teamActs.sort((a, b) => (b.SignedDate||b.ExecutionDateTime||'').localeCompare(a.SignedDate||a.ExecutionDateTime||''))) {
  const key = a.SegmentId || `act_${a.ActivityId}`;
  if (!seen.has(key)) { seen.add(key); deduped.push(a); }
}

const pulledSegNames = new Set(deduped.map(a => segMap[a.SegmentId] || a.ActivityName || '').filter(Boolean));
const missing = [...pulledSegNames].filter(n => !qp2SegNames.has(n));
const extra   = [...qp2SegNames].filter(n => !pulledSegNames.has(n));

console.log(`\nExpected from pull: ${pulledSegNames.size}`);
console.log(`Missing from log: ${missing.length}`);
missing.forEach(n => console.log(`  - ${n}`));
console.log(`Extra in log: ${extra.length}`);

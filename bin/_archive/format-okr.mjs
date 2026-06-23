import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = JSON.parse(readFileSync(path.join(__dirname, 'google-oauth-client.local.json'), 'utf8')).installed;
const TOKEN  = JSON.parse(readFileSync(path.join(__dirname, 'google-oauth-token.local.json'), 'utf8'));
const SID = '175Qj_q9I-nG2E3zbfDW5_zcML9N6DwdebE0iIreZp2c';

async function getToken() {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT.client_id,
      client_secret: CLIENT.client_secret,
      refresh_token: TOKEN.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  const d = await r.json();
  return d.access_token;
}

// Colors (RGB 0-1 scale)
const COL = {
  HEADER_BG:  { red: 0, green: 0, blue: 0 },          // black (matches original)
  HEADER_FG:  { red: 1, green: 1, blue: 1 },          // white
  OPS:        { red: 0.8117647,  green: 0.8862745,  blue: 1.0       }, // #CFE2FF light blue
  TEAM:       { red: 0.81960785, green: 0.90588236, blue: 0.8666667 }, // #D1E7DD sage green
  AUTO:       { red: 1.0,        green: 0.9529412,  blue: 0.8039216 }, // #FFF3CD light yellow
  BIZ:        { red: 1.0,        green: 0.8666667,  blue: 0.8352941 }, // #FFDDD5 light peach
};

// repeatCell request helper — applies background color to a row range, cols B-I (indices 1-8)
function bgRequest(sheetId, startRow, endRow, color) {
  return {
    repeatCell: {
      range: { sheetId, startRowIndex: startRow, endRowIndex: endRow, startColumnIndex: 1, endColumnIndex: 9 },
      cell: { userEnteredFormat: { backgroundColor: color } },
      fields: 'userEnteredFormat.backgroundColor',
    }
  };
}

// Bold B+C for the first row of a KR block (row index = 0-based)
function boldBCRequest(sheetId, rowIndex, bold) {
  return {
    repeatCell: {
      range: { sheetId, startRowIndex: rowIndex, endRowIndex: rowIndex + 1, startColumnIndex: 1, endColumnIndex: 3 },
      cell: { userEnteredFormat: { textFormat: { bold } } },
      fields: 'userEnteredFormat.textFormat.bold',
    }
  };
}

// Header row: dark bg + white bold text on cols B-I
function headerRequest(sheetId) {
  return {
    repeatCell: {
      range: { sheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 1, endColumnIndex: 9 },
      cell: {
        userEnteredFormat: {
          backgroundColor: COL.HEADER_BG,
          textFormat: { bold: true, foregroundColor: COL.HEADER_FG },
        }
      },
      fields: 'userEnteredFormat(backgroundColor,textFormat(bold,foregroundColor))',
    }
  };
}

// Build all formatting requests for one sheet tab
// sections = [{ color, startRow, krCount }]   startRow is 1-based sheet row
function buildRequests(sheetId, sections) {
  const reqs = [headerRequest(sheetId)];

  for (const { color, startRow, krCount } of sections) {
    const startIdx = startRow - 1;          // convert to 0-based
    const endIdx   = startIdx + krCount * 5;

    // Background for entire section
    reqs.push(bgRequest(sheetId, startIdx, endIdx, color));

    // Bold B+C on first row of each KR block
    for (let k = 0; k < krCount; k++) {
      const firstRowIdx = startIdx + k * 5;
      reqs.push(boldBCRequest(sheetId, firstRowIdx, true));
      // Clear bold on the 4 level rows below
      for (let lvl = 1; lvl < 5; lvl++) {
        reqs.push(boldBCRequest(sheetId, firstRowIdx + lvl, false));
      }
    }
  }

  return reqs;
}

// ── Tab definitions (sheetId + sections) ───────────────────────────────────────
const TABS = [
  {
    name: 'Q1_2026', sheetId: 167928458,
    sections: [
      { color: COL.OPS,  startRow:  3, krCount: 3 },  // rows 3-17
      { color: COL.TEAM, startRow: 18, krCount: 3 },  // rows 18-32
      { color: COL.AUTO, startRow: 33, krCount: 2 },  // rows 33-42
      { color: COL.BIZ,  startRow: 43, krCount: 2 },  // rows 43-52
    ],
  },
  {
    name: 'Q2_2026', sheetId: 687470882,
    sections: [
      { color: COL.OPS,  startRow:  3, krCount: 2 },  // rows 3-12
      { color: COL.TEAM, startRow: 13, krCount: 2 },  // rows 13-22
      { color: COL.AUTO, startRow: 23, krCount: 2 },  // rows 23-32
      { color: COL.BIZ,  startRow: 33, krCount: 2 },  // rows 33-42
    ],
  },
  {
    name: 'Q3_2026', sheetId: 1403719945,
    sections: [
      { color: COL.OPS,  startRow:  3, krCount: 2 },  // rows 3-12
      { color: COL.TEAM, startRow: 13, krCount: 2 },  // rows 13-22
      { color: COL.AUTO, startRow: 23, krCount: 2 },  // rows 23-32
      { color: COL.BIZ,  startRow: 33, krCount: 1 },  // rows 33-37
    ],
  },
  {
    name: 'Q4_2026', sheetId: 1181545808,
    sections: [
      { color: COL.OPS,  startRow:  3, krCount: 2 },  // rows 3-12
      { color: COL.TEAM, startRow: 13, krCount: 2 },  // rows 13-22
      { color: COL.AUTO, startRow: 23, krCount: 2 },  // rows 23-32
      { color: COL.BIZ,  startRow: 33, krCount: 2 },  // rows 33-42
    ],
  },
];

async function applyFormatting(at) {
  const requests = [];
  for (const tab of TABS) {
    requests.push(...buildRequests(tab.sheetId, tab.sections));
  }

  console.log(`Sending ${requests.length} formatting requests...`);

  const body = { requests };
  const r = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SID}:batchUpdate`,
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${at}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
  const d = await r.json();
  if (d.error) throw new Error(JSON.stringify(d.error));
  console.log(`✅ Formatting applied. Replies: ${d.replies?.length}`);
}

const at = await getToken();
await applyFormatting(at);
console.log('\nAll tabs formatted.');

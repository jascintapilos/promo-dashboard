/**
 * List Google Sheets in the weekly report parent folder.
 * Check current week's sheet for CRM data.
 */
import { getGoogleAuth, loadGoogleapis } from '../src/google-auth.js';
import { getSheetsClient } from '../src/sheets-client.js';

const FOLDER_ID = '1SvTyOPxDCVnPjmYU-XjMlOupQ2M1T_8P';

const { client: auth } = await getGoogleAuth();
const { google } = await loadGoogleapis();
const drive = google.drive({ version: 'v3', auth });
const { sheets } = await getSheetsClient();

// List all sheets in the folder (and subfolders)
async function listSheetsInFolder(folderId, depth = 0) {
  const prefix = '  '.repeat(depth);
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id,name,mimeType,createdTime)',
    pageSize: 50,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  const items = res.data.files || [];
  items.sort((a, b) => (a.name > b.name ? 1 : -1));
  for (const f of items) {
    const date = f.createdTime?.slice(0, 10) || '';
    if (f.mimeType === 'application/vnd.google-apps.folder') {
      console.log(`${prefix}📁 ${f.name}  (${date})`);
      await listSheetsInFolder(f.id, depth + 1);
    } else if (f.mimeType === 'application/vnd.google-apps.spreadsheet') {
      console.log(`${prefix}📊 ${f.name}  id=${f.id}  (${date})`);
    }
  }
}

console.log('=== Weekly Report Drive Folder ===');
await listSheetsInFolder(FOLDER_ID);

// Find the most recent sheet (likely current week)
console.log('\n=== Checking last 3 sheets for tabs ===');
const rootRes = await drive.files.list({
  q: `'${FOLDER_ID}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
  fields: 'files(id,name)',
  supportsAllDrives: true,
  includeItemsFromAllDrives: true,
});
const folders = (rootRes.data.files || []).sort((a, b) => (a.name > b.name ? -1 : 1));

const allSheets = [];
for (const folder of folders.slice(0, 3)) {
  const fRes = await drive.files.list({
    q: `'${folder.id}' in parents and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`,
    fields: 'files(id,name,createdTime)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  for (const f of fRes.data.files || []) {
    allSheets.push({ ...f, folderName: folder.name });
  }
}
allSheets.sort((a, b) => (a.createdTime > b.createdTime ? -1 : 1));

for (const s of allSheets.slice(0, 3)) {
  console.log(`\n📊 ${s.name} (folder: ${s.folderName})`);
  try {
    const meta = await sheets.spreadsheets.get({
      spreadsheetId: s.id, fields: 'sheets.properties',
    });
    for (const sh of meta.data.sheets || []) {
      const title = sh.properties.title;
      const lastRow = sh.properties.gridProperties?.rowCount || '?';
      console.log(`  tab: "${title}"  (${lastRow} rows)`);
    }
    // Check CRM tab
    const crmSheet = meta.data.sheets?.find(sh =>
      sh.properties.title.toLowerCase().includes('crm'));
    if (crmSheet) {
      const crmData = await sheets.spreadsheets.values.get({
        spreadsheetId: s.id,
        range: `'${crmSheet.properties.title}'!A1:F5`,
        valueRenderOption: 'FORMATTED_VALUE',
      });
      console.log(`  CRM sample rows: ${JSON.stringify(crmData.data.values?.slice(0, 4))}`);
    }
  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
  }
}

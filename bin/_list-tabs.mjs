import { getSheetsClient, getSpreadsheetId } from '../src/sheets-client.js';
const sheets = await getSheetsClient();
const id = getSpreadsheetId();
const meta = await sheets.spreadsheets.get({ spreadsheetId: id, fields: 'sheets.properties.title' });
console.log(JSON.stringify(meta.data.sheets.map(s => s.properties.title), null, 2));

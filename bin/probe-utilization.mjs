import { getSheetsClient } from '../src/sheets-client.js';
const PEOPLE = {
  Elyssa:   '1ml0O0kTaHfk9JdWuc9zGbhr1KKEEIeRQFWM-dPzBkos',
  Wen:      '19EgP1nS3FRsOkTWjX6-LvcP0in3ZNWg17M7mQhd4YLU',
  Gaby:     '1s9Pw3nretdNlsRoMRnBC5SLUa_wpxIQoQuGjsNGxKFU',
  Bangun:   '1EPtu6NUWj-rKBGdHQy8CafzpNbFP1Zca5z6n5G2EoQk',
  Jascinta: '1z5IUbq4XwvihtyHH2jXU9lngh9FLvmvy-fAYbAcig00',
  Alysa:    '1zbNGLJE4i0uGybLCTAalo5Ze0gLRe-iZmLUIEnySh8g',
  Michelle: '1tBdE9qJO77_VckO-FU2DYIF-jaHnMig6H8KWgOyImjw',
};
const MONTH_KEYS = ['2026-01','2026-02','2026-03','2026-04','2026-05'];
const MONTH_MATCH = {
  '2026-01': /jan(uary)?(\s*2026)?$/i,
  '2026-02': /feb(ruary)?(\s*2026)?$/i,
  '2026-03': /mar(ch)?(\s*2026)?$/i,
  '2026-04': /apr(il)?(\s*2026)?$/i,
  '2026-05': /may(\s*2026)?$/i,
};
const { sheets } = await getSheetsClient();
const results = {};
for (const [name, id] of Object.entries(PEOPLE)) {
  results[name] = {};
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: id, fields: 'sheets.properties' });
    const tabs = meta.data.sheets.map(s => s.properties.title);
    for (const month of MONTH_KEYS) {
      const tab = tabs.find(t => MONTH_MATCH[month].test(t.trim()));
      if (!tab) { results[name][month] = 0; continue; }
      const r = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: `'${tab}'!D2:D500` });
      const vals = (r.data.values || []).map(row => Number(row[0]) || 0);
      results[name][month] = +vals.reduce((a,b) => a+b, 0).toFixed(2);
      await new Promise(r => setTimeout(r, 250));
    }
  } catch (e) { results[name].err = e.message.substring(0, 60); }
  process.stdout.write(`${name.padEnd(10)} ${MONTH_KEYS.map(m => String(results[name][m]||0).padStart(7)).join(' ')}  ytd=${MONTH_KEYS.reduce((s,m)=>s+(results[name][m]||0),0).toFixed(1)}\n`);
}
console.log('\nMonths header:', MONTH_KEYS.join(' '));
console.log('\nJSON:', JSON.stringify(results, null, 2));

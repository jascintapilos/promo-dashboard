#!/usr/bin/env node
import { getGoogleAuth } from '../src/google-auth.js';
const SS_ID = '16iI85GrAqldbBcGhpvAwJT3_3JJDqLemLaGhjPXMlQk';
const { client } = await getGoogleAuth();
const tok = (await client.getAccessToken()).token;
const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SS_ID}/values/Task_Master!A1:Z5`, {
  headers: { Authorization: 'Bearer ' + tok },
});
const data = await r.json();
console.log('Headers (row 1):', data.values[0]);
console.log('\nSample row 2:', data.values[1] || '(empty)');
console.log('Sample row 3:', data.values[2] || '(empty)');
// Count: rows + which columns have what
const r2 = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SS_ID}/values/Task_Master!A1:Z`, {
  headers: { Authorization: 'Bearer ' + tok },
});
const all = await r2.json();
const headers = all.values[0];
const rows = all.values.slice(1);
console.log('\nTotal rows:', rows.length);
headers.forEach((h, i) => {
  const nonEmpty = rows.filter(r => r[i] != null && r[i] !== '').length;
  console.log('  col ' + (i+1) + ' "' + h + '": ' + nonEmpty + '/' + rows.length + ' filled');
});

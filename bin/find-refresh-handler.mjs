import { getGoogleAuth } from '../src/google-auth.js';
const SCRIPT_ID = '1G8PrjOQ45yafM4lo3dL1AG8HKFSZ8tSlX7ei9EPZgw6bacjHk5CPtTW_';
const { client } = await getGoogleAuth();
const tok = (await client.getAccessToken()).token;
const res = await fetch(`https://script.googleapis.com/v1/projects/${SCRIPT_ID}/content`, {
  headers: { Authorization: 'Bearer ' + tok },
});
const proj = await res.json();
const dash = proj.files.find(f => f.name === 'Dashboard').source;

// Find all occurrences of "Refresh" with surrounding context
let idx = 0, count = 0;
while ((idx = dash.indexOf('Refresh', idx)) !== -1 && count < 8) {
  console.log(`\n--- match ${++count} at ${idx} ---`);
  console.log(dash.substring(Math.max(0, idx - 150), idx + 250));
  idx += 7;
}

// Find functions that include "Task_Master" or "serverGetTasks" calls
const fns = dash.match(/function\s+\w+[\s\S]*?serverGet/g) || [];
console.log('\n\nFunctions calling serverGet*:', fns.slice(0, 3));

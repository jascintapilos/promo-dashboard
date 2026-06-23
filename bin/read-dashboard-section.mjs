import { getGoogleAuth } from '../src/google-auth.js';
const SCRIPT_ID = '1G8PrjOQ45yafM4lo3dL1AG8HKFSZ8tSlX7ei9EPZgw6bacjHk5CPtTW_';
const { client } = await getGoogleAuth();
const tok = (await client.getAccessToken()).token;
const res = await fetch(`https://script.googleapis.com/v1/projects/${SCRIPT_ID}/content`, {
  headers: { Authorization: 'Bearer ' + tok },
});
const proj = await res.json();
const dash = proj.files.find(f => f.name === 'Dashboard').source;

// Find showTaskDetail definition
const idx = dash.indexOf('function showTaskDetail');
if (idx >= 0) {
  console.log('=== showTaskDetail ===');
  // Find end of function (balanced braces)
  let depth = 0, end = idx, started = false;
  for (let i = idx; i < dash.length; i++) {
    if (dash[i] === '{') { depth++; started = true; }
    else if (dash[i] === '}') {
      depth--;
      if (started && depth === 0) { end = i + 1; break; }
    }
  }
  console.log(dash.substring(idx, end));
}

// Print last-sync indicator references
const lastSyncIdx = dash.indexOf("'last-sync'");
console.log('\n=== last-sync references ===');
let i = 0;
while ((i = dash.indexOf("'last-sync'", i)) !== -1) {
  console.log('At', i, ':', dash.substring(Math.max(0, i-100), i+150));
  i += 11;
}

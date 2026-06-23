import { getGoogleAuth } from '../src/google-auth.js';
const SCRIPT_ID = '1G8PrjOQ45yafM4lo3dL1AG8HKFSZ8tSlX7ei9EPZgw6bacjHk5CPtTW_';
const { client } = await getGoogleAuth();
const tok = (await client.getAccessToken()).token;
const res = await fetch(`https://script.googleapis.com/v1/projects/${SCRIPT_ID}/content`, {
  headers: { Authorization: 'Bearer ' + tok },
});
const proj = await res.json();
const dash = proj.files.find(f => f.name === 'Dashboard').source;

// Find renderReports
['renderReports', 'function nav', 'function kpi', 'function taskTable', 'function loadKPIs'].forEach(needle => {
  const idx = dash.indexOf(needle);
  if (idx < 0) { console.log(`\n=== ${needle} : NOT FOUND ===`); return; }
  let depth = 0, end = idx;
  // For functions, balance braces
  for (let i = idx; i < dash.length; i++) {
    if (dash[i] === '{') depth++;
    else if (dash[i] === '}') { depth--; if (depth === 0 && i > idx + 20) { end = i + 1; break; } }
  }
  console.log(`\n=== ${needle} ===`);
  console.log(dash.substring(idx, Math.min(end, idx + 1500)));
});

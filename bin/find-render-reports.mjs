import { getGoogleAuth } from '../src/google-auth.js';
const SCRIPT_ID = '1G8PrjOQ45yafM4lo3dL1AG8HKFSZ8tSlX7ei9EPZgw6bacjHk5CPtTW_';
const { client } = await getGoogleAuth();
const tok = (await client.getAccessToken()).token;
const r = await fetch(`https://script.googleapis.com/v1/projects/${SCRIPT_ID}/content`, { headers: { Authorization: 'Bearer ' + tok } });
const proj = await r.json();
const dash = proj.files.find(f => f.name === 'Dashboard').source;

// Find all renderReports occurrences
const idx = dash.indexOf('function renderReports');
console.log('renderReports at index:', idx);
if (idx >= 0) {
  let depth = 0, end = idx;
  for (let i = idx; i < dash.length; i++) {
    if (dash[i] === '{') depth++;
    else if (dash[i] === '}') { depth--; if (depth === 0 && i > idx + 20) { end = i + 1; break; } }
  }
  console.log(dash.substring(idx, end));
}

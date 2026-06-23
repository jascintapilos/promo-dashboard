import { getGoogleAuth } from '../src/google-auth.js';
const SCRIPT_ID = '1G8PrjOQ45yafM4lo3dL1AG8HKFSZ8tSlX7ei9EPZgw6bacjHk5CPtTW_';
const { client } = await getGoogleAuth();
const tok = (await client.getAccessToken()).token;
const r = await fetch(`https://script.googleapis.com/v1/projects/${SCRIPT_ID}/content`, { headers: { Authorization: 'Bearer ' + tok } });
const proj = await r.json();
const dash = proj.files.find(f => f.name === 'Dashboard').source;

// Show all kpi() lines from renderOverview
const overIdx = dash.indexOf('function renderOverview');
const slice = dash.substring(overIdx, overIdx + 2500);
console.log('=== KPI lines ===');
slice.split('\n').forEach(line => { if (line.includes('kpi(')) console.log(' ', line.trim()); });

// Find taskRow function to see what columns it renders
const trIdx = dash.indexOf('function taskRow(t, mini)');
if (trIdx >= 0) {
  let depth = 0, end = trIdx;
  for (let i = trIdx; i < dash.length; i++) {
    if (dash[i] === '{') depth++;
    else if (dash[i] === '}') { depth--; if (depth === 0 && i > trIdx + 20) { end = i + 1; break; } }
  }
  console.log('\n=== taskRow function ===');
  console.log(dash.substring(trIdx, end));
}

// taskTable headers
const ttIdx = dash.indexOf('function taskTable(tasks, mini)');
if (ttIdx >= 0) {
  let depth = 0, end = ttIdx;
  for (let i = ttIdx; i < dash.length; i++) {
    if (dash[i] === '{') depth++;
    else if (dash[i] === '}') { depth--; if (depth === 0 && i > ttIdx + 20) { end = i + 1; break; } }
  }
  console.log('\n=== taskTable function ===');
  console.log(dash.substring(ttIdx, end));
}

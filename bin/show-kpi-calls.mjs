import { getGoogleAuth } from '../src/google-auth.js';
const SCRIPT_ID = '1G8PrjOQ45yafM4lo3dL1AG8HKFSZ8tSlX7ei9EPZgw6bacjHk5CPtTW_';
const { client } = await getGoogleAuth();
const tok = (await client.getAccessToken()).token;
const r = await fetch(`https://script.googleapis.com/v1/projects/${SCRIPT_ID}/content`, { headers: { Authorization: 'Bearer ' + tok } });
const proj = await r.json();
const dash = proj.files.find(f => f.name === 'Dashboard').source;

// Find all kpi(...) calls in renderOverview area
const overIdx = dash.indexOf('function renderOverview');
const slice = dash.substring(overIdx, overIdx + 2500);

console.log('=== renderOverview kpi calls (raw) ===');
slice.split('\n').forEach((line, i) => {
  if (line.includes('kpi(')) console.log('L' + i + ':', JSON.stringify(line));
});

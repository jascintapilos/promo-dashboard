import { getGoogleAuth } from '../src/google-auth.js';
const SCRIPT_ID = '1G8PrjOQ45yafM4lo3dL1AG8HKFSZ8tSlX7ei9EPZgw6bacjHk5CPtTW_';
const { client } = await getGoogleAuth();
const tok = (await client.getAccessToken()).token;
const r = await fetch(`https://script.googleapis.com/v1/projects/${SCRIPT_ID}/content`, { headers: { Authorization: 'Bearer ' + tok } });
const proj = await r.json();
const dash = proj.files.find(f => f.name === 'Dashboard').source;

console.log('Has ORCH_V2_INJECT_BEGIN:', dash.includes('ORCH_V2_INJECT_BEGIN'));
console.log('Has navWithFilter:', dash.includes('window.navWithFilter'));
console.log('Has openDatePop:', dash.includes('openDatePop'));
console.log('Has id="date-pop":', dash.includes('id="date-pop"'));
console.log('Has injectBOSection:', dash.includes('injectBOSection'));

// Find ORCH_V2 areas
let idx = 0, n = 0;
while ((idx = dash.indexOf('ORCH_V2_INJECT', idx)) !== -1 && n < 6) {
  console.log('At', idx, ':', dash.substring(Math.max(0, idx-50), idx+60).replace(/\n/g, '\n'));
  idx += 14; n++;
}

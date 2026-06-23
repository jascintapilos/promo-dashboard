import { getGoogleAuth } from '../src/google-auth.js';
const SCRIPT_ID = '1G8PrjOQ45yafM4lo3dL1AG8HKFSZ8tSlX7ei9EPZgw6bacjHk5CPtTW_';
const { client } = await getGoogleAuth();
const tok = (await client.getAccessToken()).token;
const r = await fetch(`https://script.googleapis.com/v1/projects/${SCRIPT_ID}/content`, { headers: { Authorization: 'Bearer ' + tok } });
const proj = await r.json();
const dash = proj.files.find(f => f.name === 'Dashboard').source;

const startIdx = dash.indexOf('=== ORCH_V2_INJECT_BEGIN ===', 182000);
const endIdx   = dash.indexOf('=== ORCH_V2_INJECT_END ===', startIdx);
const code = dash.substring(startIdx + '=== ORCH_V2_INJECT_BEGIN ==='.length, endIdx);
console.log('Code length:', code.length);
try {
  new Function(code);
  console.log('✓ JS parses OK');
} catch (e) {
  console.log('✗ Syntax error:', e.message);
}

import { getGoogleAuth } from '../src/google-auth.js';
const SCRIPT_ID = '1G8PrjOQ45yafM4lo3dL1AG8HKFSZ8tSlX7ei9EPZgw6bacjHk5CPtTW_';
const { client } = await getGoogleAuth();
const tok = (await client.getAccessToken()).token;
const r = await fetch(`https://script.googleapis.com/v1/projects/${SCRIPT_ID}/content`, { headers: { Authorization: 'Bearer ' + tok } });
const proj = await r.json();
const dash = proj.files.find(f => f.name === 'Dashboard').source;

// Extract the ORCH_V2 inject block and try to parse it
const m = dash.match(/\/\* === ORCH_V2_INJECT_BEGIN === \*\/[\s\S]*?\/\* === ORCH_V2_INJECT_END === \*\//);
if (!m) { console.log('No ORCH_V2 block found'); process.exit(0); }

// The block has both CSS and JS. Extract just the script content.
const scriptMatch = m[0].match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) { console.log('No <script> in block'); process.exit(0); }

const code = scriptMatch[1];
console.log('Script length:', code.length, 'bytes');
console.log('First 500:', code.slice(0, 500));
console.log('\n--- Last 800 ---');
console.log(code.slice(-800));

// Try parsing as JS (Node will throw on syntax errors)
try {
  new Function(code);
  console.log('\n✓ Syntax OK (parses as function body)');
} catch (e) {
  console.log('\n✗ Syntax error:', e.message);
}

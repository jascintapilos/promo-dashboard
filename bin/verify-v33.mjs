import { getGoogleAuth } from '../src/google-auth.js';
const SCRIPT_ID = '1G8PrjOQ45yafM4lo3dL1AG8HKFSZ8tSlX7ei9EPZgw6bacjHk5CPtTW_';
const { client } = await getGoogleAuth();
const tok = (await client.getAccessToken()).token;
const r = await fetch(`https://script.googleapis.com/v1/projects/${SCRIPT_ID}/content`, { headers: { Authorization: 'Bearer ' + tok } });
const proj = await r.json();
const dash = proj.files.find(f => f.name === 'Dashboard').source;

// Check for bare markers (NOT preceded by // or /*)
const bareScript = (dash.match(/^=== [A-Z_]+ ===/gm) || []).length;
console.log('Bare === markers anywhere:', bareScript);

// Extract scripts
const scripts = [...dash.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
console.log('Total <script> blocks:', scripts.length);

let errCount = 0;
scripts.forEach((s, i) => {
  try { new Function(s); }
  catch (e) {
    errCount++;
    console.log(`  Script ${i}: SYNTAX ERROR — ${e.message}`);
    // Print first 200 chars
    console.log(`    Preview: ${s.slice(0, 200).replace(/\n/g, ' ')}`);
  }
});
if (!errCount) console.log('All scripts parse OK ✓');

// V32 marker presence
console.log('V32 marker code present:', /dataset\.v32marked/.test(dash));

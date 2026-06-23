#!/usr/bin/env node
/**
 * Fix the kpi() helper so onclick actually INVOKES the arrow function.
 * Original: onclick="() => nav('tasks')"  — just creates a func, never calls it.
 * Fixed:    onclick="(() => nav('tasks'))()" — calls it.
 *
 * This is why none of the KPI cards (including the original Total Tasks /
 * Pending Approval) actually navigated when clicked.
 */
import { getGoogleAuth } from '../src/google-auth.js';
const SCRIPT_ID = '1G8PrjOQ45yafM4lo3dL1AG8HKFSZ8tSlX7ei9EPZgw6bacjHk5CPtTW_';
const { client } = await getGoogleAuth();
const tok = (await client.getAccessToken()).token;

async function api(method, url, body) {
  const r = await fetch(`https://script.googleapis.com/v1${url}`, {
    method, headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${method} ${url}: ${r.status} ${await r.text()}`);
  return r.json();
}

const proj = await api('GET', `/projects/${SCRIPT_ID}/content`);
const dashIdx = proj.files.findIndex(f => f.name === 'Dashboard');
let dash = proj.files[dashIdx].source;

// Patch kpi() to invoke the arrow function
const orig = "const clickAttr = clickFn ? `onclick=\"${clickFn.toString().replace(/\"/g,'&quot;')}\" style=\"cursor:pointer\"` : '';";
const fixed = "const clickAttr = clickFn ? `onclick=\"(${clickFn.toString().replace(/\"/g,'&quot;')})()\" style=\"cursor:pointer\"` : '';";

if (!dash.includes(orig)) {
  console.error('kpi() pattern not found verbatim. Trying flexible match…');
  // Flexible: find the kpi function and patch its clickAttr line
  const re = /const clickAttr = clickFn \? `onclick="\$\{clickFn\.toString\(\)\.replace\(\/"\/g,'&quot;'\)\}" style="cursor:pointer"` : '';/;
  if (re.test(dash)) {
    dash = dash.replace(re, "const clickAttr = clickFn ? `onclick=\"(${clickFn.toString().replace(/\"/g,'&quot;')})()\" style=\"cursor:pointer\"` : '';");
    console.log('Patched via regex');
  } else {
    console.error('Flexible match also failed — printing actual line:');
    const m = dash.match(/const clickAttr =[^;]+;/);
    console.error('Actual:', m ? m[0] : '(not found)');
    process.exit(1);
  }
} else {
  dash = dash.replace(orig, fixed);
  console.log('Patched via literal');
}

proj.files[dashIdx].source = dash;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('✓ Pushed');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'Fix kpi() onclick: wrap arrow fn so it actually invokes — ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);
console.log(`\nDeploy: open editor → Deploy ▼ → Manage deployments → pencil → pick Version ${v.versionNumber} → Deploy`);

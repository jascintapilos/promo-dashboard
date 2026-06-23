#!/usr/bin/env node
/**
 * Probe FastTrack CRM instance to discover the segments API endpoint
 * and understand the response shape.
 *
 * Usage:
 *   node bin/probe-ft-campaigns.mjs --instance ws1
 *   node bin/probe-ft-campaigns.mjs --instance qpro1
 *   node bin/probe-ft-campaigns.mjs --instance qp2
 *
 * Requires ft-session-<instance>.local.json (run capture-ft-session.mjs first).
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from './_args.js';

const { flags } = parseArgs(process.argv.slice(2));
const INSTANCE = flags.instance || 'ws1';

const SESSION_FILE = path.resolve(`ft-session-${INSTANCE}.local.json`);
if (!existsSync(SESSION_FILE)) {
  console.error(`No session file for "${INSTANCE}". Run: node bin/capture-ft-session.mjs --instance ${INSTANCE}`);
  process.exit(1);
}

const session = JSON.parse(readFileSync(SESSION_FILE, 'utf8'));
const BASE    = session.loginUrl.replace(/\/$/, '');
// Prefer localStorage jwttoken; fall back to stored token field
const jwt = (session.localStorage || {}).jwttoken || session.token;
const token = jwt ? jwt.replace(/^"(.*)"$/, '$1') : ''; // strip JSON quotes if any

console.log(`\nFastTrack CRM probe — ${session.label} (${BASE})`);
console.log(`JWT present: ${token ? token.slice(0,30) + '...' : 'NO'}, captured: ${session.capturedAt}\n`);

// FT uses custom `authtoken` header = value of portaltoken cookie
const portaltoken = (session.cookies || [])
  .find(c => c.name === 'portaltoken' && c.domain && c.domain.includes('ft-crm.com'))
  ?.value || '';

console.log(`portaltoken: ${portaltoken ? portaltoken.slice(0,20) : 'NOT FOUND'}\n`);

function makeHeaders() {
  const h = {
    'Content-Type': 'application/json',
    'Accept':       'application/json',
  };
  if (portaltoken) h['authtoken'] = portaltoken;
  return h;
}

async function tryGet(path, desc) {
  const url = `${BASE}${path}`;
  try {
    const res = await fetch(url, { headers: makeHeaders() });
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text.slice(0, 200); }
    const preview = JSON.stringify(parsed).slice(0, 300);
    console.log(`[${res.status}] GET ${path}  (${desc})`);
    if (res.ok) console.log(`  → ${preview}`);
    return { status: res.status, ok: res.ok, data: parsed };
  } catch (e) {
    console.log(`[ERR] GET ${path}  (${desc}) — ${e.message}`);
    return { status: 0, ok: false };
  }
}

// ── Print stored localStorage keys ───────────────────────────────────────────
console.log('=== Stored localStorage keys ===');
for (const [k, v] of Object.entries(session.localStorage || {})) {
  console.log(`  ${k}: ${String(v).slice(0, 80)}`);
}
console.log();

// ── Probe common FT API paths ─────────────────────────────────────────────────
console.log('=== API probe ===\n');

// Confirmed paths from network intercept
const PROBES = [
  // Auth
  ['/crm-api/Authentication/AdminPreferences', 'admin prefs'],
  ['/crm-api/Authentication/AdminUsers',       'admin users — who created segments'],
  // Segments — confirmed paths
  ['/crm-api/ActivityManager/Segments/ByCategory/1',  'segments category 1'],
  ['/crm-api/ActivityManager/Segments/ByCategory/2',  'segments category 2'],
  ['/crm-api/ActivityManager/Segments/Fields',         'segment fields'],
  // Activities
  ['/crm-api/ActivityManager/Activities/GetActivities', 'activities (POST-only, skip)'],
  // Version
  ['/crm-api/version', 'version'],
];

for (const [p, desc] of PROBES) {
  const r = await tryGet(p, desc);
  if (r.ok) {
    console.log('  ^^^ SUCCESS ^^^');
    // Print full response for successful hits
    console.log('  Full:', JSON.stringify(r.data, null, 2).slice(0, 800));
  }
  console.log();
}

console.log('=== Probe complete ===');
console.log(`Check the successful endpoints above, then build pull-ft-campaigns.mjs.`);

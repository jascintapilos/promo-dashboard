#!/usr/bin/env node
/**
 * V67 — Add aaa_authorizeCalendar helper for one-click scope grant
 *
 *  When you add a new OAuth scope to the manifest (V65 added
 *  calendar.readonly), Apps Script invalidates the existing authorization
 *  for that script. The deploying user has to re-consent before the web
 *  app can use the new API.
 *
 *  This V67 adds a tiny helper `aaa_authorizeCalendar` (named with the
 *  aaa_ prefix so it appears first in the editor's function picker). You
 *  run it once from the editor → Google shows the new permission prompt →
 *  you click Allow → done.
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
const codeIdx = proj.files.findIndex(f => f.name === 'Code');
let code = proj.files[codeIdx].source;

let pass = 0, fail = 0;
function patch(label, oldStr, newStr) {
  if (code.includes(oldStr)) {
    code = code.replace(oldStr, newStr);
    console.log('✓ ' + label);
    pass++;
    return true;
  }
  console.error('✗ WARN: ' + label + ' — anchor not found');
  fail++;
  return false;
}

// Add aaa_authorizeCalendar near the existing aaa_authorizeSlackSync helper
patch('Add aaa_authorizeCalendar helper',
  `// === END AUTH TRIGGER ===`,
  `// === END AUTH TRIGGER ===

// === CALENDAR AUTH TRIGGER ===
// Run this once from the editor: Run menu → Run function: aaa_authorizeCalendar.
// Google will show a permission prompt for Calendar access — click Allow.
// After that, the web app can read your Google Calendar for every viewer.
function aaa_authorizeCalendar() {
  var cal = CalendarApp.getDefaultCalendar();
  var name = cal ? cal.getName() : '(none)';
  var start = new Date(); start.setHours(0,0,0,0);
  var end = new Date(); end.setDate(end.getDate() + 7);
  var events = cal ? cal.getEvents(start, end) : [];
  Logger.log('Connected to: ' + name);
  Logger.log('Events in next 7 days: ' + events.length);
  events.slice(0, 5).forEach(function(e){
    Logger.log('  • ' + e.getStartTime() + ' — ' + e.getTitle());
  });
  return { calendar: name, eventCount: events.length };
}
// === END CALENDAR AUTH TRIGGER ===`);

proj.files[codeIdx].source = code;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('\n✓ Pushed — ' + pass + ' patches applied, ' + fail + ' warnings');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V67 — aaa_authorizeCalendar helper — ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);

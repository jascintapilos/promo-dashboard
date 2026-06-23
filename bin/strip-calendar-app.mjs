#!/usr/bin/env node
/**
 * Strip CalendarApp references from Code.gs on the new project. Calendar
 * widget now reads from the Campaigns sheet (V68 CRUD). Safer + works
 * without calendar.readonly scope.
 */
import { getGoogleAuth } from '../src/google-auth.js';
const SCRIPT_ID = '1Zw5W9LjmYL5hzFpHXdr0G_Q7oFRVCAGqZVTBmQCjiOmZIO2R7M6h8l6O';
const DEPLOYMENT_ID = 'AKfycbz8wysv66dtQuh4JsWiguglcsZUcsmLMd1N3ELdJQ9sYuXhoBsOuu9R6BeTjiIcAMYJPQ';
const OLD_SCRIPT_ID = '1G8PrjOQ45yafM4lo3dL1AG8HKFSZ8tSlX7ei9EPZgw6bacjHk5CPtTW_';
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

// Pull clean V69 from old project
const v69 = await api('GET', `/projects/${OLD_SCRIPT_ID}/content?versionNumber=69`);
const dash = v69.files.find(f => f.name === 'Dashboard').source;
let code = v69.files.find(f => f.name === 'Code').source;

// 1. Strip aaa_authorizeCalendar function (entire block)
code = code.replace(
  /\/\/ === CALENDAR AUTH TRIGGER ===[\s\S]*?\/\/ === END CALENDAR AUTH TRIGGER ===\n/,
  '// Calendar integration removed — campaigns now drive year-planner from sheet.\n'
);

// 2. Replace any function that uses CalendarApp with a sheet-backed version
//    that reads from Campaigns. If serverGetUpcomingEvents exists, neutralize it.
code = code.replace(
  /function serverGetUpcomingEvents\(\) \{[\s\S]*?\n\}\n/,
  `function serverGetUpcomingEvents() {
  // Calendar removed — use serverGetCampaigns instead. This stub returns empty
  // so any legacy caller doesn't break.
  return [];
}
`
);

// 3. Strip Slack-sync helper too (uses UrlFetchApp → would need external_request)
code = code.replace(
  /\/\/ === AUTH TRIGGER ===[\s\S]*?\/\/ === END AUTH TRIGGER ===\n/,
  '// Slack sync removed — UrlFetchApp scope conflicts with Apps Script HTML wrapper.\n'
);

// Also strip the serverSyncSlackTasks function if it exists (callers will short-circuit)
code = code.replace(
  /function serverSyncSlackTasks\(\) \{[\s\S]*?\n\}\n/,
  ''
);

const manifest = JSON.stringify({
  timeZone: 'Asia/Singapore',
  exceptionLogging: 'STACKDRIVER',
  runtimeVersion: 'V8',
  webapp: { executeAs: 'USER_DEPLOYING', access: 'ANYONE' },
  oauthScopes: [
    'https://www.googleapis.com/auth/script.scriptapp',
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/userinfo.email',
  ],
}, null, 2);

await api('PUT', `/projects/${SCRIPT_ID}/content`, {
  files: [
    { name: 'appsscript', type: 'JSON',      source: manifest },
    { name: 'Code',       type: 'SERVER_JS', source: code },
    { name: 'Dashboard',  type: 'HTML',      source: dash },
  ],
});

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V69 clean: Calendar + Slack helpers stripped, safe scopes — ' + new Date().toISOString(),
});
const promo = await api('PUT', `/projects/${SCRIPT_ID}/deployments/${DEPLOYMENT_ID}`, {
  deploymentConfig: { scriptId: SCRIPT_ID, versionNumber: v.versionNumber, manifestFileName: 'appsscript', description: 'V69 clean' },
});
console.log('✓ Promoted V' + promo.deploymentConfig.versionNumber);
console.log('Code.gs length:', code.length, '(was', v69.files.find(f => f.name === 'Code').source.length, ')');

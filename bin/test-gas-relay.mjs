#!/usr/bin/env node
/**
 * Quick smoke test for the GAS scripts.run relay.
 * Calls testUrlFetch() (fetches example.com via Google servers).
 * If it returns "Status: 200" in the log, the relay is authorized.
 *
 * Usage: node bin/test-gas-relay.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const GAS_SCRIPT_ID = '15mYzwwZdX3XIlJVJcs1ts7nbhmb_nLM3b8Ib8OZTGeWw9gB_VgCe3TNw';
const TOKEN_FILE  = path.resolve('google-oauth-token.local.json');
const CLIENT_FILE = path.resolve('google-oauth-client.local.json');

if (!existsSync(TOKEN_FILE) || !existsSync(CLIENT_FILE)) {
  console.error('Missing google-oauth-token.local.json or google-oauth-client.local.json');
  process.exit(1);
}

const token  = JSON.parse(readFileSync(TOKEN_FILE,  'utf8'));
const client = JSON.parse(readFileSync(CLIENT_FILE, 'utf8')).installed;

console.log('Refreshing OAuth token…');
const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    client_id:     client.client_id,
    client_secret: client.client_secret,
    refresh_token: token.refresh_token,
    grant_type:    'refresh_token',
  }).toString(),
});
if (!refreshRes.ok) {
  console.error('Token refresh failed:', await refreshRes.text());
  process.exit(1);
}
const newToken = await refreshRes.json();
const accessToken = newToken.access_token;
const merged = { ...token, ...newToken, refresh_token: newToken.refresh_token || token.refresh_token };
writeFileSync(TOKEN_FILE, JSON.stringify(merged, null, 2));
console.log('Token refreshed. Scopes:', merged.scope);

console.log('\nCalling GAS testUrlFetch() via scripts.run…');
const runRes = await fetch(
  `https://script.googleapis.com/v1/scripts/${GAS_SCRIPT_ID}:run`,
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      function: 'testUrlFetch',
      parameters: [],
      devMode: true,
    }),
  }
);

const raw = await runRes.text();
console.log('HTTP status:', runRes.status);
console.log('Response:');
try {
  const parsed = JSON.parse(raw);
  console.log(JSON.stringify(parsed, null, 2));

  if (parsed.error) {
    const msg = parsed.error?.details?.[0]?.errorMessage || JSON.stringify(parsed.error);
    if (msg.includes('authorization') || msg.includes('Authorization')) {
      console.log('\n❌ GAS runtime NOT authorized for script.external_request.');
      console.log('   The Workspace admin is likely blocking this scope.');
      console.log('   Options:');
      console.log('   1. Ask TBP IT admin to allow script.external_request in Google Workspace admin');
      console.log('   2. Re-create the GAS project under a personal Gmail (not @thebrandingpeople.co)');
    } else {
      console.log('\n⚠️  Error (but NOT a scope issue):', msg);
    }
  } else if (parsed.done) {
    console.log('\n✅ GAS relay is authorized! testUrlFetch completed successfully.');
    console.log('   Next: refresh FT session token, then run pull-ft-campaigns.mjs');
  }
} catch {
  console.log(raw);
}

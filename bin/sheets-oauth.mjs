#!/usr/bin/env node
// One-time OAuth consent for the Sheets API. Reads
// `google-oauth-client.local.json` (the client_secret JSON downloaded from
// GCP → APIs & Services → Credentials → OAuth 2.0 Client ID — Desktop app),
// prints a Google consent URL, spins up a localhost:8765 loopback server,
// captures the auth code Google redirects back with, and writes the
// resulting access+refresh tokens to `google-oauth-token.local.json`.
//
// Subsequent runs of any bot CLI use the saved refresh token to mint fresh
// access tokens transparently — no further user interaction needed unless
// the refresh token is revoked.
//
// Usage:
//   node bin/sheets-oauth.mjs

import { existsSync } from 'node:fs';
import { runOAuthFlow } from '../src/oauth-flow.js';
import { OAUTH_CLIENT_PATH, OAUTH_TOKEN_PATH } from '../src/google-auth.js';

if (!existsSync(OAUTH_CLIENT_PATH)) {
  console.error(`✗ Missing OAuth client secret at:`);
  console.error(`    ${OAUTH_CLIENT_PATH}`);
  console.error('');
  console.error('  Create one in GCP:');
  console.error('    1. https://console.cloud.google.com/apis/credentials');
  console.error('    2. + Create Credentials → OAuth client ID → Application type "Desktop app"');
  console.error('    3. Name it (e.g. "promo-bot-cli"), click Create');
  console.error('    4. Click Download JSON, rename to google-oauth-client.local.json,');
  console.error(`       place in: ${OAUTH_CLIENT_PATH}`);
  console.error('    5. Re-run this script.');
  process.exit(2);
}

if (existsSync(OAUTH_TOKEN_PATH)) {
  console.log(`Note: existing token at ${OAUTH_TOKEN_PATH} will be overwritten.`);
  console.log('');
}

try {
  await runOAuthFlow();
} catch (e) {
  console.error('');
  console.error('✗ OAuth flow failed:');
  console.error(`  ${e.message.split('\n').join('\n  ')}`);
  process.exit(3);
}

console.log('');
console.log('Next: node bin/sheets-test.mjs   (verify auth + read + write round-trip)');

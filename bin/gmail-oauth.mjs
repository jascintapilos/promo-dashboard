#!/usr/bin/env node
// One-time consent for a Gmail READ-ONLY token, used only by the FastTrack OTP
// reader (src/gmail-otp.js). Kept separate from google-oauth-token.local.json so
// the main Sheets/Drive token does not also carry Gmail access.
//
//   node bin/gmail-oauth.mjs
//
// Sign in as the FastTrack login mailbox (jascinta.pilos@thebrandingpeople.co).
// Writes google-oauth-gmail-token.local.json (gitignored).

import { existsSync } from 'node:fs';
import { runOAuthFlow } from '../src/oauth-flow.js';
import { OAUTH_CLIENT_PATH, GMAIL_TOKEN_PATH, GMAIL_SCOPES } from '../src/google-auth.js';

if (!existsSync(OAUTH_CLIENT_PATH)) {
  console.error(`✗ Missing OAuth client secret at ${OAUTH_CLIENT_PATH} — see bin/sheets-oauth.mjs for setup.`);
  process.exitCode = 2;
} else {
  console.log('Requesting Gmail READ-ONLY access (for FastTrack login codes) — nothing else.\n');
  try {
    await runOAuthFlow({ scopes: GMAIL_SCOPES, tokenPath: GMAIL_TOKEN_PATH });
    console.log('\nNext: node bin/capture-ft-session.mjs --instance=ws1   (should now log in unattended)');
  } catch (e) {
    console.error(`\n✗ OAuth flow failed: ${e.message}`);
    process.exitCode = 3;
  }
}

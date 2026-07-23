/**
 * One-time Google OAuth setup for Sheets API access.
 * Run: node bin/sheets-oauth.mjs
 *
 * Prerequisites:
 *   1. Place google-oauth-client.local.json in the project root
 *      (Desktop OAuth client from GCP project promo-bot-496510, client promo-bot-cli)
 *   2. Run this script — it opens a browser for consent and saves the token
 */

import { google } from 'googleapis';
import fs from 'fs';
import http from 'http';
import url from 'url';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const CLIENT_FILE  = path.join(ROOT, 'google-oauth-client.local.json');
const TOKEN_FILE   = path.join(ROOT, 'google-oauth-token.local.json');

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
];

if (!fs.existsSync(CLIENT_FILE)) {
  console.error(`\nMissing: ${CLIENT_FILE}`);
  console.error('Download the OAuth client JSON from:');
  console.error('  GCP Console → promo-bot-496510 → APIs & Services → Credentials → promo-bot-cli → Download JSON');
  console.error('\nIf GCP console blocks the download, use the fetch hook trick (see memory: project_sheets_api_oauth.md)');
  process.exit(1);
}

const { installed } = JSON.parse(fs.readFileSync(CLIENT_FILE, 'utf8'));
const oAuth2Client = new google.auth.OAuth2(
  installed.client_id,
  installed.client_secret,
  'http://localhost:3000/oauth2callback'
);

const authUrl = oAuth2Client.generateAuthUrl({ access_type: 'offline', scope: SCOPES });

// Try to open browser
console.log('\nOpening browser for Google consent...');
try { execSync(`start "" "${authUrl}"`); } catch (_) {
  console.log('Could not auto-open browser. Visit this URL manually:\n');
  console.log(authUrl);
}

// Local redirect server
const server = http.createServer(async (req, res) => {
  const { query } = url.parse(req.url, true);
  if (!query.code) { res.end('No code received.'); return; }

  res.end('<h2>✓ Authorized. You can close this tab.</h2>');
  server.close();

  const { tokens } = await oAuth2Client.getToken(query.code);
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
  console.log(`\n✓ Token saved to ${TOKEN_FILE}`);
  console.log('You can now run: node bin/action-item-tracker-update.mjs');
});

server.listen(3000, () => console.log('Waiting for OAuth callback on http://localhost:3000 ...'));

// One-time interactive OAuth flow for the promo bot. Spins up a localhost
// loopback HTTP server, opens (or prints) the Google consent URL, captures
// the `code` query param Google redirects back with, exchanges it for
// access+refresh tokens, and writes the result to OAUTH_TOKEN_PATH so
// subsequent runs auth transparently.
//
// Called by bin/sheets-oauth.mjs. Safe to re-run — overwrites the cached
// token. Required after rotating the OAuth client or after a refresh token
// is revoked (e.g. user clicks "Remove access" in their Google account).

import http from 'node:http';
import { writeFile } from 'node:fs/promises';
import { URL } from 'node:url';

import {
  loadGoogleapis,
  readClientSecret,
  OAUTH_TOKEN_PATH,
  SCOPES,
} from './google-auth.js';

const LOOPBACK_PORT = 8765;
const LOOPBACK_URI  = `http://127.0.0.1:${LOOPBACK_PORT}/`;

// Run the interactive flow. Returns the path to the saved token file.
export async function runOAuthFlow({ openUrl } = {}) {
  const cfg = await readClientSecret();
  const { google } = await loadGoogleapis();
  // Force the loopback URI we'll listen on, even if the client_secret.json
  // lists a different one — Desktop-app OAuth clients accept any localhost.
  const oauth2 = new google.auth.OAuth2(cfg.client_id, cfg.client_secret, LOOPBACK_URI);
  const authUrl = oauth2.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',  // always re-issue refresh_token (no-op if already granted)
    scope: SCOPES,
  });
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('OAUTH ONE-TIME CONSENT');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Open this URL in a browser signed into the Google account that has access to the sheet:');
  console.log('');
  console.log(authUrl);
  console.log('');
  console.log(`Waiting on ${LOOPBACK_URI} for the redirect…`);
  if (openUrl) {
    try { await openUrl(authUrl); } catch (_) { /* operator can still paste */ }
  }

  const code = await listenForCode(LOOPBACK_PORT);
  console.log('✓ Received authorization code, exchanging for tokens…');

  const { tokens } = await oauth2.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error(
      `Google returned no refresh_token. This usually means the user has already granted ` +
      `consent and the previous refresh_token is still valid. Either revoke access at ` +
      `https://myaccount.google.com/permissions and rerun, or copy the existing token from a teammate.`
    );
  }

  await writeFile(OAUTH_TOKEN_PATH, JSON.stringify(tokens, null, 2), 'utf8');
  console.log(`✓ Tokens saved to ${OAUTH_TOKEN_PATH}`);
  console.log('  This file is gitignored — never commit it.');
  return OAUTH_TOKEN_PATH;
}

function listenForCode(port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      if (url.pathname !== '/') {
        res.writeHead(404);
        res.end();
        return;
      }
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      if (error) {
        res.end(`<!doctype html><h1>Authorization failed</h1><p>${escapeHtml(error)}</p><p>You can close this tab and return to the terminal.</p>`);
        server.close();
        reject(new Error(`OAuth consent denied: ${error}`));
        return;
      }
      if (code) {
        res.end(`<!doctype html><h1>Authorization complete</h1><p>You can close this tab and return to the terminal — the bot has captured the code.</p>`);
        server.close();
        resolve(code);
        return;
      }
      res.end('Waiting for OAuth redirect…');
    });
    server.on('error', reject);
    server.listen(port, '127.0.0.1');
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

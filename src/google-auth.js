// Resolve Google API auth for the promo bot, with three paths in order of
// preference:
//
//   1. Service account JSON (legacy / preferred, but blocked on the
//      thebrandingpeople.co org by the iam.disableServiceAccountKeyCreation
//      org policy). Set GOOGLE_APPLICATION_CREDENTIALS or place
//      `google-credentials.local.json` in the repo root.
//
//   2. OAuth installed-app: one-time interactive consent the operator runs
//      via `bin/sheets-oauth.mjs`. Stores a refresh token at
//      `google-oauth-token.local.json`; subsequent runs auto-refresh the
//      access token via google-auth-library. Requires
//      `google-oauth-client.local.json` (the client_secret JSON downloaded
//      from APIs & Services → Credentials in GCP).
//
//   3. Nothing → throws with a pointer to docs/SHEETS-API-SETUP.md.
//
// All bot code should obtain an authenticated client via getGoogleAuth().
// The returned object exposes { client, email, mode } — `client` plugs
// directly into google.sheets({ version: 'v4', auth: client }).

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

export const SA_CRED_PATH       = path.resolve('google-credentials.local.json');
export const OAUTH_CLIENT_PATH  = path.resolve('google-oauth-client.local.json');
export const OAUTH_TOKEN_PATH   = path.resolve('google-oauth-token.local.json');
// Gmail-only token (gmail.readonly) for the FastTrack OTP reader — keeps the main
// token narrow. Created by: node bin/gmail-oauth.mjs
export const GMAIL_TOKEN_PATH   = path.resolve('google-oauth-gmail-token.local.json');
export const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

export const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/presentations',
  'https://www.googleapis.com/auth/script.projects',
  'https://www.googleapis.com/auth/script.deployments',
  'https://www.googleapis.com/auth/gmail.readonly',
];

// Memoised so we auth once per process.
let _authPromise = null;

export function getGoogleAuth() {
  if (_authPromise) return _authPromise;
  _authPromise = (async () => {
    const { google } = await loadGoogleapis();

    // ── Path 1: service account ─────────────────────────────────────────
    const envPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    const saPath = (envPath && existsSync(envPath)) ? envPath
                 : (existsSync(SA_CRED_PATH) ? SA_CRED_PATH : null);
    if (saPath) {
      const raw = await readFile(saPath, 'utf8');
      let cred;
      try { cred = JSON.parse(raw); }
      catch (e) { throw new Error(`SA credentials at ${saPath} not valid JSON: ${e.message}`); }
      if (cred.type === 'service_account') {
        const auth = new google.auth.GoogleAuth({ credentials: cred, scopes: SCOPES });
        const client = await auth.getClient();
        return { client, email: cred.client_email || null, mode: 'service_account' };
      }
      // Not a SA file → fall through to OAuth (the user may have downloaded
      // an OAuth client_secret with the same name; oauth-flow.js will pick
      // it up).
    }

    // ── Path 2: OAuth ──────────────────────────────────────────────────
    if (existsSync(OAUTH_CLIENT_PATH) && existsSync(OAUTH_TOKEN_PATH)) {
      const clientCfg = await readClientSecret(OAUTH_CLIENT_PATH);
      const token = JSON.parse(await readFile(OAUTH_TOKEN_PATH, 'utf8'));
      if (!token.refresh_token) {
        throw new Error(
          `OAuth token at ${OAUTH_TOKEN_PATH} has no refresh_token. Re-run:\n` +
          `  node bin/sheets-oauth.mjs`
        );
      }
      const oauth2 = new google.auth.OAuth2(clientCfg.client_id, clientCfg.client_secret, clientCfg.redirect_uri);
      oauth2.setCredentials(token);
      return { client: oauth2, email: token.user_email || null, mode: 'oauth' };
    }

    // ── Path 3: nothing ─────────────────────────────────────────────────
    throw new Error(noAuthMessage());
  })();
  return _authPromise;
}

// Read an OAuth client_secret.json — the file Google produces when you
// create an OAuth 2.0 Client ID of type "Desktop app". Shape is one of:
//   { installed: { client_id, client_secret, redirect_uris: [...] } }
//   { web:       { client_id, client_secret, redirect_uris: [...] } }
// We tolerate both and extract the first redirect URI; for desktop apps
// any http://localhost or http://127.0.0.1 URI is accepted by Google.
export async function readClientSecret(filePath = OAUTH_CLIENT_PATH) {
  const raw = await readFile(filePath, 'utf8');
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (e) { throw new Error(`OAuth client secret at ${filePath} not valid JSON: ${e.message}`); }
  const block = parsed.installed || parsed.web || parsed;
  if (!block.client_id || !block.client_secret) {
    throw new Error(`OAuth client secret at ${filePath} missing client_id / client_secret`);
  }
  return {
    client_id: block.client_id,
    client_secret: block.client_secret,
    redirect_uri: (block.redirect_uris && block.redirect_uris[0]) || 'http://127.0.0.1:8765/',
  };
}

export async function loadGoogleapis() {
  try {
    return await import('googleapis');
  } catch (e) {
    throw new Error(
      `googleapis npm package not installed. Run:\n` +
      `  npm install googleapis\n` +
      `(${e.message})`
    );
  }
}

function noAuthMessage() {
  return (
    `No Google API credentials found. Two paths:\n` +
    `  (A) Service account (blocked on thebrandingpeople.co — needs IT admin):\n` +
    `      Place credentials.json at ${SA_CRED_PATH}\n` +
    `  (B) OAuth installed-app (recommended for this org):\n` +
    `      1. Place OAuth client_secret.json at ${OAUTH_CLIENT_PATH}\n` +
    `      2. Run: node bin/sheets-oauth.mjs    (one-time interactive consent)\n` +
    `  See docs/SHEETS-API-SETUP.md for the full walkthrough.`
  );
}

// Gmail client for the OTP reader: the dedicated Gmail-only token when present,
// otherwise the main login (which then needs gmail.readonly itself).
export async function getGmailAuth() {
  if (existsSync(OAUTH_CLIENT_PATH) && existsSync(GMAIL_TOKEN_PATH)) {
    const { google } = await loadGoogleapis();
    const clientCfg = await readClientSecret(OAUTH_CLIENT_PATH);
    const token = JSON.parse(await readFile(GMAIL_TOKEN_PATH, 'utf8'));
    const oauth2 = new google.auth.OAuth2(clientCfg.client_id, clientCfg.client_secret, clientCfg.redirect_uri);
    oauth2.setCredentials(token);
    return { client: oauth2, mode: 'oauth-gmail' };
  }
  return getGoogleAuth();
}

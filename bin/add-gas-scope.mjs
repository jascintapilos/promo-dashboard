#!/usr/bin/env node
/**
 * Adds script.external_request to the Google OAuth token.
 * Run once; redirects to http://127.0.0.1:8765/ after Jascinta approves.
 */
import { readFileSync, writeFileSync } from 'fs';
import http from 'http';
import https from 'https';
import { URL } from 'url';

const TOKEN_FILE = 'google-oauth-token.local.json';
const CLIENT_FILE = 'google-oauth-client.local.json';

const client = JSON.parse(readFileSync(CLIENT_FILE, 'utf8')).installed;

const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/presentations',
  'https://www.googleapis.com/auth/script.projects',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/script.deployments',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/script.external_request',
].join(' ');

const REDIRECT_URI = 'http://127.0.0.1:8765/';

const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: client.client_id,
  response_type: 'code',
  redirect_uri: REDIRECT_URI,
  scope: SCOPES,
  access_type: 'offline',
  prompt: 'consent',
}).toString();

console.log('\n=== Google OAuth re-consent ===');
console.log('Open this URL in Jascinta\'s browser:\n');
console.log(authUrl);
console.log('\nWaiting for callback on http://127.0.0.1:8765/ ...\n');

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1:8765');
  const code = u.searchParams.get('code');
  if (!code) {
    res.writeHead(400); res.end('No code in callback'); return;
  }

  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<h2>Authorization received! You can close this tab.</h2>');
  server.close();

  console.log('Got auth code, exchanging for token...');
  const tokenData = await exchangeCode(code);
  console.log('Scopes in new token:', tokenData.scope);
  writeFileSync(TOKEN_FILE, JSON.stringify(tokenData, null, 2));
  console.log('\nToken saved to', TOKEN_FILE);
  console.log('Done. You can now use scripts.run with script.external_request.');
  process.exit(0);
});

server.listen(8765, '127.0.0.1');

function exchangeCode(code) {
  const body = new URLSearchParams({
    code,
    client_id: client.client_id,
    client_secret: client.client_secret,
    redirect_uri: REDIRECT_URI,
    grant_type: 'authorization_code',
  }).toString();

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(new Error(data)); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

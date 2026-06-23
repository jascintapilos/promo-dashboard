#!/usr/bin/env node
/**
 * Push V69's content back to HEAD so /dev URL also serves V69. Used when V70
 * has a runtime bug we need to take off the head while we diagnose.
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

// Fetch V69 content
const v69 = await api('GET', `/projects/${SCRIPT_ID}/content?versionNumber=69`);
console.log('Fetched V69 content:', v69.files.map(f => `${f.name} (${f.source.length} chars)`).join(', '));

// Push back to HEAD
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: v69.files });
console.log('✓ HEAD restored to V69 content');
console.log('  /dev URL now serves V69');
console.log('  /exec URL also still on V69 (we rolled back earlier)');

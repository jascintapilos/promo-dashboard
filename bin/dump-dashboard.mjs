#!/usr/bin/env node
/**
 * Fetch current Dashboard source from Apps Script and write to local file for inspection.
 */
import { writeFileSync } from 'node:fs';
import { getGoogleAuth } from '../src/google-auth.js';
const SCRIPT_ID = '1G8PrjOQ45yafM4lo3dL1AG8HKFSZ8tSlX7ei9EPZgw6bacjHk5CPtTW_';
const { client } = await getGoogleAuth();
const tok = (await client.getAccessToken()).token;

async function api(method, url) {
  const r = await fetch(`https://script.googleapis.com/v1${url}`, {
    method, headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
  });
  if (!r.ok) throw new Error(`${method} ${url}: ${r.status} ${await r.text()}`);
  return r.json();
}

const proj = await api('GET', `/projects/${SCRIPT_ID}/content`);
for (const f of proj.files) {
  const ext = f.type === 'HTML' ? '.html' : '.gs';
  writeFileSync(`./tmp/${f.name}${ext}`, f.source);
  console.log(`${f.name}${ext} — ${f.source.length} chars`);
}

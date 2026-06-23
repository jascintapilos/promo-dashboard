#!/usr/bin/env node
/** Dump current Apps Script project files locally so we can scope patches. */
import { writeFile, mkdir } from 'node:fs/promises';
import { getGoogleAuth } from '../src/google-auth.js';
const SCRIPT_ID = '1G8PrjOQ45yafM4lo3dL1AG8HKFSZ8tSlX7ei9EPZgw6bacjHk5CPtTW_';
const { client } = await getGoogleAuth();
const tok = (await client.getAccessToken()).token;

const r = await fetch(`https://script.googleapis.com/v1/projects/${SCRIPT_ID}/content`, {
  headers: { Authorization: 'Bearer ' + tok },
});
if (!r.ok) throw new Error('GET content: ' + r.status + ' ' + await r.text());
const proj = await r.json();

await mkdir('tmp', { recursive: true });
for (const f of proj.files) {
  const ext = f.type === 'HTML' ? '.html' : (f.type === 'JSON' ? '.json' : '.gs');
  await writeFile(`tmp/${f.name}${ext}`, f.source);
  console.log(`✓ tmp/${f.name}${ext}  (${f.source.length} chars)`);
}

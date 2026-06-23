// TinyPNG / Tinify compression — zero-dep wrapper.
//
// Usage:
//   import { compressImage, getApiKey } from './tinify.js';
//   const { bytes, meta } = await compressImage(rawBytes, getApiKey());
//
// API contract (confirmed by probe 2026-05-14):
//   POST https://api.tinify.com/shrink
//     Auth: Basic api:<key>
//     Body: raw image bytes (no multipart)
//     Content-Type: application/octet-stream
//   → 201 Created
//     JSON: { input: {size,type}, output: {size,type,width,height,ratio,url} }
//     Headers: Location=<download url>, Compression-Count, Compression-Count-Remaining
//   GET <Location>
//     Auth: same Basic
//   → 200 OK with compressed bytes
//
// Free tier: 500 compressions/month/key. Each image counts once whether the
// caller downloads it or not — so don't re-shrink on retries.

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const LOCAL_FILE = path.resolve(process.env.BO_SITES_LOCAL_FILE || 'bo-sites.local.json');

let _cachedKey = null;

export function getApiKey() {
  if (_cachedKey) return _cachedKey;
  if (process.env.TINIFY_KEY) { _cachedKey = process.env.TINIFY_KEY; return _cachedKey; }
  if (existsSync(LOCAL_FILE)) {
    try {
      const parsed = JSON.parse(readFileSync(LOCAL_FILE, 'utf8'));
      if (parsed.tinify?.apiKey) { _cachedKey = parsed.tinify.apiKey; return _cachedKey; }
    } catch {}
  }
  throw new Error(
    `No Tinify API key found.\n` +
    `  Set TINIFY_KEY=... in your environment, or add\n` +
    `    "tinify": { "apiKey": "<key>" }\n` +
    `  to ${LOCAL_FILE}.`,
  );
}

function authHeader(apiKey) {
  return 'Basic ' + Buffer.from(`api:${apiKey}`).toString('base64');
}

// Compress one image. `input` may be a Buffer / Uint8Array / ArrayBuffer.
// Returns { bytes: Buffer, meta: { input, output }, monthlyCount, monthlyRemaining }.
export async function compressImage(input, apiKey = getApiKey()) {
  const body = input instanceof ArrayBuffer ? Buffer.from(input) : Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (body.length > 5 * 1024 * 1024) {
    throw new Error(`tinify: image is ${body.length} bytes; max accepted is 5 MB`);
  }

  const auth = authHeader(apiKey);
  const shrink = await fetch('https://api.tinify.com/shrink', {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/octet-stream' },
    body,
  });

  if (shrink.status !== 201) {
    const errBody = await shrink.text().catch(() => '');
    throw new Error(`tinify shrink HTTP ${shrink.status}: ${errBody.slice(0, 300)}`);
  }

  const meta = await shrink.json();
  const location = shrink.headers.get('location');
  if (!location) throw new Error(`tinify: missing Location header on 201`);

  const monthlyCount = Number(shrink.headers.get('compression-count')) || null;
  // The API returns the per-key running total; subtract from the free-tier cap
  // to give a "remaining" hint. (No header for remaining on the free plan.)
  const monthlyRemaining = monthlyCount !== null ? Math.max(0, 500 - monthlyCount) : null;

  const dl = await fetch(location, { headers: { Authorization: auth } });
  if (!dl.ok) {
    const errBody = await dl.text().catch(() => '');
    throw new Error(`tinify download HTTP ${dl.status}: ${errBody.slice(0, 300)}`);
  }
  const bytes = Buffer.from(await dl.arrayBuffer());
  return { bytes, meta, monthlyCount, monthlyRemaining };
}

// Convenience: validate a key without burning a real compression.
// (No free probe endpoint — we do an empty POST and detect 401 vs 415.)
export async function validateKey(apiKey = getApiKey()) {
  const auth = authHeader(apiKey);
  const res = await fetch('https://api.tinify.com/shrink', {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/octet-stream' },
    body: Buffer.from('not-an-image'),
  });
  if (res.status === 401) return { ok: false, reason: 'invalid key' };
  // 415 / 400 / 422 — auth worked but body wasn't an image. That's fine for validation.
  return { ok: true, status: res.status };
}

// TOTP code generator for FastTrack CRM auto-login.
// Secrets stored in ft-totp-secrets.local.json (gitignored).
//
// Format of ft-totp-secrets.local.json:
// {
//   "ws1":   "BASE32SECRET",
//   "qpro1": "BASE32SECRET",
//   "qp2":   "BASE32SECRET"
// }

import { readFileSync, existsSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import path from 'node:path';

const SECRETS_FILE = path.resolve('ft-totp-secrets.local.json');

// RFC 4648 base32 decode
function base32Decode(str) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const s = str.replace(/=+$/, '').toUpperCase();
  let bits = 0, val = 0;
  const out = [];
  for (const ch of s) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) continue;
    val = (val << 5) | idx;
    bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}

// RFC 6238 TOTP (SHA-1, 6 digits, 30s window)
function totpNow(secret) {
  const key = base32Decode(secret);
  const counter = Math.floor(Date.now() / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeBigInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', key).update(buf).digest();
  const offset = hmac[19] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(code % 1_000_000).padStart(6, '0');
}

export function hasTotpSecret(instance) {
  if (!existsSync(SECRETS_FILE)) return false;
  const secrets = JSON.parse(readFileSync(SECRETS_FILE, 'utf8'));
  return !!(secrets[instance]);
}

export function generateTotp(instance) {
  if (!existsSync(SECRETS_FILE)) {
    throw new Error(`No TOTP secrets file. Run: node bin/decode-ga-export.mjs <screenshot.png>`);
  }
  const secrets = JSON.parse(readFileSync(SECRETS_FILE, 'utf8'));
  const secret = secrets[instance];
  if (!secret) {
    throw new Error(`No TOTP secret for "${instance}". Run: node bin/decode-ga-export.mjs <screenshot.png>`);
  }
  return totpNow(secret);
}

#!/usr/bin/env node
/**
 * Decode a Google Authenticator "Export Accounts" QR code screenshot and
 * extract TOTP secrets for Fast Track CRM accounts.
 *
 * Usage:
 *   node bin/decode-ga-export.mjs <path-to-screenshot.png>
 *
 * The script:
 *   1. Reads the QR code from the screenshot
 *   2. Decodes the otpauth-migration://offline?data=BASE64 URL
 *   3. Parses the protobuf payload (Google Authenticator migration format)
 *   4. Shows all found accounts
 *   5. Saves Fast Track CRM entries to ft-totp-secrets.local.json
 *
 * How to get the screenshot:
 *   - Open Google Authenticator on your phone
 *   - Menu → Export Accounts → select the Fast Track CRM entry
 *   - Screenshot the QR code shown
 *   - Transfer to PC (email / WhatsApp / cable) and save as a PNG or JPG
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const jsQR = require('jsqr');
const sharp = require('sharp');

// ── Args ──────────────────────────────────────────────────────────────────────

const imgArg = process.argv[2];
if (!imgArg) {
  console.error('Usage: node bin/decode-ga-export.mjs <path-to-screenshot.png>');
  console.error('');
  console.error('Steps to get the screenshot:');
  console.error('  1. Open Google Authenticator on your phone');
  console.error('  2. Tap the 3-dot menu → "Export accounts"');
  console.error('  3. Select only the "Fast Track CRM" entry (or all FT entries)');
  console.error('  4. Tap "Export" — a QR code appears');
  console.error('  5. Screenshot the QR code on your phone');
  console.error('  6. Transfer the screenshot to this PC and note its path');
  process.exit(1);
}

const imgPath = path.resolve(imgArg);
if (!existsSync(imgPath)) {
  console.error(`File not found: ${imgPath}`);
  process.exit(1);
}

console.log(`\nReading: ${imgPath}`);

// ── QR decode ─────────────────────────────────────────────────────────────────

const { data: pixelData, info } = await sharp(imgPath)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });

console.log(`Image: ${info.width}×${info.height} px`);

const qr = jsQR(new Uint8ClampedArray(pixelData), info.width, info.height);

if (!qr) {
  console.error('\nCould not detect a QR code in the image.');
  console.error('Tips:');
  console.error('  - Crop the image so the QR code takes up most of the frame');
  console.error('  - Make sure the image is not blurry and has good contrast');
  console.error('  - Try a higher-resolution screenshot');
  process.exit(1);
}

console.log(`QR data: ${qr.data.slice(0, 80)}…`);

// ── Parse otpauth-migration URL ────────────────────────────────────────────────

if (!qr.data.startsWith('otpauth-migration://offline?')) {
  console.error('\nUnexpected QR content — expected otpauth-migration://offline?data=...');
  console.error('Got:', qr.data.slice(0, 120));
  process.exit(1);
}

const url = new URL(qr.data);
const b64 = url.searchParams.get('data');
if (!b64) {
  console.error('No data= parameter in QR URL');
  process.exit(1);
}

const protobuf = Buffer.from(b64, 'base64');

// ── Minimal protobuf decoder for Google Authenticator migration format ─────────
//
// Schema (google_auth.proto):
//   message MigrationPayload {
//     repeated OtpParameters otp_parameters = 1;
//     message OtpParameters {
//       bytes  secret    = 1;
//       string name      = 2;
//       string issuer    = 3;
//       int32  algorithm = 4;   // 1=SHA1
//       int32  digits    = 5;   // 1=SIX, 2=EIGHT
//       int32  type      = 6;   // 1=HOTP, 2=TOTP
//       int64  counter   = 7;
//     }
//   }

function readVarint(buf, pos) {
  let result = 0n, shift = 0n;
  while (pos < buf.length) {
    const byte = buf[pos++];
    result |= BigInt(byte & 0x7f) << shift;
    shift += 7n;
    if ((byte & 0x80) === 0) break;
  }
  return { value: result, pos };
}

function decodeMessage(buf) {
  const fields = {};
  let pos = 0;
  while (pos < buf.length) {
    const tagInfo = readVarint(buf, pos);
    pos = tagInfo.pos;
    const tag = tagInfo.value;
    const fieldNum = Number(tag >> 3n);
    const wireType = Number(tag & 7n);

    if (wireType === 0) { // varint
      const v = readVarint(buf, pos);
      pos = v.pos;
      fields[fieldNum] = (fields[fieldNum] || []);
      fields[fieldNum].push(Number(v.value));
    } else if (wireType === 2) { // length-delimited
      const lenInfo = readVarint(buf, pos);
      pos = lenInfo.pos;
      const len = Number(lenInfo.value);
      const bytes = buf.slice(pos, pos + len);
      pos += len;
      fields[fieldNum] = (fields[fieldNum] || []);
      fields[fieldNum].push(bytes);
    } else if (wireType === 1) { // 64-bit (skip)
      pos += 8;
    } else if (wireType === 5) { // 32-bit (skip)
      pos += 4;
    } else {
      // Unknown wire type — stop
      break;
    }
  }
  return fields;
}

function decodeString(bytes) {
  return Buffer.from(bytes).toString('utf8');
}

// Encode bytes → base32
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function toBase32(bytes) {
  let bits = 0, val = 0, output = '';
  for (const byte of bytes) {
    val = (val << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += B32[(val >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += B32[(val << (5 - bits)) & 31];
  return output;
}

// ── Parse ─────────────────────────────────────────────────────────────────────

const payload = decodeMessage(protobuf);
const otpParamRaw = payload[1] || []; // field 1 = repeated OtpParameters

const accounts = otpParamRaw.map(bytes => {
  const f = decodeMessage(bytes);
  return {
    secret:    f[1]?.[0] ? toBase32(f[1][0]) : null,
    name:      f[2]?.[0] ? decodeString(f[2][0]) : '',
    issuer:    f[3]?.[0] ? decodeString(f[3][0]) : '',
    algorithm: f[4]?.[0] || 1,
    digits:    f[5]?.[0] || 1,
    type:      f[6]?.[0] || 2, // 2=TOTP
  };
});

// ── Display all found accounts ────────────────────────────────────────────────

console.log(`\nFound ${accounts.length} account(s) in QR export:\n`);
accounts.forEach((a, i) => {
  const type = a.type === 2 ? 'TOTP' : a.type === 1 ? 'HOTP' : `type${a.type}`;
  const digits = a.digits === 1 ? 6 : a.digits === 2 ? 8 : a.digits;
  console.log(`  [${i}] ${a.name || '(unnamed)'}`);
  console.log(`       Issuer:  ${a.issuer || '(none)'}`);
  console.log(`       Type:    ${type}, ${digits} digits`);
  console.log(`       Secret:  ${a.secret ? a.secret.slice(0,8) + '…' + '(hidden)' : 'MISSING'}`);
});

// ── Match to FT CRM instances ─────────────────────────────────────────────────

const FT_PATTERNS = [
  { pattern: /fast\s*track|ft.?crm|ftcrm/i, instances: ['ws1', 'qpro1', 'qp2'], label: 'Fast Track CRM' },
  { pattern: /mb8|ws1|ws2/i,                instances: ['ws1'],                 label: 'WS1/WS2 (MB8)' },
  { pattern: /qpro?1|alpha.?iota.?qp1/i,    instances: ['qpro1'],               label: 'QPRO1' },
  { pattern: /qp2|alpha.?iota.?qp2/i,       instances: ['qp2'],                 label: 'QP2' },
];

const ftAccounts = accounts.filter(a => {
  const combined = `${a.name} ${a.issuer}`;
  return FT_PATTERNS.some(p => p.pattern.test(combined));
});

// Also include any account whose name/issuer contains "ft-crm"
const allFtAccounts = accounts.filter(a => {
  const combined = `${a.name} ${a.issuer}`;
  return /ft.?crm|fast.?track/i.test(combined);
});

const matchedAccounts = [...new Set([...ftAccounts, ...allFtAccounts])];

if (matchedAccounts.length === 0) {
  console.log('\nNo Fast Track CRM accounts found in this QR export.');
  console.log('Make sure to select the FT CRM entry when exporting from Google Authenticator.');
  console.log('\nAll account names found:');
  accounts.forEach(a => console.log(`  "${a.name}" / "${a.issuer}"`));
  process.exit(0);
}

console.log(`\n${matchedAccounts.length} Fast Track CRM account(s) found.`);

// ── Determine which instance(s) each secret maps to ──────────────────────────
// If there's only one FT account, it maps to ALL three instances.
// If there are multiple, try to match by name.

const secretMap = {};

if (matchedAccounts.length === 1) {
  // One shared secret for all instances
  const secret = matchedAccounts[0].secret;
  if (!secret) { console.error('No secret found in the account entry'); process.exit(1); }
  console.log(`\nOne shared TOTP secret — mapping to: ws1, qpro1, qp2`);
  secretMap.ws1   = secret;
  secretMap.qpro1 = secret;
  secretMap.qp2   = secret;
} else {
  for (const a of matchedAccounts) {
    const combined = `${a.name} ${a.issuer}`;
    for (const fp of FT_PATTERNS) {
      if (fp.pattern.test(combined)) {
        for (const inst of fp.instances) {
          if (!secretMap[inst]) secretMap[inst] = a.secret;
        }
      }
    }
  }
  console.log('\nMapped secrets:');
  Object.entries(secretMap).forEach(([inst, s]) =>
    console.log(`  ${inst}: ${s ? s.slice(0,8)+'…(hidden)' : 'NOT FOUND'}`));
}

// ── Save to ft-totp-secrets.local.json ───────────────────────────────────────

const outFile = path.resolve('ft-totp-secrets.local.json');
const existing = existsSync(outFile)
  ? JSON.parse(readFileSync(outFile, 'utf8'))
  : {};

const merged = { ...existing, ...secretMap };
writeFileSync(outFile, JSON.stringify(merged, null, 2) + '\n', { mode: 0o600 });

console.log(`\n✅ Saved to ft-totp-secrets.local.json`);
console.log(`   Instances configured: ${Object.keys(merged).join(', ')}`);
console.log('\nTotp secrets are now stored. The capture script will use them automatically');
console.log('without prompting for a code — sessions can be renewed non-interactively.');

// ── Quick verify (generate current code to confirm secret is valid) ───────────
try {
  const { TOTP } = await import('otplib');
  const firstInst = Object.keys(secretMap)[0];
  const secret = secretMap[firstInst];
  const token = TOTP.generate(secret);
  console.log(`\nVerification: current TOTP code for ${firstInst}: ${token}`);
  console.log('(Confirm this matches what your authenticator app shows right now.)');
} catch { /* non-fatal */ }

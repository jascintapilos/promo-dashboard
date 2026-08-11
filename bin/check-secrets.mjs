#!/usr/bin/env node
// Pre-commit secret guard. Runs via lint-staged (see package.json) on every
// staged file, every commit. Two layers:
//   1. Exact-value regression guard for the specific credentials leaked and
//      remediated on 2026-08-10 (commits a62963c/5bb3bda) — hard block, no
//      escape hatch, since there is no legitimate reason these exact values
//      should ever reappear.
//   2. Generic heuristic: a password/secret-shaped key assigned a real-looking
//      quoted literal, anywhere outside the gitignored credential files
//      (which can't be staged in the first place, so no extra filtering
//      needed here). This is what would have caught the original leak —
//      none of those values matched a recognized provider-key format, so a
//      tool that only knows AWS/GCP/etc. key shapes would have missed it.
//
// Escape hatch: a staged line containing `nosecret` (case-insensitive)
// anywhere on it is skipped — for genuine false positives (test fixtures,
// docs describing the pattern without a real value). Use sparingly and only
// when you're certain the value isn't real.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// SHA-256 hashes only — base64 was reversible in one line, which defeats the
// point of a regression guard (the tool's own source could be decoded back
// into the real secrets). A hash can confirm a match without the plaintext
// ever existing in this file. Substring detection (not just whole-line
// equality) still works via a sliding window sized to each hash's known
// plaintext length — see findLeakedValue().
const LEAKED_HASHES = [
  { length: 9,  label: 'the QPRO/QP2 bot password',      sha256: 'cb356f5b9d96485e6c038cab702d88b2a85c49f16962f14236bdb2e9da11ae70' },
  { length: 11, label: 'a personal Workspace password',   sha256: 'd0f2f08bfe0a8d761c1a8a41a2992e807731d6e12ca866b839185f60103d680d' },
  { length: 44, label: 'the QP2 reqSignKey',              sha256: 'f2f07e0e5ebe53dc8088875da35f54ff704ea46d1a316f81df48c256cd16f4c9' },
];

function sha256(s) {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

// Slides a window of each known plaintext length across the line and hashes
// every candidate substring — this is what lets a hash-only approach still
// catch the value appearing ANYWHERE in the line (mid-string, inside a
// larger template literal, etc.), not just when the whole line matches.
// Returns every distinct leaked value found, not just the first — some of
// the original leak's console-reminder lines had two different leaked
// credentials embedded side by side in one string, and both need to be
// reported, not just whichever is checked first.
function findLeakedValues(line) {
  const found = new Set();
  for (const entry of LEAKED_HASHES) {
    if (line.length < entry.length) continue;
    for (let i = 0; i <= line.length - entry.length; i++) {
      if (sha256(line.slice(i, i + entry.length)) === entry.sha256) { found.add(entry.label); break; }
    }
  }
  return [...found];
}

const SAFE_PLACEHOLDERS = new Set([
  'replace_me', 'change_me', 'changeme', 'placeholder', 'your_password',
  'your-password', 'password', 'todo', 'tbd', 'n/a', 'none',
]);

// The optional [\"'`]? right after the key name matches a JSON-style key's
// closing quote ("password": "x") — without it, this only matched bare JS
// keys (password: "x") and silently missed every JSON-formatted leak in the
// original incident, including bo-sites.example.json's reqSignKey.
const KEY_PATTERN =
  /\b(password|passwd|pwd|secret|api[-_]?key|sign[-_]?key|reqsignkey|access[-_]?token|auth[-_]?token)\b['"`]?\s*[:=]\s*(['"`])((?:(?!\2).){4,})\2/gi;

let violations = [];

function scanFile(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return; // deleted/binary/unreadable — nothing to scan
  }
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (/nosecret/i.test(line)) return;

    for (const label of findLeakedValues(line)) {
      violations.push({ path, line: i + 1, reason: `contains a previously-leaked credential value (${label})` });
    }

    for (const m of line.matchAll(KEY_PATTERN)) {
      const value = m[3];
      if (SAFE_PLACEHOLDERS.has(value.toLowerCase())) continue;
      if (/^<.*>$/.test(value)) continue; // <password>, <username>, etc.
      violations.push({ path, line: i + 1, reason: `"${m[1]}" assigned a hardcoded literal ("${value.slice(0, 3)}...")` });
    }
  });
}

const files = process.argv.slice(2);
if (!files.length) process.exit(0);
files.forEach(scanFile);

if (violations.length) {
  console.error('\n✗ Possible hardcoded secret(s) — commit blocked:\n');
  for (const v of violations) {
    console.error(`  ${v.path}:${v.line} — ${v.reason}`);
  }
  console.error(
    '\nMove real credentials to a gitignored *.local.json file instead.\n' +
    'If this is a genuine false positive (test fixture, docs example), add\n' +
    '`nosecret` anywhere on that line to bypass this specific check.\n',
  );
  process.exit(1);
}
process.exit(0);

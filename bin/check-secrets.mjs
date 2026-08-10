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

// base64-encoded so this file's own source doesn't contain the literal
// strings — otherwise this script would fail its own check on every commit.
const LEAKED_VALUES = [
  'UHJvbW8xMTEh',
  'SmNhbHBoYTEyMyE=',
  'a2JYYkFFb3RaNjRudWVSWHQwK2ZXS0JuZEdBRExyUWlhTDZWcmhNK21Tdz0=',
].map(b64 => Buffer.from(b64, 'base64').toString('utf8'));

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

    for (const leaked of LEAKED_VALUES) {
      if (line.includes(leaked)) {
        violations.push({ path, line: i + 1, reason: `contains a previously-leaked credential value ("${leaked.slice(0, 4)}...")` });
      }
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

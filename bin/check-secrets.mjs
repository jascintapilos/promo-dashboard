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
  { length: 15, label: 'the GM01/UNTUNG28 bot password',  sha256: 'c83b518a8b4886187346854a4b52c368add7e78fcc03ab79689ef215ef49809d' },
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
  // README.md + bo-sites.example.json's reqSignKey placeholder — an
  // instruction ("go find the real value"), not a value itself.
  'find_in_main.<hash>.js_grep_for_reqsignkey',
]);

// No leading \b before the key-name alternation (only a trailing one) —
// deliberately, so this also catches the trigger word as a camelCase or
// snake_case SUFFIX (dbPassword, totp_secret, myApiKey), not just a
// standalone key. The trailing \b still blocks matching it as a PREFIX of
// an unrelated word (passwordless, secretary), since there's no boundary
// between "password"/"secret" and "less"/"ary".
//
// secret[-_]?key is listed explicitly (same trick as api[-_]?key and
// sign[-_]?key above) so the trigger word is ALSO caught as a PREFIX in the
// one compound where that legitimately matters: secretKey / secret_key /
// secret-key. This can't be done with a generic "allow any camelCase
// continuation after the trigger word" rule — this pattern has the /i flag
// for case-insensitive trigger words (PASSWORD, Password, password all need
// to match), and /i makes [A-Z] match lowercase too, so a
// "continuation must start with a capital letter" guard silently matches
// "secretary" (secret + ary) as well as "secretKey". Listing the one
// compound that's actually worth catching, the same way the existing
// api/sign-key entries do, avoids that trap entirely.
//
// Deliberately NOT adding a bare "pass"/"PASS" trigger, even bounded on both
// sides. Tried it (2026-08-12, after finding a real `PASS = x ?? 'literal'`
// leak that a bare trigger would catch) — swept the codebase and it flagged
// 12 lines, all false positives, all one shape: `cond ? 'PASS' : 'FAIL'`.
// This codebase uses PASS/FAIL as QC-verdict strings constantly, and the
// ternary's `?`...`:` reads to this regex exactly like an object key's `:` —
// "PASS" becomes the "key", the ternary's own colon becomes the assignment,
// and the other branch's string becomes the "value". A specific known
// password happening to be the word "pass" is exactly what LEAKED_HASHES
// (above) is for — added there instead, since it doesn't share this
// false-positive surface at all.
//
// The optional (?:[^\n;,{}]{0,120}?(?:\?\?|\|\|)\s*)? right before the value
// alternation lets a `??`/`||` fallback expression sit between the operator
// and the actual literal — a CLI-arg-or-else-hardcoded-default assignment,
// with the real value sitting after the fallback operator rather than right
// after `:`/`=`. Without it, only a literal immediately adjacent to the
// operator was ever matched, so this extremely common idiom slipped
// through even for already-recognized trigger words. Bounded and excludes
// statement/block-ending characters so it can't run past the current
// assignment onto an unrelated one later in the line.
//
// The value side accepts either a quoted literal or a bare .env-style
// unquoted one (KEY=value with no quotes at all) — group 2/3 for quoted,
// group 4 for bare; exactly one of the two is set per match.
// The optional [\"'`]? right after the key name matches a JSON-style key's
// closing quote ("password": "x") — without it, this only matched bare JS
// keys (password: "x") and silently missed every JSON-formatted leak in the
// original incident, including bo-sites.example.json's reqSignKey.
const KEY_PATTERN =
  /(password|passwd|pwd|secret[-_]?key|secret|api[-_]?key|sign[-_]?key|reqsignkey|access[-_]?token|auth[-_]?token)\b['"`]?\s*[:=]\s*(?:[^\n;,{}]{0,120}?(?:\?\?|\|\|)\s*)?(?:(['"`])((?:(?!\2).){4,})\2|([^\s'"`]{4,}))/gi;

// Bare/unquoted values (group 4) are only trustworthy as "this is a literal"
// on .env-shaped files. There, KEY=value is always a literal — the format
// has no syntax for expressions. In .js/.mjs/.json, an unquoted value after
// `:`/`=` is normal CODE (a variable, `o.password`, `await getToken()`,
// `null`, a template literal) — sweeping the real codebase surfaced ~50
// such lines, none of them an actual secret. So bare-value matching is
// gated to files that look like .env/.env.<name>; every other file still
// requires an actual quoted string literal (group 3) to be flagged.
function isEnvFile(path) {
  return /\.env(\.[a-z0-9_-]+)?$/i.test(path);
}

let violations = [];

function scanFile(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return; // deleted/binary/unreadable — nothing to scan
  }
  const envLike = isEnvFile(path);
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (/nosecret/i.test(line)) return;

    for (const label of findLeakedValues(line)) {
      violations.push({ path, line: i + 1, reason: `contains a previously-leaked credential value (${label})` });
    }

    for (const m of line.matchAll(KEY_PATTERN)) {
      const value = m[3] ?? (envLike ? m[4] : undefined); // group 3 = quoted literal; group 4 = bare .env-style value, .env files only
      if (value === undefined) continue;
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

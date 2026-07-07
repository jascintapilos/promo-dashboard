#!/usr/bin/env node
// Stamp content-lane keys as reviewed in captures/ai-review-cursor.json so
// find-ai-review-candidates.mjs rotates past them tomorrow. Called by the
// /ai-review-sweep skill after brand-watch-reviewer returns for each
// content-lane candidate (regardless of verdict — being reviewed, not the
// outcome, is what advances the rotation).
//
// Usage: node bin/mark-ai-reviewed.mjs "QPRO1::FT_FC_68_GCSC_5X" "QP2A::FT_REL_98FS_SC_5X"
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

const keys = process.argv.slice(2);
if (!keys.length) { console.error('usage: mark-ai-reviewed.mjs <key> [<key>...]'); process.exit(2); }

const FILE = 'captures/ai-review-cursor.json';
const cursor = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {};
const now = new Date().toISOString();
for (const k of keys) cursor[k] = now;

mkdirSync('captures', { recursive: true });
writeFileSync(FILE, JSON.stringify(cursor, null, 2));
console.log(`✓ Marked ${keys.length} key(s) reviewed at ${now}`);

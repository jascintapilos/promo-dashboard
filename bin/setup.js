#!/usr/bin/env node
// Cross-platform first-run setup. Copies bo-sites.example.json → bo-sites.json
// (won't overwrite an existing file) and verifies Node + deps look sane.

import { existsSync, copyFileSync, chmodSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const example = path.join(root, 'bo-sites.example.json');
const target = path.join(root, 'bo-sites.json');

if (!existsSync(example)) {
  console.error(`Missing ${example}. Are you running this from the repo root?`);
  process.exit(2);
}

if (existsSync(target)) {
  console.log(`✓ bo-sites.json already exists — leaving it alone.`);
} else {
  copyFileSync(example, target);
  // Best-effort permissions tighten — ignored on Windows.
  try { chmodSync(target, 0o600); } catch {}
  console.log(`✓ Created bo-sites.json from example. Edit it to add your credentials.`);
}

// Light dep sanity check.
let depsOk = true;
try { await import('playwright'); } catch { depsOk = false; }
if (!depsOk) {
  console.log(`! "playwright" not installed yet — run: npm install`);
}

console.log(`
Next steps:
  1. Edit bo-sites.json — set username/password (and add more sites if you have them).
  2. (Optional, only if you'll use Phase 1 browser flow) npx playwright install chromium
  3. Try it:  node bin/sessions.js list
              node bin/promo-contents.js <BRAND>   (uses defaultSite)
`);

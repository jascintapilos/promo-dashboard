#!/usr/bin/env node
// Probe WS1 MY & SG (IGMP/Directus) for TLEO promo codes via Playwright.
// Compare to QPRO canonical source (54 codes) and report missing codes.
//
// Run: node bin/_probe-ws1-igmp-tleo-playwright.mjs
//      (requires Claude-in-Chrome or Playwright browser available)

import fs from 'node:fs';
import { chromium } from 'playwright';

const SOURCE = JSON.parse(fs.readFileSync('tmp/qpro2-tleo-source.json', 'utf8'));
const canonicalCodes = new Set(Object.keys(SOURCE));
console.log(`Canonical TLEO codes from qpro2: ${canonicalCodes.size}\n`);

const regions = [
  { name: 'WS1-MY', url: 'https://kioskmy.best-in-asia.com' },
  { name: 'WS1-SG', url: 'https://kiosksg.best-in-asia.com' },
];

// Note: This script assumes you have Playwright credentials configured.
// For manual testing via Claude-in-Chrome, navigate to the URL and search for TLEO codes.
// The script below is a template for automation.

console.log('⚠ WS1 IGMP probe requires interactive Playwright or Claude-in-Chrome login.');
console.log('Manual steps for Claude-in-Chrome:');
console.log('');

for (const region of regions) {
  console.log(`\n━━━ ${region.name} ━━━`);
  console.log(`1. Navigate to: ${region.url}`);
  console.log(`2. Log in with your WS1 credentials`);
  console.log(`3. Go to Promotions / Promo Codes section`);
  console.log(`4. Search/filter for codes containing "TLEO"`);
  console.log(`5. List all TLEO codes found and paste here, or`);
  console.log(`6. Export the list if available in the UI`);
}

console.log('\n\n--- TEMPLATE: If automation is available ---\n');
console.log('To automate this probe, you would:');
console.log('1. Launch browser: const browser = await chromium.launch()');
console.log('2. Navigate to WS1 URL');
console.log('3. Log in via the UI form');
console.log('4. Search for promo codes with filter code LIKE "%TLEO%"');
console.log('5. Extract all matching codes from the result table');
console.log('6. Compare with canonical set\n');

// For now, provide a manual comparison template
console.log('--- COMPARISON TEMPLATE ---\n');
console.log('Once you have the WS1 TLEO codes, run:');
console.log('node -e "');
console.log('const canonical = new Set(' + JSON.stringify([...canonicalCodes]) + ');');
console.log('const found = new Set([/* paste WS1 codes here */]);');
console.log('const missing = [...canonical].filter(c => !found.has(c));');
console.log('const extra = [...found].filter(c => !canonical.has(c));');
console.log('console.log(`Missing: ${missing.length}\\n`, missing);');
console.log('console.log(`Extra: ${extra.length}\\n`, extra);');
console.log('"');

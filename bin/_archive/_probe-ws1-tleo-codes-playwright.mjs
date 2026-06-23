#!/usr/bin/env node
// Probe WS1 MY & SG (IGMP/Directus via Playwright) for TLEO promo codes.
// Uses saved session cookies instead of manual login.
// Auto-extracts all TLEO codes and compares to QPRO canonical.
//
// Run: node bin/_probe-ws1-tleo-codes-playwright.mjs

import fs from 'node:fs';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const SOURCE = JSON.parse(fs.readFileSync('tmp/qpro2-tleo-source.json', 'utf8'));
const canonicalCodes = new Set(Object.keys(SOURCE));
console.log(`Canonical TLEO codes from qpro2: ${canonicalCodes.size}\n`);

// Load saved sessions
const SESSIONS = JSON.parse(fs.readFileSync('igmp-sessions.local.json', 'utf8'));

const sites = [
  { name: 'IGMP-MY', url: 'https://kioskmy.best-in-asia.com/Home#', sessionKey: 'ws1-v3-my' },
  { name: 'IGMP-SG', url: 'https://kiosksg.best-in-asia.com/Home', sessionKey: 'ws1-v3-sg' },
];
const OUT = path.resolve('captures');
await mkdir(OUT, { recursive: true });

const results = {};

for (const site of sites) {
  try {
    console.log(`\n━━━ ${site.name} (${site.url}) ━━━`);

    // Get saved session cookies
    const session = SESSIONS.sessions[site.sessionKey];
    if (!session) {
      throw new Error(`No saved session found for ${site.sessionKey}`);
    }

    // Use chromium with system Chrome (works on VDI)
    const browser = await chromium.launch({ headless: false, channel: 'chrome' });
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      httpCredentials: undefined
    });

    // Add cookies to context
    await ctx.addCookies(session.cookies);
    const page = await ctx.newPage();

    // Navigate to kiosk
    console.log('  Loading page with saved session...');
    await page.goto(site.url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000); // Wait for page to fully render

    // Navigate directly to Promotion Suite page via hash
    console.log('  Navigating to Promotion Suite...');
    await page.goto(site.url.replace(/Home#?.*/, '') + '#PM/PromotionSuite', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    // Look for Promo Code link/tab within Promotion Suite
    console.log('  Looking for Promo Code list...');

    // Try clicking on Promo Code tab or section
    const promoCodeTab = await page.locator('a[href*="PromoCode"], button:has-text("Promo Code"), div:has-text("Promo Code")').first();
    if (await promoCodeTab.isVisible().catch(() => false)) {
      console.log('  Found Promo Code tab, clicking...');
      await promoCodeTab.click();
      await page.waitForTimeout(2000);
    }

    console.log('  Auto-extracting TLEO codes...\n');

    // Scroll down to load all codes
    await page.evaluate(() => {
      window.scrollBy(0, window.innerHeight);
    });
    await page.waitForTimeout(1000);

    // Try to find and extract TLEO codes from the page
    const codes = await page.evaluate(() => {
      const allText = document.body.innerText;
      const codePattern = /[A-Z_]*TLEO[A-Z_0-9]*/g;
      const found = allText.match(codePattern) || [];
      // Remove duplicates and filter valid codes (at least 8 chars)
      return [...new Set(found)].filter(c => c.length > 5);
    });

    console.log(`  Extracted ${codes.length} TLEO codes from page DOM\n`);

    if (codes.length === 0) {
      console.log('  ⚠ No codes found in page text. Session may have expired.');
      console.log('  Try: 1. Re-save the session manually via another script');
      console.log('       2. Or manually update igmp-sessions.local.json\n');
    }

    results[site.name] = codes;
    await browser.close();

  } catch (e) {
    console.error(`  ERROR: ${e.message.split('\n')[0]}`);
    results[site.name] = null;
  }
}

// Compare results
console.log('\n━━━ COMPARISON ━━━\n');
for (const [siteId, found] of Object.entries(results)) {
  if (!found) {
    console.log(`${siteId}: ERROR - could not extract codes`);
    continue;
  }
  const foundSet = new Set(found.map(c => c.trim()).filter(Boolean));
  const missing = [...canonicalCodes].filter(c => !foundSet.has(c));
  const extra = [...foundSet].filter(c => !canonicalCodes.has(c));

  console.log(`${siteId}: Found ${foundSet.size} codes`);
  if (missing.length) {
    console.log(`  MISSING (${missing.length}):`);
    missing.forEach(c => console.log(`    ✗ ${c}`));
  } else {
    console.log(`  ✓ All canonical codes present`);
  }
  if (extra.length) {
    console.log(`  EXTRA (${extra.length}):`);
    extra.forEach(c => console.log(`    + ${c}`));
  }
  console.log('');
}

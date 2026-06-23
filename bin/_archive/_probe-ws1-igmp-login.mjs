#!/usr/bin/env node
// Probe WS1 IGMP MY & SG for TLEO codes using username/password login
// Compare to QPRO canonical source (54 codes) and report missing codes
//
// Run: node bin/_probe-ws1-igmp-login.mjs

import fs from 'node:fs';
import { chromium } from 'playwright';

const SOURCE = JSON.parse(fs.readFileSync('tmp/qpro2-tleo-source.json', 'utf8'));
const canonicalCodes = new Set(Object.keys(SOURCE));
console.log(`Canonical TLEO codes from qpro2: ${canonicalCodes.size}\n`);

// Credentials
const USERNAME = 'promo_testbot';
const PASSWORD = 'Promo111!';

const sites = [
  { name: 'IGMP-MY', url: 'https://kioskmy.best-in-asia.com' },
  { name: 'IGMP-SG', url: 'https://kiosksg.best-in-asia.com' },
];

const results = {};

for (const site of sites) {
  try {
    console.log(`\n━━━ ${site.name} ━━━`);

    // Use chromium with system Chrome (works on VDI)
    const browser = await chromium.launch({ headless: false, channel: 'chrome' });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    // Navigate to login page
    console.log('  Navigating to login page...');
    await page.goto(`${site.url}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // Try to find and fill login form
    console.log('  Looking for login form...');
    const usernameField = await page.locator('input[type="text"], input[name*="user"], input[name*="User"], input[id*="user"]').first();
    const passwordField = await page.locator('input[type="password"], input[name*="pass"], input[id*="pass"]').first();

    if (await usernameField.isVisible().catch(() => false)) {
      console.log('  Found login form, entering credentials...');
      await usernameField.fill(USERNAME);
      await page.waitForTimeout(500);

      await passwordField.fill(PASSWORD);
      await page.waitForTimeout(500);

      // Look for and click login button
      const loginBtn = await page.locator('button:has-text("Login"), button:has-text("Sign In"), button[type="submit"]').first();
      if (await loginBtn.isVisible().catch(() => false)) {
        console.log('  Clicking login button...');
        await loginBtn.click();
        await page.waitForTimeout(4000);
      }
    }

    // Navigate to Promotion Suite
    console.log('  Navigating to Promotion Suite...');
    await page.goto(`${site.url}#PM/PromotionSuite`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    // Try to find and click Promo Code tab
    console.log('  Looking for Promo Code section...');
    const promoLink = await page.locator('a[href*="PromoCode"], button:has-text("Promo Code"), span:has-text("Promo Code"), li:has-text("Promo Code")').first();
    if (await promoLink.isVisible().catch(() => false)) {
      console.log('  Found Promo Code link, clicking...');
      await promoLink.click();
      await page.waitForTimeout(2000);
    }

    // Scroll down to load all codes
    console.log('  Scrolling to load codes...');
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => {
        window.scrollBy(0, window.innerHeight);
      });
      await page.waitForTimeout(500);
    }

    // Extract all TLEO codes from page
    console.log('  Extracting TLEO codes...\n');
    const codes = await page.evaluate(() => {
      const allText = document.body.innerText;
      const codePattern = /[A-Z_]*TLEO[A-Z_0-9]*/g;
      const found = allText.match(codePattern) || [];
      // Remove duplicates and filter valid codes
      return [...new Set(found)].filter(c => c.length > 5 && c.includes('TLEO'));
    });

    results[site.name] = codes;
    console.log(`  Extracted ${codes.length} TLEO codes`);

    await browser.close();

  } catch (e) {
    console.error(`  ERROR: ${e.message.split('\n')[0]}`);
    results[site.name] = null;
  }
}

// Compare results
console.log('\n━━━ COMPARISON ━━━\n');
for (const [siteName, found] of Object.entries(results)) {
  if (!found) {
    console.log(`${siteName}: ERROR - could not extract codes`);
    continue;
  }

  const foundSet = new Set(found.map(c => String(c).trim()).filter(Boolean));
  const missing = [...canonicalCodes].filter(c => !foundSet.has(c));
  const extra = [...foundSet].filter(c => !canonicalCodes.has(c));

  console.log(`${siteName}: Found ${foundSet.size}/54 codes`);

  if (missing.length === 0) {
    console.log(`  ✓ All canonical codes present\n`);
  } else {
    console.log(`  MISSING (${missing.length}):`);
    missing.forEach(c => console.log(`    ✗ ${c}`));
    console.log('');
  }

  if (extra.length) {
    console.log(`  EXTRA (${extra.length}):`);
    extra.forEach(c => console.log(`    + ${c}`));
    console.log('');
  }
}

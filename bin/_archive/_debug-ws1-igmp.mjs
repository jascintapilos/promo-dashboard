#!/usr/bin/env node
// Debug script to examine page structure and find promo codes

import fs from 'node:fs';
import { chromium } from 'playwright';

const USERNAME = process.env.IGMP_USER;
const PASSWORD = process.env.IGMP_PASS;
if (!USERNAME || !PASSWORD) {
  console.error('Set IGMP_USER and IGMP_PASS env vars (see igmp-creds.local.json for the real values).');
  process.exit(1);
}

const browser = await chromium.launch({ headless: false, channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

console.log('Navigating to IGMP-MY...');
await page.goto('https://kioskmy.best-in-asia.com', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);

// Login
console.log('Logging in...');
const usernameField = await page.locator('input[placeholder="Username"]').or(page.locator('input[type="text"]')).first();
const passwordField = await page.locator('input[placeholder="Password"]').or(page.locator('input[type="password"]')).first();

console.log('Filling username...');
await usernameField.fill(USERNAME);
await page.waitForTimeout(500);

console.log('Filling password...');
await passwordField.fill(PASSWORD);
await page.waitForTimeout(500);

const loginBtn = await page.locator('button:has-text("Login")').first();
console.log('Clicking login button...');
await loginBtn.click();
await page.waitForTimeout(5000);

// Navigate to Promotion Suite
console.log('Navigating to Promotion Suite...');
await page.goto('https://kioskmy.best-in-asia.com#PM/PromotionSuite', { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

// Take screenshot
console.log('\nTaking screenshot...');
await page.screenshot({ path: 'debug-screenshot.png', fullPage: false });

// Get page content
const content = await page.content();
fs.writeFileSync('debug-page-content.html', content);

// Get text content
const text = await page.innerText('body');
fs.writeFileSync('debug-page-text.txt', text);

// Look for all elements that contain "TLEO"
console.log('\nSearching for elements with "TLEO"...');
const tleo_elements = await page.locator('text=/TLEO/i').all();
console.log(`Found ${tleo_elements.length} elements with "TLEO"`);

if (tleo_elements.length > 0) {
  console.log('First 10 TLEO elements:');
  for (let i = 0; i < Math.min(10, tleo_elements.length); i++) {
    const text = await tleo_elements[i].textContent();
    console.log(`  ${i+1}. ${text?.trim()}`);
  }
}

// Extract using multiple strategies
console.log('\nExtracting codes using multiple strategies...');

const codes1 = await page.evaluate(() => {
  const elems = Array.from(document.querySelectorAll('*')).filter(el => el.innerText?.includes('TLEO'));
  return elems.slice(0, 20).map(el => el.innerText?.trim());
});

console.log('Strategy 1 (DOM search):');
codes1.forEach((code, i) => {
  if (code && code.length < 100) console.log(`  ${i+1}. ${code}`);
});

const codes2 = await page.evaluate(() => {
  const pattern = /FT_REL_TLEO_[A-Z0-9_]+|REL_TLEO_[A-Z0-9_]+|FT_TLEO_[A-Z0-9_]+/g;
  const text = document.body.innerText;
  return [...new Set(text.match(pattern) || [])];
});

console.log(`\nStrategy 2 (Regex):`)
codes2.slice(0, 20).forEach((code, i) => {
  console.log(`  ${i+1}. ${code}`);
});

console.log('\nDebug files saved:');
console.log('  - debug-screenshot.png');
console.log('  - debug-page-content.html');
console.log('  - debug-page-text.txt');

await browser.close();

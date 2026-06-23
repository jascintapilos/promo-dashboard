import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const profile = JSON.parse(readFileSync(path.resolve('ft-profile-ws1.local.json'), 'utf8'));
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const ctx = await browser.newContext({ storageState: profile.storageState, viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

// Print stored WorkOS cookies
const cookies = profile.storageState?.cookies || [];
const workos = cookies.filter(c => c.domain.includes('signin.ft-crm') || c.domain.includes('workos'));
console.log('Stored WorkOS cookies:');
for (const c of workos) console.log(`  ${c.name} | domain=${c.domain} | expires=${c.expires}`);

// Try WorkOS user management paths
const paths = [
  'https://signin.ft-crm.com/user_management',
  'https://signin.ft-crm.com/user_management/factors',
  'https://signin.ft-crm.com/user_management/factors/totp',
  'https://signin.ft-crm.com/user_management/mfa',
  'https://signin.ft-crm.com/account',
  'https://signin.ft-crm.com/profile',
  'https://signin.ft-crm.com/security',
  'https://signin.ft-crm.com/settings',
];

console.log('\nProbing WorkOS paths with stored session:');
for (const url of paths) {
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 12000 });
    await page.waitForTimeout(1500);
    const finalUrl = page.url();
    const text = (await page.evaluate(() => document.body.innerText).catch(() => '')).replace(/\s+/g,' ').slice(0,200);
    const statusEl = await page.$('[data-status]').catch(() => null);
    console.log(`\n  ${url}`);
    console.log(`  → ${finalUrl}`);
    console.log(`  text: ${text}`);
  } catch(e) {
    console.log(`  ${url} → ERR: ${e.message.slice(0,60)}`);
  }
}

await browser.close();

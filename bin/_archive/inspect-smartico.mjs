// Read-only Smartico inspection. Uses email + password (or env vars).
//   set SM_EMAIL=... & set SM_PASSWORD=... & node inspect-smartico.mjs
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const OUT = path.resolve('captures/smartico');
const SM_URL = 'https://drive-6.smartico.ai/24016#/login';
const EMAIL = process.env.SM_EMAIL;
const PASSWORD = process.env.SM_PASSWORD;

if (!EMAIL || !PASSWORD) { console.error('Need SM_EMAIL and SM_PASSWORD'); process.exit(2); }

async function snap(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`📸 ${file}  ←  ${page.url()}`);
}

async function dumpNav(page, label) {
  const links = await page.evaluate(() => {
    const els = [...document.querySelectorAll('a, [role="link"], [role="menuitem"], nav button')]
      .map((el) => ({
        text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80),
        href: el.getAttribute('href') || '',
        cls: (el.className || '').toString().slice(0, 50),
      }))
      .filter((l) => l.text && l.text.length > 1);
    const seen = new Set();
    return els.filter((l) => { const k = l.text + '|' + l.href; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 80);
  });
  console.log(`\n=== ${label} nav (${links.length}) ===`);
  for (const l of links) console.log(`  ${l.text.padEnd(50)}  ${l.href}`);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    locale: 'en-GB',
  });
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  const page = await ctx.newPage();

  console.log(`→ ${SM_URL}`);
  await page.goto(SM_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await snap(page, '00-login');

  // Probe login form
  const inputs = await page.evaluate(() => [...document.querySelectorAll('input, button')].map((el) => ({
    tag: el.tagName, type: el.type || '', name: el.name || '', id: el.id || '', placeholder: el.placeholder || '',
    text: (el.textContent || '').trim().slice(0, 30), visible: el.offsetParent !== null,
  })).filter((e) => e.visible));
  console.log('\nlogin form inputs:');
  for (const i of inputs) console.log(' ', JSON.stringify(i));

  // Fill email + password — try sensible selectors
  const emailField = page.locator('input[type="email"], input[name="email" i], input[name="username" i], input[placeholder*="mail" i], input[placeholder*="user" i]').first();
  await emailField.waitFor({ timeout: 10000 });
  await emailField.fill(EMAIL);

  const pwdField = page.locator('input[type="password"]').first();
  await pwdField.waitFor({ timeout: 10000 });
  await pwdField.fill(PASSWORD);

  await snap(page, '01-credentials-filled');

  // Submit
  await page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Login"), button:has-text("Log in")').first().click();
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(3000);
  await snap(page, '02-after-login');
  console.log(`after login URL: ${page.url()}`);

  // If MFA / 2FA appears, screenshot and exit
  const mfa = await page.locator('text=/code|verification|authenticator|2FA|two factor/i').first().isVisible().catch(() => false);
  if (mfa) {
    console.log('MFA / 2FA screen detected — stopping');
    await snap(page, '03-mfa-blocked');
    await ctx.storageState({ path: path.join(OUT, 'storage-state.json') });
    await ctx.close();
    await browser.close();
    return;
  }

  await dumpNav(page, 'post-login');

  // Try common Smartico routes
  const routes = ['#/campaigns', '#/journeys', '#/audience', '#/segments', '#/templates', '#/templates/sms', '#/templates/wa', '#/campaigns/list'];
  for (const r of routes) {
    try {
      await page.goto(`https://drive-6.smartico.ai/24016${r}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2000);
      await snap(page, `route-${r.replace(/[^a-z0-9]/gi, '_')}`);
    } catch (e) { console.log(`route ${r} failed: ${e.message}`); }
  }

  await ctx.storageState({ path: path.join(OUT, 'storage-state.json') });
  console.log(`\nsession saved → ${path.join(OUT, 'storage-state.json')}`);
  await ctx.close();
  await browser.close();
}

main().catch((e) => { console.error('FAIL:', e); process.exit(1); });

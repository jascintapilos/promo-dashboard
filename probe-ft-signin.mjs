// Probe the FT SSO page to see actual form layout.
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const OUT = path.resolve('captures/ft-ws1');
const EMAIL = process.env.FT_EMAIL;

async function dump(page, label) {
  await page.screenshot({ path: path.join(OUT, `probe-${label}.png`), fullPage: true });
  const html = await page.content();
  await writeFile(path.join(OUT, `probe-${label}.html`), html);
  const inputs = await page.evaluate(() => [...document.querySelectorAll('input, button')].map((el) => ({
    tag: el.tagName,
    type: el.type,
    name: el.name,
    id: el.id,
    placeholder: el.placeholder,
    text: (el.textContent || '').trim().slice(0, 40),
    visible: el.offsetParent !== null,
  })));
  console.log(`\n=== ${label} @ ${page.url()} ===`);
  for (const i of inputs) console.log(' ', JSON.stringify(i));
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  await page.goto('https://mb8.ft-crm.com/', { waitUntil: 'domcontentloaded' });
  const popupPromise = ctx.waitForEvent('page', { timeout: 15000 });
  await page.locator('button:has-text("Login")').first().click();
  const popup = await popupPromise;
  await popup.waitForLoadState('domcontentloaded');
  await popup.waitForLoadState('networkidle').catch(() => {});

  await dump(popup, 'step1-email-page');

  // Fill email & try every plausible submit
  await popup.locator('input').first().fill(EMAIL);
  await popup.waitForTimeout(300);
  await dump(popup, 'step2-email-filled');

  // Try pressing Enter
  await popup.keyboard.press('Enter');
  await popup.waitForTimeout(3000);
  await dump(popup, 'step3-after-enter');

  await ctx.close();
  await browser.close();
}

main().catch((e) => { console.error('FAIL:', e); process.exit(1); });

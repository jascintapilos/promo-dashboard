import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const INSTANCE = process.argv[2] || 'ws1';
const INSTANCES = {
  ws1:   'https://mb8.ft-crm.com/',
  qpro1: 'https://alpha-iota-qp1.ft-crm.com/',
  qp2:   'https://alpha-iota-qp2.ft-crm.com/v2/',
};

const profileFile = path.resolve(`ft-profile-${INSTANCE}.local.json`);
if (!existsSync(profileFile)) { console.log('No profile — run setup first'); process.exit(1); }
const profile = JSON.parse(readFileSync(profileFile, 'utf8'));

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const ctx = await browser.newContext({ storageState: profile.storageState, viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const base = INSTANCES[INSTANCE];
const host = new URL(base).hostname;

// Navigate to main app — wait for SSO chain then React to render
await page.goto(base, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(6000);
console.log('Landing URL:', page.url());

// Click each icon-only button and check what appears (looking for account/profile menu)
const iconBtns = await page.$$('.ft-button--icon-only-medium');
console.log(`\nFound ${iconBtns.length} icon-only buttons — clicking each:`);

for (let i = 0; i < iconBtns.length; i++) {
  // Navigate back to base to reset state
  await page.goto(base, { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(3000);

  const btns = await page.$$('.ft-button--icon-only-medium');
  if (!btns[i]) continue;

  // Get button position (to tell which one is where)
  const box = await btns[i].boundingBox().catch(() => null);
  console.log(`\n  Button ${i}: position x=${box?.x?.toFixed(0)} y=${box?.y?.toFixed(0)}`);

  await btns[i].click().catch(() => {});
  await page.waitForTimeout(2000);

  const newUrl = page.url();
  const popupText = (await page.evaluate(() => document.body.innerText).catch(() => ''))
    .replace(/\s+/g,' ').slice(0, 300);
  console.log(`    URL after click: ${newUrl}`);
  console.log(`    New content: ${popupText.slice(0, 200)}`);

  // Check for any new visible modal/dropdown/panel
  const newLinks = await page.$$eval('a', els => els.map(e => ({
    text: (e.innerText||'').trim().slice(0,40),
    href: e.getAttribute('href')||'',
  })).filter(e => e.text || e.href));
  const interesting = newLinks.filter(l =>
    /account|profile|security|mfa|auth|password|setting|logout|sign.?out/i.test(l.text + l.href)
  );
  if (interesting.length) console.log(`    ★ Interesting links:`, interesting);
}

await browser.close();

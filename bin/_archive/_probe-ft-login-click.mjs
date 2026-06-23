import { chromium } from 'playwright';

const b = await chromium.launch({ headless: true, channel: 'chrome' });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();

// Capture all navigation events
p.on('request', req => {
  if (req.resourceType() === 'document') console.log('→ navigate:', req.url().slice(0, 100));
});

await p.goto('https://mb8.ft-crm.com/', { waitUntil: 'networkidle', timeout: 20000 });
await p.waitForTimeout(2000);
console.log('Before click URL:', p.url());

const btn = await p.$('button:has-text("Login")');
if (btn) {
  console.log('Found Login button, clicking...');
  await btn.click();
  await p.waitForTimeout(6000);
  console.log('After click URL:', p.url());
  const inputs = await p.$$eval('input', els => els.map(e => 'type=' + e.type + ' name=' + e.name + ' placeholder=' + e.placeholder));
  console.log('Inputs after click:', inputs);
} else {
  console.log('Login button not found');
}

await b.close();

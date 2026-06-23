import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

page.on('request', req => { if (req.resourceType() === 'document') console.log('→', req.url().slice(0, 100)); });

await page.goto('https://alpha-iota-qp1.ft-crm.com/', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(3000);
console.log('Final URL:', page.url());

const btns = await page.$$eval('button, input, a', els => els.map(e => ({
  tag: e.tagName, type: e.type||'', text: (e.innerText||'').trim().slice(0,40),
  placeholder: e.placeholder||'', href: e.getAttribute('href')||'',
})).filter(e => e.text || e.placeholder || e.href));
console.log('Buttons/inputs:', JSON.stringify(btns, null, 2));

await browser.close();

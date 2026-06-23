import { chromium } from 'playwright';

const b = await chromium.launch({ headless: true, channel: 'chrome' });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();

await p.goto('https://mb8.ft-crm.com/', { waitUntil: 'networkidle', timeout: 20000 });
await p.waitForTimeout(3000);
console.log('URL:', p.url());

const btns = await p.$$eval('button, a', els => els.map(e =>
  e.tagName + ' | ' + (e.textContent || '').trim().slice(0, 40) + ' | href=' + (e.getAttribute('href') || '')
));
console.log('\nButtons / links:');
for (const b of btns.slice(0, 20)) console.log(' ', b);

const inputs = await p.$$eval('input', els => els.map(e =>
  'type=' + e.type + ' name=' + e.name + ' placeholder=' + e.placeholder
));
console.log('\nInputs:');
for (const i of inputs) console.log(' ', i);

await b.close();

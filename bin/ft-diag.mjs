import { getCdpWsUrl } from './_cdp-url.js';
import { chromium } from 'playwright';

const cdpWs = await getCdpWsUrl();
const browser = await chromium.connectOverCDP(cdpWs);
const ftPage = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes('mb8.ft-crm.com'));
if (!ftPage) { console.log('No FT page open'); await browser.close().catch(()=>{}); process.exit(1); }
console.log('Tab:', ftPage.url());

const result = await ftPage.evaluate(async () => {
  const pt = document.cookie.split(';').map(c=>c.trim()).find(c=>c.startsWith('portaltoken='));
  const token = pt ? pt.split('=').slice(1).join('=') : null;

  // Try several candidate API paths to find the right one
  const paths = [
    '/crm-api/Authentication/AdminUsers',
    '/v2/crm-api/Authentication/AdminUsers',
    '/api/crm-api/Authentication/AdminUsers',
  ];
  const results = {};
  for (const p of paths) {
    const r = await fetch(p, {
      credentials: 'include',
      headers: { authtoken: token, Accept: 'application/json', 'Content-Type': 'application/json' }
    });
    const ct = r.headers.get('content-type') || '';
    const body = await r.text();
    results[p] = { status: r.status, ct: ct.slice(0,40), bodyFirst100: body.slice(0,100) };
  }
  // Also check what XMLHttpRequests the page itself is making (check performance entries)
  const xhrPaths = performance.getEntriesByType('resource')
    .filter(e => e.name.includes('crm-api'))
    .map(e => e.name)
    .slice(0, 5);
  return { tokenFirst4: token ? token.slice(0,4) : null, results, xhrPaths };
});
console.log(JSON.stringify(result, null, 2));
await browser.close().catch(()=>{});

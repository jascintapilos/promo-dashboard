// Probe: list WS1 MY promos with PromotionType:'' (ALL types incl. FreeCredit)
// and report duplicate PromotionNames, flagging active-vs-active collisions.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const BASE = 'http://kioskmy.nougatsage.com';
const store = JSON.parse(readFileSync(path.resolve('igmp-sessions.local.json'), 'utf8'));
const saved = store.sessions?.['ws1-v3-my'];
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const ctx = await browser.newContext();
await ctx.addCookies(saved.cookies.filter((c) => c.name && c.value && c.domain));

const all = [];
for (let pg = 1; pg <= 60; pg++) {
  const res = await ctx.request.post(`${BASE}/PM/GetPromotionsList?pageNum=${pg}&rowPerPage=200`, {
    headers: { 'Content-Type': 'application/json; charset=utf-8', Accept: 'application/json, text/plain, */*' },
    data: { PromotionCode: '', PromotionName: '', PromotionType: '', IsActive: '', IsPublished: '' },
  });
  const data = JSON.parse(await res.text());
  const rows = data?.data || [];
  if (!rows.length) break;
  all.push(...rows);
  if (rows.length < 200) break;
}
console.log(`all-type promos: ${all.length}`);

const isActive = (p) => { const v = p.IsActive ?? p.Active ?? p.Status; return v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true'; };
const byName = new Map();
for (const p of all) {
  const n = (p.PromotionName || '').trim();
  (byName.get(n) || byName.set(n, []).get(n)).push(p);
}
const dups = [...byName.entries()].filter(([, l]) => l.length > 1);
console.log(`duplicate name groups (all types): ${dups.length}`);
let activeDupGroups = 0;
for (const [name, lst] of dups) {
  const act = lst.filter(isActive);
  const tag = act.length > 1 ? ' ⚠ ACTIVE×' + act.length : '';
  if (act.length > 1) activeDupGroups++;
  console.log(`  "${name}" ×${lst.length}${tag}`);
  for (const p of lst) console.log(`      id=${p.PromotionId} active=${isActive(p) ? 'Y' : 'n'} type=${p.PromotionType ?? p.Type ?? '?'}  ${(p.PromotionCode || '').trim()}`);
}
console.log(`\ngroups duplicated among ACTIVE rows: ${activeDupGroups}`);
await browser.close();

#!/usr/bin/env node
// Read-only sweep of WS1/WS2 (IGMP): promos CREATED or EDITED 2026-06-01..06-07.
// List endpoint has null audit fields, so we fetch per-promo detail to read
// LogTimeStamp (created) + ModifiedTimeStamp (edited). DD-MM-YYYY HH:MM:SS.
// Scope: PromotionType=0 (Bonus = Deposit/FC/FS). Sms/LuckyDraw excluded.
// Usage: node bin/_scan-igmp-changes-lastweek.mjs

import { igmpPost, listIgmpSites } from '../src/igmp-client.js';
import { writeFileSync } from 'node:fs';

const FROM = '2026-06-01', TO = '2026-06-07';
const BRAND = (s) => (s === 'ws2' ? 'WS2' : 'WS1');
// "08-06-2026 10:41:53" -> "2026-06-08"
const ymd = (ts) => {
  if (!ts || typeof ts !== 'string') return null;
  const m = ts.match(/^(\d{2})-(\d{2})-(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};
const inWin = (d) => d && d >= FROM && d <= TO;

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  }));
  return out;
}

async function detail(siteId, id) {
  for (const ep of ['/PM/GetBonusInfo', '/PM/GetFreeCreditInfo', '/PM/GetFreeSpinPromotionInfo']) {
    try {
      const d = await igmpPost(siteId, ep, { PromotionId: id });
      const p = d?.data?.Promotion || d?.data || {};
      if (p.ModifiedTimeStamp || p.LogTimeStamp) return { p, ep };
    } catch { /* try next */ }
  }
  return { p: {}, ep: null };
}

const results = [];
for (const siteId of listIgmpSites()) {
  process.stdout.write(`Scanning ${siteId} … `);
  try {
    // 1. list all Type-0 promos (cheap)
    const list = [];
    let page = 1;
    while (true) {
      const r = await igmpPost(siteId, `/PM/GetPromotionsList?pageNum=${page}&rowPerPage=200`,
        { PromotionCode: '', PromotionName: '', PromotionType: 0, IsActive: '', IsPublished: '' });
      const rows = r?.data || [];
      if (!rows.length) break;
      list.push(...rows);
      if (rows.length < 200) break;
      page++;
    }
    // 2. detail per promo to read change dates
    let hits = 0;
    await mapLimit(list, 10, async (p) => {
      const { p: det, ep } = await detail(siteId, p.PromotionId);
      const created = ymd(det.LogTimeStamp);
      const modified = ymd(det.ModifiedTimeStamp);
      const cHit = inWin(created), mHit = inWin(modified);
      if (cHit || mHit) {
        hits++;
        results.push({
          siteId, brand: BRAND(siteId), id: p.PromotionId, code: p.PromotionCode,
          name: p.PromotionName, active: p.IsActive,
          created_at: det.LogTimeStamp || null, modified_at: det.ModifiedTimeStamp || null,
          modified_by: det.ModifiedBy?.ActorLogin || null,
          created_by: det.CreatedBy?.ActorLogin || null,
          kind: cHit ? 'created' : 'edited', via: ep,
        });
      }
    });
    process.stdout.write(`${list.length} promos, ${hits} in window\n`);
  } catch (err) {
    process.stdout.write(`ERROR: ${err.message.slice(0, 120)}\n`);
  }
}

const bySite = {};
for (const r of results) (bySite[r.siteId] = bySite[r.siteId] || []).push(r);
console.log('\n════════════════════════════════════════════════════════════');
console.log(`  WS1/WS2 PROMO CHANGES ${FROM} .. ${TO}  (Type-0 Bonus/FC/FS)`);
console.log('════════════════════════════════════════════════════════════');
for (const s of Object.keys(bySite).sort()) {
  const rows = bySite[s].sort((a, b) => (b.modified_at < a.modified_at ? -1 : 1));
  console.log(`\n${s} [${rows[0].brand}] (${rows.length})`);
  for (const r of rows) {
    const tag = r.kind === 'created' ? 'NEW ' : 'EDIT';
    console.log(`  [${tag}] ${r.active ? '🟢' : '⚫'} id=${String(r.id).padEnd(6)} cr:${(r.created_at||'').slice(0,10)} mod:${(r.modified_at||'').slice(0,10)} by:${(r.modified_by||r.created_by||'?').padEnd(12)} ${r.code}`);
  }
}
const codes = [...new Set(results.map((r) => r.code))];
const newN = results.filter((r) => r.kind === 'created').length;
console.log(`\nTOTAL: ${results.length} record(s) (NEW ${newN}, EDIT ${results.length - newN}), ${codes.length} distinct code(s)\n`);
writeFileSync('captures/igmp-changes-lastweek.json', JSON.stringify(results, null, 2));
console.log('Saved → captures/igmp-changes-lastweek.json');

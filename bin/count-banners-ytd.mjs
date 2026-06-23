/**
 * Count YTD 2026 banners across QPRO + QP2 BOs (api-client.js platform).
 * Parallel to count-promos-ytd.mjs but for banners.
 *
 * Output: per-brand count + total.
 */
import { authedFetch } from '../src/api-client.js';
import { QP2_BRAND_TO_IDS } from '../src/api-mapper-qp2.js';

const YEAR = '2026';
const SLEEP_MS = 350;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getAllBanners(siteId, { merchantId } = {}) {
  const all = [];
  let page = 1, lastPage = 1;
  do {
    const params = new URLSearchParams({
      perPage: '200', page: String(page), status: '1',
      sort_by: 'id', sort_order: 'desc',
    });
    if (merchantId != null) params.set('merchant_id', String(merchantId));
    const res = await authedFetch(siteId, `/api/bo/banner?${params}`);
    all.push(...(res.data?.rows || []));
    lastPage = res.data?.paginations?.last_page || 1;
    page++;
  } while (page <= lastPage);
  return all;
}

console.log(`Counting YTD ${YEAR} banners across 17 QPRO + QP2 (4 merchants, de-duped)...\n`);
const brandTotals = {};
let grandQpro = 0;

// QPRO 1–17
for (let i = 1; i <= 17; i++) {
  const brand = `QPRO${i}`;
  process.stdout.write(`  ${brand.padEnd(8)} `);
  try {
    const banners = await getAllBanners(`qpro${i}`);
    const ytd = banners.filter(b => b.created_at?.startsWith(YEAR));
    brandTotals[brand] = ytd.length;
    grandQpro += ytd.length;
    process.stdout.write(`→ ${String(ytd.length).padStart(4)} banners (${banners.length} total on BO)\n`);
  } catch (e) {
    process.stdout.write(`→ ERROR ${e.message.substring(0, 60)}\n`);
    brandTotals[brand] = 0;
  }
  await sleep(SLEEP_MS);
}

// QP2 — 4 merchants on ibc22, dedupe by banner.label + created_at
process.stdout.write(`  QP2      `);
let qp2Count = 0;
try {
  const seen = new Set();
  for (const [brand, ids] of Object.entries(QP2_BRAND_TO_IDS)) {
    const banners = await getAllBanners('ibc22', { merchantId: ids.merchantId });
    for (const b of banners) {
      if (!b.created_at?.startsWith(YEAR)) continue;
      const key = `${b.label}|${b.created_at}`;
      if (!seen.has(key)) { seen.add(key); qp2Count++; }
    }
    await sleep(SLEEP_MS);
  }
  brandTotals['QP2 (de-duped)'] = qp2Count;
  process.stdout.write(`→ ${String(qp2Count).padStart(4)} unique banners\n`);
} catch (e) {
  process.stdout.write(`→ ERROR ${e.message.substring(0, 60)}\n`);
}

const total = grandQpro + qp2Count;
console.log('\n┌──────────────────┬───────┐');
console.log('│ Brand            │ Count │');
console.log('├──────────────────┼───────┤');
for (const [b, n] of Object.entries(brandTotals)) {
  console.log(`│ ${b.padEnd(16)} │ ${String(n).padStart(5)} │`);
}
console.log('├──────────────────┼───────┤');
console.log(`│ ${'TOTAL'.padEnd(16)} │ ${String(total).padStart(5)} │`);
console.log('└──────────────────┴───────┘');

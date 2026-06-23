#!/usr/bin/env node
// QC T&C for ALL TLEO codes on WS1 MY + SG.
// For each code found: check T&C locales present + clause 3 text.
// Flags codes whose clause 3 is outdated (generic all-games or missing).

import { igmpPost } from '../src/igmp-client.js';

const SITES = [
  { siteId: 'ws1-v3-my', label: 'WS1 MY' },
  { siteId: 'ws1-v3-sg', label: 'WS1 SG' },
];

// Fetch all pages of TLEO promotions from GetPromotionsList
async function fetchAllTleo(siteId) {
  const all = [];
  let page = 1;
  const pageSize = 100;

  while (true) {
    const res = await igmpPost(siteId, `/PM/GetPromotionsList?pageNum=${page}&rowPerPage=${pageSize}`, {
      PromotionCode: 'FT_REL_TLEO',
      PromotionName: '',
      PromotionType: 0,
      IsActive: '',
      IsPublished: '',
    });
    const rows = res?.data || [];
    all.push(...rows);
    const total = res?.recordsFiltered ?? res?.recordsTotal ?? rows.length;
    if (all.length >= total || rows.length < pageSize) break;
    page++;
  }
  return all;
}

// Expected clause 3 text based on code naming convention:
//   _LC_ in code or _LC suffix → LC only → "excluding Blackjack"
//   _SL_ in code or _SLOT suffix → Slots only → "excluding Arcade and Table games"
//   anything else → all game categories → "excluding Blackjack and Virtual Sports"
function expectedClause3(code) {
  if (/_LC_/.test(code) || /_LC$/.test(code)) {
    return 'This promotion is valid for Live Casino only (excluding Blackjack).';
  }
  if (/_SL_/.test(code) || /_SLOT$/.test(code)) {
    return 'This promotion is valid for Slots only (excluding Arcade and Table games).';
  }
  return 'This promotion is valid across all game categories (excluding Blackjack and Virtual Sports).';
}

const report = [];   // { site, code, promoId, rewardId, locales, clause3, expected, ok }

for (const site of SITES) {
  process.stdout.write(`\nFetching all TLEO codes on ${site.label}...`);
  const promos = await fetchAllTleo(site.siteId);
  console.log(` ${promos.length} found`);

  for (const promo of promos) {
    const promoId = promo.PromotionId;
    const code    = promo.PromotionCode;

    // Get RewardId via GetBonusInfo
    let rewardId = null;
    try {
      const bi = await igmpPost(site.siteId, '/PM/GetBonusInfo', { PromotionId: promoId });
      rewardId = bi?.data?.Promotion?.PromotionRewards?.[0]?.RewardId ?? null;
    } catch {}

    if (!rewardId) {
      report.push({ site: site.siteId, code, promoId, rewardId: null, locales: '-', clause3: '-', ok: false });
      continue;
    }

    // Fetch T&C contents
    let locales = '-', clause3 = '-', ok = false;
    try {
      const ct  = await igmpPost(site.siteId, '/PM/GetPromotionRewardContents', { RewardId: rewardId });
      const rows = Array.isArray(ct?.data) ? ct.data : [];
      locales = rows.map((r) => r.Locale).join(',') || 'empty';

      const enRow = rows.find((r) => r.Locale === 'en');
      if (enRow?.Content) {
        // Extract clause 3 text
        const m = enRow.Content.match(/3\. ([^<]+)/);
        clause3 = m ? m[1].trim() : '(no clause 3)';
        // Check exact expected exclusion based on code name
        ok = clause3.trim() === expectedClause3(code);
      } else {
        clause3 = '(no EN content)';
      }
    } catch (e) {
      clause3 = `ERR: ${e.message.slice(0, 60)}`;
    }

    report.push({ site: site.siteId, code, promoId, rewardId, locales, clause3, ok });
  }
}

// ── Print results ────────────────────────────────────────────────────────────

const allOk    = report.filter((r) => r.ok);
const notOk    = report.filter((r) => !r.ok);

console.log(`\n${'═'.repeat(110)}`);
console.log(`  TLEO T&C QC  —  ${allOk.length} correct / ${notOk.length} need update / ${report.length} total`);
console.log('═'.repeat(110));

if (notOk.length) {
  console.log('\n⚠  NEEDS UPDATE:');
  console.log('Site'.padEnd(12) + 'PID'.padEnd(7) + 'Code'.padEnd(42) + 'Locales'.padEnd(8) + 'Clause 3');
  console.log('─'.repeat(110));
  for (const r of notOk) {
    console.log(
      r.site.padEnd(12) +
      String(r.promoId ?? '-').padEnd(7) +
      r.code.padEnd(42) +
      r.locales.padEnd(8) +
      r.clause3.slice(0, 60),
    );
  }
}

console.log('\n✓  CORRECT:');
console.log('Site'.padEnd(12) + 'PID'.padEnd(7) + 'Code'.padEnd(42) + 'Locales'.padEnd(8) + 'Clause 3');
console.log('─'.repeat(110));
for (const r of allOk) {
  console.log(
    r.site.padEnd(12) +
    String(r.promoId).padEnd(7) +
    r.code.padEnd(42) +
    r.locales.padEnd(8) +
    r.clause3.slice(0, 60),
  );
}

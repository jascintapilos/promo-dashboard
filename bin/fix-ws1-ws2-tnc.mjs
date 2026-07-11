// Fix two T&C errors in WS1/WS2 FC promos P061-P064:
//   1. Clause 1 says "one (1) day" but ExpiryMinutes=4320 = 3 days → fix to "three (3) days"
//   2. Clause 3 says "excluding Blackjack and Virtual Sports" — no category restriction is
//      configured; remove the clause and renumber 4→3, 5→4.
//
// Usage:
//   node bin/fix-ws1-ws2-tnc.mjs [--dry-run]

import { igmpPost } from '../src/igmp-client.js';

const DRY_RUN = process.argv.includes('--dry-run');

// 12 targets from bundles — (handle, brand, site, promo_id, reward_id)
const TARGETS = [
  { handle:'P061-r62', brand:'WS1_MY',  site:'ws1-v3-my', promo_id:3807,  reward_id:15346 },
  { handle:'P061-r62', brand:'WS1_SG',  site:'ws1-v3-sg', promo_id:2951,  reward_id:13129 },
  { handle:'P061-r62', brand:'WS2',     site:'ws2',       promo_id:2639,  reward_id:10616 },
  { handle:'P062-r63', brand:'WS1_MY',  site:'ws1-v3-my', promo_id:3808,  reward_id:15347 },
  { handle:'P062-r63', brand:'WS1_SG',  site:'ws1-v3-sg', promo_id:2952,  reward_id:13130 },
  { handle:'P062-r63', brand:'WS2',     site:'ws2',       promo_id:2640,  reward_id:10617 },
  { handle:'P063-r64', brand:'WS1_MY',  site:'ws1-v3-my', promo_id:3809,  reward_id:15348 },
  { handle:'P063-r64', brand:'WS1_SG',  site:'ws1-v3-sg', promo_id:2953,  reward_id:13131 },
  { handle:'P063-r64', brand:'WS2',     site:'ws2',       promo_id:2641,  reward_id:10618 },
  { handle:'P064-r65', brand:'WS1_MY',  site:'ws1-v3-my', promo_id:3810,  reward_id:15349 },
  { handle:'P064-r65', brand:'WS1_SG',  site:'ws1-v3-sg', promo_id:2954,  reward_id:13132 },
  { handle:'P064-r65', brand:'WS2',     site:'ws2',       promo_id:2642,  reward_id:10619 },
];

// ── HTML fixers ──────────────────────────────────────────────────────────────

function fixEN(html) {
  // Fix 1: "one (1) day" → "three (3) days"
  let out = html.replace(/one \(1\) day/g, 'three (3) days');
  // Fix 2: remove clause 3 (Blackjack/Virtual Sports) entirely and renumber 4→3, 5→4
  out = out.replace(
    /<p style="text-align: left;"><font color="#555555">3\. This promotion is valid across all game categories \(excluding Blackjack and Virtual Sports\)\.<\/font><\/p>/g,
    ''
  );
  out = out.replace(
    /<p style="text-align: left;"><font color="#555555">4\. Promotion/g,
    '<p style="text-align: left;"><font color="#555555">3. Promotion'
  );
  out = out.replace(
    /<p style="text-align: left;"><font color="#555555">5\. General/g,
    '<p style="text-align: left;"><font color="#555555">4. General'
  );
  return out;
}

function fixZH(html) {
  // Fix 1: "1 天内有效" → "3 天内有效"
  let out = html.replace(/1 天内有效/g, '3 天内有效');
  // Fix 2: remove clause 3 (Blackjack/Virtual Sports) and renumber 4→3, 5→4
  out = out.replace(
    /<p style="text-align: left;"><font color="#555555">3\. 本优惠适用于所有游戏类别（二十一点和虚拟体育除外）。<\/font><\/p>/g,
    ''
  );
  out = out.replace(
    /<p style="text-align: left;"><font color="#555555">4\. 优惠码/g,
    '<p style="text-align: left;"><font color="#555555">3. 优惠码'
  );
  out = out.replace(
    /<p style="text-align: left;"><font color="#555555">5\. 适用/g,
    '<p style="text-align: left;"><font color="#555555">4. 适用'
  );
  return out;
}

function applyFixes(html, locale) {
  if (locale === 'en') return fixEN(html);
  if (locale === 'zh') return fixZH(html);
  return html;
}

// ── Main loop ────────────────────────────────────────────────────────────────

let passed = 0, failed = 0;

for (const t of TARGETS) {
  const label = `${t.handle} | ${t.brand} | reward_id=${t.reward_id}`;

  // GET current T&C rows
  const getRes = await igmpPost(t.site, '/PM/GetPromotionRewardContents', { RewardId: t.reward_id });
  const rows = Array.isArray(getRes?.data) ? getRes.data : [];
  if (!rows.length) {
    console.error(`  ✗ ${label} — GetPromotionRewardContents returned no rows`);
    failed++;
    continue;
  }

  // Apply fixes to each locale row
  let anyChange = false;
  const fixedRows = rows.map(row => {
    const fixed = applyFixes(row.Content || '', row.Locale);
    if (fixed !== row.Content) anyChange = true;
    return { ...row, Content: fixed };
  });

  if (!anyChange) {
    console.log(`  ✓ ${label} — already clean, no change needed`);
    passed++;
    continue;
  }

  // Show what changes for each locale
  rows.forEach((row, i) => {
    if (row.Content !== fixedRows[i].Content) {
      const wasDay = row.Content.match(/one \(1\) day|1 天内有效/) ? 'expiry-clause' : '';
      const wasBlack = row.Content.match(/Blackjack|二十一点/) ? 'blackjack-clause' : '';
      const tags = [wasDay, wasBlack].filter(Boolean).join('+');
      console.log(`  ~ ${label} | locale=${row.Locale} | fixes: ${tags}`);
    }
  });

  if (DRY_RUN) {
    console.log(`  DRY-RUN: would PUT ${fixedRows.length} locale(s)`);
    continue;
  }

  // PUT corrected content
  const putRes = await igmpPost(t.site, '/PM/BulkAddorUpdatePromotionRewardContents', {
    RewardId: t.reward_id,
    PromotionRewardContents: fixedRows.map(r => ({
      Locale:                r.Locale,
      PromotionRewardName:   r.PromotionRewardName || '',
      Content:               r.Content,
    })),
  });

  if (!putRes?.success) {
    console.error(`  ✗ ${label} — PUT failed: ${JSON.stringify(putRes)}`);
    failed++;
    continue;
  }

  // Verify
  const verRes = await igmpPost(t.site, '/PM/GetPromotionRewardContents', { RewardId: t.reward_id });
  const verRows = Array.isArray(verRes?.data) ? verRes.data : [];
  const enRow = verRows.find(r => r.Locale === 'en');
  const stillBadDay   = enRow?.Content?.includes('one (1) day');
  const stillBlackjack = enRow?.Content?.includes('Blackjack');

  if (stillBadDay || stillBlackjack) {
    const issues = [stillBadDay && 'expiry still "one (1) day"', stillBlackjack && 'Blackjack clause still present'].filter(Boolean);
    console.error(`  ✗ ${label} — verify FAIL: ${issues.join(', ')}`);
    failed++;
  } else {
    console.log(`  ✓ ${label} — fixed and verified`);
    passed++;
  }
}

console.log(`\nDone: ${passed} fixed/ok, ${failed} failed`);
if (failed) process.exit(1);

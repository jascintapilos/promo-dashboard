// Restore clause 3 (Blackjack/Virtual Sports exclusion — turnover eligibility notice)
// that was incorrectly removed in fix-ws1-ws2-tnc.mjs.
//
// The clause is needed so players know these categories don't count toward the
// turnover requirement (manual calc). Current state after prior fix:
//   1. three (3) days  ← correct (keep)
//   2. claim once
//   3. Promotion codes time-limited   ← was clause 4
//   4. General T&C apply             ← was clause 5
//
// After this script:
//   1. three (3) days
//   2. claim once
//   3. excluding Blackjack and Virtual Sports  ← restored
//   4. Promotion codes time-limited
//   5. General T&C apply
//
// Usage:
//   node bin/fix-ws1-ws2-tnc-restore-clause3.mjs [--dry-run]

import { igmpPost } from '../src/igmp-client.js';

const DRY_RUN = process.argv.includes('--dry-run');

const TARGETS = [
  { handle:'P061-r62', brand:'WS1_MY',  site:'ws1-v3-my', reward_id:15346 },
  { handle:'P061-r62', brand:'WS1_SG',  site:'ws1-v3-sg', reward_id:13129 },
  { handle:'P061-r62', brand:'WS2',     site:'ws2',       reward_id:10616 },
  { handle:'P062-r63', brand:'WS1_MY',  site:'ws1-v3-my', reward_id:15347 },
  { handle:'P062-r63', brand:'WS1_SG',  site:'ws1-v3-sg', reward_id:13130 },
  { handle:'P062-r63', brand:'WS2',     site:'ws2',       reward_id:10617 },
  { handle:'P063-r64', brand:'WS1_MY',  site:'ws1-v3-my', reward_id:15348 },
  { handle:'P063-r64', brand:'WS1_SG',  site:'ws1-v3-sg', reward_id:13131 },
  { handle:'P063-r64', brand:'WS2',     site:'ws2',       reward_id:10618 },
  { handle:'P064-r65', brand:'WS1_MY',  site:'ws1-v3-my', reward_id:15349 },
  { handle:'P064-r65', brand:'WS1_SG',  site:'ws1-v3-sg', reward_id:13132 },
  { handle:'P064-r65', brand:'WS2',     site:'ws2',       reward_id:10619 },
];

// Re-insert clause 3 before the renumbered old-clause-4, and push old-3→4, old-4→5.
// The prior fix changed clause numbering but not the text of those clauses,
// so the anchor strings are reliable.

function restoreEN(html) {
  return html
    // old-3 "Promotion codes" is now clause 3 — push it back to 4
    .replace(
      /<p style="text-align: left;"><font color="#555555">3\. Promotion codes/g,
      '<p style="text-align: left;"><font color="#555555">4. Promotion codes'
    )
    // old-4 "General" is now clause 4 — push it back to 5
    .replace(
      /<p style="text-align: left;"><font color="#555555">4\. General/g,
      '<p style="text-align: left;"><font color="#555555">5. General'
    )
    // Insert clause 3 before the now-4 "Promotion codes" anchor
    .replace(
      /<p style="text-align: left;"><font color="#555555">4\. Promotion codes/,
      '<p style="text-align: left;"><font color="#555555">3. This promotion is valid across all game categories (excluding Blackjack and Virtual Sports).</font></p>' +
      '<p style="text-align: left;"><font color="#555555">4. Promotion codes'
    );
}

function restoreZH(html) {
  return html
    // old-3 "优惠码" is now clause 3 — push to 4
    .replace(
      /<p style="text-align: left;"><font color="#555555">3\. 优惠码/g,
      '<p style="text-align: left;"><font color="#555555">4. 优惠码'
    )
    // old-4 "适用" is now clause 4 — push to 5
    .replace(
      /<p style="text-align: left;"><font color="#555555">4\. 适用/g,
      '<p style="text-align: left;"><font color="#555555">5. 适用'
    )
    // Insert ZH clause 3
    .replace(
      /<p style="text-align: left;"><font color="#555555">4\. 优惠码/,
      '<p style="text-align: left;"><font color="#555555">3. 本优惠适用于所有游戏类别（二十一点和虚拟体育除外）。</font></p>' +
      '<p style="text-align: left;"><font color="#555555">4. 优惠码'
    );
}

function applyRestore(html, locale) {
  if (locale === 'en') return restoreEN(html);
  if (locale === 'zh') return restoreZH(html);
  return html;
}

let passed = 0, failed = 0;

for (const t of TARGETS) {
  const label = `${t.handle} | ${t.brand} | reward_id=${t.reward_id}`;

  const getRes = await igmpPost(t.site, '/PM/GetPromotionRewardContents', { RewardId: t.reward_id });
  const rows = Array.isArray(getRes?.data) ? getRes.data : [];
  if (!rows.length) {
    console.error(`  ✗ ${label} — GetPromotionRewardContents returned no rows`);
    failed++;
    continue;
  }

  let anyChange = false;
  const fixedRows = rows.map(row => {
    const fixed = applyRestore(row.Content || '', row.Locale);
    if (fixed !== row.Content) anyChange = true;
    return { ...row, Content: fixed };
  });

  if (!anyChange) {
    console.log(`  ✓ ${label} — clause 3 already present, no change needed`);
    passed++;
    continue;
  }

  rows.forEach((row, i) => {
    if (row.Content !== fixedRows[i].Content) {
      console.log(`  ~ ${label} | locale=${row.Locale} | restoring clause 3`);
    }
  });

  if (DRY_RUN) {
    // Show the restored EN clause count for verification
    const enFixed = fixedRows.find(r => r.Locale === 'en')?.Content || '';
    const clauseNums = [...enFixed.matchAll(/<font color="#555555">(\d+)\./g)].map(m => m[1]);
    console.log(`  DRY-RUN: clause numbers after restore: [${clauseNums.join(',')}]`);
    continue;
  }

  const putRes = await igmpPost(t.site, '/PM/BulkAddorUpdatePromotionRewardContents', {
    RewardId: t.reward_id,
    PromotionRewardContents: fixedRows.map(r => ({
      Locale:              r.Locale,
      PromotionRewardName: r.PromotionRewardName || '',
      Content:             r.Content,
    })),
  });

  if (!putRes?.success) {
    console.error(`  ✗ ${label} — PUT failed: ${JSON.stringify(putRes)}`);
    failed++;
    continue;
  }

  // Verify: clause 3 back, old fixes intact
  const verRes = await igmpPost(t.site, '/PM/GetPromotionRewardContents', { RewardId: t.reward_id });
  const verRows = Array.isArray(verRes?.data) ? verRes.data : [];
  const enRow = verRows.find(r => r.Locale === 'en');
  const hasClause3  = enRow?.Content?.includes('Blackjack');
  const hasThreeDays = enRow?.Content?.includes('three (3) days');
  const hasOldOneDay = enRow?.Content?.includes('one (1) day');

  if (!hasClause3 || !hasThreeDays || hasOldOneDay) {
    const issues = [
      !hasClause3  && 'clause 3 still missing',
      !hasThreeDays && 'three-days text missing',
      hasOldOneDay  && '"one (1) day" still present',
    ].filter(Boolean);
    console.error(`  ✗ ${label} — verify FAIL: ${issues.join(', ')}`);
    failed++;
  } else {
    console.log(`  ✓ ${label} — clause 3 restored, expiry=three(3)days, verified`);
    passed++;
  }
}

console.log(`\nDone: ${passed} restored/ok, ${failed} failed`);
if (failed) process.exit(1);

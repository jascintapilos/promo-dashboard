#!/usr/bin/env node
// Replace T&C title in FT_RET_CRM_REL_20PCT_SLCS_AUG on WS1 MY+SG:
//   EN: "20% Slots Reload Bonus" → "Mid Month Madness- 20% Reload Bonus"
//   ZH: "20% 老虎机充值奖励"    → "月中疯狂盛宴 - 20% 充值红利"
//
// Usage: node bin/fix-p053-p057-names.mjs [--commit]

import { igmpPost } from '../src/igmp-client.js';

const COMMIT = process.argv.includes('--commit');

const REPLACEMENTS = {
  en: ['20% Slots Reload Bonus', 'Mid Month Madness- 20% Reload Bonus'],
  zh: ['20% 老虎机充值奖励',     '月中疯狂盛宴 - 20% 充值红利'],
};

const TARGETS = [
  { site: 'ws1-v3-my', rewardId: 15503, label: '20PCT MY' },
  { site: 'ws1-v3-sg', rewardId: 13257, label: '20PCT SG' },
];

for (const { site, rewardId, label } of TARGETS) {
  const r = await igmpPost(site, '/PM/GetPromotionRewardContents', { RewardId: rewardId });
  const rows = Array.isArray(r?.data) ? r.data : [];
  if (!rows.length) { console.log(`${label}: no rows`); continue; }

  let changed = 0;
  const newRows = rows.map((row) => {
    const [from, to] = REPLACEMENTS[row.Locale === 'zh' ? 'zh' : 'en'];
    const newContent = row.Content?.replaceAll(from, to) ?? row.Content;
    if (newContent !== row.Content) changed++;
    return { ...row, Content: newContent };
  });

  const hits = rows.map((row, i) => row.Content !== newRows[i].Content ? row.Locale : null).filter(Boolean);
  console.log(`${label} (rewardId=${rewardId}): ${changed}/${rows.length} to update — ${hits.join(', ') || 'none'}`);
  if (!changed) { console.log('  (nothing to change — skip)'); continue; }

  if (COMMIT) {
    const put = await igmpPost(site, '/PM/BulkAddorUpdatePromotionRewardContents', {
      RewardId: rewardId,
      PromotionRewardContents: newRows,
    });
    const ok = put?.success === true || (Array.isArray(put?.message) && put.message.some(m => /success/i.test(m)));
    console.log(ok ? `  ✓ updated` : `  ✗ failed: ${JSON.stringify(put).slice(0, 200)}`);
  } else {
    rows.forEach((row, i) => {
      if (row.Content !== newRows[i].Content) {
        const [from, to] = REPLACEMENTS[row.Locale === 'zh' ? 'zh' : 'en'];
        console.log(`  DRY [${row.Locale}]: "${from}" → "${to}"`);
      }
    });
  }
}

if (!COMMIT) console.log('\n→ Dry-run. Add --commit to apply.');
else console.log('\nDone.');

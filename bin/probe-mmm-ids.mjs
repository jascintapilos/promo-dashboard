import { igmpPost } from '../src/igmp-client.js';

const COMMIT = process.argv.includes('--commit');

const TARGETS = [
  { site: 'ws1-v3-my', rewardId: 15503, label: '20PCT MY' },
  { site: 'ws1-v3-sg', rewardId: 13257, label: '20PCT SG' },
];

function fix(content, locale) {
  if (!content) return content;
  if (locale === 'en') {
    return content.replace(
      'Bonuses are valid for zero (0) days upon issuance unless stated otherwise.',
      'Bonuses are valid for three (3) days upon issuance unless stated otherwise.',
    );
  } else {
    return content.replace(
      '红利自发放之日起 0 天内有效，除非另有说明。',
      '红利自发放之日起 3 天内有效，除非另有说明。',
    );
  }
}

for (const { site, rewardId, label } of TARGETS) {
  const r = await igmpPost(site, '/PM/GetPromotionRewardContents', { RewardId: rewardId });
  const rows = Array.isArray(r?.data) ? r.data : [];
  if (!rows.length) { console.log(`${label}: no rows`); continue; }

  let changed = 0;
  const newRows = rows.map((row) => {
    const newContent = fix(row.Content, row.Locale);
    if (newContent !== row.Content) changed++;
    return { ...row, Content: newContent };
  });

  const hits = rows.map((row, i) => row.Content !== newRows[i].Content ? row.Locale : null).filter(Boolean);
  console.log(`${label} (rewardId=${rewardId}): ${changed}/${rows.length} to update — ${hits.join(', ') || 'none'}`);
  if (!changed) { console.log('  (no match — skip)'); continue; }

  if (COMMIT) {
    const put = await igmpPost(site, '/PM/BulkAddorUpdatePromotionRewardContents', {
      RewardId: rewardId,
      PromotionRewardContents: newRows,
    });
    const ok = put?.success === true || (Array.isArray(put?.message) && put.message.some(m => /success/i.test(m)));
    console.log(ok ? `  ✓ updated` : `  ✗ failed: ${JSON.stringify(put).slice(0, 200)}`);
  } else {
    rows.forEach((row, i) => {
      if (row.Content !== newRows[i].Content)
        console.log(`  DRY [${row.Locale}]: "zero (0)" → "three (3)"`);
    });
  }
}

if (!COMMIT) console.log('\n→ Dry-run. Add --commit to apply.');
else console.log('\nDone.');


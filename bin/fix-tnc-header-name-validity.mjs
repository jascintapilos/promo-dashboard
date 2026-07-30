#!/usr/bin/env node
// Two fixes for FT_CRM_RET_188FS_GOO_MMM + FT_CRM_RET_15PCT_SLCS_MMM on WS1 MY & SG:
//
//   188FS: replace all "Gates of Olympus" → "MB8 Gates of Olympus" throughout EN + ZH T&C
//          (guard: skip any occurrence already prefixed with "MB8 ")
//
//   15PCT: prepend campaign announcement paragraph at the top of EN + ZH T&C
//          EN: <p>Mid Month Madness- 15% Reload Bonus</p>
//          ZH: <p>月中疯狂盛宴 - 15% 充值红利</p>
//
// Usage: node bin/fix-tnc-header-name-validity.mjs [--commit]

import { igmpPost } from '../src/igmp-client.js';

const COMMIT = process.argv.includes('--commit');

// ─── 188FS game name replacement ─────────────────────────────────────────
function fixGamesName(content) {
  if (!content) return content;
  return content.replace(/(?<!MB8 )Gates of Olympus/g, 'MB8 Gates of Olympus');
}

// ─── 15PCT announcement prepend ───────────────────────────────────────────
const ANNOUNCE_15PCT = {
  en: '<p>Mid Month Madness- 15% Reload Bonus</p>',
  zh: '<p>月中疯狂盛宴 - 15% 充值红利</p>',
};

function prepend15pct(content, locale) {
  const line = ANNOUNCE_15PCT[locale] || ANNOUNCE_15PCT.en;
  if (!content) return line;
  if (content.startsWith(line)) return content;
  return line + '\n' + content;
}

// ─── Target list ──────────────────────────────────────────────────────────
const TARGETS_188FS = [
  { site: 'ws1-v3-my', rewardId: 15374, label: '188FS MY' },
  { site: 'ws1-v3-sg', rewardId: 13156, label: '188FS SG' },
];

const TARGETS_15PCT = [
  { site: 'ws1-v3-my', rewardId: 15375, label: '15PCT MY' },
  { site: 'ws1-v3-sg', rewardId: 13155, label: '15PCT SG' },
];

async function processTarget(target, transformFn) {
  const { site, rewardId, label } = target;
  const r = await igmpPost(site, '/PM/GetPromotionRewardContents', { RewardId: rewardId });
  const rows = Array.isArray(r?.data) ? r.data : [];
  if (!rows.length) { console.log(`  ${label}: no rows`); return; }

  let changed = 0;
  const newRows = rows.map((row) => {
    const newContent = transformFn(row.Content, row.Locale);
    if (newContent !== row.Content) changed++;
    return { ...row, Content: newContent };
  });

  console.log(`  ${label} (rewardId=${rewardId}): ${changed}/${rows.length} locale(s) to update`);
  if (!changed) { console.log('    (already up to date — skip)'); return; }

  if (COMMIT) {
    const put = await igmpPost(site, '/PM/BulkAddorUpdatePromotionRewardContents', {
      RewardId: rewardId,
      PromotionRewardContents: newRows,
    });
    const ok = put?.success === true || (Array.isArray(put?.message) && put.message.some(m => /success/i.test(m)));
    if (ok) console.log(`  ✓ ${label} updated`);
    else console.error(`  ✗ ${label} failed: ${JSON.stringify(put).slice(0, 200)}`);
  } else {
    rows.forEach((row, i) => {
      if (row.Content !== newRows[i].Content) {
        console.log(`    DRY [${row.Locale}]: "${newRows[i].Content?.slice(0, 120)}..."`);
      }
    });
  }
}

// ─── Run ──────────────────────────────────────────────────────────────────
console.log('\n═══ 188FS — replace Gates of Olympus → MB8 Gates of Olympus ═══');
for (const t of TARGETS_188FS) await processTarget(t, fixGamesName);

console.log('\n═══ 15PCT — prepend campaign announcement ═══');
for (const t of TARGETS_15PCT) {
  await processTarget(t, (content, locale) => prepend15pct(content, locale === 'zh' ? 'zh' : 'en'));
}

if (!COMMIT) console.log('\n→ Dry-run complete. Add --commit to apply.');
else console.log('\nDone.');

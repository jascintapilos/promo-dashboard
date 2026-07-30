#!/usr/bin/env node
// WS1 T&C updates for Aug CRM promos:
//
//   188FS / 288FS (P235/P237 MY+SG):
//     - Replace Double 8.8 announcement with MMM campaign announcement
//     - Replace "Gates of Olympus" / "Gates Of Olympus" → "MB8 ..." throughout
//
//   20PCT (P236 MY+SG):
//     - Prepend "Mid Month Madness- 15% Reload Bonus" announcement
//
// Usage: node bin/fix-ws1v4-w2-tnc-content.mjs [--commit]

import { igmpPost } from '../src/igmp-client.js';

const COMMIT = process.argv.includes('--commit');

// ─── Announcement strings ─────────────────────────────────────────────────
const D88_EN = '<p>🎉 Double 8.8 is here! Spin to win during this exclusive 3-day campaign (7-9 Aug)</p>';
const D88_ZH = '<p>🎉 双 8.8 来啦！在这场限时3日活动（8月7日–9日）旋转赢大奖</p>';

const MMM_ANNOUNCE = {
  '188FS': {
    en: '<p>Mid Month Madness- 188 Free Spin - MB8 Gates of Olympus</p>',
    zh: '<p>月中疯狂盛宴 - 188 免费旋转 - MB8 奥林匹斯之门</p>',
  },
  '288FS': {
    en: '<p>Mid Month Madness- 288 Free Spin - MB8 Gates of Olympus</p>',
    zh: '<p>月中疯狂盛宴 - 288 免费旋转 - MB8 奥林匹斯之门</p>',
  },
};

const MMM_15PCT = {
  en: '<p>Mid Month Madness- 15% Reload Bonus</p>',
  zh: '<p>月中疯狂盛宴 - 15% 充值红利</p>',
};

// ─── Transform helpers ────────────────────────────────────────────────────

function transformFS(content, locale, spin) {
  if (!content) return content;
  const ann = MMM_ANNOUNCE[spin];
  let c = content;
  // Replace Double 8.8 announcement line; fall back to prepend if not present
  if (locale === 'en') {
    const d88 = D88_EN;
    if (c.startsWith(d88 + '\n')) c = ann.en + '\n' + c.slice(d88.length + 1);
    else if (c.startsWith(d88))   c = ann.en + c.slice(d88.length);
    else if (!c.startsWith(ann.en)) c = ann.en + '\n' + c;
  } else {
    const d88 = D88_ZH;
    if (c.startsWith(d88 + '\n')) c = ann.zh + '\n' + c.slice(d88.length + 1);
    else if (c.startsWith(d88))   c = ann.zh + c.slice(d88.length);
    else if (!c.startsWith(ann.zh)) c = ann.zh + '\n' + c;
  }
  // Fix game name (preserve capitalisation variant; guard against double-prefix)
  c = c.replace(/(?<!MB8 )Gates Of Olympus/g, 'MB8 Gates Of Olympus');
  c = c.replace(/(?<!MB8 )Gates of Olympus/g, 'MB8 Gates of Olympus');
  return c;
}

function transformReload(content, locale) {
  const line = locale === 'zh' ? MMM_15PCT.zh : MMM_15PCT.en;
  if (!content) return line;
  if (content.startsWith(line)) return content;  // idempotency guard
  return line + '\n' + content;
}

// ─── Targets ──────────────────────────────────────────────────────────────
const FS_TARGETS = [
  { site: 'ws1-v3-my', rewardId: 15502, label: '188FS MY', spin: '188FS' },
  { site: 'ws1-v3-sg', rewardId: 13256, label: '188FS SG', spin: '188FS' },
  { site: 'ws1-v3-my', rewardId: 15504, label: '288FS MY', spin: '288FS' },
  { site: 'ws1-v3-sg', rewardId: 13258, label: '288FS SG', spin: '288FS' },
];

const PCT_TARGETS = [
  { site: 'ws1-v3-my', rewardId: 15503, label: '20PCT MY' },
  { site: 'ws1-v3-sg', rewardId: 13257, label: '20PCT SG' },
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
        console.log(`    DRY [${row.Locale}]: "${newRows[i].Content?.slice(0, 130)}..."`);
      }
    });
  }
}

// ─── Run ──────────────────────────────────────────────────────────────────
console.log('\n═══ 188FS / 288FS — replace Double 8.8 → MMM + fix game name ═══');
for (const t of FS_TARGETS) {
  await processTarget(t, (content, locale) => transformFS(content, locale, t.spin));
}

console.log('\n═══ 20PCT — prepend MMM 15% Reload Bonus announcement ═══');
for (const t of PCT_TARGETS) {
  await processTarget(t, transformReload);
}

if (!COMMIT) console.log('\n→ Dry-run complete. Add --commit to apply.');
else console.log('\nDone.');

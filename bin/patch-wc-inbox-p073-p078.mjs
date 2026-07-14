// Patch WS1 T&C reward content for P073-P078 with World Cup angle.
// P073-P075: World Cup Semi Finals theme
// P076-P078: World Cup Finals theme
//
//   node bin/patch-wc-inbox-p073-p078.mjs            # dry-run
//   node bin/patch-wc-inbox-p073-p078.mjs --commit   # live

import { igmpPost } from '../src/igmp-client.js';

const DRY_RUN = !process.argv.includes('--commit');

// ── World Cup copy ───────────────────────────────────────────────────────────

const COPY = {
  semi: {
    en: "The semi-finals are here! Show your support and fuel the excitement — deposit now to claim your 20% Reload Bonus.",
    zh: "世界杯半决赛来了！为您喜爱的球队全力助威——立即存款，领取20%充值红利！",
  },
  final: {
    en: "The World Cup Final is here! Celebrate the biggest match of the year — deposit now and score your 20% Reload Bonus.",
    zh: "世界杯决赛来临！见证年度最精彩的决战——立即存款，领取20%充值红利！",
  },
};

// Old generic taglines (from campaignIntroEn/ZH deposit fallback in igmp-tnc.js)
const OLD_TAGLINE_EN = "Boost your balance! Make a deposit and receive bonus credits to play more of what you love.";
const OLD_TAGLINE_ZH = "提升您的余额！立即存款，获取更多红利畅玩您喜爱的游戏。";

// ── Targets ──────────────────────────────────────────────────────────────────

const TARGETS = [
  // P073-P075: Semi Finals
  { label: 'P073 WS1_MY', siteId: 'ws1-v3-my', rewardId: 15366, theme: 'semi' },
  { label: 'P073 WS1_SG', siteId: 'ws1-v3-sg', rewardId: 13149, theme: 'semi' },
  { label: 'P074 WS1_MY', siteId: 'ws1-v3-my', rewardId: 15367, theme: 'semi' },
  { label: 'P074 WS1_SG', siteId: 'ws1-v3-sg', rewardId: 13150, theme: 'semi' },
  { label: 'P075 WS1_MY', siteId: 'ws1-v3-my', rewardId: 15371, theme: 'semi' },
  { label: 'P075 WS1_SG', siteId: 'ws1-v3-sg', rewardId: 13151, theme: 'semi' },
  // P076-P078: Finals
  { label: 'P076 WS1_MY', siteId: 'ws1-v3-my', rewardId: 15370, theme: 'final' },
  { label: 'P076 WS1_SG', siteId: 'ws1-v3-sg', rewardId: 13153, theme: 'final' },
  { label: 'P077 WS1_MY', siteId: 'ws1-v3-my', rewardId: 15369, theme: 'final' },
  { label: 'P077 WS1_SG', siteId: 'ws1-v3-sg', rewardId: 13152, theme: 'final' },
  { label: 'P078 WS1_MY', siteId: 'ws1-v3-my', rewardId: 15368, theme: 'final' },
  { label: 'P078 WS1_SG', siteId: 'ws1-v3-sg', rewardId: 13154, theme: 'final' },
];

// ── Patch helpers ────────────────────────────────────────────────────────────

function patchTaglineEn(content, newTagline) {
  // Matches the italic paragraph style used by igmp-tnc.js buildDepEn
  return content.replace(
    /<p style="color: rgb\(85, 85, 85\); font-style: italic;">[^<]*<\/p>/,
    `<p style="color: rgb(85, 85, 85); font-style: italic;">${newTagline}</p>`,
  );
}

function patchTaglineZh(content, newTagline) {
  // Matches the italic paragraph style used by igmp-tnc.js buildDepZh
  return content.replace(
    /<p style="font-style: italic;">[^<]*<\/p>/,
    `<p style="font-style: italic;">${newTagline}</p>`,
  );
}

function patchRow(row, theme) {
  const copy = COPY[theme];
  const patched = { ...row };
  if (row.Locale === 'en') {
    const hasOld = row.Content?.includes(OLD_TAGLINE_EN);
    const alreadyWc = row.Content?.includes('World Cup') || row.Content?.includes('semi-final') || row.Content?.includes('Final is here');
    if (alreadyWc) return { row: patched, status: 'already-wc' };
    if (!hasOld) return { row: patched, status: 'no-match' };
    patched.Content = patchTaglineEn(row.Content, copy.en);
    return { row: patched, status: 'patched' };
  }
  if (row.Locale === 'zh') {
    const hasOld = row.Content?.includes(OLD_TAGLINE_ZH);
    const alreadyWc = row.Content?.includes('世界杯');
    if (alreadyWc) return { row: patched, status: 'already-wc' };
    if (!hasOld) return { row: patched, status: 'no-match' };
    patched.Content = patchTaglineZh(row.Content, copy.zh);
    return { row: patched, status: 'patched' };
  }
  return { row: patched, status: 'unchanged' };
}

// ── Main ─────────────────────────────────────────────────────────────────────

let anyFail = false;

for (const { label, siteId, rewardId, theme } of TARGETS) {
  console.log(`\n── ${label} (rewardId=${rewardId}, theme=${theme}) ──`);

  // 1. Fetch current reward contents.
  let rows;
  try {
    const getRes = await igmpPost(siteId, '/PM/GetPromotionRewardContents', { RewardId: rewardId });
    rows = Array.isArray(getRes?.data) ? getRes.data : [];
  } catch (e) {
    console.log(`  ✗ GET failed: ${e.message.split('\n')[0]}`);
    anyFail = true;
    continue;
  }

  if (!rows.length) {
    console.log(`  ✗ No reward content rows returned`);
    anyFail = true;
    continue;
  }

  console.log(`  Locales: ${rows.map((r) => r.Locale).join(', ')}`);

  // 2. Patch each locale.
  const patchedRows = rows.map((r) => {
    const { row, status } = patchRow(r, theme);
    const taglineSnippet = r.Locale === 'en'
      ? (r.Content?.match(/<p style="color: rgb\(85, 85, 85\); font-style: italic;">(.*?)<\/p>/) || [])[1]?.slice(0, 60)
      : (r.Content?.match(/<p style="font-style: italic;">(.*?)<\/p>/) || [])[1]?.slice(0, 60);
    console.log(`  ${r.Locale}: ${status} — current: "${taglineSnippet || '(not found)'}"`);
    if (status === 'patched') {
      const newTagline = r.Locale === 'en' ? COPY[theme].en : COPY[theme].zh;
      console.log(`           → new:     "${newTagline.slice(0, 80)}"`);
    }
    return row;
  });

  const needsPatch = rows.some((r, i) => patchedRows[i].Content !== r.Content);
  if (!needsPatch) {
    console.log(`  ✓ No changes needed`);
    continue;
  }

  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would POST BulkAddorUpdatePromotionRewardContents (${patchedRows.length} locales)`);
    continue;
  }

  // 3. Write all locales back.
  try {
    const putRes = await igmpPost(siteId, '/PM/BulkAddorUpdatePromotionRewardContents', {
      RewardId: rewardId,
      PromotionRewardContents: patchedRows,
    });
    const ok = putRes?.success === true ||
               (Array.isArray(putRes?.message) && putRes.message.some((m) => /success/i.test(m)));
    if (ok) {
      console.log(`  ✓ T&C updated`);
    } else {
      console.log(`  ✗ PUT returned non-success: ${JSON.stringify(putRes).slice(0, 300)}`);
      anyFail = true;
    }
  } catch (e) {
    console.log(`  ✗ PUT failed: ${e.message.split('\n')[0]}`);
    anyFail = true;
  }
}

if (DRY_RUN) {
  console.log('\n[DRY RUN complete] Re-run with --commit to apply patches.');
} else {
  console.log(anyFail ? '\n⚠ Some targets failed — review above.' : '\n✓ All WS1 T&C inbox content patched with World Cup copy.');
}

#!/usr/bin/env node
/**
 * Update MT body for P001-r2 and P002-r3 — Double 7.7 campaign language.
 *
 * Changes (all locales, all brands):
 *   1. Intro: prepend "🎉 Double 7.7 is here! ... 3-day campaign, once per day"
 *   2. T&C claim-once clause: "only once" → "once per day / max 3 times (6–8 July 2026)"
 *
 * Brands: QP2A (ibc22), QPRO6 (qpro6), QPRO8 (qpro8), WS1_SG (ws1-v3-sg)
 *
 * Usage:
 *   node bin/fix-p001-p002-mt-double77.mjs          # dry-run
 *   node bin/fix-p001-p002-mt-double77.mjs --commit # live write
 */

import { authedFetch } from '../src/api-client.js';
import { igmpPost } from '../src/igmp-client.js';
import { getSite } from '../src/sites.js';

const commit = process.argv.includes('--commit');

// ── String patches ────────────────────────────────────────────────────────

function patchEN(body) {
  return body
    // intro: prepend Double 7.7 at start, swap tail
    .replace(
      'Spin to win! Claim your',
      '🎉 <strong>Double 7.7</strong> is here! Spin to win during this exclusive 3-day campaign (6–8 Jul)! Claim your'
    )
    .replace('and chase those big wins!', '— once per day for 3 days!')
    // T&C claim-once (QP2/QPRO format)
    .replace(
      '<li>Each member can claim this promotion only once.</li>',
      '<li>Each member can claim this promotion <strong>once per day</strong>, for a maximum of <strong>3 times</strong> throughout the campaign period (6–8 July 2026).</li>'
    )
    // T&C claim-once (WS1 plain-text format — no <li> wrapper)
    .replace(
      'Each member can claim this promotion only once.',
      'Each member can claim this promotion once per day, for a maximum of 3 times throughout the campaign period (6–8 July 2026).'
    );
}

function patchZH_QP2QPRO(body) {
  return body
    // intro
    .replace('赢取大奖！仅需', '🎉 <strong>双 7.7 活动</strong>来啦！仅需')
    .replace('，追逐丰厚奖励！', '——活动为期 3 天（7月6日–8日），每天可领取一次，赢取丰厚大奖！')
    // T&C claim-once
    .replace(
      '<li>每位会员仅限领取一次此优惠。</li>',
      '<li>每位会员每天可领取一次此优惠，整个活动期间（7月6日–8日）最多可领取 <strong>3 次</strong>。</li>'
    );
}

function patchZH_WS1(body) {
  return body
    // intro (WS1 format: "仅需存款 CUR D，领取 N 次...")
    .replace('仅需存款', '🎉 <strong>双 7.7 活动</strong>来啦！仅需存款')
    .replace('赢取丰厚奖金！', '赢取丰厚大奖——活动为期 3 天（7月6日–8日），每天可领取一次！')
    // T&C claim-once
    .replace(
      '每位会员仅限领取一次此优惠。',
      '每位会员每天可领取一次此优惠，整个活动期间（7月6日–8日）最多可领取 3 次。'
    );
}

function showDiff(label, before, after) {
  if (before === after) {
    console.log(`    ${label}: (no change — patch target not found)`);
  } else {
    console.log(`    ${label}: ✓ patched`);
  }
}

// ── QP2 / QPRO template updates ───────────────────────────────────────────

const QP_TEMPLATES = [
  // QP2A (ibc22) — 4 locales: 1=MY_EN, 3=MY_ZH, 6=SG_EN, 7=SG_ZH
  { handle: 'P001-r2', tplId: 1235, site: 'ibc22', platform: 'qp2' },
  { handle: 'P002-r3', tplId: 1237, site: 'ibc22', platform: 'qp2' },
  // QPRO6 — 2 locales: 1=EN/MYR, 3=ZH/MYR
  { handle: 'P001-r2', tplId: 599,  site: 'qpro6', platform: 'qpro' },
  { handle: 'P002-r3', tplId: 600,  site: 'qpro6', platform: 'qpro' },
  // QPRO8 — 2 locales: 1=EN/MYR, 3=ZH/MYR
  { handle: 'P001-r2', tplId: 659,  site: 'qpro8', platform: 'qpro' },
  { handle: 'P002-r3', tplId: 660,  site: 'qpro8', platform: 'qpro' },
];

// locale id → EN or ZH
const LOCALE_LANG = { 1: 'EN', 3: 'ZH', 6: 'EN', 7: 'ZH' };

console.log('═'.repeat(60));
console.log(`Double 7.7 MT update — ${commit ? 'LIVE COMMIT' : 'DRY-RUN (--commit to save)'}`);
console.log('P001-r2 + P002-r3 · QP2A / QPRO6 / QPRO8 / WS1_SG');
console.log('═'.repeat(60));

let pass = 0, fail = 0;

// ── QP2 / QPRO ────────────────────────────────────────────────────────────

for (const t of QP_TEMPLATES) {
  const siteObj = getSite(t.site);
  const brand = t.platform === 'qp2' ? 'QP2A' : t.site.toUpperCase();
  const label = `${t.handle} ${brand} tpl=${t.tplId}`;

  process.stdout.write(`\n${label}: GET … `);
  let meta, existing;
  try {
    const r = await authedFetch(siteObj, `/api/bo/messagetemplate/${t.tplId}`);
    meta = r.data?.message_template;
    existing = r.data?.message_details || {};
    if (!meta) throw new Error('template not found in response');
    process.stdout.write(`OK (${Object.keys(existing).length} locales)\n`);
  } catch (e) {
    console.log(`FAIL — ${String(e.message || e).split('\n')[0]}`);
    fail++;
    continue;
  }

  // Build patched details
  const patched = {};
  for (const [lid, loc] of Object.entries(existing)) {
    const lang = LOCALE_LANG[lid] || 'EN';
    const oldMsg = loc.message || '';
    const newMsg = lang === 'EN' ? patchEN(oldMsg) : patchZH_QP2QPRO(oldMsg);
    patched[lid] = { ...loc, message: newMsg };
    showDiff(`locale ${lid} (${lang})`, oldMsg, newMsg);
  }

  if (!commit) {
    console.log('  → dry-run — re-run with --commit to save');
    pass++;
    continue;
  }

  const putBody = {
    name:    meta.name,
    section: meta.section,
    type:    meta.type,
    status:  meta.status,
    details: patched,
  };

  try {
    const res = await authedFetch(siteObj, `/api/bo/messagetemplate/${t.tplId}`, {
      method: 'PUT',
      body: putBody,
    });
    const ok = res.success !== false;
    console.log(`  → ${ok ? '✓ saved' : '✗ FAIL'} ${res.message ? `(${Array.isArray(res.message) ? res.message[0] : res.message})` : ''}`);
    if (ok) pass++; else fail++;
  } catch (e) {
    console.log(`  → ✗ FAIL — ${String(e.message || e).split('\n')[0]}`);
    fail++;
  }
}

// ── WS1_SG ────────────────────────────────────────────────────────────────

const WS1_PROMOS = [
  { handle: 'P001-r2', code: 'FT_88FS_10X_040_GOO',  siteId: 'ws1-v3-sg' },
  { handle: 'P002-r3', code: 'FT_100FS_10X_060_GOO', siteId: 'ws1-v3-sg' },
];

for (const w of WS1_PROMOS) {
  const label = `${w.handle} WS1_SG (${w.code})`;
  console.log(`\n${label}:`);

  // 1. Get RewardId
  let rewardId;
  try {
    const fsRes = await igmpPost(w.siteId, '/PM/GetPromotionInfoByCode', { PromotionCode: w.code });
    const promoId = fsRes?.data?.PromotionId;
    if (!promoId) throw new Error('promo not found by code');
    const detRes = await igmpPost(w.siteId, '/PM/GetFreeSpinPromotionInfo', { PromotionId: promoId });
    rewardId = detRes?.data?.PromotionRewards?.[0]?.RewardId ?? null;
    if (!rewardId) throw new Error('RewardId not found in GetFreeSpinPromotionInfo');
    console.log(`  PromoId=${promoId}  RewardId=${rewardId}`);
  } catch (e) {
    console.log(`  ✗ FAIL — ${String(e.message || e).split('\n')[0]}`);
    fail++;
    continue;
  }

  // 2. Fetch current reward contents
  let contents;
  try {
    const tcRes = await igmpPost(w.siteId, '/PM/GetPromotionRewardContents', { RewardId: rewardId });
    contents = tcRes?.data?.PromotionRewardContents || tcRes?.data || [];
    if (!Array.isArray(contents) || contents.length === 0) throw new Error('empty PromotionRewardContents');
    console.log(`  ${contents.length} content row(s) fetched`);
  } catch (e) {
    console.log(`  ✗ FAIL fetching content — ${String(e.message || e).split('\n')[0]}`);
    fail++;
    continue;
  }

  // 3. Patch each row
  const patched = contents.map(row => {
    const locale = (row.Locale || '').toLowerCase();
    const oldContent = row.Content || '';
    const newContent = locale === 'zh' ? patchZH_WS1(oldContent) : patchEN(oldContent);
    showDiff(`locale ${locale}`, oldContent, newContent);
    return { ...row, Content: newContent };
  });

  if (!commit) {
    console.log('  → dry-run — re-run with --commit to save');
    pass++;
    continue;
  }

  // 4. PUT
  try {
    const putRes = await igmpPost(w.siteId, '/PM/BulkAddorUpdatePromotionRewardContents', {
      RewardId: rewardId,
      PromotionRewardContents: patched,
    });
    const ok = putRes?.success === true || (Array.isArray(putRes?.message) && putRes.message.some(m => /success/i.test(m)));
    console.log(`  → ${ok ? '✓ saved' : '✗ FAIL'} ${JSON.stringify(putRes?.message || '').slice(0, 80)}`);
    if (ok) pass++; else fail++;
  } catch (e) {
    console.log(`  → ✗ FAIL — ${String(e.message || e).split('\n')[0]}`);
    fail++;
  }
}

// ── Summary ───────────────────────────────────────────────────────────────

console.log('\n' + '─'.repeat(40));
console.log(`Summary: ${pass} passed, ${fail} failed`);
if (!commit) console.log('(dry-run — no BO writes made. Re-run with --commit to apply.)');

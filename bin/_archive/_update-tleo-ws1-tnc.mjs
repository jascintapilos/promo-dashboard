#!/usr/bin/env node
// Update PromotionRewardContents T&C for all 12 TLEO codes on WS1 MY + SG.
//
// Uses the exact 5-clause WS1 format from the reference source (FT_REL_TLEO_LC_45PCT_228MX):
//   H4 #1: short title + HR + stats table (Min Deposit / Max Bonus / Turnover)
//   H4 #2: 5 clauses:
//     1. Bonuses are valid for 1 day(s) upon issuance unless stated otherwise.
//     2. Each member can claim this promotion only once.
//     3. This promotion is valid across all game categories (excluding X).
//        LC codes   → excluding Blackjack and Virtual Sports
//        Slots codes → excluding Arcade and Table games
//     4. Promotion codes are time-limited and cannot be extended once expired.
//     5. General MB8 [terms and conditions] apply. (linked to mb8mys.com / mb8sg.com)
//
// Title per code:
//   rate=45 → "45% Reload Bonus" (EN) / "45% 充值奖金" (ZH)
//   rate=20 → "20% Reload Bonus" (EN) / "20% 充值奖金" (ZH)

import { igmpPost } from '../src/igmp-client.js';

// ── HTML constants (byte-for-byte matching reference source) ─────────────────

const H4_STYLE    = 'margin-top: 12pt; margin-bottom: 2pt; font-family: Roboto, sans-serif; line-height: 1.656;';
const TD_HEADER   = 'vertical-align: middle; text-align: center; background-color: rgb(42, 50, 142);';
const TD_BODY     = 'vertical-align: middle; text-align: center; background-color: transparent; color: rgb(85, 85, 85);';
const TABLE_STYLE = 'width: 709px; background-color: white; color: rgb(121, 121, 121); font-size: 14px; margin-top: 0px;';
const TD_CLAUSE   = 'vertical-align: middle; text-align: center; background-color: transparent;';
const HR_STYLE    = 'color: rgb(121, 121, 121); font-size: 14px;';

function thCell(text) {
  return `<td style="${TD_HEADER}"><font color="#ffffff"><span style="font-weight: 600;">${text}</span></font><br></td>`;
}
function tdCell(text) {
  return `<td style="${TD_BODY}">${text}</td>`;
}
function statsTable(headers, values) {
  return `<table class="table table-promo-top-row-header" style="${TABLE_STYLE}"><tbody><tr>${headers.map(thCell).join('')}</tr><tr>${values.map(tdCell).join('')}</tr></tbody></table>`;
}
function p(text) {
  return `<p style="text-align: left;"><font color="#555555">${text}</font></p>`;
}
function bold(text) { return `<span style="font-weight: 600;">${text}</span>`; }

// ── Site-specific constants ──────────────────────────────────────────────────

const SITE_CFG = {
  'ws1-v3-my': { pref: 'RM',  brand: 'MB8', tncEn: 'https://mb8mys.com/en/info-center/tnc', tncZh: 'https://mb8mys.com/zh/info-center/tnc' },
  'ws1-v3-sg': { pref: 'SGD', brand: 'MB8', tncEn: 'https://mb8sg.com/en/info-center/tnc',  tncZh: 'https://mb8sg.com/zh/info-center/tnc'  },
};

// ── Content builders ─────────────────────────────────────────────────────────

function buildEnContent(src, siteId) {
  const { pref, brand, tncEn } = SITE_CFG[siteId];
  const isLc   = src.cats[0] === 'Live Casino';
  const isSlot = src.cats[0] === 'Slots';
  const clause3En = isLc
    ? '3. This promotion is valid for Live Casino only (excluding Blackjack).'
    : isSlot
      ? '3. This promotion is valid for Slots only (excluding Arcade and Table games).'
      : '3. This promotion is valid across all game categories (excluding Blackjack and Virtual Sports).';
  const title    = `${src.rate}% Reload Bonus`;

  const stats = statsTable(
    ['Min Deposit', 'Max Bonus', 'Turnover'],
    [`${pref} ${src.minDep}`, `${pref} ${src.cap}`, `${src.to}x`],
  );

  const h4Header = `<h4 dir="ltr" style="${H4_STYLE}"><font color="#797979"><span style="font-weight: 600;">${title}</span></font><br><hr style="${HR_STYLE}">${stats}</h4>`;

  const clauseInner =
    `<p style="color: rgb(85, 85, 85);"><br></p>` +
    p(bold('Terms and Conditions:')) +
    p('1. Bonuses are valid for 1 day(s) upon issuance unless stated otherwise.') +
    p('2. Each member can claim this promotion only once.') +
    p(clause3En) +
    p('4. Promotion codes are time-limited and cannot be extended once expired.') +
    p(`5. General ${brand} <a href="${tncEn}" target="_blank">terms and conditions</a> apply.`);

  const h4Clauses = `<h4 dir="ltr" style="${H4_STYLE}"><table class="table table-promo-top-row-header" style="${TABLE_STYLE}"><tbody><tr><td style="${TD_CLAUSE}">${clauseInner}</td></tr></tbody></table></h4>`;

  return h4Header + h4Clauses;
}

function buildZhContent(src, siteId) {
  const { pref, brand, tncZh } = SITE_CFG[siteId];
  const isLc   = src.cats[0] === 'Live Casino';
  const isSlot = src.cats[0] === 'Slots';
  const clause3Zh = isLc
    ? '3. 本优惠仅适用于真人娱乐城（二十一点除外）。'
    : isSlot
      ? '3. 本优惠仅适用于老虎机游戏（街机和桌面游戏除外）。'
      : '3. 本优惠适用于所有游戏类别（二十一点和虚拟体育除外）。';
  const title       = `${src.rate}% 充值奖金`;

  const stats = statsTable(
    ['最低存款金额', '最高红利金额', '流水量（倍数)'],
    [`${pref} ${src.minDep}`, `${pref} ${src.cap}`, `${src.to}x`],
  );

  const h4Header = `<h4 dir="ltr" style="${H4_STYLE}"><font color="#797979"><span style="font-weight: 600;">${title}</span></font><br><hr style="${HR_STYLE}">${stats}</h4>`;

  const clauseInner =
    `<p style="color: rgb(85, 85, 85);"><br></p>` +
    p(bold('条款与条件：')) +
    p('1. 奖金自发放起 1 天内有效，除非另有说明。') +
    p('2. 每位会员仅限领取一次此优惠。') +
    p(clause3Zh) +
    p('4. 优惠码有时间限制，一旦过期将无法延长。') +
    p(`5. 适用 ${brand} 一般<a href="${tncZh}" target="_blank">条款与条件</a>。`);

  const h4Clauses = `<h4 dir="ltr" style="${H4_STYLE}"><table class="table table-promo-top-row-header" style="${TABLE_STYLE}"><tbody><tr><td style="${TD_CLAUSE}">${clauseInner}</td></tr></tbody></table></h4>`;

  return h4Header + h4Clauses;
}

// ── Promo sources ────────────────────────────────────────────────────────────

const SOURCES = [
  // All-game-categories Silver (no _LC_ / _SL_ / _SLOT marker → excludes Blackjack + Virtual Sports)
  { code: 'FT_REL_TLEO_45PCT_228MX',       minDep: 500,  cap: 228, rate: 45, to: 3, cats: [] },
  { code: 'FT_REL_TLEO_45PCT_458MX',        minDep: 1000, cap: 458, rate: 45, to: 3, cats: [] },
  { code: 'FT_REL_TLEO_45PCT_888MX',        minDep: 2000, cap: 888, rate: 45, to: 3, cats: [] },
  { code: 'FT_REL_TLEO_45PCT_688MX',        minDep: 1500, cap: 688, rate: 45, to: 3, cats: [] },
  // All-game-categories Bronze
  { code: 'FT_REL_TLEO_20PCT_300MX_BR',     minDep: 1500, cap: 300, rate: 20, to: 3, cats: [] },
  { code: 'FT_REL_TLEO_20PCT_400MX_BR',     minDep: 2000, cap: 400, rate: 20, to: 3, cats: [] },
  // LC Silver
  { code: 'FT_REL_TLEO_LC_45PCT_138MX',     minDep: 300,  cap: 138, rate: 45, to: 8, cats: ['Live Casino'] },
  // LC Bronze
  { code: 'FT_REL_TLEO_LC_45PCT_228MX_BR',  minDep: 500,  cap: 228, rate: 45, to: 8, cats: ['Live Casino'] },
  { code: 'FT_REL_TLEO_LC_45PCT_458MX_BR',  minDep: 1000, cap: 458, rate: 45, to: 8, cats: ['Live Casino'] },
  { code: 'FT_REL_TLEO_LC_20PCT_20MX_BR',   minDep: 100,  cap: 20,  rate: 20, to: 8, cats: ['Live Casino'] },
  { code: 'FT_REL_TLEO_LC_20PCT_300MX_BR',  minDep: 1500, cap: 300, rate: 20, to: 8, cats: ['Live Casino'] },
  { code: 'FT_REL_TLEO_LC_20PCT_400MX_BR',  minDep: 2000, cap: 400, rate: 20, to: 8, cats: ['Live Casino'] },
];

const SITES = [
  { siteId: 'ws1-v3-my', label: 'WS1 MY' },
  { siteId: 'ws1-v3-sg', label: 'WS1 SG' },
];

// ── Main update loop ─────────────────────────────────────────────────────────

let updated = 0, skipped = 0, errors = 0;

for (const site of SITES) {
  console.log(`\n${'━'.repeat(60)}\n  ${site.label}\n${'━'.repeat(60)}`);

  for (const src of SOURCES) {
    try {
      // Step 1: get PromotionId
      const info = await igmpPost(site.siteId, '/PM/GetPromotionInfoByCode', { PromotionCode: src.code }).catch(() => null);
      const promoId = info?.data?.PromotionId ?? null;
      if (!promoId) {
        console.log(`  SKIP ${src.code}: not found`);
        skipped++;
        continue;
      }

      // Step 2: get RewardId from GetBonusInfo
      const bonusInfo = await igmpPost(site.siteId, '/PM/GetBonusInfo', { PromotionId: promoId });
      const rewardId = bonusInfo?.data?.Promotion?.PromotionRewards?.[0]?.RewardId ?? null;
      if (!rewardId) {
        console.log(`  SKIP ${src.code} (pid=${promoId}): no RewardId`);
        skipped++;
        continue;
      }

      // Step 3: build + push new T&C
      const enTitle = `${src.rate}% Reload Bonus`;
      const zhTitle = `${src.rate}% 充值奖金`;

      const tncContents = [
        { Locale: 'en', PromotionRewardName: enTitle, Content: buildEnContent(src, site.siteId) },
        { Locale: 'zh', PromotionRewardName: zhTitle, Content: buildZhContent(src, site.siteId) },
      ];

      await igmpPost(site.siteId, '/PM/BulkAddorUpdatePromotionRewardContents', {
        RewardId: rewardId,
        PromotionRewardContents: tncContents,
      });

      console.log(`  ✓ ${src.code} pid=${promoId} rid=${rewardId} [${src.cats[0]}]`);
      updated++;
    } catch (e) {
      console.error(`  ✗ ${src.code} on ${site.siteId}: ${e.message.slice(0, 150)}`);
      errors++;
    }
  }
}

console.log(`\nDone: ${updated} updated, ${skipped} skipped, ${errors} errors`);

// ── QC ───────────────────────────────────────────────────────────────────────

console.log('\nQC:');
console.log('Site'.padEnd(10) + 'Code'.padEnd(40) + 'PID'.padEnd(7) + 'RID'.padEnd(7) + 'Locales'.padEnd(8) + 'Clause3');
console.log('─'.repeat(90));

for (const site of SITES) {
  for (const src of SOURCES) {
    const info = await igmpPost(site.siteId, '/PM/GetPromotionInfoByCode', { PromotionCode: src.code }).catch(() => null);
    const promoId = info?.data?.PromotionId ?? null;
    if (!promoId) { console.log(`${site.siteId.padEnd(10)}${src.code.padEnd(40)}NOT FOUND`); continue; }

    const bi = await igmpPost(site.siteId, '/PM/GetBonusInfo', { PromotionId: promoId }).catch(() => null);
    const rewardId = bi?.data?.Promotion?.PromotionRewards?.[0]?.RewardId ?? '-';

    let locales = '?', clause3 = '?';
    try {
      const ct = await igmpPost(site.siteId, '/PM/GetPromotionRewardContents', { RewardId: rewardId });
      const rows = Array.isArray(ct?.data) ? ct.data : [];
      locales = rows.map((r) => r.Locale).join(',') || 'empty';
      const enRow = rows.find((r) => r.Locale === 'en');
      const m = enRow?.Content?.match(/3\. ([^<]+)/);
      clause3 = m ? m[1].trim().slice(0, 50) : '(not found)';
    } catch { clause3 = 'ERR'; }

    console.log(
      site.siteId.padEnd(10) +
      src.code.padEnd(40) +
      String(promoId).padEnd(7) +
      String(rewardId).padEnd(7) +
      locales.padEnd(8) +
      clause3,
    );
  }
}

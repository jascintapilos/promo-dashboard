#!/usr/bin/env node
// Fix T&C for 15 TLEO codes on WS1 MY + SG that were not in the original 12-code update.
// Parameters (minDep / cap / rate / to) are fetched live from GetBonusInfo.
// Category is detected from the code name:
//   _LC_ in code or _LC suffix → LC only      → "excluding Blackjack"
//   _SL_ in code or _SLOT suffix → Slots only  → "excluding Arcade and Table games"
//   anything else                → All games   → "excluding Blackjack and Virtual Sports"

import { igmpPost } from '../src/igmp-client.js';

// ── HTML constants (byte-for-byte matching reference source) ─────────────────

const H4_STYLE    = 'margin-top: 12pt; margin-bottom: 2pt; font-family: Roboto, sans-serif; line-height: 1.656;';
const TD_HEADER   = 'vertical-align: middle; text-align: center; background-color: rgb(42, 50, 142);';
const TD_BODY     = 'vertical-align: middle; text-align: center; background-color: transparent; color: rgb(85, 85, 85);';
const TABLE_STYLE = 'width: 709px; background-color: white; color: rgb(121, 121, 121); font-size: 14px; margin-top: 0px;';
const TD_CLAUSE   = 'vertical-align: middle; text-align: center; background-color: transparent;';
const HR_STYLE    = 'color: rgb(121, 121, 121); font-size: 14px;';

const SITE_CFG = {
  'ws1-v3-my': { pref: 'RM',  brand: 'MB8', tncEn: 'https://mb8mys.com/en/info-center/tnc', tncZh: 'https://mb8mys.com/zh/info-center/tnc' },
  'ws1-v3-sg': { pref: 'SGD', brand: 'MB8', tncEn: 'https://mb8sg.com/en/info-center/tnc',  tncZh: 'https://mb8sg.com/zh/info-center/tnc'  },
};

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

// ── Category detection from code name ────────────────────────────────────────

function catType(code) {
  if (/_LC_/.test(code) || /_LC$/.test(code)) return 'lc';
  if (/_SL_/.test(code) || /_SLOT$/.test(code)) return 'slots';
  return 'all';
}

// ── Content builders ─────────────────────────────────────────────────────────

function buildEnContent({ minDep, cap, rate, to, catT }, siteId) {
  const { pref, brand, tncEn } = SITE_CFG[siteId];
  const clause3En = catT === 'lc'
    ? '3. This promotion is valid for Live Casino only (excluding Blackjack).'
    : catT === 'slots'
      ? '3. This promotion is valid for Slots only (excluding Arcade and Table games).'
      : '3. This promotion is valid across all game categories (excluding Blackjack and Virtual Sports).';
  const title    = `${rate}% Reload Bonus`;

  const stats = statsTable(
    ['Min Deposit', 'Max Bonus', 'Turnover'],
    [`${pref} ${minDep}`, `${pref} ${cap}`, `${to}x`],
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

function buildZhContent({ minDep, cap, rate, to, catT }, siteId) {
  const { pref, brand, tncZh } = SITE_CFG[siteId];
  const clause3Zh = catT === 'lc'
    ? '3. 本优惠仅适用于真人娱乐城（二十一点除外）。'
    : catT === 'slots'
      ? '3. 本优惠仅适用于老虎机游戏（街机和桌面游戏除外）。'
      : '3. 本优惠适用于所有游戏类别（二十一点和虚拟体育除外）。';
  const title      = `${rate}% 充值奖金`;

  const stats = statsTable(
    ['最低存款金额', '最高红利金额', '流水量（倍数)'],
    [`${pref} ${minDep}`, `${pref} ${cap}`, `${to}x`],
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

// ── Codes to fix ─────────────────────────────────────────────────────────────

const CODES = [
  // LC only → "excluding Blackjack"
  'FT_REL_TLEO_LC_45PCT_228MX',
  'FT_REL_TLEO_LC_45PCT_458MX',
  'FT_REL_TLEO_LC_45PCT_688MX',
  'FT_REL_TLEO_LC_45PCT_888MX',
  'FT_REL_TLEO_LC_45PCT_48MX',
  'FT_REL_TLEO_LC_20PCT_10MX',
  'FT_REL_TLEO_LC_20PCT_60MX_BR',
  'FT_REL_TLEO_LC_20PCT_100MX_BR',
  'FT_REL_TLEO_LC_20PCT_200MX',
  'FT_REL_TLEO_LC_20PCT_200MX_BR',
  'FT_REL_TLEO_LC_20PCT_300MX',
  'FT_REL_TLEO_LC_20PCT_400MX',
  'FT_REL_TLEO_50PCT_25MX_LC',
  // Slots only → "excluding Arcade and Table games"
  'FT_REL_TLEO_SL_20PCT_10MX',
  'FT_REL_TLEO_50PCT_25MX_SLOT',
];

const SITES = [
  { siteId: 'ws1-v3-my', label: 'WS1 MY' },
  { siteId: 'ws1-v3-sg', label: 'WS1 SG' },
];

// ── Main update loop ─────────────────────────────────────────────────────────

let updated = 0, skipped = 0, errors = 0;

for (const site of SITES) {
  console.log(`\n${'━'.repeat(60)}\n  ${site.label}\n${'━'.repeat(60)}`);

  for (const code of CODES) {
    try {
      // Step 1: get PromotionId
      const info = await igmpPost(site.siteId, '/PM/GetPromotionInfoByCode', { PromotionCode: code }).catch(() => null);
      const promoId = info?.data?.PromotionId ?? null;
      if (!promoId) {
        console.log(`  SKIP ${code}: not found`);
        skipped++;
        continue;
      }

      // Step 2: get RewardId + live parameters from GetBonusInfo
      const bonusInfo = await igmpPost(site.siteId, '/PM/GetBonusInfo', { PromotionId: promoId });
      const rew = bonusInfo?.data?.Promotion?.PromotionRewards?.[0];
      const rewardId = rew?.RewardId ?? null;
      if (!rewardId) {
        console.log(`  SKIP ${code} (pid=${promoId}): no RewardId`);
        skipped++;
        continue;
      }

      const src = {
        minDep: rew.MinimumActionAmount,
        cap:    rew.CapBonusAmount,
        rate:   rew.BonusPercentage,
        to:     rew.RolloverMultiplier,
        catT:   catType(code),
      };

      const enTitle = `${src.rate}% Reload Bonus`;
      const zhTitle = `${src.rate}% 充值奖金`;

      await igmpPost(site.siteId, '/PM/BulkAddorUpdatePromotionRewardContents', {
        RewardId: rewardId,
        PromotionRewardContents: [
          { Locale: 'en', PromotionRewardName: enTitle, Content: buildEnContent(src, site.siteId) },
          { Locale: 'zh', PromotionRewardName: zhTitle, Content: buildZhContent(src, site.siteId) },
        ],
      });

      console.log(`  ✓ ${code} pid=${promoId} rid=${rewardId} [${src.catT}, min=${src.minDep}, cap=${src.cap}, ${src.rate}%, ${src.to}x TO]`);
      updated++;
    } catch (e) {
      console.error(`  ✗ ${code} on ${site.siteId}: ${e.message.slice(0, 150)}`);
      errors++;
    }
  }
}

console.log(`\nDone: ${updated} updated, ${skipped} skipped, ${errors} errors`);

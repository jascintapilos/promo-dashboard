#!/usr/bin/env node
// One-off: create TEST_FT_30PCT_1X on WS1 MY (ws1-v3-my).
//
// Deposit Bonus — 30% / cap RM500 / min dep RM30 / TO 1x / 1 claim per player.
//
// Usage:
//   node bin/create-test-ws1-dep.mjs           # dry-run (print payload)
//   node bin/create-test-ws1-dep.mjs --commit  # live save + activate

import { igmpPost } from '../src/igmp-client.js';

const SITE   = 'ws1-v3-my';
const CODE   = 'TEST_FT_30PCT_1X';
const NAME   = '30% Deposit Bonus (MIN30 / CAP500 / TO1x)';
const commit = process.argv.includes('--commit');

// ── T&C content ──────────────────────────────────────────────────────────────
const TNC_EN = '<h4><strong>30% Deposit Bonus</strong></h4><hr>'
  + '<table><tbody>'
  + '<tr><td>Minimum Deposit</td><td>MYR 30</td></tr>'
  + '<tr><td>Maximum Bonus</td><td>MYR 500</td></tr>'
  + '<tr><td>Turnover Requirement</td><td>1x (Deposit + Bonus)</td></tr>'
  + '<tr><td>Promotion Period</td><td>22 July 2026 - 31 December 2026</td></tr>'
  + '</tbody></table>'
  + '<h4>Terms &amp; Conditions</h4>'
  + '<table><tbody>'
  + '<tr><td>1.</td><td>This promotion is valid for all MB8 members.</td></tr>'
  + '<tr><td>2.</td><td>Minimum deposit of MYR 30 is required to qualify.</td></tr>'
  + '<tr><td>3.</td><td>Bonus is 30% of deposit, capped at MYR 500.</td></tr>'
  + '<tr><td>4.</td><td>Turnover of 1x (Deposit + Bonus) must be met before withdrawal.</td></tr>'
  + '<tr><td>5.</td><td>This promotion can only be claimed once per player.</td></tr>'
  + '<tr><td>6.</td><td>MB8 reserves the right to alter or cancel this promotion at any time. Please refer to '
  + '<a href="https://mb8mys.com/en/info-center/tnc" target="_blank">Terms &amp; Conditions</a> for details.</td></tr>'
  + '</tbody></table>';

const TNC_ZH = '<h4><strong>30% 存款奖励</strong></h4><hr>'
  + '<table><tbody>'
  + '<tr><td>最低存款</td><td>MYR 30</td></tr>'
  + '<tr><td>最高奖励</td><td>MYR 500</td></tr>'
  + '<tr><td>流水要求</td><td>1倍（存款 + 奖励）</td></tr>'
  + '<tr><td>活动期间</td><td>2026年7月22日 - 2026年12月31日</td></tr>'
  + '</tbody></table>'
  + '<h4>条款与条件</h4>'
  + '<table><tbody>'
  + '<tr><td>1.</td><td>此活动适用于所有MB8会员。</td></tr>'
  + '<tr><td>2.</td><td>最低存款MYR 30方可参与。</td></tr>'
  + '<tr><td>3.</td><td>奖励金额为存款的30%，最高MYR 500。</td></tr>'
  + '<tr><td>4.</td><td>提款前须完成1倍（存款 + 奖励）流水。</td></tr>'
  + '<tr><td>5.</td><td>每位玩家仅可领取一次。</td></tr>'
  + '<tr><td>6.</td><td>MB8保留随时更改或取消此活动的权利。详情请参阅'
  + '<a href="https://mb8mys.com/zh/info-center/tnc" target="_blank">条款与条件</a>。</td></tr>'
  + '</tbody></table>';

// ── Payload ──────────────────────────────────────────────────────────────────
const payload = {
  PromotionCode:        CODE,
  PromotionName:        NAME,
  PromotionDescription: '30% Deposit Bonus Test',
  PromotionStartDate:   'Tue Jul 22 2026',
  PromotionEndDate:     'Thu Dec 31 2026',
  PromotionManagementId: null,
  RedeemableDay:        '0,1,2,3,4,5,6',
  RedeemableStartTime:  0,
  RedeemableEndTime:    1439,
  RedeemableCount:      1,     // per-player redeem limit
  EffectiveMinutes:     1,
  Settings:             [],
  PromotionRewards: [{
    RewardName:              '30% Deposit Bonus',
    RedemptionType:          '0',          // 0 = Deposit
    RewardType:              '0',          // 0 = Percentage
    MinimumActionAmount:     30,
    BonusPercentage:         30,
    RolloverMultiplier:      1,
    FixedBonusAmount:        0,
    FixedRolloverAmount:     0,
    PhysicalGiftDescription: '',
    RedeemableQuantity:      0,            // 0 = unlimited total pool
    RemainingQuantity:       0,
    IsActive:                true,
    RolloverType:            '0',          // 0 = Percentage
    CapBonusAmount:          500,
    RedeemableKYCStatus:     'BASIC,ADVANCED,PRO',
    WithdrawalCap:           0,
    MaximumBalance:          0,
    ExpiryMinutes:           0,
    PromotionRewardContents: [
      { Locale: 'en', PromotionRewardName: '30% Deposit Bonus', Content: TNC_EN },
      { Locale: 'zh', PromotionRewardName: '30% 存款奖励',       Content: TNC_ZH },
    ],
  }],
};

// ── Main ─────────────────────────────────────────────────────────────────────
console.log(`\n── TEST_FT_30PCT_1X  (${SITE}) ──────────────────────────────────────`);
console.log(`Mode: ${commit ? 'COMMIT (live)' : 'DRY-RUN'}\n`);
console.log('Payload:');
console.log(JSON.stringify(payload, null, 2));

if (!commit) {
  console.log('\n(dry-run complete — add --commit to save)');
  process.exit(0);
}

// ── Idempotency probe ─────────────────────────────────────────────────────────
console.log('\n── Idempotency check ───────────────────────────────────────────────');
try {
  const probe = await igmpPost(SITE, '/PM/GetPromotionInfoByCode', { PromotionCode: CODE });
  if (probe?.data?.PromotionId) {
    const id = probe.data.PromotionId;
    const active = probe.data.IsActive;
    console.error(`✗ "${CODE}" already exists on ${SITE} (PromotionId=${id}, IsActive=${active}). Aborting.`);
    process.exit(1);
  }
  console.log(`✓ "${CODE}" not yet on ${SITE}`);
} catch (e) {
  console.warn(`⚠ Probe failed (non-fatal): ${e.message.split('\n')[0]}`);
}

// ── Create ────────────────────────────────────────────────────────────────────
console.log('\n── POST /PM/AddBonus ───────────────────────────────────────────────');
const res = await igmpPost(SITE, '/PM/AddBonus', payload);
console.log('Response:', JSON.stringify(res, null, 2));

const promotionId = res?.data?.Promotion?.PromotionId ?? res?.data?.PromotionId ?? null;
if (!promotionId) {
  // Fallback lookup — AddBonus sometimes returns success without PromotionId
  console.log('PromotionId not in response — looking up by code...');
  try {
    const lk = await igmpPost(SITE, '/PM/GetPromotionInfoByCode', { PromotionCode: CODE });
    const id = lk?.data?.PromotionId;
    if (id) {
      console.log(`  PromotionId: ${id} (resolved via lookup)`);
      await activate(id);
    } else {
      console.error('✗ Could not resolve PromotionId — activate manually in BO.');
    }
  } catch (e) {
    console.error(`✗ Lookup failed: ${e.message}`);
  }
} else {
  console.log(`  PromotionId: ${promotionId}`);
  await activate(promotionId);
}

async function activate(id) {
  console.log('\n── Activate ────────────────────────────────────────────────────────');
  const actRes = await igmpPost(SITE, '/PM/UpdatePromotionStatus', {
    PromotionId: id,
    Action: 'Activate',
  });
  const ok = actRes?.data?.Success ?? actRes?.success ?? actRes?.data;
  if (ok) {
    console.log(`✓ Activated (PromotionId=${id})`);
  } else {
    console.warn(`⚠ Activate response:`, JSON.stringify(actRes));
  }
}

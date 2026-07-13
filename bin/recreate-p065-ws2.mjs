// Recreate P065 WS2 FreeSpin with correct game (GameId=352 Gates of Olympus).
// The original promo (2647, WHALE_CRM_PROBE_GOO50FS_10X) has GameId=1096
// (Gates of Olympus 1000 — wrong). IGMP locks GameId at creation and has no
// update endpoint. This script deactivates the original and creates _V2.
//
// Uses the plan bundle which already has GameId=352 and WithdrawalCap=30000.
//
//   node bin/recreate-p065-ws2.mjs           # dry-run
//   node bin/recreate-p065-ws2.mjs --commit  # live

import { igmpPost } from '../src/igmp-client.js';
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';

const DRY_RUN = !process.argv.includes('--commit');
const SITE   = 'ws2';
const OLD_ID = 2647;
const OLD_CODE = 'WHALE_CRM_PROBE_GOO50FS_10X';
const NEW_CODE = 'WHALE_CRM_PROBE_GOO50FS_10X_V2';

const planBundle = JSON.parse(readFileSync('./captures/qc-plans/P065-r66__WS2.json', 'utf8'));
const plan = planBundle.plan;
const prom = plan.promotion;
const rewardStep = plan.followups.find(f => f.endpoint === '/PM/AddFreeSpinReward');
if (!rewardStep) { console.error('AddFreeSpinReward followup not found in plan'); process.exit(1); }

console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}Recreate WS2 P065 — ${OLD_CODE} → ${NEW_CODE}`);
console.log(`  GameId in plan: ${rewardStep.body.FreeSpin?.GameId}  (target: 352)`);
console.log(`  WithdrawalCap in plan: ${rewardStep.body.PromotionReward?.WithdrawalCap}`);

// ── Step 1: deactivate old promo ────────────────────────────────────────────
console.log('\n[1] Deactivate old promo (PromotionId=' + OLD_ID + ')');
const oldInfo = await igmpPost(SITE, '/PM/GetPromotionInfoByCode', { PromotionCode: OLD_CODE });
const oldActive = oldInfo?.data?.IsActive;
console.log(`    Current IsActive: ${oldActive}`);

if (oldActive !== false) {
  if (DRY_RUN) {
    console.log('    [DRY RUN] Would POST UpdatePromotionStatus IsActive=false');
  } else {
    const r = await igmpPost(SITE, '/PM/UpdatePromotionStatus', { PromotionId: OLD_ID, IsActive: false });
    if (!r?.success) throw new Error('Deactivate failed: ' + JSON.stringify(r));
    console.log('    ✓ Deactivated');
  }
} else {
  console.log('    Already inactive — skipping');
}

// ── Step 2: create new promo shell ──────────────────────────────────────────
console.log('\n[2] AddFreeSpin — new shell with ' + NEW_CODE);
const shellBody = {
  ...prom,
  PromotionCode: NEW_CODE,
};
console.log('    Body:', JSON.stringify({ PromotionCode: shellBody.PromotionCode, PromotionName: shellBody.PromotionName }));

let newPromotionId;
if (DRY_RUN) {
  console.log('    [DRY RUN] Would POST AddFreeSpin');
  newPromotionId = '$NEW_PROMO_ID';
} else {
  const r = await igmpPost(SITE, '/PM/AddFreeSpin', shellBody);
  // WS2 returns the PromotionId as data directly (integer), not data.PromotionId
  newPromotionId = typeof r?.data === 'number' ? r.data : r?.data?.PromotionId;
  if (!newPromotionId) throw new Error('AddFreeSpin did not return PromotionId: ' + JSON.stringify(r));
  console.log('    ✓ PromotionId=' + newPromotionId);
}

// ── Step 3: add reward + FreeSpin + T&C ─────────────────────────────────────
console.log('\n[3] AddFreeSpinReward (GameId=' + rewardStep.body.FreeSpin.GameId + ', WithdrawalCap=' + rewardStep.body.PromotionReward.WithdrawalCap + ')');
const rewardBody = JSON.parse(JSON.stringify(rewardStep.body));
rewardBody.PromotionId = newPromotionId;
// Update FreeSpinCode/Name to reference new code
if (rewardBody.FreeSpin) {
  rewardBody.FreeSpin.FreeSpinCode = NEW_CODE + '_WS2';
  rewardBody.FreeSpin.FreeSpinName = NEW_CODE + '_WS2';
}

if (DRY_RUN) {
  console.log('    [DRY RUN] Would POST AddFreeSpinReward');
} else {
  const r = await igmpPost(SITE, '/PM/AddFreeSpinReward', rewardBody);
  if (!r?.success && !r?.data?.RewardId) throw new Error('AddFreeSpinReward failed: ' + JSON.stringify(r).slice(0, 200));
  console.log('    ✓ RewardId=' + (r?.data?.RewardId ?? r?.data?.PromotionRewardId ?? '?'));
}

// ── Step 4: activate new promo ───────────────────────────────────────────────
console.log('\n[4] Activate new promo');
if (DRY_RUN) {
  console.log('    [DRY RUN] Would POST UpdatePromotionStatus IsActive=true');
} else {
  const r = await igmpPost(SITE, '/PM/UpdatePromotionStatus', { PromotionId: newPromotionId, IsActive: true });
  if (!r?.success) throw new Error('Activate failed: ' + JSON.stringify(r));
  console.log('    ✓ Activated');
}

// ── Step 5: verify ──────────────────────────────────────────────────────────
if (!DRY_RUN) {
  console.log('\n[5] Verify new promo');
  const info = await igmpPost(SITE, '/PM/GetFreeSpinPromotionInfo', { PromotionId: newPromotionId });
  const rew  = info?.data?.PromotionRewards?.[0];
  const fs   = rew?.FreeSpin;
  console.log('    GameId:', fs?.GameId, '—', fs?.GameName);
  console.log('    FreeSpinRounds:', fs?.FreeSpinRounds, 'AmountPerBet:', fs?.AmountPerBet);
  console.log('    WithdrawalCap:', rew?.WithdrawalCap, 'TO:', rew?.RolloverMultiplier + 'x');
  console.log('    MinDep:', rew?.MinimumActionAmount, 'IsActive:', info?.data?.IsActive);

  // Update QC bundle to reflect the new PromotionId and code
  const bundlePath = './captures/qc-bundles/P065-r66__WS2.json';
  try {
    const bundle = JSON.parse(readFileSync(bundlePath, 'utf8'));
    bundle.promo_code    = NEW_CODE;
    bundle.promotion_id  = newPromotionId;
    bundle.reward_id     = rew?.RewardId;
    if (bundle.source) bundle.source.promo_code = NEW_CODE;
    bundle._recreated_from = OLD_ID;
    writeFileSync(bundlePath, JSON.stringify(bundle, null, 2));
    console.log('\n    ✓ QC bundle updated with new PromotionId=' + newPromotionId);
  } catch (e) {
    console.warn('    ⚠ Could not update QC bundle: ' + e.message);
  }
}

console.log(DRY_RUN ? '\n[DRY RUN] Re-run with --commit to apply.' : '\nDone.');

// Fix P057 (ACQ_TSM_WELC_NODEP_208FS_MHLG_15X) WS name collision.
//
// P055 already owns "MB8 Sugar Rush - 208FS" on WS1_MY and WS2.
// P057 gets unique name: "Sugar Rush 1000 - 208FS 15X".
//
// WS1_SG  — promo exists (id=2943), rename + patch reward contents.
// WS1_MY  — not yet committed, create from plan + correct name.
// WS2     — not yet committed, create from plan + correct name.
//
//   node bin/fix-p057-ws-name.mjs            # dry-run
//   node bin/fix-p057-ws-name.mjs --commit   # live

import { igmpPost } from '../src/igmp-client.js';
import { readFileSync } from 'fs';

const DRY_RUN = !process.argv.includes('--commit');
const CODE   = 'ACQ_TSM_WELC_NODEP_208FS_MHLG_15X';
const NEW_NAME = 'Sugar Rush 1000 - 208FS 15X';

// ── helpers ──────────────────────────────────────────────────────────────────

function patchContent(html) {
  return html
    .replace(/MB8 Sugar Rush/g, 'Sugar Rush 1000')
    .replace(/Sugar Rush - 208FS(\s*\\n\s*WS1\/WS2:[^\n<]*)?/g, NEW_NAME);
}

function buildRewardContents(name) {
  const enContent = patchContent(EN_CONTENT_TEMPLATE);
  const zhContent = patchContent(ZH_CONTENT_TEMPLATE);
  return [
    { Locale: 'en', PromotionRewardName: name, Content: enContent },
    { Locale: 'zh', PromotionRewardName: name, Content: zhContent },
  ];
}

// ── plan templates (from captures/qc-plans/P057-r58__WS1_MY.json) ─────────

const myPlan   = JSON.parse(readFileSync('./captures/qc-plans/P057-r58__WS1_MY.json', 'utf8'));
const ws2Plan  = JSON.parse(readFileSync('./captures/qc-plans/P057-r58__WS2.json',   'utf8'));

const EN_CONTENT_TEMPLATE = myPlan.plan.followups[0].body.PromotionReward.PromotionRewardContents[0].Content;
const ZH_CONTENT_TEMPLATE = myPlan.plan.followups[0].body.PromotionReward.PromotionRewardContents[1].Content;

const BASE_REWARD = {
  RedemptionType:      myPlan.plan.followups[0].body.PromotionReward.RedemptionType,
  RewardType:          myPlan.plan.followups[0].body.PromotionReward.RewardType,
  MinimumActionAmount: myPlan.plan.followups[0].body.PromotionReward.MinimumActionAmount,
  BonusPercentage:     0,
  RolloverMultiplier:  myPlan.plan.followups[0].body.PromotionReward.RolloverMultiplier,
  FixedBonusAmount:    0,
  FixedRolloverAmount: 0,
  PhysicalGiftDescription: '',
  RedeemableQuantity:  0,
  RemainingQuantity:   0,
  IsActive:            true,
  RolloverType:        '0',
  CapBonusAmount:      0,
  RedeemableKYCStatus: myPlan.plan.followups[0].body.PromotionReward.RedeemableKYCStatus,
  WithdrawalCap:       '0',
  MaximumBalance:      '0',
};

const BASE_FS = {
  StartTimeStamp:  myPlan.plan.followups[0].body.FreeSpin.StartTimeStamp,
  EndTimeStamp:    myPlan.plan.followups[0].body.FreeSpin.EndTimeStamp,
  FreeSpinRounds:  myPlan.plan.followups[0].body.FreeSpin.FreeSpinRounds,
  AmountPerBet:    myPlan.plan.followups[0].body.FreeSpin.AmountPerBet,
  AmountPerLine:   null,
  ValidityTimeStamp: null,
  RedeemableDay:   myPlan.plan.followups[0].body.FreeSpin.RedeemableDay,
  RedeemableCount: '0',
  AdditionalSettings: {},
};

const PROMO_BASE = {
  PromotionCode:        CODE,
  PromotionName:        NEW_NAME,
  PromotionDescription: '',
  Settings:             [],
  PromotionStartDate:   myPlan.plan.promotion.PromotionStartDate,
  PromotionEndDate:     myPlan.plan.promotion.PromotionEndDate,
};

// ── site configs ──────────────────────────────────────────────────────────────

const SITES = [
  {
    label: 'WS1_SG',
    siteId: 'ws1-v3-sg',
    existingId: 2943,          // already committed
    freeSpin: {
      ...BASE_FS,
      ProductId: myPlan.plan.followups[0].body.FreeSpin.ProductId,
      GameId:    String(myPlan.plan.followups[0].body.FreeSpin.GameId), // ws1-sg uses same game
      FreeSpinCode: `${CODE}_SG`,
    },
  },
  {
    label: 'WS1_MY',
    siteId: 'ws1-v3-my',
    existingId: null,
    freeSpin: {
      ...BASE_FS,
      ProductId: myPlan.plan.followups[0].body.FreeSpin.ProductId,
      GameId:    String(myPlan.plan.followups[0].body.FreeSpin.GameId),
      FreeSpinCode: `${CODE}_MY`,
    },
  },
  {
    label: 'WS2',
    siteId: 'ws2',
    existingId: null,
    freeSpin: {
      ...BASE_FS,
      ProductId: ws2Plan.plan.followups[0].body.FreeSpin.ProductId,
      GameId:    String(ws2Plan.plan.followups[0].body.FreeSpin.GameId),
      FreeSpinCode: `${CODE}`,
    },
  },
];

// ── main ──────────────────────────────────────────────────────────────────────

let anyFail = false;

for (const { label, siteId, existingId, freeSpin } of SITES) {
  console.log(`\n── ${label} (${siteId}) ──`);

  const rewardContents = buildRewardContents(NEW_NAME);

  if (existingId) {
    // UPDATE existing promo (WS1_SG)
    console.log(`  Existing promo id=${existingId} — renaming to "${NEW_NAME}"`);

    if (!DRY_RUN) {
      // 1. Rename top-level promotion
      const renameRes = await igmpPost(siteId, '/PM/UpdatePromotionDetails', {
        PromotionId:   existingId,
        PromotionCode: CODE,
        PromotionName: NEW_NAME,
        PromotionDescription: '',
        Settings: [],
        PromotionStartDate: PROMO_BASE.PromotionStartDate,
        PromotionEndDate:   PROMO_BASE.PromotionEndDate,
      });
      const renameOk = renameRes?.success === true || renameRes?.message?.toLowerCase?.().includes('success');
      console.log(renameOk ? '  ✓ Renamed' : `  ✗ Rename failed: ${JSON.stringify(renameRes).slice(0, 300)}`);
      if (!renameOk) anyFail = true;

      // 2. Get RewardId
      const fsInfo = await igmpPost(siteId, '/PM/GetFreeSpinPromotionInfo', { PromotionId: existingId });
      const rewardId = fsInfo?.data?.Promotion?.PromotionRewards?.[0]?.RewardId
                    ?? fsInfo?.data?.PromotionRewards?.[0]?.RewardId ?? null;
      if (!rewardId) { console.log('  ✗ RewardId not found'); anyFail = true; continue; }
      console.log(`  RewardId=${rewardId}`);

      // 3. Patch reward contents
      const putRes = await igmpPost(siteId, '/PM/BulkAddorUpdatePromotionRewardContents', {
        RewardId: rewardId,
        PromotionRewardContents: rewardContents,
      });
      const putOk = putRes?.success === true ||
                    (Array.isArray(putRes?.message) && putRes.message.some((m) => /success/i.test(m)));
      console.log(putOk ? '  ✓ Reward contents updated' : `  ✗ Reward update failed: ${JSON.stringify(putRes).slice(0, 300)}`);
      if (!putOk) anyFail = true;
    } else {
      console.log(`  [DRY RUN] Would UpdatePromotionDetails + patch reward contents`);
    }

  } else {
    // CREATE new promo (WS1_MY, WS2)
    console.log(`  Creating promo "${NEW_NAME}"`);

    // Idempotency check
    const existing = await igmpPost(siteId, '/PM/GetPromotionInfoByCode', { PromotionCode: CODE });
    if (existing?.data?.PromotionId) {
      console.log(`  ✗ Code already exists (id=${existing.data.PromotionId}) — skipping`);
      continue;
    }

    // Name uniqueness check
    // (skipping — "Sugar Rush 1000 - 208FS 15X" should be unique)

    if (DRY_RUN) {
      console.log(`  [DRY RUN] Would AddFreeSpin + AddFreeSpinReward`);
      continue;
    }

    // 1. AddFreeSpin
    const addRes = await igmpPost(siteId, '/PM/AddFreeSpin', PROMO_BASE);
    const promoId = addRes?.data?.PromotionId ?? addRes?.data ?? null;
    if (!promoId) {
      console.log(`  ✗ AddFreeSpin failed: ${JSON.stringify(addRes).slice(0, 400)}`);
      anyFail = true;
      continue;
    }
    console.log(`  ✓ Promo created, PromotionId=${promoId}`);

    // 2. AddFreeSpinReward
    const rewardRes = await igmpPost(siteId, '/PM/AddFreeSpinReward', {
      PromotionId: promoId,
      PromotionReward: {
        ...BASE_REWARD,
        RewardName: NEW_NAME,
        PromotionRewardContents: rewardContents,
      },
      FreeSpin: { ...freeSpin },
      MaxFreeSpinDayDuration: 365,
    });
    const rewardOk = rewardRes?.success === true || rewardRes?.data?.RewardId != null;
    console.log(rewardOk ? `  ✓ Reward created (RewardId=${rewardRes?.data?.RewardId})` : `  ✗ Reward failed: ${JSON.stringify(rewardRes).slice(0, 400)}`);
    if (!rewardOk) anyFail = true;

    // 3. UpdatePromotionSettings (empty but required)
    await igmpPost(siteId, '/PM/UpdatePromotionSettings', { PromotionId: promoId, Settings: [] });
    console.log(`  ✓ Settings updated`);
  }
}

if (DRY_RUN) {
  console.log('\n[DRY RUN] Re-run with --commit to apply.');
} else {
  console.log(anyFail ? '\n⚠ Some operations failed.' : `\n✓ P057 "${NEW_NAME}" deployed on all 3 sites.`);
}

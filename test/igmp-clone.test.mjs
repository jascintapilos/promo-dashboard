import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertCloneBundleIntegrity,
  buildIgmpClonePlan,
  createCloneBundle,
  diffBusinessGraphs,
  fetchIgmpPromotionGraph,
  parseWorkbookManifest,
  selectManifestRows,
  sha256,
  validateManifestRow,
  verifyCloneGraph,
} from '../src/igmp-clone.js';

const manifestValues = [
  [],
  ['', 'RN', 'Req Update Date', 'OLD Promo Code', 'Remark', 'Expiry in Min', 'NEW Promo Code\n(Promo Team to Update)', '', 'Region'],
  [],
  ['', '55', '9 Jul 2026', 'FT_REL_29PCT_HSD_D1', '', '10080', 'FT_CRM_RET_REL_29PCT_HSD_D1', '', 'SG'],
  ['', '56', '9 Jul 2026', 'FT_REL_18PCT_MAX800_D2', '', '10080', 'FT_CRM_RET_REL_18PCT_MAX800_D2', '', ''],
];

function sourceGraph(type = 'Bonus') {
  const contents = [
    { Locale: 'en', PromotionRewardName: 'Reward', Content: '<p>English T&C</p>' },
    { Locale: 'zh', PromotionRewardName: '', Content: '<p>中文条款</p>' },
  ];
  const reward = {
    RewardId: 123,
    RewardName: 'Reward',
    RedemptionType: '0',
    RewardType: '0',
    MinimumActionAmount: '100',
    BonusPercentage: '29',
    RolloverMultiplier: '10',
    FixedBonusAmount: 0,
    FixedRolloverAmount: 0,
    PhysicalGiftDescription: '',
    RedeemableQuantity: 1,
    RemainingQuantity: 0,
    IsActive: true,
    RolloverType: '0',
    CapBonusAmount: 800,
    RedeemableKYCStatus: 'BASIC,ADVANCED,PRO',
    WithdrawalCap: 0,
    MaximumBalance: 0,
    PromotionRewardContents: contents,
  };
  if (type === 'FreeSpin') {
    reward.RewardType = '3';
    reward.FreeSpin = {
      ProductId: '208',
      GameId: '9937',
      StartTimeStamp: '23/07/2026',
      EndTimeStamp: '31/12/2026',
      FreeSpinCode: 'OLD_SG',
      FreeSpinName: 'OLD_SG',
      FreeSpinRounds: '28',
      AmountPerBet: '0.2',
      AmountPerLine: null,
      ValidityTimeStamp: null,
      RedeemableDay: '0,1,2,3,4,5,6',
      RedeemableCount: '1',
      AdditionalSettings: {},
    };
  }
  const promotion = {
    PromotionId: 99,
    PromotionCode: 'OLD',
    PromotionName: 'Existing Reward',
    PromotionDescription: 'Source description',
    PromotionStartDate: '23/07/2026',
    PromotionEndDate: '31/12/2026',
    PromotionManagementId: null,
    Settings: [],
    PromotionRewards: [reward],
  };
  const outer = type === 'Bonus'
    ? {
      Promotion: promotion,
      RedeemableDay: '0,1,2,3,4,5,6',
      RedeemableStartTime: 0,
      RedeemableEndTime: 1439,
      RedeemableCount: 1,
      EffectiveMinutes: 1,
    }
    : type === 'FreeCredit'
      ? { Promotion: promotion, ExpiryMinutes: 10080, AutoRedemption: false, EffectiveMinutes: 1 }
      : { ...promotion, MaxFreeSpinDayDuration: 365 };
  const business = {
    type,
    promotion: {
      PromotionCode: 'OLD',
      PromotionName: 'Existing Reward',
      PromotionDescription: 'Source description',
      PromotionStartDate: '2026-07-23',
      PromotionEndDate: '2026-12-31',
      PromotionManagementId: null,
    },
    wrapper: type === 'Bonus'
      ? { RedeemableDay: '0,1,2,3,4,5,6', RedeemableStartTime: 0, RedeemableEndTime: 1439, RedeemableCount: 1, EffectiveMinutes: 1 }
      : type === 'FreeCredit'
        ? { ExpiryMinutes: 10080, AutoRedemption: false, EffectiveMinutes: 1 }
        : { MaxFreeSpinDayDuration: 365 },
    reward: {
      RewardName: 'Reward',
      RedemptionType: '0',
      RewardType: type === 'FreeSpin' ? '3' : '0',
      MinimumActionAmount: 100,
      BonusPercentage: 29,
      RolloverMultiplier: 10,
      FixedBonusAmount: 0,
      FixedRolloverAmount: 0,
      PhysicalGiftDescription: '',
      RedeemableQuantity: 1,
      RolloverType: '0',
      CapBonusAmount: 800,
      RedeemableKYCStatus: 'BASIC,ADVANCED,PRO',
      WithdrawalCap: 0,
      MaximumBalance: 0,
    },
    contents: [
      { Locale: 'en', PromotionRewardName: 'Reward', Content: '<p>English T&C</p>' },
      { Locale: 'zh', PromotionRewardName: '', Content: '<p>中文条款</p>' },
    ],
    ...(type === 'FreeSpin'
      ? {
        free_spin: {
          ProductId: 208,
          GameId: 9937,
          StartTimeStamp: '2026-07-23',
          EndTimeStamp: '2026-12-31',
          FreeSpinCode: 'OLD_SG',
          FreeSpinName: 'OLD_SG',
          FreeSpinRounds: 28,
          AmountPerBet: 0.2,
          AmountPerLine: null,
          ValidityTimeStamp: null,
          RedeemableDay: '0,1,2,3,4,5,6',
          RedeemableCount: 1,
          AdditionalSettings: {},
        },
      }
      : {}),
  };
  return {
    site_id: 'ws1-v3-sg',
    promotion_id: 99,
    reward_id: 123,
    type,
    promotion,
    reward,
    outer,
    contents,
    business,
    business_hash: sha256(business),
  };
}

test('workbook parser uses explicit row regions and never fills down visual groups', () => {
  const rows = parseWorkbookManifest(manifestValues, { tab: 'WS1' });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].source_site, 'ws1-v3-sg');
  assert.equal(rows[1].source_site, '');
  assert.throws(() => validateManifestRow(rows[1]), /source region\/site is blank/);
});

test('row selector supports manifest number ranges', () => {
  const rows = parseWorkbookManifest(manifestValues, { tab: 'WS1' });
  const selected = selectManifestRows(rows, { manifestNumbers: '55-56' });
  assert.deepEqual(selected.map((row) => row.manifest_number), ['55', '56']);
});

test('clone planner changes the code but preserves deposit mechanics and content', () => {
  const source = sourceGraph('Bonus');
  const manifest = {
    workbook_row: 55,
    manifest_number: '55',
    old_code: 'OLD',
    new_code: 'FT_CRM_RET_OLD',
    source_site: 'ws1-v3-sg',
    destination_site: 'ws1-v3-sg',
  };
  const plan = buildIgmpClonePlan(manifest, source);
  assert.equal(plan.endpoint, '/PM/AddBonus');
  assert.equal(plan.body.PromotionCode, 'FT_CRM_RET_OLD');
  assert.equal(plan.body.PromotionRewards[0].BonusPercentage, '29');
  assert.equal(plan.body.PromotionRewards[0].PromotionRewardContents.length, 2);
  assert.equal(plan.body.PromotionRewards[0].PromotionRewardContents[1].PromotionRewardName, '');
  assert.equal(plan.body.PromotionRewards[0].RemainingQuantity, 1);
  assert.equal(plan.expected_business.promotion.PromotionCode, 'FT_CRM_RET_OLD');
});

test('free-spin clone changes both promotion and free-spin identity codes', () => {
  const source = sourceGraph('FreeSpin');
  const manifest = {
    workbook_row: 55,
    manifest_number: '55',
    old_code: 'OLD',
    new_code: 'FT_CRM_RET_OLD',
    source_site: 'ws1-v3-sg',
    destination_site: 'ws1-v3-sg',
  };
  const plan = buildIgmpClonePlan(manifest, source);
  assert.equal(plan.endpoint, '/PM/AddFreeSpin');
  assert.equal(plan.followups[0].body.FreeSpin.FreeSpinCode, 'FT_CRM_RET_OLD_SG');
  assert.equal(plan.followups[0].body.FreeSpin.FreeSpinName, 'FT_CRM_RET_OLD_SG');
  assert.equal(plan.followups[0].body.PromotionReward.PromotionRewardContents.length, 2);
});

test('clone bundle approval is bound to an immutable plan hash', () => {
  const source = sourceGraph('Bonus');
  const manifest = {
    workbook_row: 55,
    manifest_number: '55',
    old_code: 'OLD',
    new_code: 'NEW',
    source_site: 'ws1-v3-sg',
    destination_site: 'ws1-v3-sg',
  };
  const plan = buildIgmpClonePlan(manifest, source);
  const bundle = createCloneBundle({
    spreadsheetId: 'sheet',
    tab: 'WS1',
    manifest,
    sourceGraph: source,
    plan,
    generatedAt: '2026-07-23T00:00:00.000Z',
  });
  assert.equal(assertCloneBundleIntegrity(bundle, bundle.plan_hash), bundle.plan_hash);
  const tampered = structuredClone(bundle);
  tampered.plan.body.PromotionRewards[0].BonusPercentage = 99;
  assert.throws(() => assertCloneBundleIntegrity(tampered, bundle.plan_hash), /integrity failure/);
});

test('persisted verification fails on any mechanics mismatch', () => {
  const source = sourceGraph('Bonus');
  const manifest = {
    workbook_row: 55,
    manifest_number: '55',
    old_code: 'OLD',
    new_code: 'NEW',
    source_site: 'ws1-v3-sg',
    destination_site: 'ws1-v3-sg',
  };
  const plan = buildIgmpClonePlan(manifest, source);
  const destination = structuredClone(source);
  destination.business.promotion.PromotionCode = 'NEW';
  destination.business_hash = sha256(destination.business);
  assert.equal(verifyCloneGraph(plan, destination).pass, true);
  destination.business.reward.RolloverMultiplier = 12;
  const result = verifyCloneGraph(plan, destination);
  assert.equal(result.pass, false);
  assert.ok(result.diffs.some((diff) => diff.path === 'reward.RolloverMultiplier'));
});

test('business diff reports missing rewards instead of empty-pass success', () => {
  const diffs = diffBusinessGraphs({ reward: { RewardName: 'A' } }, { reward: null });
  assert.equal(diffs.length, 1);
  assert.equal(diffs[0].path, 'reward');
});

test('source fetch hard-fails when the type-specific detail has no reward', async () => {
  const post = async (_site, endpoint) => {
    if (endpoint === '/PM/GetPromotionInfoByCode') {
      return { data: { PromotionId: 10, PromotionType: 'Bonus' } };
    }
    if (endpoint === '/PM/GetBonusInfo') {
      return { data: { Promotion: { PromotionCode: 'OLD', PromotionRewards: [] } } };
    }
    throw new Error(`unexpected ${endpoint}`);
  };
  await assert.rejects(
    fetchIgmpPromotionGraph('ws1-v3-sg', 'OLD', { post }),
    /exactly one reward; found 0/,
  );
});

test('source fetch hard-fails when a required content locale is missing', async () => {
  const post = async (_site, endpoint) => {
    if (endpoint === '/PM/GetPromotionInfoByCode') {
      return { data: { PromotionId: 10, PromotionType: 'Bonus' } };
    }
    if (endpoint === '/PM/GetBonusInfo') {
      return {
        data: {
          Promotion: {
            PromotionCode: 'OLD',
            PromotionRewards: [{ RewardId: 20, RewardName: 'Reward' }],
          },
        },
      };
    }
    if (endpoint === '/PM/GetPromotionRewardContents') {
      return { data: [{ Locale: 'en', PromotionRewardName: 'Reward', Content: '<p>EN</p>' }] };
    }
    throw new Error(`unexpected ${endpoint}`);
  };
  await assert.rejects(
    fetchIgmpPromotionGraph('ws1-v3-sg', 'OLD', { post }),
    /missing ZH/,
  );
});

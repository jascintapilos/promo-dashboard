// Add the "RM100 withdrawal cap" clause to P010 (FT_WEL_18FS_020_GOO) reward
// T&C on WS1-MY, both EN + ZH. Re-renders via igmp-tnc.js (buildFsEn/Zh now
// emit the cap clause when withdrawal_cap>0) and pushes via
// /PM/BulkAddorUpdatePromotionRewardContents. Mirrors bin/fix-p134-ws1-tnc.mjs.
//
//   node bin/add-withdrawal-cap-tnc-p010.mjs            # dry-run
//   node bin/add-withdrawal-cap-tnc-p010.mjs --commit   # live
import { igmpPost } from '../src/igmp-client.js';
import { buildTncRow } from '../src/igmp-tnc.js';
import { readFileSync } from 'fs';

const DRY_RUN = !process.argv.includes('--commit');
const siteId = 'ws1-v3-my';
const PROMO_CODE = 'FT_WEL_18FS_020_GOO';

const rec = { ...JSON.parse(readFileSync('./captures/requests/P010-r11.json', 'utf8')), __site_override: siteId };
if (Number(rec.withdrawal_cap ?? 0) <= 0) { console.log('✗ withdrawal_cap not set on record — aborting'); process.exit(1); }

// Resolve PromotionId + RewardId live.
const info = await igmpPost(siteId, '/PM/GetPromotionInfoByCode', { PromotionCode: PROMO_CODE });
const promoId = info?.data?.PromotionId ?? null;
if (!promoId) { console.log(`✗ promo ${PROMO_CODE} not found`); process.exit(1); }
const fsInfo = await igmpPost(siteId, '/PM/GetFreeSpinPromotionInfo', { PromotionId: promoId });
const rewardId = fsInfo?.data?.Promotion?.PromotionRewards?.[0]?.RewardId
              ?? fsInfo?.data?.PromotionRewards?.[0]?.RewardId ?? null;
if (!rewardId) { console.log(`✗ RewardId not found (PromotionId=${promoId})`); process.exit(1); }
console.log(`PromotionId=${promoId}  RewardId=${rewardId}`);

const enRow = buildTncRow(rec, 'en', 'free spin');
const zhRow = buildTncRow(rec, 'zh', 'free spin');

const enHasCap = /capped at/i.test(enRow.Content);
const zhHasCap = /最高可提款/.test(zhRow.Content);
console.log(`EN cap clause present: ${enHasCap}  |  ZH cap clause present: ${zhHasCap}`);
if (!enHasCap || !zhHasCap) { console.log('✗ cap clause missing in re-rendered content — aborting'); process.exit(1); }

const strip = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
console.log('\nEN clauses:', (strip(enRow.Content).match(/Terms & Conditions:.*/)?.[0] || '').slice(0, 500));
console.log('\nZH clauses:', (strip(zhRow.Content).match(/条款与条件：.*/)?.[0] || '').slice(0, 400));

if (DRY_RUN) { console.log('\n[DRY RUN] Re-run with --commit to push.'); process.exit(0); }

const put = await igmpPost(siteId, '/PM/BulkAddorUpdatePromotionRewardContents', {
  RewardId: rewardId,
  PromotionRewardContents: [enRow, zhRow],
});
const ok = put?.success === true || (Array.isArray(put?.message) && put.message.some((m) => /success/i.test(m)));
console.log(ok ? `\n✓ T&C updated (RewardId=${rewardId})` : `\n✗ PUT failed: ${JSON.stringify(put).slice(0, 300)}`);

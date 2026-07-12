// Restore IGMP reward T&C for P069-P072 after UpdatePromotionRewardDetails wipe.
//
// patch-p069-p072-recurring.mjs called /PM/UpdatePromotionRewardDetails which
// silently deletes PromotionRewardContents even when sent inline
// (feedback_igmp_reward_details_put_wipes_tnc). Re-post the regenerated
// contents (clause 1 = 7 days, clause 2 = once per day) via
// /PM/BulkAddorUpdatePromotionRewardContents, then verify non-empty.

import { readFileSync } from 'node:fs';
import { buildIgmpPlan } from '../src/api-mapper-igmp.js';
import { igmpPost } from '../src/igmp-client.js';

const HANDLES = ['P069-r70', 'P070-r71', 'P071-r72', 'P072-r73'];
const IGMP_BRANDS = ['WS1_MY', 'WS1_SG', 'WS2'];

let fails = 0;

for (const handle of HANDLES) {
  const resolved = JSON.parse(readFileSync(`captures/requests/${handle}.json`, 'utf8'));

  for (const brand of IGMP_BRANDS) {
    const bundle = JSON.parse(readFileSync(`captures/qc-bundles/${handle}__${brand}.json`, 'utf8'));
    const { site, reward_id } = bundle;

    try {
      const plan = buildIgmpPlan(resolved, { siteId: site });
      const contents = plan.body.PromotionRewards[0].PromotionRewardContents;
      if (!contents?.length) throw new Error('regenerated contents empty');

      const r = await igmpPost(site, '/PM/BulkAddorUpdatePromotionRewardContents', {
        RewardId: reward_id,
        PromotionRewardContents: contents,
      });
      const ok = r?.success === true || (Array.isArray(r?.message) && r.message.some((m) => /success/i.test(m)));
      if (!ok) throw new Error(`bulk post returned: ${JSON.stringify(r).slice(0, 200)}`);

      // Verify: read back, require every posted locale non-empty + clause checks
      const back = await igmpPost(site, '/PM/GetPromotionRewardContents', { RewardId: reward_id });
      const rows = back?.data || [];
      if (rows.length < contents.length) throw new Error(`verify: expected ${contents.length} locales, got ${rows.length}`);
      const joined = rows.map((x) => String(x.Content || '')).join('\n');
      const clause1Ok = /seven \(7\) days upon issuance/.test(joined) || /7 天内有效/.test(joined);
      const clause2Ok = /once per day/.test(joined) || /每日限领取一次/.test(joined);
      console.log(`  ✓ ${handle} ${brand}  reward=${reward_id}  locales=${rows.length}/${contents.length}  clause1(7d)=${clause1Ok}  clause2(daily)=${clause2Ok}`);
      if (!clause1Ok || !clause2Ok) { fails++; console.error(`    ⚠ clause check failed — inspect content manually`); }
    } catch (e) {
      fails++;
      console.error(`  ✗ ${handle} ${brand}: ${e.message}`);
    }
  }
}

console.log(fails ? `\nDone with ${fails} failure(s).` : '\nDone — all restored & verified.');
process.exit(fails ? 1 : 0);

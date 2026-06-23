#!/usr/bin/env node
// One-shot: activate 27 WCF promos on WS1@my, WS1@sg, WS2 that were created
// without the activation step (P009-P017, PromotionIds captured from canary output).

import { igmpPost } from '../src/igmp-client.js';

const SITES = {
  'ws1-v3-my': [3690, 3691, 3692, 3693, 3694, 3695, 3696, 3697, 3698],
  'ws1-v3-sg': [2856, 2857, 2858, 2859, 2860, 2861, 2862, 2863, 2864],
  'ws2':       [2594, 2595, 2596, 2597, 2598, 2599, 2600, 2601, 2602],
};

let total = 0, ok = 0, fail = 0;

for (const [siteId, ids] of Object.entries(SITES)) {
  console.log(`\n── ${siteId} ──`);
  for (const promotionId of ids) {
    total++;
    try {
      const res = await igmpPost(siteId, '/PM/UpdatePromotionStatus', { PromotionId: promotionId, IsActive: true });
      const success = res?.success === true || (Array.isArray(res?.message) && res.message.some(m => /success/i.test(m)));
      if (success) {
        console.log(`  ✓ id=${promotionId} IsActive=true`);
        ok++;
      } else {
        console.error(`  ✗ id=${promotionId} unexpected response: ${JSON.stringify(res)}`);
        fail++;
      }
    } catch (e) {
      console.error(`  ✗ id=${promotionId} error: ${e.message}`);
      fail++;
    }
  }
}

console.log(`\n━━━ ${ok}/${total} activated, ${fail} failed ━━━`);
if (fail > 0) process.exit(1);

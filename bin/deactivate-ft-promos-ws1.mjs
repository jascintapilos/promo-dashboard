#!/usr/bin/env node
// One-off: deactivate the FT_-prefixed P083/P084 promos that were incorrectly
// created on WS1-MY and WS1-SG. IDs from the commit run output.
import { igmpPost } from '../src/igmp-client.js';

const TARGETS = [
  { site: 'ws1-v3-my', id: 3699, code: 'FT_WEL_WC26_100PCT_50_25x' },
  { site: 'ws1-v3-my', id: 3700, code: 'FT_WELC_188PCT_25X' },
  { site: 'ws1-v3-sg', id: 2865, code: 'FT_WEL_WC26_100PCT_50_25x' },
  { site: 'ws1-v3-sg', id: 2866, code: 'FT_WELC_188PCT_25X' },
];

for (const { site, id, code } of TARGETS) {
  try {
    const res = await igmpPost(site, '/PM/UpdatePromotionStatus', {
      PromotionId: id,
      Status: 0,
    });
    const ok = res.Result?.IsSuccess ?? res.IsSuccess ?? res.success ?? false;
    console.log(`${site} id=${id} (${code}): ${ok ? '✓ deactivated' : '✗ ' + JSON.stringify(res).slice(0, 120)}`);
  } catch (e) {
    console.log(`${site} id=${id} (${code}): ERROR ${e.message.split('\n')[0]}`);
  }
}

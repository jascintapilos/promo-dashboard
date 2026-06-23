#!/usr/bin/env node
// Generate create-bodies for the 5 missing TLEO codes on WS1 MY + SG.
// OFFLINE ONLY — builds plans via buildIgmpPlan (no auth, no POST).
// Bodies are written to tmp/ for POST through the live browser session.
//
// The 2 no-FT-prefix canonical codes (REL_TLEO_*) are preserved EXACTLY by
// overriding plan.body.PromotionCode after the mapper (which force-prefixes FT_).
//
// Naming convention (matches existing WS1 siblings, verified live):
//   20% codes  -> "20% Reload Bonus"
//   45% codes  -> "Time Limited Exclusive Offer - 45% Reload Bonus"
//
// Usage:
//   node bin/_replicate-tleo-missing-5.mjs           # dry-run preview + emit bodies
//   node bin/_replicate-tleo-missing-5.mjs --ft       # force FT_ prefix on the 2 no-prefix codes

import fs from 'node:fs';
import { buildIgmpPlan } from '../src/api-mapper-igmp.js';

const FORCE_FT = process.argv.includes('--ft');

const NAME_20 = '20% Reload Bonus';
const NAME_45 = 'Time Limited Exclusive Offer - 45% Reload Bonus';
const ZH_20   = '20% 充值奖金';
const ZH_45   = '限时独家优惠 - 45% 充值奖金';

// Canonical params from qpro2-tleo-source.json. Amounts identical for MY (MYR)
// and SG (SGD) per WS1 convention.
// SCOPE (user-confirmed 2026-06-09): only the 3 GENUINELY-missing codes.
// The 2 no-prefix canonical codes (REL_TLEO_LC/SL_20PCT_10MX) already exist on
// WS1 MY+SG under FT_ names (FT_REL_TLEO_LC_20PCT_10MX id MY3583/SG2791,
// FT_REL_TLEO_SL_20PCT_10MX id MY3585/SG2793) — creating them would duplicate.
const CODES = [
  { code: 'FT_REL_TLEO_LC_20PCT_100MX',     cats: ['Live Casino'], rate: 20, minDep: 500, cap: 100, to: 8,  validity: 1, rewardValidity: 1,  nameEn: NAME_20, nameZh: ZH_20, noFt: false },
  { code: 'FT_REL_TLEO_LC_45PCT_138MX_BR',  cats: ['Live Casino'], rate: 45, minDep: 300, cap: 138, to: 8,  validity: 1, rewardValidity: 1,  nameEn: NAME_45, nameZh: ZH_45, noFt: false },
  { code: 'FT_REL_TLEO_LC_45PCT_48MX_BR',   cats: ['Live Casino'], rate: 45, minDep: 100, cap: 48,  to: 8,  validity: 1, rewardValidity: 1,  nameEn: NAME_45, nameZh: ZH_45, noFt: false },
];

const REGIONS = [
  { site: 'ws1-v3-my', region: 'MY', currency: 'MYR', locales: ['MY_EN', 'MY_ZH'] },
  { site: 'ws1-v3-sg', region: 'SG', currency: 'SGD', locales: ['SG_EN', 'SG_ZH'] },
];

const START = '2026-06-09';
const END   = '2026-12-31';

function buildRec(src, reg) {
  return {
    promo_code:           src.code,
    promotion_name_en:    src.nameEn,
    promotion_name_zh_id: src.nameZh,
    column_m:             '',
    bonus_pct:            src.rate,
    min_deposit:          src.minDep,
    cap_bonus_amount:     src.cap,
    turnover_multiplier:  src.to,
    expiry_minutes_ws1:   1440,
    validity_days:        src.validity,
    rewards_validity_days: src.rewardValidity,
    region:               reg.region,
    regions:              [reg.region],
    currencies:           [reg.currency],
    locales:              reg.locales,
    categories:           src.cats,
    parsed: {
      bonus_rate_pct: src.rate,
      min_deposit:    src.minDep,
      max_bonus:      src.cap,
      to_multiplier:  src.to,
      categories:     src.cats,
    },
    bonus_type:      'Deposit',
    __site_override: reg.site,
    start_date:      START,
    end_date:        END,
  };
}

const emit = {};   // { 'ws1-v3-my': [ {code, body}, ... ], ... }

console.log('═'.repeat(96));
console.log('  DRY-RUN — 3 genuinely-missing TLEO codes × 2 regions = 6 creates  (endpoint /PM/AddBonus, UNPUBLISHED)');
console.log('═'.repeat(96));

for (const reg of REGIONS) {
  emit[reg.site] = [];
  console.log(`\n### WS1-${reg.region} (${reg.site}) — ${reg.currency}\n`);
  console.log('Code'.padEnd(34) + 'Cat'.padEnd(13) + 'Rate'.padEnd(6) + 'MinDep'.padEnd(8) + 'Cap'.padEnd(7) + 'TO'.padEnd(5) + 'Val'.padEnd(5) + 'RwdVal'.padEnd(8) + 'PromotionName');
  console.log('─'.repeat(120));
  for (const src of CODES) {
    const rec  = buildRec(src, reg);
    const plan = buildIgmpPlan(rec, { siteId: reg.site });

    // Resolve final code: mapper force-prefixes FT_. For no-prefix canonical
    // codes, restore the EXACT code unless --ft was passed.
    let finalCode = plan.body.PromotionCode;   // mapper output (always FT_-prefixed)
    if (src.noFt && !FORCE_FT) finalCode = src.code;   // exact canonical (REL_TLEO_*)
    plan.body.PromotionCode = finalCode;

    const reward = plan.body.PromotionRewards[0];
    const localeCount = reward.PromotionRewardContents.length;
    const locs = reward.PromotionRewardContents.map(c => c.Locale).join('/');

    console.log(
      finalCode.padEnd(34) +
      (src.cats[0]).padEnd(13) +
      (src.rate + '%').padEnd(6) +
      String(src.minDep).padEnd(8) +
      String(src.cap).padEnd(7) +
      (src.to + 'x').padEnd(5) +
      String(src.validity).padEnd(5) +
      String(src.rewardValidity).padEnd(8) +
      plan.body.PromotionName + `  [${locs}]`
    );

    emit[reg.site].push({ code: finalCode, body: plan.body });
  }
}

// Write bodies for browser POST
fs.mkdirSync('tmp', { recursive: true });
fs.writeFileSync('tmp/ws1-missing-5-bodies.json', JSON.stringify(emit, null, 1));

// ── Emit self-contained browser-POST snippets (run via javascript_tool in the
//    live, authenticated page context for each region) ──────────────────────
// Each snippet is idempotent: GetPromotionInfoByCode first, skip if already
// present, else POST /PM/AddBonus. Codes are created UNPUBLISHED (no publish
// call is ever made).
function snippet(items) {
  return `(async () => {
  const items = ${JSON.stringify(items)};
  const results = [];
  for (const it of items) {
    try {
      const chk = await fetch('/PM/GetPromotionInfoByCode', { method:'POST', headers:{'Content-Type':'application/json; charset=utf-8','Accept':'application/json, text/plain, */*'}, body: JSON.stringify({ PromotionCode: it.code }) });
      const cj = await chk.json().catch(()=>null);
      if (cj && cj.data && cj.data.PromotionId) { results.push({ code: it.code, skipped: true, existingId: cj.data.PromotionId }); continue; }
      const r = await fetch('/PM/AddBonus', { method:'POST', headers:{'Content-Type':'application/json; charset=utf-8','Accept':'application/json, text/plain, */*'}, body: JSON.stringify(it.body) });
      let j = null; try { j = await r.json(); } catch {}
      results.push({ code: it.code, status: r.status, success: j && j.success, newId: j && j.data && j.data.PromotionId || null, msg: j && j.message || null });
    } catch (e) { results.push({ code: it.code, error: String(e && e.message || e) }); }
  }
  return JSON.stringify(results, null, 1);
})();`;
}

for (const reg of REGIONS) {
  fs.writeFileSync(`tmp/post-${reg.site}.js`, snippet(emit[reg.site]));
}
// Canary = first MY item only
fs.writeFileSync('tmp/post-canary.js', snippet([emit['ws1-v3-my'][0]]));
console.log('\nBrowser-POST snippets emitted: tmp/post-canary.js, tmp/post-ws1-v3-my.js, tmp/post-ws1-v3-sg.js');

// Sanity: dump one full body so we can eyeball the reward + T&C
const sample = emit['ws1-v3-sg'][0];
console.log('\n' + '─'.repeat(96));
console.log('SAMPLE full body (SG, ' + sample.code + '):');
console.log(JSON.stringify(sample.body, null, 1).slice(0, 2200));
console.log('\nBodies written to tmp/ws1-missing-5-bodies.json (6 creates)');

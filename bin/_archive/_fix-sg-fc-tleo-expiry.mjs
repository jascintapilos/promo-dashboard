#!/usr/bin/env node
// Fix WS1 SG TLEO Free Credit claim-window: set ExpiryMinutes to 1440 (1 day)
// to match the T&C's "valid for 1 day(s)" clause — same value the operator
// already applied on WS1 MY (deep-QC 2026-07-06, E1 check,
// feedback-igmp-fc-expiry-outer-wrapper).
//
//   node bin/_fix-sg-fc-tleo-expiry.mjs           # dry-run
//   node bin/_fix-sg-fc-tleo-expiry.mjs --commit
//
// Endpoint: /PM/UpdateFreeCreditDetails {PromotionId, ExpiryMinutes,
// AutoRedemption, EffectiveMinutes} (project-igmp-edit-status-endpoints).
// This is a promotion-level "Free Credit details" tab call, distinct from
// UpdatePromotionRewardDetails (which wipes T&C) — but since that's
// unverified for this endpoint, T&C is snapshotted/restored anyway as a
// zero-cost safety net, with per-promo fail-fast verification.

import { igmpPost } from '../src/igmp-client.js';

const SITE = 'ws1-v3-sg';
const COMMIT = process.argv.includes('--commit');
const TARGET_MINUTES = 1440;
const CODES = [
  'FT_TLEO_FC10_10X', 'FT_TLEO_FC1088_10X', 'FT_TLEO_FC138_10X',
  'FT_TLEO_FC228_10X', 'FT_TLEO_FC228_10X_BR', 'FT_TLEO_FC458_10X',
  'FT_TLEO_FC458_10X_BR', 'FT_TLEO_FC48_10X', 'FT_TLEO_FC688_10X',
  'FT_TLEO_FC88_10X', 'FT_TLEO_FC888_10X', 'FT_TLEO_FC888_10X_BR',
];

const stripLen = (h) => (h || '').replace(/<[^>]+>/g, '').trim().length;
const clause = (text, n) => {
  const m = text.match(new RegExp(`${n}\\.\\s*([^]*?)(?=\\s*${n + 1}\\.\\s|$)`));
  return m ? m[1].trim() : '';
};
const strip = (html) => (html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

const plan = [];
let blocked = 0;

for (const code of CODES) {
  try {
    const info = await igmpPost(SITE, '/PM/GetPromotionInfoByCode', { PromotionCode: code });
    const promoId = info?.data?.PromotionId;
    if (!promoId) throw new Error('not found');
    const det = await igmpPost(SITE, '/PM/GetFreeCreditInfo', { PromotionId: promoId });
    const outer = det?.data;
    const promo = outer?.Promotion;
    const rew = promo?.PromotionRewards?.[0];
    if (!rew?.RewardId) throw new Error('no PromotionRewards[0]');

    const checks = [];
    if (outer.ExpiryMinutes === TARGET_MINUTES) { console.log(`= ${code}: already ${TARGET_MINUTES} — skip`); continue; }

    // T&C snapshot (belt-and-suspenders even though this endpoint is
    // promotion-level, not reward-level)
    const ct = await igmpPost(SITE, '/PM/GetPromotionRewardContents', { RewardId: rew.RewardId });
    const tncRows = (Array.isArray(ct?.data) ? ct.data : [])
      .filter((r) => stripLen(r.Content) > 0)
      .map((r) => ({ Locale: r.Locale, PromotionRewardName: r.PromotionRewardName || '', Content: r.Content }));

    // sanity: T&C clause-2 should say "valid for 1 day" — confirm target matches wording
    const en = tncRows.find((r) => r.Locale === 'en');
    const enText = strip(en?.Content);
    const em = clause(enText, 2).match(/valid for (\d+) day/i) || enText.match(/valid for (\d+) day/i);
    if (em && Number(em[1]) !== TARGET_MINUTES / 1440) checks.push(`T&C says "valid for ${em[1]} day(s)" but target is ${TARGET_MINUTES / 1440}d — mismatch, do not blindly apply`);
    if (!tncRows.length) checks.push('no T&C to preserve');

    console.log(`${checks.length ? '✗' : '✓'} ${code}  pid=${promoId} rid=${rew.RewardId}`);
    console.log(`    ExpiryMinutes: ${outer.ExpiryMinutes} → ${TARGET_MINUTES}  (AutoRedemption=${outer.AutoRedemption}, EffectiveMinutes=${outer.EffectiveMinutes} unchanged)`);
    console.log(`    T&C: "${em ? em[1] + ' day(s)' : '?'}"  [preserved: ${tncRows.map((r) => r.Locale).join(',')}]`);
    checks.forEach((c) => console.log(`    ⚠ ${c}`));

    if (checks.length) { blocked++; continue; }
    plan.push({ code, promoId, rid: rew.RewardId, outer, tncRows });
  } catch (e) {
    blocked++;
    console.log(`✗ ${code}: ${(e.message || e).slice(0, 100)}`);
  }
}

if (!COMMIT) {
  console.log(`\nDRY-RUN — ${plan.length} of ${CODES.length} would be fixed (${blocked} blocked). Re-run with --commit.`);
  process.exit(blocked ? 1 : 0);
}
if (blocked) { console.error('\nABORT: blocked checks above.'); process.exit(3); }

console.log('\nApplying (fail-fast, per-promo verify)…\n');
let done = 0;
for (const r of plan) {
  try {
    await igmpPost(SITE, '/PM/UpdateFreeCreditDetails', {
      PromotionId: r.promoId,
      ExpiryMinutes: String(TARGET_MINUTES),
      AutoRedemption: r.outer.AutoRedemption,
      EffectiveMinutes: String(r.outer.EffectiveMinutes ?? 1),
    });
    // restore T&C only if the call above disturbed it
    const ctCheck = await igmpPost(SITE, '/PM/GetPromotionRewardContents', { RewardId: r.rid });
    const rowsCheck = Array.isArray(ctCheck?.data) ? ctCheck.data : [];
    const tncIntact = r.tncRows.every((t) => rowsCheck.some((x) => x.Locale === t.Locale && stripLen(x.Content) > 40));
    if (!tncIntact) {
      await igmpPost(SITE, '/PM/BulkAddorUpdatePromotionRewardContents', {
        RewardId: r.rid,
        PromotionRewardContents: r.tncRows,
      });
    }

    // verify
    const det = await igmpPost(SITE, '/PM/GetFreeCreditInfo', { PromotionId: r.promoId });
    const outer = det?.data;
    const ct = await igmpPost(SITE, '/PM/GetPromotionRewardContents', { RewardId: r.rid });
    const rows = Array.isArray(ct?.data) ? ct.data : [];
    const tncOk = r.tncRows.every((t) => rows.some((x) => x.Locale === t.Locale && stripLen(x.Content) > 40));
    const expOk = Number(outer.ExpiryMinutes) === TARGET_MINUTES;
    const otherOk = outer.AutoRedemption === r.outer.AutoRedemption && Number(outer.EffectiveMinutes) === Number(r.outer.EffectiveMinutes ?? 1);
    if (!expOk || !tncOk || !otherOk) {
      console.log(`  ✗ ${r.code}: VERIFY FAILED (exp=${expOk} tnc=${tncOk} other=${otherOk}) — ABORTING`);
      process.exit(1);
    }
    done++;
    console.log(`  ✓ ${r.code}  ExpiryMinutes now ${outer.ExpiryMinutes}  (T&C intact${tncIntact ? '' : ', restored'})`);
  } catch (e) {
    console.log(`  ✗ ${r.code}: ${(e.message || e).slice(0, 120)} — ABORTING`);
    process.exit(1);
  }
}
console.log(`\n${done}/${plan.length} fixed.`);

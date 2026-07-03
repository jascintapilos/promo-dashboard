#!/usr/bin/env node
/**
 * Update MT body for _V2 promo codes — Double 7.7 campaign language.
 * Same patch as fix-p001-p002-mt-double77.mjs, applied to:
 *   FT_88FS_10X_040_GOO_V2  → QP2A tpl=1243 / QPRO6 tpl=601 / QPRO8 tpl=661
 *   FT_100FS_10X_060_GOO_V2 → QP2A tpl=1244 / QPRO6 tpl=602 / QPRO8 tpl=662
 *
 * Usage:
 *   node bin/fix-v2-mt-double77.mjs          # dry-run
 *   node bin/fix-v2-mt-double77.mjs --commit # live write
 */

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const commit = process.argv.includes('--commit');

// ── String patches (same as P001/P002) ───────────────────────────────────────

function patchEN(body) {
  return body
    .replace(
      'Spin to win! Claim your',
      '🎉 <strong>Double 7.7</strong> is here! Spin to win during this exclusive 3-day campaign (6–8 Jul)! Claim your'
    )
    .replace('and chase those big wins!', '— once per day for 3 days!')
    .replace(
      '<li>Each member can claim this promotion only once.</li>',
      '<li>Each member can claim this promotion <strong>once per day</strong>, for a maximum of <strong>3 times</strong> throughout the campaign period (6–8 July 2026).</li>'
    )
    .replace(
      'Each member can claim this promotion only once.',
      'Each member can claim this promotion once per day, for a maximum of 3 times throughout the campaign period (6–8 July 2026).'
    );
}

function patchZH(body) {
  return body
    .replace('赢取大奖！仅需', '🎉 <strong>双 7.7 活动</strong>来啦！仅需')
    .replace('，追逐丰厚奖励！', '——活动为期 3 天（7月6日–8日），每天可领取一次，赢取丰厚大奖！')
    .replace(
      '<li>每位会员仅限领取一次此优惠。</li>',
      '<li>每位会员每天可领取一次此优惠，整个活动期间（7月6日–8日）最多可领取 <strong>3 次</strong>。</li>'
    );
}

function showDiff(label, before, after) {
  console.log(`    locale ${label}: ${before === after ? '(no change — patch target not found)' : '✓ patched'}`);
}

// ── Template list ─────────────────────────────────────────────────────────────

const TEMPLATES = [
  // QP2A (ibc22) — 4 locales: 1=MY_EN, 3=MY_ZH, 6=SG_EN, 7=SG_ZH
  { code: 'FT_88FS_10X_040_GOO_V2',  tplId: 1243, site: 'ibc22', label: 'QP2A' },
  { code: 'FT_100FS_10X_060_GOO_V2', tplId: 1244, site: 'ibc22', label: 'QP2A' },
  // QPRO6 — 2 locales: 1=EN, 3=ZH
  { code: 'FT_88FS_10X_040_GOO_V2',  tplId: 601,  site: 'qpro6', label: 'QPRO6' },
  { code: 'FT_100FS_10X_060_GOO_V2', tplId: 602,  site: 'qpro6', label: 'QPRO6' },
  // QPRO8 — 2 locales: 1=EN, 3=ZH
  { code: 'FT_88FS_10X_040_GOO_V2',  tplId: 661,  site: 'qpro8', label: 'QPRO8' },
  { code: 'FT_100FS_10X_060_GOO_V2', tplId: 662,  site: 'qpro8', label: 'QPRO8' },
];

const LOCALE_LANG = { 1: 'EN', 3: 'ZH', 6: 'EN', 7: 'ZH' };

console.log('═'.repeat(60));
console.log(`Double 7.7 MT update (_V2 codes) — ${commit ? 'LIVE COMMIT' : 'DRY-RUN (--commit to save)'}`);
console.log('FT_88FS_10X_040_GOO_V2 / FT_100FS_10X_060_GOO_V2');
console.log('QP2A / QPRO6 / QPRO8');
console.log('═'.repeat(60));

let pass = 0, fail = 0;

for (const t of TEMPLATES) {
  const siteObj = getSite(t.site);
  const label = `${t.code} ${t.label} tpl=${t.tplId}`;

  process.stdout.write(`\n${label}: GET … `);
  let meta, existing;
  try {
    const r = await authedFetch(siteObj, `/api/bo/messagetemplate/${t.tplId}`);
    meta = r.data?.message_template;
    existing = r.data?.message_details || {};
    if (!meta) throw new Error('template not found in response');
    process.stdout.write(`OK (${Object.keys(existing).length} locales)\n`);
  } catch (e) {
    console.log(`FAIL — ${String(e.message || e).split('\n')[0]}`);
    fail++;
    continue;
  }

  // Build patched details
  const patched = {};
  for (const [lid, loc] of Object.entries(existing)) {
    const lang = LOCALE_LANG[lid] || 'EN';
    const oldMsg = loc.message || '';
    const newMsg = lang === 'EN' ? patchEN(oldMsg) : patchZH(oldMsg);
    patched[lid] = { ...loc, message: newMsg };
    showDiff(lid, oldMsg, newMsg);
  }

  if (!commit) {
    console.log('  → dry-run — re-run with --commit to save');
    pass++;
    continue;
  }

  const putBody = {
    name:    meta.name,
    section: meta.section,
    type:    meta.type,
    status:  meta.status,
    details: patched,
  };

  try {
    const res = await authedFetch(siteObj, `/api/bo/messagetemplate/${t.tplId}`, {
      method: 'PUT',
      body: putBody,
    });
    const ok = res.success !== false;
    console.log(`  → ${ok ? '✓ saved' : '✗ FAIL'} ${res.message ? `(${Array.isArray(res.message) ? res.message[0] : res.message})` : ''}`);
    if (ok) pass++; else fail++;
  } catch (e) {
    console.log(`  → ✗ FAIL — ${String(e.message || e).split('\n')[0]}`);
    fail++;
  }
}

console.log('\n' + '─'.repeat(40));
console.log(`Summary: ${pass} passed, ${fail} failed`);
if (!commit) console.log('(dry-run — no BO writes made. Re-run with --commit to apply.)');

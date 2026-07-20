#!/usr/bin/env node
// Complete the 8 empty Day-2 FS shells: attach the free-spin reward
// (vs20mb88gates, 0.40/spin) + settings to each existing PromotionId, then
// activate. Cannot recreate (iGMP "code not available" + no delete endpoint),
// so we run the plan's follow-ups against the shell that already owns the code.
//   node tmp-complete-fs-shells.mjs           (dry-run: resolve shells, preview)
//   node tmp-complete-fs-shells.mjs --commit   (attach reward + activate)

import { readFileSync } from 'node:fs';
import { igmpPost } from './src/igmp-client.js';

const commit = process.argv.includes('--commit');
const HANDLES = ['P122-r124', 'P128-r130', 'P134-r136', 'P140-r142'];
const BRANDS = [{ brand: 'WS1_MY', siteId: 'ws1-v3-my' }, { brand: 'WS1_SG', siteId: 'ws1-v3-sg' }];

function substituteTokens(node, vars) {
  if (typeof node === 'string') return node.startsWith('$') ? (vars[node.slice(1)] ?? node) : node;
  if (Array.isArray(node)) return node.map((n) => substituteTokens(n, vars));
  if (node && typeof node === 'object') { const o = {}; for (const [k, v] of Object.entries(node)) o[k] = substituteTokens(v, vars); return o; }
  return node;
}

const results = [];
for (const h of HANDLES) {
  for (const { brand, siteId } of BRANDS) {
    const bundle = JSON.parse(readFileSync(`captures/qc-plans/${h}__${brand}.json`, 'utf8'));
    const code = bundle.promo_code;
    const plan = bundle.plan;
    let info;
    try { info = await igmpPost(siteId, '/PM/GetPromotionInfoByCode', { PromotionCode: code }); }
    catch (e) { console.log(`✗ ${brand} ${code}: lookup err ${e.message.split('\n')[0]}`); results.push({ brand, code, ok: false }); continue; }
    const shell = info?.data;
    if (!shell?.PromotionId) { console.log(`✗ ${brand} ${code}: NO SHELL`); results.push({ brand, code, ok: false }); continue; }
    const pid = shell.PromotionId;
    const existingRewards = (shell.PromotionRewards || []).length;
    const fsGame = plan.followups?.[0]?.body?.FreeSpin;
    console.log(`\n${brand} ${code}`);
    console.log(`  shell id=${pid} active=${shell.IsActive} existingRewards=${existingRewards}`);
    console.log(`  will attach: GameId=${fsGame?.GameId} AmountPerBet=${fsGame?.AmountPerBet} Rounds=${fsGame?.FreeSpinRounds}`);
    if (existingRewards > 0) { console.log(`  ⚠ already has a reward — SKIP (no double-add)`); results.push({ brand, code, ok: 'skip' }); continue; }
    if (!commit) { results.push({ brand, code, ok: null }); continue; }

    const captured = { PromotionId: pid };
    let stepOk = true;
    for (const step of plan.followups || []) {
      const body = substituteTokens(step.body, captured);
      try { const r = await igmpPost(siteId, step.endpoint, body); const ok = r?.success === true || r?.Success === true; console.log(`   ${step.endpoint}: ${ok ? '✓' : '✗ ' + JSON.stringify(r).slice(0, 160)}`); if (!ok) stepOk = false; }
      catch (e) { console.log(`   ${step.endpoint}: ✗ ${e.message.split('\n')[0]}`); stepOk = false; break; }
    }
    if (stepOk) {
      try { const act = await igmpPost(siteId, '/PM/UpdatePromotionStatus', { PromotionId: pid, IsActive: true }); const ok = act?.success === true || act?.Success === true; console.log(`   activate: ${ok ? '✓' : '✗ ' + JSON.stringify(act).slice(0, 120)}`); }
      catch (e) { console.log(`   activate: ✗ ${e.message.split('\n')[0]}`); stepOk = false; }
    }
    results.push({ brand, code, pid, ok: stepOk });
  }
}
console.log(`\n${commit ? 'COMMIT' : 'DRY-RUN'} done. ${results.filter(r => r.ok === true).length}/${results.length} completed, ${results.filter(r => r.ok === 'skip').length} skipped.`);

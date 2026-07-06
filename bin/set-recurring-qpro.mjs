#!/usr/bin/env node
// Set QPRO promos to Recurring + max_per_player/daily_max caps, via the mapper's
// buildUpdate (reads resolved.recurring/max_per_player/daily_max from the request
// record) — same echo-PUT pattern as bin/fix-p069-qpro-membergroups.mjs.
// Preserves message_template_id + dialog popup link. QPRO PUT is full-body
// (absent fields wipe), so buildUpdate rebuilds everything.
//
//   node bin/set-recurring-qpro.mjs --handles=P013-r14 --sites=qpro1            ← dry-run one
//   node bin/set-recurring-qpro.mjs --handles=P013-r14,... --sites=qpro1,... --commit
import { authedFetch, updatePromotion, findPromotionByCode } from '../src/api-client.js';
import { buildApiPlan } from '../src/api-mapper-qpro.js';
import { getSite } from '../src/sites.js';
import { readFileSync } from 'fs';

const argv = process.argv.slice(2);
const commit = argv.includes('--commit');
const handles = (argv.find(a => a.startsWith('--handles=')) || '').split('=')[1]?.split(',') || [];
const sites = (argv.find(a => a.startsWith('--sites=')) || '').split('=')[1]?.split(',') || [];
if (!handles.length || !sites.length) { console.error('pass --handles= and --sites='); process.exit(2); }

let ok = 0, fail = 0;
for (const handle of handles) {
  const resolved = JSON.parse(readFileSync(`captures/requests/${handle}.json`, 'utf8'));
  for (const sid of sites) {
    const site = getSite(sid);
    const brand = sid.toUpperCase();
    try {
      const row = await findPromotionByCode(site, resolved.promo_code);
      if (!row) { console.log(`  ${handle} ${brand}: promo not found — skip`); fail++; continue; }
      const before = (await authedFetch(site, `/api/bo/promotion/${row.id}`)).data.rows;
      const sig = { mt: before.message_template_id, rec: before.recurring, max: before.max_per_player, daily: before.daily_max };
      // popup link from list row
      const popupRow = Array.isArray(row.dialog_popup_list) && row.dialog_popup_list.length ? row.dialog_popup_list[0] : null;
      if (!commit) {
        console.log(`  ${handle} ${brand} id=${row.id}: recurring ${sig.rec}→1  max ${sig.max}→${resolved.max_per_player}  daily ${sig.daily}→${resolved.daily_max}  (mt=${sig.mt} popup=${popupRow?.popup_id||'-'})`);
        continue;
      }
      const plan = await buildApiPlan(resolved, { brand, site });
      const putBody = plan.buildUpdate(row.id, before.message_template_id || 0, popupRow
        ? { id: popupRow.popup_id, code: '', start_date: popupRow.created_at, label: '' }
        : null);
      await updatePromotion(site, row.id, putBody);
      const after = (await authedFetch(site, `/api/bo/promotion/${row.id}`)).data.rows;
      const lst = await findPromotionByCode(site, resolved.promo_code);
      const drift = [];
      if (after.message_template_id !== sig.mt) drift.push(`mt(${sig.mt}→${after.message_template_id})`);
      if ((lst?.dialog_popup_list || []).length < (row.dialog_popup_list || []).length) drift.push('dialog-dropped');
      const good = after.recurring === 1 && Number(after.max_per_player) === resolved.max_per_player && Number(after.daily_max) === resolved.daily_max;
      if (good && !drift.length) { ok++; console.log(`  ✓ ${handle} ${brand.padEnd(7)} id=${row.id}  recurring=1 max=${after.max_per_player} daily=${after.daily_max}`); }
      else { fail++; console.log(`  ${good ? '⚠' : '✗'} ${handle} ${brand} id=${row.id}  recurring=${after.recurring} max=${after.max_per_player} daily=${after.daily_max}${drift.length ? ' DRIFT['+drift.join(',')+']' : ''}`); }
    } catch (e) { fail++; console.log(`  ✗ ${handle} ${brand}: ${e.message.split('\n')[0].slice(0, 60)}`); }
  }
}
console.log(`\n${commit ? 'LIVE' : 'DRY-RUN'} done. ok=${ok} problems=${fail}`);

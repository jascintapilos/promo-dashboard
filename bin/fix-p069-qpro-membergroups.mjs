#!/usr/bin/env node
// Re-PUT the 17 QPRO P069 records to clear member_group_ids that the
// earlier mapper version mistakenly populated from tier_constraint. Per
// operator rule 2026-05-17, QPRO never sets member_group_ids.

import fs from 'node:fs';
import { authedFetch, updatePromotion } from '../src/api-client.js';
import { buildApiPlan } from '../src/api-mapper-qpro.js';
import { getSite } from '../src/sites.js';

const targets = [
  { site: 'qpro1',  id: 937 },
  { site: 'qpro2',  id: 484 },
  { site: 'qpro3',  id: 449 },
  { site: 'qpro4',  id: 351 },
  { site: 'qpro5',  id: 332 },
  { site: 'qpro6',  id: 400 },
  { site: 'qpro7',  id: 337 },
  { site: 'qpro8',  id: 456 },
  { site: 'qpro9',  id: 326 },
  { site: 'qpro10', id: 255 },
  { site: 'qpro11', id: 184 },
  { site: 'qpro12', id: 151 },
  { site: 'qpro13', id: 145 },
  { site: 'qpro14', id: 146 },
  { site: 'qpro15', id: 247 },
  { site: 'qpro16', id: 215 },
  { site: 'qpro17', id: 141 },
];

const resolved = JSON.parse(fs.readFileSync('captures/requests/P069-r70.json', 'utf8'));

for (const t of targets) {
  const site = getSite(t.site);
  const brand = t.site.toUpperCase();
  try {
    const before = (await authedFetch(site, `/api/bo/promotion/${t.id}`)).data.rows;
    const beforeCount = (before.member_group_ids || []).length;
    const plan = await buildApiPlan(resolved, { brand, site });
    // Preserve existing template_id + dialog popup link
    const lst = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(before.code)}&perPage=5`);
    const listRow = (lst.data?.rows || []).find((r) => r.id === t.id);
    const popupRow = Array.isArray(listRow?.dialog_popup_list) && listRow.dialog_popup_list.length
      ? listRow.dialog_popup_list[0]
      : null;
    const putBody = plan.buildUpdate(t.id, before.message_template_id || 0, popupRow
      ? { id: popupRow.popup_id, code: '', start_date: popupRow.created_at, label: '' }
      : null);
    if (process.argv.includes('--commit')) {
      await updatePromotion(site, t.id, putBody);
      const after = (await authedFetch(site, `/api/bo/promotion/${t.id}`)).data.rows;
      const afterCount = (after.member_group_ids || []).length;
      console.log(`${t.site.padEnd(8)} id=${t.id}  member_groups ${beforeCount} → ${afterCount}  ${afterCount === 0 ? '✓' : '✖'}`);
    } else {
      console.log(`${t.site.padEnd(8)} id=${t.id}  member_groups currently ${beforeCount} (would set to 0)`);
    }
  } catch (e) {
    console.log(`${t.site} ERR: ${(e.message||'').split('\n')[0]}`);
  }
}

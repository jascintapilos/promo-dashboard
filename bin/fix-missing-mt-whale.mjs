#!/usr/bin/env node
// Fix the 4 Whale-Probe QPRO promos that were saved without an MT (rate-limited
// commit skipped the MT-link on idempotent retry). Creates MT (+ popup) with the
// CLEAN QPRO name and links via buildUpdate. Requests currently hold the WS1/WS2
// variant names, so override promotion_name_en to the clean name in-memory.
//
//   node bin/fix-missing-mt-whale.mjs            # dry-run
//   node bin/fix-missing-mt-whale.mjs --commit
import { authedFetch, createMessageTemplate, createDialogPopup, updatePromotion, findPromotionByCode } from '../src/api-client.js';
import { buildApiPlan } from '../src/api-mapper-qpro.js';
import { getSite } from '../src/sites.js';
import { readFileSync } from 'fs';

const commit = process.argv.includes('--commit');
const TARGETS = [
  { site: 'qpro3', handle: 'P039-r40', code: 'WHALE_CRM_PROBE_20PCT_200_FTD_WIN_2', name: '20% Live Casino Reload Bonus' },
  { site: 'qpro8', handle: 'P040-r41', code: 'WHALE_CRM_PROBE_20PCT_300_FTD_WIN_2', name: '20% Live Casino Reload Bonus' },
  { site: 'qpro1', handle: 'P041-r42', code: 'WHALE_CRM_PROBE_88PCT_100_FTD_WIN_3', name: '88% Slots Reload Bonus' },
  { site: 'qpro3', handle: 'P041-r42', code: 'WHALE_CRM_PROBE_88PCT_100_FTD_WIN_3', name: '88% Slots Reload Bonus' },
];

for (const t of TARGETS) {
  const site = getSite(t.site); const brand = t.site.toUpperCase();
  const resolved = { ...JSON.parse(readFileSync(`captures/requests/${t.handle}.json`, 'utf8')),
    promotion_name_en: t.name, suppress_mechanics_tag: false };
  try {
    const existing = await findPromotionByCode(site, t.code);
    if (!existing) { console.log(`  ✗ ${t.site} ${t.code}: promo not found`); continue; }
    if (existing.message_template_id > 0) { console.log(`  • ${t.site} ${t.code}: already has MT ${existing.message_template_id} — skip`); continue; }
    const plan = await buildApiPlan(resolved, { brand, site });
    if (!commit) { console.log(`  ~ ${t.site} ${t.code} (promo ${existing.id}): would create MT + link`); continue; }
    const r2 = await createMessageTemplate(site, plan.messageTemplate);
    const templateId = r2?.data?.rows?.id;
    if (!templateId) { console.log(`  ✗ ${t.site} ${t.code}: MT create returned no id`); continue; }
    let dialogPopup = null;
    if (plan.dialogPopup) {
      try { const rp = await createDialogPopup(site, plan.dialogPopup); const pid = rp?.data?.rows?.id ?? rp?.data?.id; if (pid) dialogPopup = { id: pid, ...plan.dialogPopup }; } catch {}
    }
    const putBody = plan.buildUpdate(existing.id, templateId, dialogPopup);
    await updatePromotion(site, existing.id, putBody);
    console.log(`  ✓ ${t.site} ${t.code} (promo ${existing.id}): MT ${templateId} created + linked${dialogPopup ? ` + popup ${dialogPopup.id}` : ''}`);
  } catch (e) { console.log(`  ✗ ${t.site} ${t.code}: ${e.message.split('\n')[0].slice(0, 90)}`); }
}

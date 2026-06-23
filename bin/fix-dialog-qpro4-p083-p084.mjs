#!/usr/bin/env node
// Create and link dialog popups for QPRO4 P083 (id=454) and P084 (id=455).
// Popups were skipped when these promos were replicated from QPRO1.

import fs from 'fs';
import { getSite } from '../src/sites.js';
import { authedFetch, createDialogPopup } from '../src/api-client.js';
import { buildApiPlan } from '../src/api-mapper-qpro.js';

const site = getSite('qpro4');

const JOBS = [
  { label: 'P083', fixture: 'captures/requests/P083-r84.json', promoId: 454, templateId: 416 },
  { label: 'P084', fixture: 'captures/requests/P084-r85.json', promoId: 455, templateId: 417 },
];

for (const job of JOBS) {
  console.log(`\n── ${job.label} (promo ${job.promoId}) ──`);
  const resolved = JSON.parse(fs.readFileSync(job.fixture, 'utf8'));

  const plan = await buildApiPlan(resolved, { brand: 'QPRO4', site });

  if (!plan.dialogPopup) {
    console.log('  ⚠ buildApiPlan returned no dialogPopup — popup_dialog not set or cashback type; skipping');
    continue;
  }

  // 1. POST the dialog popup
  console.log('  1. POST /api/bo/popups …');
  const r3 = await createDialogPopup(site, plan.dialogPopup);
  const popupRows = r3?.data?.rows || r3?.data;
  if (!popupRows?.id) {
    console.log('  ✗ POST /popups returned no id:', JSON.stringify(r3?.data).slice(0, 200));
    continue;
  }
  const dialogPopup = {
    id: popupRows.id,
    code: popupRows.code,
    start_date: popupRows.start_date || plan.dialogPopup.start_date,
    label: resolved.promotion_name_en,
  };
  console.log(`  ✓ popup created: id=${dialogPopup.id}  code=${dialogPopup.code}`);

  // 2. PUT promotion to link the popup (also re-applies blacklist=10)
  console.log(`  2. PUT /api/bo/promotion/${job.promoId} …`);
  const putBody = plan.buildUpdate(job.promoId, job.templateId, dialogPopup);
  const r5 = await authedFetch(site, `/api/bo/promotion/${job.promoId}`, {
    method: 'PUT',
    body: putBody,
  });
  const ok = r5?.data?.rows?.id === job.promoId;
  console.log(`  PUT: ${ok ? '✓ success' : '✗ unexpected'}  ${JSON.stringify(r5?.data || r5).slice(0, 150)}`);

  // QC
  const verify = await authedFetch(site, `/api/bo/promotion/${job.promoId}`);
  const p = verify?.data?.rows;
  const linked = Array.isArray(p?.dialog_popup_list)
    ? p.dialog_popup_list.some((d) => d.popup_id === dialogPopup.id)
    : (p?.dialog_popup_list != null);
  console.log(`  QC dialog linked: ${linked ? '✓ yes' : '✗ NO'}  dialog_popup_list=${JSON.stringify(p?.dialog_popup_list)?.slice(0, 120)}`);
  console.log(`  QC blacklist_id: ${p?.blacklist_id}`);
}

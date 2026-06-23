#!/usr/bin/env node
// One-shot: apply copy-generator subject + dialog title to P001-P008 (June 2026).
// Updates existing MT subject lines and dialog popup titles on QPRO4 + QP2C.
// Does NOT touch promo records, sheet, or renderer pipeline.

import { readFile } from 'node:fs/promises';
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';
import { generateCopy } from '../src/copy-generator.js';

const TARGETS = [
  { handle: 'P001', fixture: 'P001-r2', qpro: { promoId: 436, mtId: 399, dialogId: 312 }, qp2: { promoId: 1234, mtId: 1162, dialogId: 1475 } },
  { handle: 'P002', fixture: 'P002-r3', qpro: { promoId: 437, mtId: 400, dialogId: 313 }, qp2: { promoId: 1235, mtId: 1163, dialogId: 1476 } },
  { handle: 'P003', fixture: 'P003-r4', qpro: { promoId: 438, mtId: 401, dialogId: 314 }, qp2: { promoId: 1236, mtId: 1164, dialogId: 1477 } },
  { handle: 'P004', fixture: 'P004-r5', qpro: { promoId: 439, mtId: 402, dialogId: 315 }, qp2: { promoId: 1237, mtId: 1165, dialogId: 1478 } },
  { handle: 'P005', fixture: 'P005-r6', qpro: { promoId: 440, mtId: 403, dialogId: 316 }, qp2: { promoId: 1238, mtId: 1166, dialogId: 1479 } },
  { handle: 'P006', fixture: 'P006-r7', qpro: { promoId: 441, mtId: 404, dialogId: 317 }, qp2: { promoId: 1239, mtId: 1167, dialogId: 1480 } },
  { handle: 'P007', fixture: 'P007-r8', qpro: { promoId: 442, mtId: 405, dialogId: 318 }, qp2: { promoId: 1240, mtId: 1168, dialogId: 1481 } },
  { handle: 'P008', fixture: 'P008-r9', qpro: { promoId: 443, mtId: 406, dialogId: 319 }, qp2: { promoId: 1241, mtId: 1169, dialogId: 1482 } },
];

const qpro4 = getSite('qpro4');
const ibc22 = getSite('ibc22');

// ── MT subject update ─────────────────────────────────────────────────────
async function updateMtSubject(site, mtId, record, platform) {
  const res = await authedFetch(site, `/api/bo/messagetemplate/${mtId}`);
  const data = res?.data?.rows || res?.data;
  const tmpl = data?.message_template;
  const msgDetails = data?.message_details || {};
  if (!tmpl) throw new Error(`MT ${mtId} not found`);

  const details = {};
  for (const [localeId, entry] of Object.entries(msgDetails)) {
    const dk = entry.settings_locales_code?.endsWith('_ZH') ? 'ZH'
             : entry.settings_locales_code?.endsWith('_ID') ? 'ID' : 'EN';
    const copy = generateCopy(record, dk);
    const newSubject = copy?.mt?.subject || entry.subject;
    details[localeId] = {
      settings_locale_id: entry.settings_locale_id,
      subject: newSubject,
      message: entry.message,
    };
    console.log(`    ${entry.settings_locales_code}: subject → "${newSubject}"`);
  }

  const putBody = { name: tmpl.name, section: tmpl.section, type: tmpl.type, status: tmpl.status, details };
  if (platform === 'qpro') putBody.code = tmpl.code;  // QP2 omits code (422)
  const putRes = await authedFetch(site, `/api/bo/messagetemplate/${mtId}`, { method: 'PUT', body: putBody });
  return putRes?.success === true;
}

// Convert ISO date → Y-m-d H:i:s (what the BO PUT expects)
function toBoDate(iso) {
  if (!iso) return null;
  return iso.replace('T', ' ').replace(/\.\d+Z$/, '').replace('Z', '');
}

// ── Dialog title update ───────────────────────────────────────────────────
async function updateDialogTitle(site, dialogId, record, platform) {
  // Fetch full popup row from listing
  let popupRow = null;
  let page = 1;
  while (!popupRow) {
    const res = await authedFetch(site, `/api/bo/popups?page=${page}&perPage=50`);
    const rows = res?.data?.rows || [];
    popupRow = rows.find(r => r.id === dialogId);
    if (rows.length < 50 || popupRow) break;
    page++;
  }
  if (!popupRow) throw new Error(`Dialog ${dialogId} not found in listing`);

  // locale_name format: "English (MY)" / "简体中文 (MY)" / "Bahasa Indonesia (ID)"
  function dkFromLocaleName(name) {
    if (!name) return 'EN';
    if (/中文|ZH/i.test(name)) return 'ZH';
    if (/indonesia|bahasa|ID/i.test(name)) return 'ID';
    return 'EN';
  }

  // Build updated contents with new titles per locale
  const contents = {};
  for (const [idx, content] of Object.entries(popupRow.contents || {})) {
    const dk = dkFromLocaleName(content.locale_name);
    const copy = generateCopy(record, dk);
    const newTitle = copy?.dialog?.title || content.title;
    contents[idx] = { ...content, title: newTitle };
    console.log(`    locale ${content.locale_id} (${content.locale_name}): title → "${newTitle}"`);
  }

  // Fix date format: ISO → Y-m-d H:i:s
  const putBody = {
    ...popupRow,
    start_date: toBoDate(popupRow.start_date),
    end_date:   toBoDate(popupRow.end_date),
    contents,
  };
  const putRes = await authedFetch(site, `/api/bo/popups/${dialogId}`, { method: 'PUT', body: putBody });
  return putRes?.success === true || putRes?.data != null;
}

// ── Main loop ─────────────────────────────────────────────────────────────
for (const t of TARGETS) {
  const record = JSON.parse(await readFile(`captures/requests/${t.fixture}.json`, 'utf8'));
  const copyEN = generateCopy(record, 'EN');
  console.log(`\n══ ${t.handle} | ${record.bonus_type} | tone: ${copyEN.tone}`);
  console.log(`   dialog: "${copyEN.dialog.title}"  |  subject: "${copyEN.mt.subject}"`);

  // QPRO4
  // MT subjects already updated — dialog only
  console.log('  [QPRO4] Dialog title:');
  try {
    const ok = await updateDialogTitle(qpro4, t.qpro.dialogId, record, 'qpro');
    console.log(`  [QPRO4] Dialog → ${ok ? '✓' : '✗'}`);
  } catch (e) { console.log(`  [QPRO4] Dialog ✗ ${e.message}`); }

  // QP2C — dialog only
  console.log('  [QP2C]  Dialog title:');
  try {
    const ok = await updateDialogTitle(ibc22, t.qp2.dialogId, record, 'qp2');
    console.log(`  [QP2C]  Dialog → ${ok ? '✓' : '✗'}`);
  } catch (e) { console.log(`  [QP2C]  Dialog ✗ ${e.message}`); }
}

console.log('\nDone.');

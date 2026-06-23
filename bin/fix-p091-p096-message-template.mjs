#!/usr/bin/env node
// Re-render and PUT-update message templates for P091-P096 across QP2C + QPRO4.
//
// Operator rule (2026-05-20):
//   1. Subject = "Exclusive Offer" (plain — no percentage, no sub-type).
//      ZH = "独家优惠", ID = "Penawaran Eksklusif".
//   2. Body table swaps the "Bonus Percentage" column for "Max Bonus" with
//      the actual amount per currency.
//
// Templates updated in src/message-template-bodies/deposit/*.html + the
// SUBJECT_TEMPLATES in src/message-template-renderer.js. This script
// re-renders each promo's body per locale and PUT-updates the live
// message template's contents.
//
// PUT shape (probed 2026-05-20):
//   PUT /api/bo/messagetemplate/{id}
//   { name, section, type, status, code,
//     details: { '<locale_id>': { settings_locale_id, subject, message } } }
//
// Usage: node bin/fix-p091-p096-message-template.mjs [--commit]

import fs from 'node:fs';
import { authedFetch } from '../src/api-client.js';
import { renderBody } from '../src/message-template-renderer.js';
import { getSite } from '../src/sites.js';

const commit = process.argv.includes('--commit');

const targets = [
  { handle: 'P091-r92', qp2cTpl: 1058, qproTpl: 326 },
  { handle: 'P092-r93', qp2cTpl: 1059, qproTpl: 327 },
  { handle: 'P093-r94', qp2cTpl: 1060, qproTpl: 328 },
  { handle: 'P094-r95', qp2cTpl: 1061, qproTpl: 329 },
  { handle: 'P095-r96', qp2cTpl: 1062, qproTpl: 330 },
  { handle: 'P096-r97', qp2cTpl: 1063, qproTpl: 331 },
];

const LOCALE_IDS = { MY_EN: 1, MY_ZH: 3, SG_EN: 6, SG_ZH: 7, ID_EN: 8, ID_ID: 9 };

async function updateTemplate(site, tplId, resolved, brand, platform) {
  const r = await authedFetch(site, `/api/bo/messagetemplate/${tplId}`);
  const m1 = r.data?.message_template;
  const existing = r.data?.message_details || {};
  if (!m1) return { ok: false, reason: 'template not found' };

  // Render per locale that already exists on this template (don't add new locales).
  const newDetails = {};
  for (const [localeIdStr, row] of Object.entries(existing)) {
    const localeId = Number(localeIdStr);
    // Reverse-lookup locale code
    const locale = Object.entries(LOCALE_IDS).find(([_, v]) => v === localeId)?.[0];
    if (!locale) {
      console.log(`    ! unknown locale_id=${localeId}, preserving existing row`);
      newDetails[localeIdStr] = { settings_locale_id: localeId, subject: row.subject, message: row.message };
      continue;
    }
    const rendered = await renderBody({ bonusType: resolved.bonus_type, locale, brand, platform, resolved });
    if (rendered.skipped) {
      newDetails[localeIdStr] = { settings_locale_id: localeId, subject: row.subject, message: row.message };
      continue;
    }
    newDetails[localeIdStr] = {
      settings_locale_id: localeId,
      subject: rendered.subject,
      message: rendered.html,
    };
  }

  // QP2 PUT validator rejects `code` as "already taken" (no unique-except-self
  // exception). QPRO accepts code. Send code conditionally.
  const isQp2 = platform === 'qp2';
  const body = {
    name: m1.name,
    section: m1.section,
    type: m1.type,
    status: m1.status,
    details: newDetails,
  };
  if (!isQp2) body.code = m1.code;
  try {
    const res = await authedFetch(site, `/api/bo/messagetemplate/${tplId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return { ok: res.success, message: res.message?.[0], localesUpdated: Object.keys(newDetails).length };
  } catch (e) {
    return { ok: false, reason: e.message.split('\n').slice(0,2).join(' | ').slice(0,200) };
  }
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`FIX P091-P096 message templates — ${commit ? 'LIVE' : 'DRY-RUN'}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

const qpro = getSite('qpro4');
const qp2 = getSite('ibc22');

for (const t of targets) {
  const resolved = JSON.parse(fs.readFileSync(`captures/requests/${t.handle}.json`, 'utf8'));
  console.log(`\n${t.handle}`);

  // QPRO4
  {
    const r = await authedFetch(qpro, `/api/bo/messagetemplate/${t.qproTpl}`);
    const existing = r.data?.message_details || {};
    console.log(`  QPRO4 template ${t.qproTpl}: ${Object.keys(existing).length} existing locales`);
    for (const [k, v] of Object.entries(existing)) console.log(`    locale=${k} subject="${v.subject}"`);
    if (commit) {
      const result = await updateTemplate(qpro, t.qproTpl, resolved, 'QPRO4', 'qpro');
      console.log(`    → PUT result: ok=${result.ok} ${result.message || result.reason || ''}`);
    }
  }

  // QP2C
  {
    const r = await authedFetch(qp2, `/api/bo/messagetemplate/${t.qp2cTpl}`);
    const existing = r.data?.message_details || {};
    console.log(`  QP2C  template ${t.qp2cTpl}: ${Object.keys(existing).length} existing locales`);
    for (const [k, v] of Object.entries(existing)) console.log(`    locale=${k} subject="${v.subject}"`);
    if (commit) {
      const result = await updateTemplate(qp2, t.qp2cTpl, resolved, 'QP2C', 'qp2');
      console.log(`    → PUT result: ok=${result.ok} ${result.message || result.reason || ''}`);
    }
  }
}

console.log('\nDone.');

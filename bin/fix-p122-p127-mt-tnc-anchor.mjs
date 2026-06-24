#!/usr/bin/env node
/**
 * Patch QP2A message templates 1193-1198 (P122-P127) — wrap the sentence-11
 * T&C anchor that the QP2 codepath of message-template-renderer.js was skipping.
 *
 * Surgical regex on the existing locale message bodies; does NOT re-render
 * other fields. Safe to re-run (idempotent — already-wrapped anchors are
 * detected and skipped).
 *
 * Usage: node bin/fix-p122-p127-mt-tnc-anchor.mjs [--commit]
 */

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const commit = process.argv.includes('--commit');

const TEMPLATES = [
  { pId: 'P122', tplId: 1193 },
  { pId: 'P123', tplId: 1194 },
  { pId: 'P124', tplId: 1195 },
  { pId: 'P125', tplId: 1196 },
  { pId: 'P126', tplId: 1197 },
  { pId: 'P127', tplId: 1198 },
];

const TNC_TERM = {
  EN: 'Terms and Conditions',
  ZH: '条款与条件',
  ID: 'Syarat dan Ketentuan',
  TH: 'ข้อกำหนดและเงื่อนไข',
};

function docKeyFromLocaleId(id) {
  // 1=MY_EN 3=MY_ZH 6=SG_EN 7=SG_ZH 8=ID_EN 9=ID_ID 10=TH_EN 11=TH_TH
  if ([1, 6, 8, 10].includes(id)) return 'EN';
  if ([3, 7].includes(id)) return 'ZH';
  if (id === 9) return 'ID';
  if (id === 11) return 'TH';
  return 'EN';
}

function patchAnchor(body, docKey) {
  if (!body || typeof body !== 'string') return { body, changed: false, reason: 'empty' };
  const term = TNC_TERM[docKey] || TNC_TERM.EN;

  // Idempotent: if anchor already wrapped, skip.
  if (body.includes(`href=":url/terms-conditions">${term}</a>`)) {
    return { body, changed: false, reason: 'already wrapped' };
  }

  // Target the <li> with plain-text :url/terms-conditions and wrap the term.
  const liRegex = /<li>([^<]*)\s*:url\/terms-conditions\s*([^<]*)<\/li>/;
  const match = body.match(liRegex);
  if (!match) return { body, changed: false, reason: 'no :url/terms-conditions <li> found' };

  const next = body.replace(liRegex, (m, before, after) => {
    if (!before.includes(term)) return m; // term missing → can't safely wrap
    const linked = before.replace(term, `<a target="_blank" href=":url/terms-conditions">${term}</a>`);
    return `<li>${(linked + after).trimEnd()}</li>`;
  });

  if (next === body) return { body, changed: false, reason: `term "${term}" not in <li>` };
  return { body: next, changed: true };
}

const site = getSite('ibc22');

console.log('═'.repeat(62));
console.log(`FIX P122-P127 MT sentence-11 anchor — ${commit ? 'LIVE COMMIT' : 'DRY-RUN (add --commit to save)'}`);
console.log('═'.repeat(62));

let totalPass = 0, totalFail = 0;

for (const t of TEMPLATES) {
  console.log(`\n${t.pId} — QP2A template ${t.tplId}:`);
  const r = await authedFetch(site, `/api/bo/messagetemplate/${t.tplId}`);
  const m1 = r.data?.message_template;
  const existing = r.data?.message_details || {};
  if (!m1) {
    console.log('  ✗ FAIL — template not found');
    totalFail++;
    continue;
  }

  console.log(`  name="${m1.name}" locales=[${Object.keys(existing).join(',')}]`);

  const newDetails = {};
  let anyChanged = false;
  for (const [localeIdStr, row] of Object.entries(existing)) {
    const localeId = Number(localeIdStr);
    const docKey = docKeyFromLocaleId(localeId);
    const { body, changed, reason } = patchAnchor(row.message, docKey);
    if (changed) anyChanged = true;
    console.log(`    locale=${localeId} (${docKey}) — ${changed ? 'PATCHING' : `no change (${reason})`}`);
    newDetails[localeIdStr] = {
      settings_locale_id: localeId,
      subject: row.subject,
      message: changed ? body : row.message,
    };
  }

  if (!anyChanged) {
    console.log('  → skipped (no changes needed)');
    totalPass++;
    continue;
  }

  if (!commit) {
    console.log('  → dry-run only — re-run with --commit to save');
    totalPass++;
    continue;
  }

  const putBody = {
    name: m1.name,
    section: m1.section,
    type: m1.type,
    status: m1.status,
    details: newDetails,
  };

  try {
    const res = await authedFetch(site, `/api/bo/messagetemplate/${t.tplId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(putBody),
    });
    const ok = res.success !== false;
    console.log(`  → ${ok ? '✓ OK' : '✗ FAIL'} ${res.message ? `(${res.message?.[0] || res.message})` : ''}`);
    if (ok) totalPass++; else totalFail++;
  } catch (e) {
    console.log(`  ✗ FAIL — ${String(e.message || e).split('\n')[0]}`);
    totalFail++;
  }
}

console.log('\n' + '─'.repeat(40));
console.log(`Summary: ${totalPass} passed, ${totalFail} failed`);
if (!commit) console.log('(dry-run — re-run with --commit to save)');

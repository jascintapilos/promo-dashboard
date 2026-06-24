#!/usr/bin/env node
/**
 * Patch QPRO2/3/4 message templates for P122 — wrap the sentence-11 T&C anchor
 * that was missing because the MT was saved before the renderer fix (2026-06-23).
 *
 * QPRO anchor has NO target="_blank" (QP2 does; QPRO does not).
 *
 * Templates:
 *   QPRO2 P122 → tpl 422  (site: qpro2)
 *   QPRO3 P122 → tpl 491  (site: qpro3)
 *   QPRO4 P122 → tpl 423  (site: qpro4)
 *
 * Idempotent — already-wrapped anchors are detected and skipped.
 *
 * Usage: node bin/fix-p122-qpro234-mt-tnc-anchor.mjs [--commit]
 */

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const commit = process.argv.includes('--commit');

const TEMPLATES = [
  { pId: 'P122', brand: 'QPRO2', siteId: 'qpro2', tplId: 422 },
  { pId: 'P122', brand: 'QPRO3', siteId: 'qpro3', tplId: 491 },
  { pId: 'P122', brand: 'QPRO4', siteId: 'qpro4', tplId: 423 },
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

  // Idempotent: if anchor already present, skip.
  if (body.includes(`href=":url/terms-conditions">${term}</a>`)) {
    return { body, changed: false, reason: 'already wrapped' };
  }

  // Case 1: body has `:url/terms-conditions` as plain text (QP2 pattern).
  // Wrap the T&C term and remove the dangling placeholder.
  const liWithUrl = /<li>([^<]*)\s*:url\/terms-conditions\s*([^<]*)<\/li>/;
  if (liWithUrl.test(body)) {
    const next = body.replace(liWithUrl, (m, before, after) => {
      if (!before.includes(term)) return m;
      const linked = before.replace(term, `<a href=":url/terms-conditions">${term}</a>`);
      return `<li>${(linked + after).trimEnd()}</li>`;
    });
    if (next !== body) return { body: next, changed: true };
  }

  // Case 2: body has the T&C term as plain text (no URL placeholder) — QPRO pattern.
  // Find the LAST <li> containing the term and inject the anchor in-place.
  // Use a global regex to replace only the last occurrence in a <li>.
  const liWithTerm = new RegExp(`(<li>[^<]*?)${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^<]*<\\/li>)`, 'g');
  let lastMatch = null;
  let m;
  while ((m = liWithTerm.exec(body)) !== null) lastMatch = m;
  if (!lastMatch) return { body, changed: false, reason: `term "${term}" not found in any <li>` };

  const linked = lastMatch[0].replace(term, `<a href=":url/terms-conditions">${term}</a>`);
  const next = body.slice(0, lastMatch.index) + linked + body.slice(lastMatch.index + lastMatch[0].length);
  return { body: next, changed: true };
}

console.log('═'.repeat(62));
console.log(`FIX P122 QPRO2/3/4 MT sentence-11 anchor — ${commit ? 'LIVE COMMIT' : 'DRY-RUN (add --commit to save)'}`);
console.log('═'.repeat(62));

let totalPass = 0, totalFail = 0;

for (const t of TEMPLATES) {
  const site = getSite(t.siteId);
  console.log(`\n${t.pId} — ${t.brand} (${t.siteId}) template ${t.tplId}:`);
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

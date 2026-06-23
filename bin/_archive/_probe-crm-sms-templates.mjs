#!/usr/bin/env node
// READ-ONLY probe. Dump every CRM.SMS.* message template on ibc22 (QP2) with
// per-locale subject + message, so we can compare each against the hand-fixed
// reference CRM.SMS.FT_REL_TLEO_45PCT_228MX_BR.20260526093052 (updated by
// waiyip 2026-06-07). Goal: find the literal brand token that needs to become
// :merchantname and the EXACT spacing waiyip used. No writes.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dir, '../captures/api-runs/crm-sms-probe.json');

const REF_CODE = 'CRM.SMS.FT_REL_TLEO_45PCT_228MX_BR.20260526093052';
const site = getSite('ibc22');

// Candidate literal brand tokens to flag (case-insensitive). The reference
// should contain :merchantname and NONE of these.
const BRAND_TOKENS = ['IBC22', 'KING333', 'ACE66', 'SPADE66', 'I22', '12HUAT', 'BP9', 'IBC 22'];

const LOC = { 1: 'MY_EN', 3: 'MY_ZH', 6: 'SG_EN', 7: 'SG_ZH', 8: 'ID_EN', 9: 'ID_ID' };

// 1. List all templates, keep CRM.SMS.*
const all = [];
for (let pg = 1; pg <= 30; pg++) {
  const r = await authedFetch(site, `/api/bo/messagetemplate?perPage=200&page=${pg}`);
  const rows = Object.values(r.data?.rows || {});
  if (!rows.length) break;
  all.push(...rows);
  const last = r.data?.paginations?.last_page ?? 1;
  if (pg >= last) break;
}
const crm = all.filter((t) => String(t.code || '').startsWith('CRM.SMS.'));
console.log(`Total templates on ${site.id}: ${all.length} | CRM.SMS.*: ${crm.length}`);

// 2. Detail for each (sequential — small N)
const templates = [];
for (const t of crm) {
  const r = await authedFetch(site, `/api/bo/messagetemplate/${t.id}?edit=1`);
  const tpl = r.data?.message_template || {};
  const details = r.data?.message_details || {};
  const locales = {};
  for (const [k, v] of Object.entries(details)) {
    locales[k] = { settings_locale_id: Number(k), subject: v.subject ?? '', message: v.message ?? '' };
  }
  templates.push({ id: t.id, code: t.code, name: tpl.name, section: tpl.section, type: tpl.type, status: tpl.status, locales });
}
templates.sort((a, b) => a.code.localeCompare(b.code));

fs.writeFileSync(OUT, JSON.stringify({ site: site.id, ref_code: REF_CODE, count: templates.length, templates }, null, 2));
console.log(`Saved → ${OUT}\n`);

// 3. Reference — print RAW per-locale (exact spacing matters)
const ref = templates.find((t) => t.code === REF_CODE);
console.log('━'.repeat(80));
if (!ref) {
  console.log(`REFERENCE NOT FOUND: ${REF_CODE}`);
} else {
  console.log(`REFERENCE  id=${ref.id}  name="${ref.name}"  status=${ref.status}`);
  for (const [k, v] of Object.entries(ref.locales)) {
    console.log(`\n  ── ${LOC[k] || k} ──`);
    console.log(`     subject: ${JSON.stringify(v.subject)}`);
    console.log(`     message: ${JSON.stringify(v.message)}`);
  }
}
console.log('━'.repeat(80));

// 4. Distinct-body grouping (signature = per-locale message) + brand-token scan
const sig = (t) => Object.entries(t.locales).sort().map(([k, v]) => `${k}:${v.message}`).join('||');
const groups = new Map();
for (const t of templates) {
  const s = sig(t);
  if (!groups.has(s)) groups.set(s, []);
  groups.get(s).push(t.code);
}
console.log(`\nDISTINCT BODY GROUPS: ${groups.size} (across ${templates.length} templates)`);
let gi = 0;
for (const [, codes] of groups) {
  gi++;
  const sample = templates.find((t) => codes.includes(t.code));
  const isRef = codes.includes(REF_CODE);
  console.log(`\n  Group ${gi}${isRef ? '  ◄ contains REFERENCE' : ''} — ${codes.length} template(s)`);
  console.log(`    e.g. ${codes.slice(0, 4).join(', ')}${codes.length > 4 ? ` (+${codes.length - 4})` : ''}`);
  for (const [k, v] of Object.entries(sample.locales)) {
    const tokenHits = BRAND_TOKENS.filter((tok) => new RegExp(tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(v.message));
    const mn = (v.message.match(/:merchantname/g) || []).length;
    console.log(`      ${LOC[k] || k}: :merchantname×${mn}  literal[${tokenHits.join(',') || '—'}]  ${JSON.stringify(v.message.slice(0, 160))}`);
  }
}

// 5. Per-template brand-token summary table
console.log(`\n${'━'.repeat(80)}\nBRAND-TOKEN HITS PER TEMPLATE (anything in the literal column needs :merchantname)\n${'━'.repeat(80)}`);
console.log('id'.padEnd(7) + 'merchantname'.padEnd(14) + 'literalHits'.padEnd(22) + 'code');
for (const t of templates) {
  let mnTotal = 0; const lits = new Set();
  for (const v of Object.values(t.locales)) {
    mnTotal += (v.message.match(/:merchantname/g) || []).length;
    for (const tok of BRAND_TOKENS) if (new RegExp(tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(v.message)) lits.add(tok);
  }
  const flag = lits.size ? ' ◄' : '';
  console.log(String(t.id).padEnd(7) + String(mnTotal).padEnd(14) + ([...lits].join(',') || '—').padEnd(22) + t.code + flag);
}

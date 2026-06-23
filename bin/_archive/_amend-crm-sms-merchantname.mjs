#!/usr/bin/env node
// Amend all CRM.SMS.* SMS templates on ibc22 (QP2): replace the hardcoded
// brand "ACE66"/"ace66" with the :merchantname variable, reproducing waiyip's
// hand-fix on CRM.SMS.FT_REL_TLEO_45PCT_228MX_BR.20260526093052 (id 1138).
//
// Core transform per locale message:  /ace66/gi  ->  :merchantname
//   "RM0 ACE66: :username"   -> "RM0 :merchantname: :username"
//   "ace66my(dot)com"        -> ":merchantnamemy(dot)com"
//   "ace66sg(dot)com"        -> ":merchantnamesg(dot)com"
// All other characters/spacing preserved byte-for-byte. Idempotent.
//
// id 1075 (FT_REL_TLEO_45PCT_48MX) was partially hand-edited and carries
// pre-existing messy spacing (stray &nbsp; before URL, half-width colon, a
// space after the full-width colon). The plain swap leaves those quirks.
// Pass --normalize-anomaly to instead rewrite 1075 to the clean VIP body.
//
// QP2 PUT rule: OMIT `code` (validator 422s "already taken"). Preserve
// name/section/type/status. Subjects unchanged.
//
// Usage:
//   node bin/_amend-crm-sms-merchantname.mjs                       (dry-run)
//   node bin/_amend-crm-sms-merchantname.mjs --commit
//   node bin/_amend-crm-sms-merchantname.mjs --commit --normalize-anomaly

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const commit = process.argv.includes('--commit');
const normalizeAnomaly = process.argv.includes('--normalize-anomaly');
const __dir = path.dirname(fileURLToPath(import.meta.url));
const LOG = path.resolve(__dir, `../captures/api-runs/crm-sms-amend-${commit ? 'commit' : 'dryrun'}.json`);

const REF_CODE = 'CRM.SMS.FT_REL_TLEO_45PCT_228MX_BR.20260526093052';
const ANOMALY_ID = 1075;
const BRAND_RE = /ace66/gi;
const site = getSite('ibc22');
const LOC = { 1: 'MY_EN', 3: 'MY_ZH', 6: 'SG_EN', 7: 'SG_ZH', 8: 'ID_EN', 9: 'ID_ID' };

const swap = (s) => String(s ?? '').replace(BRAND_RE, ':merchantname');
const tierOf = (details) => {
  const txt = Object.values(details).map((v) => v.message || '').join(' ');
  if (/VIP/.test(txt)) return 'VIP';
  if (/member reward/i.test(txt) || /会员专属/.test(txt)) return 'MEMBER';
  return 'UNKNOWN';
};

console.log(`CRM.SMS amend on ${site.id} — ${commit ? 'LIVE COMMIT' : 'DRY-RUN'}${normalizeAnomaly ? ' (+normalize 1075)' : ''}`);

// 1. list all CRM.SMS templates
const all = [];
for (let pg = 1; pg <= 30; pg++) {
  const r = await authedFetch(site, `/api/bo/messagetemplate?perPage=200&page=${pg}`);
  const rows = Object.values(r.data?.rows || {});
  if (!rows.length) break;
  all.push(...rows);
  if (pg >= (r.data?.paginations?.last_page ?? 1)) break;
}
const crm = all.filter((t) => String(t.code || '').startsWith('CRM.SMS.'));

// 2. detail for each
const detailed = [];
for (const t of crm) {
  const r = await authedFetch(site, `/api/bo/messagetemplate/${t.id}?edit=1`);
  detailed.push({ id: t.id, code: t.code, m: r.data?.message_template || {}, details: r.data?.message_details || {} });
}

// 3. clean VIP canonical (post-swap) from a VIP sibling (excl. anomaly + ref)
const vipSibling = detailed.find((d) => d.id !== ANOMALY_ID && d.code !== REF_CODE && tierOf(d.details) === 'VIP');
const vipCanonical = {};
if (vipSibling) for (const [k, v] of Object.entries(vipSibling.details)) vipCanonical[k] = swap(v.message);

// 4. transform + (optionally) PUT
const results = [];
for (const d of detailed) {
  if (d.code === REF_CODE) { results.push({ id: d.id, code: d.code, action: 'skip-reference' }); continue; }
  const tier = tierOf(d.details);
  const newDetails = {}; const diffs = []; let changed = false;
  for (const [k, v] of Object.entries(d.details)) {
    const nm = (d.id === ANOMALY_ID && normalizeAnomaly && vipCanonical[k]) ? vipCanonical[k] : swap(v.message);
    if (nm !== v.message) { changed = true; diffs.push({ loc: LOC[k] || k, before: v.message, after: nm }); }
    newDetails[k] = { settings_locale_id: Number(k), subject: v.subject, message: nm };
  }
  const residual = [];
  for (const [k, nd] of Object.entries(newDetails)) {
    if (/ace66/i.test(nd.message)) residual.push(`${LOC[k]}:ACE66-remains`);
    if (/&nbsp;:merchantname/i.test(nd.message)) residual.push(`${LOC[k]}:stray-nbsp`);
    if (/：\s+:merchantname/.test(nd.message)) residual.push(`${LOC[k]}:space-after-fullcolon`);
    if (/： ?:username/.test(nd.message) === false && /:merchantname: :merchantname/.test(nd.message)) residual.push(`${LOC[k]}:double-var`);
  }
  const rec = { id: d.id, code: d.code, tier, changed, diffs, residual };
  if (commit && changed) {
    const body = { name: d.m.name, section: d.m.section, type: d.m.type, status: d.m.status, details: newDetails };
    try {
      const res = await authedFetch(site, `/api/bo/messagetemplate/${d.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      rec.put = { ok: res?.success !== false, message: Array.isArray(res?.message) ? res.message.join(' | ') : res?.message };
    } catch (e) { rec.put = { ok: false, error: String(e.message).split('\n').slice(0, 2).join(' | ').slice(0, 200) }; }
  }
  results.push(rec);
}

fs.writeFileSync(LOG, JSON.stringify({ site: site.id, commit, normalizeAnomaly, results }, null, 2));

// 5. summary
const changed = results.filter((r) => r.changed);
const skipped = results.filter((r) => r.action === 'skip-reference');
const unchanged = results.filter((r) => !r.changed && !r.action);
const byTier = (t) => changed.filter((r) => r.tier === t).length;
console.log(`\nCRM.SMS templates: ${results.length}`);
console.log(`  to change : ${changed.length}  (MEMBER ${byTier('MEMBER')} · VIP ${byTier('VIP')} · UNKNOWN ${byTier('UNKNOWN')})`);
console.log(`  reference : ${skipped.length} skipped (already clean)`);
console.log(`  unchanged : ${unchanged.length}`);

const withResidual = changed.filter((r) => r.residual.length);
console.log(`\nResidual spacing flags after transform: ${withResidual.length}`);
for (const r of withResidual) console.log(`  id=${r.id} ${r.code}\n     ${r.residual.join(', ')}`);

// show one MEMBER + one VIP full before/after
for (const tier of ['MEMBER', 'VIP']) {
  const ex = changed.find((r) => r.tier === tier && r.id !== ANOMALY_ID);
  if (!ex) continue;
  console.log(`\n── ${tier} example: id=${ex.id} ${ex.code} ──`);
  for (const dff of ex.diffs) {
    console.log(`  ${dff.loc}`);
    console.log(`    before: ${JSON.stringify(dff.before)}`);
    console.log(`    after : ${JSON.stringify(dff.after)}`);
  }
}

// anomaly detail
const an = results.find((r) => r.id === ANOMALY_ID);
if (an) {
  console.log(`\n── ANOMALY id=${ANOMALY_ID} ${an.code} (${normalizeAnomaly ? 'NORMALIZED to clean VIP' : 'plain swap'}) ──`);
  for (const dff of an.diffs) {
    console.log(`  ${dff.loc}`);
    console.log(`    before: ${JSON.stringify(dff.before)}`);
    console.log(`    after : ${JSON.stringify(dff.after)}`);
  }
}

if (commit) {
  const puts = results.filter((r) => r.put);
  const ok = puts.filter((r) => r.put.ok).length;
  console.log(`\nPUT results: ${ok}/${puts.length} ok`);
  for (const r of puts.filter((x) => !x.put.ok)) console.log(`  ✗ id=${r.id} ${r.code}: ${r.put.error || r.put.message}`);
}
console.log(`\nLog → ${LOG}`);
console.log(commit ? '\nCOMMIT complete.' : '\n(dry-run — no writes. add --commit to apply.)');

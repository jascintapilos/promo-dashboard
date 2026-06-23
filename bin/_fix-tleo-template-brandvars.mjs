#!/usr/bin/env node
// Replace hardcoded brand/domain refs ("12HUAT", "12huatmy.com") with the
// :brandname variable + relative T&C links across ALL TLEO message templates
// (inbox + SMS) on qpro2/3/4/6/8/10. Re-saves each with integer section/type.
//
// Run: node bin/_fix-tleo-template-brandvars.mjs --dry-run [--brand=qpro3]
//      node bin/_fix-tleo-template-brandvars.mjs --commit  [--brand=qpro3]

import { parseArgs } from './_args.js';
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const { flags } = parseArgs(process.argv.slice(2));
const commit = flags.commit === true;
const dryRun = !commit;
const brandFilter = flags.brand ? String(flags.brand).toLowerCase() : null;

const BRANDS = ['qpro2', 'qpro3', 'qpro4', 'qpro6', 'qpro8', 'qpro10'].filter(b => !brandFilter || b === brandFilter);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function localize(s) {
  if (s == null) return s;
  return String(s)
    .replace(/https?:\/\/12huatmy\.com/gi, '')       // T&C href → relative
    .replace(/12huatmy\{dot\}com/gi, ':brandname')    // SMS literal domain
    .replace(/12huatmy\.com/gi, ':brandname')
    .replace(/12huatmy/gi, ':brandname')
    .replace(/12HUAT/g, ':brandname')
    .replace(/12huat/gi, ':brandname');
}
const hasBrand = s => /12huat/i.test(String(s || ''));

let totalFixed = 0, totalClean = 0, totalErr = 0;
const failures = [];

for (const brand of BRANDS) {
  const site = getSite(brand);
  console.log(`\n━━━ ${brand.toUpperCase()} ━━━`);
  // list TLEO templates
  const tleo = [];
  for (let pg = 1; pg <= 10; pg++) {
    const r = await authedFetch(site, `/api/bo/messagetemplate?perPage=200&page=${pg}`);
    const arr = Object.values(r.data?.rows || {});
    if (!arr.length) break;
    arr.forEach(t => { if (/TLEO/i.test(t.code || '')) tleo.push({ id: t.id, code: t.code }); });
    if (arr.length < 200) break;
  }
  console.log(`  TLEO templates: ${tleo.length}`);

  let fixed = 0, clean = 0;
  for (const t of tleo) {
    try {
      const r = await authedFetch(site, `/api/bo/messagetemplate/${t.id}`);
      const meta = r.data?.message_template || r.data;
      const details = r.data?.message_details || {};
      let dirty = false;
      const newDetails = {};
      for (const [lid, d] of Object.entries(details)) {
        const subj = d.subject, msg = d.message;
        if (hasBrand(subj) || hasBrand(msg)) dirty = true;
        newDetails[lid] = { settings_locale_id: Number(d.settings_locale_id ?? lid), subject: localize(subj), message: localize(msg) };
      }
      if (!dirty) { clean++; totalClean++; continue; }
      if (dryRun) { console.log(`  DRY fix ${t.code} (${Object.keys(newDetails).length} locales)`); fixed++; totalFixed++; continue; }
      const body = { name: meta.name, code: meta.code, section: Number(meta.section), type: Number(meta.type), status: Number(meta.status) || 1, details: newDetails };
      await authedFetch(site, `/api/bo/messagetemplate/${t.id}`, { method: 'PUT', body });
      await sleep(120);
      // verify
      const v = await authedFetch(site, `/api/bo/messagetemplate/${t.id}`);
      const vdet = v.data?.message_details || {};
      const stillBad = Object.values(vdet).some(d => hasBrand(d.subject) || hasBrand(d.message));
      if (stillBad) { console.log(`  ⚠ ${t.code}: still has 12huat after update`); totalErr++; failures.push(`${brand} ${t.code}`); }
      else { console.log(`  ✓ ${t.code} → :brandname`); fixed++; totalFixed++; }
    } catch (e) {
      console.log(`  ✗ ${t.code}: ${e.message.split('\n')[0]}`); totalErr++; failures.push(`${brand} ${t.code}: ${e.message.split('\n')[0]}`);
    }
  }
  console.log(`  ${brand}: fixed ${fixed}, already-clean ${clean}`);
}

console.log(`\n=== SUMMARY ===  Fixed: ${totalFixed}  Clean: ${totalClean}  Errors: ${totalErr}${dryRun ? '  (DRY RUN)' : ''}`);
if (failures.length) failures.forEach(f => console.log('  ' + f));

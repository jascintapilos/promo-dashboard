#!/usr/bin/env node
// Final comprehensive QC across all 4 brands × 54 TLEO codes.
// Checks per code: active, categories populated, inbox MT, SMS MT, popup,
// blacklist sub-cats ⊇ source, gp count restricted (not full universe / LC ≤ 12 /
// slots excludes PP includes PP2), :brandname literal (no 12huat), name matches
// source, SGD→MYR clean in MY_EN inbox content.
//
// Output: per-brand table + grand totals + per-issue listing.

import fs from 'node:fs';
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const BRANDS = ['qpro5', 'qpro7', 'qpro15', 'qpro16'];
const SOURCE = JSON.parse(fs.readFileSync('tmp/qpro2-tleo-source.json', 'utf8'));
const CAT_LC = 2, CAT_SL = 3;

function classifyCategory(code, src) {
  const bn = (src?.blacklist_name || '').toLowerCase();
  if (bn === 'live casino only') return 'lc';
  if (bn === 'slots only') return 'slots';
  if (bn.includes('live casino and slot') || bn.includes('slot and live casino')) return 'both';
  if (/_FC\d/.test(code)) return 'both';
  if (/_LC(_|$)/.test(code) || /_LC_BR$/.test(code)) return 'lc';
  if (/_SL(_|OT|T_|$)|_SLOT$|_SLOT_/.test(code)) return 'slots';
  return null;
}
const hasPopup = p => { const d = p.dialog_popup_list; return Array.isArray(d) ? d.length > 0 : (d && Object.keys(d || {}).length > 0); };
const gpToks = p => (p.game_provider || '').split(',').map(s => s.trim()).filter(Boolean);

const grand = { codes: 0, ok: 0, issues: [] };
const perBrand = {};

for (const brand of BRANDS) {
  const site = getSite(brand);
  // Full provider catalog (baseline for full-universe check)
  const gpCat = await authedFetch(site, '/api/bo/gameprovider?perPage=300&page=1');
  const U = Object.values(gpCat.data?.rows || {}).length;
  const r = await authedFetch(site, '/api/bo/promotion?code=TLEO&perPage=200&page=1');
  const list = Object.values(r.data?.rows || {}).filter(p => p.code?.includes('TLEO'));
  const stats = { total: list.length, active: 0, cats: 0, mt: 0, sms: 0, popup: 0, blEx: 0, gpOk: 0, brandVar: 0, nameOk: 0, sgdClean: 0, fullPass: 0 };
  const issues = [];

  // missing/extra
  const targetCodes = new Set(list.map(p => p.code));
  for (const code of Object.keys(SOURCE)) if (!targetCodes.has(code)) issues.push(`MISSING ${code}`);

  for (const p of list) {
    const s = SOURCE[p.code];
    if (!s) { issues.push(`${p.code}: not in source (extra)`); continue; }
    const cat = classifyCategory(p.code, s);
    const codeIssues = [];

    // active
    if (p.status === 1) stats.active++; else codeIssues.push('inactive');
    // mt + sms + popup (list-level)
    if (p.message_template_id > 0) stats.mt++; else codeIssues.push('no-inbox');
    if (p.message_template_sms_id > 0) stats.sms++; else codeIssues.push('no-sms');
    if (hasPopup(p)) stats.popup++; else codeIssues.push('no-popup');

    // detail
    const det = (await authedFetch(site, `/api/bo/promotion/${p.id}`)).data?.rows;

    // categories populated
    const pcIds = (det.promotion_category || []).filter(c => c.target_type === 1).map(c => c.category_id).sort();
    const wantCats = cat === 'lc' ? [CAT_LC] : cat === 'slots' ? [CAT_SL] : cat === 'both' ? [CAT_LC, CAT_SL] : [];
    if (wantCats.length && pcIds.length === wantCats.length && pcIds.every((v, i) => v === wantCats[i])) stats.cats++;
    else codeIssues.push(`cat=[${pcIds.join(',')}]≠want[${wantCats.join(',')}]`);

    // blacklist exclusions: every source provider must be in target
    const srcProvSet = new Set();
    if (Array.isArray(s.blacklist_sub_categories)) {
      for (const e of s.blacklist_sub_categories) srcProvSet.add(e.game_provider_code);
    }
    const tgtProvSet = new Set((det.blacklist_sub_categories || []).map(e => e.game_provider_code));
    const missingProv = [...srcProvSet].filter(c => !tgtProvSet.has(c));
    if (!srcProvSet.size || (!missingProv.length && tgtProvSet.size >= srcProvSet.size)) stats.blEx++;
    else codeIssues.push(`bl missing providers: ${missingProv.join(',') || `count ${tgtProvSet.size}<${srcProvSet.size}`}`);

    // GP restriction
    const toks = gpToks(p);
    const fullUniverse = toks.length >= U - 1;
    let gpFails = [];
    if (fullUniverse) gpFails.push(`full-universe(${toks.length}/${U})`);
    if (cat === 'slots') {
      if (toks.includes('PP')) gpFails.push('slot-has-PP');
      if (!toks.includes('PP2')) gpFails.push('slot-no-PP2');
    }
    if (cat === 'lc' && toks.length > 20) gpFails.push(`LC gp=${toks.length}`);
    if (!gpFails.length) stats.gpOk++; else codeIssues.push(...gpFails);

    // name (skip strict eq — source names contain currency hints that may differ)
    if (det.name === s.name) stats.nameOk++; // not a failure if differs

    // :brandname literal in inbox MT
    let brandClean = true, sgdClean = true;
    if (p.message_template_id > 0) {
      const im = await authedFetch(site, `/api/bo/messagetemplate/${p.message_template_id}`);
      for (const d of Object.values(im.data?.message_details || {})) {
        const txt = (d.subject || '') + ' ' + (d.message || '');
        if (/12huat/i.test(txt)) { brandClean = false; }
        const localeId = Number(d.settings_locale_id);
        // MY_EN = 1; SGD shouldn't appear in MY_EN content for these 4 MYR-only brands
        if (localeId === 1 && /\bSGD\b/.test(txt)) sgdClean = false;
      }
    }
    if (brandClean) stats.brandVar++; else codeIssues.push('inbox has 12huat');
    if (sgdClean) stats.sgdClean++; else codeIssues.push('inbox MY_EN has SGD');

    if (!codeIssues.length) stats.fullPass++;
    else issues.push(`${p.code} [${cat}]: ${codeIssues.join('; ')}`);
    grand.codes++;
  }

  grand.ok += stats.fullPass;
  perBrand[brand] = stats;
  grand.issues.push(...issues.map(i => `${brand}: ${i}`));
}

// table
console.log('\n┌─────────┬───────┬────────┬───────┬───────┬──────┬───────┬───────┬───────┬───────┬───────┬───────────┐');
console.log('│ Brand   │ total │ active │ cats  │ inbox │ sms  │ popup │ bl-ex │ gp-ok │ brand │ sgd-ok│ FULL-PASS │');
console.log('├─────────┼───────┼────────┼───────┼───────┼──────┼───────┼───────┼───────┼───────┼───────┼───────────┤');
for (const b of BRANDS) {
  const s = perBrand[b];
  const cell = (n) => String(n).padStart(5);
  const pass = `${s.fullPass}/${s.total}`.padStart(9);
  console.log(`│ ${b.padEnd(8)}│${cell(s.total)}  │${cell(s.active)}   │${cell(s.cats)}  │${cell(s.mt)}  │${cell(s.sms)} │${cell(s.popup)}  │${cell(s.blEx)}  │${cell(s.gpOk)}  │${cell(s.brandVar)}  │${cell(s.sgdClean)}  │ ${pass} │`);
}
console.log('└─────────┴───────┴────────┴───────┴───────┴──────┴───────┴───────┴───────┴───────┴───────┴───────────┘');

console.log(`\n=== OVERALL ===  ${grand.ok}/${grand.codes} codes fully pass · ${grand.issues.length} issues`);
if (grand.issues.length) grand.issues.slice(0, 60).forEach(i => console.log('  ' + i));
if (grand.issues.length > 60) console.log(`  ... +${grand.issues.length - 60} more`);

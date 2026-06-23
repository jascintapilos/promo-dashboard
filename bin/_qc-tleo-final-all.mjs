#!/usr/bin/env node
// Final QC across all TLEO QPRO brands:
//   1. Code count + per-code config (inbox / SMS / popup)
//   2. :brandname check — any template still carrying hardcoded "12huat"
//
// Run: node bin/_qc-tleo-final-all.mjs

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const NEW = ['qpro5', 'qpro7', 'qpro15', 'qpro16'];   // expect 54 (full clone)
const EXISTING = ['qpro2', 'qpro3', 'qpro4', 'qpro6', 'qpro8', 'qpro10'];
const ALL = [...NEW, ...EXISTING];

const hasPopup = p => { const d = p.dialog_popup_list; return Array.isArray(d) ? d.length > 0 : (d && Object.keys(d || {}).length > 0); };

console.log('=== TLEO code creation + config ===');
const codeReport = {};
for (const brand of ALL) {
  const site = getSite(brand);
  const r = await authedFetch(site, '/api/bo/promotion?code=TLEO&perPage=200&page=1');
  const all = Object.values(r.data?.rows || {}).filter(p => p.code?.includes('TLEO'));
  const active = all.filter(p => p.status === 1);
  const inbox = active.filter(p => p.message_template_id > 0).length;
  const sms = active.filter(p => p.message_template_sms_id > 0).length;
  const popup = active.filter(hasPopup).length;
  codeReport[brand] = { total: all.length, active: active.length, inbox, sms, popup };
  const tag = NEW.includes(brand) ? (all.length >= 54 ? '✓' : `⚠ (${all.length}/54)`) : '';
  console.log(`  ${brand.padEnd(7)}: ${all.length} codes (${active.length} active) · Inbox ${inbox} · SMS ${sms} · Popup ${popup} ${tag}`);
}

console.log('\n=== :brandname check — TLEO templates still containing "12huat" ===');
let totalBad = 0;
for (const brand of ALL) {
  const site = getSite(brand);
  let hits = 0; const examples = [];
  for (let pg = 1; pg <= 10; pg++) {
    const r = await authedFetch(site, `/api/bo/messagetemplate?perPage=200&page=${pg}`);
    const arr = Object.values(r.data?.rows || {});
    if (!arr.length) break;
    for (const t of arr) {
      if (!/TLEO/i.test(t.code || '')) continue;
      if (/12huat/i.test(t.message || '') || /12huat/i.test(JSON.stringify(t).slice(0, 3000))) { hits++; if (examples.length < 2) examples.push(t.code); }
    }
    if (arr.length < 200) break;
  }
  totalBad += hits;
  console.log(`  ${brand.padEnd(7)}: ${hits === 0 ? '✓ clean (0 hardcoded)' : `✗ ${hits} still have 12huat (e.g. ${examples.join(', ')})`}`);
}

console.log('\n=== RESULT ===');
const newComplete = NEW.every(b => codeReport[b].total >= 54);
console.log(`New brands (qpro5/7/15/16) all have 54 codes: ${newComplete ? 'YES ✓' : 'NO — still creating / incomplete'}`);
console.log(`:brandname — TLEO templates with hardcoded 12huat: ${totalBad === 0 ? '0 ✓ (all use :brandname)' : totalBad + ' ✗'}`);

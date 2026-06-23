#!/usr/bin/env node
// Comprehensive per-code QC of the 4 new brands (qpro5/7/15/16) vs qpro2 source.
// Per code verifies: present+active · inbox · SMS · popup · blacklist (by name,
// per category) · GP restriction (LC restricted / slots PP-excluded+PP2 / FC both,
// never full-universe) · name matches source. Plus a :brandname detail sample.
//
// Run: node bin/_qc-tleo-4brands-comprehensive.mjs

import fs from 'node:fs';
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';
import { getBlacklistTemplates } from '../src/blacklist-template.js';

const TARGETS = ['qpro5', 'qpro7', 'qpro15', 'qpro16'];
const SOURCE = JSON.parse(fs.readFileSync('tmp/qpro2-tleo-source.json', 'utf8'));
const norm = s => String(s || '').trim().toLowerCase();
const hasPopup = p => { const d = p.dialog_popup_list; return Array.isArray(d) ? d.length > 0 : (d && Object.keys(d || {}).length > 0); };
const gpToks = p => (p.game_provider || '').split(',').map(s => s.trim()).filter(Boolean);

const grand = { codes: 0, ok: 0, issues: [] };

for (const brand of TARGETS) {
  const site = getSite(brand);
  const tpls = await getBlacklistTemplates(site);
  const btById = Object.fromEntries(tpls.map(t => [t.id, t.name]));
  // FULL provider catalog (to detect a code that has NO category restriction).
  // Note: FC "Slot+LC" codes legitimately span both categories (~38) — that's
  // restricted relative to the full catalog (~63), so we baseline on the catalog.
  const gpCat = await authedFetch(site, '/api/bo/gameprovider?perPage=300&page=1');
  const fullCat = Object.values(gpCat.data?.rows || {}).length;
  const r = await authedFetch(site, '/api/bo/promotion?code=TLEO&perPage=200&page=1');
  const list = Object.values(r.data?.rows || {}).filter(p => p.code?.includes('TLEO'));
  const U = fullCat;

  let brandOk = 0; const brandIssues = [];
  // missing codes (in source, not in target)
  const targetCodes = new Set(list.map(p => p.code));
  for (const code of Object.keys(SOURCE)) if (!targetCodes.has(code)) brandIssues.push(`MISSING ${code}`);

  for (const p of list) {
    const s = SOURCE[p.code];
    if (!s) { brandIssues.push(`${p.code}: not in source (extra)`); continue; }
    const cat = s.category; // lc / slots / both
    const issues = [];
    // config
    if (p.status !== 1) issues.push('inactive');
    if (!(p.message_template_id > 0)) issues.push('no-inbox');
    if (!(p.message_template_sms_id > 0)) issues.push('no-sms');
    if (!hasPopup(p)) issues.push('no-popup');
    // blacklist (detail)
    const det = (await authedFetch(site, `/api/bo/promotion/${p.id}`)).data?.rows;
    const btName = det.blacklist_id ? btById[det.blacklist_id] : null;
    if (s.blacklist_name) { if (norm(btName) !== norm(s.blacklist_name)) issues.push(`bt="${btName}"≠src"${s.blacklist_name}"`); }
    else { if (det.blacklist_id) issues.push(`bt set(${btName}) but src null`); }
    // GP restriction
    const toks = gpToks(p);
    if (toks.length >= U - 1) issues.push(`GP full-universe(${toks.length})`);
    if (cat === 'slots') { if (toks.includes('PP')) issues.push('slot-has-PP'); if (!toks.includes('PP2')) issues.push('slot-no-PP2'); }
    if (cat === 'lc' && toks.length > 20) issues.push(`LC gp=${toks.length}(too many)`);
    // name
    if (det.name !== s.name) issues.push('name≠src');

    if (issues.length) brandIssues.push(`${p.code} [${cat}]: ${issues.join(', ')}`);
    else brandOk++;
    grand.codes++;
  }

  // :brandname detail check — ALL inbox MTs (authoritative; list endpoint is stale)
  let bnBad = 0, bnChecked = 0;
  for (const p of list) {
    if (!(p.message_template_id > 0)) continue;
    const im = await authedFetch(site, `/api/bo/messagetemplate/${p.message_template_id}`);
    bnChecked++;
    if (Object.values(im.data?.message_details || {}).some(d => /12huat/i.test(d.subject || '') || /12huat/i.test(d.message || ''))) { bnBad++; brandIssues.push(`${p.code}: inbox MT still has 12huat`); }
  }

  grand.ok += brandOk;
  grand.issues.push(...brandIssues.map(i => `${brand} ${i}`));
  console.log(`${brand.toUpperCase()}: ${list.length} codes · ${brandOk} fully OK · ${brandIssues.length} issues · :brandname sample ${bnChecked - bnBad}/${bnChecked} clean`);
  brandIssues.slice(0, 20).forEach(i => console.log(`   ✗ ${i}`));
}

console.log(`\n=== OVERALL ===  ${grand.ok}/${grand.codes} codes fully pass  ·  ${grand.issues.length} issues`);
if (grand.issues.length) grand.issues.forEach(i => console.log('  ' + i));
else console.log('✓ ALL CODES ON qpro5/7/15/16 PASS EVERY CHECK');

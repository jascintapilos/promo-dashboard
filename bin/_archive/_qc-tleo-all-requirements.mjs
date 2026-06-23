#!/usr/bin/env node
// Comprehensive QC for TLEO promos across 5 QPRO brands.
// Checks ALL requirements per promo:
//   1. Inbox    — message_template_id > 0
//   2. Pop Up   — dialog_popup_list present
//   3. SMS      — message_template_sms_id > 0
//   4. Blacklist— blacklist_id consistent per category + correct template name
//   5. GP       — Slot promos: no standalone PP, PP2 present
//
// Run: node bin/_qc-tleo-all-requirements.mjs

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';
import { getBlacklistTemplates } from '../src/blacklist-template.js';

const BRANDS = ['qpro3', 'qpro4', 'qpro6', 'qpro8', 'qpro10'];

// Category from BO `category` field (authoritative). Values seen: "SL", "LC", combos.
function catOf(boCat) {
  const c = (boCat || '').toUpperCase();
  const hasLC = /\bLC\b/.test(c) || /LIVE/i.test(c);
  const hasSL = /\bSL\b/.test(c) || /SLOT/i.test(c);
  if (hasLC && hasSL) return 'both';
  if (hasLC) return 'lc';
  if (hasSL) return 'slots';
  return 'all';
}
function expectedTemplateRx(cat) {
  if (cat === 'lc') return /live casino only/i;
  if (cat === 'slots') return /slots?\s+only/i;
  return /slots.*live casino/i; // both / all
}
function gpTokens(gpStr) {
  return (gpStr || '').split(',').map(s => s.trim()).filter(Boolean);
}

const overall = { inbox: [0, 0], sms: [0, 0], popup: [0, 0], blacklist: [0, 0], gp: [0, 0] };
const allIssues = [];

for (const brand of BRANDS) {
  const site = getSite(brand);
  console.log(`\n=== ${brand.toUpperCase()} ===`);

  // blacklist templates id→name
  let btById = {};
  try {
    const tpls = await getBlacklistTemplates(site);
    btById = Object.fromEntries(tpls.map(t => [t.id, t.name]));
  } catch (e) { console.warn(`  WARN blacklist templates: ${e.message.split('\n')[0]}`); }

  // list endpoint
  const r = await authedFetch(site, '/api/bo/promotion?code=FT_REL_TLEO&perPage=200&page=1');
  const rows = r.data?.rows || [];
  const tleo = (Array.isArray(rows) ? rows : Object.values(rows)).filter(p => p.code?.includes('TLEO'));

  let inboxN = 0, smsN = 0, popupN = 0, blN = 0, gpN = 0;
  const catBl = {}; // cat -> Set(blacklist_id)
  const brandIssues = [];

  for (const p of tleo) {
    const cat = catOf(p.category);
    // 1. Inbox
    const okInbox = p.message_template_id > 0;
    // 2. SMS
    const okSms = p.message_template_sms_id > 0;
    // 3. Pop Up
    const dp = p.dialog_popup_list;
    const okPopup = Array.isArray(dp) ? dp.length > 0 : (dp && Object.keys(dp || {}).length > 0);
    // 5. GP (slots only)
    let okGp = true, gpMsg = '';
    const toks = gpTokens(p.game_provider);
    if (cat === 'slots') {
      const hasPP = toks.includes('PP');
      const hasPP2 = toks.includes('PP2');
      okGp = !hasPP && hasPP2;
      if (hasPP) gpMsg = 'PP still present';
      else if (!hasPP2) gpMsg = 'PP2 missing';
    }
    // 4. Blacklist (needs detail call)
    let blId = null, okBl = false, blName = '';
    try {
      const d = await authedFetch(site, `/api/bo/promotion/${p.id}`);
      blId = d.data?.rows?.blacklist_id;
      blName = btById[blId] || `id=${blId}(?)`;
      okBl = blId != null && expectedTemplateRx(cat).test(blName);
    } catch (e) { blName = `ERR ${e.message.split('\n')[0]}`; }
    (catBl[cat] ||= new Set()).add(blId);

    if (okInbox) inboxN++;
    if (okSms) smsN++;
    if (okPopup) popupN++;
    if (okBl) blN++;
    if (okGp) gpN++;

    const miss = [];
    if (!okInbox) miss.push('Inbox');
    if (!okPopup) miss.push('PopUp');
    if (!okSms) miss.push('SMS');
    if (!okBl) miss.push(`Blacklist(${blName}≠${cat})`);
    if (!okGp) miss.push(`GP(${gpMsg})`);
    if (miss.length) {
      brandIssues.push(`    ✗ ${p.code} [cat=${cat}] → ${miss.join(', ')}`);
      allIssues.push(`${brand} ${p.code}: ${miss.join(', ')}`);
    }
  }

  const N = tleo.length;
  console.log(`  Codes: ${N}`);
  console.log(`  Inbox    ${inboxN}/${N}`);
  console.log(`  Pop Up   ${popupN}/${N}`);
  console.log(`  SMS      ${smsN}/${N}`);
  console.log(`  Blacklist${blN}/${N}   (per-cat bl_id: ${Object.entries(catBl).map(([c, s]) => `${c}=[${[...s].join(',')}]`).join(' ')})`);
  console.log(`  GP (slots PP removed) ${gpN}/${N}`);
  if (brandIssues.length) { console.log(`  Issues (${brandIssues.length}):`); brandIssues.forEach(i => console.log(i)); }
  else console.log('  ✓ all requirements met');

  overall.inbox[0] += inboxN; overall.inbox[1] += N;
  overall.sms[0] += smsN; overall.sms[1] += N;
  overall.popup[0] += popupN; overall.popup[1] += N;
  overall.blacklist[0] += blN; overall.blacklist[1] += N;
  overall.gp[0] += gpN; overall.gp[1] += N;
}

console.log('\n\n=== OVERALL (5 brands) ===');
console.log(`  Inbox     ${overall.inbox[0]}/${overall.inbox[1]}`);
console.log(`  Pop Up    ${overall.popup[0]}/${overall.popup[1]}`);
console.log(`  SMS       ${overall.sms[0]}/${overall.sms[1]}`);
console.log(`  Blacklist ${overall.blacklist[0]}/${overall.blacklist[1]}`);
console.log(`  GP        ${overall.gp[0]}/${overall.gp[1]}`);
console.log(`\nTotal issues: ${allIssues.length}`);
if (allIssues.length) allIssues.forEach(i => console.log('  ' + i));
else console.log('✓ ALL REQUIREMENTS MET ACROSS ALL 5 BRANDS');

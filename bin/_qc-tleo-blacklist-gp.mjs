#!/usr/bin/env node
// QC: Verify blacklist_template_id + game_provider (PP removed) on all TLEO promos
// QPRO sites: qpro2/3/4/6/8/10  |  QP2: ibc22

import { authedFetch, getAllGameProviders } from '../src/api-client.js';
import { getSite } from '../src/sites.js';
import { getBlacklistTemplates, parseTemplateName } from '../src/blacklist-template.js';

const QPRO_SITES = ['qpro2','qpro3','qpro4','qpro6','qpro8','qpro10'];

function catType(code) {
  if (/_LC_/.test(code) || /_LC$/.test(code)) return 'lc';
  if (/_SL_/.test(code) || /_SLOT_/.test(code) || /_SLOT$/.test(code)) return 'slots';
  return 'all';
}

// Build catType → expected template name for a site
function expectedTemplateName(cat) {
  if (cat === 'lc')    return /live casino only/i;
  if (cat === 'slots') return /slots?\s+only/i;
  return /slots.*live casino.*sports?/i;  // "Slots, Live Casino, Sports"
}

let totalOk = 0, totalWrong = 0;
const issues = [];

console.log('=== QPRO Blacklist + GP QC ===\n');

for (const siteId of QPRO_SITES) {
  const site = getSite(siteId);

  // Load blacklist templates for this site
  let templates;
  try {
    templates = await getBlacklistTemplates(site);
  } catch (e) {
    console.error(`${siteId}: ERROR loading templates: ${e.message}`);
    continue;
  }
  const btById = Object.fromEntries(templates.map(t => [t.id, t.name]));

  // Get PP/PP2 IDs
  let ppId = null, pp2Id = null;
  try {
    const { rows: gps } = await getAllGameProviders(site);
    ppId  = gps.find(g => g.code === 'PP')?.id  ?? null;
    pp2Id = gps.find(g => g.code === 'PP2')?.id ?? null;
  } catch (e) {
    console.warn(`${siteId}: WARN could not resolve PP/PP2: ${e.message}`);
  }

  // Fetch all TLEO promos
  const r = await authedFetch(site, '/api/bo/promotion?code=FT_REL_TLEO&perPage=200&page=1');
  const rows = r.data?.rows || [];
  const tleo = (Array.isArray(rows) ? rows : Object.values(rows)).filter(p => p.code?.includes('TLEO'));

  let siteOk = 0, siteWrong = 0;

  for (const promo of tleo) {
    const cat = catType(promo.code);
    const expNameRx = expectedTemplateName(cat);

    // GET full detail to check bt + game_provider_ids
    const r2 = await authedFetch(site, `/api/bo/promotion/${promo.id}`);
    const p = r2.data?.rows;

    const btId = p.blacklist_id;          // GET field is blacklist_id
    const btName = btById[btId] ?? `id=${btId}(unknown)`;
    const btOk = btName && expNameRx.test(btName);

    // Check PP removal for SLOT promos
    let ppOk = true;
    let ppMsg = '';
    if (cat === 'slots' && ppId !== null) {
      const gpIds = p.game_provider_ids || [];
      const hasPP  = gpIds.includes(ppId);
      const hasPP2 = gpIds.includes(pp2Id);
      ppOk = !hasPP;
      ppMsg = hasPP ? ` ✗ PP(${ppId}) still in gp_ids` : (hasPP2 ? ' PP2 ok' : ' PP2 missing!');
      if (!hasPP2) ppOk = false;
    }

    if (btOk && ppOk) {
      siteOk++;
      totalOk++;
    } else {
      siteWrong++;
      totalWrong++;
      const issues_row = `  ${siteId} pid=${promo.id} code=${promo.code} cat=${cat}`;
      const bt_issue   = btOk ? '' : ` bt=${btId}(${btName}) expected~/${expNameRx.source}/`;
      console.log(`  ✗ ${promo.code} (pid=${promo.id}) cat=${cat}${bt_issue}${ppMsg}`);
      issues.push(`${siteId} pid=${promo.id} ${promo.code}: bt=${btId}(${btName})${ppMsg}`);
    }
  }

  console.log(`${siteId}: ${siteOk}/${tleo.length} OK  (${siteWrong} issues)`);
}

// ── ibc22 QC ──────────────────────────────────────────────────────────────────

console.log('\n=== ibc22 QC ===');
const site = getSite('ibc22');
const rIbc = await authedFetch(site, '/api/bo/promotion?code=FT_REL_TLEO&perPage=200&page=1');
const ibcRows = rIbc.data?.rows || [];
const ibcTleo = (Array.isArray(ibcRows) ? ibcRows : Object.values(ibcRows)).filter(p => p.code?.includes('TLEO'));

let ibcOk = 0, ibcWrong = 0;
for (const promo of ibcTleo) {
  const cat = catType(promo.code);
  const r2 = await authedFetch(site, `/api/bo/promotion/${promo.id}`);
  const p = r2.data?.rows;

  const bt = p.blacklist_template_id;   // QP2 GET field is blacklist_template_id
  const expectedBt = cat === 'lc' ? 3 : 5;  // lc=3, all/slots=5 on ibc22
  const btOk = bt === expectedBt;

  let ppOk = true, ppMsg = '';
  if (cat === 'slots') {
    const gpc = p.game_provider_codes || [];
    const hasPP  = gpc.includes('PP');
    const hasPP2 = gpc.includes('PP2');
    ppOk = !hasPP && hasPP2;
    ppMsg = hasPP ? ' ✗ PP still in gpc' : (hasPP2 ? ' PP2 ok' : ' ✗ PP2 missing');
  }

  if (btOk && ppOk) {
    ibcOk++;
    totalOk++;
  } else {
    ibcWrong++;
    totalWrong++;
    const bt_msg = btOk ? '' : ` bt=${bt}(expected ${expectedBt})`;
    console.log(`  ✗ ${promo.code} (pid=${promo.id}) cat=${cat}${bt_msg}${ppMsg}`);
    issues.push(`ibc22 pid=${promo.id} ${promo.code}: bt=${bt}${ppMsg}`);
  }
}
console.log(`ibc22: ${ibcOk}/${ibcTleo.length} OK  (${ibcWrong} issues)`);

// ── Final summary ────────────────────────────────────────────────────────────

console.log('\n=== OVERALL QC RESULT ===');
console.log(`Total OK: ${totalOk}  Total Issues: ${totalWrong}`);
if (issues.length > 0) {
  console.log('\nIssues:');
  for (const i of issues) console.log('  ' + i);
} else {
  console.log('\n✓ All TLEO promos have correct blacklist template + PP fix applied');
}

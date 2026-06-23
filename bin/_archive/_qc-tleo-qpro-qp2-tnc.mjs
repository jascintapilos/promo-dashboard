#!/usr/bin/env node
// QC the eligible game category clause in the T&C (inbox message template)
// for all TLEO codes across QPRO (qpro2/3/4/6/8/10) + QP2 (ibc22).
//
// Expected pattern by code name:
//   _LC_ in code or _LC suffix → clause must mention "Live Casino"
//   _SL_ in code or _SLOT suffix → clause must mention "Slot"
//   otherwise (all games)       → no category clause is OK; clause must NOT restrict to Slot/LC only

import { authedFetch } from '../src/api-client.js';
import { listSites, getSite } from '../src/sites.js';

function catType(code) {
  if (/_LC_/.test(code) || /_LC$/.test(code)) return 'lc';
  if (/_SL_/.test(code) || /_SLOT$/.test(code)) return 'slots';
  return 'all';
}

function evalClause(catT, clause) {
  if (!clause) {
    // No category clause found
    if (catT === 'all') return 'ok';    // all-games — no restriction needed
    return 'missing';                   // LC/Slot code missing its clause
  }
  const lower = clause.toLowerCase();
  if (catT === 'lc')    return lower.includes('live casino') ? 'ok' : 'wrong';
  if (catT === 'slots') return (lower.includes('slot') && !lower.includes('live casino')) ? 'ok' : 'wrong';
  // all-games: clause should not restrict to just one category
  if (lower.includes('live casino') || (lower.includes('slot') && !lower.includes('all'))) return 'wrong';
  return 'ok';
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function fetchAllTleo(site) {
  let all = [], page = 1;
  while (true) {
    const res = await authedFetch(site, `/api/bo/promotion?code=FT_REL_TLEO&perPage=100&page=${page}`);
    const rows = res.data?.rows || [];
    all.push(...rows);
    if (rows.length < 100) break;
    page++;
  }
  return all;
}

async function getCategoryClause(site, mtId, mtCache) {
  if (mtCache.has(mtId)) return mtCache.get(mtId);
  try {
    const mt = await authedFetch(site, `/api/bo/messagetemplate/${mtId}`);
    const en = mt.data?.message_details?.['1'];
    const m = en?.message?.match(/eligible game categor[^<]*/i);
    const clause = m ? m[0].replace(/&nbsp;/g, ' ').trim() : null;
    mtCache.set(mtId, clause);
    return clause;
  } catch {
    mtCache.set(mtId, null);
    return null;
  }
}

// ── Sites to check ────────────────────────────────────────────────────────────

const QPRO_IDS = ['qpro2', 'qpro3', 'qpro4', 'qpro6', 'qpro8', 'qpro10'];
const QP2_ID   = 'ibc22';

const report = [];  // { platform, site, code, catT, clause, status }

// ── QPRO ─────────────────────────────────────────────────────────────────────

for (const siteId of QPRO_IDS) {
  process.stdout.write(`\nChecking ${siteId}...`);
  const site = getSite(siteId);
  const mtCache = new Map();

  try {
    const promos = await fetchAllTleo(site);
    process.stdout.write(` ${promos.length} TLEO codes\n`);

    for (const promo of promos) {
      const catT = catType(promo.code);
      let clause = null;
      if (promo.message_template_id) {
        clause = await getCategoryClause(site, promo.message_template_id, mtCache);
      }
      const status = promo.message_template_id ? evalClause(catT, clause) : 'no-MT';
      report.push({ platform: 'QPRO', site: siteId, code: promo.code, catT, clause, status });
    }
  } catch (e) {
    console.error(`  ERR ${siteId}: ${e.message.slice(0, 80)}`);
  }
}

// ── QP2 ───────────────────────────────────────────────────────────────────────

process.stdout.write(`\nChecking QP2 (${QP2_ID})...`);
try {
  const site = getSite(QP2_ID);
  const mtCache = new Map();
  const promos = await fetchAllTleo(site);
  process.stdout.write(` ${promos.length} TLEO codes\n`);

  for (const promo of promos) {
    const catT = catType(promo.code);
    let clause = null;
    if (promo.message_template_id) {
      clause = await getCategoryClause(site, promo.message_template_id, mtCache);
    }
    const status = promo.message_template_id ? evalClause(catT, clause) : 'no-MT';
    report.push({ platform: 'QP2', site: QP2_ID, code: promo.code, catT, clause, status });
  }
} catch (e) {
  console.error(`  ERR QP2: ${e.message.slice(0, 80)}`);
}

// ── Print results ─────────────────────────────────────────────────────────────

const wrong   = report.filter(r => r.status === 'wrong');
const missing = report.filter(r => r.status === 'missing');
const noMt    = report.filter(r => r.status === 'no-MT');
const ok      = report.filter(r => r.status === 'ok');

console.log(`\n${'═'.repeat(130)}`);
console.log(`  TLEO T&C Category Clause QC  —  ${ok.length} ok / ${wrong.length} wrong / ${missing.length} missing clause / ${noMt.length} no MT / ${report.length} total`);
console.log('═'.repeat(130));

if (wrong.length || missing.length || noMt.length) {
  console.log('\n⚠  NEEDS REVIEW:');
  console.log('Platform'.padEnd(8) + 'Site'.padEnd(10) + 'Cat'.padEnd(7) + 'Code'.padEnd(42) + 'Status'.padEnd(10) + 'Current Clause');
  console.log('─'.repeat(130));
  for (const r of [...wrong, ...missing, ...noMt]) {
    console.log(
      r.platform.padEnd(8) +
      r.site.padEnd(10) +
      r.catT.padEnd(7) +
      r.code.padEnd(42) +
      r.status.padEnd(10) +
      (r.clause ? r.clause.slice(0, 53) : '—'),
    );
  }
}

console.log('\n✓  OK:');
console.log('Platform'.padEnd(8) + 'Site'.padEnd(10) + 'Cat'.padEnd(7) + 'Code'.padEnd(42) + 'Current Clause');
console.log('─'.repeat(130));
for (const r of ok) {
  console.log(
    r.platform.padEnd(8) +
    r.site.padEnd(10) +
    r.catT.padEnd(7) +
    r.code.padEnd(42) +
    (r.clause ?? '(no clause — all games, OK)').slice(0, 53),
  );
}

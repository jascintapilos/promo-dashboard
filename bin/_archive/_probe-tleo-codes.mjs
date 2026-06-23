#!/usr/bin/env node
// Probe 10 FT_REL_TLEO_* codes on QPRO2 (source) + 5 QPRO targets + WS1 MY.
// Captures listing-row state + full detail snapshot per code to tmp/tleo-probe.json
// for the replication planner.

import fs from 'node:fs';
import path from 'node:path';
import { authedFetch, findPromotionByCode, getPromotionDetail } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const CODES = [
  'FT_REL_TLEO_LC_20PCT_20MX_BR',
  'FT_REL_TLEO_LC_20PCT_300MX_BR',
  'FT_REL_TLEO_LC_20PCT_400MX_BR',
  'FT_REL_TLEO_20PCT_300MX_BR',
  'FT_REL_TLEO_20PCT_400MX_BR',
  'FT_REL_TLEO_LC_45PCT_138MX',
  'FT_REL_TLEO_LC_45PCT_228MX_BR',
  'FT_REL_TLEO_LC_45PCT_458MX_BR',
  'FT_REL_TLEO_45PCT_688MX',
  'FT_REL_TLEO_45PCT_888MX',
];

const SOURCE = 'qpro2';
const QPRO_TARGETS = ['qpro3', 'qpro4', 'qpro6', 'qpro8', 'qpro10'];
const WS1_TARGET = 'ws1-classic-my';

const out = { source: {}, targets: {}, ws1: {} };

console.log(`\n━━━ Source: ${SOURCE} ━━━`);
const sourceSite = getSite(SOURCE);
for (const code of CODES) {
  try {
    const row = await findPromotionByCode(sourceSite, code);
    if (!row) {
      console.log(`  ${code}: NOT FOUND`);
      out.source[code] = { found: false };
      continue;
    }
    const detail = await getPromotionDetail(sourceSite, row.id);
    out.source[code] = { found: true, row, detail };
    console.log(`  ${code}: id=${row.id} status=${row.status} promo_type=${row.promotion_type} sub=${row.promotion_sub_type}`);
  } catch (e) {
    console.log(`  ${code}: ERROR ${e.message.slice(0, 200)}`);
    out.source[code] = { found: false, error: String(e.message) };
  }
}

console.log(`\n━━━ Targets (QPRO) ━━━`);
for (const t of QPRO_TARGETS) {
  out.targets[t] = {};
  try {
    const tSite = getSite(t);
    for (const code of CODES) {
      const row = await findPromotionByCode(tSite, code);
      out.targets[t][code] = row ? { exists: true, id: row.id, status: row.status } : { exists: false };
    }
    const summary = Object.entries(out.targets[t]).map(([c, v]) => v.exists ? `${c.slice(-12)}=${v.id}` : `${c.slice(-12)}=-`).join(' ');
    console.log(`  ${t}: ${summary}`);
  } catch (e) {
    out.targets[t]._error = String(e.message);
    console.log(`  ${t}: ERROR ${e.message.slice(0, 200)}`);
  }
}

console.log(`\n━━━ Target (WS1 MY) ━━━`);
try {
  // WS1/IGMP has a different API surface; just record that we need to use
  // the IGMP-specific probe path. For now, log the intent.
  console.log(`  ws1-classic-my: probe skipped — IGMP path needs separate client; will handle in next pass.`);
  out.ws1 = { _todo: 'use src/igmp-client.js for ws1-classic-my probe' };
} catch (e) {
  console.log(`  ws1-classic-my: ERROR ${e.message.slice(0, 200)}`);
}

const outPath = path.resolve('tmp/tleo-probe.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(`\nWrote ${outPath}`);

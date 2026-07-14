#!/usr/bin/env node
// Patch WC_SLVR_28FC_10X inbox MT clause 3: change claim window from
// "thirty (30) days" → "seven (7) days" on EN and ZH locales.
// Targets: QP2C, QPRO3/4/5/7/10/15/16
//
//   node bin/patch-wc-slvr-validity-tnc.mjs          ← dry-run
//   node bin/patch-wc-slvr-validity-tnc.mjs --commit ← apply

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const COMMIT = process.argv.includes('--commit');
const delay  = ms => new Promise(r => setTimeout(r, ms));

const JOBS = [
  { siteId: 'ibc22',  mtId: 1229, label: 'QP2C',   isQp2: true  },
  { siteId: 'qpro3',  mtId: 512,  label: 'QPRO3'               },
  { siteId: 'qpro4',  mtId: 444,  label: 'QPRO4'               },
  { siteId: 'qpro5',  mtId: 346,  label: 'QPRO5'               },
  { siteId: 'qpro7',  mtId: 539,  label: 'QPRO7'               },
  { siteId: 'qpro10', mtId: 530,  label: 'QPRO10'              },
  { siteId: 'qpro15', mtId: 353,  label: 'QPRO15'              },
  { siteId: 'qpro16', mtId: 330,  label: 'QPRO16'              },
];

function patchEn(msg) {
  const re = /thirty \(30\) days(, and the bonus will expire)/;
  if (!re.test(msg)) return { msg, skipped: 'anchor-not-found (thirty (30) days)' };
  return { msg: msg.replace(re, 'seven (7) days$1'), skipped: null };
}

function patchZh(msg) {
  const re = /30 天内领取/;
  if (!re.test(msg)) return { msg, skipped: 'anchor-not-found (30 天内领取)' };
  return { msg: msg.replace(re, '7 天内领取'), skipped: null };
}

const SERVER_FIELDS = new Set(['id', 'created_at', 'updated_at', 'settings_locale_code']);

async function run(job) {
  const site = getSite(job.siteId);
  console.log(`── ${job.label.padEnd(7)} mt_id=${job.mtId} ──`);

  let detail;
  try {
    detail = await authedFetch(site, `/api/bo/messagetemplate/${job.mtId}`);
  } catch (e) {
    console.log(`  ✗ GET failed: ${e.message.slice(0, 120)}\n`); return;
  }

  const mt = detail?.data;
  if (!mt) { console.log('  ✗ no data\n'); return; }

  const details = JSON.parse(JSON.stringify(mt.details || {}));
  let patched = false;

  for (const [locId, d] of Object.entries(details)) {
    if (!d?.message) continue;
    const locCode = d.settings_locale_code || locId;
    const isZh = /zh/i.test(locCode);
    const { msg: newMsg, skipped } = isZh ? patchZh(d.message) : patchEn(d.message);
    if (skipped) {
      console.log(`  loc=${locId} (${locCode}) — skipped: ${skipped}`);
      continue;
    }
    details[locId].message = newMsg;
    patched = true;
    console.log(`  loc=${locId} (${locCode}) — ${isZh ? 'ZH' : 'EN'} patched`);
  }

  if (!patched) { console.log('  → nothing to update\n'); return; }
  if (!COMMIT)  { console.log(`  [DRY-RUN] would PUT /api/bo/messagetemplate/${job.mtId}\n`); return; }

  const cleanDetails = {};
  for (const [k, d] of Object.entries(details)) {
    if (!d) { cleanDetails[k] = d; continue; }
    cleanDetails[k] = Object.fromEntries(Object.entries(d).filter(([f]) => !SERVER_FIELDS.has(f)));
  }

  const body = {
    name:    mt.name,
    section: mt.section,
    type:    mt.type,
    status:  mt.status,
    details: cleanDetails,
    ...(job.isQp2 ? { site_id: 3 } : {}),
  };

  await delay(600);
  try {
    const res = await authedFetch(site, `/api/bo/messagetemplate/${job.mtId}`, { method: 'PUT', body });
    const ok = res?.success !== false;
    console.log(`  PUT ${ok ? '✅ OK' : '❌ FAILED — ' + JSON.stringify(res?.message || '')}\n`);
  } catch (e) {
    console.log(`  PUT ✗ ${e.message.slice(0, 200)}\n`);
  }
}

console.log(`WC_SLVR_28FC_10X MT validity patch — ${COMMIT ? 'LIVE' : 'DRY-RUN'}\n`);
for (const job of JOBS) await run(job);
console.log('Done.');

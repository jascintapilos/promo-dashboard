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
  { siteId: 'ibc22',  mtId: 1229, label: 'QP2C'   },
  { siteId: 'qpro3',  mtId: 512,  label: 'QPRO3'  },
  { siteId: 'qpro4',  mtId: 444,  label: 'QPRO4'  },
  { siteId: 'qpro5',  mtId: 346,  label: 'QPRO5'  },
  { siteId: 'qpro7',  mtId: 539,  label: 'QPRO7'  },
  { siteId: 'qpro10', mtId: 530,  label: 'QPRO10' },
  { siteId: 'qpro15', mtId: 353,  label: 'QPRO15' },
  { siteId: 'qpro16', mtId: 330,  label: 'QPRO16' },
];

// EN: "thirty (30) days" → "seven (7) days"
const EN_RE = /thirty \(30\) days(, and the bonus will expire)/;
// ZH: "30 天内领取" → "7 天内领取"
const ZH_RE = /30 天内领取/;

function patchMessage(msg, localeCode) {
  const isZh = /zh/i.test(localeCode);
  if (isZh) {
    if (!ZH_RE.test(msg)) return { msg, skipped: 'anchor not found (30 天内领取)' };
    return { msg: msg.replace(ZH_RE, '7 天内领取'), skipped: null };
  }
  if (!EN_RE.test(msg)) return { msg, skipped: 'anchor not found (thirty (30) days)' };
  return { msg: msg.replace(EN_RE, 'seven (7) days$1'), skipped: null };
}

async function run(job) {
  const site = getSite(job.siteId);
  console.log(`── ${job.label.padEnd(7)} mt_id=${job.mtId} ──`);

  const res = await authedFetch(site, `/api/bo/messagetemplate/${job.mtId}`);
  const raw = res?.data?.rows || res?.data;
  const tmpl = raw?.message_template || res?.data?.message_template;
  const msgDetails = raw?.message_details || res?.data?.message_details || {};

  if (!tmpl) { console.log('  ✗ could not fetch template\n'); return; }

  const details = {};
  let patched = false;

  for (const [locId, d] of Object.entries(msgDetails)) {
    if (!d?.message) continue;
    const locCode = d.settings_locales_code || d.settings_locale_code || '';
    const { msg: newMsg, skipped } = patchMessage(d.message, locCode);
    details[locId] = { settings_locale_id: d.settings_locale_id, subject: d.subject || '', message: newMsg };
    if (skipped) {
      console.log(`  loc=${locId} (${locCode}) — skipped: ${skipped}`);
    } else {
      console.log(`  loc=${locId} (${locCode}) — patched`);
      patched = true;
    }
  }

  if (!patched) { console.log('  → nothing to update\n'); return; }
  if (!COMMIT)  { console.log(`  [DRY-RUN] would PUT /api/bo/messagetemplate/${job.mtId}\n`); return; }

  const putBody = { name: tmpl.name, section: tmpl.section, type: tmpl.type, status: tmpl.status, details };
  if (job.siteId.startsWith('qpro')) putBody.code = tmpl.code;

  await delay(600);
  const putRes = await authedFetch(site, `/api/bo/messagetemplate/${job.mtId}`, { method: 'PUT', body: putBody });
  const ok = putRes?.success === true || putRes?.data != null;
  console.log(`  PUT ${ok ? '✅ OK' : '❌ FAILED — ' + JSON.stringify(putRes?.message || '')}\n`);
}

console.log(`WC_SLVR_28FC_10X MT validity patch — ${COMMIT ? 'LIVE' : 'DRY-RUN'}\n`);
for (const job of JOBS) await run(job);
console.log('Done.');

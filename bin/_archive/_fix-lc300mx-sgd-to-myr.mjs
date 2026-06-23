#!/usr/bin/env node
// Fix the source-inherited SGD content bug on FT_REL_TLEO_LC_20PCT_300MX:
// the qpro2 source's MY_EN inbox locale has "SGD 1,500 / SGD 300" instead of MYR.
// The 4 MYR-only brands (qpro5/7/15/16) inherited this. MY_ZH is clean.
// Fix: replace SGD → MYR in the MY_EN message + verify.

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const BRANDS = ['qpro5', 'qpro7', 'qpro15', 'qpro16'];
const CODE = 'FT_REL_TLEO_LC_20PCT_300MX';

let ok = 0, fail = 0;
for (const brand of BRANDS) {
  const site = getSite(brand);
  try {
    const lr = await authedFetch(site, `/api/bo/promotion?code=${CODE}&perPage=5`);
    const lp = Object.values(lr.data?.rows || {}).find(p => p.code === CODE);
    if (!lp) { console.log(`${brand}: code not found`); fail++; continue; }
    const mtId = lp.message_template_id;
    const im = await authedFetch(site, `/api/bo/messagetemplate/${mtId}`);
    const meta = im.data?.message_template || im.data;
    const details = im.data?.message_details || {};
    let dirtyCount = 0;
    const newDetails = {};
    for (const [lid, d] of Object.entries(details)) {
      const subj = d.subject || '', msg = d.message || '';
      const newSubj = subj.replace(/SGD/g, 'MYR');
      const newMsg = msg.replace(/SGD/g, 'MYR');
      if (newSubj !== subj || newMsg !== msg) dirtyCount++;
      newDetails[lid] = { settings_locale_id: Number(d.settings_locale_id ?? lid), subject: newSubj, message: newMsg };
    }
    if (!dirtyCount) { console.log(`${brand}: already clean (no SGD)`); ok++; continue; }
    const body = { name: meta.name, code: meta.code, section: Number(meta.section), type: Number(meta.type), status: Number(meta.status) || 1, details: newDetails };
    await authedFetch(site, `/api/bo/messagetemplate/${mtId}`, { method: 'PUT', body });
    // verify
    const v = await authedFetch(site, `/api/bo/messagetemplate/${mtId}`);
    const stillSgd = Object.values(v.data?.message_details || {}).some(d => /SGD/.test(d.message || '') || /SGD/.test(d.subject || ''));
    console.log(`${brand}: MT ${mtId} ${stillSgd ? '⚠ still has SGD' : '✓ SGD→MYR'}`);
    if (stillSgd) fail++; else ok++;
  } catch (e) { console.error(`${brand}: ✗ ${e.message.split('\n')[0]}`); fail++; }
}
console.log(`\n=== SUMMARY ===  OK: ${ok}  Failed: ${fail}`);

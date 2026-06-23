#!/usr/bin/env node
// READ-ONLY. Dump created_by / updated_by for every CRM.SMS.* template on
// ibc22 so we can confirm the amend stayed within "CRM.SMS + created_by yh_bot".
// First prints the raw row shape so we can see how created_by is represented.

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const site = getSite('ibc22');

const all = [];
for (let pg = 1; pg <= 30; pg++) {
  const r = await authedFetch(site, `/api/bo/messagetemplate?perPage=200&page=${pg}`);
  const rows = Object.values(r.data?.rows || {});
  if (!rows.length) break;
  all.push(...rows);
  if (pg >= (r.data?.paginations?.last_page ?? 1)) break;
}
const crm = all.filter((t) => String(t.code || '').startsWith('CRM.SMS.'));
console.log(`CRM.SMS rows: ${crm.length}\n`);

// discover shape
console.log('Row keys:', Object.keys(crm[0] || {}).join(', '));
console.log('\ncreated/updated-ish fields on first row:');
for (const k of Object.keys(crm[0] || {})) {
  if (/creat|updat|user|_by|author/i.test(k)) console.log(`  ${k}: ${JSON.stringify(crm[0][k])}`);
}

const nameOf = (v) => (v && typeof v === 'object') ? (v.username ?? v.name ?? v.id ?? JSON.stringify(v)) : v;
const cbOf = (t) => nameOf(t.created_by_name ?? t.created_by_user ?? t.created_by);
const ubOf = (t) => nameOf(t.updated_by_name ?? t.updated_by_user ?? t.updated_by);

// tally
const tally = {};
for (const t of crm) { const cb = String(cbOf(t)); tally[cb] = (tally[cb] || 0) + 1; }
console.log('\ncreated_by tally:');
for (const [k, n] of Object.entries(tally)) console.log(`  ${k}: ${n}`);

// table
console.log('\n' + 'id'.padEnd(7) + 'created_by'.padEnd(16) + 'updated_by'.padEnd(16) + 'created_at'.padEnd(24) + 'code');
console.log('─'.repeat(110));
for (const t of crm.sort((a, b) => a.code.localeCompare(b.code))) {
  console.log(
    String(t.id).padEnd(7) +
    String(cbOf(t)).padEnd(16) +
    String(ubOf(t)).padEnd(16) +
    String(t.created_at || '').slice(0, 19).padEnd(24) +
    t.code,
  );
}

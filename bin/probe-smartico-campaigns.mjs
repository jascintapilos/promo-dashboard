#!/usr/bin/env node
/**
 * READ-ONLY. Probes Smartico to discover:
 *   1. All top-level fields on j_audience_scheduled records (including any creator fields)
 *   2. Which users exist on this tenant (to map team member names → user IDs)
 *   3. Sample of YTD campaigns with full field dump
 *   4. Whether created_by lives on the campaign or must be inferred from audit/history
 *
 * Run AFTER capture-smartico-session.mjs.
 *   node bin/probe-smartico-campaigns.mjs
 */
import { smarticoClient } from '../src/smartico-client.js';

const client = smarticoClient();
console.log(`\nSmartio probe  (token captured: ${client.capturedAt})\n`);

// ── 1. Fetch a small sample of campaigns to discover all field names ──
console.log('=== 1. Campaign field discovery (first 5 records) ===');
const sample = await client.list('j_audience_scheduled', { _start: 0, _end: 5, _sort: 'id', _order: 'DESC' });
if (!Array.isArray(sample) || !sample.length) {
  console.log('No campaigns returned — token may be expired.');
  process.exit(1);
}
const allKeys = [...new Set(sample.flatMap(r => Object.keys(r)))].sort();
console.log('Fields:', allKeys.join(', '));

// Highlight any user/creator-related fields
const creatorFields = allKeys.filter(k => /creat|author|user|owner|modif|updat|assign/i.test(k));
console.log('\nCreator-related fields:', creatorFields.length ? creatorFields.join(', ') : '(none found at top level)');

// Print those fields for each sample record
if (creatorFields.length) {
  console.log('\nCreator field values across sample:');
  for (const r of sample) {
    const vals = creatorFields.map(k => `${k}=${JSON.stringify(r[k])}`).join('  ');
    console.log(`  [${r.id}] ${String(r.audience_name || '').slice(0, 50).padEnd(50)}  ${vals}`);
  }
}

// ── 2. Full dump of first record to see nested structures ──
console.log('\n=== 2. Full first record ===');
console.log(JSON.stringify(sample[0], null, 2));

// ── 3. Probe j_users / label_users / users endpoint for team member list ──
console.log('\n=== 3. User/operator list ===');
const USER_RESOURCES = ['j_user', 'label_user', 'user', 'bo_user', 'operator', 'j_operator'];
for (const res of USER_RESOURCES) {
  try {
    const r = await client.list(res, { _start: 0, _end: 20 });
    if (Array.isArray(r) && r.length) {
      console.log(`\n  ✓ /${res}  (${r.length} rows returned)`);
      console.log('  Fields:', Object.keys(r[0]).join(', '));
      for (const u of r.slice(0, 10)) {
        const name = u.name || u.username || u.email || u.full_name || JSON.stringify(u).slice(0, 60);
        console.log(`    [${u.id}] ${name}`);
      }
    } else {
      console.log(`  ✗ /${res}  → empty or non-array`);
    }
  } catch (e) {
    console.log(`  ✗ /${res}  → ${e.message.slice(0, 60)}`);
  }
}

// ── 4. Probe RPC methods that might expose audit trail ──
console.log('\n=== 4. RPC audit probe ===');
const RPC_METHODS = ['getCampaignHistory', 'getAuditLog', 'getActivityLog', 'getUserActivity'];
for (const method of RPC_METHODS) {
  try {
    const r = await client.rpc(method, { id: sample[0].id });
    console.log(`  ✓ ${method} →`, JSON.stringify(r).slice(0, 120));
  } catch (e) {
    console.log(`  ✗ ${method} → ${e.message.slice(0, 60)}`);
  }
}

// ── 5. YTD campaigns — count and status breakdown ──
console.log('\n=== 5. YTD campaign count ===');
const YTD_START = `01/01/${new Date().getFullYear()}`;
const ytd = await client.list('j_audience_scheduled', {
  _start: 0, _end: 500, _sort: 'id', _order: 'ASC',
  // Smartico uses start_date filter; try both formats
  'start_date_gte': YTD_START,
});
const ytdArr = Array.isArray(ytd) ? ytd : [];
console.log(`Returned ${ytdArr.length} campaigns (may be capped at 500)`);
const byStatus = {};
for (const c of ytdArr) {
  const s = c.audience_status_id === 4 ? 'Active' : c.audience_status_id === 5 ? 'Ended' : c.audience_status_id === 1 ? 'Draft' : `status_${c.audience_status_id}`;
  byStatus[s] = (byStatus[s] || 0) + 1;
}
for (const [s, n] of Object.entries(byStatus)) console.log(`  ${s.padEnd(10)} ${n}`);

// ── 6. Check j_audience_scheduled single record for more detail ──
console.log('\n=== 6. Single campaign detail (GET by ID) ===');
try {
  const detail = await client.get('j_audience_scheduled', sample[0].id);
  const detailKeys = Object.keys(detail).sort();
  const newKeys = detailKeys.filter(k => !allKeys.includes(k));
  console.log('Extra fields in detail (not in list):', newKeys.length ? newKeys.join(', ') : '(none)');
  const detailCreator = detailKeys.filter(k => /creat|author|user|owner|modif|updat|assign/i.test(k));
  if (detailCreator.length) {
    console.log('Creator fields in detail:', detailCreator.map(k => `${k}=${JSON.stringify(detail[k])}`).join('  '));
  }
} catch (e) {
  console.log('Detail fetch failed:', e.message);
}

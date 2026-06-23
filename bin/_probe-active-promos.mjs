#!/usr/bin/env node
// READ-ONLY probe: enumerate active (status=1) promos on the QP2 BO across all
// 4 merchants, dedupe by promotion id, and report what the LISTING endpoint
// exposes (esp. auto_reward_activation + dialog_popup_list) so we can design a
// minimal-diff PUT. Touches nothing.
import { getSession, getAllPromotions } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const site = getSite('ibc22');
const session = await getSession(site);
console.log('Merchants on this BO:');
for (const m of session.merchants) console.log(`  id=${m.id}  ${m.name} (${m.prefix})`);

const merchantIds = session.merchants.map((m) => m.id);
const byId = new Map();           // id -> listing row (first seen)
const seenUnderMerchants = new Map(); // id -> Set(merchantId) where it showed up

for (const mid of [...merchantIds, '']) {
  let res;
  try {
    res = await getAllPromotions(site, { status: 1, merchantId: mid, perPage: 100 });
  } catch (e) {
    console.log(`  merchant_id=${mid || '(all)'} -> ERROR ${e.message.slice(0,100)}`);
    continue;
  }
  console.log(`  merchant_id=${String(mid || '(all)').padEnd(6)} -> ${res.rows.length} active rows (pages=${res.pages})`);
  for (const r of res.rows) {
    if (!byId.has(r.id)) byId.set(r.id, r);
    if (!seenUnderMerchants.has(r.id)) seenUnderMerchants.set(r.id, new Set());
    if (mid !== '') seenUnderMerchants.get(r.id).add(mid);
  }
}

const rows = [...byId.values()];
console.log(`\nDISTINCT active promos (deduped by id): ${rows.length}`);

// What fields does the listing row carry?
const sample = rows[0];
console.log('\nListing row field keys:', Object.keys(sample).sort().join(', '));
const hasAuto = 'auto_reward_activation' in sample;
const hasDialog = 'dialog_popup_list' in sample;
console.log(`listing has auto_reward_activation? ${hasAuto}   has dialog_popup_list? ${hasDialog}`);

if (hasAuto) {
  const off = rows.filter((r) => Number(r.auto_reward_activation) !== 1);
  const on  = rows.filter((r) => Number(r.auto_reward_activation) === 1);
  console.log(`\nauto_reward_activation: ON=${on.length}  OFF(need flip)=${off.length}`);
}

// breakdown by created_by if present
if ('created_by' in sample) {
  const byCreator = {};
  for (const r of rows) byCreator[r.created_by] = (byCreator[r.created_by] || 0) + 1;
  console.log('\nBy created_by:');
  for (const [k, v] of Object.entries(byCreator).sort((a,b)=>b[1]-a[1])) console.log(`  ${String(k).padEnd(18)} ${v}`);
}

// dump one full listing row so we see the exact shape
console.log('\n── FULL SAMPLE LISTING ROW ──');
console.log(JSON.stringify(sample, null, 2).slice(0, 4000));

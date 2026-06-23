#!/usr/bin/env node
// READ-ONLY: list the active promos whose auto_reward_activation is OFF.
// Saves them to captures/auto-reward-off.json for the mutator to consume.
import { getSession, getAllPromotions } from '../src/api-client.js';
import { getSite } from '../src/sites.js';
import { writeFileSync } from 'node:fs';

const site = getSite('ibc22');
const session = await getSession(site);
const merchantIds = session.merchants.map((m) => m.id);
const nameById = Object.fromEntries(session.merchants.map((m) => [m.id, m.prefix]));

const byId = new Map();
for (const mid of [...merchantIds, '']) {
  const res = await getAllPromotions(site, { status: 1, merchantId: mid, perPage: 100 });
  for (const r of res.rows) if (!byId.has(r.id)) byId.set(r.id, r);
}

const off = [...byId.values()].filter((r) => Number(r.auto_reward_activation) !== 1);
off.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));

const PROMO_TYPE = { 1: 'Deposit', 2: 'Cashback', 3: 'Free Credit', 4: 'Free Spin', 5: 'Rebate' };

console.log(`\n${off.length} active promos with Auto Reward Activation = OFF:\n`);
console.log('  id     merch        type        created_by      popup  created_at   code');
console.log('  ' + '─'.repeat(110));
const records = [];
for (const r of off) {
  const merchPrefixes = (r.merchant_ids || []).map((m) => nameById[m.id] || m.name || m.id).join('+');
  const type = PROMO_TYPE[r.promo_type] || `t${r.promo_type}`;
  const popup = (r.dialog_popup_list || []).length ? `y(${r.dialog_popup_list.length})` : '-';
  const created = String(r.created_at).slice(0, 10);
  console.log(
    `  ${String(r.id).padEnd(6)} ${merchPrefixes.padEnd(12)} ${type.padEnd(11)} ${String(r.created_by).padEnd(15)} ${popup.padEnd(6)} ${created}   ${r.code}`,
  );
  records.push({
    id: r.id, code: r.code, name: r.name, promo_type: r.promo_type, type,
    merchants: merchPrefixes, created_by: r.created_by, created_at: r.created_at,
    valid_from: r.valid_from, valid_to: r.valid_to,
    dialog_popups: (r.dialog_popup_list || []).map((d) => d.popup_id),
    auto_reward_activation: r.auto_reward_activation,
  });
}

writeFileSync('captures/auto-reward-off.json', JSON.stringify(records, null, 2));
console.log(`\nSaved ${records.length} records → captures/auto-reward-off.json`);

// creator breakdown of the OFF set
const byCreator = {};
for (const r of off) byCreator[r.created_by] = (byCreator[r.created_by] || 0) + 1;
console.log('\nOFF-set by creator:');
for (const [k, v] of Object.entries(byCreator).sort((a, b) => b[1] - a[1])) console.log(`  ${String(k).padEnd(18)} ${v}`);

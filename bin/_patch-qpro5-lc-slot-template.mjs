// Configure qpro5 blacklist template id=9 "Live Casino and Slot"
// Currently has settings:[] — needs LC + Slots sub-cats for MYR and SGD.
//
// MYR sub-cats (62):
//   - LC (24): sub-cats in "All games" MYR with category=LIVE CASINO
//   - Slots (38): sub-cats from "Slots Only" MYR template
// SGD sub-cats (40):
//   - "Slots, LC, Sports" SGD (Sports-SGD=0 on this brand, so = Slots+LC for SGD)
//
// PUT body: { name, remarks, status, sub_categories: { "1": [...], "3": [...] } }
// Note: verify via LIST endpoint, not detail endpoint (detail returns settings:[])
//
// Usage:
//   node bin/_patch-qpro5-lc-slot-template.mjs          # dry-run
//   node bin/_patch-qpro5-lc-slot-template.mjs --commit  # apply live

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';
import { readFile } from 'node:fs/promises';
import { parseArgs } from './_args.js';

const { flags } = parseArgs(process.argv.slice(2));
const COMMIT = !!flags.commit;

const site = getSite('qpro5');
const TEMPLATE_ID = 9;
const TEMPLATE_NAME = 'Live Casino and Slot';

// Load sub-cat catalog
const catalog = JSON.parse(await readFile('./captures/blacklist-templates/qpro5-subcat-catalog.json', 'utf8'));

// Load qpro5 template snapshots
const a5 = JSON.parse(await readFile('./captures/blacklist-templates/2026-06-08/qpro5.json', 'utf8'));

const getIds = (tmpl, curr) =>
  (tmpl.settings || []).filter(s => s.settings_currency_id === curr).map(s => s.game_provider_sub_category_id);

const allGames = a5.find(x => x.id === 3);
const slotsOnly = a5.find(x => x.id === 1);
const slcSports = a5.find(x => x.id === 2);

// MYR: LC from "All games" + Slots from "Slots Only"
const lcMYR = getIds(allGames, 1).filter(id => catalog[id]?.cat === 'LIVE CASINO');
const slotsMYR = getIds(slotsOnly, 1);
const myrSubcats = [...new Set([...lcMYR, ...slotsMYR])];

// SGD: "SLC+Sports" SGD (Sports-SGD=0 on qpro5)
const sgdSubcats = getIds(slcSports, 3);

console.log('=== qpro5 "Live Casino and Slot" template (id=9) configuration ===');
console.log(`Mode: ${COMMIT ? 'COMMIT (live)' : 'DRY-RUN'}`);
console.log();
console.log(`MYR sub-cats: LC=${lcMYR.length} + Slots=${slotsMYR.length} = ${myrSubcats.length} unique`);
console.log(`SGD sub-cats: ${sgdSubcats.length} (from "SLC+Sports" SGD)`);
console.log(`Total settings: ${myrSubcats.length + sgdSubcats.length}`);

const body = {
  name: TEMPLATE_NAME,
  remarks: '',
  status: 1,
  sub_categories: {
    '1': myrSubcats,
    '3': sgdSubcats,
  },
};

if (!COMMIT) {
  console.log('\n[DRY-RUN] Would PUT /api/bo/blacklist/' + TEMPLATE_ID);
  console.log('Add --commit to apply.');
  process.exit(0);
}

console.log('\nApplying...');
const result = await authedFetch(site, `/api/bo/blacklist/${TEMPLATE_ID}`, {
  method: 'PUT',
  body,
});

// Verify from the PUT response (which includes settings) + list endpoint
const settingsInResponse = result?.data?.settings || [];
const byCurrRes = {};
settingsInResponse.forEach(s => byCurrRes[s.settings_currency_id] = (byCurrRes[s.settings_currency_id]||0)+1);
console.log('Settings in PUT response:', settingsInResponse.length, JSON.stringify(byCurrRes));

// Double-check via list
const list = await authedFetch(site, '/api/bo/blacklist?perPage=200&page=1');
const tmplAfter = (list?.data?.rows || []).find(x => x.id === TEMPLATE_ID);
const settingsAfter = tmplAfter?.settings || [];
const byCurrAfter = {};
settingsAfter.forEach(s => byCurrAfter[s.settings_currency_id] = (byCurrAfter[s.settings_currency_id]||0)+1);

console.log('Settings from LIST verification:', settingsAfter.length, JSON.stringify(byCurrAfter));
console.log();
if (settingsAfter.length === myrSubcats.length + sgdSubcats.length) {
  console.log(`✓ Template id=${TEMPLATE_ID} "${TEMPLATE_NAME}" configured successfully`);
  console.log(`  MYR: ${byCurrAfter[1] || 0} sub-cats  SGD: ${byCurrAfter[3] || 0} sub-cats`);
} else {
  console.log(`✗ Mismatch: expected ${myrSubcats.length + sgdSubcats.length} but got ${settingsAfter.length}`);
}

#!/usr/bin/env node
// Cache QPRO2 game_provider + categories catalog so we can map source gp_ids → names.
import fs from 'node:fs';
import { getAllGameProviders, getAllCategories } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const site = getSite('qpro2');
const { rows: providers } = await getAllGameProviders(site);
const categories = await getAllCategories(site);

const out = {
  providers_by_id: Object.fromEntries(providers.map((p) => [p.id, { id: p.id, code: p.code, name: p.name }])),
  providers_by_name: Object.fromEntries(providers.map((p) => [String(p.name).toUpperCase(), p.id])),
  providers_by_code: Object.fromEntries(providers.map((p) => [String(p.code || '').toUpperCase(), p.id])),
  categories,
};
fs.writeFileSync('tmp/qpro2-catalog.json', JSON.stringify(out, null, 2));
console.log(`QPRO2: ${providers.length} providers, ${categories.length} categories cached`);
console.log('categories:', categories.map((c) => c.name).join(', '));

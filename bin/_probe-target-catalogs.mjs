#!/usr/bin/env node
// Cache each target brand's gp + category catalogs for replication mapping.
import fs from 'node:fs';
import { getAllGameProviders, getAllCategories } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const TARGETS = ['qpro3', 'qpro4', 'qpro6', 'qpro8', 'qpro10'];

const out = {};
for (const id of TARGETS) {
  const site = getSite(id);
  const [{ rows: providers }, categories] = await Promise.all([
    getAllGameProviders(site),
    getAllCategories(site),
  ]);
  out[id] = {
    providers_by_code: Object.fromEntries(providers.map((p) => [String(p.code || '').toUpperCase(), { id: p.id, name: p.name }])),
    categories_by_name: Object.fromEntries(categories.map((c) => [String(c.name || '').toUpperCase(), c.id])),
    providers_count: providers.length,
    categories_count: categories.length,
  };
  console.log(`${id}: ${providers.length} providers, ${categories.length} categories`);
  console.log(`  cat names: ${categories.map((c) => c.name).join(', ')}`);
}
fs.writeFileSync('tmp/target-catalogs.json', JSON.stringify(out, null, 2));
console.log('\nWrote tmp/target-catalogs.json');

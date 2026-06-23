#!/usr/bin/env node
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';
for (const b of ['qpro5','qpro7','qpro15','qpro16']) {
  const r = await authedFetch(getSite(b), '/api/bo/categories?perPage=500');
  const cats = Object.values(r.data?.rows || {});
  const lc = cats.find(c => c.code === 'LC');
  const sl = cats.find(c => c.code === 'SL');
  console.log(`${b}: LC=${lc?.id} SL=${sl?.id}`);
}

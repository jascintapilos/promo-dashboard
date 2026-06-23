#!/usr/bin/env node
// Check whether popup PUT/PATCH endpoint exists. Test with no-op update on qpro3 popup 278.
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const site = getSite('qpro3');
// First fetch popup detail to see what fields exist
try {
  const r = await authedFetch(site, '/api/bo/popups?perPage=300&page=1');
  const arr = Object.values(r.data?.rows || {});
  const pop = arr.find(p => p.id === 278);
  console.log('Popup 278 keys:', Object.keys(pop || {}).join(', '));
  console.log('label/title:', pop?.label, '|', pop?.title);
} catch (e) { console.log('LIST err:', e.message.split('\n')[0]); }

// Try GET detail
for (const m of ['GET']) {
  try { const r = await authedFetch(site, `/api/bo/popups/278`, { method: m }); console.log(`${m} OK:`, JSON.stringify(r.data).slice(0,400)); }
  catch (e) { console.log(`${m} ERR:`, e.message.split('\n')[0]); }
}

// Try PUT no-op
try {
  const r = await authedFetch(site, '/api/bo/popups/278', { method: 'PUT', body: { id: 278, label: 'test-noop', platform: 1, session: 3, position: 99, status: 1, location: 1, affiliates_visibility: 0, always_pop: 0 } });
  console.log('PUT response:', JSON.stringify(r.data).slice(0, 400));
} catch (e) { console.log('PUT ERR:', e.message.split('\n')[0]); }

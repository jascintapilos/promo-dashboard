#!/usr/bin/env node
// Dump full list-row for popup 281 (qpro3 bare-title popup), then probe PUT shape.
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const site = getSite('qpro3');
// scan popups for 281
const r = await authedFetch(site, '/api/bo/popups?perPage=300&page=1');
const arr = Object.values(r.data?.rows || {});
const pop = arr.find(p => p.id === 281);
console.log('Popup 281 FULL:\n' + JSON.stringify(pop, null, 2));

// Try PUT with full shape — preserve everything, just rename label
const fullBody = {
  ...pop,
  label: pop.label + ' [test]',
};
delete fullBody.platform_name;
delete fullBody.status_name;
delete fullBody.session_name;
delete fullBody.locale_name;
delete fullBody.locale_ids;
delete fullBody.created_at;
delete fullBody.updated_at;
delete fullBody.created_by;
delete fullBody.updated_by;
try {
  const r2 = await authedFetch(site, `/api/bo/popups/${pop.id}`, { method: 'PUT', body: fullBody });
  console.log('PUT OK:', JSON.stringify(r2.data).slice(0, 200));
} catch (e) {
  console.log('PUT ERR:', e.message.split('\n')[0]);
  // Try with id stripped
  try {
    const b2 = { ...fullBody }; delete b2.id;
    const r3 = await authedFetch(site, `/api/bo/popups/${pop.id}`, { method: 'PUT', body: b2 });
    console.log('PUT (no id) OK:', JSON.stringify(r3.data).slice(0, 200));
  } catch (e2) { console.log('PUT (no id) ERR:', e2.message.split('\n')[0]); }
}

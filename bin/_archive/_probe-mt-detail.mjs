#!/usr/bin/env node
// Probe MT GET detail + attempt minimal PUT to find correct body shape.
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const PROBES = [
  { siteId: 'qpro11', mtId: 212 },  // TEST_QPRO_QC_DEP_V2
  { siteId: 'ibc22',  mtId: 1161 }, // TEST_QP2_QC_DEP_V2
];

for (const { siteId, mtId } of PROBES) {
  const site = getSite(siteId);
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`${siteId} — MT id=${mtId}`);
  console.log('═'.repeat(60));

  const res = await authedFetch(site, `/api/bo/messagetemplate/${mtId}`);
  const tmpl = res?.data?.message_template;
  const details = res?.data?.message_details;

  console.log('\nmessage_template keys:', Object.keys(tmpl || {}));
  console.log('message_template:', JSON.stringify(tmpl, null, 2));
  console.log('\nmessage_details (first entry):', JSON.stringify((details || [])[0], null, 2));
  console.log('message_details length:', (details || []).length);

  // Attempt a PUT with status=0 using the correct shape
  const putBody = {
    name:    tmpl.name,
    section: tmpl.section,
    type:    tmpl.type,
    status:  0,
    details: details,
  };
  if (siteId.startsWith('qpro')) putBody.code = tmpl.code;

  console.log('\nAttempting PUT with body:', JSON.stringify(putBody, null, 2).slice(0, 500));
  try {
    const putRes = await authedFetch(site, `/api/bo/messagetemplate/${mtId}`, { method: 'PUT', body: putBody });
    console.log('PUT result:', JSON.stringify(putRes, null, 2).slice(0, 300));
  } catch (e) {
    console.log('PUT error:', e.message.slice(0, 300));
  }
}

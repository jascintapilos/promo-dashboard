#!/usr/bin/env node
// Probe and compare QPRO4 vs QP2C dialog popup body content for P001
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const qpro4 = getSite('qpro4');
const ibc22 = getSite('ibc22');

// P001 dialog IDs
const PROBES = [
  { label: 'QPRO4', site: qpro4, dialogId: 312 },
  { label: 'QP2C',  site: ibc22, dialogId: 1475 },
];

for (const { label, site, dialogId } of PROBES) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`${label} — Dialog ${dialogId}`);
  console.log('═'.repeat(60));

  // Scan pages to find the popup
  let row = null;
  let page = 1;
  while (!row) {
    const res = await authedFetch(site, `/api/bo/popups?page=${page}&perPage=50`);
    const rows = res?.data?.rows || [];
    row = rows.find(r => r.id === dialogId);
    if (rows.length < 50 || row) break;
    page++;
  }

  if (!row) { console.log('NOT FOUND'); continue; }

  console.log(`title (top-level): ${row.title ?? '(none)'}`);
  console.log(`status: ${row.status}, position: ${row.position}`);

  for (const [idx, content] of Object.entries(row.contents || {})) {
    console.log(`\n  [${idx}] locale_name: ${content.locale_name} | locale_id: ${content.locale_id}`);
    console.log(`       title: ${content.title}`);
    console.log(`       cta_1: "${content.cta_button_text_1}" → ${content.cta_button_link_1}`);
    console.log(`       cta_2: "${content.cta_button_text_2}" → ${content.cta_button_link_2}`);
    console.log(`       content (first 400 chars):\n${(content.content || '').slice(0, 400)}`);
    if ((content.content || '').length > 400) console.log('       ...[truncated]');
  }
}

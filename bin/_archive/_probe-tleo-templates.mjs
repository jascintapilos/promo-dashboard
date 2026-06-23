#!/usr/bin/env node
// Fetch message template content for each source code on QPRO2.
import fs from 'node:fs';
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const raw = JSON.parse(fs.readFileSync('tmp/tleo-raw.json', 'utf8'));
const site = getSite('qpro2');
const templates = {};

for (const [targetCode, r] of Object.entries(raw)) {
  const mtId = r.main.message_template_id;
  if (!mtId) continue;
  if (templates[mtId]) continue;
  const det = await authedFetch(site, `/api/bo/messagetemplate/${mtId}`);
  const m = det.data.message_template;
  const details = det.data.message_details;
  templates[mtId] = {
    id: m.id,
    name: m.name,
    code: m.code,
    section: m.section,
    type: m.type,
    status: m.status,
    details,
  };
  console.log(`mt=${mtId} name="${m.name}" code="${m.code}" locales=${Object.keys(details||{}).join(',')}`);
}

fs.writeFileSync('tmp/tleo-templates.json', JSON.stringify(templates, null, 2));
console.log(`\nWrote tmp/tleo-templates.json (${Object.keys(templates).length} templates)`);

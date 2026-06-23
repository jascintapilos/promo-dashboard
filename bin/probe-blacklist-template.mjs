// Probe a QPRO brand for Blacklist Template listing.
// Endpoint confirmed 2026-05-26: GET /api/bo/blacklist
// Each row's `name` field encodes the category coverage,
// e.g. "Slots, Live Casino, Sports". This is what the resolver matches
// against record.categories to pick the right blacklist_template_id.
//
// Usage:
//   node bin/probe-blacklist-template.mjs --site=qpro1
//   node bin/probe-blacklist-template.mjs --sites=qpro1,qpro2,qpro11

import { authedFetch } from '../src/api-client.js';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from './_args.js';

const { flags } = parseArgs(process.argv.slice(2));
const sites = (flags.sites || flags.site || 'qpro11')
  .split(',').map((s) => s.trim()).filter(Boolean);

const OUT = path.resolve('captures/blacklist-templates');
await mkdir(OUT, { recursive: true });

for (const siteId of sites) {
  console.log(`\n━━━━━━━━━━━━━━ ${siteId} — blacklist templates ━━━━━━━━━━━━━━`);
  try {
    const r = await authedFetch(siteId, '/api/bo/blacklist?perPage=200&page=1');
    const rows = r?.data?.rows || [];
    console.log(`Found ${rows.length} templates`);
    console.log('');
    rows.forEach((t) => {
      const settingCount = Array.isArray(t.settings) ? t.settings.length : 0;
      const currIds = [...new Set((t.settings || []).map((s) => s.settings_currency_id))].sort((a, b) => a - b);
      console.log(`  id=${String(t.id).padStart(3)}  status=${t.status}  curr=[${currIds.join(',')}]  settings=${String(settingCount).padStart(3)}  name="${t.name}"`);
    });
    await writeFile(path.join(OUT, `${siteId}.json`), JSON.stringify(rows, null, 2));
    console.log(`\nSaved snapshot → captures/blacklist-templates/${siteId}.json`);
  } catch (e) {
    console.log(`  ERROR — ${(e.message || '').split('\n')[0]}`);
  }
}

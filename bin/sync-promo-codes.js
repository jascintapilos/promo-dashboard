#!/usr/bin/env node
// Pull a snapshot of every BO's active promo codes (3.2 page) and save
// per-(site, merchant) JSON files under captures/bo-codes/. Phase 4.5 uses
// these as the lookup source when a request says "duplicate this old code"
// and the old code isn't in the recent request log.
//
//   node bin/sync-promo-codes.js               # all sites
//   node bin/sync-promo-codes.js --site=qpro1  # just one site
//
// Output:
//   captures/bo-codes/<site>-<merchant>.json   # one file per merchant
//   captures/bo-codes/_summary.json            # cross-cut: total per site

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from './_args.js';
import { listSites, getSite } from '../src/sites.js';
import { getSession, getAllPromotions } from '../src/api-client.js';

const { flags } = parseArgs(process.argv.slice(2));
const OUT = path.resolve('captures/bo-codes');
await mkdir(OUT, { recursive: true });

const targets = flags.site ? [getSite(flags.site)] : listSites();

const summary = { syncedAt: new Date().toISOString(), sites: {} };
let totalCodes = 0;

for (const site of targets) {
  // Login once per site — this populates merchants[] on the session.
  let session;
  try {
    session = await getSession(site);
  } catch (e) {
    console.log(`✗ ${site.id.padEnd(7)}  login failed: ${e.message.split('\n')[0]}`);
    summary.sites[site.id] = { error: e.message };
    continue;
  }

  const siteEntry = { merchants: {}, totalCodes: 0 };
  for (const m of session.merchants) {
    try {
      const { rows, total } = await getAllPromotions(site, { merchantId: m.id, status: 1 });
      // Keep only the fields we need for the parent-lookup use case.
      // The full detail (min_dep, TO, spin_count etc.) comes from a separate
      // call per code when a request actually references it.
      const slim = rows.map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        promo_type: r.promo_type,
        valid_from: r.valid_from,
        valid_to: r.valid_to,
        merchant_id: m.id,
        merchant_name: m.name,
      }));
      const file = path.join(OUT, `${site.id}-${m.name}.json`);
      await writeFile(file, JSON.stringify({ site: site.id, merchant: m.name, total, rows: slim }, null, 2) + '\n');
      console.log(`OK ${site.id.padEnd(7)} ${m.name.padEnd(15)} ${total} codes → ${path.relative(process.cwd(), file)}`);
      siteEntry.merchants[m.name] = total;
      siteEntry.totalCodes += total;
      totalCodes += total;
    } catch (e) {
      console.log(`✗  ${site.id.padEnd(7)} ${m.name.padEnd(15)} fetch failed: ${e.message.split('\n')[0]}`);
      siteEntry.merchants[m.name] = { error: e.message };
    }
  }
  summary.sites[site.id] = siteEntry;
}

await writeFile(path.join(OUT, '_summary.json'), JSON.stringify(summary, null, 2) + '\n');

console.log(`\nTotal active codes across all sites: ${totalCodes}`);
console.log(`Summary: ${path.relative(process.cwd(), path.join(OUT, '_summary.json'))}`);

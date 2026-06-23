#!/usr/bin/env node
// List active promotion content (3.3 page) for a brand on a chosen BO site.
//
//   node bin/promo-contents.js [--site=<id>] <BRAND> [--all] [--limit=N] [--json]
//
// Site defaults to bo-sites.json `defaultSite`. Brand resolves by name or prefix
// inside the session's merchant_dropdown.

import { parseArgs } from './_args.js';
import { getSite } from '../src/sites.js';
import {
  resolveMerchant,
  getPromotionContents,
  getAllPromotionContents,
} from '../src/api-client.js';

const { flags, positional } = parseArgs(process.argv.slice(2));
const merchantArg = positional[0];
if (!merchantArg) {
  console.error('usage: promo-contents.js [--site=<id>] <BRAND> [--all] [--limit=N] [--json]');
  process.exit(2);
}

const site = getSite(flags.site);
const limit = Number(flags.limit) || 0;
const all = flags.all === true;
const asJson = flags.json === true;

const merchant = await resolveMerchant(site, merchantArg);
const opts = { siteFilterId: merchant.id, status: 1, type: 0, sortBy: 'id', sortOrder: 'desc', perPage: 100 };

let rows, total, pages;
if (all) {
  ({ rows, total, pages } = await getAllPromotionContents(site, opts));
} else {
  const r = await getPromotionContents(site, opts);
  rows = r.data.rows;
  total = r.data.paginations?.total ?? rows.length;
  pages = r.data.paginations?.last_page ?? 1;
}
if (limit) rows = rows.slice(0, limit);

if (asJson) {
  console.log(JSON.stringify({ site: site.id, merchant: merchant.name, total, pages, returned: rows.length, rows }, null, 2));
} else {
  console.log(`Site: ${site.id} (${site.label})`);
  console.log(`Merchant: ${merchant.name} (site_id=${merchant.id})`);
  console.log(`Active promotion contents: ${total} total, ${pages} page(s). Showing ${rows.length}, sorted by id desc.\n`);
  console.log(['ID', 'Code', 'Categories', 'Pos', 'Visibility', 'Locales', 'Title'].join('\t'));
  for (const r of rows) {
    console.log([
      r.id,
      r.code,
      r.categories,
      r.position,
      r.member_visibility_name,
      r.locales,
      (r.title || '').slice(0, 80),
    ].join('\t'));
  }
}

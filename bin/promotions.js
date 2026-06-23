#!/usr/bin/env node
// List promotions (3.2 Promotion Codes page) for a brand on a chosen BO site.
//
//   node bin/promotions.js [--site=<id>] <BRAND> [--all] [--limit=N] [--json]

import { parseArgs } from './_args.js';
import { getSite } from '../src/sites.js';
import {
  resolveMerchant,
  getPromotions,
  getAllPromotions,
} from '../src/api-client.js';

const { flags, positional } = parseArgs(process.argv.slice(2));
const merchantArg = positional[0];
if (!merchantArg) {
  console.error('usage: promotions.js [--site=<id>] <BRAND> [--all] [--limit=N] [--json]');
  process.exit(2);
}

const site = getSite(flags.site);
const limit = Number(flags.limit) || 0;
const all = flags.all === true;
const asJson = flags.json === true;

const merchant = await resolveMerchant(site, merchantArg);
const opts = { merchantId: merchant.id, status: 1, sortBy: 'id', sortOrder: 'desc', perPage: 100 };

let rows, total, pages;
if (all) {
  ({ rows, total, pages } = await getAllPromotions(site, opts));
} else {
  const r = await getPromotions(site, opts);
  rows = r.data.rows;
  total = r.data.paginations?.total ?? rows.length;
  pages = r.data.paginations?.last_page ?? 1;
}
if (limit) rows = rows.slice(0, limit);

if (asJson) {
  console.log(JSON.stringify({ site: site.id, merchant: merchant.name, total, pages, returned: rows.length, rows }, null, 2));
} else {
  console.log(`Site: ${site.id} (${site.label})`);
  console.log(`Merchant: ${merchant.name} (id=${merchant.id}, prefix=${merchant.prefix})`);
  console.log(`Active promotions: ${total} total, ${pages} page(s). Showing ${rows.length}, sorted by id desc.\n`);
  console.log(['ID', 'Code', 'Name', 'Type', 'Valid From', 'Valid To'].join('\t'));
  for (const r of rows) {
    console.log([r.id, r.code, r.name, r.promo_type, r.valid_from ?? '', r.valid_to ?? ''].join('\t'));
  }
}

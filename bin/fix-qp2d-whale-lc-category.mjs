#!/usr/bin/env node
// Correct three QP2D Whale Probe promos to their request-defined LIVE CASINO
// category and provider set. Dry-run by default; pass --commit for live PUTs.

import { authedFetch, updatePromotion } from '../src/api-client.js';
import { buildApiPlan } from '../src/api-mapper-qp2.js';
import { getSite } from '../src/sites.js';
import { readFileSync } from 'node:fs';

const commit = process.argv.includes('--commit');
const smsTemplateId = 1321;
const site = getSite('ibc22');
const targets = [
  ['P039-r40', 'WHALE_CRM_PROBE_20PCT_200_FTD_WIN_2'],
  ['P045-r46', 'WHALE_CRM_PROBE_20PCT_200_FTD_WIN_4'],
  ['P046-r47', 'WHALE_CRM_PROBE_20PCT_300_FTD_WIN_4'],
];
const vals = (v) => v == null ? [] : Array.isArray(v) ? v : Object.values(v);
const sig = (rows) => rows.map((r) => [r.currency, r.min_transfer, r.max_bonus, r.rounds, r.status].join('|')).sort().join(';');

const catsRes = await authedFetch(site, '/api/bo/categories?perPage=500');
const cats = vals(catsRes.data?.rows);
const catName = Object.fromEntries(cats.map((c) => [Number(c.id), c.name]));
const live = cats.find((c) => String(c.name).toUpperCase() === 'LIVE CASINO');
if (!live) throw new Error('LIVE CASINO category was not found');

const popupsRes = await authedFetch(site, '/api/bo/popups?perPage=500&sort_by=id&sort_order=desc&page=1');
const popups = vals(popupsRes.data?.rows);

for (const [handle, code] of targets) {
  const list = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(code)}&perPage=10`);
  const row = vals(list.data?.rows).find((r) => r.code === code && !r.deleted_at);
  if (!row) { console.log(`NOT FOUND ${code}`); continue; }
  const before = (await authedFetch(site, `/api/bo/promotion/${row.id}`)).data.rows;
  const beforeCats = vals(before.promotion_category_ids).map(Number);
  const beforeCur = vals((await authedFetch(site, `/api/bo/promotioncurrency?promotion_id=${row.id}&perPage=20`)).data?.rows);
  const merchants = vals(before.merchant_ids).map((m) => typeof m === 'object' ? m.id : m);
  const request = JSON.parse(readFileSync(`captures/requests/${handle}.json`, 'utf8'));
  const plan = await buildApiPlan(request, { brand: 'QP2D', site, merchantIds: merchants });
  const body = plan.buildUpdate(row.id, before.message_template_id || 0, null);

  body.promotion_category_ids = { '0': Number(live.id) };
  body.message_template_sms_id = smsTemplateId;
  body.merchant_ids = Object.fromEntries(merchants.map((id, i) => [String(i), id]));
  const dialogLinks = vals(row.dialog_popup_list);
  if (dialogLinks.length) {
    body.dialog_popup_list = Object.fromEntries(dialogLinks.map((link, i) => {
      const full = popups.find((p) => p.id === link.popup_id);
      return [String(i), { ...(full || link), promotion_id: row.id }];
    }));
  }

  console.log(`${commit ? 'LIVE' : 'DRY'} ${code} id=${row.id} cats=[${beforeCats.map((id) => catName[id] || id).join(', ')}] -> [LIVE CASINO] providers=${vals(before.game_provider_codes).length}->${vals(body.game_provider_codes).length} sms=${before.message_template_sms_id || 0}->${smsTemplateId}`);
  if (!commit) continue;

  await updatePromotion(site, row.id, body);
  const after = (await authedFetch(site, `/api/bo/promotion/${row.id}`)).data.rows;
  const afterCats = vals(after.promotion_category_ids).map(Number);
  const afterCur = vals((await authedFetch(site, `/api/bo/promotioncurrency?promotion_id=${row.id}&perPage=20`)).data?.rows);
  const ok = afterCats.length === 1 && afterCats[0] === Number(live.id)
    && sig(beforeCur) === sig(afterCur)
    && after.message_template_id === before.message_template_id
    && after.message_template_sms_id === smsTemplateId
    && vals(after.merchant_ids).length === merchants.length;
  console.log(`${ok ? 'VERIFIED' : 'VERIFY FAILED'} ${code} cats=[${afterCats.map((id) => catName[id] || id).join(', ')}] providers=${vals(after.game_provider_codes).length}`);
  if (!ok) throw new Error(`Post-write verification failed for ${code}`);
}

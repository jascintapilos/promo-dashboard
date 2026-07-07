// Phase 2 probe: FT_REL_30PCT_8X — promotion DETAIL (blacklist_id, category,
// game_provider) + per-currency rows. Read-only.

import { authedFetch } from '../src/api-client.js';
import { readFile, writeFile } from 'node:fs/promises';

const prev = JSON.parse(await readFile('captures/probe-ft-rel-30pct-8x.json', 'utf8'));
const out = {};

for (const [site, rec] of Object.entries(prev)) {
  if (!rec.promo) continue;
  const id = rec.promo.id;
  const o = { id };
  out[site] = o;
  try {
    const d = await authedFetch(site, `/api/bo/promotion/${id}`);
    const detail = d?.data?.rows || d?.data;
    o.blacklist_id = detail.blacklist_id;
    o.category = detail.category ?? rec.promo.category;
    o.game_provider_len = String(detail.game_provider ?? '').split(',').filter(Boolean).length;
    const blName = (rec.blacklistCatalog || []).find((t) => t.id === detail.blacklist_id);
    console.log(`━━━ ${site} ━━━ blacklist_id=${detail.blacklist_id} → ${blName ? `"${blName.name}"` : '(no catalog match)'}`);
    console.log(`  category="${o.category}"  providers=${o.game_provider_len}`);
  } catch (e) { o.detailError = e.message; console.log(`${site} detail ERROR: ${e.message.split('\n')[0]}`); }
  try {
    const c = await authedFetch(site, `/api/bo/promotion/${id}/promotioncurrency`);
    const rows = c?.data?.rows || c?.data || [];
    o.currencies = (Array.isArray(rows) ? rows : Object.values(rows)).map((r) => ({
      currency_id: r.settings_currency_id ?? r.currency_id,
      min_deposit: r.min_deposit, max_bonus: r.max_bonus,
      bonus_rate: r.bonus_rate, turnover: r.turnover_multiplier ?? r.turnover,
    }));
    o.currencies.forEach((r) => console.log(`  curr=${r.currency_id} minDep=${r.min_deposit} maxBonus=${r.max_bonus} rate=${r.bonus_rate} TO=${r.turnover}`));
  } catch (e) { o.currError = e.message; console.log(`  currency ERROR: ${e.message.split('\n')[0]}`); }
}

await writeFile('captures/probe-ft-rel-30pct-8x-detail.json', JSON.stringify(out, null, 2));
console.log('\nSaved → captures/probe-ft-rel-30pct-8x-detail.json');

#!/usr/bin/env node
// One-off read-only check (2026-07-09): verify P026's QPRO saves are
// Slots-only with the provider selection acting as an INCLUDE list.
// Per brand: category ids == [that site's SLOTS id], top-level
// game_provider_ids == the site's SLOTS-category provider set, target[0]
// mirrors the same list with type=1 (Included — "exclusion unticked").

import fs from 'node:fs';
import { getSite } from '../src/sites.js';
import { authedFetch, getAllGameProviders, getAllCategories } from '../src/api-client.js';

const BRANDS = ['QPRO1','QPRO2','QPRO3','QPRO4','QPRO5','QPRO6','QPRO7','QPRO8','QPRO9','QPRO10','QPRO11','QPRO12','QPRO15','QPRO16','QPRO17'];

const eq = (a, b) => {
  const A = [...a].sort((x, y) => x - y), B = [...b].sort((x, y) => x - y);
  return A.length === B.length && A.every((v, i) => v === B[i]);
};

let bad = 0;
for (const brand of BRANDS) {
  const bundle = JSON.parse(fs.readFileSync(`captures/qc-bundles/P026-r27__${brand}.json`, 'utf8'));
  const site = getSite(bundle.site);
  const pid = bundle.promotion_id;
  try {
    const [det, gps, cats] = await Promise.all([
      authedFetch(site, `/api/bo/promotion/${pid}`),
      getAllGameProviders(site),
      getAllCategories(site),
    ]);
    const row = det.data.rows;
    const catRows = Array.isArray(cats) ? cats : (cats.rows || []);
    const slotsCat = catRows.find((c) => String(c.category || c.name || '').toUpperCase() === 'SLOTS');
    const slotsGpIds = (gps.rows || []).filter((g) => (g.categories || []).some((c) => String(c.category || '').toUpperCase() === 'SLOTS')).map((g) => g.id);

    const promoCatIds = (row.promotion_category || []).map((c) => c.category_id);
    const gpIds = row.game_provider_ids || [];
    const targets = row.target || [];
    const t0 = targets[0] || {};

    const catOk = slotsCat ? eq(promoCatIds, [slotsCat.id]) : null;
    const gpOk = eq(gpIds, slotsGpIds);
    const targetGpOk = eq(t0.game_provider_ids || [], gpIds);
    const inclOk = Number(t0.type) === 1 && targets.length === 1;

    const extra = gpIds.filter((id) => !slotsGpIds.includes(id));
    const missing = slotsGpIds.filter((id) => !gpIds.includes(id));
    const ok = catOk === true && gpOk && targetGpOk && inclOk;
    if (!ok) bad++;
    console.log(`${ok ? '✓' : '✗'} ${brand.padEnd(7)} cat=${catOk === null ? 'no-SLOTS-cat?' : catOk ? `SLOTS(id ${slotsCat.id})` : `WRONG ${JSON.stringify(promoCatIds)} (SLOTS=${slotsCat?.id})`}  providers=${gpIds.length}/${slotsGpIds.length}${extra.length ? ` extra:${JSON.stringify(extra)}` : ''}${missing.length ? ` missing:${JSON.stringify(missing)}` : ''}  target: mirror=${targetGpOk} type=${t0.type}(${Number(t0.type) === 1 ? 'Included' : 'NOT-Included'}) rows=${targets.length}`);
  } catch (e) {
    bad++;
    console.log(`✗ ${brand.padEnd(7)} ERROR: ${e.message.split('\n')[0]}`);
  }
}
console.log(bad ? `\n${bad} brand(s) need attention` : '\nAll brands: Slots-only include-list confirmed');
process.exit(bad ? 1 : 0);

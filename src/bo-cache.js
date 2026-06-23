// Phase 4.5 — BO snapshot index.
//
// The planner's resolver (resolveDuplicates) tries to follow "duplicate this
// code" references. When the referenced code isn't in the recent request log
// (which is most of the time, because parent codes were set up months ago),
// we fall back to the BO's actual live promo codes synced by
// bin/sync-promo-codes.js. This module loads that snapshot and provides a
// just-in-time fetch for any one code's full details.

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { getSite } from './sites.js';
import { getPromotionDetail } from './api-client.js';

// Code → { site, merchant, id, name, promo_type }.
// One entry per (site, merchant, code). If the same code exists across
// multiple merchants in the same QP2 BO, all entries are kept; the resolver
// picks the right one by brand context.
export async function loadBoCodeIndex(dir = 'captures/bo-codes') {
  const root = path.resolve(dir);
  let names;
  try { names = await readdir(root); }
  catch (e) {
    if (e.code === 'ENOENT') return { byCode: new Map(), totalCodes: 0 };
    throw e;
  }
  const byCode = new Map(); // code → array of entries (code can repeat across merchants)
  let total = 0;
  for (const f of names) {
    if (f.startsWith('_') || !f.endsWith('.json')) continue;
    const data = JSON.parse(await readFile(path.join(root, f), 'utf8'));
    for (const row of data.rows || []) {
      const entry = {
        siteId: data.site,
        merchant: data.merchant,
        id: row.id,
        code: row.code,
        name: row.name,
        promo_type: row.promo_type,
      };
      if (!byCode.has(row.code)) byCode.set(row.code, []);
      byCode.get(row.code).push(entry);
      total++;
    }
  }
  return { byCode, totalCodes: total };
}

// Look up a code in the BO index and, if found, fetch full details. The
// `siteIdHint` lets the caller scope the lookup to the relevant BO (avoids
// pulling a same-named code from a different brand's BO). Returns null if
// the code isn't present in any synced BO snapshot.
//
// Caches results by code so the dry-run-all batch only fetches each parent
// once even if many child requests reference it.
const detailCache = new Map();

export async function fetchBoCodeAsRecord(code, byCode, { siteIdHint } = {}) {
  if (detailCache.has(`${siteIdHint || ''}::${code}`)) {
    return detailCache.get(`${siteIdHint || ''}::${code}`);
  }
  const entries = byCode.get(code);
  if (!entries || entries.length === 0) return null;

  // Prefer the entry from the matching site if hinted.
  const entry = (siteIdHint && entries.find((e) => e.siteId === siteIdHint)) || entries[0];
  const site = getSite(entry.siteId);

  let record;
  try {
    record = await getPromotionDetail(site, entry.id);
  } catch (e) {
    record = { _fetchError: e.message, promo_code: code };
  }
  // Tag with the merchant + site so the resolver knows where it came from.
  record._bo_merchant = entry.merchant;
  record._bo_site = entry.siteId;
  detailCache.set(`${siteIdHint || ''}::${code}`, record);
  return record;
}

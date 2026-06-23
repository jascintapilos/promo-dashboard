// Blacklist Template resolver.
//
// Promo Create on QPRO requires picking a `blacklist_template_id` — an FK to
// a pre-saved blacklist on the brand's BO. Field has lived in the API schema
// for a while (production captures show id=1, 5, 9 etc.; mapper used to send
// nothing → BO defaulted to NULL → exposed window pre-edit).
//
// Selection rule (operator, 2026-05-26): exact category-set match. The
// template's `name` field encodes the category coverage, e.g.
// "Slots, Live Casino, Sports" or "Slots Only".
//
// FS shortcut: every FS promo restricts categories to SLOTS only — always
// picks the "Slots Only" template.
//
// QPRO endpoint: GET /api/bo/blacklist (verified QPRO11, 9 templates).
// QP2 endpoint:  TBD (probe pending; see captures/blacklist-templates/).

import { authedFetch } from './api-client.js';

const cache = new Map(); // siteId → templates[]

// Canonical names match the QPRO category catalog (uppercase). Template names
// use mixed-case + plural forms — normalize both sides through this map.
const NAME_ALIASES = {
  'SPORT': 'SPORT',
  'SPORTS': 'SPORT',
  'ESPORT': 'E-SPORTS',
  'ESPORTS': 'E-SPORTS',
  'E-SPORT': 'E-SPORTS',
  'E-SPORTS': 'E-SPORTS',
  'SLOT': 'SLOTS',
  'SLOTS': 'SLOTS',
  'LIVE CASINO': 'LIVE CASINO',
  'FISHING': 'FISHING',
  'CRASH': 'CRASH',
  'CRASH GAME': 'CRASH',  // QP2 calls it "Crash game only"
  'CRICKET': 'CRICKET',
};

function normalizeCategory(token) {
  const t = String(token || '').toUpperCase().replace(/\s+/g, ' ').trim();
  return NAME_ALIASES[t] || t;
}

// Parse a template's display name into a Set of canonical category tokens, or
// the special sentinel 'ALL' for the "All games" wildcard template.
// Examples:
//   "Slots Only"                  → Set{ SLOTS }
//   "Live Casino Only"            → Set{ LIVE CASINO }
//   "Live Casino and Slots"       → Set{ LIVE CASINO, SLOTS }
//   "Slots, Live Casino, Sports"  → Set{ SLOTS, LIVE CASINO, SPORT }
//   "Sports and Esports only"     → Set{ SPORT, E-SPORTS }
//   "All games"                   → 'ALL'
export function parseTemplateName(name) {
  const clean = String(name || '').toLowerCase()
    .replace(/\bonly\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (/^all\s+games?$/i.test(clean)) return 'ALL';
  const parts = clean
    .split(/,\s*|\s+and\s+|\s*[&+]\s*/i)  // & and + are QP2 name variants
    .map((s) => s.trim())
    .filter(Boolean);
  return new Set(parts.map(normalizeCategory));
}

function setEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

export async function getBlacklistTemplates(site) {
  const siteId = typeof site === 'string' ? site : site.id;
  if (cache.has(siteId)) return cache.get(siteId);
  const platform = (typeof site === 'object' && site.platform) || 'qpro';
  // QP2 nests blacklist templates under /gameprovider/ — discovered 2026-06-08
  // by SPA bundle grep. All four QP2 merchants share one BO (ibc22), so the
  // same template catalog serves QP2A/B/C/D. Field name on the promo POST/PUT
  // body is `blacklist_template_id` (same as QP2 promo detail endpoint).
  if (platform === 'qp2') {
    const r = await authedFetch(site, '/api/bo/gameprovider/getAllBlacklistTemplate?paginate=false');
    const rows = r?.data?.rows || [];
    cache.set(siteId, rows);
    return rows;
  }
  const r = await authedFetch(site, '/api/bo/blacklist?perPage=200&page=1');
  const rows = r?.data?.rows || [];
  cache.set(siteId, rows);
  return rows;
}

// Resolve blacklist_template_id for a promo on a given site.
// - categoryNames: array of canonical category names actually applied to the
//   promo (e.g. ['SLOTS','LIVE CASINO','SPORT',…]).
// - isFs: free-spin shortcut → always "Slots Only".
//
// Throws when no exact-set match exists. Operator must either create the
// template in BO or fix the category list.
export async function resolveBlacklistTemplateId(site, { categoryNames, isFs } = {}) {
  const templates = await getBlacklistTemplates(site);
  const active = templates.filter((t) => Number(t.status) === 1);

  if (isFs) {
    const m = active.find((t) => /^slots?\s+only$/i.test(String(t.name || '').trim()));
    if (!m) {
      const names = active.map((t) => `"${t.name}"`).join(', ');
      throw new Error(`No "Slots Only" blacklist template on ${site.id || site}. Available: ${names}`);
    }
    return m.id;
  }

  const want = new Set((categoryNames || []).map(normalizeCategory));

  // Pre-fetch the "All games" sentinel; also used for empty categoryNames
  // (no categories configured = allow all → semantically "All games").
  let allGamesTemplate = null;
  for (const t of active) {
    const got = parseTemplateName(t.name);
    if (got === 'ALL') {
      allGamesTemplate = t; // save for fallback below
      continue;
    }
    if (setEqual(want, got)) return t.id;
  }

  // No exact-set match. Fall back to "All games" if present — semantically
  // correct when the promo allows every category (i.e. uses the default full
  // allow-list) and no dedicated all-category template exists yet.
  if (allGamesTemplate) {
    return allGamesTemplate.id;
  }

  const wantStr = [...want].sort().join(', ');
  const available = active.map((t) => `"${t.name}" (id=${t.id})`).join(', ');
  throw new Error(
    `No blacklist template on ${site.id || site} matches categories {${wantStr}} and no "All games" fallback exists. ` +
    `Available: ${available}. Operator must create a matching template in BO.`,
  );
}

// Testing helper: reset the in-memory cache.
export function _resetCache() { cache.clear(); }

// iGMP Free Spin catalog resolver.
//
// Two endpoints power the FS create form:
//
//   POST /VIM/GetAllProductOfferings  body: { HasFreeSpin: true }
//     response.data = [{ Id, Code, Name, ... }, ...]
//     "Pragmatic Play" provider shows as `${Code} - ${Name}` in the BO dropdown
//     e.g. "gamex-pragmaticplay - Pragmatic Play". Id → FreeSpin.ProductId.
//
//   POST /VIM/GetGames               body: { HasFreeSpin: true, DeviceTypes: ["Mobile"] }
//     response.data = [{ Id, ProductId, Name, VendorDisplayCode, FreeSpinBetGroup }]
//     Id → FreeSpin.GameId. VendorDisplayCode is the provider's own short code
//     (e.g. "vs20olympgate" for Gates of Olympus on Pragmatic Play).
//
// Per-BO catalog: providers/games installed differ per kiosk site. Resolver
// fetches live and caches per (siteId, kind) inside the process.

import { igmpPost } from './igmp-client.js';

const _cache = new Map(); // key: `${siteId}:${kind}` → array

async function getProviders(siteId) {
  const key = `${siteId}:providers`;
  if (_cache.has(key)) return _cache.get(key);
  const res = await igmpPost(siteId, '/VIM/GetAllProductOfferings', { HasFreeSpin: true });
  const rows = res.data || [];
  _cache.set(key, rows);
  return rows;
}

async function getGames(siteId) {
  const key = `${siteId}:games`;
  if (_cache.has(key)) return _cache.get(key);
  const res = await igmpPost(siteId, '/VIM/GetGames', { HasFreeSpin: true, DeviceTypes: ['Mobile'] });
  const rows = res.data || [];
  _cache.set(key, rows);
  return rows;
}

// Match provider by Code (preferred) or Name (case-insensitive).
// Accepts inputs like "PP", "PP2", "Pragmatic Play", "gamex-pragmaticplay".
export async function resolveProviderId(siteId, providerHint) {
  if (providerHint == null) {
    throw new Error('resolveProviderId: providerHint is required');
  }
  const hint = String(providerHint).trim().toLowerCase();
  const providers = await getProviders(siteId);

  // Pass 1: exact Code match
  let hit = providers.find((p) => String(p.Code || '').toLowerCase() === hint);
  // Pass 2: exact Name match
  if (!hit) hit = providers.find((p) => String(p.Name || '').toLowerCase() === hint);
  // Pass 3: Code contains hint (e.g. "pragmaticplay" inside "gamex-pragmaticplay")
  if (!hit) hit = providers.find((p) => String(p.Code || '').toLowerCase().includes(hint));
  // Pass 4: Name contains hint
  if (!hit) hit = providers.find((p) => String(p.Name || '').toLowerCase().includes(hint));

  if (!hit) {
    const available = providers.map((p) => `${p.Code} (${p.Name}) [Id=${p.Id}]`).join(', ');
    throw new Error(
      `resolveProviderId: no FS-enabled provider matches "${providerHint}" on site "${siteId}".\n` +
      `  Available: ${available || '(none)'}`,
    );
  }
  return hit.Id;
}

// Match game by Name (case-insensitive) within the optional provider.
// Accepts game-name hints like "Gates of Olympus" or vendor codes like
// "vs20olympgate" (which match against VendorDisplayCode).
export async function resolveGameId(siteId, gameHint, { providerId } = {}) {
  if (gameHint == null) {
    throw new Error('resolveGameId: gameHint is required');
  }
  const hint = String(gameHint).trim().toLowerCase();
  const games = await getGames(siteId);
  const pool = providerId == null
    ? games
    : games.filter((g) => String(g.ProductId) === String(providerId));

  // Pass 1: exact VendorDisplayCode
  let hit = pool.find((g) => String(g.VendorDisplayCode || '').toLowerCase() === hint);
  // Pass 2: exact Name
  if (!hit) hit = pool.find((g) => String(g.Name || '').toLowerCase() === hint);
  // Pass 3: Name contains hint
  if (!hit) hit = pool.find((g) => String(g.Name || '').toLowerCase().includes(hint));

  if (!hit) {
    const scope = providerId == null ? 'all providers' : `provider ${providerId}`;
    const sample = pool.slice(0, 8).map((g) => `${g.VendorDisplayCode}/${g.Name}`).join(', ');
    throw new Error(
      `resolveGameId: no FS game matches "${gameHint}" within ${scope} on site "${siteId}".\n` +
      `  Sample (${pool.length} candidates): ${sample}${pool.length > 8 ? '...' : ''}`,
    );
  }
  return hit.Id;
}

// Convenience: resolve both at once from a (provider, game) pair.
// providerHint may be null — in that case the game is searched across all
// providers and the provider is derived from the matched game's ProductId.
// Returns { providerId, gameId, providerRow, gameRow }.
export async function resolveFsCatalog(siteId, providerHint, gameHint) {
  if (providerHint == null || String(providerHint).trim() === '') {
    // Game-first resolution: find the game across all providers.
    const gameId = await resolveGameId(siteId, gameHint);
    const games = await getGames(siteId);
    const providers = await getProviders(siteId);
    const gameRow = games.find((g) => g.Id === gameId);
    const providerId = gameRow?.ProductId != null ? String(gameRow.ProductId) : null;
    return {
      providerId,
      gameId,
      providerRow: providers.find((p) => p.Id === providerId),
      gameRow,
    };
  }
  const providerId = await resolveProviderId(siteId, providerHint);
  const gameId = await resolveGameId(siteId, gameHint, { providerId });
  const providers = await getProviders(siteId);
  const games = await getGames(siteId);
  return {
    providerId,
    gameId,
    providerRow: providers.find((p) => p.Id === providerId),
    gameRow: games.find((g) => g.Id === gameId),
  };
}

export function _resetCache() {
  _cache.clear();
}

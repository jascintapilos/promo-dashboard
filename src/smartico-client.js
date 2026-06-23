/**
 * Smartico REST client for boapi6.smartico.ai.
 *
 * Auth: token from smartico-session.local.json (captured via capture-smartico-session.mjs).
 * Every request carries:
 *   Authorization: <token>          (no "Bearer" prefix)
 *   active_label_id: "24016"        (tenant/environment ID)
 *
 * Two call patterns:
 *   client.get(resource, params)    → REST list/get
 *   client.rpc(method, params)      → POST /api/private-api?method=<name>
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const SESSION_FILE = path.resolve('smartico-session.local.json');
const BASE_URL = 'https://boapi6.smartico.ai';
const LABEL_ID = '24016';

export function loadSmarticoToken() {
  if (!existsSync(SESSION_FILE)) {
    throw new Error(`Smartico session not found. Run: node bin/capture-smartico-session.mjs`);
  }
  const { token, capturedAt } = JSON.parse(readFileSync(SESSION_FILE, 'utf8'));
  if (!token) throw new Error('smartico-session.local.json has no token field.');
  return { token, capturedAt };
}

export function smarticoClient() {
  const { token, capturedAt } = loadSmarticoToken();

  const headers = {
    'Authorization': token,
    'active_label_id': LABEL_ID,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };

  async function request(method, path, body) {
    const url = `${BASE_URL}${path}`;
    const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    if (res.status === 401) throw new Error('Smartico token expired — re-run capture-smartico-session.mjs');
    if (!res.ok) throw new Error(`Smartico ${method} ${path} → HTTP ${res.status}`);
    return res.json();
  }

  return {
    capturedAt,

    // REST list with pagination support
    // Returns the raw array from the response (react-admin style: array body + Content-Range header)
    async list(resource, params = {}) {
      const qs = new URLSearchParams({ _start: 0, _end: 500, _sort: 'id', _order: 'DESC', ...params }).toString();
      const res = await fetch(`${BASE_URL}/api/${resource}?${qs}`, { headers });
      if (res.status === 401) throw new Error('Smartico token expired — re-run capture-smartico-session.mjs');
      if (!res.ok) throw new Error(`Smartico GET ${resource} → HTTP ${res.status}`);
      const data = await res.json();
      if (data && typeof data === 'object' && !Array.isArray(data) && data.errCode)
        throw new Error(`Smartico token expired (errCode ${data.errCode}: ${data.message}) — re-run capture-smartico-session.mjs`);
      return data;
    },

    // Paginate through all pages of a resource.
    // NOTE: Smartico API often ignores _end and returns all records in one go,
    // so listAll() can loop infinitely if the API returns >= PAGE records each time.
    // Use list() with _end: 10000 instead for Smartico.
    async listAll(resource, extraParams = {}) {
      const PAGE = 500;
      let start = 0;
      const all = [];
      const seenIds = new Set();
      while (true) {
        const qs = new URLSearchParams({ _start: start, _end: start + PAGE, _sort: 'id', _order: 'ASC', ...extraParams }).toString();
        const res = await fetch(`${BASE_URL}/api/${resource}?${qs}`, { headers });
        if (!res.ok) break;
        const batch = await res.json();
        if (!Array.isArray(batch) || !batch.length) break;
        // Dedup guard: if all returned IDs are already seen, we're looping — stop.
        const fresh = batch.filter(r => r.id !== undefined && !seenIds.has(r.id));
        if (!fresh.length) break;
        for (const r of fresh) seenIds.add(r.id);
        all.push(...fresh);
        if (batch.length < PAGE) break;
        start += PAGE;
      }
      return all;
    },

    // Single record — returns null if not found or wrong label
    async get(resource, id) {
      return request('GET', `/api/${resource}/${id}`);
    },

    // Fetch a segment by ID; returns null if not found / wrong label / parse error
    async getById(id) {
      try {
        const res = await fetch(`${BASE_URL}/api/j_segment/${id}`, { headers });
        if (!res.ok) return null;
        const text = await res.text();
        if (!text || text.trim() === 'null') return null;
        const s = JSON.parse(text);
        if (!s || !s.id || s.label_id !== parseInt(LABEL_ID)) return null;
        return s;
      } catch (e) { return null; }
    },

    // Scan individual IDs from startId upward, returning all segments for this label.
    // Stops after `consecutiveMissThreshold` consecutive IDs with no match.
    // Progress callback: onProgress(id, found) — called every batch if supplied.
    // concurrency: number of parallel getById calls per batch (default 10).
    async scanBeyondList(startId, { consecutiveMissThreshold = 2000, onProgress, concurrency = 10 } = {}) {
      const found = [];
      let consecutive = 0;
      let maxFoundId = startId - 1;
      for (let id = startId; consecutive < consecutiveMissThreshold; id += concurrency) {
        const batchIds = Array.from({ length: concurrency }, (_, i) => id + i);
        const results = await Promise.all(batchIds.map(bid => this.getById(bid).catch(() => null)));
        let anyHit = false;
        results.forEach((s, i) => {
          if (s) {
            found.push(s);
            if (batchIds[i] > maxFoundId) maxFoundId = batchIds[i];
            anyHit = true;
          }
        });
        consecutive = anyHit ? 0 : consecutive + concurrency;
        if (onProgress) onProgress(id + concurrency - 1, found.length);
      }
      return { segments: found, maxScannedId: maxFoundId + consecutiveMissThreshold };
    },

    // Private-API RPC
    async rpc(method, params = {}) {
      return request('POST', `/api/private-api?method=${method}`, { method, params });
    },
  };
}

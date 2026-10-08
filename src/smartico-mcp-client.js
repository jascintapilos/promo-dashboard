// Smartico MCP client (streamable-HTTP, JSON-RPC 2.0) — read path for the CRM
// pull. Uses a STATIC access token (backoffice → MCP → Access tokens, "MCP
// Viewer" read-only profile), so there is NO interactive login and NO 2FA per
// run — unlike the scraped boapi6 session the old pull depended on.
//
// Config: smartico-mcp.local.json { "url": "https://aichat-apiN.smartico.ai/mcp", "token": "..." }
// (gitignored). The URL + token are shown in the backoffice next to the token.
//
// Transport notes (confirmed by probing, 2026-10):
//   - Accept MUST list both application/json and text/event-stream (406 otherwise).
//   - Responses come back as SSE frames; the JSON-RPC message is the last `data:` line.
//   - `initialize` returns an mcp-session-id header that must be echoed on later calls.
//   - x-mcp-mode: json makes tool results return parseable JSON (not the compact TOON).
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const CONFIG_FILE = path.resolve('smartico-mcp.local.json');

export function loadMcpConfig() {
  if (!existsSync(CONFIG_FILE)) {
    throw new Error(`Missing ${CONFIG_FILE} — create it with { "url": "https://aichat-apiN.smartico.ai/mcp", "token": "..." } (backoffice → MCP → Access tokens).`);
  }
  const { url, token } = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
  if (!url || !token) throw new Error('smartico-mcp.local.json needs both "url" and "token".');
  return { url, token };
}

function parseBody(contentType, text) {
  if ((contentType || '').includes('text/event-stream')) {
    let last = null;
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^data:\s?(.*)$/);
      if (m && m[1]) { try { last = JSON.parse(m[1]); } catch { /* keep last good */ } }
    }
    return last;
  }
  try { return JSON.parse(text); } catch { return null; }
}

export function smarticoMcpClient(cfg = loadMcpConfig()) {
  const { url, token } = cfg;
  let _id = 0;
  let sessionId = null;
  let _ready = null;

  async function rpc(method, params, { notify = false } = {}) {
    const body = notify ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id: ++_id, method, params };
    const headers = {
      'content-type': 'application/json',
      'accept': 'application/json, text/event-stream',
      'authorization': `Bearer ${token}`,
      'x-mcp-mode': 'json',
    };
    if (sessionId) headers['mcp-session-id'] = sessionId;
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    const sid = res.headers.get('mcp-session-id');
    if (sid) sessionId = sid;
    if (res.status === 401 || res.status === 403) throw new Error(`Smartico MCP auth rejected (${res.status}) — check the token in smartico-mcp.local.json`);
    return parseBody(res.headers.get('content-type'), await res.text());
  }

  function ready() {
    if (!_ready) {
      _ready = (async () => {
        await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'promo-ops', version: '1' } });
        await rpc('notifications/initialized', {}, { notify: true });
      })();
    }
    return _ready;
  }

  function unwrap(r, label) {
    if (!r) throw new Error(`Smartico MCP: empty response${label ? ` for ${label}` : ''}`);
    if (r.error) throw new Error(`Smartico MCP error${label ? ` (${label})` : ''}: ${r.error.message || JSON.stringify(r.error)}`);
    const c = r.result?.content;
    if (Array.isArray(c)) {
      const t = c.map((x) => x.text ?? '').join('\n');
      let parsed; try { parsed = JSON.parse(t); } catch { parsed = { text: t }; }
      if (parsed && parsed.type === 'error') throw new Error(`Smartico MCP tool error${label ? ` (${label})` : ''}: ${parsed.text}`);
      return parsed;
    }
    return r.result ?? r;
  }
  const recordsOf = (d) => d?.records || d?.items || (Array.isArray(d?.data) ? d.data : null) || (Array.isArray(d) ? d : []);

  async function entityList(entity_type, { filters, sort, limit = 50, offset = 0 } = {}) {
    await ready();
    const args = { entity_type, limit, offset };
    if (filters) args.filters = filters;
    if (sort) args.sort = sort;
    const d = unwrap(await rpc('tools/call', { name: 'entity_list', arguments: args }), `entity_list ${entity_type}`);
    return { records: recordsOf(d), total: d?.total };
  }

  async function entityGet(entity_type, id) {
    await ready();
    const d = unwrap(await rpc('tools/call', { name: 'entity_get', arguments: { entity_type, id } }), `entity_get ${entity_type} ${id}`);
    return d?.record || d?.data || d;
  }

  // Page an entity newest-first (create_date desc), calling onPage(records) until
  // stop() returns true for a record (e.g. older than the YTD cutoff) or the
  // records run out. Returns every record collected.
  async function listPagedDesc(entity_type, { filters, pageSize = 50, maxPages = 400, stop } = {}) {
    const out = [];
    for (let page = 0; page < maxPages; page++) {
      const { records } = await entityList(entity_type, { filters, sort: { field: 'create_date', dir: 'desc' }, limit: pageSize, offset: page * pageSize });
      if (!records.length) break;
      out.push(...records);
      if (stop && stop(records[records.length - 1])) break;
    }
    return out;
  }

  return { rpc, entityList, entityGet, listPagedDesc, ready };
}

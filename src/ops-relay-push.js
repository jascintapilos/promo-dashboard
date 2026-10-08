// Shared helper: sign + POST one Ops dataset to the dashboard server's relay
// ingest (/api/relay/ops/dataset/<key>). Used by the direct-push pulls
// (crmSmartico, crmFt) so the HMAC signing lives in one place.
//
// Mirrors the proven block in bin/pull-smartico-mcp.mjs: gzip the payload, sign
// with the worker relay secret (NOT buildSignedHeaders — older relay-auth
// checkouts cap it at 64KB; we sign directly and enforce the 8MB route cap).
import { gzipSync } from 'node:zlib';
import crypto from 'node:crypto';
import { readWorkerRelaySecret, sign } from './qc-dashboard/relay-auth.js';

const DEFAULT_HUB = 'https://qc-dashboard.zoom66.xyz';
const MAX_PUSH_BYTES = 8 * 1024 * 1024; // matches the server's MAX_REPORT_BUILD_BYTES for ops pushes

// Push a dataset. Returns the parsed server status object on success; throws on
// a missing secret, oversize body, or non-200 response (message never leaks the secret).
export async function pushOpsDataset({ key, headers, rows, ok = true, detail = '', pulledAt, hub } = {}) {
  if (!key) throw new Error('pushOpsDataset: key required');
  const HUB = (hub || process.env.QC_HUB_URL || DEFAULT_HUB).replace(/\/+$/, '');
  const secret = readWorkerRelaySecret();
  if (!secret.present) throw new Error(`relay secret unavailable — ${secret.reason}`);

  const payload = {
    key,
    pulledAt: pulledAt || new Date().toISOString(),
    ok,
    detail,
    // A failed pull (ok:false) carries no rows — the server keeps its last-good copy.
    headers: ok ? (headers || []) : undefined,
    rows: ok ? (rows || []) : undefined,
  };
  const relPath = `/api/relay/ops/dataset/${key}`;
  const gz = gzipSync(Buffer.from(JSON.stringify(payload), 'utf8'));
  if (gz.length > MAX_PUSH_BYTES) throw new Error(`${key} too large (${(gz.length / 1048576).toFixed(1)}MB gzip > ${MAX_PUSH_BYTES / 1048576}MB)`);

  const timestamp = Date.now();
  const nonce = crypto.randomBytes(16).toString('hex');
  const reqHeaders = {
    'content-type': 'application/gzip',
    'x-relay-timestamp': String(timestamp),
    'x-relay-nonce': nonce,
    'x-relay-signature': sign({ secret: secret.secret, method: 'POST', path: relPath, timestamp, nonce, bodyBuffer: gz }),
    'x-relay-worker': `ops-push-${process.pid}`,
  };
  const res = await fetch(`${HUB}${relPath}`, { method: 'POST', headers: reqHeaders, body: gz });
  const text = await res.text();
  if (!res.ok) throw new Error(`push rejected (${res.status}): ${text.slice(0, 200)}`);
  try { return JSON.parse(text).status; } catch { return { raw: text }; }
}

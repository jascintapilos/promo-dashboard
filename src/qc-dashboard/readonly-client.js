import { authedFetch } from '../api-client.js';
import { igmpPost } from '../igmp-client.js';

const IGMP_READ_RE = /^\/(?:PM|VIM)\/Get/i;

function methodOf(opts = {}) {
  return String(opts.method || 'GET').toUpperCase();
}

export function assertReadonlyHttp(pathOrUrl, opts = {}) {
  const method = methodOf(opts);
  if (method !== 'GET') {
    throw new Error(`QC Hub read-only transport rejected ${method} ${pathOrUrl}`);
  }
}

// Collector item 1: bounded retry for transient BO connectivity blips, layered
// ON TOP OF (not instead of) authedFetch's own one-shot 401/419 relogin.
// authedFetch already solves "session refresh" — this solves everything else
// transient: a network blip, a 5xx, a 429, or a second auth hiccup that
// outlasts authedFetch's single internal retry. A GENUINE outage still
// exhausts these bounded attempts and throws, so it correctly surfaces as
// unavailable evidence upstream (never silently swallowed into a false PASS).
const RETRYABLE_STATUS_RE = /^HTTP (5\d\d|429)\b/;
const RETRYABLE_NETWORK_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', 'EPIPE',
]);

function isTransientError(e) {
  if (!e) return false;
  // authedFetch already retried once internally; a second AuthError here
  // means that relogin itself hit something transient. One more bounded,
  // backed-off attempt covers that without weakening session-refresh.
  if (e.name === 'AuthError') return true;
  const code = e.cause?.code || e.code;
  if (code && RETRYABLE_NETWORK_CODES.has(code)) return true;
  if (e.name === 'TypeError' && /fetch failed/i.test(e.message || '')) return true;
  if (RETRYABLE_STATUS_RE.test(e.message || '')) return true;
  return false;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Mirrors api-client.js's withLoginRetry shape (exponential backoff + jitter)
// for consistency with the codebase's one existing retry precedent.
export async function withBoundedRetry(fn, { attempts = 3, baseMs = 400, maxMs = 3000, onRetry } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (!isTransientError(e) || i === attempts - 1) throw e;
      const backoff = Math.min(maxMs, baseMs * 2 ** i);
      const jitter = Math.random() * backoff * 0.5;
      if (onRetry) {
        try { onRetry({ attempt: i + 1, attempts, error: e.message }); } catch { /* observability only */ }
      }
      await sleep(backoff + jitter);
    }
  }
  throw lastErr;
}

export async function readonlyAuthedFetch(site, pathOrUrl, { retry, ...opts } = {}) {
  assertReadonlyHttp(pathOrUrl, opts);
  return withBoundedRetry(() => authedFetch(site, pathOrUrl, { ...opts, method: 'GET' }), retry);
}

export function assertAllowedIgmpEndpoint(endpoint) {
  if (!IGMP_READ_RE.test(String(endpoint || ''))) {
    throw new Error(`QC Hub IGMP read-only allowlist rejected ${endpoint}`);
  }
}

export async function readonlyIgmpPost(siteId, endpoint, body = {}, opts = {}) {
  assertAllowedIgmpEndpoint(endpoint);
  const { retry, igmpPostImpl, ...restOpts } = opts;
  const post = igmpPostImpl || igmpPost;
  return withBoundedRetry(() => post(siteId, endpoint, body, restOpts), retry);
}

export async function findPromotionByCodeReadonly(site, code, { merchantId } = {}) {
  const params = new URLSearchParams({ perPage: '20', page: '1', code: String(code) });
  if (merchantId != null) params.set('merchant_id', String(merchantId));
  const res = await readonlyAuthedFetch(site, `/api/bo/promotion?${params}`);
  const rows = res?.data?.rows || [];
  return rows.find((p) => p.code === code) || null;
}

export async function getPromotionDetailReadonly(site, promotionId) {
  const [d, c, n] = await Promise.all([
    readonlyAuthedFetch(site, `/api/bo/promotion/${promotionId}`),
    readonlyAuthedFetch(site, `/api/bo/promotioncurrency?promotion_id=${promotionId}`),
    readonlyAuthedFetch(site, `/api/bo/promotionname?promotion_id=${promotionId}`),
  ]);
  return { detail: d?.data?.rows || null, currencies: c?.data?.rows || [], names: n?.data?.rows || [] };
}

export async function getQproListingReadonly(site, code, { merchantId } = {}) {
  const params = new URLSearchParams({ perPage: '5', page: '1', code: String(code) });
  if (merchantId != null) params.set('merchant_id', String(merchantId));
  return readonlyAuthedFetch(site, `/api/bo/promotion?${params}`);
}

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

export async function readonlyAuthedFetch(site, pathOrUrl, opts = {}) {
  assertReadonlyHttp(pathOrUrl, opts);
  return authedFetch(site, pathOrUrl, { ...opts, method: 'GET' });
}

export function assertAllowedIgmpEndpoint(endpoint) {
  if (!IGMP_READ_RE.test(String(endpoint || ''))) {
    throw new Error(`QC Hub IGMP read-only allowlist rejected ${endpoint}`);
  }
}

export async function readonlyIgmpPost(siteId, endpoint, body = {}, opts = {}) {
  assertAllowedIgmpEndpoint(endpoint);
  const post = opts.igmpPostImpl || igmpPost;
  return post(siteId, endpoint, body, opts);
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

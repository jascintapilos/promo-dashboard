export const MAX_QC_CODES = 5;

export function normalizeRunQcRequest(body = {}) {
  const brand = String(body.brand || '').trim().toUpperCase();
  if (!brand) return { ok: false, status: 400, error: 'brand is required' };
  if (!Array.isArray(body.codes)) {
    return { ok: false, status: 400, error: 'codes must be an array of promo codes' };
  }
  const codes = body.codes
    .map((code) => String(code || '').trim().toUpperCase())
    .filter(Boolean);
  if (!codes.length) return { ok: false, status: 400, error: 'at least one promo code is required' };
  if (codes.length > MAX_QC_CODES) {
    return { ok: false, status: 400, error: `POST /api/run-qc accepts at most ${MAX_QC_CODES} promo codes per run` };
  }
  return { ok: true, brand, codes };
}

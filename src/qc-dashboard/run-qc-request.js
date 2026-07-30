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
  // Increment 6 (real-QC upgrade): optional Request Handle for expected-source
  // resolution (D2). We accept the real handle formats seen in captures/:
  //   P068-r69, P133-r135, P-API-fc-v2, P-FC-qp2a-test, B045-r2, ...
  // The strict rejection here is on the pattern that would make a promo
  // code sneak in: underscores. Every promo code uses `_` as its separator
  // (FT_RET_CRM_...) — no legitimate handle contains one. Length is capped
  // at 40 to stop pathological input. Original-case is preserved because
  // handles land in filenames on disk (case-sensitive on non-Windows).
  const rawHandle = body.handle == null ? '' : String(body.handle).trim();
  let handle = null;
  if (rawHandle) {
    if (rawHandle.length > 40) {
      return { ok: false, status: 400, error: 'handle must be at most 40 characters' };
    }
    if (!/^[A-Za-z][A-Za-z0-9-]{1,39}$/.test(rawHandle)) {
      return { ok: false, status: 400, error: 'handle must be a short identifier of letters/digits/hyphens (e.g. P172, P068-r69, P-API-fc-v2) — underscores are reserved for promo codes' };
    }
    handle = rawHandle;
  }
  return { ok: true, brand, codes, handle };
}

// Site-aware API client for QPRO-family Back Office deployments.
// Every public function takes a `site` (resolved via src/sites.js) so the
// same client can talk to multiple BOs in one process.

import crypto from 'node:crypto';
import { getOrRefreshSession, refreshSession, clearSession } from './session-cache.js';
import { getSite } from './sites.js';

// AES-256-CBC password encryption matching the SPA bundle:
//   key = SHA256(site.reqSignKey)
//   iv  = 16 random bytes
//   out = base64( iv || AES-256-CBC(plaintext, key, iv, PKCS7) )
export function encryptReqSign(plaintext, reqSignKey) {
  const key = crypto.createHash('sha256').update(reqSignKey, 'utf8').digest();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, ct]).toString('base64');
}

class AuthError extends Error { constructor(m) { super(m); this.name = 'AuthError'; } }

async function rawFetchJson(url, opts = {}) {
  const headers = { accept: 'application/json, text/plain, */*', ...(opts.headers || {}) };
  let body = opts.body;
  if (body && typeof body === 'object' && !(body instanceof URLSearchParams)) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(body);
  }
  const res = await fetch(url, { ...opts, headers, body });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }

  if (res.status === 401 || res.status === 419) throw new AuthError(`auth required (${res.status})`);
  if (data && data.success === false && /unauth|token|expired/i.test(JSON.stringify(data.message || ''))) {
    throw new AuthError(`auth rejected: ${JSON.stringify(data.message)}`);
  }
  if (!res.ok || (data && data.success === false)) {
    const msg = data?.message?.join?.(' | ') || data?.message || text.slice(0, 300);
    throw new Error(`HTTP ${res.status} ${url}\n  ${msg}`);
  }
  return data;
}

// Direct login (no cache). Returns a session object.
// Empirically (Phase 1 spy): QP2 and QPRO share the same login flow — same
// endpoint path, same AES-CBC encrypted-password scheme, same response shape.
// The platform dispatch is preserved for future divergence (e.g. a QPRO
// captcha) but currently both route through the same implementation.
export async function rawLogin(site) {
  const platform = site.platform || 'qp2';
  if (platform === 'qp2' || platform === 'qpro') return rawLoginStandard(site);
  throw new Error(`rawLogin: unsupported platform "${platform}" on site "${site.id}"`);
}

async function rawLoginStandard(site) {
  // Pre-check so the user gets a clear "this QPRO site is still a stub" error
  // instead of a cryptic TypeError when apiHost / reqSignKey are missing.
  const missing = ['apiHost', 'reqSignKey', 'loginMerchantCode'].filter((k) => !site[k]);
  if (missing.length) {
    throw new Error(
      `Login config incomplete for site "${site.id}" (${site.platform}): missing ${missing.join(', ')}.\n` +
      `  Run the Playwright login spy (src/browser/qpro-login-probe.js) against ${site.baseUrl}\n` +
      `  to discover the API host, then grep that BO's main.<hash>.js for reqSignKey.\n` +
      `  Add the discovered values to the site's entry in bo-sites.json.`,
    );
  }
  const data = await rawFetchJson(`${site.apiHost}/api/bo/login`, {
    method: 'POST',
    body: {
      merchant_code: site.loginMerchantCode,
      username: site.username,
      password: encryptReqSign(site.password, site.reqSignKey),
    },
  });
  const tok = data.data.token;
  const user = data.data.user;
  // QP2 returns merchant_dropdown listing every merchant the account can act
  // on (it's a multi-brand BO). QPRO BOs are single-brand and omit the
  // dropdown — synthesize a one-entry merchants array from the login
  // response's site_id plus the site's configured loginMerchantCode (which
  // doubles as the brand identifier on QPRO).
  const merchants = user.merchant_dropdown || [{
    id: user.site_id,
    name: site.loginMerchantCode,
    prefix: site.loginMerchantCode,
  }];
  return {
    accessToken: tok.access_token,
    plaintextToken: tok.plaintext_token,
    expiresAt: tok.expiry_datetime,
    username: user.username,
    userId: user.id,
    merchants,
  };
}

// Site-keyed cache. First call performs login, later calls reuse.
export async function getSession(siteIdOrSite, { force = false } = {}) {
  const site = typeof siteIdOrSite === 'string' || siteIdOrSite == null
    ? getSite(siteIdOrSite)
    : siteIdOrSite;
  return getOrRefreshSession(site.id, () => rawLogin(site), { force });
}

async function forceRefresh(site) {
  return refreshSession(site.id, () => rawLogin(site));
}

function authHeaders(session) {
  return {
    'access-token': session.accessToken,
    'token-selector': session.plaintextToken,
  };
}

// Authenticated request. Transparently re-logs in once on 401/419.
export async function authedFetch(siteOrId, pathOrUrl, opts = {}) {
  const site = typeof siteOrId === 'string' || siteOrId == null
    ? getSite(siteOrId)
    : siteOrId;
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${site.apiHost}${pathOrUrl}`;
  let session = await getSession(site);

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await rawFetchJson(url, {
        ...opts,
        headers: { ...(opts.headers || {}), ...authHeaders(session) },
      });
    } catch (e) {
      if (e instanceof AuthError && attempt === 0) {
        await clearSession(site.id).catch(() => {});
        session = await forceRefresh(site);
        continue;
      }
      throw e;
    }
  }
  throw new Error('authedFetch: exhausted retries');
}

// ── Domain helpers ──────────────────────────────────────────────────────

export async function getPromotions(site, {
  merchantId,
  status = 1,
  perPage = 100,
  page = 1,
  dateType = 'valid_from',
  sortBy = 'id',
  sortOrder = 'desc',
  extra = {},
} = {}) {
  const params = new URLSearchParams({
    perPage: String(perPage),
    page: String(page),
    status: String(status),
    category_id: '',
    game_provider_code: '',
    currency_id: '',
    bonus_condition: '',
    merchant_id: merchantId == null ? '' : String(merchantId),
    date_type: dateType,
    sort_by: sortBy,
    sort_order: sortOrder,
    ...extra,
  });
  return authedFetch(site, `/api/bo/promotion?${params}`);
}

export async function getAllPromotions(site, opts = {}) {
  const first = await getPromotions(site, { ...opts, page: 1 });
  const total = first.data.paginations?.total ?? first.data.rows.length;
  const lastPage = first.data.paginations?.last_page ?? 1;
  const rows = [...first.data.rows];
  if (lastPage > 1) {
    const more = await Promise.all(
      Array.from({ length: lastPage - 1 }, (_, i) => getPromotions(site, { ...opts, page: i + 2 })),
    );
    for (const r of more) rows.push(...r.data.rows);
  }
  return { rows, total, pages: lastPage };
}

// Live idempotency lookup. The BO's `/api/bo/promotion` endpoint accepts a
// `code=<exact>` query filter (discovered 2026-05-16 — undocumented; the
// `text=`/`search=`/`keyword=` params are ignored). Returns the matching
// promotion row or null. On QP2 the BO is multi-merchant — pass merchantId
// so we don't false-positive on a sibling brand's promo.
//
// Replaces the stale `bo-codes/<site>.json` snapshot the canary used to
// rely on (the snapshot only sees codes sync-promo-codes.js captured at
// its last run; anything created between sync runs leaked through and the
// canary then POSTed a dup, getting "code has already been taken" from
// the BO at HTTP 422).
export async function findPromotionByCode(site, code, { merchantId } = {}) {
  const params = new URLSearchParams({ perPage: '20', page: '1', code: String(code) });
  if (merchantId != null) params.set('merchant_id', String(merchantId));
  const res = await authedFetch(site, `/api/bo/promotion?${params}`);
  const rows = res?.data?.rows || [];
  return rows.find((p) => p.code === code) || null;
}

// Installed promotion categories on this site/merchant. Endpoint is
// `/api/bo/categories` (plural — `/api/bo/category` 404s). Returns a flat
// array under `data.rows` (no pagination on the brands we've probed).
// Per-brand IDs drift (e.g. QPRO1 has 18 cats with VIP/EVENT/LOTTERY2;
// QPRO11 has 17 cats with no VIP/EVENT and an admin "Test" row), so
// callers MUST resolve by name, not by hardcoded ID.
export async function getAllCategories(site) {
  const res = await authedFetch(site, '/api/bo/categories');
  return res?.data?.rows || [];
}

// Installed game providers on this site/merchant. The endpoint is
// `/api/bo/gameprovider` (no separator). Paginated; we walk every page so
// the caller can intersect with Layer-1 exclusions without surprise drift.
export async function getAllGameProviders(site, { perPage = 100 } = {}) {
  const fetchPage = (page) =>
    authedFetch(site, `/api/bo/gameprovider?per_page=${perPage}&page=${page}`);
  const first = await fetchPage(1);
  const total = first.data.paginations?.total ?? first.data.rows.length;
  const lastPage = first.data.paginations?.last_page ?? 1;
  const rows = [...first.data.rows];
  if (lastPage > 1) {
    const more = await Promise.all(
      Array.from({ length: lastPage - 1 }, (_, i) => fetchPage(i + 2)),
    );
    for (const r of more) rows.push(...r.data.rows);
  }
  return { rows, total, pages: lastPage };
}

// All member groups installed on this BO. QP2 partitions by site_id (which
// equals merchant id). Returns full rows including {id, name, site_id, ...}.
export async function getAllMemberGroups(site, { perPage = 300 } = {}) {
  const r = await authedFetch(site, `/api/bo/membergroup?perPage=${perPage}&page=1`);
  return r?.data?.rows || [];
}

// Supported currencies for a given provider on this BO. Endpoint returns
// `{ currency: [<id>, ...] }` (e.g. [1,3] = MYR, IDR). PP2's id varies per
// brand on QPRO; the caller usually resolves it via getAllGameProviders +
// code='PP2'. QP2 uses a fixed id (345) shared across all 4 merchants.
export async function getGameProviderDetail(site, providerId) {
  const r = await authedFetch(site, `/api/bo/gameprovider/${providerId}`);
  const data = Array.isArray(r?.data) ? r.data[0] : r?.data;
  return data || null;
}

// Free Spin games installed for a given provider. Endpoint takes the provider
// CODE as a path segment (e.g. "PP2"), NOT an id. Returns the full list (no
// pagination per probe 2026-05-16 on QPRO1 — 624 PP2 games in one response).
// Each row carries `code` (e.g. "vs20olympgold") + `name` (e.g. "Gates of
// Olympus Super Scatter"). `free_spin: 1` confirms the game is FS-eligible.
export async function getFreeSpinGames(site, providerCode) {
  const r = await authedFetch(site, `/api/bo/gameprovider/freespingame/${encodeURIComponent(providerCode)}`);
  const rows = r?.data?.rows || [];
  return rows;
}

// 3.3 Promotion Contents. Uses site_id (not merchant_id); type=0 is required.
export async function getPromotionContents(site, {
  siteFilterId,
  status = 1,
  type = 0,
  perPage = 100,
  page = 1,
  sortBy = 'id',
  sortOrder = 'desc',
  categoryId = '',
  extra = {},
} = {}) {
  const params = new URLSearchParams({
    perPage: String(perPage),
    page: String(page),
    sort_by: sortBy,
    sort_order: sortOrder,
    status: String(status),
    type: String(type),
    ...(siteFilterId == null ? {} : { site_id: String(siteFilterId) }),
    ...(categoryId === '' ? {} : { category_id: String(categoryId) }),
    ...extra,
  });
  return authedFetch(site, `/api/bo/promotioncontent?${params}`);
}

export async function getAllPromotionContents(site, opts = {}) {
  const first = await getPromotionContents(site, { ...opts, page: 1 });
  const lastPage = first.data.paginations?.last_page ?? 1;
  const rows = [...first.data.rows];
  if (lastPage > 1) {
    const more = await Promise.all(
      Array.from({ length: lastPage - 1 }, (_, i) => getPromotionContents(site, { ...opts, page: i + 2 })),
    );
    for (const r of more) rows.push(...r.data.rows);
  }
  return { rows, total: first.data.paginations?.total ?? rows.length, pages: lastPage };
}

// Promo-type integer → name. The QPRO/QP2 BOs store the bonus type as an
// integer in the detail endpoint; this maps them back to the labels the rest
// of the codebase uses. (Empirical mapping; expand if a new type shows up.)
const PROMO_TYPE_LABELS = {
  1: 'Deposit',
  2: 'Cashback',
  3: 'Free Credit',
  4: 'Free Spin',
  5: 'Rebate',
};

// One promo's full details. Combines three endpoints into one record:
//   - /api/bo/promotion/<id>            main fields
//   - /api/bo/promotioncurrency?promotion_id=<id>   per-currency settings
//   - /api/bo/promotionname?promotion_id=<id>       per-locale names
// Returns the same shape that the ingest layer produces — so the planner's
// resolver can use a BO-sourced record as a parent without special-casing.
export async function getPromotionDetail(site, promotionId) {
  const [d, c, n] = await Promise.all([
    authedFetch(site, `/api/bo/promotion/${promotionId}`),
    authedFetch(site, `/api/bo/promotioncurrency?promotion_id=${promotionId}`),
    authedFetch(site, `/api/bo/promotionname?promotion_id=${promotionId}`),
  ]);
  const main = d.data.rows; // object, not array — quirky API
  const currencies = c.data.rows || [];
  const names = n.data.rows || [];

  const perCurrency = {};
  for (const cc of currencies) {
    perCurrency[cc.currency] = {
      min_deposit: nz(cc.min_transfer),
      max_bonus: nz(cc.max_bonus),
      max_transfer_out: nz(cc.max_transfer_out),
      // QP2 stores the FC amount in `bonus_amount` (bonus_type=1 Fixed Amount);
      // QPRO uses `free_credit_amount`. Fall back so QC reads the right field on
      // both platforms (the FC check only runs for FC-type requests anyway).
      free_credit_amount: nz(cc.free_credit_amount ?? cc.bonus_amount),
      bonus_rate: nz(cc.bonus_rate),
      spin_count: cc.rounds || null,
      value_per_spin: nz(cc.amount_per_line),
    };
  }
  // Take any one currency block as the "global" parsed fields — they're
  // usually identical across currencies for the same code.
  const sample = Object.values(perCurrency)[0] || {};

  // Promotion name across locales.
  const nameEn = names.find((nn) => nn.locale?.endsWith('_EN'))?.promotion_name || null;
  const nameZhId = names.find((nn) => nn.locale?.endsWith('_ZH') || nn.locale?.endsWith('_ID'))?.promotion_name || null;

  return {
    promo_code: main.code,
    name: main.name,
    bonus_type: PROMO_TYPE_LABELS[main.promo_type] || `type_${main.promo_type}`,
    bonus_sub_type: null, // BO stores promo_sub_type as integer; mapping unknown for now
    validity_days: main.validity,
    rewards_validity_days: main.reward_validity,
    recurring: main.recurring === 1,
    promotion_name_en: nameEn,
    promotion_name_zh_id: nameZhId,
    locales: names.map((nn) => nn.locale).filter(Boolean),
    currencies: currencies.map((cc) => cc.currency),
    parsed: {
      spin_count: sample.spin_count,
      value_per_spin: sample.value_per_spin,
      to_multiplier: main.target?.[0]?.multiplier ?? null,
      bonus_rate_pct: Number(main.bonus_rate) || sample.bonus_rate || null,
      game: main.free_spin_game_code || null,
      free_credit_amount: sample.free_credit_amount,
      min_deposit: sample.min_deposit,
      max_bonus: sample.max_bonus,
    },
    per_currency_overrides: perCurrency,
    _source: 'bo-detail',
    _site: site.id,
    _bo_id: main.id,
  };
}

// Coerce "0.00" / null / "" to either null or a real number.
function nz(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n !== 0 ? n : null;
}

// ── Write helpers (Phase 2: API-direct promo creation) ─────────────────
// Derived from live captures (captures/api-contract/*.json) of the
// Playwright canary saving Dep/FC/FS on QPRO11. Each helper is a thin
// wrapper around authedFetch — payload shapes live in src/api-mapper-qpro.js.

// Create the main Promotion Code record. `body` shape mirrors the captured
// POST /api/bo/promotion body and includes the embedded `promotion_currency`
// block (no separate Currency popup call). Returns { data: { rows: { id, ... }}}.
export async function createPromotion(site, body) {
  return authedFetch(site, '/api/bo/promotion', { method: 'POST', body });
}

// Add one per-locale Promotion Name row. Body fields match the inner-form
// the canary fills via `+ Add` inside the Promotion Names popup.
export async function addPromotionName(site, { promotion_id, currency_id, settings_locale_id, promotion_name, rewards_name }) {
  return authedFetch(site, '/api/bo/promotionname', {
    method: 'POST',
    body: { promotion_id, currency_id, settings_locale_id, promotion_name, rewards_name },
  });
}

// Create a Message Template (Section 6.6). `details` keys on settings_locale_id
// (1=MY_EN, 3=MY_ZH, 6=SG_EN, 7=SG_ZH, 8=ID_EN, 9=ID_ID) and carries the
// per-locale subject + message HTML.
export async function createMessageTemplate(site, { name, section, type, status, details, code }) {
  return authedFetch(site, '/api/bo/messagetemplate', {
    method: 'POST',
    body: { name, section, type, status, details, code },
  });
}

// Merchant bank account IDs for a given currency + purpose. Used by the QP2
// mapper to populate `deposit_options` on Deposit-type currency blocks.
// The BO requires an explicit non-empty list for SGD but accepts [] for MYR.
//
// Endpoint: GET /api/bo/merchantbank/accounts?paginate=false
// currency_id: 1=MYR, 3=SGD, 4=IDR (see project_bo_currency_id_catalog.md)
// purpose:     1=Deposit, 2=Withdrawal, 4=Transfer, 5=FPS/QR
//
// Returns an array of integer account IDs filtered to the given currency+purpose.
// Default: SGD (currency_id=3) + Deposit (purpose=1) — the minimum set needed
// for QP2 SGD currency blocks (verified: [408,410,411,412] ⊆ this set).
export async function getAllMerchantBankIds(site, { currencyId = 3, purpose = 1 } = {}) {
  const r = await authedFetch(site, '/api/bo/merchantbank/accounts?paginate=false');
  const rows = r?.data?.rows || r?.data || [];
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row.currency_id === currencyId && row.purpose === purpose)
    .map((row) => row.id)
    .filter(Number.isFinite);
}

// Final PUT to update a promotion in place — the canary fires this when the
// Edit-modal Submit is clicked. Its primary purpose is to set
// `message_template_id` (the only way to link a template to a promo). Body
// shape matches PUT /api/bo/promotion/{id} from the captures; the API
// tolerates booleans-as-0/1 on PUT (POST uses true/false — strict typing).
export async function updatePromotion(site, promotionId, body) {
  return authedFetch(site, `/api/bo/promotion/${promotionId}`, { method: 'PUT', body });
}

// Read the current dialog_popup_list for a promotion and return a `dialog` arg
// shape compatible with api-mapper-qpro/qp2's `buildUpdate(promoId, templateId, dialog)`.
//
// Why this helper exists: every fix script that re-PUTs a promo via
// `plan.buildUpdate(promoId, templateId, null)` will silently wipe the
// dialog_popup_list join row (the mapper sends an empty list when dialog is
// null). Always read the existing linkage first and pass it through.
//
// The detail endpoint `GET /api/bo/promotion/{id}` does NOT return
// dialog_popup_list (verified 2026-05-20 — see
// project_qp2_dialog_popup_endpoint_quirks.md). Use the listing endpoint
// `GET /api/bo/promotion?code=<CODE>` instead, which DOES expose it.
//
// Returns null when no popup is currently linked. Returns `{ id, fullRow }`
// otherwise — QPRO mapper only uses `id`, QP2 mapper uses `id` + `fullRow`.
export async function readDialogForPreservation(site, promotionCode, allPopupsCache = null) {
  const list = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(promotionCode)}&perPage=5`);
  const row = (list.data?.rows || []).find((r) => r.code === promotionCode);
  const link = row?.dialog_popup_list?.[0];
  if (!link?.popup_id) return null;
  const popups = allPopupsCache
    || (await authedFetch(site, '/api/bo/popups?perPage=500&page=1&date_type=start_date&sort_by=id&sort_order=desc')).data?.rows
    || [];
  const fullRow = popups.find((p) => p.id === link.popup_id);
  if (!fullRow) return { id: link.popup_id, fullRow: null };
  return { id: link.popup_id, fullRow };
}

// Create a Dialog Popup (Section 15.1.2 on QP2 / 14.1.2 on QPRO).
// Body shape captured from QP2A V25 run — top-level fields:
//   site_id, platform, start_date, session, position, status, contents,
//   location, affiliates_visibility, always_pop, do_not_show_again
// QPRO sends `label` instead of `site_id`; both platforms accept the
// same `contents` per-locale block. Returns the saved popup with id +
// 5-letter code.
export async function createDialogPopup(site, body) {
  return authedFetch(site, '/api/bo/popups', { method: 'POST', body });
}

// Fetch a single dialog popup by id. There is no individual-record endpoint
// (GET /api/bo/popups/{id} returns 405), so we fetch the list and filter.
// Returns the full popup row including per-locale `contents[]`
// (title, content, cta_button_text_1/_2, cta_button_link_1/_2).
export async function getPopupDetail(site, popupId) {
  const r = await authedFetch(site, '/api/bo/popups?perPage=500&page=1&sort_by=id&sort_order=desc');
  const rows = r?.data?.rows || [];
  return rows.find((p) => p.id === popupId) ?? null;
}

// ── Promo Content + Banner (Section 3.3 + 14.2) ─────────────────────────
// Endpoints confirmed live on QPRO4 (2026-05-18). Body shapes are inferred
// from the form-control map captured at captures/qpro-3-3-form-schema.md
// and captures/qpro-14-2-form-schema.md. First end-to-end run will surface
// any field-name mismatch via 422 — adjust here as needed.
//
// QP2 share the same endpoints (per existing get* pattern) — the body
// shape may differ slightly (additional merchant_ids, etc.). Add a QP2
// variant when the first QP2 capture lands.

// Section 3.3 — Create Promotion Content. Returns { data: { rows: { id, code, ... } } }.
//
// Body shape captured LIVE from QPRO4 SPA (2026-05-18) via window.fetch
// interceptor. See captures/qpro-3-3-actual-body.md for the full sample.
//
//   {
//     code: "EVE…",                              // <= 15 chars
//     category_id: { "0": <id>, "1": <id>, ... },// object with stringified-int keys, NOT array
//     content_type: { "1": true, "2": true },    // 1=Desktop, 2=Mobile, value=bool
//     member_visibility: 0,                       // 0=All, (other vals TBD)
//     position: 99,
//     apply_action: 0,                            // 0=Please Select
//     max_application: 0,
//     details: {                                  // object keyed by settings_locale_id (stringified)
//       "1": {                                    // settings_locale_id 1 = MY_EN
//         settings_locale_id: 1,
//         title, description, content,
//         start, end, publish_at, expire_at,      // "YYYY-MM-DD HH:mm:ss" in UTC (SPA converts local→UTC)
//         image: "<CDN url from /api/bo/file>",
//         promotion_type, promotion_amount,
//         form_title, form_content, form_button_text,
//         main_button_text_before, main_button_text_after,
//       },
//       "2": { settings_locale_id: null, title: null, ... },  // null-stub entries required
//       "3": { settings_locale_id: null, title: null, ... },
//     }
//   }
//
// Helper to convert an "intended local time" string like "2026-04-21 00:00:00"
// in GMT+8 to the UTC string the API expects:
//   const utc = new Date('2026-04-21T00:00:00+08:00').toISOString().replace('T',' ').slice(0,19);
//   → "2026-04-20 16:00:00"
export async function createPromotionContent(site, body) {
  return authedFetch(site, '/api/bo/promotioncontent', { method: 'POST', body });
}

// Build an empty per-locale stub (all-null record) the API requires for
// locales not being filled. Keys must be strings, matching the SPA shape.
export function emptyPromoContentDetail() {
  return {
    settings_locale_id: null, title: null, description: null,
    start: null, image: null, end: null, publish_at: null, expire_at: null,
    content: null, promotion_type: null, promotion_amount: null,
    form_title: null, form_content: null, form_button_text: null,
    main_button_text_before: null, main_button_text_after: null,
  };
}

// Convert "YYYY-MM-DD HH:mm:ss" local-zone string to the UTC the BO expects.
// GMT+8 is the standard BO display zone — if the caller uses a different
// zone, pass it explicitly (e.g. '+07:00').
export function localToUtcBoDate(local, zone = '+08:00') {
  const m = String(local).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (!m) throw new Error(`localToUtcBoDate: bad format "${local}"`);
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${zone}`;
  return new Date(iso).toISOString().slice(0, 19).replace('T', ' ');
}

// Section 14.2 — Create Banner. Returns { data: { rows: { id, ... } } }.
// Body shape confirmed by GET /api/bo/banner listing + live 422 peeling
// (2026-05-18):
//   {
//     label: "...",
//     link: "/promotion?code=…",
//     start_datetime: "YYYY-MM-DD HH:mm:ss",
//     end_datetime:   "YYYY-MM-DD HH:mm:ss",
//     position: 99,
//     status: 0,           // 0=Inactive, 1=Active
//     session: 1,          // 1=All, 3=After Login (string "1" accepted)
//     platform_type_id: 1, // 1=User Portal, 2=Affiliate Portal
//     images: [            // array, one entry per locale
//       { settings_locale_id: 1, image_desktop: "<url>", image_mobile: "<url>" },
//     ]
//   }
//
// Image uploads: pre-step POST /api/bo/file?type=banners returns CDN URLs
// that go into image_desktop / image_mobile.
export async function createBanner(site, body) {
  return authedFetch(site, '/api/bo/banner', { method: 'POST', body });
}

// Upload a banner image file. The BO returns a CDN-hosted URL that is then
// referenced in the createBanner body's `desktop_image` / `mobile_image`
// fields. Multipart upload — uses raw fetch since authedFetch defaults to
// JSON content-type.
// Upload a file via the BO's `/api/bo/file` endpoint and get back a CDN URL.
// Captured live from the QPRO4 SPA (2026-05-18):
//   POST /api/bo/file
//   multipart/form-data:
//     files = <binary>            (plural — "files", NOT "file" or "image")
//     type  = "promotions" | "banners"  (string discriminator — plural for banners,
//                                         singular base for promotion-page-content)
// Returns { data: { url: "https://....quickcdn.org/<type>/<hash>.<ext>" } }.
// The returned URL goes into the create body's `image` / `desktop_image` /
// `mobile_image` field.
//
// Use `type='promotions'` for Section 3.3 Promotion Content uploads.
// Use `type='banners'` for Section 14.2 Banner uploads.
export async function uploadFile(site, fileBuffer, filename, { type = 'promotions', mimeType = 'image/jpeg' } = {}) {
  const session = await getSession(site);
  const form = new FormData();
  form.append('files', new Blob([fileBuffer], { type: mimeType }), filename);
  form.append('type', type);
  const res = await fetch(`${site.apiHost}/api/bo/file`, {
    method: 'POST',
    headers: { ...authHeaders(session) },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`uploadFile HTTP ${res.status} (type=${type}): ${text.slice(0, 300)}`);
  }
  return res.json();
}

// Backward-compat alias — old callers may use uploadBannerFile().
export const uploadBannerFile = (site, buf, name, mt) => uploadFile(site, buf, name, { type: 'banners', mimeType: mt });

// Update a banner in place. PUT /api/bo/banner/{id}; body mirrors createBanner
// (label, link, session, platform_type_id, position, status, start/end_datetime,
// images[]). Verified live on the qpro13 canary 2026-06-11 ("Successfully
// updated banner"). Primary use: flipping `status` 0<->1 to (de)activate.
export async function updateBanner(site, bannerId, body) {
  return authedFetch(site, `/api/bo/banner/${bannerId}`, { method: 'PUT', body });
}

// Build a PUT body from a banner LIST row (the row must carry images[], as
// returned by getBanners/getAllBanners — the GET-detail endpoint returns a
// `locale` field instead). `overrides` lets the caller change specific fields,
// e.g. { status: 1 } to activate. Datetimes are converted from the list's ISO
// form back to the "YYYY-MM-DD HH:mm:ss" the BO expects on write.
export function bannerUpdateBody(row, overrides = {}) {
  const iso2bo = (s) => String(s).slice(0, 19).replace('T', ' ');
  return {
    label: row.label,
    link: row.link,
    session: row.session,
    platform_type_id: row.platform_type_id,
    position: row.position,
    status: row.status,
    start_datetime: iso2bo(row.start_datetime),
    end_datetime: iso2bo(row.end_datetime),
    images: (row.images || []).map((im) => ({
      settings_locale_id: im.settings_locale_id,
      image_desktop: im.image_desktop,
      image_mobile: im.image_mobile,
    })),
    ...overrides,
  };
}

// Section 14.2 — GET Banners list. Mirrors getPromotions() in signature and
// response shape. Status: 1=Active, 0=Inactive/Draft. Omit status to attempt
// fetching without a filter (behaviour depends on the BO's default).
export async function getBanners(site, {
  status,
  perPage = 100,
  page = 1,
  extra = {},
} = {}) {
  const params = new URLSearchParams({
    perPage: String(perPage),
    page: String(page),
    ...extra,
  });
  if (status != null) params.set('status', String(status));
  return authedFetch(site, `/api/bo/banner?${params}`);
}

// Paginate all banners. Each page fetch runs in parallel; safe because the
// total page count comes from the first response's paginations block.
export async function getAllBanners(site, opts = {}) {
  const first = await getBanners(site, { ...opts, page: 1 });
  const lastPage = first.data.paginations?.last_page ?? 1;
  const rows = [...(first.data.rows || [])];
  if (lastPage > 1) {
    const more = await Promise.all(
      Array.from({ length: lastPage - 1 }, (_, i) => getBanners(site, { ...opts, page: i + 2 })),
    );
    for (const r of more) rows.push(...(r.data.rows || []));
  }
  return { rows, total: first.data.paginations?.total ?? rows.length, pages: lastPage };
}

// Resolve a merchant inside a site by name or prefix. Uses cached session.
export async function resolveMerchant(site, nameOrPrefix) {
  const resolved = typeof site === 'string' || site == null ? getSite(site) : site;
  const session = await getSession(resolved);
  const want = String(nameOrPrefix).toLowerCase();
  const m = session.merchants.find(
    (x) => x.name.toLowerCase() === want || x.prefix.toLowerCase() === want,
  );
  if (!m) {
    const known = session.merchants.map((x) => `${x.name}(${x.prefix})`).join(', ');
    throw new Error(`Merchant '${nameOrPrefix}' not found in ${resolved.id}. Known: ${known}`);
  }
  return m;
}

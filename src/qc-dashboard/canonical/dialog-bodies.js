// Collector item 4: retrieve actual dialog popup BODIES via the safe popup
// listing endpoint, walking every page.
//
// GET /api/bo/popups/{id} 405s — there is no individual-record endpoint (see
// api-client.js getPopupDetail's comment). The listing endpoint
// GET /api/bo/popups?perPage=N&page=P&sort_by=id&sort_order=desc is the only
// safe read path, and every existing caller (getPopupDetail,
// readDialogForPreservation, preserveQp2PutFields) hardcodes page=1 with
// perPage=500. Live probe confirmed this is a real gap, not theoretical:
// QPRO1 alone has 701 total popups — page 1 (sorted id DESC) returns only the
// 500 newest, silently missing the ~201 oldest. A promotion whose linked
// popup falls in that gap would report its dialog body as unavailable even
// though the record exists.
//
// Popup row shape (live capture, QPRO1 id=701, sanitized — no site
// credentials in this shape):
//   { id, code, platform, label, location, start_date, end_date, session,
//     position, status, locale_ids, locale_name, site_id?,
//     contents: [{ id, popup_id, locale_id, locale_name, content,
//                  raw_content, title, raw_title, desktop_link, mobile_link,
//                  cta_button_type, cta_button_text_1/2, cta_button_link_1/2 }] }
// `locale_id` uses the SAME numbering as message templates (confirmed live:
// locale_id 6/7 self-label as "SG_EN"/"SG_ZH", matching
// listing-row-fields.js's SETTINGS_LOCALE_ID_MAP) — reused here rather than
// building a second locale table.
//
// The LINK on the promotion's listing row (list_row.dialog_popup_list[i]) is
// { id, promotion_id, popup_id, created_at, updated_at } — the link itself
// declares which promotion it belongs to, which is the identity this module
// cross-checks before ever attributing a body to a promotion.

import { authedFetch } from '../../api-client.js';
import { withBoundedRetry } from '../readonly-client.js';
import { localeKeyForSettingsId, languageForLocaleKey } from './listing-row-fields.js';
import { hostOf, checkMtContent } from '../../mt-content-checks.js';

const DEFAULT_TTL_MS = 5 * 60 * 1000; // same "briefly" rationale as catalogues.js

const popupCacheBySite = new Map();

function isFresh(entry, ttlMs, now) {
  return Boolean(entry) && (now - entry.fetchedAtMs) < ttlMs;
}

async function fetchAllPopupsPaginated(site, { perPage = 500, retry, fetchImpl } = {}) {
  const doFetch = fetchImpl || authedFetch;
  const fetchPage = (page) => withBoundedRetry(
    () => doFetch(site, `/api/bo/popups?perPage=${perPage}&page=${page}&sort_by=id&sort_order=desc`),
    retry,
  );
  const first = await fetchPage(1);
  const rows = [...(first?.data?.rows || [])];
  const lastPage = first?.data?.paginations?.last_page ?? 1;
  const total = first?.data?.paginations?.total ?? rows.length;
  if (lastPage > 1) {
    const more = await Promise.all(Array.from({ length: lastPage - 1 }, (_, i) => fetchPage(i + 2)));
    for (const r of more) rows.push(...(r?.data?.rows || []));
  }
  return { rows, total, pages: lastPage };
}

// Briefly-cached, source-tagged, per-site popup catalogue — same shape
// discipline as catalogues.js (complete:false + empty on failure, never
// invents a substitute; not cached on failure so a transient blip doesn't
// freeze "no popups" for the rest of the TTL window).
export async function getPopupCatalogue(site, { ttlMs = DEFAULT_TTL_MS, now = Date.now(), force = false, retry, fetchImpl } = {}) {
  const cached = popupCacheBySite.get(site.id);
  if (!force && isFresh(cached, ttlMs, now)) return cached.catalogue;
  try {
    const { rows, total, pages } = await fetchAllPopupsPaginated(site, { retry, fetchImpl });
    const byId = new Map(rows.map((p) => [Number(p.id), p]));
    const catalogue = {
      siteId: site.id,
      source: 'api:/api/bo/popups',
      fetchedAt: new Date(now).toISOString(),
      complete: true,
      total,
      pages,
      byId,
    };
    popupCacheBySite.set(site.id, { catalogue, fetchedAtMs: now });
    return catalogue;
  } catch (e) {
    return {
      siteId: site.id,
      source: 'api:/api/bo/popups',
      fetchedAt: new Date(now).toISOString(),
      complete: false,
      total: 0,
      pages: 0,
      byId: new Map(),
      error: e?.message || String(e),
    };
  }
}

export function resetPopupCatalogueCache() {
  popupCacheBySite.clear();
}

// Resolve the actual localized dialog bodies for one promotion's dialog
// links, rejecting any record that doesn't identity-match cleanly. Never
// silently attributes a popup's content to the wrong promotion — a
// mismatch is reported via `rejected`, not swallowed.
//
// Returns { dialogBody: {LANG: html}, dialogBodyByLocale: {LOCALE: html},
//           dialogTitleByLocale: {LOCALE: text}, localesDeclared: [...],
//           matchedPopupIds: [...], rejected: [{link, reason, ...}],
//           catalogueSource }
export function resolveDialogBodiesForPromotion({ dialogLinks, promotionId, catalogue, merchantId = null } = {}) {
  const links = Array.isArray(dialogLinks) ? dialogLinks : [];
  const dialogBody = {};
  const dialogBodyByLocale = {};
  const dialogTitleByLocale = {};
  const localesDeclared = [];
  const rejected = [];
  const seenPopupIds = new Set();

  for (const link of links) {
    const popupId = Number(link?.popup_id ?? link?.id);
    if (!Number.isFinite(popupId)) { rejected.push({ link, reason: 'no-popup-id' }); continue; }

    // Exact promotion-ID match: the link itself declares its promotion_id.
    // A link whose declared promotion disagrees with the one we're
    // resolving for is stale/cross-wired — reject, never attribute.
    if (link.promotion_id != null && promotionId != null && Number(link.promotion_id) !== Number(promotionId)) {
      rejected.push({ link, popupId, reason: 'promotion-id-mismatch', linkPromotionId: link.promotion_id, expectedPromotionId: promotionId });
      continue;
    }

    if (seenPopupIds.has(popupId)) { rejected.push({ link, popupId, reason: 'duplicate-popup-id' }); continue; }
    seenPopupIds.add(popupId);

    const popup = catalogue?.byId?.get(popupId);
    if (!popup) {
      rejected.push({ link, popupId, reason: catalogue?.complete === false ? 'catalogue-incomplete' : 'popup-id-not-found' });
      continue;
    }

    // Merchant cross-check where the BO exposes one. QPRO popup rows don't
    // carry site_id (single-merchant, nothing to check); QP2's do — a
    // mismatch there means the popup belongs to a sibling merchant on the
    // shared BO and must not be attributed to this one.
    if (merchantId != null && popup.site_id != null && Number(popup.site_id) !== Number(merchantId)) {
      rejected.push({ link, popupId, reason: 'merchant-mismatch', popupSiteId: popup.site_id, expectedMerchantId: merchantId });
      continue;
    }

    for (const entry of (popup.contents || [])) {
      const localeKey = localeKeyForSettingsId(entry.locale_id);
      if (!localeKey) continue;
      if (!localesDeclared.includes(localeKey)) localesDeclared.push(localeKey);
      const lang = languageForLocaleKey(localeKey);
      if (typeof entry.content === 'string') {
        if (lang && dialogBody[lang] == null) dialogBody[lang] = entry.content;
        dialogBodyByLocale[localeKey] = entry.content;
      }
      if (typeof entry.title === 'string') dialogTitleByLocale[localeKey] = entry.title;
    }
  }

  return {
    dialogBody,
    dialogBodyByLocale,
    dialogTitleByLocale,
    localesDeclared: localesDeclared.sort(),
    matchedPopupIds: [...seenPopupIds],
    rejected,
    catalogueSource: catalogue?.source || null,
  };
}

// Content/domain check for dialog bodies — reuses the same foreign-domain
// detection already proven on message templates (mt-content-checks.js),
// applied to dialog content + CTA links instead of MT subject+body. A
// dialog is exactly the kind of surface a cross-brand clone could leak a
// hardcoded competitor/sibling domain into (via a raw <a> in `content` or a
// literal CTA link), so it gets the same scrutiny.
export function checkDialogBodyDomains({ dialogTitleByLocale = {}, dialogBodyByLocale = {}, ctaLinksByLocale = {} }, { brand, platform, domainToBrand }) {
  const messageTemplates = Object.keys(dialogBodyByLocale).map((locale) => ({
    subject: dialogTitleByLocale[locale] || '',
    message: `${dialogBodyByLocale[locale] || ''} ${(ctaLinksByLocale[locale] || []).join(' ')}`,
  }));
  return checkMtContent({ platform, brand, messageTemplates }, { domainToBrand });
}

export { hostOf };

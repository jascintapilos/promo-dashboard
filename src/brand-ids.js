// Brand / merchant / site enumeration — a pure data + pure-function module with
// NO heavy imports. Any consumer (notably the QC dashboard's brand-config) can
// pull these brand constants without dragging in the promo write-path
// (api-mapper-qp2 → message-template-renderer → ingest, …) or the live-BO
// clients. Split out of live-codes.js and api-mapper-qp2.js on 2026-08-13 so the
// dashboard's static boot graph no longer reaches the promo mapper.
//
// QP2_BRAND_TO_IDS is re-exported from api-mapper-qp2.js for backwards
// compatibility, so its existing importers keep working unchanged. QPRO_BRANDS /
// QP2_MERCHANTS / IGMP_SITES / brandToSite are re-exported from live-codes.js
// for the same reason.

// QP2 shared BO: all four merchants (QP2A/B/C/D) share ibc22.qtp777.com.
// site_id is per-merchant (1–4, verified 2026-05-16 via /api/bo/merchantsites
// and the popups catalog showing distinct site_ids). Popups are scoped to a
// single merchant via site_id — to deploy one popup to all 4 merchants, POST 4
// popups with different site_id values + link each via dialog_popup_list.
export const QP2_BRAND_TO_IDS = {
  QP2A: { siteId: 1, merchantId: 1 }, // IBC22
  QP2B: { siteId: 2, merchantId: 2 }, // KING333
  QP2C: { siteId: 3, merchantId: 3 }, // ACE66
  QP2D: { siteId: 4, merchantId: 4 }, // SPADE66
};

export const QPRO_BRANDS = Array.from({ length: 17 }, (_, i) => ({ brand: `QPRO${i + 1}`, siteId: `qpro${i + 1}` }));

// R20-fix: QP2 shared BO lives in bo-sites.json under id 'ibc22' (all four
// QP2 merchants — QP2A/B/C/D — share ibc22.qtp777.com). src/ingest.js:75-78
// is already 'ibc22'; an earlier drift to a fictional 'qp2' siteId broke the
// QC Hub's alignment with the daily canary flow — keep this 'ibc22'.
export const QP2_MERCHANTS = Object.entries(QP2_BRAND_TO_IDS).map(([brand, ids]) => ({ brand, merchantId: ids.merchantId, siteId: 'ibc22' }));

// Brand label must match bundleBrand() in bin/canary-api-igmp.js exactly —
// that's what qc-bundle filenames are keyed by (WS1_MY, WS1_SG, …; WS2 stays
// single since it has only one region).
export const IGMP_SITES = [
  { siteId: 'ws1-v3-my', brand: 'WS1_MY', region: 'MY' },
  { siteId: 'ws1-v3-sg', brand: 'WS1_SG', region: 'SG' },
  { siteId: 'ws1-v3-id', brand: 'WS1_ID', region: 'ID' },
  { siteId: 'ws1-v3-th', brand: 'WS1_TH', region: 'TH' },
  { siteId: 'ws1-v3-kh', brand: 'WS1_KH', region: 'KH' },
  { siteId: 'ws2', brand: 'WS2', region: 'MY' },
];

// brand -> { platform, siteId, merchantId? } — for callers that need to
// re-fetch a single code's live detail given only the brand label from a
// findings/state file (which doesn't carry siteId).
export function brandToSite(brand) {
  const qpro = QPRO_BRANDS.find((b) => b.brand === brand);
  if (qpro) return { platform: 'qpro', siteId: qpro.siteId };
  const qp2 = QP2_MERCHANTS.find((b) => b.brand === brand);
  if (qp2) return { platform: 'qp2', siteId: qp2.siteId, merchantId: qp2.merchantId };
  const igmp = IGMP_SITES.find((b) => b.brand === brand);
  if (igmp) return { platform: 'igmp', siteId: igmp.siteId, region: igmp.region };
  return null;
}

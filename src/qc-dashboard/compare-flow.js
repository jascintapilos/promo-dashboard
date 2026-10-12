// Increment 6 (real-QC upgrade): the orchestrator that turns a live BO
// snapshot + an approved-request record into a deterministic PASS / REVIEW /
// FAIL / MANUAL_REQUIRED verdict.
//
// Scope: MVP brands only (caller decides via brand.qcRules.mvp === true).
// Non-MVP brands still use the pre-Increment-6 auto-checks path.
//
// Contract for the caller:
//   runComparison({ brand, code, handle, snapshot, brandConfig }) → {
//     status:  'ok' | 'skip',                       // skip → do not override existing verdict
//     verdict, findings, fields, summary,           // when status === 'ok'
//     evidence,                                     // item 6: consolidated source tags + locale coverage
//     expectedSource, expectedRef, actualRef,        // audit trail
//     reason,                                       // when status === 'skip'
//   }
//
// The design is defensive by construction:
// - If the snapshot didn't reach BO (error, notFound, unavailable) → skip,
//   because the preflight / fetch layer already emitted its own
//   MANUAL_REQUIRED verdict with the correct evidence.
// - If the expected source cannot be resolved unambiguously (D2) → return
//   MANUAL_REQUIRED with `expected-source-unresolved` finding. Never
//   silently fall back to loose grep — that would erase the "no PASS
//   without evidence" invariant on the expected side.
// - No filesystem paths, cookies, or tokens leave this module.

import { resolveExpectedSource as _defaultResolve } from './expected-source.js';
import { expectedFromSource as _defaultExpectedFromSource, liveFromPlatform as _defaultLiveFromPlatform } from './canonical/index.js';
import { compare as _defaultCompare } from './compare-engine.js';
import { evaluateCanonicalLocaleCoverage } from './canonical/locale-matrix.js';

// Item 6: consolidate per-field evidence source tags that are otherwise
// scattered across the canonical (scope.*Evidence from item 2,
// content.dialogEvidence from item 4) plus the expected-source tag (item 5:
// 'bundle' | 'request' | 'sheet') into one summary. `liveTransport` is
// always 'api' today — every actual live fetch goes through the plain
// read-only REST client; it is surfaced (rather than assumed) so a future
// browser-context transport shows up here distinctly once one exists.
function _buildEvidenceSummary({ actual, expSrc }) {
  const scope = actual?.scope || {};
  const content = actual?.content || {};
  return {
    expectedSourceType: expSrc?.sourceType || null,
    liveTransport: 'api',
    categories: scope.categoriesEvidence || null,
    gameProviderCodes: scope.gameProviderCodesEvidence || null,
    dialog: content.dialogEvidence || null,
    localeCoverage: actual ? evaluateCanonicalLocaleCoverage(actual, { brand: actual.identity?.brand }) : null,
  };
}

const SUPPORTED_PLATFORMS = new Set(['qpro', 'qp2', 'igmp']);

// --- snapshot.raw → { list_row, detail, tnc?, rewardContents? } shape the
// canonical adapters expect.
//
// fetch-promo.js normalizes differently per platform:
//   qpro / qp2 → raw: { listingRow, detail, currencies, names, listingFull }
//   igmp        → raw: { list, detail, rewardContents } where list/detail may be
//                 wrapped as { data: { Promotion: {...} } }, and
//                 rewardContents is the raw GetPromotionRewardContents POST
//                 response ({success, data: [{RewardId, Locale, Content,
//                 PromotionRewardName}]}) — unwrapped to a plain array here.
//
// This function keeps ALL knowledge of those shapes localized here, so the
// canonical adapters can stay ignorant of the fetcher and remain testable
// in isolation from live BO calls.
export function snapshotToLiveState(snapshot, platform) {
  if (!snapshot || !snapshot.raw) return null;
  const raw = snapshot.raw;
  if (platform === 'qpro' || platform === 'qp2') {
    const listRow = raw.listingRow || null;
    if (!listRow) return null;
    // Fold currency/name arrays onto detail so the adapters don't need to
    // reach back into raw for them.
    //
    // promotion_name_list was previously DROPPED here, so the authoritative
    // promotion names from /api/bo/promotionname never reached the adapter on
    // the live QC-Hub path — only the bundle path (which carries the
    // api-client normalized promotion_name_en/_zh_id) had them. That is why
    // promotion-name coverage looked fine in fixtures and was empty live.
    const detail = {
      ...(raw.detail || {}),
      promotion_currency_list: raw.detail?.promotion_currency_list
        || (Array.isArray(raw.currencies) ? raw.currencies : []),
      promotion_name_list: Array.isArray(raw.names) ? raw.names : [],
    };
    return { list_row: listRow, detail, tnc: null };
  }
  if (platform === 'igmp') {
    const list = _unwrapIgmp(raw.list);
    const detail = _unwrapIgmp(raw.detail);
    if (!list && !detail) return null;
    // Gap-closure item 1: rewardContents used to be fetched (fetch-promo.js's
    // fetchIgmp already calls GetPromotionRewardContents) but dropped here
    // before the adapter ever saw it — every IGMP locale-completeness check
    // was structurally unable to pass no matter how complete the live BO
    // data actually was. `raw.rewardContents` is the raw POST response
    // ({success, data: [...]}); igmp-adapter.js reads the plain array.
    const rewardContents = Array.isArray(raw.rewardContents?.data) ? raw.rewardContents.data : [];
    return { list_row: list || {}, detail: detail || {}, rewardContents };
  }
  return null;
}

function _unwrapIgmp(node) {
  if (!node) return null;
  if (node?.data?.Promotion) return node.data.Promotion;
  if (node?.data && typeof node.data === 'object' && !Array.isArray(node.data)) return node.data;
  return node;
}

// --- top-level orchestrator.
//
// deps is dependency-injected so the tests can pass in canned resolvers
// without touching the filesystem or the canonical modules under test.
export function runComparison({ brand, code, handle = null, snapshot, brandConfig, deps = {} } = {}) {
  if (!brand || !code) {
    return _skip('missing-brand-or-code', 'brand and code are required');
  }
  const runtime = brandConfig?.runtime || snapshot?.runtime || null;
  const platform = String(runtime?.platform || '').toLowerCase();
  if (!SUPPORTED_PLATFORMS.has(platform)) {
    return _skip('unsupported-platform', `compare-flow does not support platform "${platform}"`);
  }

  // The fetch/preflight layers already produce a MANUAL_REQUIRED verdict
  // with the correct evidence when BO is unreachable. Overriding here would
  // duplicate or contradict them.
  if (snapshot?.error || snapshot?.notFound) {
    return _skip('snapshot-unavailable', snapshot.error || 'Promo not found in live BO');
  }
  const liveState = snapshotToLiveState(snapshot, platform);
  if (!liveState) {
    return _skip('live-state-empty', 'Live BO snapshot has no usable payload');
  }

  const resolveExpectedSource = deps.resolveExpectedSource || _defaultResolve;
  const expectedFromSource = deps.expectedFromSource || _defaultExpectedFromSource;
  const liveFromPlatform = deps.liveFromPlatform || _defaultLiveFromPlatform;
  const compare = deps.compare || _defaultCompare;

  // D2 resolution — handle-first, else exact (brand, promo_code), else
  // MANUAL_REQUIRED. resolveExpectedSource enforces the "no loose grep"
  // rule and returns 'ambiguous' when multiple matches exist.
  const expSrc = resolveExpectedSource({ brand, code, handle });
  if (!expSrc || !expSrc.source) {
    const detail = expSrc?.sourceType === 'ambiguous'
      ? `Multiple approved requests matched (brand ${brand}, code ${code}). Provide the Request Handle to disambiguate.`
      : `No approved request found for ${brand} ${code}${handle ? ` (handle ${handle})` : ''}. Add the request, or record verdict via Override.`;
    return {
      status: 'ok',
      verdict: 'MANUAL_REQUIRED',
      findings: [{
        severity: 'FAIL',
        check: 'expected-source-unresolved',
        message: detail,
        field: 'expectedSource',
      }],
      fields: [],
      summary: { total: 0, passed: 0, failed: 0, warnings: 0, unavailable: 0, skipped: 0 },
      evidence: _buildEvidenceSummary({ actual: null, expSrc }),
      expectedSource: _publicExpectedSource(expSrc, handle),
      expectedRef: null,
      actualRef: null,
    };
  }

  let expected;
  try {
    // Bundle sources don't always carry `promo_code` inside the `source`
    // sub-block — the code lives at the bundle top level and the resolver
    // exposes it as `expSrc.promoCode`. Thread it in so the expected
    // canonical carries the identity, otherwise every bundle-based compare
    // reports promoCode as UNAVAILABLE.
    expected = expectedFromSource(expSrc.source, {
      brand,
      promoCode: expSrc.promoCode || code,
      promotionId: expSrc.promotionId || null,
      // Blocker 3 fix: hand the target-brand's platform + siteId so the
      // adapter can filter multi-region source.currencies down to the ones
      // the target BO actually carries (e.g. WS1_MY → MYR only).
      platform,
      siteId: runtime?.siteId || null,
    });
  } catch (e) {
    return {
      status: 'ok',
      verdict: 'MANUAL_REQUIRED',
      findings: [{
        severity: 'FAIL',
        check: 'expected-adapter-failed',
        message: `Approved request could not be normalized: ${_safeMessage(e)}`,
        field: 'expectedSource',
      }],
      fields: [],
      summary: { total: 0, passed: 0, failed: 0, warnings: 0, unavailable: 0, skipped: 0 },
      evidence: _buildEvidenceSummary({ actual: null, expSrc }),
      expectedSource: _publicExpectedSource(expSrc, handle),
      expectedRef: null,
      actualRef: null,
    };
  }

  let actual;
  try {
    // Items 2 + 4: thread the live per-site catalogues (fetched alongside
    // the snapshot in fetch-promo.js) through to the qpro/qp2 adapters so
    // code/dialog resolution prefers authoritative BO data over static
    // fallbacks. Harmless no-op for igmp (liveFromIgmp doesn't read
    // opts.catalogue).
    const catalogue = {
      categories: snapshot?.raw?.categoryCatalogue || null,
      providers: snapshot?.raw?.providerCatalogue || null,
      popups: snapshot?.raw?.popupCatalogue || null,
    };
    actual = liveFromPlatform(platform, liveState, { brand, promoCode: code, siteId: runtime?.siteId, catalogue });
  } catch (e) {
    return {
      status: 'ok',
      verdict: 'MANUAL_REQUIRED',
      findings: [{
        severity: 'FAIL',
        check: 'live-adapter-failed',
        message: `Live snapshot could not be normalized: ${_safeMessage(e)}`,
        field: 'liveState',
      }],
      fields: [],
      summary: { total: 0, passed: 0, failed: 0, warnings: 0, unavailable: 0, skipped: 0 },
      evidence: _buildEvidenceSummary({ actual: null, expSrc }),
      expectedSource: _publicExpectedSource(expSrc, handle),
      expectedRef: null,
      actualRef: null,
    };
  }

  const cmp = compare({ expected, actual, brand, platform });
  // The compare engine emits `{field, status, rule, message}` — group them
  // once at the boundary so the UI / audit log / /api/run-qc response speak
  // a single vocabulary (`{name, verdict, path, notes}`). Renaming avoids
  // downstream code needing to know which layer produced the shape.
  const uiFields = (cmp.fields || []).map((f) => ({
    name: f.field,
    expected: f.expected,
    actual: f.actual,
    verdict: f.status,
    severity: f.severity,
    path: f.rule,
    notes: f.message,
    expectedPath: f.expectedPath,
    boPath: f.boPath,
  }));
  const s = cmp.summary || {};
  const skipped = uiFields.filter((f) => f.verdict === 'SKIPPED').length;
  const summary = {
    total: uiFields.length,
    passed: s.passed || 0,
    failed: s.failed || 0,
    warnings: s.warning || 0,
    unavailable: s.unavailable || 0,
    skipped,
  };
  return {
    status: 'ok',
    verdict: cmp.verdict,
    findings: _findingsFromFields(uiFields),
    fields: uiFields,
    summary,
    // Item 6: per-field evidence source tags, consolidated. The individual
    // tags already exist scattered across the canonical (scope.*Evidence
    // from item 2, content.dialogEvidence from item 4, expSrc.sourceType
    // from item 5) — this pulls them into one place so a caller doesn't
    // need to know the canonical's internal shape to answer "where did
    // this verdict's evidence actually come from?"
    evidence: _buildEvidenceSummary({ actual, expSrc }),
    expectedSource: _publicExpectedSource(expSrc, handle),
    // These references are shown to the UI as compact summaries — never the
    // full canonical objects (which would leak a lot of BO detail with no
    // caller demand for it). If a caller needs the full canonical, they
    // still have snapshot.raw / expSrc.source; we do not re-expose it.
    expectedRef: {
      promoCode: expected.identity.promoCode,
      bonusType: expected.identity.bonusType,
      currencies: expected.currencies.map((c) => c.code),
    },
    actualRef: {
      promoCode: actual.identity.promoCode,
      bonusType: actual.identity.bonusType,
      currencies: actual.currencies.map((c) => c.code),
      promotionId: actual.identity.promotionId,
    },
  };
}

// Skip = the caller keeps the pre-Increment-6 verdict path. We surface a
// reason so downstream logging / observability still knows why.
function _skip(code, reason) {
  return { status: 'skip', reason, code };
}

// Item 5: async wrapper adding the cached, read-only Sheets fallback ON TOP
// of the existing synchronous filesystem resolution — used only when local
// (captures/requests + captures/qc-bundles) has nothing. runComparison()
// itself stays synchronous and 100% unchanged for every existing caller
// (bin/qc-dashboard.mjs's direct-fetch path, every runComparison() test) —
// this wraps it rather than making it async, so nothing already calling it
// synchronously silently starts receiving a Promise.
//
// sheets-fallback.js is imported LAZILY (dynamic import), not at module top,
// because it transitively pulls in googleapis via sheets-ingest.js /
// sheets-client.js / google-auth.js. compare-flow.js is also imported by the
// company server for runComparisonFromRelay() — that path never calls this
// function, but a static top-level import would still load googleapis into
// the server's process on every startup for a capability it never uses. A
// dynamic import means that cost (and any credential-file requirement) is
// paid only by a caller that actually invokes this VDI-side wrapper.
export async function runComparisonWithSheetsFallback({ brand, code, handle = null, snapshot, brandConfig, deps = {} } = {}) {
  const resolveExpectedSource = deps.resolveExpectedSource || _defaultResolve;
  const primary = resolveExpectedSource({ brand, code, handle });
  // Local file already resolved it, or local ambiguity is itself the
  // authoritative answer — either way, do not let the sheet override it.
  if (primary && (primary.source || primary.sourceType === 'ambiguous')) {
    return runComparison({ brand, code, handle, snapshot, brandConfig, deps: { ...deps, resolveExpectedSource: () => primary } });
  }
  let sheetResult = null;
  try {
    const resolveFromSheet = deps.resolveExpectedSourceFromSheet
      || (await import('./sheets-fallback.js')).resolveExpectedSourceFromSheet;
    sheetResult = await resolveFromSheet({ brand, code, handle });
  } catch {
    sheetResult = null; // Sheets unavailable in this process (e.g. no OAuth token file) — fall through to the local not-found result, never a thrown error.
  }
  const finalSrc = (sheetResult && (sheetResult.source || sheetResult.sourceType === 'ambiguous')) ? sheetResult : primary;
  return runComparison({ brand, code, handle, snapshot, brandConfig, deps: { ...deps, resolveExpectedSource: () => finalSrc } });
}

// ─────────────────────────────────────────────────────────────────────────
// BO Relay entrypoint (correction brief §§4-5): re-derive the verdict from
// pre-normalized canonicals supplied by the VDI worker. The company server
// NEVER trusts a relay-supplied verdict — we always call compare() again on
// the sanitized shape so the audit record reflects our own decision.
//
// Inputs are already-canonical objects (produced on the VDI by
// expectedFromSource + liveFromPlatform). The company server does not need
// snapshotToLiveState or resolveExpectedSource here.
export function runComparisonFromRelay({
  brand, code, handle = null,
  expectedCanonical, actualCanonical, expectedSourceMeta,
  platform, deps = {},
} = {}) {
  if (!brand || !code) return _skip('missing-brand-or-code', 'brand and code are required');
  if (!SUPPORTED_PLATFORMS.has(String(platform || '').toLowerCase())) {
    return _skip('unsupported-platform', `runComparisonFromRelay: unsupported platform "${platform}"`);
  }
  if (!expectedCanonical || !actualCanonical) {
    return {
      status: 'ok',
      verdict: 'MANUAL_REQUIRED',
      findings: [{
        severity: 'FAIL',
        check: 'relay-incomplete-evidence',
        message: 'Relay result missing expected/live canonical — cannot derive verdict; enter QC manually via Override.',
        field: 'relayEvidence',
      }],
      fields: [],
      summary: { total: 0, passed: 0, failed: 0, warnings: 0, unavailable: 0, skipped: 0 },
      expectedSource: _publicExpectedSourceFromMeta(expectedSourceMeta, handle),
      expectedRef: null,
      actualRef: null,
    };
  }
  const compare = deps.compare || _defaultCompare;
  let cmp;
  try {
    cmp = compare({ expected: expectedCanonical, actual: actualCanonical, brand, platform });
  } catch (e) {
    return {
      status: 'ok',
      verdict: 'MANUAL_REQUIRED',
      findings: [{
        severity: 'FAIL',
        check: 'compare-engine-error',
        message: `Deterministic compare failed on relay payload: ${_safeMessage(e)} — verdict cannot be trusted.`,
        field: 'compareEngine',
      }],
      fields: [],
      summary: { total: 0, passed: 0, failed: 0, warnings: 0, unavailable: 0, skipped: 0 },
      expectedSource: _publicExpectedSourceFromMeta(expectedSourceMeta, handle),
      expectedRef: null,
      actualRef: null,
    };
  }
  const uiFields = (cmp.fields || []).map((f) => ({
    name: f.field, expected: f.expected, actual: f.actual,
    verdict: f.status, severity: f.severity, path: f.rule,
    notes: f.message, expectedPath: f.expectedPath, boPath: f.boPath,
  }));
  const s = cmp.summary || {};
  const skipped = uiFields.filter((f) => f.verdict === 'SKIPPED').length;
  const summary = {
    total: uiFields.length,
    passed: s.passed || 0,
    failed: s.failed || 0,
    warnings: s.warning || 0,
    unavailable: s.unavailable || 0,
    skipped,
  };
  return {
    status: 'ok',
    verdict: cmp.verdict,
    findings: _findingsFromFields(uiFields),
    fields: uiFields,
    summary,
    expectedSource: _publicExpectedSourceFromMeta(expectedSourceMeta, handle),
    expectedRef: {
      promoCode: expectedCanonical.identity?.promoCode || null,
      bonusType: expectedCanonical.identity?.bonusType || null,
      currencies: (expectedCanonical.currencies || []).map((c) => c.code),
    },
    actualRef: {
      promoCode: actualCanonical.identity?.promoCode || null,
      bonusType: actualCanonical.identity?.bonusType || null,
      currencies: (actualCanonical.currencies || []).map((c) => c.code),
      promotionId: actualCanonical.identity?.promotionId || null,
    },
  };
}

// Relay-side variant: expectedSourceMeta comes from the worker as a plain
// object, not the resolver's internal record. Whitelist the fields the
// browser is allowed to see — never leak sourcePath.
function _publicExpectedSourceFromMeta(meta, requestedHandle) {
  if (!meta) return { sourceType: 'not-found', requestedHandle: requestedHandle || null };
  return {
    sourceType: meta.sourceType || null,
    sourceId: meta.sourceId || null,
    sourceTs: meta.sourceTs || null,
    approvalStatus: meta.approvalStatus || null,
    handle: meta.handle || null,
    promoCode: meta.promoCode || null,
    brand: meta.brand || null,
    requestedHandle: requestedHandle || null,
  };
}

function _findingsFromFields(fields) {
  // Only surface MISMATCH / UNAVAILABLE — MATCH and SKIPPED are noise for a
  // findings feed. The UI still gets every field via `fields` for the
  // expected-vs-live table.
  return (fields || [])
    .filter((f) => f.verdict === 'MISMATCH' || f.verdict === 'UNAVAILABLE')
    .map((f) => ({
      severity: f.verdict === 'MISMATCH' && f.severity === 'CRITICAL' ? 'FAIL'
        : f.verdict === 'UNAVAILABLE' && f.severity === 'CRITICAL' ? 'FAIL'
        : 'WARNING',
      check: `compare:${f.name}`,
      message: f.notes,
      field: f.path || f.name,
    }));
}

// Never leak the on-disk sourcePath — the D5 audit record captures sourceId
// (bundle/request identity) which is enough for traceability.
function _publicExpectedSource(expSrc, requestedHandle) {
  if (!expSrc) return { sourceType: 'not-found', requestedHandle: requestedHandle || null };
  return {
    sourceType: expSrc.sourceType,
    sourceId: expSrc.sourceId || null,
    sourceTs: expSrc.sourceTs || null,
    approvalStatus: expSrc.approvalStatus || null,
    handle: expSrc.handle || null,
    promoCode: expSrc.promoCode || null,
    brand: expSrc.brand || null,
    requestedHandle: requestedHandle || null,
  };
}

function _safeMessage(e) {
  const msg = String(e?.message || e || 'unknown error');
  // Strip absolute filesystem paths (defense in depth — the canonical
  // adapters shouldn't produce them, but keep this guard).
  return msg.replace(/[A-Z]:\\\S+|\/var\/\S+|\/etc\/\S+|\/opt\/\S+|\/home\/\S+/g, '<server-path>');
}

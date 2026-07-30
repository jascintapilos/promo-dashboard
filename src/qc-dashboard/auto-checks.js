import {
  checkCategoryNoProvider,
  checkCurrenciesPresent,
  checkDialogPopupPresence,
  checkExpiredActiveQproQp2,
  checkIgmpExpiredActive,
  checkMessageTemplatePresence,
} from '../structural-checks.js';
import { buildDomainToBrand, checkMtContent } from '../mt-content-checks.js';
import { buildLeakyTerms, checkCampaignLeakMt, checkCampaignLeakName } from '../campaign-checks.js';

// R19: strip nginx / HTML noise from error details so the QC card stays
// readable. Keeps the meaningful first-line + status code, drops any inline
// HTML that came back as an error body.
function _cleanErrorDetail(detail) {
  if (!detail) return 'fetch failed';
  let out = String(detail);
  const htmlIx = out.search(/<html|<!doctype/i);
  if (htmlIx >= 0) out = out.slice(0, htmlIx).trim();
  const statusMatch = out.match(/HTTP\s+(\d{3})/i);
  out = out.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
  // If the leftover text is JUST a status code repeat or is empty, use a
  // canonical short form. Otherwise keep the message + append status.
  if (!out || /^HTTP\s+\d{3}$/i.test(out)) {
    return statusMatch ? `HTTP ${statusMatch[1]}` : 'fetch failed';
  }
  if (out.length > 140) out = out.slice(0, 140) + '…';
  return statusMatch && !new RegExp(`HTTP\\s+${statusMatch[1]}`, 'i').test(out)
    ? `${out} (HTTP ${statusMatch[1]})`
    : out;
}

export function runAutoChecks(snapshot, { duplicateFindings = [], today = new Date() } = {}) {
  if (snapshot.notFound) {
    return [{
      severity: 'FAIL',
      check: 'code-not-found',
      field: 'promoCode',
      message: snapshot.detail || `Code ${snapshot.code} not found on ${snapshot.brand}`,
    }];
  }
  // R19: any fetch-side error terminates auto-checks with ONE clean finding.
  // Previously only exact string 'BO unreachable' short-circuited; SITE_CONFIG_
  // INCOMPLETE and other error labels fell through and spawned 8-10 downstream
  // "Required field X unavailable" + "No promotion currencies configured" noise
  // findings that made the QC card unusable. Now any error state → one line +
  // duplicate-check findings kept so partial signals still surface.
  if (snapshot.error) {
    const clean = _cleanErrorDetail(snapshot.detail);
    const label = snapshot.error === 'BO unreachable' ? 'BO unreachable' : snapshot.error;
    const findings = [{
      severity: 'FAIL',
      check: 'fetch-failed',
      message: `${label} — auto-fetch unavailable, enter QC verdict manually. Detail: ${clean}`,
    }];
    if (Array.isArray(duplicateFindings) && duplicateFindings.length) findings.push(...duplicateFindings);
    return findings.map((f) => ({ severity: f.severity || 'WARNING', check: f.check || 'auto-check', message: f.message || String(f) }));
  }
  const cand = snapshot.checkCandidate || {};
  const findings = [];
  if (cand.platform === 'igmp') {
    findings.push(...checkIgmpExpiredActive(cand, today));
  } else {
    findings.push(
      ...checkExpiredActiveQproQp2(cand, today),
      ...checkCategoryNoProvider(cand),
      ...checkCurrenciesPresent(cand),
      ...checkMessageTemplatePresence(cand),
      ...checkDialogPopupPresence(cand),
      ...checkMtContent(cand, { domainToBrand: buildDomainToBrand() }),
      ...checkCampaignLeakMt(cand, buildLeakyTerms(today)),
    );
  }
  findings.push(...checkCampaignLeakName(cand, buildLeakyTerms(today)), ...duplicateFindings);
  return findings.map((f) => ({ severity: f.severity || 'WARNING', check: f.check || 'auto-check', message: f.message || String(f) }));
}

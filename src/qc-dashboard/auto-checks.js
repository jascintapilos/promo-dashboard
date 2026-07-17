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

export function runAutoChecks(snapshot, { duplicateFindings = [], today = new Date() } = {}) {
  if (snapshot.notFound) {
    return [{
      severity: 'FAIL',
      check: 'code-not-found',
      field: 'promoCode',
      message: snapshot.detail || `Code ${snapshot.code} not found on ${snapshot.brand}`,
    }];
  }
  if (snapshot.error === 'BO unreachable') {
    return [{
      severity: 'FAIL',
      check: 'bo-unreachable',
      message: `BO unreachable: ${snapshot.detail || 'fetch failed'}`,
    }];
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

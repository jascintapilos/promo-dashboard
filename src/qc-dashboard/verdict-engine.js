export const REQUIRED_FIELDS = [
  'promoCode',
  'promoName',
  'promoType',
  'currency',
  'validity',
  'rewardValidity',
  'status',
];

// Terminal-state checks already carry a single root-cause finding.
// Appending required-field failures on top of these is noise.
// R19: added 'fetch-failed' — any snapshot.error now short-circuits auto-
// checks (see auto-checks.js) and this set stops verdict-engine from
// spawning "Required field X unavailable" spam on top.
const TERMINAL_CHECKS = new Set(['code-not-found', 'bo-unreachable', 'fetch-failed']);

export function unavailableRequiredFields(details = {}, required = REQUIRED_FIELDS) {
  return required.filter((field) => details[field] === 'unavailable' || details[field] == null || details[field] === '');
}

export function buildMechanics(details = {}) {
  const parts = [
    details.promoType,
    details.reward,
    details.minDeposit && `min ${details.minDeposit}`,
    details.maxBonus && `max ${details.maxBonus}`,
    details.turnover && `TO ${details.turnover}`,
    details.validity && `validity ${details.validity}`,
    details.rewardValidity && `reward ${details.rewardValidity}`,
    details.gamesProviders && `scope ${details.gamesProviders}`,
    details.inboxContent && `MT ${details.inboxContent}`,
  ].filter((v) => v && v !== 'unavailable');
  return parts.length ? parts.join(' | ') : 'Mechanics unavailable';
}

export function computeVerdict({ findings = [], details = {}, requiredFields = REQUIRED_FIELDS } = {}) {
  const mergedFindings = [...findings];
  const isTerminal = findings.some((f) => TERMINAL_CHECKS.has(f.check));
  if (!isTerminal) {
    const unavailable = unavailableRequiredFields(details, requiredFields);
    for (const field of unavailable) {
      mergedFindings.push({
        severity: 'FAIL',
        check: 'required-field-unavailable',
        field,
        message: `Required field "${field}" is unavailable`,
      });
    }
  }
  // R20: distinguish "the promo is broken" (NOT_SAFE) from "we couldn't reach
  // the BO so operator has to check manually" (MANUAL_REQUIRED). Only apply
  // the softer verdict when EVERY FAIL is a fetch-failed one; if there's a
  // real content FAIL mixed in, keep NOT_SAFE so the operator sees the true
  // problem.
  const failFindings = mergedFindings.filter((f) => f.severity === 'FAIL');
  if (failFindings.length && failFindings.every((f) => f.check === 'fetch-failed')) {
    return { verdict: 'MANUAL_REQUIRED', findings: mergedFindings };
  }
  if (failFindings.length) return { verdict: 'NOT_SAFE', findings: mergedFindings };
  if (mergedFindings.some((f) => f.severity === 'WARNING')) return { verdict: 'REVIEW', findings: mergedFindings };
  return { verdict: 'SAFE', findings: mergedFindings };
}

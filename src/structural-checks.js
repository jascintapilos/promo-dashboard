// Shared structural (listing-level) check library — the single source of
// truth for what counts as a structural finding. Used by
// bin/check-structural-health.mjs (sweep-batch caller) and
// bin/brand-watch.mjs (daily 5pm estate pass) so the two can never drift
// apart. Extracted per advisor review 2026-07-07.
//
// Every check is deliberately conservative: false alarms erode trust in the
// automated queue faster than they're worth. Checks return an array of
// { severity: 'FAIL'|'WARNING', message } — empty array means clean.
// Severity policy (advisor-reviewed):
//   FAIL    — unambiguously broken from the live record alone
//   WARNING — plausibly intentional; needs human eyes, never auto-FAIL

// Expired-but-active gets a 24h grace window so a promo that lapsed at
// midnight isn't flagged before the team's working day even starts.
const GRACE_MS = 24 * 60 * 60 * 1000;

export function parseDdmmyyyy(s) {
  const m = String(s || '').match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00`) : null;
}

// ── QPRO/QP2 — all fields come from the promotion LIST response ────────────

// The mapper's "all games" convention — a promo whose categories cover ALL
// of these is intentionally unrestricted (matches sweep-cat-gp-estate.mjs).
const MAIN_CATS = ['SPORT', 'LIVE CASINO', 'SLOTS', 'E-SPORTS', 'FISHING', 'CRASH', 'CRICKET'];

// Category-restricted promo with Game Providers left OPEN (empty = all
// providers allowed) — TO clearable on unintended games (WC_SLVR QP2C
// incident class). This is the only cat/GP direction reliable at LISTING
// level; the reverse (over-broad provider lists on restricted categories)
// needs per-promo detail fetches with catalog thresholds — that's
// bin/sweep-cat-gp-estate.mjs territory, not the daily watch. First estate
// dry-run 2026-07-07 confirmed the blunt both-or-neither rule fires ~8.7k
// times (200x the curated sweep's 45 real hits) — do not widen this again.
export function checkCategoryNoProvider(cand) {
  const cats = String(cand.category || '').split(',').map((s) => s.trim().toUpperCase()).filter((s) => s && s !== '-');
  if (!cats.length) return []; // no category restriction — providers open is fine
  if (MAIN_CATS.every((mc) => cats.includes(mc))) return []; // covers all cats = intentionally unrestricted
  const provSet = cand.gameProvider && cand.gameProvider !== '-' && cand.gameProvider !== '';
  if (!provSet) {
    return [{ severity: 'FAIL', check: 'cat-no-provider', message: `Category-restricted (${cand.category}) but Game Providers left open — all providers allowed, turnover clearable on unintended games` }];
  }
  return [];
}

// WARNING, not FAIL, and NOT part of the daily suite: the 2026-07-07 estate
// dry-run found ~8.6k active-past-valid_to promos on QPRO/QP2 — that scale
// proves stale-active is normal lifecycle there (the platform enforces
// valid_to at claim time; nobody archives lapsed promos). A daily check
// would also flag every promo the day after it naturally ends — permanent
// noise. Kept for the batch structural sweep where a human reviews output.
export function checkExpiredActiveQproQp2(cand, today = new Date()) {
  if (cand.validTo && cand.status === 1) {
    const validTo = new Date(cand.validTo);
    if (validTo.getTime() < today.getTime() - GRACE_MS) {
      return [{ severity: 'WARNING', check: 'expired-active', message: `Flagged active but valid_to (${cand.validTo}) has already passed` }];
    }
  }
  return [];
}

export function checkMessageTemplatePresence(cand) {
  if (!cand.messageTemplateCount) {
    return [{ severity: 'WARNING', check: 'mt-missing', message: 'No message template attached' }];
  }
  return [];
}

// Many estate promos legitimately have no popup — WARNING only. The signal
// this exists for is a popup DISAPPEARING post-baseline (the documented
// dialog_popup_list PUT-wipe bug), which shows up as a NEW warning.
export function checkDialogPopupPresence(cand) {
  if (!cand.dialogPopupCount) {
    return [{ severity: 'WARNING', check: 'popup-missing', message: 'No dialog popup linked' }];
  }
  return [];
}

// ── IGMP (WS1/WS2) ─────────────────────────────────────────────────────────

// WARNING and NOT part of the daily suite — same lifecycle reality as
// QPRO/QP2: the 2026-07-07 estate dry-run found ~8.3k active-past-end-date
// promos across the 6 IGMP sites (1,000-1,700 each). The platform computes
// IsExpired itself; a daily check would also flag every promo the day after
// it naturally ends. Kept for the batch structural sweep.
export function checkIgmpExpiredActive(cand, today = new Date()) {
  const end = parseDdmmyyyy(cand.endDate);
  if (end && end.getTime() < today.getTime() - GRACE_MS) {
    return [{ severity: 'WARNING', check: 'expired-active', message: `Flagged active but PromotionEndDate (${cand.endDate}) has already passed` }];
  }
  return [];
}

// Duplicate reward name among active BONUS-type promos on the same site —
// Manual Reward Assignment picks by name and can't tell two same-named
// rewards apart (the exact bug found and fixed on WS2). Scoped to
// PromotionType 'Bonus' ONLY: FC/FS campaign prize pools legitimately share
// one name across dozens of codes (2026-07-07 estate dry-run: ~7.8k dup-name
// hits, nearly all scratch-campaign pools — the WS1 bucket-2 class whose
// dedupe is deliberately on hold). Caller supplies the per-site name→count
// map (peer visibility must span the WHOLE site, not just this batch).
export function checkIgmpDuplicateName(cand, nameCountBySite) {
  if (cand.promotionType !== 'Bonus') return [];
  const count = nameCountBySite?.get(cand.siteId)?.get(cand.name) || 0;
  if (count > 1) {
    return [{ severity: 'FAIL', check: 'dup-name', message: `PromotionName "${cand.name}" shared with ${count - 1} other active Bonus promo(s) on this site — Reward Assignment dropdown can't distinguish them` }];
  }
  return [];
}

// Build the per-site active BONUS-type name counts from a fetchAllLiveCodes()
// result (same Bonus-only scope as checkIgmpDuplicateName).
export function buildIgmpNameCounts(codes) {
  const bySite = new Map();
  for (const c of codes) {
    if (c.platform !== 'igmp' || c.isExpired || c.promotionType !== 'Bonus') continue;
    if (!bySite.has(c.siteId)) bySite.set(c.siteId, new Map());
    const m = bySite.get(c.siteId);
    m.set(c.name, (m.get(c.name) || 0) + 1);
  }
  return bySite;
}

// ── Composition helpers ────────────────────────────────────────────────────

// The full listing-level suite for one candidate from fetchAllLiveCodes().
export function runListingChecks(cand, { today = new Date(), nameCountBySite } = {}) {
  if (cand.platform === 'igmp') {
    // checkIgmpExpiredActive deliberately excluded — see its comment.
    return [
      ...checkIgmpDuplicateName(cand, nameCountBySite),
    ];
  }
  // checkExpiredActiveQproQp2 deliberately excluded — see its comment.
  return [
    ...checkCategoryNoProvider(cand),
    ...checkMessageTemplatePresence(cand),
    ...checkDialogPopupPresence(cand),
  ];
}

// FAIL beats WARNING beats PASS.
export function verdictFromFindings(findings) {
  if (findings.some((f) => f.severity === 'FAIL')) return 'FAIL';
  if (findings.length) return 'WARNING';
  return 'PASS';
}

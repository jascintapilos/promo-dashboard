#!/usr/bin/env node
/**
 * Wave 5 — capped AI review layer (see docs/promo-monitoring-system-proposal.md
 * + advisor reviews 2026-07-07). Selects <=20 candidates/day across two
 * judgment lanes that code cannot resolve on its own:
 *
 *   BUNDLE   Codes with a captured original request (an answer key) due for
 *            a periodic Sentinel re-audit. Reuses the `hasBundle` output of
 *            find-qc-sweep-candidates.mjs --mode=weekly — that rotation has
 *            existed since Phase 1 but has never had a caller.
 *
 *   CONTENT  No-bundle codes carrying an open WARNING finding that needs a
 *            human-like read rather than more regex: is this seasonal-copy
 *            hit a real leak or an innocent look-alike, is this empty
 *            reward-T&C actually the documented wipe bug or just a legacy
 *            promo that never had one. Sourced from brand-watch's own state
 *            file (captures/brand-watch-state.json) so no new BO listing
 *            calls are needed to find candidates — only a live detail fetch
 *            for the handful actually selected, to hand the reviewer real
 *            content instead of a bare reason string.
 *
 * This script only SELECTS and fetches context — it makes no LLM calls
 * itself. Output is consumed by the /ai-review-sweep skill, which spawns
 * Sentinel (bundle lane) / brand-watch-reviewer (content lane), logs
 * results, and records the heartbeat.
 *
 * A rotation cursor (captures/ai-review-cursor.json) tracks last-reviewed
 * time per content-lane key so the same handful of findings aren't reviewed
 * every day while the rest of the estate never gets a turn.
 *
 * Usage:
 *   node bin/find-ai-review-candidates.mjs [--cap=20] [--stale-after=7]
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { parseArgs } from './_args.js';
import { brandToSite } from '../src/live-codes.js';
import { findPromotionByCode } from '../src/api-client.js';

const { flags } = parseArgs(process.argv.slice(2));
const cap = Number(flags.cap || 20);
const staleAfter = Number(flags['stale-after'] || 7);
const CURSOR_FILE = 'captures/ai-review-cursor.json';
const STATE_FILE = 'captures/brand-watch-state.json';

// Judgment-worthy check ids — the set Wave 4/1 checks can't self-resolve.
// mt-missing / popup-missing / dup-name / etc. are excluded: they're already
// unambiguous pass/fail from the live record, an LLM adds nothing there.
const JUDGMENT_CHECKS = new Set(['campaign-leak', 'campaign-stale-name', 'reward-tnc-wiped']);

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`AI REVIEW CANDIDATES — cap=${cap}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

// ── Lane 1: bundle-backed Sentinel re-audit ─────────────────────────────────
// Shells out to the existing weekly sweep rather than re-deriving bundle
// staleness here — single source of truth for "is this code due". Known
// cost: --mode=weekly re-runs the full ~25-list-pull estate fetch that
// brand-watch.mjs already did minutes earlier at 5pm. Accepted for now
// (read-only, off-peak, bounded); worth folding into one fetch if this
// script's runtime becomes a problem.
const bundleCap = Math.ceil(cap / 2);
let bundleAudits = [];
try {
  const out = execFileSync(process.execPath, ['bin/find-qc-sweep-candidates.mjs', '--mode=weekly', `--stale-after=${staleAfter}`, '--no-bundle-cap=1'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const sweep = JSON.parse(out);
  bundleAudits = (sweep.hasBundle || []).slice(0, bundleCap).map((c) => ({
    key: `${c.brand}::${c.code}`, brand: c.brand, code: c.code, handle: c.handle, bundleFile: c.bundleFile,
  }));
} catch (e) {
  console.error(`⚠ Lane 1 (bundle sweep) failed: ${e.message.split('\n')[0]} — proceeding with content lane only`);
}
console.log(`Lane 1 (bundle-backed Sentinel re-audit): ${bundleAudits.length} selected (cap ${bundleCap})`);

// ── Lane 2: content-judgment review ─────────────────────────────────────────
const contentCap = cap - bundleAudits.length;
const state = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : { entries: {}, detailEntries: {} };
const cursor = existsSync(CURSOR_FILE) ? JSON.parse(readFileSync(CURSOR_FILE, 'utf8')) : {};

const openJudgmentFindings = [];
for (const [ns, entries] of [['listing', state.entries || {}], ['detail', state.detailEntries || {}]]) {
  for (const [key, e] of Object.entries(entries)) {
    if (e.verdict !== 'WARNING' || e.held) continue;
    // checks is only present on state written after this field was added
    // (see brand-watch.mjs) — entries from before that upgrade fall back to
    // reason-text sniffing until the next brand-watch run refreshes them.
    const isJudgment = Array.isArray(e.checks)
      ? e.checks.some((c) => JUDGMENT_CHECKS.has(c))
      : e.reasons?.some((r) => /but .+ ended/.test(r) || /reward T&C contents empty/.test(r));
    if (!isJudgment) continue;
    openJudgmentFindings.push({ key, ns, verdict: e.verdict, reasons: e.reasons, lastReviewed: cursor[key] || '' });
  }
}
openJudgmentFindings.sort((a, b) => a.lastReviewed.localeCompare(b.lastReviewed)); // never-reviewed ('') first, then oldest
const selected = openJudgmentFindings.slice(0, contentCap);

console.log(`Lane 2 (content judgment): ${selected.length} selected of ${openJudgmentFindings.length} open judgment-worthy WARNING(s) (cap ${contentCap})`);

const contentReviews = [];
for (const { key, reasons } of selected) {
  const [brand, code] = key.split('::');
  const site = brandToSite(brand);
  if (!site) { console.log(`  ⚠ ${key}: no site mapping — skipped`); continue; }
  try {
    const p = await findPromotionByCode(site.siteId, code, { merchantId: site.merchantId });
    if (!p) { console.log(`  ⚠ ${key}: code not found live (deactivated/renamed since flagged?) — skipped`); continue; }
    contentReviews.push({
      key, brand, code, siteId: site.siteId, platform: site.platform,
      findingReasons: reasons,
      name: p.name || p.PromotionName,
      validFrom: p.valid_from, validTo: p.valid_to,
      messageTemplates: (p.message_templates || []).map((t) => ({ locale: t.settings_locale_id, subject: t.subject, message: t.message })),
    });
  } catch (e) {
    console.log(`  ⚠ ${key}: fetch failed — ${e.message.split('\n')[0]}`);
  }
}

mkdirSync('captures', { recursive: true });
writeFileSync('captures/ai-review-candidates.json', JSON.stringify({
  generatedAt: new Date().toISOString(), cap, bundleAudits, contentReviews,
}, null, 2));
console.log(`\n✓ Wrote captures/ai-review-candidates.json (${bundleAudits.length} bundle + ${contentReviews.length} content = ${bundleAudits.length + contentReviews.length} total)`);
if (!bundleAudits.length && !contentReviews.length) console.log('  Nothing to review today — /ai-review-sweep should record a clean heartbeat and skip agent spawns.');

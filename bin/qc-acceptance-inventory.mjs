#!/usr/bin/env node
// Read-only acceptance-candidate inventory.
//
// Builds, automatically, the list of promotions that can serve as acceptance
// fixtures for each of the 27 configured brands. Answers the question
// "which brands can we prove automatic PASS/FAIL on, and which have no
// approved-source fixture yet?" without anyone hand-listing promo codes.
//
// Sources, in the same precedence the live expected-source resolver uses:
//   1. captures/qc-bundles/<handle>__<brand>.json   (post-save, has live_state)
//   2. captures/requests/<handle>.json              (approved request record)
// A Sheets fallback is deliberately NOT invoked here: this script is an
// offline inventory over what the VDI already holds. Sheet-backed resolution
// is a separate runtime concern (see expected-source.js) so that a read of
// the tracker never becomes a prerequisite for taking inventory.
//
// STRICTLY READ-ONLY: opens no network connection, touches no BO, writes only
// the report file it is asked to write.
//
// Circularity guard (operator rule): a candidate is only valid when an
// APPROVED REQUEST supplies the expected values. A bundle's `live_state` is
// never used to manufacture its own expectations — that would make QC
// self-confirming. Bundles qualify only because they embed a `source` block,
// which is the approved request; we assert that block exists.
//
// Usage:
//   node bin/qc-acceptance-inventory.mjs
//   node bin/qc-acceptance-inventory.mjs --json=tmp/acceptance-inventory.json

import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { loadQcBrandConfig } from '../src/qc-dashboard/brand-config.js';
import { brandToSite } from '../src/live-codes.js';

const BUNDLES_DIR = process.env.QC_BUNDLES_DIR || 'captures/qc-bundles';
const REQUESTS_DIR = process.env.QC_REQUESTS_DIR || 'captures/requests';

export const COVERAGE = Object.freeze({
  HAS_BUNDLE: 'HAS_BUNDLE',                       // approved source + live_state
  HAS_REQUEST_ONLY: 'HAS_REQUEST_ONLY',           // approved source, no post-save snapshot
  NO_APPROVED_SOURCE_FIXTURE: 'NO_APPROVED_SOURCE_FIXTURE',
});

function safeJson(p) {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

// Bonus-type bucket so we can report Deposit / FC / FS coverage per brand.
export function bonusBucket(raw) {
  const s = String(raw || '').toUpperCase().replace(/[\s_-]+/g, ' ');
  if (/^FREE CREDIT|^FREECREDIT/.test(s)) return 'FREE_CREDIT';
  if (/^FREE SPIN|^FREESPIN/.test(s)) return 'FREE_SPIN';
  if (/^DEPOSIT|^BONUS$|^RELOAD/.test(s)) return 'DEPOSIT';
  return 'OTHER';
}

export function buildInventory({ bundlesDir = BUNDLES_DIR, requestsDir = REQUESTS_DIR } = {}) {
  const brands = loadQcBrandConfig();
  const perBrand = new Map();
  for (const b of brands) {
    perBrand.set(b.id, {
      brand: b.id,
      // loadQcBrandConfig() does not attach runtime (buildBrandList() does),
      // so resolve the platform directly from the shared brand->site map.
      platform: brandToSite(b.id)?.platform || null,
      mvp: b.qcRules?.mvp === true,
      enabled: b.enabled === true,
      candidates: [],
      byBonusType: { DEPOSIT: 0, FREE_CREDIT: 0, FREE_SPIN: 0, OTHER: 0 },
      coverage: COVERAGE.NO_APPROVED_SOURCE_FIXTURE,
    });
  }

  // ── bundles: strongest candidates (approved source + a live snapshot) ──
  if (existsSync(bundlesDir)) {
    for (const f of readdirSync(bundlesDir)) {
      if (!f.endsWith('.json')) continue;
      const b = safeJson(path.join(bundlesDir, f));
      if (!b?.brand || !b?.promo_code) continue;
      const entry = perBrand.get(b.brand);
      if (!entry) continue;                       // brand not in the config
      // Circularity guard: without a `source` block there is no approved
      // expectation, only BO state. Such a bundle cannot serve as a fixture.
      if (!b.source || typeof b.source !== 'object') continue;
      const handle = f.replace(/\.json$/, '').split('__').slice(0, -1).join('__') || b.handle || null;
      const bucket = bonusBucket(b.source.bonus_type);
      entry.candidates.push({
        promoCode: b.promo_code,
        handle,
        bonusType: b.source.bonus_type || null,
        bonusBucket: bucket,
        sourceType: 'bundle',
        hasLiveState: !!b.live_state,
        savedAt: b.saved_at || b.persisted_at || null,
      });
      entry.byBonusType[bucket] = (entry.byBonusType[bucket] || 0) + 1;
    }
  }

  // ── requests: fallback candidates (approved source, no snapshot yet) ───
  if (existsSync(requestsDir)) {
    for (const f of readdirSync(requestsDir)) {
      if (!f.endsWith('.json')) continue;
      const r = safeJson(path.join(requestsDir, f));
      if (!r?.promo_code) continue;
      const targets = Array.isArray(r.brands) ? r.brands : [];
      const handle = f.replace(/\.json$/, '');
      const bucket = bonusBucket(r.bonus_type);
      for (const brand of targets) {
        const entry = perBrand.get(brand);
        if (!entry) continue;
        // Skip when a bundle already covers this exact (brand, code) — the
        // bundle is the stronger fixture.
        if (entry.candidates.some((c) => c.promoCode === r.promo_code && c.sourceType === 'bundle')) continue;
        entry.candidates.push({
          promoCode: r.promo_code,
          handle,
          bonusType: r.bonus_type || null,
          bonusBucket: bucket,
          sourceType: 'request',
          hasLiveState: false,
          savedAt: null,
        });
        entry.byBonusType[bucket] = (entry.byBonusType[bucket] || 0) + 1;
      }
    }
  }

  // ── classify coverage ─────────────────────────────────────────────────
  for (const entry of perBrand.values()) {
    if (entry.candidates.some((c) => c.sourceType === 'bundle')) entry.coverage = COVERAGE.HAS_BUNDLE;
    else if (entry.candidates.length > 0) entry.coverage = COVERAGE.HAS_REQUEST_ONLY;
    else entry.coverage = COVERAGE.NO_APPROVED_SOURCE_FIXTURE;
    // Deterministic: newest bundle first, then by code.
    entry.candidates.sort((a, b) => (
      (b.savedAt || '').localeCompare(a.savedAt || '') || a.promoCode.localeCompare(b.promoCode)
    ));
  }

  const rows = [...perBrand.values()];
  const summary = {
    totalBrands: rows.length,
    withBundle: rows.filter((r) => r.coverage === COVERAGE.HAS_BUNDLE).length,
    requestOnly: rows.filter((r) => r.coverage === COVERAGE.HAS_REQUEST_ONLY).length,
    noFixture: rows.filter((r) => r.coverage === COVERAGE.NO_APPROVED_SOURCE_FIXTURE).length,
    platformFamilies: {
      qpro: rows.filter((r) => r.platform === 'qpro' && r.coverage !== COVERAGE.NO_APPROVED_SOURCE_FIXTURE).length,
      qp2: rows.filter((r) => r.platform === 'qp2' && r.coverage !== COVERAGE.NO_APPROVED_SOURCE_FIXTURE).length,
      igmp: rows.filter((r) => r.platform === 'igmp' && r.coverage !== COVERAGE.NO_APPROVED_SOURCE_FIXTURE).length,
    },
  };
  return { rows, summary };
}

// ── CLI ─────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const jsonOut = args.find((a) => a.startsWith('--json='))?.split('=')[1] || null;
  const { rows, summary } = buildInventory();

  const pad = (s, n) => String(s ?? '').padEnd(n);
  console.log('');
  console.log('BO acceptance-candidate inventory (read-only, offline)');
  console.log('='.repeat(96));
  console.log(pad('BRAND', 10) + pad('PLATFORM', 10) + pad('MVP', 5) + pad('COVERAGE', 28) + pad('CAND', 6) + 'DEP/FC/FS');
  console.log('-'.repeat(96));
  for (const r of rows) {
    const bt = `${r.byBonusType.DEPOSIT}/${r.byBonusType.FREE_CREDIT}/${r.byBonusType.FREE_SPIN}`;
    console.log(
      pad(r.brand, 10) + pad(r.platform, 10) + pad(r.mvp ? 'yes' : '-', 5)
      + pad(r.coverage, 28) + pad(r.candidates.length, 6) + bt,
    );
  }
  console.log('-'.repeat(96));
  console.log(`brands: ${summary.totalBrands} | with bundle: ${summary.withBundle} | request-only: ${summary.requestOnly} | NO_APPROVED_SOURCE_FIXTURE: ${summary.noFixture}`);
  console.log(`covered per family — qpro: ${summary.platformFamilies.qpro} | qp2: ${summary.platformFamilies.qp2} | igmp: ${summary.platformFamilies.igmp}`);
  console.log('');

  const noFix = rows.filter((r) => r.coverage === COVERAGE.NO_APPROVED_SOURCE_FIXTURE);
  if (noFix.length) {
    console.log('NO_APPROVED_SOURCE_FIXTURE (collector still gets a connectivity/evidence test; NOT a collector fault):');
    for (const r of noFix) console.log(`  · ${r.brand} (${r.platform})`);
    console.log('');
  }

  // Suggested acceptance picks: newest bundle per brand, one per bonus bucket.
  console.log('Suggested acceptance fixtures (newest bundle per brand per bonus type):');
  for (const r of rows) {
    if (r.coverage === COVERAGE.NO_APPROVED_SOURCE_FIXTURE) continue;
    const picks = [];
    for (const bucket of ['DEPOSIT', 'FREE_CREDIT', 'FREE_SPIN']) {
      const hit = r.candidates.find((c) => c.bonusBucket === bucket && c.sourceType === 'bundle')
        || r.candidates.find((c) => c.bonusBucket === bucket);
      if (hit) picks.push(`${bucket}: ${hit.promoCode} (${hit.handle})`);
    }
    if (picks.length) console.log(`  ${pad(r.brand, 9)} ${picks.join(' | ')}`);
  }
  console.log('');

  if (jsonOut) {
    mkdirSync(path.dirname(jsonOut), { recursive: true });
    writeFileSync(jsonOut, `${JSON.stringify({ generatedAt: new Date().toISOString(), summary, rows }, null, 2)}\n`, 'utf8');
    console.log(`report written → ${jsonOut}`);
  }
}

const isCli = import.meta.url.endsWith(process.argv[1]?.replace(/\\/g, '/') || '');
if (isCli) main();

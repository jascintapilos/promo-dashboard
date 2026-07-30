// Increment 3 (real-QC upgrade): tests for src/qc-dashboard/expected-source.js
//
// Every test writes its own tmp captures/ layout and points QC_REQUESTS_DIR
// + QC_BUNDLES_DIR at it via env vars, then dynamic-imports the module so
// the fresh env is picked up. Never touches the real captures/ directory.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function mkFixture(name) {
  const tmp = path.join(os.tmpdir(), `expected-source-${name}-${Date.now()}`);
  const reqDir = path.join(tmp, 'requests');
  const bundleDir = path.join(tmp, 'bundles');
  mkdirSync(reqDir, { recursive: true });
  mkdirSync(bundleDir, { recursive: true });
  return { tmp, reqDir, bundleDir };
}

async function importFresh() {
  const modUrl = new URL(`../src/qc-dashboard/expected-source.js?t=${Date.now()}${Math.random()}`, import.meta.url);
  return await import(modUrl.href);
}

function writeRequest(dir, handle, { promoCode, brands, status = 'Approved' }) {
  writeFileSync(path.join(dir, `${handle}.json`), JSON.stringify({
    request_id: `REQ-${handle}`, handle, promo_code: promoCode, brands, status,
    date: '15 May 2026',
    parsed: { min_deposit: 30, to_multiplier: 5 },
  }, null, 2));
}
function writeBundle(dir, handle, brand, { promoCode, source, liveState = null, savedAt = '2026-07-01T00:00:00.000Z' }) {
  writeFileSync(path.join(dir, `${handle}__${brand}.json`), JSON.stringify({
    handle, brand, promo_code: promoCode, saved_at: savedAt,
    source, live_state: liveState,
  }, null, 2));
}

test('Increment 3: resolves by exact handle — bundle preferred over request', async () => {
  const fx = mkFixture('handle-bundle-first');
  writeRequest(fx.reqDir, 'P100', { promoCode: 'CODE_A', brands: ['QP2A'] });
  writeBundle(fx.bundleDir, 'P100', 'QP2A', { promoCode: 'CODE_A', source: { promo_code: 'CODE_A', bonus_type: 'Deposit', parsed: { min_deposit: 30, to_multiplier: 5 } } });
  try {
    process.env.QC_REQUESTS_DIR = fx.reqDir;
    process.env.QC_BUNDLES_DIR = fx.bundleDir;
    const { resolveExpectedSource, _clearExpectedSourceCache } = await importFresh();
    _clearExpectedSourceCache();
    const r = resolveExpectedSource({ brand: 'QP2A', code: 'CODE_A', handle: 'P100' });
    assert.equal(r.sourceType, 'bundle');
    assert.equal(r.sourceId, 'bundle:P100::QP2A');
    assert.equal(r.handle, 'P100');
    assert.equal(r.promoCode, 'CODE_A');
    assert.equal(r.source.promo_code, 'CODE_A');
  } finally {
    rmSync(fx.tmp, { recursive: true, force: true });
    delete process.env.QC_REQUESTS_DIR; delete process.env.QC_BUNDLES_DIR;
  }
});

test('Increment 3: resolves by exact handle — request when no bundle exists', async () => {
  const fx = mkFixture('handle-request-only');
  writeRequest(fx.reqDir, 'P101', { promoCode: 'CODE_B', brands: ['QPRO1'] });
  try {
    process.env.QC_REQUESTS_DIR = fx.reqDir;
    process.env.QC_BUNDLES_DIR = fx.bundleDir;
    const { resolveExpectedSource, _clearExpectedSourceCache } = await importFresh();
    _clearExpectedSourceCache();
    const r = resolveExpectedSource({ brand: 'QPRO1', code: 'CODE_B', handle: 'P101' });
    assert.equal(r.sourceType, 'request');
    assert.equal(r.sourceId, 'request:P101');
    assert.equal(r.promoCode, 'CODE_B');
  } finally {
    rmSync(fx.tmp, { recursive: true, force: true });
    delete process.env.QC_REQUESTS_DIR; delete process.env.QC_BUNDLES_DIR;
  }
});

test('Increment 3: resolves by exact promo_code + brand match — bundle wins over request', async () => {
  const fx = mkFixture('code-brand-bundle-wins');
  writeRequest(fx.reqDir, 'P200', { promoCode: 'DUAL_CODE', brands: ['QP2A'] });
  writeBundle(fx.bundleDir, 'P200', 'QP2A', { promoCode: 'DUAL_CODE', source: { promo_code: 'DUAL_CODE' } });
  try {
    process.env.QC_REQUESTS_DIR = fx.reqDir;
    process.env.QC_BUNDLES_DIR = fx.bundleDir;
    const { resolveExpectedSource, _clearExpectedSourceCache } = await importFresh();
    _clearExpectedSourceCache();
    const r = resolveExpectedSource({ brand: 'QP2A', code: 'DUAL_CODE' });
    assert.equal(r.sourceType, 'bundle');
  } finally {
    rmSync(fx.tmp, { recursive: true, force: true });
    delete process.env.QC_REQUESTS_DIR; delete process.env.QC_BUNDLES_DIR;
  }
});

test('Increment 3: ambiguous when two DIFFERENT handles share the same (brand, code)', async () => {
  const fx = mkFixture('ambiguous');
  writeRequest(fx.reqDir, 'P300a', { promoCode: 'DUP_CODE', brands: ['QP2A'] });
  writeBundle(fx.bundleDir, 'P300b', 'QP2A', { promoCode: 'DUP_CODE', source: { promo_code: 'DUP_CODE' } });
  try {
    process.env.QC_REQUESTS_DIR = fx.reqDir;
    process.env.QC_BUNDLES_DIR = fx.bundleDir;
    const { resolveExpectedSource, _clearExpectedSourceCache } = await importFresh();
    _clearExpectedSourceCache();
    const r = resolveExpectedSource({ brand: 'QP2A', code: 'DUP_CODE' });
    assert.equal(r.sourceType, 'ambiguous');
    assert.equal(r.matches.length, 2);
    // Must NEVER guess a winner — the caller (compare engine) turns this
    // into MANUAL_REQUIRED per the "no guessing" rule.
  } finally {
    rmSync(fx.tmp, { recursive: true, force: true });
    delete process.env.QC_REQUESTS_DIR; delete process.env.QC_BUNDLES_DIR;
  }
});

test('Increment 3: not-found when no request or bundle matches (brand, code)', async () => {
  const fx = mkFixture('not-found');
  try {
    process.env.QC_REQUESTS_DIR = fx.reqDir;
    process.env.QC_BUNDLES_DIR = fx.bundleDir;
    const { resolveExpectedSource, _clearExpectedSourceCache } = await importFresh();
    _clearExpectedSourceCache();
    const r = resolveExpectedSource({ brand: 'QP2A', code: 'MISSING' });
    assert.equal(r.sourceType, 'not-found');
    assert.match(r.reason, /no exact-match/);
  } finally {
    rmSync(fx.tmp, { recursive: true, force: true });
    delete process.env.QC_REQUESTS_DIR; delete process.env.QC_BUNDLES_DIR;
  }
});

test('Increment 3: handle mismatch (brand not in request.brands) returns not-found', async () => {
  const fx = mkFixture('handle-brand-mismatch');
  writeRequest(fx.reqDir, 'P400', { promoCode: 'CODE_X', brands: ['QP2A'] }); // NOT QPRO1
  try {
    process.env.QC_REQUESTS_DIR = fx.reqDir;
    process.env.QC_BUNDLES_DIR = fx.bundleDir;
    const { resolveExpectedSource, _clearExpectedSourceCache } = await importFresh();
    _clearExpectedSourceCache();
    const r = resolveExpectedSource({ brand: 'QPRO1', code: 'CODE_X', handle: 'P400' });
    assert.equal(r.sourceType, 'not-found');
  } finally {
    rmSync(fx.tmp, { recursive: true, force: true });
    delete process.env.QC_REQUESTS_DIR; delete process.env.QC_BUNDLES_DIR;
  }
});

test('Increment 3: safety net — resolved source.promo_code MUST match requested code', async () => {
  const fx = mkFixture('code-mismatch');
  // Contrive an inconsistency: bundle file named for CODE_X but source claims CODE_Y
  writeBundle(fx.bundleDir, 'P500', 'QP2A', { promoCode: 'CODE_X', source: { promo_code: 'CODE_Y' } });
  try {
    process.env.QC_REQUESTS_DIR = fx.reqDir;
    process.env.QC_BUNDLES_DIR = fx.bundleDir;
    const { resolveExpectedSource, _clearExpectedSourceCache } = await importFresh();
    _clearExpectedSourceCache();
    const r = resolveExpectedSource({ brand: 'QP2A', code: 'CODE_X', handle: 'P500' });
    assert.equal(r.sourceType, 'not-found');
    assert.match(r.reason, /does not match requested/);
  } finally {
    rmSync(fx.tmp, { recursive: true, force: true });
    delete process.env.QC_REQUESTS_DIR; delete process.env.QC_BUNDLES_DIR;
  }
});

test('Increment 3: invalid input — missing brand or missing code+handle returns invalid', async () => {
  const { resolveExpectedSource } = await importFresh();
  assert.equal(resolveExpectedSource({ brand: null, code: 'x' }).sourceType, 'invalid');
  assert.equal(resolveExpectedSource({ brand: 'QP2A' }).sourceType, 'invalid');
});

test('Increment 3: never returns absolute filesystem paths in payload', async () => {
  const fx = mkFixture('no-path-leak');
  writeRequest(fx.reqDir, 'P600', { promoCode: 'CODE_Z', brands: ['QP2A'] });
  try {
    process.env.QC_REQUESTS_DIR = fx.reqDir;
    process.env.QC_BUNDLES_DIR = fx.bundleDir;
    const { resolveExpectedSource, _clearExpectedSourceCache } = await importFresh();
    _clearExpectedSourceCache();
    const r = resolveExpectedSource({ brand: 'QP2A', code: 'CODE_Z', handle: 'P600' });
    assert.equal(r.sourcePath, null, 'sourcePath must be null — never expose absolute filesystem paths');
    const json = JSON.stringify(r);
    // The tmp dir contains 'expected-source-no-path-leak' — must NOT appear in output
    assert.equal(json.includes(fx.tmp), false, 'no absolute path substring may appear anywhere in the payload');
  } finally {
    rmSync(fx.tmp, { recursive: true, force: true });
    delete process.env.QC_REQUESTS_DIR; delete process.env.QC_BUNDLES_DIR;
  }
});

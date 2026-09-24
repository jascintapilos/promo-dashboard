#!/usr/bin/env node
// Isolation invariants for the walled promo report (docs/plans/promo-gate.md):
//  - /promo/<brand> and /api/promo/<brand>/... resolve to a brand and are recognised as
//    promo paths (so they dispatch BEFORE the qc-host routing / role-gate),
//  - the `promo-report` role is valid but DENIED the QC Hub / Ops Dashboard.
// Pure/unit — no server, no network. Full route behaviour is verified against a running
// server (AUTH_MODE=dev) before deploy.
//
// Run with: node --test test/qc-dashboard-promo-host.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promoBrandFromPath, isPromoPath } from '../src/qc-dashboard/promo.js';

process.env.AUTH_MODE = process.env.AUTH_MODE || 'dev';
const { REPORT_ONLY_ROLES } = await import('../src/qc-dashboard/auth.js');

test('promo paths resolve to their brand id', () => {
  assert.equal(promoBrandFromPath('/promo/ws1'), 'ws1');
  assert.equal(promoBrandFromPath('/promo/ws1/'), 'ws1');
  assert.equal(promoBrandFromPath('/promo/brandx'), 'brandx');
  assert.equal(promoBrandFromPath('/api/promo/ws1/MY/FT_X.json'), 'ws1');
});

test('non-promo paths are not promo (and yield no brand)', () => {
  for (const p of ['/', '/dashboard', '/api/run-qc', '/qc-hub', '/api/history']) {
    assert.equal(isPromoPath(p), false, p);
    assert.equal(promoBrandFromPath(p), null, p);
  }
});

test('promo paths are recognised so they dispatch before the qc-host routing', () => {
  for (const p of ['/promo', '/promo/ws1', '/promo-assets/logo.png', '/api/promo/ws1/MY/x.json']) {
    assert.equal(isPromoPath(p), true, p);
  }
});

test('only promo-report is report-only (denied the QC Hub/Ops); every pre-existing role keeps access', () => {
  assert.equal(REPORT_ONLY_ROLES instanceof Set, true);
  assert.equal(REPORT_ONLY_ROLES.has('promo-report'), true);
  // denylist, not whitelist: no pre-existing role is affected (incl. guest).
  for (const r of ['admin', 'promo-team', 'hod-view', 'guest']) assert.equal(REPORT_ONLY_ROLES.has(r), false);
});

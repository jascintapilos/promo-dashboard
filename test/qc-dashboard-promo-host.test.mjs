#!/usr/bin/env node
// Isolation invariants for the walled promo host (docs/plans/promo-gate.md):
//  - the promo subdomain resolves to a brand; the qc-dashboard host does not,
//  - the `promo-report` role is a valid role but is DENIED the QC Hub / Ops Dashboard.
// Pure/unit — no server, no network. Full route behaviour is verified against a
// running server (AUTH_MODE=dev) before deploy.
//
// Run with: node --test test/qc-dashboard-promo-host.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promoBrandFromHost } from '../src/qc-dashboard/promo.js';

// auth.js requires GOOGLE_CLIENT_ID/allowlist at import-time only via
// validateProductionConfig() (not on import); role sets are static exports.
process.env.AUTH_MODE = process.env.AUTH_MODE || 'dev';
const { REPORT_ONLY_ROLES } = await import('../src/qc-dashboard/auth.js');

const req = (host) => ({ headers: host === undefined ? {} : { host } });

test('promo subdomain resolves to its brand id', () => {
  assert.equal(promoBrandFromHost(req('ws1.promo.zoom66.xyz')), 'ws1');
  assert.equal(promoBrandFromHost(req('ws1.promo.zoom66.xyz:443')), 'ws1');
  assert.equal(promoBrandFromHost(req('brandx.promo.zoom66.xyz')), 'brandx');
  assert.equal(promoBrandFromHost(req('WS1.PROMO.ZOOM66.XYZ')), 'ws1'); // case-insensitive
});

test('the qc-dashboard host and unrelated hosts are NOT promo hosts', () => {
  assert.equal(promoBrandFromHost(req('qc-dashboard.zoom66.xyz')), null);
  assert.equal(promoBrandFromHost(req('zoom66.xyz')), null);
  assert.equal(promoBrandFromHost(req('promo.zoom66.xyz')), null); // bare suffix → empty label → null
  assert.equal(promoBrandFromHost(req(undefined)), null);
});

test('a malformed subdomain label is rejected (no brand)', () => {
  assert.equal(promoBrandFromHost(req('a b.promo.zoom66.xyz')), null);
  assert.equal(promoBrandFromHost(req('../etc.promo.zoom66.xyz')), null);
});

test('only promo-report is report-only (denied the QC Hub/Ops); every pre-existing role keeps access', () => {
  assert.equal(REPORT_ONLY_ROLES instanceof Set, true);
  // the new role is the ONLY one refused the QC apps.
  assert.equal(REPORT_ONLY_ROLES.has('promo-report'), true);
  // denylist, not whitelist: no pre-existing role is affected (incl. guest).
  for (const r of ['admin', 'promo-team', 'hod-view', 'guest']) assert.equal(REPORT_ONLY_ROLES.has(r), false);
});

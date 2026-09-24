#!/usr/bin/env node
// Manage Users — overlay merge + guardrails (self-service allowlist editing).
// The overlay is server-local (gitignored) so UI edits persist across deploys that
// rewrite the git-tracked base. These are pure/unit tests against temp files —
// ADMITTED_USERS_PATH + ADMITTED_OVERLAY_PATH point auth.js at throwaway fixtures.
//
// Run with: node --test test/qc-dashboard-admin-users.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'admusers-'));
const BASE = join(dir, 'admitted-users.json');
const OVERLAY = join(dir, 'admitted-users.overlay.json');
writeFileSync(BASE, JSON.stringify({ users: [
  { email: 'boss@x.co', role: 'admin' },
  { email: 'ada@x.co', role: 'promo-team' },
  { email: 'gus@x.co', role: 'promo-team' },
] }, null, 2));

process.env.ADMITTED_USERS_PATH = BASE;
process.env.ADMITTED_OVERLAY_PATH = OVERLAY;
delete process.env.AUTH_MODE; // exercise the real file-backed path, not the dev user

const { loadAdmittedUsers, upsertAdmittedUser, removeAdmittedUser } = await import('../src/qc-dashboard/auth.js');

const reset = () => { if (existsSync(OVERLAY)) rmSync(OVERLAY); };
const roleOf = (list, e) => (list.find((u) => u.email === e) || {}).role;

test('base loads with no overlay', () => {
  reset();
  const u = loadAdmittedUsers();
  assert.equal(u.length, 3);
  assert.equal(roleOf(u, 'boss@x.co'), 'admin');
});

test('upsert adds a report-only viewer; lowercased; persists to overlay + survives reload', () => {
  reset();
  upsertAdmittedUser({ email: 'YG@Seahub.com', role: 'promo-report', actingEmail: 'boss@x.co' });
  assert.equal(roleOf(loadAdmittedUsers(), 'yg@seahub.com'), 'promo-report');
  assert.ok(existsSync(OVERLAY), 'overlay file written');
});

test('upsert overrides a base user role via the overlay', () => {
  reset();
  upsertAdmittedUser({ email: 'ada@x.co', role: 'admin', actingEmail: 'boss@x.co' });
  assert.equal(roleOf(loadAdmittedUsers(), 'ada@x.co'), 'admin');
});

test('remove tombstones a base user', () => {
  reset();
  removeAdmittedUser({ email: 'gus@x.co', actingEmail: 'boss@x.co' });
  assert.equal(loadAdmittedUsers().some((u) => u.email === 'gus@x.co'), false);
});

test('guardrail: cannot remove the last admin', () => {
  reset();
  assert.throws(() => removeAdmittedUser({ email: 'boss@x.co', actingEmail: 'ada@x.co' }), /last admin/i);
});

test('guardrail: cannot remove your own account', () => {
  reset();
  assert.throws(() => removeAdmittedUser({ email: 'boss@x.co', actingEmail: 'boss@x.co' }), /your own account/i);
});

test('guardrail: cannot demote your own admin role', () => {
  reset();
  assert.throws(() => upsertAdmittedUser({ email: 'boss@x.co', role: 'promo-team', actingEmail: 'boss@x.co' }), /your own admin role/i);
});

test('guardrail: invalid role rejected', () => {
  reset();
  assert.throws(() => upsertAdmittedUser({ email: 'x@y.co', role: 'superuser', actingEmail: 'boss@x.co' }), /invalid role/i);
});

test('guardrail: invalid email rejected', () => {
  reset();
  assert.throws(() => upsertAdmittedUser({ email: 'not-an-email', role: 'guest', actingEmail: 'boss@x.co' }), /valid email/i);
});

test('malformed overlay is ignored, never throws (auth stays up)', () => {
  reset();
  writeFileSync(OVERLAY, '{ this is not json');
  assert.equal(loadAdmittedUsers().length, 3);
});

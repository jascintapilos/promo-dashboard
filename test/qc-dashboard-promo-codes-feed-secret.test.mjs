// Promo Codes feed key — store, separation guard, uploader reader.
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readEffectiveFeedSecret, readFeedStatus, rotateFeedSecret, readUploaderFeedSecret } from '../src/qc-dashboard/promo-codes-feed-secret.js';

const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'pc-feed-'));

test('not configured until rotated; rotate returns the key once and status never carries it', () => {
  const dir = tmp();
  const file = path.join(dir, 'feed.local.json');
  try {
    assert.equal(readEffectiveFeedSecret({ env: {}, file }), null);
    assert.equal(readFeedStatus({ env: {}, file }).configured, false);
    const r = rotateFeedSecret({ actorEmail: 'boss@x.co', env: {}, file });
    assert.match(r.secret, /^[0-9a-f]{64}$/);
    assert.equal(readEffectiveFeedSecret({ env: {}, file }), r.secret);
    const st = readFeedStatus({ env: {}, file });
    assert.equal(st.configured, true);
    assert.equal(st.lastRotatedBy, 'boss@x.co');
    assert.ok(!JSON.stringify(st).includes(r.secret));
    // Rotating again replaces the key — the old one is gone.
    const r2 = rotateFeedSecret({ actorEmail: 'boss@x.co', env: {}, file });
    assert.notEqual(r2.secret, r.secret);
    assert.equal(readEffectiveFeedSecret({ env: {}, file }), r2.secret);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('env override wins and blocks rotate (EXTERNALLY_MANAGED)', () => {
  const env = { PROMO_CODES_FEED_SECRET: 'e'.repeat(64) };
  const dir = tmp();
  try {
    assert.equal(readEffectiveFeedSecret({ env, file: path.join(dir, 'x.json') }), 'e'.repeat(64));
    assert.throws(() => rotateFeedSecret({ actorEmail: 'a@x.co', env, file: path.join(dir, 'x.json') }), (e) => e.code === 'EXTERNALLY_MANAGED');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a feed key equal to the QC relay secret fails closed', () => {
  const same = 's'.repeat(64);
  const env = { RELAY_SECRET: same, PROMO_CODES_FEED_SECRET: same };
  assert.equal(readEffectiveFeedSecret({ env }), null);
  const st = readFeedStatus({ env });
  assert.equal(st.configured, false);
  assert.match(st.problem, /QC relay secret/);
});

test('short or malformed key files read as not configured', () => {
  const dir = tmp();
  const file = path.join(dir, 'feed.local.json');
  try {
    writeFileSync(file, JSON.stringify({ secret: 'short' })); // nosecret — deliberately too-short test value
    assert.equal(readEffectiveFeedSecret({ env: {}, file }), null);
    writeFileSync(file, '{ nope');
    assert.equal(readEffectiveFeedSecret({ env: {}, file }), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('uploader reads ONLY its own file — never the QC relay-secret file', () => {
  const home = tmp();
  try {
    mkdirSync(path.join(home, '.qc-relay'));
    writeFileSync(path.join(home, '.qc-relay', 'relay-secret'), 'r'.repeat(64));
    const none = readUploaderFeedSecret({ env: {}, home });
    assert.equal(none.present, false);
    assert.ok(!String(none.reason).includes('r'.repeat(64)));
    writeFileSync(path.join(home, '.qc-relay', 'promo-codes-secret'), `${'f'.repeat(64)}\n`);
    assert.deepEqual(readUploaderFeedSecret({ env: {}, home }), { present: true, secret: 'f'.repeat(64), reason: null });
    assert.equal(readUploaderFeedSecret({ env: { PROMO_CODES_FEED_SECRET: 'short' }, home }).present, false); // nosecret — deliberately too-short test value
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('uploader script never references the QC relay key', () => {
  const src = readFileSync('bin/push-promo-codes.mjs', 'utf8');
  assert.ok(!/readWorkerRelaySecret|relay-secret['"\s/]|RELAY_SECRET|\/api\/relay\//.test(src), 'push-promo-codes.mjs must not use the QC relay key or relay routes');
  assert.match(src, /readUploaderFeedSecret/);
  assert.match(src, /\/api\/promo-codes\/snapshot/);
});

test('the feed key file is gitignored', () => {
  assert.ok(existsSync('.gitignore'));
  assert.match(readFileSync('.gitignore', 'utf8'), /^\*\.local\.json$/m);
});

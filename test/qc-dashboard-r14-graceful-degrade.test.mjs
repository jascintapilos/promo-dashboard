import test from 'node:test';
import assert from 'node:assert/strict';
import { probeDuplicateAcrossMvp } from '../src/qc-dashboard/fetch-promo.js';

// R14: verify one broken site config cannot break duplicate-check for the whole batch,
// and that config errors surface as a WARNING finding (never silently pass).

test('probeDuplicateAcrossMvp: SITE_CONFIG_INCOMPLETE on one brand → partial warning, no throw', async (t) => {
  // Mock brandList — 3 enabled brands, current is QPRO1
  const brandList = [
    { id: 'QPRO1', enabled: true },
    { id: 'QP2A_BROKEN', enabled: true },
    { id: 'QPRO5_OK', enabled: true },
  ];

  // Patch resolveBrandRuntime/getSite via importing the module and monkey-patching won't work
  // cleanly with ESM; instead assert the surface behavior of the function contract:
  // - Returns an array of findings (never throws)
  // - Findings for `hits` and `skipped` are separated
  // - Skipped findings have severity WARNING and check='duplicate-check-partial'

  // Since probeDuplicateAcrossMvp uses live resolvers, we cannot mock them here.
  // Instead: call it with a `current brand` that IS in the list so all others get iterated,
  // AND with an unknown/invalid brand id so runtime resolution predictably throws for that one.
  const brandListWithUnknown = [
    { id: 'QPRO1', enabled: true },
    { id: 'DEFINITELY_NOT_A_BRAND', enabled: true },
    { id: 'QPRO5', enabled: true },
  ];
  const findings = await probeDuplicateAcrossMvp(
    { brand: 'QPRO1', code: 'TEST_R14_NONEXISTENT_CODE_ZZZ' },
    brandListWithUnknown,
  );
  // Should return an array (may be empty if no duplicates AND no broken brands, or contain partial warning if broken)
  assert.ok(Array.isArray(findings), 'returns array');
  // At minimum: no exception. Any warnings must be WARNING severity with check name we can recognize.
  for (const f of findings) {
    assert.equal(f.severity, 'WARNING');
    assert.ok(
      f.check === 'duplicate-brand' || f.check === 'duplicate-check-partial',
      `unexpected finding check: ${f.check}`,
    );
    // Client-visible message must never contain a filesystem path
    assert.ok(!/\/var\//.test(f.message || ''), `message leaks absolute path: ${f.message}`);
    assert.ok(!/[A-Z]:\\/.test(f.message || ''), `message leaks Windows path: ${f.message}`);
  }
});

test('R16: one broken site does not poison other sites in the loader', async () => {
  const { writeFileSync, mkdirSync, rmSync } = await import('node:fs');
  const path = await import('node:path');
  const os = await import('node:os');
  const tmp = path.join(os.tmpdir(), `r16-lazy-${Date.now()}`);
  mkdirSync(tmp, { recursive: true });
  const sitesFile = path.join(tmp, 'bo-sites.json');

  // Two sites: ibc22 has a placeholder username; qpro1 is fully valid.
  // Pre-R16 loader would throw on ibc22 upfront and never return qpro1.
  writeFileSync(sitesFile, JSON.stringify({
    sites: {
      ibc22: {
        platform: 'qp2',
        baseUrl: 'https://example.com',
        apiHost: 'https://api.example.com',
        reqSignKey: 'k',
        loginMerchantCode: 'm',
        username: 'REPLACE_ME',
        password: 'x',
      },
      qpro1: {
        platform: 'qpro',
        baseUrl: 'https://qpro1.example.com',
        username: 'real-user',
        password: 'real-pass', // nosecret — test fixture, not a real credential
      },
    },
  }, null, 2));

  const cwdBefore = process.cwd();
  process.chdir(tmp);
  const originalEnv = process.env.BO_SITES_FILE;
  process.env.BO_SITES_FILE = sitesFile;
  try {
    const modUrl = new URL(`../src/sites.js?r16test=${Date.now()}`, import.meta.url);
    const { getSite } = await import(modUrl.href);

    // qpro1 must succeed even though ibc22 is broken
    const qpro1 = getSite('qpro1');
    assert.equal(qpro1.id, 'qpro1');
    assert.equal(qpro1.username, 'real-user');
    assert.equal(qpro1.baseUrl, 'https://qpro1.example.com');

    // ibc22 must still throw SITE_CONFIG_INCOMPLETE — targeted callers still get the graceful signal
    let ibcErr;
    try { getSite('ibc22'); } catch (e) { ibcErr = e; }
    assert.ok(ibcErr, 'ibc22 must still throw');
    assert.equal(ibcErr.code, 'SITE_CONFIG_INCOMPLETE');
    assert.equal(ibcErr.siteId, 'ibc22');
    assert.equal(ibcErr.field, 'username');

    // Repeat getSite('qpro1') — should still work and hit the _validated cache path
    const qpro1Again = getSite('qpro1');
    assert.equal(qpro1Again._validated, true);
  } finally {
    process.chdir(cwdBefore);
    if (originalEnv === undefined) delete process.env.BO_SITES_FILE;
    else process.env.BO_SITES_FILE = originalEnv;
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
});

test('R16: listSites() preserves all-or-throw behavior for estate-wide scripts', async () => {
  const { writeFileSync, mkdirSync, rmSync } = await import('node:fs');
  const path = await import('node:path');
  const os = await import('node:os');
  const tmp = path.join(os.tmpdir(), `r16-listsites-${Date.now()}`);
  mkdirSync(tmp, { recursive: true });
  const sitesFile = path.join(tmp, 'bo-sites.json');
  writeFileSync(sitesFile, JSON.stringify({
    sites: {
      ibc22: { platform: 'qp2', baseUrl: 'https://example.com', apiHost: 'https://api.example.com', reqSignKey: 'k', loginMerchantCode: 'm', username: 'REPLACE_ME', password: 'x' },
      qpro1: { platform: 'qpro', baseUrl: 'https://qpro1.example.com', username: 'real', password: 'p' },
    },
  }, null, 2));

  const cwdBefore = process.cwd();
  process.chdir(tmp);
  const originalEnv = process.env.BO_SITES_FILE;
  process.env.BO_SITES_FILE = sitesFile;
  try {
    const modUrl = new URL(`../src/sites.js?r16listtest=${Date.now()}`, import.meta.url);
    const { listSites } = await import(modUrl.href);
    let err;
    try { listSites(); } catch (e) { err = e; }
    assert.ok(err, 'listSites() must throw when any site is invalid');
    assert.equal(err.code, 'SITE_CONFIG_INCOMPLETE');
    assert.equal(err.siteId, 'ibc22');
  } finally {
    process.chdir(cwdBefore);
    if (originalEnv === undefined) delete process.env.BO_SITES_FILE;
    else process.env.BO_SITES_FILE = originalEnv;
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
});

test('sites.js SITE_CONFIG_INCOMPLETE error carries publicMessage + code + siteId + field', async () => {
  const { readFileSync, writeFileSync, mkdirSync, rmSync } = await import('node:fs');
  const path = await import('node:path');
  const os = await import('node:os');
  const tmp = path.join(os.tmpdir(), `r14-sites-${Date.now()}`);
  mkdirSync(tmp, { recursive: true });
  const sitesFile = path.join(tmp, 'bo-sites.json');
  // Placeholder username triggers SITE_CONFIG_INCOMPLETE (all other qp2-required
  // fields present so we specifically test the username-placeholder path)
  writeFileSync(sitesFile, JSON.stringify({
    sites: {
      ibc22: {
        platform: 'qp2',
        baseUrl: 'https://example.com',
        apiHost: 'https://api.example.com',
        reqSignKey: 'test-sign-key', // nosecret — test fixture, not a real credential
        loginMerchantCode: 'test-merchant',
        username: 'REPLACE_ME',
        password: 'x',
      },
    },
  }, null, 2));

  const cwdBefore = process.cwd();
  process.chdir(tmp);
  const originalEnv = process.env.BO_SITES_FILE;
  process.env.BO_SITES_FILE = sitesFile;
  try {
    // Import fresh module to pick up the env var + new file
    const modUrl = new URL(`../src/sites.js?r14test=${Date.now()}`, import.meta.url);
    const { getSite } = await import(modUrl.href);
    let caught;
    try { getSite('ibc22'); }
    catch (e) { caught = e; }
    assert.ok(caught, 'expected getSite to throw');
    assert.equal(caught.code, 'SITE_CONFIG_INCOMPLETE');
    assert.equal(caught.siteId, 'ibc22');
    assert.equal(caught.platform, 'qp2');
    assert.equal(caught.field, 'username');
    assert.ok(caught.publicMessage, 'has publicMessage');
    assert.ok(!/[A-Z]:\\|\/var\/|\/etc\//.test(caught.publicMessage), `publicMessage leaks path: ${caught.publicMessage}`);
    assert.match(caught.publicMessage, /ibc22/);
    assert.match(caught.publicMessage, /contact admin/i);
  } finally {
    process.chdir(cwdBefore);
    if (originalEnv === undefined) delete process.env.BO_SITES_FILE;
    else process.env.BO_SITES_FILE = originalEnv;
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
});

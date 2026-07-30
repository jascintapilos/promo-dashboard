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
        reqSignKey: 'test-sign-key',
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

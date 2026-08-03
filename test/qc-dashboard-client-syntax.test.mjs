import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const appPath = fileURLToPath(new URL('../public/qc-hub/app.js', import.meta.url));

test('QC Hub browser bundle has valid JavaScript syntax', () => {
  const result = spawnSync(process.execPath, ['--check', appPath], {
    encoding: 'utf8',
  });

  assert.equal(
    result.status,
    0,
    `public/qc-hub/app.js failed syntax validation:\n${result.stderr || result.stdout}`,
  );
});

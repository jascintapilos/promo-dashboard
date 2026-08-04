import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../bin/gm01-pull-queue.mjs', import.meta.url), 'utf8');

test('GM01 queue reader loads private credentials and fails closed', () => {
  assert.match(source, /gm01-credentials\.local\.json/);
  assert.match(source, /const USER = cliArgs\.user \?\? savedCreds\.user;/);
  assert.match(source, /const PASS = cliArgs\.pass \?\? savedCreds\.pass;/);
  assert.match(source, /if \(!USER \|\| !PASS\)/);
});

test('GM01 queue reader has no quoted credential fallback', () => {
  assert.doesNotMatch(source, /const USER\s*=\s*cliArgs\.user\s*\?\?\s*['"][^'"]+['"]/);
  assert.doesNotMatch(source, /const PASS\s*=\s*cliArgs\.pass\s*\?\?\s*['"][^'"]+['"]/);
});

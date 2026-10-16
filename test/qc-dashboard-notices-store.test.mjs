import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _test, CATEGORIES, listNotices, addNotice, updateNotice, deleteNotice } from '../src/qc-dashboard/notices-store.js';

// Point the store at a throwaway file for each file-backed test.
function withTempFile(fn) {
  return async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'notices-'));
    const prev = process.env.NOTICES_FILE;
    process.env.NOTICES_FILE = path.join(dir, 'nested', 'notices.local.json');
    try { await fn(process.env.NOTICES_FILE); }
    finally {
      if (prev === undefined) delete process.env.NOTICES_FILE; else process.env.NOTICES_FILE = prev;
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

test('cleanInput trims, keeps line breaks, and caps length', () => {
  const c = _test.cleanInput({ title: '  Test   accounts ', body: 'Line one  \r\n\r\n\r\n\r\nExample: tumktkokchun  ' });
  assert.equal(c.title, 'Test accounts');
  assert.equal(c.body, 'Line one\n\nExample: tumktkokchun');
  const long = _test.cleanInput({ title: 't'.repeat(300), body: 'b'.repeat(5000) });
  assert.equal(long.title.length, _test.TITLE_MAX);
  assert.equal(long.body.length, _test.BODY_MAX);
});

test('cleanInput rejects a missing title or message with 400', () => {
  assert.throws(() => _test.cleanInput({ title: ' ', body: 'x' }), (e) => e.status === 400 && /title/.test(e.message));
  assert.throws(() => _test.cleanInput({ title: 'x', body: '\n \n' }), (e) => e.status === 400 && /message/.test(e.message));
});

test('missing data file reads as no notices', withTempFile(async () => {
  assert.deepEqual(await listNotices(), []);
}));

test('add / update / delete round-trip, newest first, authors recorded', withTempFile(async (file) => {
  const { notice: first } = await addNotice({ title: 'First', body: 'one' }, { email: 'a@x.com' });
  await new Promise((r) => setTimeout(r, 5));
  await addNotice({ title: 'Second', body: 'two' }, { email: 'b@x.com' });
  let all = await listNotices();
  assert.deepEqual(all.map((n) => n.title), ['Second', 'First']);
  assert.equal(all[1].by, 'a@x.com');

  await updateNotice(first.id, { title: 'First (edited)', body: 'one!' }, { email: 'c@x.com' });
  all = await listNotices();
  const edited = all.find((n) => n.id === first.id);
  assert.equal(edited.title, 'First (edited)');
  assert.equal(edited.by, 'a@x.com');          // original author kept
  assert.equal(edited.updatedBy, 'c@x.com');
  assert.equal(edited.createdAt, first.createdAt);

  await deleteNotice(first.id, { email: 'c@x.com' });
  all = await listNotices();
  assert.deepEqual(all.map((n) => n.title), ['Second']);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).notices.length, 1);
}));

test('update / delete of an unknown id is a 404', withTempFile(async () => {
  await assert.rejects(updateNotice('nope-123', { title: 'a', body: 'b' }), (e) => e.status === 404);
  await assert.rejects(deleteNotice('nope-123'), (e) => e.status === 404);
}));

test('a corrupt data file throws and is never overwritten', withTempFile(async (file) => {
  await addNotice({ title: 'Keep', body: 'me' });
  writeFileSync(file, '{ "notices": [ truncated', 'utf8');
  await assert.rejects(listNotices(), /unreadable/);
  await assert.rejects(addNotice({ title: 'New', body: 'x' }), /unreadable/);
  assert.equal(readFileSync(file, 'utf8'), '{ "notices": [ truncated');
}));

test('category defaults to General, matches case-insensitively, rejects unknown with 400', () => {
  assert.equal(_test.cleanInput({ title: 't', body: 'b' }).category, 'General');
  assert.equal(_test.cleanInput({ title: 't', body: 'b', category: '  promo code ' }).category, 'Promo Code');
  assert.equal(_test.cleanInput({ title: 't', body: 'b', category: 'GAME' }).category, 'Game');
  assert.throws(() => _test.cleanInput({ title: 't', body: 'b', category: 'Promos' }),
    (e) => e.status === 400 && /category must be one of/.test(e.message));
  assert.deepEqual(CATEGORIES, ['Operations', 'Promo Code', 'Game', 'Banner', 'CRM', 'General']);
});

test('memos saved before categories existed read as General', withTempFile(async (file) => {
  const { mkdirSync } = await import('node:fs');
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ notices: [{ id: 'old-memo-1', title: 'TUMKT', body: 'prefix', by: 'g@x', createdAt: '2026-10-14T00:00:00.000Z', updatedAt: '2026-10-14T00:00:00.000Z' }] }), 'utf8');
  const [old] = await listNotices();
  assert.equal(old.category, 'General');
  assert.equal(old.title, 'TUMKT');
}));

test('category is saved on add and can be changed on edit', withTempFile(async () => {
  const { notice } = await addNotice({ category: 'Game', title: 'New provider', body: 'x' }, { email: 'a@x' });
  assert.equal(notice.category, 'Game');
  await updateNotice(notice.id, { category: 'Operations', title: 'New provider', body: 'x' }, { email: 'b@x' });
  const [n] = await listNotices();
  assert.equal(n.category, 'Operations');
}));

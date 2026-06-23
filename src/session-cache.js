// Per-site session cache with file-locking. Concurrent workers across
// processes share one login per site through O_CREAT|O_EXCL locks.
//
// On disk:
//   .session/<site-id>.json     — usable session
//   .session/<site-id>.lock     — held while a (re)login is in flight

import { mkdir, readFile, writeFile, rename, unlink, open } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_DIR = path.resolve(process.env.QPRO_SESSION_DIR || '.session');
const EXPIRY_SKEW_MS = 30_000; // refresh 30s before the server says we'd expire

function pathsFor(siteId, dir = DEFAULT_DIR) {
  return {
    dir,
    file: path.join(dir, `${siteId}.json`),
    lock: path.join(dir, `${siteId}.lock`),
  };
}

async function ensureDir(dir) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
}

export async function readSession(siteId, dir = DEFAULT_DIR) {
  const { file } = pathsFor(siteId, dir);
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

export function isFresh(session, { skewMs = EXPIRY_SKEW_MS } = {}) {
  if (!session?.accessToken || !session?.plaintextToken) return false;
  if (!session.expiresAt) return true; // No expiry recorded — let HTTP 401 force refresh.
  return new Date(session.expiresAt).getTime() - Date.now() > skewMs;
}

async function writeAtomic(file, session) {
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
  await writeFile(tmp, JSON.stringify(session, null, 2), { mode: 0o600 });
  await rename(tmp, file);
}

export async function saveSession(siteId, session, dir = DEFAULT_DIR) {
  await ensureDir(dir);
  await writeAtomic(pathsFor(siteId, dir).file, session);
}

export async function clearSession(siteId, dir = DEFAULT_DIR) {
  try { await unlink(pathsFor(siteId, dir).file); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
}

async function acquireLock(lockPath, { timeoutMs = 30_000, staleMs = 60_000 } = {}) {
  const start = Date.now();
  while (true) {
    try {
      const fh = await open(lockPath, 'wx', 0o600);
      await fh.writeFile(JSON.stringify({ pid: process.pid, ts: Date.now() }));
      await fh.close();
      return;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try {
        const meta = JSON.parse(await readFile(lockPath, 'utf8'));
        if (Date.now() - meta.ts > staleMs) {
          await unlink(lockPath).catch(() => {});
          continue;
        }
      } catch {/* keep waiting */}
      if (Date.now() - start > timeoutMs) {
        throw new Error(`session lock timeout after ${timeoutMs}ms: ${lockPath}`);
      }
      await new Promise((r) => setTimeout(r, 100 + Math.random() * 100));
    }
  }
}

async function releaseLock(lockPath) {
  await unlink(lockPath).catch(() => {});
}

// Returns a usable session for `siteId`. Calls `doLogin()` only when necessary.
export async function getOrRefreshSession(siteId, doLogin, { dir = DEFAULT_DIR, force = false } = {}) {
  const { lock, file } = pathsFor(siteId, dir);
  await ensureDir(dir);

  if (!force) {
    const existing = await readSession(siteId, dir);
    if (isFresh(existing)) return existing;
  }

  await acquireLock(lock);
  try {
    if (!force) {
      const recheck = await readSession(siteId, dir);
      if (isFresh(recheck)) return recheck;
    }
    const fresh = await doLogin();
    fresh.siteId = siteId;
    fresh.cachedAt = new Date().toISOString();
    await writeAtomic(file, fresh);
    return fresh;
  } finally {
    await releaseLock(lock);
  }
}

export async function refreshSession(siteId, doLogin, opts = {}) {
  return getOrRefreshSession(siteId, doLogin, { ...opts, force: true });
}

// Discovery helper (used by the `sessions` CLI).
export async function listCachedSessions(dir = DEFAULT_DIR) {
  const { readdir } = await import('node:fs/promises');
  let entries;
  try { entries = await readdir(dir); }
  catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  const out = [];
  for (const name of entries) {
    if (!name.endsWith('.json')) continue;
    const id = name.replace(/\.json$/, '');
    const s = await readSession(id, dir);
    if (s) out.push({ id, session: s, fresh: isFresh(s) });
  }
  return out;
}

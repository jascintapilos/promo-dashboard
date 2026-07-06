/**
 * Resolve the SunBrowser CDP WebSocket URL.
 *
 * AdsPower launches SunBrowser with --remote-debugging-port=0 so the OS assigns
 * a random port. Chrome writes the actual port + devtools path to:
 *   <user-data-dir>/DevToolsActivePort
 *
 * Resolution order:
 *   1. Scan C:\.ADSPOWER_GLOBAL\cache\*\DevToolsActivePort — pick most-recent
 *   2. Try legacy fixed port 53845 (old hard-coded value — kept as fallback)
 *   3. Return last-known hardcoded GUID (will fail if GUID rotated, but surfaces a clear error)
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ADSPOWER_CACHE   = 'C:\\.ADSPOWER_GLOBAL\\cache';
const CDP_LEGACY_PORT  = 53845;
const CDP_LEGACY_URL   = `ws://127.0.0.1:${CDP_LEGACY_PORT}/devtools/browser/f002fadf-3a94-42f2-bf35-e9dde1d58e74`;

export async function getCdpWsUrl() {
  // ── 1. Read DevToolsActivePort from the most-recently-modified profile ────
  try {
    const entries = readdirSync(ADSPOWER_CACHE, { withFileTypes: true });
    const candidates = entries
      .filter(e => e.isDirectory())
      .map(e => {
        const portFile = join(ADSPOWER_CACHE, e.name, 'DevToolsActivePort');
        try { return { portFile, mtime: statSync(portFile).mtimeMs }; } catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => b.mtime - a.mtime);

    if (candidates.length > 0) {
      const lines = readFileSync(candidates[0].portFile, 'utf8').trim().split(/\r?\n/);
      const port  = parseInt(lines[0], 10);
      const path  = lines[1]?.trim();
      if (port > 0 && path) {
        const url = `ws://127.0.0.1:${port}${path}`;
        console.log(`  SunBrowser CDP: port ${port} (from DevToolsActivePort)`);
        return url;
      }
    }
  } catch (e) {
    console.warn(`  DevToolsActivePort scan failed: ${e.message}`);
  }

  // ── 2. Legacy fixed port ──────────────────────────────────────────────────
  try {
    const res = await fetch(`http://127.0.0.1:${CDP_LEGACY_PORT}/json/version`);
    if (res.ok) {
      const { webSocketDebuggerUrl } = await res.json();
      if (webSocketDebuggerUrl) {
        console.log(`  SunBrowser CDP: port ${CDP_LEGACY_PORT} (legacy probe)`);
        return webSocketDebuggerUrl;
      }
    }
  } catch (_) {}

  // ── 3. Hardcoded fallback ─────────────────────────────────────────────────
  console.warn('  CDP resolution failed — using hardcoded fallback (will error if GUID rotated)');
  return CDP_LEGACY_URL;
}

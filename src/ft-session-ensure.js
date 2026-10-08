// FastTrack session escalation for the unattended crmFt pull.
//
// FastTrack has no durable credential: every read needs a ~8h WorkOS
// `portaltoken`. This escalates only as far as needed and NEVER loops or hangs:
//   1. re-mint from the saved storageState profile (bin/refresh-ft-sessions.mjs)
//      — no OTP, the common nightly case;
//   2. on failure, ONE headless re-login (bin/capture-ft-session.mjs) — auto-OTP
//      via the Gmail-only token + stored TOTP, with the built-in retry cap;
//   3. still failing → return { ok:false, reason } so the caller can push an
//      ok:false crmFt (last-good kept) and alert. No throw, no browser loop.
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VALID = new Set(['ws1', 'qpro1', 'qp2']);

function runNode(scriptRelPath, args, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, scriptRelPath), ...args], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
    let done = false;
    const t = setTimeout(() => { done = true; try { child.kill(); } catch {} resolve({ code: -1, timedOut: true }); }, timeoutMs);
    child.on('error', () => { if (!done) { clearTimeout(t); resolve({ code: -1, timedOut: false }); } });
    child.on('close', (code) => { if (!done) { clearTimeout(t); resolve({ code: code ?? -1, timedOut: false }); } });
  });
}

function readPortaltoken(instance) {
  const f = path.join(ROOT, `ft-session-${instance}.local.json`);
  if (!existsSync(f)) return '';
  try {
    const s = JSON.parse(readFileSync(f, 'utf8'));
    const c = (s.cookies || []).find((x) => x.name === 'portaltoken');
    return c?.value || s.token || '';
  } catch { return ''; }
}

// Returns { ok, portaltoken, reason }. Never throws.
export async function ensureFtSession(instance, { remintTimeoutMs = 90_000, reloginTimeoutMs = 240_000 } = {}) {
  if (!VALID.has(instance)) return { ok: false, portaltoken: '', reason: `unknown instance "${instance}"` };

  // 1. cheap re-mint from profile (no OTP)
  const remint = await runNode('bin/refresh-ft-sessions.mjs', [`--instance=${instance}`], remintTimeoutMs);
  if (remint.code === 0) {
    const tok = readPortaltoken(instance);
    if (tok) return { ok: true, portaltoken: tok, reason: 're-minted from profile' };
  }

  // 2. one headless re-login (auto-OTP + TOTP, capped). Skip if no profile exists at all.
  if (!existsSync(path.join(ROOT, `ft-profile-${instance}.local.json`))) {
    return { ok: false, portaltoken: '', reason: `no login profile — run: node bin/capture-ft-session.mjs --instance=${instance}` };
  }
  const relogin = await runNode('bin/capture-ft-session.mjs', [`--instance=${instance}`], reloginTimeoutMs);
  if (relogin.code === 0) {
    const tok = readPortaltoken(instance);
    if (tok) return { ok: true, portaltoken: tok, reason: 'headless re-login' };
  }

  return {
    ok: false,
    portaltoken: '',
    reason: relogin.timedOut ? 'headless re-login timed out (profile likely expired — needs interactive re-login)'
      : `session expired — re-login failed (run: node bin/capture-ft-session.mjs --instance=${instance})`,
  };
}

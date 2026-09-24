import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const COOKIE = 'qc_hub_session';
const ALLOWLIST = process.env.ADMITTED_USERS_PATH || 'admitted-users.json';
// Server-side overlay written by the Manage Users screen. Kept SEPARATE from the
// git-tracked base allowlist so UI edits survive deploys (the deploy rewrites the
// base from git; it must NOT touch this file — it is gitignored). Point it at a
// path outside the deploy checkout via ADMITTED_OVERLAY_PATH if the deploy wipes
// untracked files. Shape: { upserts: [{email, role}], removed: ["email", ...] }.
const OVERLAY_FILE = process.env.ADMITTED_OVERLAY_PATH || 'admitted-users.overlay.json';
const SECRET_FILE = 'qc-dashboard-session-secret.local.json';
const CONFIG_FILE = 'qc-hub-config.json';
const VALID_ROLES = new Set(['admin', 'promo-team', 'hod-view', 'guest', 'promo-report']);
// Report-only roles: admitted for the promo report but DENIED the QC Hub (`/`) and
// Ops Dashboard (`/dashboard`). A DENYLIST (not a whitelist) on purpose — every
// pre-existing role keeps its current access unchanged; only the new `promo-report`
// role is bounced to the promo site. Keep in sync with bin/qc-dashboard.mjs.
export const REPORT_ONLY_ROLES = new Set(['promo-report']);

export const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000; // 8 hours

export function loadQcHubConfig() {
  if (existsSync(CONFIG_FILE)) {
    try { return JSON.parse(readFileSync(CONFIG_FILE, 'utf8')); } catch {}
  }
  return {};
}

function sessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (existsSync(SECRET_FILE)) {
    const parsed = JSON.parse(readFileSync(SECRET_FILE, 'utf8'));
    if (parsed.secret) return parsed.secret;
  }
  if (process.env.AUTH_MODE === 'dev') return 'dev-only-qc-hub-secret';
  // Auto-generate and persist so the server works without manual setup.
  const secret = randomBytes(32).toString('hex');
  writeFileSync(SECRET_FILE, JSON.stringify({ secret }, null, 2));
  console.log(`SESSION_SECRET auto-generated → ${SECRET_FILE}`);
  return secret;
}

function authErr(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function normalizeRole(role, email = '') {
  const normalized = String(role || 'promo-team').trim().toLowerCase();
  if (VALID_ROLES.has(normalized)) return normalized;
  console.warn(`Invalid admitted-users role "${role}" for ${email || 'unknown user'}; defaulting to promo-team.`);
  return 'promo-team';
}

function parseBaseAllowlist() {
  if (!existsSync(ALLOWLIST)) throw new Error(`${ALLOWLIST} is required outside AUTH_MODE=dev`);
  const parsed = JSON.parse(readFileSync(ALLOWLIST, 'utf8'));
  const usersByEmail = new Map();
  if (Array.isArray(parsed.users)) {
    for (const raw of parsed.users) {
      if (!raw || typeof raw !== 'object') continue;
      const email = String(raw.email || '').trim().toLowerCase();
      if (!email) continue;
      usersByEmail.set(email, { email, role: normalizeRole(raw.role, email) });
    }
  } else if (Array.isArray(parsed.emails)) {
    for (const rawEmail of parsed.emails) {
      const email = String(rawEmail).trim().toLowerCase();
      if (!email) continue;
      usersByEmail.set(email, { email, role: 'promo-team' });
    }
  } else {
    throw new Error(`${ALLOWLIST} must contain an "emails" array or "users" array.`);
  }
  return usersByEmail;
}

// Read the Manage Users overlay. DEFENSIVE by contract: any problem (missing,
// malformed, wrong shape) yields an empty overlay and NEVER throws — a broken
// overlay must never take down auth / 502 the whole server.
export function loadOverlay() {
  try {
    if (!existsSync(OVERLAY_FILE)) return { upserts: [], removed: [] };
    const parsed = JSON.parse(readFileSync(OVERLAY_FILE, 'utf8'));
    return {
      upserts: Array.isArray(parsed.upserts) ? parsed.upserts : [],
      removed: Array.isArray(parsed.removed) ? parsed.removed : [],
    };
  } catch (e) {
    console.warn(`admitted-users overlay ignored (${e.message})`);
    return { upserts: [], removed: [] };
  }
}

function saveOverlay(overlay) {
  const clean = {
    upserts: (overlay.upserts || [])
      .filter((u) => u && String(u.email || '').trim())
      .map((u) => ({ email: String(u.email).trim().toLowerCase(), role: normalizeRole(u.role, u.email) })),
    removed: (overlay.removed || []).map((e) => String(e).trim().toLowerCase()).filter(Boolean),
  };
  writeFileSync(OVERLAY_FILE, JSON.stringify(clean, null, 2));
  return clean;
}

function applyOverlay(usersByEmail) {
  const ov = loadOverlay();
  for (const raw of ov.upserts) {
    if (!raw || typeof raw !== 'object') continue;
    const email = String(raw.email || '').trim().toLowerCase();
    if (!email) continue;
    usersByEmail.set(email, { email, role: normalizeRole(raw.role, email) });
  }
  for (const rawEmail of ov.removed) {
    const email = String(rawEmail).trim().toLowerCase();
    if (email) usersByEmail.delete(email);
  }
  return usersByEmail;
}

export function loadAdmittedUsers() {
  const usersByEmail = applyOverlay(parseBaseAllowlist());
  const users = [...usersByEmail.values()];
  if (users.length === 0) {
    throw new Error(`${ALLOWLIST} has an empty admitted users list — server refusing to start.`);
  }
  return users;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Effective admitted-users list (base + overlay), or the dev user in AUTH_MODE=dev. */
export function listAdmittedUsers() {
  return [...admittedUsersByEmail().values()];
}

/** Add a user or change a user's role. Writes ONLY to the overlay. Guardrails:
 *  valid email + role; an admin cannot demote their own account (self-lockout). */
export function upsertAdmittedUser({ email, role, actingEmail } = {}) {
  const e = String(email || '').trim().toLowerCase();
  const acting = String(actingEmail || '').trim().toLowerCase();
  if (!EMAIL_RE.test(e)) throw authErr(400, 'Enter a valid email address.');
  const r = String(role || '').trim().toLowerCase();
  if (!VALID_ROLES.has(r)) throw authErr(400, `Invalid role. Allowed: ${[...VALID_ROLES].join(', ')}.`);
  if (e === acting && r !== 'admin') {
    const current = new Map(listAdmittedUsers().map((u) => [u.email, u.role]));
    if (current.get(e) === 'admin') throw authErr(400, 'You cannot change your own admin role (avoids locking yourself out).');
  }
  const ov = loadOverlay();
  ov.upserts = ov.upserts.filter((u) => String(u?.email || '').trim().toLowerCase() !== e);
  ov.upserts.push({ email: e, role: r });
  ov.removed = ov.removed.filter((x) => String(x).trim().toLowerCase() !== e);
  saveOverlay(ov);
  return listAdmittedUsers();
}

/** Remove a user. Writes ONLY to the overlay (base users get a removal tombstone).
 *  Guardrails: cannot remove your own account; cannot remove the last admin. */
export function removeAdmittedUser({ email, actingEmail } = {}) {
  const e = String(email || '').trim().toLowerCase();
  const acting = String(actingEmail || '').trim().toLowerCase();
  if (!e) throw authErr(400, 'Missing email.');
  if (e === acting) throw authErr(400, 'You cannot remove your own account.');
  const admins = listAdmittedUsers().filter((u) => u.role === 'admin').map((u) => u.email);
  if (admins.length <= 1 && admins.includes(e)) throw authErr(400, 'Cannot remove the last admin.');
  const ov = loadOverlay();
  ov.upserts = ov.upserts.filter((u) => String(u?.email || '').trim().toLowerCase() !== e);
  if (!ov.removed.map((x) => String(x).trim().toLowerCase()).includes(e)) ov.removed.push(e);
  saveOverlay(ov);
  return listAdmittedUsers();
}

function admittedUsersByEmail() {
  if (process.env.AUTH_MODE === 'dev') {
    const email = process.env.DEV_USER_EMAIL || 'dev@localhost';
    const role = normalizeRole(process.env.DEV_USER_ROLE || 'admin', email);
    return new Map([[email.trim().toLowerCase(), { email: email.trim().toLowerCase(), role }]]);
  }
  return new Map(loadAdmittedUsers().map((user) => [user.email, user]));
}

function sign(payload) {
  return createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
}

export function parseCookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map((part) => {
    const [k, ...rest] = part.trim().split('=');
    return [k, decodeURIComponent(rest.join('='))];
  }).filter(([k]) => k));
}

export function isSessionExpired(session) {
  return !session?.iat || Date.now() - session.iat > SESSION_MAX_AGE_MS;
}

export function makeSessionCookie(user, opts = {}) {
  const payload = Buffer.from(JSON.stringify({ ...user, iat: Date.now() })).toString('base64url');
  const sameSite = opts.secure ? 'Strict' : 'Lax';
  const secureFlag = opts.secure ? '; Secure' : '';
  return `${COOKIE}=${payload}.${sign(payload)}; HttpOnly; SameSite=${sameSite}; Path=/; Max-Age=28800${secureFlag}`;
}

export function readSession(req) {
  const raw = parseCookies(req)[COOKIE];
  if (!raw) return null;
  const [payload, mac] = raw.split('.');
  if (!payload || !mac) return null;
  const expected = sign(payload);
  if (Buffer.byteLength(mac) !== Buffer.byteLength(expected)) return null;
  const ok = timingSafeEqual(Buffer.from(mac), Buffer.from(expected));
  if (!ok) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (isSessionExpired(session)) return null;
    return session;
  } catch { return null; }
}

export function isLocalhost(req) {
  const host = String(req.headers.host || '').split(':')[0];
  const remote = req.socket.remoteAddress;
  return ['localhost', '127.0.0.1', '::1'].includes(host) || ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote);
}

export function getGoogleClientId() {
  return process.env.GOOGLE_CLIENT_ID || loadQcHubConfig().googleClientId || null;
}

export function validateProductionConfig() {
  if (process.env.AUTH_MODE === 'dev') return;
  if (!getGoogleClientId()) {
    throw new Error(
      'GOOGLE_CLIENT_ID is required outside AUTH_MODE=dev.\n' +
      'Set it via the GOOGLE_CLIENT_ID environment variable or qc-hub-config.json.\n' +
      'To run locally without OAuth, set AUTH_MODE=dev.',
    );
  }
  validateAllowlist();
}

export function validateAllowlist() {
  if (process.env.AUTH_MODE === 'dev') return;
  if (!existsSync(ALLOWLIST)) {
    throw new Error(`${ALLOWLIST} is required outside AUTH_MODE=dev — server refusing to start.`);
  }
  try {
    loadAdmittedUsers();
  } catch (e) {
    if (e instanceof SyntaxError) throw new Error(`${ALLOWLIST} is malformed JSON: ${e.message}`);
    throw e;
  }
}

export function validateTokenData(data, admitted, clientId) {
  if (!data.email || data.email_verified !== 'true') throw authErr(401, 'Google token has no verified email');
  if (!clientId) throw new Error('GOOGLE_CLIENT_ID is required to validate token audience');
  if (String(data.aud) !== String(clientId)) {
    throw authErr(401, 'Google token audience mismatch');
  }
  const email = String(data.email).trim().toLowerCase();
  const user = admitted instanceof Map
    ? admitted.get(email)
    : (admitted?.has?.(email) ? { email, role: 'promo-team' } : null);
  if (!user) {
    throw authErr(403, 'Email is not in admitted-users allowlist');
  }
  return { email, name: data.name || data.email, role: user.role || 'promo-team' };
}

export async function verifyGoogleIdToken(idToken) {
  const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
  if (!res.ok) throw authErr(401, `Google tokeninfo rejected token (${res.status})`);
  const data = await res.json();
  const clientId = getGoogleClientId();
  if (!clientId) throw new Error('GOOGLE_CLIENT_ID must be set in production — cannot verify token audience');
  return validateTokenData(data, admittedUsersByEmail(), clientId);
}

export async function loginFromRequest(req, body) {
  if (process.env.AUTH_MODE === 'dev') {
    if (!isLocalhost(req)) throw new Error('AUTH_MODE=dev login is localhost-only');
    const email = String(process.env.DEV_USER_EMAIL || 'dev@localhost').trim().toLowerCase();
    const role = normalizeRole(process.env.DEV_USER_ROLE || 'admin', email);
    return { email, name: email, role };
  }
  if (!body?.credential) throw new Error('Missing Google credential');
  return verifyGoogleIdToken(body.credential);
}

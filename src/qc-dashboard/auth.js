import { createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

const COOKIE = 'qc_hub_session';
const ALLOWLIST = 'admitted-users.json';
const SECRET_FILE = 'qc-dashboard-session-secret.local.json';

export const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000; // 8 hours

function sessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (existsSync(SECRET_FILE)) {
    const parsed = JSON.parse(readFileSync(SECRET_FILE, 'utf8'));
    if (parsed.secret) return parsed.secret;
  }
  if (process.env.AUTH_MODE === 'dev') return 'dev-only-qc-hub-secret';
  throw new Error('SESSION_SECRET or qc-dashboard-session-secret.local.json is required');
}

function admittedEmails() {
  if (process.env.AUTH_MODE === 'dev') return new Set([process.env.DEV_USER_EMAIL || 'dev@localhost']);
  if (!existsSync(ALLOWLIST)) throw new Error(`${ALLOWLIST} is required outside AUTH_MODE=dev`);
  const parsed = JSON.parse(readFileSync(ALLOWLIST, 'utf8'));
  return new Set((parsed.emails || []).map((e) => String(e).toLowerCase()));
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

export function validateProductionConfig() {
  if (process.env.AUTH_MODE === 'dev') return;
  if (!process.env.GOOGLE_CLIENT_ID) {
    throw new Error(
      'GOOGLE_CLIENT_ID is required outside AUTH_MODE=dev.\n' +
      'Set it via the GOOGLE_CLIENT_ID environment variable.\n' +
      'To run locally without OAuth, set AUTH_MODE=dev.',
    );
  }
}

export function validateTokenData(data, allowSet, clientId) {
  if (!data.email || data.email_verified !== 'true') throw new Error('Google token has no verified email');
  if (!clientId) throw new Error('GOOGLE_CLIENT_ID is required to validate token audience');
  if (String(data.aud) !== String(clientId)) {
    throw new Error(`Google token audience mismatch: expected ${clientId}, got ${data.aud}`);
  }
  if (!String(data.email).toLowerCase().endsWith('@thebrandingpeople.co')) {
    throw new Error('Email is outside admitted workspace domain');
  }
  if (!allowSet.has(String(data.email).toLowerCase())) {
    throw new Error('Email is not in admitted-users allowlist');
  }
  return { email: String(data.email).toLowerCase(), name: data.name || data.email };
}

export async function verifyGoogleIdToken(idToken) {
  const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
  if (!res.ok) throw new Error(`Google tokeninfo rejected token (${res.status})`);
  const data = await res.json();
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error('GOOGLE_CLIENT_ID must be set in production — cannot verify token audience');
  return validateTokenData(data, admittedEmails(), clientId);
}

export async function loginFromRequest(req, body) {
  if (process.env.AUTH_MODE === 'dev') {
    if (!isLocalhost(req)) throw new Error('AUTH_MODE=dev login is localhost-only');
    const email = process.env.DEV_USER_EMAIL || 'dev@localhost';
    return { email, name: email };
  }
  if (!body?.credential) throw new Error('Missing Google credential');
  return verifyGoogleIdToken(body.credential);
}

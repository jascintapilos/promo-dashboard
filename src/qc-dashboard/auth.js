import { createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

const COOKIE = 'qc_hub_session';
const ALLOWLIST = 'admitted-users.json';
const SECRET_FILE = 'qc-dashboard-session-secret.local.json';

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

export function makeSessionCookie(user) {
  const payload = Buffer.from(JSON.stringify({ ...user, iat: Date.now() })).toString('base64url');
  return `${COOKIE}=${payload}.${sign(payload)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`;
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
  try { return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { return null; }
}

function isLocalhost(req) {
  const host = String(req.headers.host || '').split(':')[0];
  const remote = req.socket.remoteAddress;
  return ['localhost', '127.0.0.1', '::1'].includes(host) || ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote);
}

export async function verifyGoogleIdToken(idToken) {
  const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
  if (!res.ok) throw new Error(`Google tokeninfo rejected token (${res.status})`);
  const data = await res.json();
  if (!data.email || data.email_verified !== 'true') throw new Error('Google token has no verified email');
  if (!String(data.email).toLowerCase().endsWith('@thebrandingpeople.co')) throw new Error('Email is outside admitted workspace domain');
  const allow = admittedEmails();
  if (!allow.has(String(data.email).toLowerCase())) throw new Error('Email is not in admitted-users allowlist');
  return { email: String(data.email).toLowerCase(), name: data.name || data.email };
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

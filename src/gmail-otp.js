// Gmail OTP reader for FastTrack CRM auto-capture.
//
// Polls the Gmail inbox for the most-recent email that arrived AFTER a given
// timestamp and contains a 6-digit code. Used by capture-ft-session.mjs so
// the FT login can complete headlessly without human OTP entry.
//
// Uses the Gmail-only token from `node bin/gmail-oauth.mjs` when present, else
// the main OAuth token (which then needs gmail.readonly).
// Enable Gmail API in GCP: https://console.cloud.google.com/apis/library/gmail.googleapis.com

import { getGmailAuth, loadGoogleapis } from './google-auth.js';
import { readFileSync, existsSync, statSync, unlinkSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const POLL_INTERVAL_MS = 4000;

// Fallback when the Gmail API is unavailable: another process (or Claude via the
// Gmail MCP) writes the 6-digit code to this file and we pick it up on next poll.
const OTP_DROP_FILE = path.resolve('tmp/ft-otp-drop.txt');

/**
 * Wait for a 6-digit OTP to appear in the inbox after `afterMs`.
 * @param {object} opts
 * @param {number} opts.afterMs    - Unix ms timestamp; ignore emails older than this
 * @param {number} opts.timeoutMs  - Give up after this many ms (default 2 min)
 * @returns {Promise<string>}      - The 6-digit code
 */
export async function waitForFtOtp({ afterMs = Date.now(), timeoutMs = 120_000 } = {}) {
  const { client } = await getGmailAuth();
  const { google } = await loadGoogleapis();
  const gmail = google.gmail({ version: 'v1', auth: client });

  // Gmail `after:` filter uses Unix seconds
  const afterSec = Math.floor(afterMs / 1000);
  const deadline = Date.now() + timeoutMs;

  // Clear any stale drop file from a previous run
  try { if (existsSync(OTP_DROP_FILE) && statSync(OTP_DROP_FILE).mtimeMs < afterMs) unlinkSync(OTP_DROP_FILE); } catch (_) {}
  try { mkdirSync(path.dirname(OTP_DROP_FILE), { recursive: true }); } catch (_) {}

  process.stdout.write('  Waiting for OTP email');

  // Track seen message IDs so we don't re-process
  const seen = new Set();
  let gmailAvailable = true;

  while (Date.now() < deadline) {
    await delay(POLL_INTERVAL_MS);
    process.stdout.write('.');

    // Drop-file fallback — works even when the Gmail API is unavailable
    const dropped = readOtpDropFile(afterMs);
    if (dropped) {
      process.stdout.write(`\n  OTP: ${dropped} (from drop file)\n`);
      return dropped;
    }

    if (!gmailAvailable) continue;

    let listRes;
    try {
      listRes = await gmail.users.messages.list({
        userId: 'me',
        q: `after:${afterSec}`,
        maxResults: 10,
      });
    } catch (e) {
      if (e.code === 403 || String(e.message).includes('Gmail API')) {
        gmailAvailable = false;
        process.stdout.write(
          '\n  Gmail API unavailable — falling back to drop file.\n' +
          `  Write the 6-digit code to: ${OTP_DROP_FILE}\n` +
          '  (To fix Gmail: enable the API in GCP + re-consent with gmail.readonly)\n'
        );
        continue;
      }
      // Transient network error — keep polling
      continue;
    }

    for (const { id } of listRes.data.messages || []) {
      if (seen.has(id)) continue;
      seen.add(id);

      let msg;
      try {
        msg = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
      } catch (_) {
        continue;
      }

      const subject = getHeader(msg.data, 'Subject') || '';
      const from    = getHeader(msg.data, 'From') || '';
      const body    = extractTextBody(msg.data);
      const text    = subject + ' ' + body;

      // Extract first standalone 6-digit sequence — OTP codes are always 6 digits
      const match = text.match(/\b(\d{6})\b/);
      if (match) {
        process.stdout.write(`\n  OTP: ${match[1]} (from: ${from.slice(0, 60)})\n`);
        return match[1];
      }
    }
  }

  throw new Error('OTP email not received within 2 minutes. Check your inbox or re-run manually.');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Read a 6-digit code from the drop file if it was written after `afterMs`.
// Consumes (deletes) the file on successful read.
function readOtpDropFile(afterMs) {
  try {
    if (!existsSync(OTP_DROP_FILE)) return null;
    if (statSync(OTP_DROP_FILE).mtimeMs < afterMs) return null;
    const raw = readFileSync(OTP_DROP_FILE, 'utf8');
    const m = raw.match(/\b(\d{6})\b/);
    if (!m) return null;
    unlinkSync(OTP_DROP_FILE);
    return m[1];
  } catch (_) {
    return null;
  }
}

function getHeader(msgData, name) {
  const headers = msgData?.payload?.headers || [];
  return headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';
}

function extractTextBody(msgData) {
  const parts = [];
  collectParts(msgData?.payload, parts);
  for (const p of parts) {
    if (p.mimeType === 'text/plain' && p.body?.data) {
      return Buffer.from(p.body.data, 'base64url').toString('utf8');
    }
  }
  // Fall back to HTML if no plain text
  for (const p of parts) {
    if (p.mimeType === 'text/html' && p.body?.data) {
      const html = Buffer.from(p.body.data, 'base64url').toString('utf8');
      return html.replace(/<[^>]+>/g, ' ');
    }
  }
  // Top-level body (non-multipart)
  if (msgData?.payload?.body?.data) {
    return Buffer.from(msgData.payload.body.data, 'base64url').toString('utf8');
  }
  return '';
}

function collectParts(part, out) {
  if (!part) return;
  out.push(part);
  for (const sub of part.parts || []) collectParts(sub, out);
}

// Gmail OTP reader for FastTrack CRM auto-capture.
//
// Polls the Gmail inbox for the most-recent email that arrived AFTER a given
// timestamp and contains a 6-digit code. Used by capture-ft-session.mjs so
// the FT login can complete headlessly without human OTP entry.
//
// Requires the OAuth token to include gmail.readonly scope.
// Enable Gmail API in GCP: https://console.cloud.google.com/apis/library/gmail.googleapis.com

import { getGoogleAuth, loadGoogleapis } from './google-auth.js';

const POLL_INTERVAL_MS = 4000;

/**
 * Wait for a 6-digit OTP to appear in the inbox after `afterMs`.
 * @param {object} opts
 * @param {number} opts.afterMs    - Unix ms timestamp; ignore emails older than this
 * @param {number} opts.timeoutMs  - Give up after this many ms (default 2 min)
 * @returns {Promise<string>}      - The 6-digit code
 */
export async function waitForFtOtp({ afterMs = Date.now(), timeoutMs = 120_000 } = {}) {
  const { client } = await getGoogleAuth();
  const { google } = await loadGoogleapis();
  const gmail = google.gmail({ version: 'v1', auth: client });

  // Gmail `after:` filter uses Unix seconds
  const afterSec = Math.floor(afterMs / 1000);
  const deadline = Date.now() + timeoutMs;

  process.stdout.write('  Waiting for OTP email');

  // Track seen message IDs so we don't re-process
  const seen = new Set();

  while (Date.now() < deadline) {
    await delay(POLL_INTERVAL_MS);
    process.stdout.write('.');

    let listRes;
    try {
      listRes = await gmail.users.messages.list({
        userId: 'me',
        q: `after:${afterSec}`,
        maxResults: 10,
      });
    } catch (e) {
      if (e.code === 403 || String(e.message).includes('Gmail API')) {
        throw new Error(
          'Gmail API not accessible. Make sure:\n' +
          '  1. Gmail API is enabled in GCP → https://console.cloud.google.com/apis/library/gmail.googleapis.com\n' +
          '  2. OAuth token includes gmail.readonly scope → re-run: node bin/sheets-oauth.mjs\n' +
          `  (original error: ${e.message})`
        );
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

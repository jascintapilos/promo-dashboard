// Shared outward-notification helpers: Slack posts + the PromoOps Control
// Layer Notifications feed (which the unified dashboard renders as its
// activity feed — last ~15 rows, see apps-script Code.gs getDashboardData).
// Used by bin/brand-watch.mjs (Wave 2 digest). bin/banner-health-check.mjs
// predates this module and still carries its own copies — fold it in here
// next time that script is touched.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function loadSlackToken() {
  if (process.env.SLACK_TOKEN) return process.env.SLACK_TOKEN;
  try {
    const dir = dirname(fileURLToPath(import.meta.url));
    return JSON.parse(readFileSync(join(dir, '..', 'slack-token.local.json'), 'utf8')).token;
  } catch { return null; }
}

export async function postToSlack(channel, text) {
  const token = loadSlackToken();
  if (!token) throw new Error('SLACK_TOKEN not set and slack-token.local.json not found');
  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ channel, text, unfurl_links: false, unfurl_media: false }),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`Slack chat.postMessage error: ${json.error}`);
  return json;
}

export const CONTROL_LAYER_ID = '16iI85GrAqldbBcGhpvAwJT3_3JJDqLemLaGhjPXMlQk';

// One digest row per run, never one per finding — the feed must not flood.
// Schema: Timestamp|Type|Title|Message|Related_Task|Source|Sent_To_Slack.
export async function appendDashboardNotification({ type, title, message, source }) {
  const { getGoogleAuth, loadGoogleapis } = await import('./google-auth.js');
  const { client } = await getGoogleAuth();
  const { google } = await loadGoogleapis();
  const sheets = google.sheets({ version: 'v4', auth: client });
  const row = [new Date().toISOString(), type, title, message, '', source || 'promo-automation', 'FALSE'];
  await sheets.spreadsheets.values.append({
    spreadsheetId: CONTROL_LAYER_ID,
    range: "'Notifications'!A1",
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });
}

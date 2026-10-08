// Direct FastTrack /crm-api reader — replaces the Google Apps Script relay in
// pull-ft-campaigns.mjs. Confirmed 2026-10-08: the VDI can hit /crm-api directly
// for all instances (WS1 is NOT Cloudflare-blocked when a live portaltoken
// cookie is sent), so the fragile GAS relay is no longer needed.
//
// Returns the SAME shape the old relay produced:
//   { users, segments, activities, changelogs, segFilters }
// so the rest of pull-ft-campaigns.mjs is unchanged.
//
// The API envelope is { Data, Success, Errors }. Creator attribution needs a
// per-activity Changelog call, so results are cached in
// ft-changelog-cache-<instance>.local.json — nightly runs only fetch NEW activities.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

// host + tenant per instance. QP2 tenant not yet captured (needs a qp2 session).
export const FT_API = {
  ws1:   { base: 'https://mb8.ft-crm.com',            tenant: 'x2avv90vh1' },
  qpro1: { base: 'https://alpha-iota-qp1.ft-crm.com', tenant: '2jdauyjn44' },
  qp2:   { base: 'https://alpha-iota-qp2.ft-crm.com', tenant: 'htu9p48vmh' },
};

export async function ftDirectFetch(instance, token, cookieStr, { year, concurrency = 6 } = {}) {
  const api = FT_API[instance];
  if (!api) throw new Error(`ftDirectFetch: unknown instance "${instance}"`);
  if (!api.tenant) throw new Error(`ftDirectFetch: no tenant id for "${instance}" yet — capture it from a live session first (config.json CRM_API_URL / CDP).`);
  const root = `${api.base}/crm-api/${api.tenant}`;
  const H = { authtoken: token, cookie: cookieStr || '', 'content-type': 'application/json', accept: 'application/json' };

  async function call(pathPart, method = 'GET', body) {
    const res = await fetch(`${root}/${pathPart}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    if (!res.ok || /^\s*<(!doctype|html)/i.test(text)) {
      const hint = /cloudflare|just a moment/i.test(text) ? ' (Cloudflare — session invalid/expired)' : '';
      throw new Error(`FT ${instance} ${pathPart} → ${res.status}${hint}`);
    }
    let j; try { j = JSON.parse(text); } catch { throw new Error(`FT ${instance} ${pathPart}: non-JSON response`); }
    if (j.Success === false) throw new Error(`FT ${instance} ${pathPart}: ${JSON.stringify(j.Errors).slice(0, 120)}`);
    return j.Data;
  }

  const [users, segments, activities] = await Promise.all([
    call('Authentication/AdminUsers'),
    call('ActivityManager/Segments/ByCategory/1'),
    call('ActivityManager/Activities/GetActivities', 'POST', { archived: false, activityTypeId: 1 }),
  ]);

  // Changelogs: only for YTD one-off activities (TriggerTypeId 2) — the only ones
  // the pull keeps — and cached so we don't refetch every run.
  const cacheFile = path.resolve(`ft-changelog-cache-${instance}.local.json`);
  let clCache = {};
  if (existsSync(cacheFile)) { try { clCache = JSON.parse(readFileSync(cacheFile, 'utf8')); } catch { clCache = {}; } }

  const ytdOneOff = (activities || []).filter((a) => {
    const d = String(a.SignedDate || a.ExecutionDateTime || '');
    return d.slice(0, 4) === String(year) && a.TriggerTypeId === 2;
  });
  const need = ytdOneOff.filter((a) => !clCache[String(a.ActivityId)]);

  let i = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, need.length) }, async () => {
    while (i < need.length) {
      const a = need[i++];
      try {
        const entries = await call(`Changelog/Entity/activity/${a.ActivityId}`);
        clCache[String(a.ActivityId)] = (entries || []).map((e) => ({ operationType: e.operationType, userId: e.userId }));
      } catch {
        clCache[String(a.ActivityId)] = []; // mark attempted; falls back to SignedBy
      }
    }
  }));
  try { writeFileSync(cacheFile, JSON.stringify(clCache)); } catch { /* non-fatal */ }

  // Return only the changelogs for this run's YTD one-off activities.
  const changelogs = {};
  for (const a of ytdOneOff) changelogs[String(a.ActivityId)] = clCache[String(a.ActivityId)] || [];

  return { users: users || [], segments: segments || [], activities: activities || [], changelogs, segFilters: {} };
}

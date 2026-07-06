#!/usr/bin/env node
/**
 * Pull FastTrack CRM data by running API calls INSIDE the AdsPower browser tab.
 * FT CRM binds the portaltoken to the originating IP — GAS relay won't work.
 * This script connects via CDP and executes all FT API calls within the browser
 * where the session was created.
 *
 * Usage:
 *   node bin/pull-ft-via-browser.mjs --instance=ws1 [--write]
 *
 * The --write flag appends rows to the Google Sheet (same as pull-ft-campaigns.mjs).
 *
 * REQUIRES: AdsPower must be running with an open, logged-in FT tab for the
 * target instance. CDP port is auto-detected from DevToolsActivePort.
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { parseArgs } from './_args.js';
import { getCdpWsUrl } from './_cdp-url.js';

const { flags } = parseArgs(process.argv.slice(2));
const INSTANCE = flags.instance || 'ws1';
const WRITE    = flags.write === true;

const INSTANCES = {
  ws1:   { host: 'mb8.ft-crm.com',            label: 'WS1' },
  qpro1: { host: 'alpha-iota-qp1.ft-crm.com', label: 'QPRO1' },
  qp2:   { host: 'alpha-iota-qp2.ft-crm.com', label: 'QP2' },
};

const { host, label } = INSTANCES[INSTANCE] || {};
if (!host) { console.error('Unknown instance:', INSTANCE); process.exit(1); }

// ── Browser script (runs inside the FT tab) ───────────────────────────────────
// Plain function string — no Node.js imports. Uses browser fetch + cookies.
function buildBrowserScript(year, apiBase) {
  return `(async () => {
    const pt = document.cookie.split(';').map(c=>c.trim()).find(c=>c.startsWith('portaltoken='));
    const token = pt ? pt.split('=').slice(1).join('=') : null;
    if (!token) return { error: 'no portaltoken cookie' };

    // API base detected by Node.js side via CDP Network events before this script runs.
    const API = ${JSON.stringify(apiBase)};

    function h() { return { authtoken: token, Accept: 'application/json', 'Content-Type': 'application/json' }; }

    async function ftGet(path) {
      const r = await fetch(API + path, { credentials: 'include', headers: h() });
      const ct = r.headers.get('content-type') || '';
      if (!ct.includes('json')) {
        const txt = await r.text();
        if (txt.includes('<!DOCTYPE') || txt.includes('<html')) return { error: 'session_expired', path, status: r.status };
        throw new Error('non-JSON from ' + path + ': ' + txt.slice(0,120));
      }
      return r.json();
    }
    async function ftPost(path, body) {
      const r = await fetch(API + path, { method: 'POST', credentials: 'include', headers: h(), body: JSON.stringify(body) });
      const ct = r.headers.get('content-type') || '';
      if (!ct.includes('json')) {
        const txt = await r.text();
        if (txt.includes('<!DOCTYPE') || txt.includes('<html')) return { error: 'session_expired', path, status: r.status };
        throw new Error('non-JSON from ' + path + ': ' + txt.slice(0,120));
      }
      return r.json();
    }

    const usersData = await ftGet('Authentication/AdminUsers');
    if (usersData.error === 'session_expired') return { error: 'Session expired or not logged in — please log into ' + location.hostname + ' and retry' };
    if (!usersData.Success) return { error: 'AdminUsers: ' + (usersData.Errors?.[0]?.Message || 'failed') };

    const segsData = await ftGet('ActivityManager/Segments/ByCategory/1');
    const actsData = await ftPost('ActivityManager/Activities/GetActivities', { archived: false, activityTypeId: 1 });

    const year = ${JSON.stringify(year)};
    const ytdActs = (actsData?.Data || []).filter(a => {
      const d = a.SignedDate || a.ExecutionDateTime || '';
      return d.slice(0, 4) === year && a.TriggerTypeId === 2;
    });

    const changelogs = {};
    const BATCH = 20;
    for (let i = 0; i < ytdActs.length; i += BATCH) {
      const batch = ytdActs.slice(i, i + BATCH);
      const results = await Promise.all(batch.map(a =>
        fetch(API + 'Changelog/Entity/activity/' + a.ActivityId, { credentials: 'include', headers: h() })
          .then(r => r.json()).catch(() => null)
      ));
      batch.forEach((a, idx) => {
        if (results[idx]?.Data) changelogs[String(a.ActivityId)] = results[idx].Data;
      });
    }

    function extractRegion(text) {
      const t = (text || '').toUpperCase();
      if (t.includes('MYR') || /\\bRM\\d/.test(t)) return 'MY';
      if (t.includes('SGD')) return 'SG';
      if (t.includes('IDR')) return 'ID';
      if (/\\bMYS?\\b/.test(t)) return 'MY';
      if (/\\bSGP?\\b/.test(t)) return 'SG';
      if (/\\bIDN?\\b/.test(t)) return 'ID';
      if (/\\bTH\\b/.test(t)) return 'TH';
      if (/\\bKH\\b/.test(t)) return 'KH';
      const em = t.match(/(?:QP|WS|BP|MB)[0-9A-Z]*(MY|SG|ID|TH|KH)/);
      return em ? em[1] : '';
    }

    const segMap = {};
    (segsData?.Data || []).forEach(s => { segMap[s.SegmentId] = s.SegmentName; });

    const noRegionIds = [];
    const seen = {};
    ytdActs.forEach(a => {
      if (!a.SegmentId || seen[a.SegmentId]) return;
      const seg = segMap[a.SegmentId] || a.ActivityName || '';
      if (!extractRegion(seg) && !extractRegion(a.ActivityName || '')) {
        noRegionIds.push(a.SegmentId);
        seen[a.SegmentId] = true;
      }
    });

    const segFilters = {};
    for (let j = 0; j < noRegionIds.length; j += 50) {
      try {
        const gsr = await ftPost('ActivityManager/Segments/GetSelective', noRegionIds.slice(j, j + 50));
        (gsr?.Data || []).forEach(s => { if (s.SegmentFilter) segFilters[String(s.SegmentId)] = s.SegmentFilter; });
      } catch (_) {}
    }

    return {
      users:      usersData.Data || [],
      segments:   segsData?.Data  || [],
      activities: actsData?.Data  || [],
      changelogs,
      segFilters,
    };
  })()`;
}

// ── Main ──────────────────────────────────────────────────────────────────────
console.log(`FastTrack CRM pull (browser relay) — ${label} (${INSTANCE})`);
console.log(`Mode: ${WRITE ? 'WRITE' : 'DRY RUN'}\n`);

console.log('Probing SunBrowser CDP…');
const cdpWs = await getCdpWsUrl();
console.log(`CDP: ${cdpWs.slice(0, 60)}…`);

const browser = await chromium.connectOverCDP(cdpWs);

// Search ALL contexts (each AdsPower profile is a separate context)
const allPages = browser.contexts().flatMap(c => c.pages());
const ftPage = allPages.find(p => p.url().includes(host));

if (!ftPage) {
  console.error(`\nNo open FT page found for ${host}`);
  console.error('Open pages across all contexts:',
    allPages.map(p => p.url()).join('\n  ') || '(none)');
  console.error(`\nPlease open ${host} in AdsPower and log in, then re-run.`);
  await browser.close().catch(() => {});
  process.exit(1);
}

if (ftPage.url().includes('/login')) {
  console.error(`FT tab is on login page (${ftPage.url()}). Please log in first.`);
  await browser.close().catch(() => {});
  process.exit(1);
}

console.log(`Using FT tab: ${ftPage.url()}`);

// ── Discover the versioned API prefix via CDP network events ──────────────────
// FT CRM injects a path segment (e.g. /crm-api/x2avv90vh1/) that changes per
// deployment. We sniff one real API request to extract it, falling back to a
// direct probe of known candidate prefixes.
let apiBase = '/crm-api/'; // default fallback

const cdpSession = await ftPage.context().newCDPSession(ftPage);
await cdpSession.send('Network.enable');

const apiPrefixPromise = new Promise(resolve => {
  cdpSession.on('Network.requestWillBeSent', ({ request }) => {
    const m = request.url.match(/\/crm-api\/([a-z0-9]+)\//);
    if (m) resolve('/crm-api/' + m[1] + '/');
  });
  // Resolve with null after 5s if no API call fires
  setTimeout(() => resolve(null), 5000);
});

// Trigger a lightweight API call so CDP captures its URL
await ftPage.evaluate(() => {
  const pt = document.cookie.split(';').map(c=>c.trim()).find(c=>c.startsWith('portaltoken='));
  const token = pt ? pt.split('=').slice(1).join('=') : null;
  // Fire and forget — we only need CDP to see the request
  fetch('/crm-api/', { credentials: 'include', headers: { authtoken: token } }).catch(() => {});
}).catch(() => {});

const detected = await apiPrefixPromise;
await cdpSession.send('Network.disable').catch(() => {});
await cdpSession.detach().catch(() => {});

if (detected) {
  apiBase = detected;
  console.log(`API base detected: ${apiBase}`);
} else {
  // Probe candidate prefixes directly
  console.log('Network sniff timed out — probing known prefixes…');
  const candidates = await ftPage.evaluate(async () => {
    return performance.getEntriesByType('resource')
      .map(e => { const m = e.name.match(/\/crm-api\/([a-z0-9]+)\//); return m ? '/crm-api/' + m[1] + '/' : null; })
      .filter(Boolean);
  });
  if (candidates.length > 0) {
    apiBase = candidates[0];
    console.log(`API base from perf entries: ${apiBase}`);
  } else {
    console.log(`API base: using fallback ${apiBase}`);
  }
}

console.log('Running API calls inside the browser…');

const year = String(new Date().getFullYear());
const result = await ftPage.evaluate(new Function(`return ${buildBrowserScript(year, apiBase)}`));

await browser.close().catch(() => {});

if (result.error) {
  console.error('Browser script error:', result.error);
  process.exit(1);
}

const { users, segments, activities, changelogs, segFilters } = result;
console.log(`\n  ${users.length} users, ${segments.length} segments, ${activities.length} activities`);
console.log(`  ${Object.keys(changelogs).length} changelogs, ${Object.keys(segFilters).length} segment filters`);

// Instance-scoped temp file — prevents clobber if instances run concurrently
const tmpFile = path.resolve(`tmp-ft-browser-pull-${INSTANCE}.json`);
writeFileSync(tmpFile, JSON.stringify({
  instance: INSTANCE, label, pulledAt: new Date().toISOString(),
  users, segments, activities, changelogs, segFilters,
}, null, 2));
console.log(`\nData written to ${tmpFile}`);
console.log('\nProcessing rows via pull-ft-campaigns.mjs…');

const args = [path.resolve('bin/pull-ft-campaigns.mjs'), `--instance=${INSTANCE}`, '--from-browser-pull'];
if (WRITE) args.push('--write');
const child = spawn(process.execPath, args, { stdio: 'inherit', cwd: process.cwd() });
await new Promise((resolve, reject) => {
  child.on('exit', code => code === 0 ? resolve() : reject(new Error(`pull-ft-campaigns.mjs exited ${code}`)));
});

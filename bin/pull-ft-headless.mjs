#!/usr/bin/env node
/**
 * Pull FastTrack CRM data fully unattended — no AdsPower, no human.
 *
 * pull-ft-via-browser.mjs requires a human to have already opened AdsPower
 * and logged into the target FT instance, which is why the nightly cron
 * (run overnight, unattended) fails every time it reaches that step. The
 * old fallback — pull-ft-campaigns.mjs's GAS relay — is separately broken:
 * FT rotates a versioned API path segment (e.g. /crm-api/x2avv90vh1/) per
 * deployment, and the static Apps Script has no way to discover the current
 * one, so every relay call now 404s into FT's HTML shell.
 *
 * This script gets the best of both: it launches its own headless Chromium
 * (reusing the FT CRM Keepalive's stored SSO profile — see
 * refresh-ft-sessions.mjs — so no OTP is needed on the common path, with
 * auto-recapture via capture-ft-session.mjs as a fallback), then runs the
 * exact same in-page API-prefix-sniff + fetch script pull-ft-via-browser.mjs
 * runs against AdsPower — just against its own page instead of a human's.
 *
 * Usage:
 *   node bin/pull-ft-headless.mjs --instance=ws1 [--write]
 *   node bin/pull-ft-headless.mjs --instance=qpro1 --write
 *   node bin/pull-ft-headless.mjs --instance=qp2 --write
 */
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
chromium.use(StealthPlugin());
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { parseArgs } from './_args.js';

const { flags } = parseArgs(process.argv.slice(2));
const INSTANCE = flags.instance || 'ws1';
const WRITE    = flags.write === true;

const INSTANCES = {
  ws1:   { url: 'https://mb8.ft-crm.com/',                   host: 'mb8.ft-crm.com',            label: 'WS1' },
  qpro1: { url: 'https://alpha-iota-qp1.ft-crm.com/',        host: 'alpha-iota-qp1.ft-crm.com', label: 'QPRO1' },
  qp2:   { url: 'https://alpha-iota-qp2.ft-crm.com/v2/',     host: 'alpha-iota-qp2.ft-crm.com', label: 'QP2' },
};

const { url: LOGIN_URL, host, label } = INSTANCES[INSTANCE] || {};
if (!host) { console.error('Unknown instance:', INSTANCE); process.exit(1); }

// ── Browser script (runs inside the FT tab) — based on pull-ft-via-browser.mjs,
// hardened with per-request timeouts (a single stalled fetch — e.g. Cloudflare
// silently dropping a connection to a headless client — otherwise hangs the
// whole Promise.all batch forever, since .catch() only sees rejections, not
// requests that just never settle) and progress logging for long QP2-sized runs.
function buildBrowserScript(year, apiBase) {
  return `(async () => {
    const pt = document.cookie.split(';').map(c=>c.trim()).find(c=>c.startsWith('portaltoken='));
    const token = pt ? pt.split('=').slice(1).join('=') : null;
    if (!token) return { error: 'no portaltoken cookie' };

    const API = ${JSON.stringify(apiBase)};
    const TIMEOUT_MS = 20000;

    function h() { return { authtoken: token, Accept: 'application/json', 'Content-Type': 'application/json' }; }

    async function fetchT(url, opts) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      try {
        return await fetch(url, { ...opts, signal: ctrl.signal });
      } finally {
        clearTimeout(timer);
      }
    }

    async function ftGet(path) {
      const r = await fetchT(API + path, { credentials: 'include', headers: h() });
      const ct = r.headers.get('content-type') || '';
      if (!ct.includes('json')) {
        const txt = await r.text();
        if (txt.includes('<!DOCTYPE') || txt.includes('<html')) return { error: 'session_expired', path, status: r.status };
        throw new Error('non-JSON from ' + path + ': ' + txt.slice(0,120));
      }
      return r.json();
    }
    async function ftPost(path, body) {
      const r = await fetchT(API + path, { method: 'POST', credentials: 'include', headers: h(), body: JSON.stringify(body) });
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

    console.log('Fetching ' + ytdActs.length + ' changelogs…');
    const changelogs = {};
    const BATCH = 20;
    for (let i = 0; i < ytdActs.length; i += BATCH) {
      const batch = ytdActs.slice(i, i + BATCH);
      const results = await Promise.all(batch.map(a =>
        fetchT(API + 'Changelog/Entity/activity/' + a.ActivityId, { credentials: 'include', headers: h() })
          .then(r => r.json()).catch(() => null)
      ));
      batch.forEach((a, idx) => {
        if (results[idx]?.Data) changelogs[String(a.ActivityId)] = results[idx].Data;
      });
      console.log('  changelogs ' + Math.min(i + BATCH, ytdActs.length) + '/' + ytdActs.length);
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

    if (noRegionIds.length) console.log('Fetching segment filters for ' + noRegionIds.length + ' unresolved segments…');
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
console.log(`FastTrack CRM pull (headless, unattended) — ${label} (${INSTANCE})`);
console.log(`Mode: ${WRITE ? 'WRITE' : 'DRY RUN'}\n`);

const profileFile = path.resolve(`ft-profile-${INSTANCE}.local.json`);
if (!existsSync(profileFile)) {
  console.error(`No profile found for "${INSTANCE}" — run once manually: node bin/capture-ft-session.mjs --instance=${INSTANCE}`);
  process.exit(1);
}

async function openLoggedInPage() {
  const profile = JSON.parse(readFileSync(profileFile, 'utf8'));
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const ctx = await browser.newContext({ storageState: profile.storageState, viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(1500);
    const u = page.url();
    if (u.includes(host) && !u.includes('/login') && !u.includes('/signin') && u !== LOGIN_URL) break;
  }

  const currentUrl = page.url();
  const isLoggedIn = currentUrl.includes(host) && !currentUrl.includes('/login') && !currentUrl.includes('/signin');
  if (!isLoggedIn) {
    await browser.close().catch(() => {});
    return null;
  }
  return { browser, page };
}

console.log('Opening headless session from stored SSO profile…');
let session = await openLoggedInPage();

if (!session) {
  console.log('Stored profile expired — running full headless re-login (Gmail OTP + TOTP)…');
  execFileSync(process.execPath, ['bin/capture-ft-session.mjs', `--instance=${INSTANCE}`], { stdio: 'inherit', cwd: process.cwd() });
  session = await openLoggedInPage();
  if (!session) {
    console.error(`Still not logged in after re-capture. Aborting — check logs above.`);
    process.exit(1);
  }
}

const { browser, page } = session;
console.log(`Logged in: ${page.url()}`);
// type 'log' = our own progress console.log() calls inside buildBrowserScript.
// FT's page has a report-only CSP that spams a console 'error'/'warning' entry
// on every single fetch() — excluding those keeps this signal instead of noise.
page.on('console', (msg) => { if (msg.type() === 'log') console.log(`  [page] ${msg.text()}`); });

// ── Discover the versioned API prefix via CDP network events ──────────────────
let apiBase = '/crm-api/';
const cdpSession = await page.context().newCDPSession(page);
await cdpSession.send('Network.enable');

const apiPrefixPromise = new Promise(resolve => {
  cdpSession.on('Network.requestWillBeSent', ({ request }) => {
    const m = request.url.match(/\/crm-api\/([a-z0-9]+)\//);
    if (m) resolve('/crm-api/' + m[1] + '/');
  });
  setTimeout(() => resolve(null), 5000);
});

await page.evaluate(() => {
  const pt = document.cookie.split(';').map(c=>c.trim()).find(c=>c.startsWith('portaltoken='));
  const token = pt ? pt.split('=').slice(1).join('=') : null;
  fetch('/crm-api/', { credentials: 'include', headers: { authtoken: token } }).catch(() => {});
}).catch(() => {});

const detected = await apiPrefixPromise;
await cdpSession.send('Network.disable').catch(() => {});
await cdpSession.detach().catch(() => {});

if (detected) {
  apiBase = detected;
  console.log(`API base detected: ${apiBase}`);
} else {
  console.log('Network sniff timed out — probing known prefixes…');
  const candidates = await page.evaluate(async () => {
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

console.log('Running API calls inside the headless page…');

const year = String(new Date().getFullYear());
// Per-request timeouts inside buildBrowserScript handle individual stalled
// fetches; this is the backstop in case something outside those loops hangs.
const OVERALL_TIMEOUT_MS = 10 * 60 * 1000;
const evalPromise = page.evaluate(new Function(`return ${buildBrowserScript(year, apiBase)}`));
const result = await Promise.race([
  evalPromise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`Page script exceeded ${OVERALL_TIMEOUT_MS / 1000}s`)), OVERALL_TIMEOUT_MS)),
]).catch(async (e) => {
  await browser.close().catch(() => {});
  console.error(e.message);
  process.exit(1);
});

await browser.close().catch(() => {});

if (result.error) {
  console.error('Browser script error:', result.error);
  process.exit(1);
}

const { users, segments, activities, changelogs, segFilters } = result;
console.log(`\n  ${users.length} users, ${segments.length} segments, ${activities.length} activities`);
console.log(`  ${Object.keys(changelogs).length} changelogs, ${Object.keys(segFilters).length} segment filters`);

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

#!/usr/bin/env node
/**
 * Silently refresh FT CRM session tokens using stored browser profiles.
 *
 * How it works:
 *   1. Loads the saved storageState (all cookies: Google, WorkOS, FT CRM).
 *   2. Opens a headless Chrome and navigates to the FT URL.
 *   3. If the underlying Google/WorkOS session is still valid, the SSO chain
 *      completes automatically — no OTP, no user interaction.
 *   4. Extracts the fresh portaltoken and saves ft-session-{instance}.local.json.
 *
 * Profiles are built by capture-ft-session.mjs on first use.
 * They stay valid as long as the Google/WorkOS session is alive (typically 30–90 days).
 * When refresh fails, re-run: node bin/capture-ft-session.mjs --instance=<name>
 *
 * Usage:
 *   node bin/refresh-ft-sessions.mjs                    ← refresh all 3
 *   node bin/refresh-ft-sessions.mjs --instance=ws1
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from './_args.js';

const { flags } = parseArgs(process.argv.slice(2));

const ALL_INSTANCES = {
  ws1:   { url: 'https://mb8.ft-crm.com/',               label: 'WS1/WS2' },
  qpro1: { url: 'https://alpha-iota-qp1.ft-crm.com/',    label: 'QPRO1' },
  qp2:   { url: 'https://alpha-iota-qp2.ft-crm.com/v2/', label: 'QP2A–D' },
};

if (flags.instance && !ALL_INSTANCES[flags.instance]) {
  console.error(`Unknown instance "${flags.instance}". Use: ws1 | qpro1 | qp2`);
  process.exit(1);
}

const instances = flags.instance ? [flags.instance] : Object.keys(ALL_INSTANCES);
let allOk = true;

async function isPortalTokenValid(loginUrl, token) {
  const base = new URL(loginUrl).origin;
  try {
    const res = await fetch(`${base}/crm-api/Authentication/AdminUsers`, {
      headers: { authtoken: token, Accept: 'application/json' },
    });
    if (!res.ok) return false;
    const data = await res.json().catch(() => null);
    return data?.Success !== false;
  } catch { return false; }
}

for (const instance of instances) {
  const { url: LOGIN_URL, label } = ALL_INSTANCES[instance];
  const profileFile = path.resolve(`ft-profile-${instance}.local.json`);
  const sessionFile = path.resolve(`ft-session-${instance}.local.json`);

  process.stdout.write(`[${instance}] ${label}: `);

  if (!existsSync(profileFile)) {
    console.log(`❌  No profile found — run once manually: node bin/capture-ft-session.mjs --instance=${instance}`);
    allOk = false;
    continue;
  }

  const profile = JSON.parse(readFileSync(profileFile, 'utf8'));
  let browser;

  try {
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const ctx = await browser.newContext({
      storageState: profile.storageState,
      viewport: { width: 1440, height: 900 },
    });
    const page = await ctx.newPage();

    // Navigate — valid session lands on app dashboard; expired session redirects through SSO.
    // With a live Google/WorkOS session the SSO chain completes silently; we just wait for it.
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Wait up to 25s for the redirect chain to settle on the main app
    const host     = new URL(LOGIN_URL).hostname;
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      await page.waitForTimeout(1500);
      const u = page.url();
      if (u.includes(host) && !u.includes('/login') && !u.includes('/signin') && u !== LOGIN_URL) break;
    }

    const currentUrl = page.url();
    const isLoggedIn = currentUrl.includes(host)
      && !currentUrl.includes('/login')
      && !currentUrl.includes('/signin');

    if (!isLoggedIn) {
      console.log(`⟳   Session expired — running auto-capture (headless)…`);
      console.log(`    (redirected to: ${currentUrl.slice(0, 80)})`);
      await browser.close();
      // Auto-capture via Gmail OTP
      const { execFileSync } = await import('node:child_process');
      try {
        execFileSync(process.execPath, ['bin/capture-ft-session.mjs', `--instance=${instance}`], {
          stdio: 'inherit',
          cwd: process.cwd(),
        });
        console.log(`✅  Auto-captured new session for ${instance}`);
      } catch (captureErr) {
        console.log(`❌  Auto-capture failed for ${instance}: ${captureErr.message}`);
        console.log(`    Re-run manually: node bin/capture-ft-session.mjs --instance=${instance}`);
        allOk = false;
      }
      continue;
    }

    // Wait an extra moment for the app JS to set / refresh cookies
    await page.waitForTimeout(2000);

    const cookies = await ctx.cookies();
    const lsAll   = await page.evaluate(() => {
      const out = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        out[k] = localStorage.getItem(k);
      }
      return out;
    }).catch(() => ({}));

    const portalCookie = cookies.find(c => c.name === 'portaltoken' && c.domain.includes(host));
    if (!portalCookie?.value) {
      console.log(`❌  No portaltoken after navigation — re-capture: node bin/capture-ft-session.mjs --instance=${instance}`);
      allOk = false;
      await browser.close();
      continue;
    }

    // Validate the token server-side — a stale portaltoken can survive page loads
    // (the browser UI stays alive on other session cookies) but fails API calls.
    const apiOk = await isPortalTokenValid(LOGIN_URL, portalCookie.value);
    if (!apiOk) {
      console.log(`⟳   portaltoken expired server-side — forcing full re-capture…`);
      await browser.close();
      const { execFileSync } = await import('node:child_process');
      try {
        execFileSync(process.execPath, ['bin/capture-ft-session.mjs', `--instance=${instance}`], {
          stdio: 'inherit', cwd: process.cwd(),
        });
        console.log(`✅  Re-captured fresh session for ${instance}`);
      } catch (captureErr) {
        console.log(`❌  Re-capture failed for ${instance}: ${captureErr.message}`);
        allOk = false;
      }
      continue;
    }

    // Persist refreshed session (keep original label/loginUrl)
    const prev = existsSync(sessionFile) ? JSON.parse(readFileSync(sessionFile, 'utf8')) : {};
    writeFileSync(sessionFile, JSON.stringify({
      ...prev,
      instance,
      label,
      loginUrl:    LOGIN_URL,
      cookies,
      localStorage: lsAll,
      refreshedAt: new Date().toISOString(),
    }, null, 2));

    // Update profile with latest storageState so next refresh has fresh SSO cookies
    profile.storageState = await ctx.storageState();
    profile.refreshedAt  = new Date().toISOString();
    writeFileSync(profileFile, JSON.stringify(profile, null, 2));

    const exp    = portalCookie.expires || 0;
    const expStr = exp > 0 ? `valid until ${new Date(exp * 1000).toISOString()}` : 'session cookie';
    console.log(`✅  Refreshed (${expStr})`);

    await browser.close();

  } catch (e) {
    await browser?.close().catch(() => {});
    console.log(`❌  Error: ${e.message}`);
    allOk = false;
  }
}

if (!allOk) {
  console.log('\n⚠  One or more instances failed. Re-capture those manually, then retry.');
  process.exit(1);
}

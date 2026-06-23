#!/usr/bin/env node
// Open the QPRO1 BO Create Promotion form, pick Free Spin + PP - Pragmatic Play,
// and intercept every API call. The Games dropdown population fetch is the
// one we need to identify so the API-direct mapper can resolve game codes.

import { chromium } from 'playwright';
import { getSite } from '../src/sites.js';

const SITE_ID = 'qpro1';
const site = getSite(SITE_ID);

const browser = await chromium.launch({
  headless: false,
  slowMo: 50,
  channel: 'chrome',
  args: ['--start-maximized'],
});
const ctx = await browser.newContext({ viewport: null });
const page = await ctx.newPage();

const calls = [];
page.on('request', (req) => {
  const url = req.url();
  if (url.includes('/api/bo/')) {
    calls.push({ ts: Date.now(), method: req.method(), url, post: req.postData() });
  }
});

const boUrl = site.baseUrl || site.apiHost.replace('api.', 'bo.');
console.log('Opening', boUrl);
await page.goto(boUrl);

// Login
await page.locator('input[formcontrolname="merchant_code"]').waitFor({ timeout: 30000 });
await page.fill('input[formcontrolname="merchant_code"]', site.loginMerchantCode);
await page.fill('input[formcontrolname="username"]', site.username);
await page.fill('input[formcontrolname="password"]', site.password);
const loginResp = page.waitForResponse((r) => r.url().includes('/api/bo/login') && r.status() === 200, { timeout: 20000 });
await page.locator('button:has-text("Login")').click();
await loginResp;
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
console.log('Logged in.');

// Navigate to Create Promotion
await page.goto(boUrl + '/general/promotion-codes', { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1500);
await page.locator('button:has-text("Create")').first().click();
await page.waitForTimeout(2500);
console.log('Create form open. Picking promo_type=Free Spin…');

const formScope = page.locator('form:has(input[formcontrolname="code"])').last();

// Mark call list at promo-type pick
calls.push({ marker: '--- BEFORE promo_type=Free Spin ---' });
await formScope.locator('select[formcontrolname="promo_type"]').selectOption({ label: 'Free Spin' });
await page.waitForTimeout(2500);

let sampleGames = [];
try {
  calls.push({ marker: '--- BEFORE FS provider PP - Pragmatic Play ---' });
  const fsLabel = formScope.locator('span.kt-font-bold', { hasText: /Free Spin Games/i }).first();
  await fsLabel.waitFor({ timeout: 10000 });
  const providerTrigger = fsLabel.locator('xpath=following::*[contains(@class,"c-btn")]').nth(0);
  await providerTrigger.click();
  await page.waitForTimeout(1500);
  // Try multiple panel selectors and option label formats
  const panelOpts = await page.locator('.dropdown-list:visible li, ul.dropdown-list:visible li').allTextContents();
  console.log('Provider panel options:', panelOpts.slice(0, 10));
  // Find the PP entry (try several formats)
  const ppItem = page.locator('.dropdown-list:visible li, ul.dropdown-list:visible li').filter({ hasText: /Pragmatic Play/i }).first();
  await ppItem.click({ timeout: 5000 });
  await page.waitForTimeout(4000);
  console.log('Provider picked. Waiting for Games fetch…');
  calls.push({ marker: '--- AFTER provider pick (Games endpoint should be in here) ---' });

  // Click Games trigger
  const gameTrigger = fsLabel.locator('xpath=following::*[contains(@class,"c-btn")]').nth(1);
  await gameTrigger.click();
  await page.waitForTimeout(2000);
  sampleGames = await page.locator('.dropdown-list:visible li').allTextContents();
  console.log('Sample games:', sampleGames.slice(0, 5));
} catch (e) {
  console.log('Probe step failed:', e.message.split('\n')[0]);
} finally {
  const fs = await import('node:fs');
  const out = {
    site: SITE_ID,
    sampleGames: sampleGames.slice(0, 30),
    totalGames: sampleGames.length,
    calls: calls.map((c) => c.marker
      ? c
      : { method: c.method, url: c.url, post: c.post ? c.post.slice(0, 400) : null }),
  };
  const path = 'captures/qpro1-fs-games-endpoint-probe.json';
  fs.writeFileSync(path, JSON.stringify(out, null, 2));
  console.log('Wrote', path);
  await browser.close();
}

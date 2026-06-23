/**
 * Scrape the Promotions Team Dashboard using Playwright.
 * Uses the existing Chrome user profile to reuse Google Workspace SSO session.
 */
import { chromium } from 'playwright';
import path from 'path';
import os from 'os';

const DASHBOARD_URL = 'https://script.google.com/a/macros/thebrandingpeople.co/s/AKfycbx-Hy_OFd55Fbwdsf29LQxh0NxSLWwXWbVsEQ6AFoecWGgANAtsohO88pSJoCHCuHawzQ/exec';
const CHROME_BASE = path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'User Data');
const EDGE_USER_DATA = path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'Edge', 'User Data');
const CHROME_PROFILE = process.env.CHROME_PROFILE || 'Default';

async function extractIframeData(page) {
  // The app renders inside a cross-origin iframe (googleusercontent.com).
  // We wait for the frame to load and extract via its JS context.
  console.log('Waiting for sandboxFrame...');

  // Wait for the outer iframe element
  await page.waitForSelector('#sandboxFrame', { timeout: 30000 });

  // Get the iframe's src
  const frameSrc = await page.$eval('#sandboxFrame', el => el.src);
  console.log('iframe src:', frameSrc.substring(0, 80) + '...');

  // Wait for the iframe to fully load by polling for content
  let frameHandle = null;
  let attempts = 0;
  while (attempts < 20) {
    const frames = page.frames();
    frameHandle = frames.find(f => f.url().includes('googleusercontent.com') || f.url().includes('script.google'));
    if (frameHandle) {
      try {
        const bodyText = await frameHandle.evaluate(() => document.body?.innerText || '');
        if (bodyText.includes('Promotions') || bodyText.includes('PROMO')) {
          console.log('iframe loaded with content');
          break;
        }
      } catch (_) {}
    }
    await page.waitForTimeout(1500);
    attempts++;
  }

  if (!frameHandle) {
    throw new Error('Could not find loaded iframe frame');
  }

  // Extract all data from the iframe
  const data = await frameHandle.evaluate(() => {
    const result = {};

    // 1. Headline metric cards
    const allText = document.body.innerText;
    result.fullText = allText;

    // 2. Try to find metric card values
    const cards = document.querySelectorAll('[class*="card"], [class*="metric"], [class*="stat"]');
    result.cards = Array.from(cards).map(c => c.innerText.trim()).filter(Boolean);

    // 3. Tables
    const tables = document.querySelectorAll('table');
    result.tables = Array.from(tables).map(t => {
      const rows = Array.from(t.querySelectorAll('tr'));
      return rows.map(r =>
        Array.from(r.querySelectorAll('td,th')).map(c => c.innerText.trim()).join(' | ')
      ).join('\n');
    });

    // 4. All headings
    result.headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).map(h => h.innerText.trim());

    // 5. Look for Chart.js data in global scope
    const chartKeys = Object.keys(window).filter(k =>
      k.toLowerCase().includes('chart') ||
      k.toLowerCase().includes('data') ||
      k.toLowerCase().includes('week') ||
      k.toLowerCase().includes('month') ||
      k.toLowerCase().includes('brand')
    );
    result.chartGlobalKeys = chartKeys.slice(0, 20);

    // 6. Try to get Chart.js instances
    if (window.Chart) {
      result.chartInstances = Object.keys(window.Chart.instances || {}).map(k => {
        const c = window.Chart.instances[k];
        return {
          id: k,
          type: c.config?.type,
          labels: c.data?.labels,
          datasets: c.data?.datasets?.map(d => ({
            label: d.label,
            data: d.data
          }))
        };
      });
    }

    return result;
  });

  return data;
}

async function main() {
  console.log('Launching Chrome with existing profile...');

  let browser;
  let context;

  try {
    // Try with existing Chrome profile first (to reuse Google auth)
    context = await chromium.launchPersistentContext(EDGE_USER_DATA, {
      channel: 'msedge',
      headless: false,
      args: [
        `--profile-directory=${CHROME_PROFILE}`,
        '--no-first-run',
        '--no-default-browser-check',
      ],
      ignoreDefaultArgs: ['--enable-automation'],
      viewport: { width: 1600, height: 1200 },
    });
    console.log(`Using Edge profile: ${CHROME_PROFILE}`);
    console.log('Launched with existing Chrome profile');
  } catch (err) {
    console.log('Could not use Chrome profile (may be locked):', err.message);
    console.log('Falling back to fresh Chromium...');
    browser = await chromium.launch({ headless: false });
    context = await browser.newContext();
  }

  const page = await context.newPage();
  page.setDefaultTimeout(60000);

  console.log('Navigating to dashboard...');
  await page.goto(DASHBOARD_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Check if we got redirected to SSO login
  const currentUrl = page.url();
  console.log('Current URL:', currentUrl);

  if (currentUrl.includes('ServiceLogin') || currentUrl.includes('accounts.google.com')) {
    console.log('⚠ Redirected to SSO login — not authenticated. Please log in and re-run.');
    await context.close();
    process.exit(1);
  }

  // Wait for page title
  await page.waitForFunction(
    () => document.title.includes('Dashboard') || document.title.includes('Promotions'),
    { timeout: 30000 }
  );
  console.log('Page title:', await page.title());

  // Give iframe time to load data
  console.log('Waiting 8s for iframe data to load...');
  await page.waitForTimeout(8000);

  const data = await extractIframeData(page);

  console.log('\n=== FULL PAGE TEXT ===');
  console.log(data.fullText?.substring(0, 5000) || '(empty)');

  if (data.tables?.length) {
    console.log('\n=== TABLES ===');
    data.tables.forEach((t, i) => { console.log(`\n-- Table ${i+1} --\n${t}`); });
  }

  if (data.chartInstances?.length) {
    console.log('\n=== CHART DATA ===');
    data.chartInstances.forEach(c => {
      console.log(`\nChart: ${c.type} — labels: ${JSON.stringify(c.labels)}`);
      c.datasets?.forEach(d => console.log(`  ${d.label}: ${JSON.stringify(d.data)}`));
    });
  }

  console.log('\nChart global keys:', data.chartGlobalKeys);

  await context.close();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });

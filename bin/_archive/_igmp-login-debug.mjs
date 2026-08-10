// Diagnostic: log in to one IGMP site, then report URL + visible text + whether
// username/password fields actually received the values. Saves a screenshot.
import { chromium } from 'playwright';
import { igmpBaseUrl } from '../src/igmp-client.js';

const siteId = process.argv[2] || 'ws1-v3-my';
const user = process.argv[3] || process.env.IGMP_USER;
const pass = process.argv[4] || process.env.IGMP_PASS;
if (!user || !pass) {
  console.error('Usage: node _igmp-login-debug.mjs <siteId> <user> <pass>  (or set IGMP_USER/IGMP_PASS env vars)');
  process.exit(1);
}
const loginUrl = `${igmpBaseUrl(siteId)}/Login#PM`;

const browser = await chromium.launch({ headless: false, channel: 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);

// Enumerate all inputs on the page
const inputs = await page.$$eval('input', (els) =>
  els.map((e) => ({ name: e.name, id: e.id, type: e.type, ph: e.placeholder, vis: e.offsetParent !== null })));
console.log('INPUTS:', JSON.stringify(inputs, null, 1));

const userSel = 'input[name="txtUserID"], input[id="txtUserID"], input[placeholder*="Username"], input[placeholder*="username"], input[type="text"]';
const passSel = 'input[name="txtPassword"], input[id="txtPassword"], input[placeholder*="Password"], input[placeholder*="password"], input[type="password"]';
try { await page.fill(userSel, user); } catch (e) { console.log('user fill ERR', e.message); }
try { await page.fill(passSel, pass); } catch (e) { console.log('pass fill ERR', e.message); }

// Read back what got filled
const filled = await page.$$eval('input', (els) =>
  els.filter((e) => e.value).map((e) => ({ name: e.name, id: e.id, type: e.type, value: e.value })));
console.log('FILLED:', JSON.stringify(filled));

const btnSel = 'button[type="submit"], input[type="submit"], button:has-text("Login"), button:has-text("Sign In"), a:has-text("Login")';
const btns = await page.$$eval('button, input[type=submit], a', (els) =>
  els.filter((e) => /log\s?in|sign\s?in|masuk/i.test(e.textContent || e.value || '')).map((e) => ({ tag: e.tagName, text: (e.textContent || e.value || '').trim().slice(0, 30) })));
console.log('LOGIN BUTTONS:', JSON.stringify(btns));
try { await page.click(btnSel); } catch (e) { console.log('click ERR', e.message); }

await page.waitForTimeout(5000);
console.log('URL AFTER SUBMIT:', page.url());
const bodyText = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 600);
console.log('PAGE TEXT:', bodyText);
await page.screenshot({ path: `captures/igmp-login-debug-${siteId}.png` });
console.log('screenshot → captures/igmp-login-debug-' + siteId + '.png');
await browser.close();

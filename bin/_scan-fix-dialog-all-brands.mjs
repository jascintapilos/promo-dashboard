// Scan + fix dialog content for the P124-P163 batch across:
//   - QP2D (ibc22, merchant_id=4)
//   - QPRO2
//   (QPRO3/4/6/8/10 already done in _fix-dialog-content-qpro-195.mjs)
//
// For each (brand, code, popup_id):
//   1. Pull current popup via listing
//   2. Check if title + body match the correct short How-to-Apply (Reload)
//      or Congratulations (FC) format
//   3. If wrong → rebuild title + body + PUT
//
// Default = dry-run; pass --commit to send PUTs.

import fs from 'node:fs';
import path from 'node:path';
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const commit = process.argv.includes('--commit');

const probe = JSON.parse(fs.readFileSync('captures/api-runs/qp2d-sheet-probe-v2.json', 'utf8'));
const fixturesByRn = new Map();
for (const f of fs.readdirSync('captures/requests').filter(n => /^P1(2[4-9]|[3-5][0-9]|6[0-3])-/.test(n))) {
  const r = JSON.parse(fs.readFileSync(path.join('captures/requests', f), 'utf8'));
  fixturesByRn.set(r.request_id, r);
}
const fixtureByCode = new Map();
for (const r of fixturesByRn.values()) fixtureByCode.set(r.promo_code, r);

const TARGETS = [
  { key: 'QP2D', site: 'ibc22', merchantId: 4 },
  { key: 'QPRO2', site: 'qpro2' },
];

// Just the P124-P163 codes
const P_CODES = new Set([...fixturesByRn.values()].map(r => r.promo_code));
console.log(`P124-P163 unique codes: ${P_CODES.size}`);

// Templates
function reloadTitle(rate, isZh) {
  return isZh ? `限时独家优惠 - ${rate}% 充值奖金` : `Time Limited Exclusive Offer - ${rate}% Reload Bonus`;
}
function fcTitle(amount, isZh) {
  return isZh ? `限时独家优惠 - ${amount} 免费彩金` : `Time Limited Exclusive Offer - Free Credit ${amount}`;
}
function reloadBody(rate, currency, minDeposit, isZh) {
  const title = isZh ? `限时独家优惠 - ${rate}% 充值奖金` : `Time Limited Exclusive Offer - ${rate}% Reload Bonus`;
  if (isZh) {
    return `<p><strong>如何申请：</strong><br><br>1. 点击 [转账] 页面并选择您的游戏提供商。<br>2. 输入金额 ${currency} ${minDeposit} 以上<br>3. 在"促销"下选择 <strong>[${title}]</strong> 并点击提交。<br><br><span style="color:hsl(0,75%,60%);"><strong>*有关完整促销条款和条件，请查看您的收件箱。</strong></span></p>`;
  }
  return `<p><strong>How to Apply:</strong><br><br>1. Go to the [Transfer] page and select your game provider.<br>2. Enter amount ${currency} ${minDeposit} and above<br>3. Choose [<strong>${title}</strong>] under "Promotion" and click SUBMIT.<br><br><span style="color:hsl(0,75%,60%);"><strong>*For full promotion terms &amp; conditions, check your Inbox.</strong></span></p>`;
}
function fcBody(to, isZh) {
  if (isZh) {
    return `<p><span style="color:hsl(0,0%,0%);">恭喜！您已获得了免费分数！</span><br><br><span style="color:hsl(0,0%,0%);"><strong><u>条款与条件</u></strong></span><br><span style="color:hsl(0,0%,0%);">1. 流水要求为 ${to} 倍。</span><br><br><span style="color:hsl(0,75%,60%);"><strong>*有关完整促销条款和条件，请查看您的收件箱。</strong></span></p>`;
  }
  return `<p><span style="color:hsl(0,0%,0%);">Congratulations! You have been rewarded with a free credit!</span><br><br><span style="color:hsl(0,0%,0%);"><strong><u>Terms and Conditions</u></strong></span><br><span style="color:hsl(0,0%,0%);">1.&nbsp;Turnover is ${to} times.</span><br><br><span style="color:hsl(0,75%,60%);"><strong>*For full terms &amp; conditions, check your Inbox.</strong></span></p>`;
}

const LOCALE_TO_CURRENCY = { 1: 'MYR', 3: 'MYR', 6: 'SGD', 7: 'SGD' };
const LOCALE_IS_ZH = (id) => id === 3 || id === 7;
const fmtDate = (iso) => iso ? String(iso).replace(/T/, ' ').replace(/\.\d+Z?$/, '').slice(0, 19) : null;

// Detect wrong-format content (long-form Promo Details / Bonus Condition Example)
function isWrongFormat(content) {
  if (!content) return false;
  return /Promo Details|Bonus Condition Example|Turnover requirement \[/i.test(content) ||
         /优惠详情|奖金条件|流水量需求/.test(content);
}

const popupLookupBySite = new Map();
async function getPopupLookup(siteObj, siteId, merchantId) {
  const key = `${siteId}:${merchantId ?? 'none'}`;
  if (popupLookupBySite.has(key)) return popupLookupBySite.get(key);
  const map = new Map();
  for (let page = 1; page <= 30; page++) {
    const params = new URLSearchParams({ perPage: '100', page: String(page) });
    if (merchantId != null) params.set('site_id', String(merchantId));
    const r = await authedFetch(siteObj, `/api/bo/popups?${params}`);
    const rows = r?.data?.rows || [];
    for (const p of rows) map.set(p.id, p);
    if (rows.length < 100) break;
  }
  popupLookupBySite.set(key, map);
  return map;
}

// Step 1: build inventory of (target, code, promotion_id, popup_id)
const items = [];
for (const r of probe.results) {
  if (!P_CODES.has(r.code)) continue;
  for (const t of TARGETS) {
    const data = r[t.key];
    if (!data?.present) continue;
    items.push({ target: t.key, site: t.site, merchantId: t.merchantId, code: r.code, promotion_id: data.id });
  }
}
console.log(`Inventory: ${items.length} popups to inspect (${TARGETS.length} brands × up to ${P_CODES.size} codes)`);

async function inspectAndFix(item) {
  const siteObj = getSite(item.site);
  const fixture = fixtureByCode.get(item.code);
  if (!fixture) return { ...item, action: 'NO_FIXTURE' };

  try {
    // Resolve popup_id via listing
    const params = new URLSearchParams({ code: item.code, perPage: '5' });
    if (item.merchantId != null) params.set('merchant_id', String(item.merchantId));
    const r = await authedFetch(siteObj, `/api/bo/promotion?${params}`);
    const row = (r?.data?.rows || []).find(x => x.code === item.code);
    if (!row) return { ...item, action: 'PROMO_NOT_FOUND' };
    const dpl = row.dialog_popup_list;
    let popupId = null;
    if (Array.isArray(dpl) && dpl.length) popupId = dpl[0].popup_id;
    else if (dpl && typeof dpl === 'object') popupId = Object.values(dpl)[0]?.popup_id;
    if (!popupId) return { ...item, action: 'NO_POPUP_LINKED' };

    // Get popup metadata
    const lookup = await getPopupLookup(siteObj, item.site, item.merchantId);
    const popup = lookup.get(popupId);
    if (!popup) return { ...item, action: 'POPUP_NOT_IN_LISTING', popup_id: popupId };

    // Inspect each locale's content
    const wrongLocales = [];
    for (const [k, c] of Object.entries(popup.contents || {})) {
      if (isWrongFormat(c.content)) wrongLocales.push({ locale_id: c.locale_id });
    }
    if (wrongLocales.length === 0) {
      return { ...item, popup_id: popupId, action: 'ALREADY_CORRECT' };
    }

    // Build fix
    const bonusType = String(fixture.bonus_type || '').toLowerCase();
    const isFc = bonusType === 'free credit';
    const isReload = bonusType === 'deposit';
    const rate = fixture.parsed?.bonus_rate_pct;
    const fcAmt = fixture.parsed?.free_credit_amount;
    const toMult = fixture.parsed?.to_multiplier;

    const newContents = {};
    for (const [k, c] of Object.entries(popup.contents || {})) {
      const localeId = c.locale_id ?? Number(k);
      const isZh = LOCALE_IS_ZH(localeId);
      const currency = LOCALE_TO_CURRENCY[localeId] || 'MYR';
      const overrides = fixture.per_currency_overrides?.[currency];
      const minDep = overrides?.min_deposit ?? fixture.parsed?.min_deposit;

      let title, content;
      if (isReload) {
        title = reloadTitle(rate, isZh);
        content = reloadBody(rate, currency, minDep, isZh);
      } else if (isFc) {
        title = fcTitle(fcAmt, isZh);
        content = fcBody(toMult, isZh);
      } else {
        title = c.title;
        content = c.content;
      }
      newContents[k] = { ...c, title, content };
    }
    const newLabel = isReload ? reloadTitle(rate, false) : isFc ? fcTitle(fcAmt, false) : popup.label;
    const body = {
      id: popup.id, code: popup.code, status: popup.status, platform: popup.platform,
      position: popup.position, session: popup.session,
      start_date: fmtDate(popup.start_date), end_date: fmtDate(popup.end_date),
      location: popup.location, affiliates_visibility: popup.affiliates_visibility,
      always_pop: popup.always_pop, label: newLabel,
      contents: newContents,
    };
    // QP2D popups need site_id in the PUT body
    if (item.merchantId != null) body.site_id = item.merchantId;

    if (!commit) {
      return { ...item, popup_id: popupId, action: 'DRY_RUN_PUT', wrongLocales: wrongLocales.length, new_label: newLabel };
    }
    const res = await authedFetch(siteObj, `/api/bo/popups/${popupId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return { ...item, popup_id: popupId, action: 'UPDATED', response_ok: !!res?.success };
  } catch (e) {
    return { ...item, action: 'FAILED', error: e.message.slice(0, 250) };
  }
}

async function runBatched(items, fn, concurrency = 12) {
  const results = new Array(items.length);
  let next = 0, done = 0;
  async function worker() {
    while (true) {
      const i = next++; if (i >= items.length) break;
      results[i] = await fn(items[i]);
      done++;
      if (done % 25 === 0) process.stderr.write(`  ${done}/${items.length}\n`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

console.log(`Mode: ${commit ? 'LIVE (--commit)' : 'DRY-RUN'}`);
const t0 = Date.now();
const results = await runBatched(items, inspectAndFix, 12);
console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

const tally = {};
for (const r of results) tally[r.action] = (tally[r.action] || 0) + 1;
console.log('\nTally:', JSON.stringify(tally));

const byBrand = {};
for (const r of results) {
  byBrand[r.target] = byBrand[r.target] || { ALREADY_CORRECT: 0, DRY_RUN_PUT: 0, UPDATED: 0, FAILED: 0, other: 0 };
  if (byBrand[r.target][r.action] != null) byBrand[r.target][r.action]++;
  else byBrand[r.target].other++;
}
console.log('Per-brand:', JSON.stringify(byBrand, null, 2));

const fails = results.filter(r => r.action === 'FAILED');
if (fails.length) {
  console.log('\nFailures (first 5):');
  fails.slice(0, 5).forEach(r => console.log(`  ${r.target} ${r.code} popup=${r.popup_id} — ${r.error}`));
}

fs.writeFileSync(`captures/api-runs/dialog-fix-all-brands-${commit ? 'commit' : 'dryrun'}.json`,
  JSON.stringify({ generated: new Date().toISOString(), mode: commit ? 'live' : 'dryrun', results, tally, byBrand }, null, 2));
console.log(`\nReport → captures/api-runs/dialog-fix-all-brands-${commit ? 'commit' : 'dryrun'}.json`);

// Rebuild dialog popup CONTENT on all 195 QPRO3/4/6/8/10 popups to match
// the QPRO2 / QP2D operator-created reference format (short "How to Apply" /
// FC "Congratulations" — NOT the long Promo Details + T&C table that the
// canary's renderBody produces).
//
// Reference templates pulled directly from QPRO2 popup 146 (Reload) and
// QPRO2 popup 138 (FC).
//
// For each of 195 popups:
//   - Title (per locale): "Time Limited Exclusive Offer - <RATE>% Reload Bonus"
//     (Reload) or "Time Limited Exclusive Offer - Free Credit <AMOUNT>" (FC)
//     ZH equivalents: "限时独家优惠 - <RATE>% 充值奖金" / "限时独家优惠 - <AMOUNT> 免费彩金"
//   - Body (per locale): short How-to-Apply (Reload) or Congratulations (FC)
//   - Inbox footer in red color
//   - PUT /api/bo/popups/{id} with corrected fields, dates normalized to Y-m-d H:i:s
//
// Default = dry-run; pass --commit to send PUTs.

import fs from 'node:fs';
import path from 'node:path';
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const commit = process.argv.includes('--commit');

const inventory = JSON.parse(fs.readFileSync('captures/api-runs/orphan-inventory-p124-163.json', 'utf8'));
const finishCommit = JSON.parse(fs.readFileSync('captures/api-runs/finish-orphans-commit-summary.json', 'utf8'));
const popupByRnBrand = new Map();
for (const r of finishCommit.results) {
  if (r.popup_id) popupByRnBrand.set(`${r.rn}/${r.brand}`, r.popup_id);
}

// Per-RN fixture for parsed.bonus_rate / min_deposit / max_bonus / free_credit_amount / to_multiplier
const fixturesByRn = new Map();
for (const f of fs.readdirSync('captures/requests').filter(n => /^P1(2[4-9]|[3-5][0-9]|6[0-3])-/.test(n))) {
  const r = JSON.parse(fs.readFileSync(path.join('captures/requests', f), 'utf8'));
  fixturesByRn.set(r.request_id, r);
}

const BRAND_TO_SITE = { QPRO3: 'qpro3', QPRO4: 'qpro4', QPRO6: 'qpro6', QPRO8: 'qpro8', QPRO10: 'qpro10' };

const LOCALE_TO_CURRENCY = { 1: 'MYR', 3: 'MYR', 6: 'SGD', 7: 'SGD' };
const LOCALE_IS_ZH = (id) => id === 3 || id === 7;

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

// Per-site popup lookup
const popupLookupBySite = new Map();
async function getPopupLookup(siteObj, siteId) {
  if (popupLookupBySite.has(siteId)) return popupLookupBySite.get(siteId);
  const map = new Map();
  for (let page = 1; page <= 30; page++) {
    const r = await authedFetch(siteObj, `/api/bo/popups?perPage=100&page=${page}`);
    const rows = r?.data?.rows || [];
    for (const p of rows) map.set(p.id, p);
    if (rows.length < 100) break;
  }
  popupLookupBySite.set(siteId, map);
  return map;
}

const fmtDate = (iso) => iso ? String(iso).replace(/T/, ' ').replace(/\.\d+Z?$/, '').slice(0, 19) : null;

async function fixPopup(orph) {
  const fixture = fixturesByRn.get(orph.rn);
  if (!fixture) return { ...orph, action: 'SKIP_NO_FIXTURE' };
  const popupId = popupByRnBrand.get(`${orph.rn}/${orph.brand}`);
  if (!popupId) return { ...orph, action: 'SKIP_NO_POPUP_ID' };

  const siteId = BRAND_TO_SITE[orph.brand];
  const site = getSite(siteId);

  const bonusType = String(fixture.bonus_type || '').toLowerCase();
  const isFc = bonusType === 'free credit';
  const isReload = bonusType === 'deposit';

  const rate = fixture.parsed?.bonus_rate_pct;
  const fcAmt = fixture.parsed?.free_credit_amount;
  const toMult = fixture.parsed?.to_multiplier;

  try {
    const lookup = await getPopupLookup(site, siteId);
    const popup = lookup.get(popupId);
    if (!popup) return { ...orph, action: 'POPUP_NOT_FOUND', popup_id: popupId };

    // Build updated contents per locale, only for locales the popup already has.
    const newContents = {};
    for (const [k, c] of Object.entries(popup.contents || {})) {
      const localeId = c.locale_id ?? Number(k);
      const isZh = LOCALE_IS_ZH(localeId);
      const currency = LOCALE_TO_CURRENCY[localeId] || 'MYR';
      // Per-currency min_deposit: use the per_currency_overrides if present,
      // else fall back to the top-level parsed.min_deposit
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
        // Other types — leave existing
        title = c.title;
        content = c.content;
      }
      newContents[k] = {
        ...c,
        title,
        content,
      };
    }

    // Build PUT body: echo existing fields, override contents + label, fix dates.
    const newLabel = isReload ? reloadTitle(rate, false) : isFc ? fcTitle(fcAmt, false) : popup.label;
    const body = {
      id: popup.id,
      code: popup.code,
      status: popup.status,
      platform: popup.platform,
      position: popup.position,
      session: popup.session,
      start_date: fmtDate(popup.start_date),
      end_date: fmtDate(popup.end_date),
      location: popup.location,
      affiliates_visibility: popup.affiliates_visibility,
      always_pop: popup.always_pop,
      label: newLabel,
      contents: newContents,
    };

    if (!commit) {
      return { ...orph, popup_id: popupId, action: 'DRY_RUN_PUT', new_label: newLabel, locales: Object.keys(newContents).map(k => Number(k)) };
    }
    const res = await authedFetch(site, `/api/bo/popups/${popupId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return { ...orph, popup_id: popupId, action: 'UPDATED', response_ok: !!res?.success };
  } catch (e) {
    return { ...orph, popup_id: popupId, action: 'FAILED', error: e.message.slice(0, 250) };
  }
}

async function runBatched(items, fn, concurrency = 15) {
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
console.log(`Targets: ${inventory.length} QPRO popups`);
console.log(`━━━━━━━━━━ Running ${inventory.length} popup updates (parallel concurrency=15) ━━━━━━━━━━`);

const t0 = Date.now();
const results = await runBatched(inventory, fixPopup, 15);
const dur = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`Done in ${dur}s`);

const tally = {};
for (const r of results) tally[r.action] = (tally[r.action] || 0) + 1;
console.log('\nTally:', JSON.stringify(tally));

// Sample preview
console.log('\nSample previews (first 3):');
results.slice(0, 3).forEach(r => {
  console.log(`  ${r.rn} ${r.brand} popup_id=${r.popup_id} → ${r.action}  label="${r.new_label || ''}"`);
});

const fails = results.filter(r => r.action === 'FAILED');
if (fails.length) {
  console.log('\nFailures (first 5):');
  fails.slice(0, 5).forEach(r => console.log(`  ${r.rn} ${r.brand} popup_id=${r.popup_id} — ${r.error}`));
}

fs.writeFileSync(`captures/api-runs/dialog-content-fix-${commit ? 'commit' : 'dryrun'}.json`,
  JSON.stringify({ generated: new Date().toISOString(), mode: commit ? 'live' : 'dryrun', results, tally }, null, 2));
console.log(`\nReport → captures/api-runs/dialog-content-fix-${commit ? 'commit' : 'dryrun'}.json`);

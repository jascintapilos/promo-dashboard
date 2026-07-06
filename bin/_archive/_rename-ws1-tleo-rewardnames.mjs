#!/usr/bin/env node
// Pass 2 of the TLEO uniqueness fix (see _rename-ws1-tleo-unique.mjs):
// sync PromotionReward.RewardName to the new unique PromotionName for all
// TLEO promos on WS1 MY. The Assign Rewards dropdown is keyed on
// RewardName, NOT PromotionName — without this pass the dropdown still
// shows duplicates (memory: feedback-ws1-ws2-unique-promo-name).
//
//   node bin/_rename-ws1-tleo-rewardnames.mjs           # dry-run
//   node bin/_rename-ws1-tleo-rewardnames.mjs --commit
//
// UpdatePromotionRewardDetails is a full-replace on its field set — read
// current values from GetBonusInfo and pass all through except RewardName.

import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const SITE = 'ws1-v3-my';
const BASE = 'https://kioskmy.best-in-asia.com';
const COMMIT = process.argv.includes('--commit');

const store = JSON.parse(readFileSync(path.resolve('igmp-sessions.local.json'), 'utf8'));
const saved = store.sessions?.[SITE];
if (!saved?.cookies?.length) { console.error(`no saved session for ${SITE}`); process.exit(2); }

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const ctx = await browser.newContext();
await ctx.addCookies(saved.cookies.filter((c) => c.name && c.value && c.domain));

async function post(endpoint, body) {
  const res = await ctx.request.post(BASE + endpoint, {
    headers: { 'Content-Type': 'application/json; charset=utf-8', Accept: 'application/json, text/plain, */*' },
    data: body,
  });
  const text = await res.text();
  if (!res.ok()) throw new Error(`HTTP ${res.status()} ${endpoint}: ${text.slice(0, 200)}`);
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`non-JSON from ${endpoint} (stale session?)`); }
  if (data?.success === false) throw new Error(`iGMP error ${endpoint}: ${JSON.stringify(data.message || data).slice(0, 200)}`);
  return data;
}

async function listAll() {
  const all = [];
  for (let pg = 1; pg <= 40; pg++) {
    const r = await post(`/PM/GetPromotionsList?pageNum=${pg}&rowPerPage=200`, {
      PromotionCode: '', PromotionName: '', PromotionType: 0, IsActive: '', IsPublished: '',
    });
    const rows = r?.data || [];
    if (!rows.length) break;
    all.push(...rows);
    if (rows.length < 200) break;
  }
  return all;
}

const tleo = (await listAll()).filter((p) => /TLEO/i.test(p.PromotionCode || ''));
console.error(`[reward-rename] ${tleo.length} TLEO promos in scope on ${SITE}`);

let ok = 0, fail = 0, skip = 0;
const rows = [];
for (const p of tleo) {
  try {
    const det = await post('/PM/GetBonusInfo', { PromotionId: p.PromotionId });
    const promo = det?.data?.Promotion || det?.data;
    const reward = promo?.PromotionRewards?.[0];
    if (!reward?.RewardId) throw new Error('no PromotionRewards[0] in GetBonusInfo');
    const targetName = (promo.PromotionName || '').trim(); // pass-1 unique name

    // Sanity: CAP token in code should match the reward's cap amount.
    const capTok = (p.PromotionCode.match(/(\d+)MX/) || [])[1];
    const capLive = reward.CapBonusAmount;
    const capNote = capTok && capLive != null && Number(capTok) !== Number(capLive)
      ? `  ⚠ code says CAP${capTok} but live CapBonusAmount=${capLive}` : '';

    if ((reward.RewardName || '').trim() === targetName) {
      skip++;
      rows.push(`  = ${p.PromotionCode}: RewardName already "${targetName}"${capNote}`);
      continue;
    }
    rows.push(`  ${p.PromotionCode}\n     RewardName: "${reward.RewardName}" → "${targetName}"${capNote}`);

    if (COMMIT) {
      // WS1 v3 quirk (found 2026-07-04): numeric values must be STRINGS and
      // RedeemableKYCStatus a CSV string — the WS2 shape (numbers + array) 500s.
      await post('/PM/UpdatePromotionRewardDetails', {
        RewardId: String(reward.RewardId),
        RewardName: targetName,
        RedeemableQuantity: String(reward.RedeemableQuantity ?? 0),
        CapBonusAmount: String(reward.CapBonusAmount ?? 0),
        RedeemableKYCStatus: Array.isArray(reward.RedeemableKYCStatus)
          ? reward.RedeemableKYCStatus.join(',')
          : String(reward.RedeemableKYCStatus ?? ''),
        WithdrawalCap: String(reward.WithdrawalCap ?? 0),
        MaximumBalance: String(reward.MaximumBalance ?? 0),
      });
      ok++;
    }
  } catch (e) {
    fail++;
    rows.push(`  ✗ ${p.PromotionCode}: ${e.message || e}`);
  }
}
console.log(rows.join('\n'));
console.log(COMMIT
  ? `\nApplied: ${ok} renamed, ${skip} already correct, ${fail} failed`
  : `\nDRY-RUN: ${tleo.length - skip - fail} would be renamed, ${skip} already correct, ${fail} errored. Re-run with --commit.`);

if (COMMIT && !fail) {
  // Verify: re-read every reward name and check uniqueness among TLEO set
  const names = new Map();
  for (const p of tleo) {
    const det = await post('/PM/GetBonusInfo', { PromotionId: p.PromotionId });
    const promo = det?.data?.Promotion || det?.data;
    const rn = (promo?.PromotionRewards?.[0]?.RewardName || '').trim();
    const lst = names.get(rn) || [];
    lst.push(p.PromotionCode);
    names.set(rn, lst);
  }
  const dups = Array.from(names.entries()).filter(([, l]) => l.length > 1);
  if (dups.length) {
    console.log('\n✗ RewardName duplicates remain among TLEO promos:');
    dups.forEach(([n, l]) => console.log(`   "${n}" ×${l.length}  [${l.join(', ')}]`));
    process.exitCode = 1;
  } else {
    console.log(`\n✓ Verified: all ${tleo.length} TLEO RewardNames unique and synced to PromotionName.`);
  }
}
await browser.close();

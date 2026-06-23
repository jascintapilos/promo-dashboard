// Scan ALL brands for Free Spin popups. Classify each as:
//   - WRONG_FORMAT: 5-step "As a reward for joining us" + 8-clause inline T&C
//   - NEW_FORMAT:   3-step "How to Claim" + red Inbox footer (matches QPRO1 5MXRY)
//   - CAMPAIGN_SPECIFIC: custom copy (Welcome, CNY, MG Coupon, streak, etc.)
//
// Output per-brand counts + sample wrong-format popup IDs for review.
// Does NOT modify anything.

import fs from 'node:fs';
import { authedFetch } from '../src/api-client.js';
import { getSite, listSites } from '../src/sites.js';

const BRANDS = [
  { key: 'QP2A',  site: 'ibc22',  merchantId: 1 },
  { key: 'QP2B',  site: 'ibc22',  merchantId: 2 },
  { key: 'QP2C',  site: 'ibc22',  merchantId: 3 },
  { key: 'QP2D',  site: 'ibc22',  merchantId: 4 },
  { key: 'QPRO1',  site: 'qpro1'  },
  { key: 'QPRO2',  site: 'qpro2'  },
  { key: 'QPRO3',  site: 'qpro3'  },
  { key: 'QPRO4',  site: 'qpro4'  },
  { key: 'QPRO5',  site: 'qpro5'  },
  { key: 'QPRO6',  site: 'qpro6'  },
  { key: 'QPRO7',  site: 'qpro7'  },
  { key: 'QPRO8',  site: 'qpro8'  },
  { key: 'QPRO9',  site: 'qpro9'  },
  { key: 'QPRO10', site: 'qpro10' },
  { key: 'QPRO11', site: 'qpro11' },
  { key: 'QPRO12', site: 'qpro12' },
  { key: 'QPRO13', site: 'qpro13' },
  { key: 'QPRO14', site: 'qpro14' },
  { key: 'QPRO15', site: 'qpro15' },
  { key: 'QPRO16', site: 'qpro16' },
  { key: 'QPRO17', site: 'qpro17' },
];

function classify(en) {
  if (!en?.content) return 'NO_CONTENT';
  const body = en.content;
  // WRONG: legacy 5-step "As a reward for joining us" + 8-clause T&C
  if (/As a reward for joining us/i.test(body) && /Make a deposit and wait for it to be approved/i.test(body)) {
    return 'WRONG_FORMAT';
  }
  // NEW: short 3-step "How to Claim" (5MXRY style) — checks Inbox footer + Account > Rewards
  if (/Account\s*&gt;\s*Rewards|Account > Rewards|帐户\s*&gt;\s*奖励|帐户 > 奖励/.test(body) &&
      /check your Inbox|查看您的收件箱/.test(body)) {
    return 'NEW_FORMAT';
  }
  return 'CAMPAIGN_SPECIFIC';
}

async function scanBrand(b) {
  const site = getSite(b.site);
  const fsPopups = [];
  for (let page = 1; page <= 20; page++) {
    const params = new URLSearchParams({ perPage: '100', page: String(page) });
    if (b.merchantId != null) params.set('site_id', String(b.merchantId));
    const r = await authedFetch(site, `/api/bo/popups?${params}`);
    const rows = r?.data?.rows || [];
    for (const p of rows) {
      const en = Object.values(p.contents || {}).find(c => c.locale_id === 1 || c.locale_id === 6);
      const title = en?.title || '';
      if (/Free\s*Spin|FREE\s*SPIN|免费旋转|免费分数/i.test(title)) {
        fsPopups.push({
          popup_id: p.id,
          code: p.code,
          title,
          status: p.status,
          verdict: classify(en),
        });
      }
    }
    if (rows.length < 100) break;
  }
  return { brand: b.key, totalFs: fsPopups.length, popups: fsPopups };
}

console.log(`Scanning FS popups across ${BRANDS.length} brands in parallel...`);
const t0 = Date.now();
const results = await Promise.all(BRANDS.map(scanBrand));
console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

console.log('\nPer-brand FS popup classification:');
console.log('BRAND\tTotal FS\tWRONG\tNEW\tCAMPAIGN');
const totals = { WRONG_FORMAT: 0, NEW_FORMAT: 0, CAMPAIGN_SPECIFIC: 0, NO_CONTENT: 0 };
for (const r of results) {
  const cnt = { WRONG_FORMAT: 0, NEW_FORMAT: 0, CAMPAIGN_SPECIFIC: 0, NO_CONTENT: 0 };
  for (const p of r.popups) cnt[p.verdict] = (cnt[p.verdict] || 0) + 1;
  for (const k of Object.keys(totals)) totals[k] += cnt[k];
  console.log(`${r.brand}\t${r.totalFs}\t${cnt.WRONG_FORMAT}\t${cnt.NEW_FORMAT}\t${cnt.CAMPAIGN_SPECIFIC + cnt.NO_CONTENT}`);
}
console.log(`TOTAL\t${results.reduce((s, r) => s + r.totalFs, 0)}\t${totals.WRONG_FORMAT}\t${totals.NEW_FORMAT}\t${totals.CAMPAIGN_SPECIFIC + totals.NO_CONTENT}`);

// Sample WRONG_FORMAT popups
console.log('\nSample WRONG_FORMAT popups (first 5):');
let shown = 0;
for (const r of results) {
  for (const p of r.popups) {
    if (p.verdict === 'WRONG_FORMAT' && shown < 5) {
      console.log(`  ${r.brand} popup_id=${p.popup_id} code=${p.code} title="${p.title}"`);
      shown++;
    }
  }
}

fs.writeFileSync('captures/api-runs/fs-popup-scan.json', JSON.stringify({ generated: new Date().toISOString(), results, totals }, null, 2));
console.log(`\nFull scan → captures/api-runs/fs-popup-scan.json`);

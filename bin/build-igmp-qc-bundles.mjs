// Probe WS1_MY / WS1_SG / WS2 live BO for P030-P046 and write QC bundles
// consumable by Sentinel. Also fixes the P030 WS1_SG cross-contaminated bundle.
import { igmpPost } from '../src/igmp-client.js';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';

const BUNDLE_DIR = 'captures/qc-bundles';
const REQUEST_DIR = 'captures/requests';
mkdirSync(BUNDLE_DIR, { recursive: true });

const SITES = [
  { siteId: 'ws1-v3-my', brand: 'WS1_MY', platform: 'igmp' },
  { siteId: 'ws1-v3-sg', brand: 'WS1_SG', platform: 'igmp' },
  { siteId: 'ws2',       brand: 'WS2',     platform: 'igmp' },
];

const DETAIL_EP = {
  'Free Credit': '/PM/GetFreeCreditInfo',
  'Deposit':     '/PM/GetBonusInfo',
  'Free Spin':   '/PM/GetFreeSpinPromotionInfo',
};

function hasSentence11Link(html) {
  // Look for a hyperlink in the 11th sentence-level block or T&C clause
  const sentences = html.split(/(?<=\d\.\s)/);
  if (sentences.length < 11) {
    // fallback: check if any anchor exists in the last third of content
    return /<a\s[^>]*href/i.test(html.slice(Math.floor(html.length * 0.6)));
  }
  return /<a\s[^>]*href/i.test(sentences[10] || '');
}

// Load all P030-P046 request files
const handles = [];
for (let n = 30; n <= 46; n++) {
  const row = String(n).padStart(3, '0');
  const files = readdirSync(REQUEST_DIR)
    .filter(f => new RegExp(`^P${row}-`).test(f));
  if (!files.length) continue;
  const req = JSON.parse(readFileSync(path.join(REQUEST_DIR, files[0]), 'utf8'));
  handles.push(req);
}

console.log(`\nBuilding IGMP QC bundles for ${handles.length} handles × ${SITES.length} sites\n`);

const results = [];

for (const req of handles) {
  const baseCode = req.promo_code;
  const detailEp = DETAIL_EP[req.bonus_type] || '/PM/GetBonusInfo';

  for (const site of SITES) {
    const label = `${req.handle} ${site.brand}`;
    process.stdout.write(`  ${label.padEnd(22)} `);

    // 1. Find the promo by code (try base code, then _2 suffix)
    let listRow = null;
    let usedCode = baseCode;
    for (const tryCode of [baseCode, baseCode + '_2']) {
      try {
        const r = await igmpPost(site.siteId, '/PM/GetPromotionInfoByCode', { PromotionCode: tryCode });
        if (r?.data?.PromotionId) { listRow = r.data; usedCode = tryCode; break; }
      } catch { /* not found */ }
    }

    if (!listRow) {
      console.log('✗ NOT FOUND on BO');
      results.push({ handle: req.handle, brand: site.brand, status: 'NOT_FOUND' });
      continue;
    }

    const promoId = listRow.PromotionId;

    // 2. Fetch detail
    let detail = null;
    let rewardId = null;
    try {
      const dr = await igmpPost(site.siteId, detailEp, { PromotionId: promoId });
      if (dr?.data?.Promotion) {
        detail = dr.data.Promotion;
        // Attach outer ExpiryMinutes (FC only)
        if (dr.data.ExpiryMinutes != null) detail._expiryMinutes = dr.data.ExpiryMinutes;
        rewardId = detail.PromotionRewards?.[0]?.RewardId ?? null;
      }
    } catch (e) {
      console.log(`✗ DETAIL ERR: ${e.message.slice(0, 80)}`);
      results.push({ handle: req.handle, brand: site.brand, status: 'DETAIL_ERR' });
      continue;
    }

    // 3. Fetch T&C
    let tncMessages = [];
    if (rewardId) {
      try {
        const tr = await igmpPost(site.siteId, '/PM/GetPromotionRewardContents', { RewardId: rewardId });
        tncMessages = tr?.data || [];
      } catch { /* tnc unavailable */ }
    }

    const enMsg = tncMessages.find(r => (r.Locale || '').toLowerCase() === 'en');
    const sentence11 = enMsg ? hasSentence11Link(enMsg.Content || '') : false;

    // 4. Write bundle
    const bundle = {
      handle: req.handle,
      brand: site.brand,
      platform: site.platform,
      site: site.siteId,
      promo_code: usedCode,
      promotion_id: promoId,
      reward_id: rewardId,
      template_id: null,
      dialog_popup_id: null,
      saved_at: null,
      source: req,
      qc_endpoints: {
        list: '/PM/GetPromotionInfoByCode',
        detail: detailEp,
        tnc: '/PM/GetPromotionRewardContents',
      },
      live_state: {
        list_row: listRow,
        detail,
        tnc: {
          messages: tncMessages,
          checks: { sentence_11_has_link: sentence11 },
        },
        refreshed_at: new Date().toISOString(),
      },
    };

    const outPath = path.join(BUNDLE_DIR, `${req.handle}__${site.brand}.json`);
    writeFileSync(outPath, JSON.stringify(bundle, null, 2));
    console.log(`✓ promo_id=${promoId} code=${usedCode} rewards=${rewardId} tnc_locales=[${tncMessages.map(r=>r.Locale).join(',')}]`);
    results.push({ handle: req.handle, brand: site.brand, status: 'OK', promoId, usedCode });
  }
}

console.log('\n─── Summary ──────────────────────────────────────');
const ok   = results.filter(r => r.status === 'OK').length;
const fail = results.filter(r => r.status !== 'OK').length;
console.log(`  ${ok} bundles written  ${fail ? fail + ' errors' : ''}`);
if (fail) results.filter(r => r.status !== 'OK').forEach(r =>
  console.log(`  ✗ ${r.handle} ${r.brand}: ${r.status}`));

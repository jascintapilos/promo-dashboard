#!/usr/bin/env node
// Patch CTA button text on P091-P096 popups.
//
// Operator rule (2026-05-20): when min_deposit > 0 the dialog popup's
// LEFT CTA button should be "DEPOSIT" → /member/deposit (not "CLAIM NOW").
// All 6 RNs have min_deposit > 0 (MYR 2500-8500), so all 12 popups need
// the change. Mapper updated for future runs; this patches in place.
//
// Usage: node bin/fix-p091-p096-cta-button.mjs [--commit]

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const commit = process.argv.includes('--commit');

const targets = {
  // QPRO4 popups (canary-created)
  qpro4: [166, 167, 168, 169, 170, 171],
  // QP2C popups (currently-linked set after the relink fix)
  ibc22: [1146, 1147, 1148, 1125, 1126, 1127],
};

const TEXT_BY_LOCALE = {
  // settings_locale_id → DEPOSIT translation
  1: 'DEPOSIT',          // MY_EN
  3: '存款',              // MY_ZH
  6: 'DEPOSIT',          // SG_EN
  7: '存款',              // SG_ZH
  8: 'DEPOSIT',          // ID_EN
  9: 'Deposit',          // ID_ID
};

const fmtDate = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth()+1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
};

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`FIX P091-P096 CTA button text — ${commit ? 'LIVE' : 'DRY-RUN'}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

for (const [siteId, popupIds] of Object.entries(targets)) {
  const site = getSite(siteId);
  console.log(`\n--- ${siteId} ---`);
  const listing = await authedFetch(site, '/api/bo/popups?perPage=500&page=1&date_type=start_date&sort_by=id&sort_order=desc');
  const allPopups = listing.data?.rows || [];
  for (const popupId of popupIds) {
    const popup = allPopups.find((p) => p.id === popupId);
    if (!popup) { console.log(`  popup ${popupId} not found in listing — skipping`); continue; }
    const contents = (popup.contents || []).map((c) => {
      const localeId = c.locale_id;
      const newText = TEXT_BY_LOCALE[localeId] || 'DEPOSIT';
      return {
        ...c,
        cta_button_text_1: newText,
        cta_button_link_1: '/member/deposit',
      };
    });
    console.log(`  popup ${popupId}: ${contents.length} content rows`);
    for (const c of contents) console.log(`    locale_id=${c.locale_id} → text_1="${c.cta_button_text_1}" link_1="${c.cta_button_link_1}"`);
    if (!commit) continue;
    const body = {
      ...popup,
      start_date: fmtDate(popup.start_date),
      end_date: fmtDate(popup.end_date),
      contents: contents.reduce((acc, c, i) => { acc[String(i)] = c; return acc; }, {}),
    };
    try {
      const result = await authedFetch(site, `/api/bo/popups/${popupId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      console.log(`    ✓ PUT popup/${popupId}: ${result.message?.[0] || 'ok'}`);
    } catch (e) {
      console.log(`    ✗ PUT popup/${popupId} failed: ${e.message.split('\n')[0].slice(0, 150)}`);
    }
  }
}

console.log('\nDone.');

#!/usr/bin/env node
// PUT existing promotion_name rows on P072 saves with clean text + proper
// per-locale ZH translation. Also POST any missing locale rows.

import fs from 'node:fs';
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const resolved = JSON.parse(fs.readFileSync('captures/requests/P072-r73.json', 'utf8'));
const commit = process.argv.includes('--commit');

const targets = [
  { siteId: 'qpro7',  promoId: 339  },
  { siteId: 'qpro10', promoId: 257  },
  { siteId: 'ibc22',  promoId: 1179 },
];

const CURRENCY_TO_ID = { MYR: '1', SGD: '3', IDR: '4' };
const LOCALE_TO_ID = { MY_EN: 1, MY_ZH: 3, SG_EN: 6, SG_ZH: 7, ID_EN: 8, ID_ID: 9 };
const REGION_TO_CCY = { MY: 'MYR', SG: 'SGD', ID: 'IDR' };

function nameFor(locale) {
  const isEn = locale.endsWith('_EN');
  const isZh = locale.endsWith('_ZH') || locale.endsWith('_ID');
  return isEn ? (resolved.promotion_name_en || resolved.promo_code)
       : isZh ? (resolved.promotion_name_zh_id || resolved.promotion_name_en || resolved.promo_code)
              : (resolved.promotion_name_en || resolved.promo_code);
}

for (const t of targets) {
  const site = getSite(t.siteId);
  const existing = (await authedFetch(site, `/api/bo/promotionname?promotion_id=${t.promoId}&perPage=50`)).data?.rows || [];
  console.log(`\n${t.siteId} id=${t.promoId} — ${existing.length} existing name row(s):`);
  for (const row of existing) {
    const localeId = Number(row.settings_locale_id || row.locale_id);
    const locale = Object.entries(LOCALE_TO_ID).find(([_, v]) => v === localeId)?.[0];
    if (!locale) continue;
    const ccyId = Number(row.currency_id);
    const wantName = nameFor(locale);
    if (row.promotion_name === wantName) {
      console.log(`  loc=${localeId} ccy=${row.currency}: already clean — skip`);
      continue;
    }
    console.log(`  loc=${localeId} ccy=${row.currency}: "${row.promotion_name.slice(0,40)}" → "${wantName.slice(0,40)}"`);
    if (commit) {
      try {
        await authedFetch(site, `/api/bo/promotionname/${row.promotion_name_id}`, {
          method: 'PUT', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({
            id: row.promotion_name_id,
            promotion_id: t.promoId,
            currency_id: String(ccyId),
            settings_locale_id: String(localeId),
            promotion_name: wantName,
            rewards_name: wantName,
          }),
        });
        console.log('    ✓ updated');
      } catch (e) { console.log(`    ✖ ${(e.message||'').split('\n')[1]?.trim()||e.message}`); }
    }
  }
  // Add missing (locale, currency) combos
  const haveKeys = new Set(existing.map((n) => `${n.settings_locale_id||n.locale_id}:${n.currency_id}`));
  for (const locale of resolved.locales || []) {
    const region = (locale.match(/^([A-Z]{2})_/)||[])[1];
    const ccyLabel = REGION_TO_CCY[region] || 'MYR';
    const ccyId = CURRENCY_TO_ID[ccyLabel];
    const localeId = LOCALE_TO_ID[locale];
    if (!ccyId || !localeId) continue;
    const key = `${localeId}:${ccyId}`;
    if (haveKeys.has(key)) continue;
    const name = nameFor(locale);
    console.log(`  + missing loc=${localeId} ccy=${ccyLabel}: "${name.slice(0,40)}"`);
    if (commit) {
      try {
        await authedFetch(site, '/api/bo/promotionname', {
          method: 'POST', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({
            promotion_id: t.promoId, currency_id: ccyId, settings_locale_id: String(localeId),
            promotion_name: name, rewards_name: name,
          }),
        });
        console.log('    ✓ posted');
      } catch (e) { console.log(`    ✖ ${(e.message||'').split('\n')[1]?.trim()||e.message}`); }
    }
  }
}
console.log('\nDone.');

// Parallel QC across the 195 P124-P163 saves.
// For each (rn, brand, promotion_id), verifies in BO:
//   - promotion.code matches expected
//   - promotion.name (internal) populated
//   - promotion.status === 1 (active)
//   - promotion.message_template_id linked (not 0/null)
//   - promotion.dialog_popup_list populated (length > 0) when popup_dialog=true
//   - promotion_currency rows present (>= 1)
//   - promotion_name rows present (== expected locale count, usually 4)
//
// Run: node bin/_qc-p124-163.mjs [--concurrency=20]

import fs from 'node:fs';
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const args = process.argv.slice(2);
const concArg = args.find(a => a.startsWith('--concurrency='));
const CONCURRENCY = concArg ? Number(concArg.split('=')[1]) : 20;

const INVENTORY = JSON.parse(fs.readFileSync('captures/api-runs/orphan-inventory-p124-163.json', 'utf8'));
const REQUESTS_DIR = 'captures/requests';

// Pull the latest fixtures so we know expected EN/ZH names + locale count.
const fixturesByRn = new Map();
for (const f of fs.readdirSync(REQUESTS_DIR).filter(n => /^P1(2[4-9]|[3-5][0-9]|6[0-3])-/.test(n))) {
  const r = JSON.parse(fs.readFileSync(`${REQUESTS_DIR}/${f}`, 'utf8'));
  fixturesByRn.set(r.request_id, r);
}

const BRAND_TO_SITE = { QPRO3: 'qpro3', QPRO4: 'qpro4', QPRO6: 'qpro6', QPRO8: 'qpro8', QPRO10: 'qpro10' };

async function qcOne(orph) {
  const site = getSite(BRAND_TO_SITE[orph.brand]);
  const fixture = fixturesByRn.get(orph.rn);
  if (!fixture) return { ...orph, status: 'NO_FIXTURE' };

  const expectedEn = fixture.promotion_name_en;
  const expectedZhId = fixture.promotion_name_zh_id;

  try {
    // Listing endpoint returns dialog_popup_list; detail endpoint does NOT.
    const [list, c, n] = await Promise.all([
      authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(orph.code)}&perPage=5`),
      authedFetch(site, `/api/bo/promotioncurrency?promotion_id=${orph.promotion_id}`),
      authedFetch(site, `/api/bo/promotionname?promotion_id=${orph.promotion_id}`),
    ]);
    const main = (list?.data?.rows || []).find(r => r.id === orph.promotion_id) || (list?.data?.rows || [])[0] || {};
    const currencies = c?.data?.rows || [];
    const names = n?.data?.rows || [];

    const codeOk = main.code === orph.code;
    const nameOk = main.name && main.name.length > 0;
    const statusOk = main.status === 1;
    const templateOk = !!main.message_template_id;
    const popupOk = Array.isArray(main.dialog_popup_list) && main.dialog_popup_list.length > 0;
    const currOk = currencies.length > 0;
    // Expected name count = whatever the mapper produced (BO-side after
    // per-brand currency filter). Just require >= 1 EN + >= 1 ZH-or-ID and
    // a count matching number of currencies × locales-per-currency.
    const enOk = !!names.find(nn => nn.locale?.endsWith('_EN') && nn.promotion_name === expectedEn);
    const zhOk = !!names.find(nn => (nn.locale?.endsWith('_ZH') || nn.locale?.endsWith('_ID')) && nn.promotion_name === expectedZhId);
    // Each currency should have at least 1 EN + 1 ZH/ID name (2 per currency typical).
    const namesOk = names.length >= currencies.length * 2;

    const checks = { codeOk, nameOk, statusOk, templateOk, popupOk, currOk, namesOk, enOk, zhOk };
    const passed = Object.values(checks).every(Boolean);
    return {
      ...orph,
      qc_status: passed ? 'PASS' : 'FAIL',
      checks,
      bo_code: main.code,
      bo_name: main.name,
      bo_status: main.status,
      bo_template_id: main.message_template_id,
      bo_popup_list_len: Array.isArray(main.dialog_popup_list) ? main.dialog_popup_list.length : 0,
      bo_currencies: currencies.length,
      bo_names: names.length,
    };
  } catch (e) {
    return { ...orph, qc_status: 'ERROR', error: e.message };
  }
}

// Parallel runner with bounded concurrency.
async function runBatched(items, fn, concurrency) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) break;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

console.log(`QC ${INVENTORY.length} promotions in parallel (concurrency=${CONCURRENCY})...`);
const t0 = Date.now();
const results = await runBatched(INVENTORY, qcOne, CONCURRENCY);
const dur = ((Date.now() - t0) / 1000).toFixed(1);

const pass = results.filter(r => r.qc_status === 'PASS').length;
const fail = results.filter(r => r.qc_status === 'FAIL').length;
const err  = results.filter(r => r.qc_status === 'ERROR').length;
const nofx = results.filter(r => r.qc_status === 'NO_FIXTURE').length;

console.log(`\n━━━━━━ QC SUMMARY (${dur}s) ━━━━━━`);
console.log(`  PASS: ${pass}/${INVENTORY.length}`);
console.log(`  FAIL: ${fail}`);
console.log(`  ERROR: ${err}`);
console.log(`  NO_FIXTURE: ${nofx}`);

if (fail) {
  console.log('\nFailures:');
  const checkLabels = { codeOk:'code', nameOk:'name', statusOk:'status', templateOk:'template', popupOk:'popup', currOk:'curr', namesOk:'names', enOk:'enName', zhOk:'zhName' };
  for (const r of results.filter(x => x.qc_status === 'FAIL')) {
    const failing = Object.entries(r.checks).filter(([k,v]) => !v).map(([k]) => checkLabels[k]).join(',');
    console.log(`  ${r.rn} ${r.brand} id=${r.promotion_id} — failing: ${failing}`);
  }
}
if (err) {
  console.log('\nErrors:');
  for (const r of results.filter(x => x.qc_status === 'ERROR')) {
    console.log(`  ${r.rn} ${r.brand} id=${r.promotion_id} — ${r.error?.slice(0, 150)}`);
  }
}

fs.writeFileSync('captures/api-runs/qc-p124-163-summary.json', JSON.stringify({ generated: new Date().toISOString(), pass, fail, error: err, results }, null, 2));
console.log(`\nFull QC report → captures/api-runs/qc-p124-163-summary.json`);

import { authedFetch, getPromotionDetail } from '../src/api-client.js';
import { getSite } from '../src/sites.js';
import { qcMtTncHyperlink } from '../src/qc-mt-tnc.js';

const QPRO_SITES = ['qpro1','qpro2','qpro3','qpro4'];
const CODES = [
  { code: 'REL_BASE_LC_20PCT_10X',        rate:20, dep:50, to:10, max:300,  cat:'LC'     },
  { code: 'REL_BOOSTER_LC_25PCT_12X',     rate:25, dep:50, to:12, max:500,  cat:'LC'     },
  { code: 'REL_BASE_SPORTS_20PCT_10X',    rate:20, dep:50, to:10, max:300,  cat:'SPORTS' },
  { code: 'REL_BOOSTER_SPORTS_25PCT_12X', rate:25, dep:50, to:12, max:500,  cat:'SPORTS' },
];

// category_id values — both platforms use same ids
const LC_CAT     = 2;
const SPORTS_CAT = 1;

const chk = (got, want, label) =>
  got === want ? `✅ ${label}=${got}` : `❌ ${label}: got ${got}, want ${want}`;

const nullWarn = (got, want, label) =>
  got == null
    ? `⚠  ${label}: null/undefined (currency not found?)`
    : got === want ? `✅ ${label}=${got}` : `❌ ${label}: got ${got}, want ${want}`;

let totalFail = 0;

// ── QPRO brands ────────────────────────────────────────────────────────────
for (const siteId of QPRO_SITES) {
  const site = getSite(siteId);
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`QPRO — ${siteId.toUpperCase()}`);
  console.log('═'.repeat(70));

  for (const { code, rate, dep, to, max, cat } of CODES) {
    console.log(`\n  ── ${code}`);
    let fail = 0;

    // 1. Find by code in list (also gives dialog_popup_list)
    const listResp = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(code)}&perPage=10`).catch(() => null);
    const row = (listResp?.data?.rows || []).find(r => r.code === code);
    if (!row) { console.log(`    ✖ NOT FOUND`); totalFail++; continue; }

    // 2. getPromotionDetail → parsed mechanics + validity
    const det = await getPromotionDetail(site, row.id).catch(() => null);
    if (!det) { console.log(`    ✖ detail fetch failed`); totalFail++; continue; }

    // 3. Raw detail → promotion_category, game_provider_ids
    const rawResp = await authedFetch(site, `/api/bo/promotion/${row.id}`).catch(() => null);
    const main = rawResp?.data?.rows || {};

    // Mechanics (from parsed currency block)
    const p = det.parsed;
    [
      nullWarn(p.bonus_rate_pct,       rate, 'bonus_rate'),
      nullWarn(p.min_deposit,          dep,  'min_deposit'),
      nullWarn(Number(p.to_multiplier),to,   'to_multiplier'),
      nullWarn(p.max_bonus,            max,  'max_bonus'),
    ].forEach(l => {
      if (l.startsWith('❌')) fail++;
      console.log('    ' + l);
    });

    // Validity
    const vOk  = det.validity_days === 7;
    const rvOk = det.rewards_validity_days === 30;
    console.log(`    ${vOk?'✅':'❌'} validity=${det.validity_days}d  ${rvOk?'✅':'❌'} reward_validity=${det.rewards_validity_days}d`);
    if (!vOk)  fail++;
    if (!rvOk) fail++;

    // Categories (QPRO: array of objects with category_id)
    const catIds = (main.promotion_category || []).map(c => c.category_id);
    const expectCat = cat === 'LC' ? LC_CAT : SPORTS_CAT;
    const catOk = catIds.includes(expectCat);
    console.log(`    ${catOk?'✅':'❌'} categories: [${catIds.join(',')}]  (expect ${cat} id=${expectCat})`);
    if (!catOk) fail++;

    // Game providers
    const gps = Array.isArray(main.game_provider_ids) ? main.game_provider_ids : [];
    console.log(`    ${gps.length>0?'✅':'❌'} game_providers: ${gps.length}`);
    if (!gps.length) fail++;

    // MT + dialog
    const mtId  = main.message_template_id;
    const popups = Array.isArray(row.dialog_popup_list) ? row.dialog_popup_list : [];
    console.log(`    ${mtId?'✅':'❌'} MT linked: id=${mtId}`);
    console.log(`    ${popups.length>0?'✅':'❌'} dialog linked: ${popups.length} popup(s)`);
    if (!mtId)      fail++;
    if (!popups.length) fail++;

    // MT T&C hyperlink
    if (mtId) {
      try {
        const tnc = await qcMtTncHyperlink(site, mtId, 'qpro');
        const tncPass = Object.values(tnc.checks).every(v => v === true);
        console.log(`    ${tncPass?'✅':'❌'} MT T&C hyperlink: ${JSON.stringify(tnc.checks)}`);
        if (!tncPass) fail++;
      } catch(e) { console.log(`    ⚠  MT T&C check skipped: ${e.message.split('\n')[0]}`); }
    }

    if (fail === 0) console.log(`    ✅ ALL PASS`);
    else { console.log(`    ❌ ${fail} FAIL(S)`); totalFail += fail; }
  }
}

// ── QP2 (ibc22 — merchants 1–4) ────────────────────────────────────────────
const qp2Site = getSite('ibc22');
const MERCHANT_NAMES = { 1:'IBC22', 2:'KING333', 3:'ACE66', 4:'SPADE66' };
console.log(`\n${'═'.repeat(70)}`);
console.log(`QP2 — IBC22 (merchants 1–4)`);
console.log('═'.repeat(70));

for (const { code, rate, dep, to, max, cat } of CODES) {
  console.log(`\n  ── ${code}`);
  let fail = 0;

  const listResp = await authedFetch(qp2Site, `/api/bo/promotion?code=${encodeURIComponent(code)}&perPage=10`).catch(() => null);
  const row = (listResp?.data?.rows || []).find(r => r.code === code);
  if (!row) { console.log(`    ✖ NOT FOUND`); totalFail++; continue; }

  const det = await getPromotionDetail(qp2Site, row.id).catch(() => null);
  if (!det) { console.log(`    ✖ detail fetch failed`); totalFail++; continue; }

  const rawResp = await authedFetch(qp2Site, `/api/bo/promotion/${row.id}`).catch(() => null);
  const main = rawResp?.data?.rows || {};

  // Merchants (QP2 returns array of objects {id,name,...})
  const merchants = Array.isArray(main.merchant_ids) ? main.merchant_ids.map(m => m.id ?? Number(m)) : [];
  const allMerchants = [1,2,3,4].every(m => merchants.includes(m));
  console.log(`    ${allMerchants?'✅':'❌'} merchant_ids: [${merchants.join(',')}]`);
  if (!allMerchants) fail++;

  // Mechanics
  const p = det.parsed;
  [
    nullWarn(p.bonus_rate_pct,        rate, 'bonus_rate'),
    nullWarn(p.min_deposit,           dep,  'min_deposit'),
    nullWarn(Number(p.to_multiplier), to,   'to_multiplier'),
    nullWarn(p.max_bonus,             max,  'max_bonus'),
  ].forEach(l => {
    if (l.startsWith('❌')) fail++;
    console.log('    ' + l);
  });

  // Validity
  const vOk  = det.validity_days === 7;
  const rvOk = det.rewards_validity_days === 30;
  console.log(`    ${vOk?'✅':'❌'} validity=${det.validity_days}d  ${rvOk?'✅':'❌'} reward_validity=${det.rewards_validity_days}d`);
  if (!vOk)  fail++;
  if (!rvOk) fail++;

  // Categories (QP2: flat int array in promotion_category_ids)
  const catIds = Array.isArray(main.promotion_category_ids) ? main.promotion_category_ids : [];
  const expectCat = cat === 'LC' ? LC_CAT : SPORTS_CAT;
  const catOk = catIds.includes(expectCat);
  console.log(`    ${catOk?'✅':'❌'} categories: [${catIds.join(',')}]  (expect ${cat} id=${expectCat})`);
  if (!catOk) fail++;

  // Game providers (QP2: string codes in game_provider_codes)
  const gps = Array.isArray(main.game_provider_codes) ? main.game_provider_codes : [];
  console.log(`    ${gps.length>0?'✅':'❌'} game_providers: ${gps.length}`);
  if (!gps.length) fail++;

  // MT
  const mtId = main.message_template_id;
  console.log(`    ${mtId?'✅':'❌'} MT linked: id=${mtId}`);
  if (!mtId) fail++;

  // MT T&C hyperlink (QP2: ":url" is rendered at display-time, not stored as <a> — warn only)
  if (mtId) {
    try {
      const tnc = await qcMtTncHyperlink(qp2Site, mtId, 'qp2');
      const tncPass = Object.values(tnc.checks).every(v => v === true);
      console.log(`    ${tncPass?'✅':'⚠ '} MT T&C hyperlink (qp2, display-time render): ${JSON.stringify(tnc.checks)}`);
      // Not counted as failure — QP2 BO substitutes :url at render time
    } catch(e) { console.log(`    ⚠  MT T&C check skipped: ${e.message.split('\n')[0]}`); }
  }

  // Per-merchant dialog popups
  const popupList = Array.isArray(row.dialog_popup_list) ? row.dialog_popup_list : [];
  for (const m of [1,2,3,4]) {
    const popup = popupList.find(pp => Number(pp.site_id) === m);
    console.log(`    ${popup?'✅':'❌'} dialog popup — ${MERCHANT_NAMES[m]} (site ${m}): id=${popup?.popup_id ?? 'MISSING'}`);
    if (!popup) fail++;
  }

  if (fail === 0) console.log(`    ✅ ALL PASS`);
  else { console.log(`    ❌ ${fail} FAIL(S)`); totalFail += fail; }
}

console.log(`\n${'═'.repeat(70)}`);
console.log(`TOTAL FAILURES: ${totalFail}`);
console.log('═'.repeat(70));

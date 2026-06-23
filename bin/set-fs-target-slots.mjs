#!/usr/bin/env node
// Populate the Target Amount section on QPRO Free Spin promos so operators see
// it filled in the BO edit form (currently blank when the turnover Category is
// unset — the Category→Provider cascade can't render the saved provider).
//
// For each ACTIVE Free Spin promo (promo_type=4) whose turnover category is not
// already exactly [SLOTS]:
//   • set promotion_category_turnover = { SLOTS }   (Target Amount → Categories)
//   • ensure target[].game_provider_ids is populated (fill from the promo's own
//     eligible game_provider_ids if empty) — Target Amount → Game Providers
// Everything else preserved (FS provider+game, top providers, blacklist,
// message/SMS template, dialog popup, caps, currencies, status). Matches the
// canonical create-mapper FS shape (api-mapper-qpro.js: promotion_category_turnover
// = SLOTS, target gp = eligible gp).
//
// DRY-RUN by default. --commit to write. --brands, --limit. Verifies after each.
//   node bin/set-fs-target-slots.mjs --brands qpro1
//   node bin/set-fs-target-slots.mjs --brands qpro1 --commit --limit 3
//   node bin/set-fs-target-slots.mjs --commit

import { authedFetch, getAllCategories } from '../src/api-client.js';
import { getSite } from '../src/sites.js';
import { writeFileSync, mkdirSync } from 'node:fs';

function getArg(flag) { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : null; }
const COMMIT = process.argv.includes('--commit');
const BRANDS_ARG = getArg('--brands');
const LIMIT = (() => { const a = getArg('--limit'); return a ? Number(a) : Infinity; })();
const ALL_BRANDS = Array.from({ length: 17 }, (_, i) => `qpro${i + 1}`);
const BRANDS = BRANDS_ARG ? BRANDS_ARG.split(',').map(s => s.trim()) : ALL_BRANDS;

const arrToObj = a => { const o = {}; (a || []).forEach((v, i) => { o[String(i)] = v; }); return o; };
const fmtDate = d => d ? String(d).replace('T', ' ').replace(/\.\d+Z?$/, '') : d;
const b01 = v => (v === true ? 1 : v === false ? 0 : v);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sortedEq = (a, b) => { const x = [...(a || [])].sort(), y = [...(b || [])].sort(); return x.length === y.length && x.every((v, i) => v === y[i]); };

function buildBody(p, topGpIds, targetGpLists, dialogEntry, slotsId) {
  const targetObj = {};
  (p.target || []).forEach((t, i) => {
    targetObj[String(i)] = { type: t.type, multiplier: t.multiplier, game_provider_ids: arrToObj(targetGpLists[i]) };
  });
  return {
    id: p.id, code: p.code, name: p.name,
    free_spin_game_provider_id: p.free_spin_game_provider_id ?? 0,
    ...(p.free_spin_game_code ? { free_spin_game_code: p.free_spin_game_code } : {}),
    promotion_category_turnover: { '0': slotsId },   // ← Target Amount Categories = SLOTS
    promotion_category_winloss: [],
    promo_type: p.promo_type, promo_sub_type: Number(p.promo_sub_type),
    promotion_ids: [],
    valid_from: fmtDate(p.valid_from), validity: p.validity, reward_validity: p.reward_validity,
    frequency: p.frequency ?? [], frequency_type: Number(p.frequency_type),
    first_deposit: p.first_deposit ?? 0, member_group_ids: [],
    last_deposit: b01(p.last_deposit ?? 0), auto_approve: b01(p.auto_approve),
    visible_by_affiliate: p.visible_by_affiliate ?? 0, recurring: Number(p.recurring),
    max_per_player: p.max_per_player, daily_max: p.daily_max, status: p.status ?? 1,
    limit_transfer_in: b01(p.limit_transfer_in ?? 0), limit_transfer_out: b01(p.limit_transfer_out ?? 0),
    restrict_claim_round_active: b01(p.restrict_claim_round_active ?? 0),
    restrict_same_provider_launch: b01(p.restrict_same_provider_launch ?? 0),
    bonus_rate: p.bonus_rate != null ? String(Number(p.bonus_rate).toFixed(2)) : undefined,
    ...(p.reset_frequency ? { reset_frequency: p.reset_frequency } : {}),
    auto_unlock: b01(p.auto_unlock), allow_cancel: p.allow_cancel,
    game_provider_ids: arrToObj(topGpIds),
    target: targetObj,
    message_template_id: p.message_template_id ?? 0,
    message_template_sms_id: p.message_template_sms_id ?? 0,
    eligible_types: Number(p.eligible_types),
    affiliate_group_ids: [], telemarketer_ids: [],
    normal_account_manager_ids: [], vip_account_manager_ids: [],
    requires_email: p.requires_email ?? 0, requires_mobile: p.requires_mobile ?? 0,
    requires_dob: p.requires_dob ?? 0, requires_fullname: p.requires_fullname ?? 0,
    transfer_unlock: b01(p.transfer_unlock ?? 0),
    kyc_basic: p.kyc_basic ?? 1, kyc_advanced: p.kyc_advanced ?? 1, kyc_pro: p.kyc_pro ?? 1,
    blacklist_id: p.blacklist_id, black_list_sub_categories: [],
    currencies_ids: p.currencies_ids ?? [],
    dialog_popup_list: dialogEntry ? { '0': dialogEntry } : [],
  };
}

async function listActiveFs(site) {
  const rows = [];
  let page = 1, lastPage = 1;
  do {
    const params = new URLSearchParams({ perPage: '100', page: String(page), status: '1', merchant_id: '', date_type: 'valid_from', sort_by: 'id', sort_order: 'desc' });
    const r = await authedFetch(site, `/api/bo/promotion?${params}`);
    rows.push(...Object.values(r.data?.rows || {}));
    lastPage = r.data?.paginations?.last_page ?? 1;
    page++;
  } while (page <= lastPage);
  return rows.filter(p => p.promo_type === 4);
}

async function loadPopups(site) {
  const map = new Map();
  for (let pg = 1; pg <= 8; pg++) {
    const pr = await authedFetch(site, `/api/bo/popups?perPage=300&page=${pg}`);
    const arr = Object.values(pr.data?.rows || {});
    if (!arr.length) break;
    arr.forEach(p => map.set(p.id, p));
  }
  return map;
}

console.log('═'.repeat(82));
console.log(`  FS TARGET-AMOUNT FILL (Categories=SLOTS)   [${COMMIT ? 'LIVE COMMIT' : 'DRY-RUN'}]   ${BRANDS.join(',')}`);
console.log('═'.repeat(82));

let gChange = 0, gNoop = 0, gFail = 0, gReplace = 0;
const failures = [], replaced = [], results = [];

for (const brand of BRANDS) {
  const site = getSite(brand);
  console.log(`\n========== ${brand.toUpperCase()} ==========`);
  let consecFail = 0;
  try {
    const cats = await getAllCategories(site);
    const slots = cats.find(c => String(c.code).toUpperCase() === 'SL') || cats.find(c => /slot/i.test(c.name || ''));
    if (!slots) { console.log('  ⚠ no SLOTS category found — skip'); continue; }
    const slotsId = slots.id;

    const fs = await listActiveFs(site);
    const popMap = (fs.some(p => Array.isArray(p.dialog_popup_list) && p.dialog_popup_list.length)) ? await loadPopups(site) : new Map();
    console.log(`  SLOTS id=${slotsId} | active FS promos=${fs.length}`);

    let processed = 0;
    for (const lp of fs) {
      if (processed >= LIMIT) { console.log(`  (limit ${LIMIT})`); break; }
      const detail = await authedFetch(site, `/api/bo/promotion/${lp.id}`).then(r => r.data?.rows);
      const topGp = detail.game_provider_ids || [];
      const turnoverCats = (detail.promotion_category || []).filter(c => c.target_type === 1).map(c => c.category_id);

      // desired target gp per target: preserve if populated, else fill from top eligible gp
      const targetGpLists = (detail.target || []).map(t => (t.game_provider_ids && t.game_provider_ids.length) ? t.game_provider_ids : topGp);
      const catOk = sortedEq(turnoverCats, [slotsId]);
      const targetOk = (detail.target || []).every(t => t.game_provider_ids && t.game_provider_ids.length);
      if (catOk && targetOk) { gNoop++; continue; }

      // reconstruct dialog (preserve)
      const dpList = Array.isArray(lp.dialog_popup_list) ? lp.dialog_popup_list : [];
      let dialogEntry = null;
      if (dpList.length) {
        const pop = popMap.get(dpList[0].popup_id);
        if (pop) { const title = (pop.contents?.[0]?.title) || pop.label || ''; dialogEntry = { id: pop.id, start_date: fmtDate(pop.start_date), end_date: null, promotion_id: lp.id, labelKey: `${pop.code} (${String(title).slice(0, 14)} . . . )`, code: pop.code }; }
        else { console.log(`  ⚠ ${lp.code}: popup ${dpList[0].popup_id} not in catalog — SKIP (avoid wipe)`); gNoop++; continue; }
      }

      const wasNonEmptyDiff = turnoverCats.length > 0 && !catOk;
      const tag = `cat[${turnoverCats.join(',') || '∅'}]→[${slotsId}]`;
      if (!COMMIT) {
        console.log(`  DRY ${lp.code.padEnd(30)} ${tag} target gp=${JSON.stringify(targetGpLists[0] || [])}${wasNonEmptyDiff ? '  ⚠REPLACES existing cat' : ''}`);
        if (wasNonEmptyDiff) { gReplace++; replaced.push({ brand, code: lp.code, had: turnoverCats }); }
        results.push({ brand, code: lp.code, hadCats: turnoverCats }); gChange++; processed++; continue;
      }

      try {
        const body = buildBody(detail, topGp, targetGpLists, dialogEntry, slotsId);
        await authedFetch(site, `/api/bo/promotion/${lp.id}`, { method: 'PUT', body });
        await sleep(120);
        const vl = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(lp.code)}&perPage=10&page=1`);
        const vrow = Object.values(vl.data?.rows || {}).find(x => x.id === lp.id);
        const vd = (await authedFetch(site, `/api/bo/promotion/${lp.id}`)).data?.rows;
        const vCats = (vd.promotion_category || []).filter(c => c.target_type === 1).map(c => c.category_id);
        const catSet = sortedEq(vCats, [slotsId]);
        const tgtSet = (vd.target || []).every(t => t.game_provider_ids && t.game_provider_ids.length);
        const curOk = sortedEq(vd.currencies_ids || [], detail.currencies_ids || []);
        const btOk = vd.blacklist_id === detail.blacklist_id;
        const mtOk = vd.message_template_id === detail.message_template_id;
        const stOk = vd.status === detail.status;
        const fsOk = vd.free_spin_game_provider_id === detail.free_spin_game_provider_id && vd.free_spin_game_code === detail.free_spin_game_code;
        const popOk = dialogEntry ? (Array.isArray(vrow.dialog_popup_list) && vrow.dialog_popup_list.length > 0) : true;
        const ok = catSet && tgtSet && curOk && btOk && mtOk && stOk && fsOk && popOk;
        console.log(`  ${ok ? '✓' : '✗'} ${lp.code.padEnd(30)} cats→[${vCats.join(',')}] tgtGp=${tgtSet} cur=${curOk} bt=${btOk} mt=${mtOk} fs=${fsOk} pop=${popOk}`);
        if (wasNonEmptyDiff) { gReplace++; replaced.push({ brand, code: lp.code, had: turnoverCats }); }
        results.push({ brand, code: lp.code, hadCats: turnoverCats, ok });
        if (ok) { gChange++; consecFail = 0; }
        else { gFail++; consecFail++; failures.push(`${brand} ${lp.code} (cat=${catSet} tgt=${tgtSet} cur=${curOk} bt=${btOk} mt=${mtOk} st=${stOk} fs=${fsOk} pop=${popOk})`); if (consecFail >= 3) { console.error('  ⛔ ABORT — 3 consecutive failures.'); throw new Error('abort-consecutive-failures'); } }
      } catch (e) {
        if (e.message === 'abort-consecutive-failures') throw e;
        console.error(`  ✗ ${lp.code} ERROR: ${e.message.split('\n')[0].slice(0, 90)}`);
        gFail++; consecFail++; failures.push(`${brand} ${lp.code}: ${e.message.split('\n')[0]}`);
        if (consecFail >= 3) { console.error('  ⛔ ABORT — 3 consecutive failures.'); throw new Error('abort-consecutive-failures'); }
      }
      processed++;
    }
  } catch (e) {
    if (e.message === 'abort-consecutive-failures') { console.error(`  Stopped ${brand} early.`); break; }
    console.log(`  ✗ Brand error: ${e.message.split('\n')[0].slice(0, 120)}`);
  }
}

console.log('\n' + '═'.repeat(82));
console.log(`  ${COMMIT ? 'COMMITTED' : 'DRY-RUN'}: ${COMMIT ? '✓' : 'would-change'} ${gChange}   already-ok(noop) ${gNoop}   ${COMMIT ? `✗ failed ${gFail}` : ''}`);
if (gReplace) console.log(`  ⚠ ${gReplace} promos had a non-empty/non-SLOTS turnover category that gets REPLACED by SLOTS (listed in JSON)`);
if (failures.length) { console.log(`  Failures: ${failures.length}`); failures.slice(0, 20).forEach(f => console.log('    ' + f)); }
try { mkdirSync('tmp', { recursive: true }); } catch {}
writeFileSync(`tmp/fs-target-${COMMIT ? 'commit' : 'dryrun'}.json`, JSON.stringify({ brands: BRANDS, commit: COMMIT, gChange, gNoop, gFail, gReplace, replaced, failures, results }, null, 2));
console.log(`  Results → tmp/fs-target-${COMMIT ? 'commit' : 'dryrun'}.json`);
console.log('═'.repeat(82));

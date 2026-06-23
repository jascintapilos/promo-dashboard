#!/usr/bin/env node
// Swap game provider PP (Pragmatic Play, DISABLED platform-wide) → PP2 (active
// replacement) on QPRO promos.  PP is status=0 on every QPRO brand; PP2 is
// status=1 with the same LC/SL categories — a drop-in replacement.
//
// For each ACTIVE promo whose game-provider set contains PP:
//   • remove PP from game_provider_ids and from every target[].game_provider_ids
//   • ensure PP2 is present wherever PP was removed
//   • Free Spin promos (promo_type=4): if free_spin_game_provider_id == PP,
//     ALSO move the FS award to PP2 — but only when the free_spin_game_code
//     exists on PP2 (validated against /freespingame/PP2).  If it does not,
//     the whole promo is SKIPPED and flagged (never written half-migrated).
//
// PRESERVES (re-sent verbatim from the detail): blacklist_id,
// message_template_id / sms, dialog_popup_list (reconstructed from the listing
// endpoint — the detail GET omits it), caps, currencies_ids, status, validity,
// recurring, eligibility, KYC, etc.  member_group_ids stays [] (QPRO rule).
// Does NOT re-send promotion_currency (QPRO wipes per-currency rows if sent).
//
// Verifies after every write: PP gone + PP2 present, gp count, currencies,
// blacklist, message/SMS template, dialog popup, status all intact (+ FS award
// moved for FS promos).  Aborts on 3 consecutive verify failures.
//
// DRY-RUN by default.  Pass --commit to write.
//   node bin/swap-pp-to-pp2-promos.mjs --brands qpro1                  (dry-run)
//   node bin/swap-pp-to-pp2-promos.mjs --brands qpro1 --commit         (commit)
//   node bin/swap-pp-to-pp2-promos.mjs --brands qpro1 --commit --limit 1
//   node bin/swap-pp-to-pp2-promos.mjs --commit                        (all 17)

import { authedFetch } from '../src/api-client.js';
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
const codesOf = p => (p.game_provider || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);

// Remove ppId; ensure pp2Id present only if ppId was there.
function swapIds(ids, ppId, pp2Id) {
  const arr = Array.isArray(ids) ? ids : [];
  if (!arr.includes(ppId)) return { out: arr.slice(), changed: false };
  const out = arr.filter(x => x !== ppId);
  if (!out.includes(pp2Id)) out.push(pp2Id);
  return { out, changed: true };
}

function buildQproPutBody(p, gpIds, targetGpLists, dialogEntry, fsOverride) {
  const catTov = arrToObj((p.promotion_category || []).filter(c => c.target_type === 1).map(c => c.category_id));
  const targetObj = {};
  (p.target || []).forEach((t, i) => {
    targetObj[String(i)] = { type: t.type, multiplier: t.multiplier, game_provider_ids: arrToObj(targetGpLists[i]) };
  });
  const fsCode = fsOverride ? fsOverride.gameCode : p.free_spin_game_code;
  return {
    id: p.id, code: p.code, name: p.name,
    free_spin_game_provider_id: fsOverride ? fsOverride.providerId : (p.free_spin_game_provider_id ?? 0),
    ...(fsCode ? { free_spin_game_code: fsCode } : {}),
    promotion_category_turnover: catTov, promotion_category_winloss: [],
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
    game_provider_ids: arrToObj(gpIds),
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

async function listActivePromos(site) {
  const rows = [];
  let page = 1, lastPage = 1;
  do {
    const params = new URLSearchParams({
      perPage: '100', page: String(page), status: '1',
      category_id: '', game_provider_code: '', currency_id: '', bonus_condition: '',
      merchant_id: '', date_type: 'valid_from', sort_by: 'id', sort_order: 'desc',
    });
    const r = await authedFetch(site, `/api/bo/promotion?${params}`);
    rows.push(...Object.values(r.data?.rows || {}));
    lastPage = r.data?.paginations?.last_page ?? 1;
    page++;
  } while (page <= lastPage);
  return rows;
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

console.log('═'.repeat(80));
console.log(`  PP → PP2 PROMO SWAP   [${COMMIT ? 'LIVE COMMIT' : 'DRY-RUN'}]   brands: ${BRANDS.join(', ')}`);
console.log('═'.repeat(80));

let gOk = 0, gFail = 0, gNoop = 0, gSkipFs = 0;
const failures = [], fsSkips = [], results = [];

for (const brand of BRANDS) {
  const site = getSite(brand);
  console.log(`\n========== ${brand.toUpperCase()} ==========`);
  let consecFail = 0;
  try {
    const gpResp = await authedFetch(site, '/api/bo/gameprovider?perPage=300&page=1');
    const cat = Object.values(gpResp.data?.rows || {});
    const pp = cat.find(g => g.code?.toUpperCase() === 'PP');
    const pp2 = cat.find(g => g.code?.toUpperCase() === 'PP2');
    if (!pp || !pp2) { console.log(`  skip — PP=${!!pp} PP2=${!!pp2} in catalog`); continue; }
    const ppId = pp.id, pp2Id = pp2.id;

    const pp2Games = await authedFetch(site, '/api/bo/gameprovider/freespingame/PP2').then(r => r.data?.rows || []).catch(() => []);
    const pp2Codes = new Set(pp2Games.map(g => String(g.code).toLowerCase()));

    const promos = await listActivePromos(site);
    const targets = promos.filter(p => codesOf(p).includes('PP'));
    console.log(`  PP id=${ppId} PP2 id=${pp2Id} | active=${promos.length} | contain PP=${targets.length} | pp2 FS games=${pp2Codes.size}`);

    const popMap = (targets.some(p => Array.isArray(p.dialog_popup_list) && p.dialog_popup_list.length)) ? await loadPopups(site) : new Map();

    let processed = 0;
    for (const lp of targets) {
      if (processed >= LIMIT) { console.log(`  (limit ${LIMIT} reached)`); break; }

      // reconstruct dialog popup entry (preserve link; detail GET drops it)
      const dpList = Array.isArray(lp.dialog_popup_list) ? lp.dialog_popup_list : [];
      let dialogEntry = null;
      if (dpList.length) {
        const pop = popMap.get(dpList[0].popup_id);
        if (pop) {
          const title = (pop.contents?.[0]?.title) || pop.label || '';
          dialogEntry = { id: pop.id, start_date: fmtDate(pop.start_date), end_date: null, promotion_id: lp.id, labelKey: `${pop.code} (${String(title).slice(0, 14)} . . . )`, code: pop.code };
        } else {
          console.log(`  ⚠ ${lp.code}: popup ${dpList[0].popup_id} not in catalog — SKIP (avoid wipe)`);
          gNoop++; continue;
        }
      }

      const detail = await authedFetch(site, `/api/bo/promotion/${lp.id}`).then(r => r.data?.rows);
      const curGp = detail.game_provider_ids || [];
      const { out: newGp, changed: gpChanged } = swapIds(curGp, ppId, pp2Id);
      const targetGpLists = (detail.target || []).map(t => swapIds(t.game_provider_ids || [], ppId, pp2Id).out);
      const targetChanged = (detail.target || []).some(t => (t.game_provider_ids || []).includes(ppId));

      // FS award move
      let fsOverride = null;
      if (detail.promo_type === 4 && detail.free_spin_game_provider_id === ppId) {
        const code = detail.free_spin_game_code;
        if (code && !pp2Codes.has(String(code).toLowerCase())) {
          console.log(`  ⚠ ${lp.code}: FS game "${code}" NOT on PP2 — SKIP (manual)`);
          fsSkips.push({ brand, code: lp.code, fsCode: code }); gSkipFs++; continue;
        }
        fsOverride = { providerId: pp2Id, gameCode: code || null };
      }

      const willChange = gpChanged || targetChanged || !!fsOverride;
      if (!willChange) { gNoop++; continue; }

      const tag = `t${detail.promo_type}`;
      if (!COMMIT) {
        console.log(`  DRY ${lp.code.padEnd(28)} [${tag}] gp ${curGp.length}→${newGp.length} −PP${newGp.includes(pp2Id) ? ' +PP2' : ''}${fsOverride ? ` FSaward→PP2(${fsOverride.gameCode || 'no-code'})` : ''} popup=${dialogEntry ? dialogEntry.code : '—'} bt=${detail.blacklist_id} mt=${detail.message_template_id}`);
        results.push({ brand, code: lp.code, type: detail.promo_type, before: curGp.length, after: newGp.length, fsMove: !!fsOverride });
        gOk++; processed++; continue;
      }

      try {
        const body = buildQproPutBody(detail, newGp, targetGpLists, dialogEntry, fsOverride);
        await authedFetch(site, `/api/bo/promotion/${lp.id}`, { method: 'PUT', body });
        await sleep(120);
        // verify
        const vl = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(lp.code)}&perPage=10&page=1`);
        const vrow = Object.values(vl.data?.rows || {}).find(x => x.id === lp.id);
        const vCodes = codesOf(vrow);
        const vd = (await authedFetch(site, `/api/bo/promotion/${lp.id}`)).data?.rows;
        const ppGone = !vCodes.includes('PP');
        const pp2There = vCodes.includes('PP2');
        const cntOk = (vd.game_provider_ids || []).length === newGp.length;
        const curOk = JSON.stringify((vd.currencies_ids || []).slice().sort()) === JSON.stringify((detail.currencies_ids || []).slice().sort());
        const btOk = vd.blacklist_id === detail.blacklist_id;
        const mtOk = vd.message_template_id === detail.message_template_id;
        const smsOk = vd.message_template_sms_id === detail.message_template_sms_id;
        const stOk = vd.status === detail.status;
        const popOk = dialogEntry ? (Array.isArray(vrow.dialog_popup_list) && vrow.dialog_popup_list.length > 0) : true;
        const fsOk = fsOverride ? (vd.free_spin_game_provider_id === pp2Id) : true;
        const ok = ppGone && pp2There && cntOk && curOk && btOk && mtOk && smsOk && stOk && popOk && fsOk;
        console.log(`  ${ok ? '✓' : '✗'} ${lp.code.padEnd(28)} [${tag}] gp ${curGp.length}→${vd.game_provider_ids.length}${fsOverride ? ' FS→PP2' : ''} pop=${popOk} cur=${curOk} bt=${btOk} mt=${mtOk} st=${stOk}`);
        results.push({ brand, code: lp.code, type: detail.promo_type, before: curGp.length, after: vd.game_provider_ids.length, fsMove: !!fsOverride, ok });
        if (ok) { gOk++; consecFail = 0; }
        else {
          gFail++; consecFail++;
          failures.push(`${brand} ${lp.code} (ppGone=${ppGone} pp2=${pp2There} cnt=${cntOk} cur=${curOk} bt=${btOk} mt=${mtOk} sms=${smsOk} st=${stOk} pop=${popOk} fs=${fsOk})`);
          if (consecFail >= 3) { console.error('  ⛔ ABORT — 3 consecutive verify failures.'); throw new Error('abort-consecutive-failures'); }
        }
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

console.log('\n' + '═'.repeat(80));
console.log(`  ${COMMIT ? 'COMMITTED' : 'DRY-RUN'}:  ${COMMIT ? '✓' : 'would-change'} ${gOk}   no-op ${gNoop}   FS-skipped ${gSkipFs}${COMMIT ? `   ✗ failed ${gFail}` : ''}`);
if (fsSkips.length) { console.log(`  FS promos skipped (game not on PP2): ${fsSkips.length}`); fsSkips.slice(0, 20).forEach(f => console.log(`    ${f.brand} ${f.code} (${f.fsCode})`)); }
if (failures.length) { console.log(`  Failures: ${failures.length}`); failures.slice(0, 20).forEach(f => console.log('    ' + f)); }
try { mkdirSync('tmp', { recursive: true }); } catch {}
writeFileSync(`tmp/pp-pp2-swap-${COMMIT ? 'commit' : 'dryrun'}.json`, JSON.stringify({ brands: BRANDS, commit: COMMIT, gOk, gNoop, gFail, gSkipFs, fsSkips, failures, results }, null, 2));
console.log(`  Results → tmp/pp-pp2-swap-${COMMIT ? 'commit' : 'dryrun'}.json`);
console.log('═'.repeat(80));

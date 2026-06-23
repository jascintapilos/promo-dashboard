// Combined fix script:
//   Phase A — SMS template :merchantname → :brandname swap (10 PUTs)
//   Phase B — Re-link dialog_popup_list on 195 promos (195 PUTs)
//
// Both phases independent → run via Promise.all.
//
// Default = dry-run; pass --commit to send PUTs.

import fs from 'node:fs';
import { authedFetch, updatePromotion } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const commit = process.argv.includes('--commit');

// ── Inputs ──
const inventory = JSON.parse(fs.readFileSync('captures/api-runs/orphan-inventory-p124-163.json', 'utf8'));
const finishCommit = JSON.parse(fs.readFileSync('captures/api-runs/finish-orphans-commit-summary.json', 'utf8'));
const popupByRnBrand = new Map();
for (const r of finishCommit.results) {
  if (r.popup_id) popupByRnBrand.set(`${r.rn}/${r.brand}`, r.popup_id);
}

// SMS template IDs from the backfill commit
const SMS_TPL_IDS = [
  { brand: 'QPRO3',  site: 'qpro3',  silver: 454, bronze: 453 },
  { brand: 'QPRO4',  site: 'qpro4',  silver: 375, bronze: 376 },
  { brand: 'QPRO6',  site: 'qpro6',  silver: 574, bronze: 575 },
  { brand: 'QPRO8',  site: 'qpro8',  silver: 616, bronze: 617 },
  { brand: 'QPRO10', site: 'qpro10', silver: 498, bronze: 497 },
];

const BRAND_TO_SITE = { QPRO3: 'qpro3', QPRO4: 'qpro4', QPRO6: 'qpro6', QPRO8: 'qpro8', QPRO10: 'qpro10' };

// ────────────────────────────────────────────────────────────────────────
// Phase A: SMS template placeholder fix
// ────────────────────────────────────────────────────────────────────────
async function fixSmsTemplate(brand, site, tplId) {
  const siteObj = getSite(site);
  try {
    const res = await authedFetch(siteObj, `/api/bo/messagetemplate/${tplId}`);
    const mt = res.data.message_template;
    const md = res.data.message_details || {};
    let changes = 0;
    const details = {};
    for (const [localeId, m] of Object.entries(md)) {
      const oldMsg = m.message || '';
      const newMsg = oldMsg.replace(/:merchantname/gi, ':brandname');
      const oldSubj = m.subject || '';
      const newSubj = oldSubj.replace(/:merchantname/gi, ':brandname');
      if (newMsg !== oldMsg) changes++;
      if (newSubj !== oldSubj) changes++;
      details[String(m.settings_locale_id)] = {
        settings_locale_id: m.settings_locale_id,
        subject: newSubj,
        message: newMsg,
      };
    }
    if (changes === 0) {
      return { brand, tplId, action: 'ALREADY_OK' };
    }
    const body = { id: tplId, name: mt.name, section: mt.section, type: mt.type, status: mt.status, code: mt.code, details };
    if (!commit) return { brand, tplId, action: 'DRY_RUN_PUT', changes };
    await authedFetch(siteObj, `/api/bo/messagetemplate/${tplId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return { brand, tplId, action: 'PUT_OK', changes };
  } catch (e) {
    return { brand, tplId, action: 'FAILED', error: e.message.slice(0, 200) };
  }
}

async function phaseA() {
  const tasks = [];
  for (const b of SMS_TPL_IDS) {
    tasks.push(fixSmsTemplate(b.brand, b.site, b.silver));
    tasks.push(fixSmsTemplate(b.brand, b.site, b.bronze));
  }
  const results = await Promise.all(tasks);
  return results;
}

// ────────────────────────────────────────────────────────────────────────
// Phase B: Re-link dialog_popup_list on 195 promos
// ────────────────────────────────────────────────────────────────────────
// Per-site popup lookup, lazy-fetched once.
const popupLookupBySite = new Map();
async function getPopupLookup(siteObj, siteId) {
  if (popupLookupBySite.has(siteId)) return popupLookupBySite.get(siteId);
  const map = new Map();
  // Walk pages until exhausted
  for (let page = 1; page <= 30; page++) {
    const r = await authedFetch(siteObj, `/api/bo/popups?perPage=100&page=${page}`);
    const rows = r?.data?.rows || [];
    for (const p of rows) map.set(p.id, p);
    if (rows.length < 100) break;
  }
  popupLookupBySite.set(siteId, map);
  return map;
}

async function relinkPopup(orph) {
  const popupId = popupByRnBrand.get(`${orph.rn}/${orph.brand}`);
  if (!popupId) return { ...orph, action: 'SKIP_NO_POPUP_ID' };
  const siteId = BRAND_TO_SITE[orph.brand];
  const site = getSite(siteId);
  try {
    const lookup = await getPopupLookup(site, siteId);
    const popup = lookup.get(popupId);
    if (!popup) return { ...orph, action: 'FAILED', error: `popup id=${popupId} not in lookup` };
    const popupCode = popup.code;
    const popupStart = popup.start_date;
    const popupLabel = popup.label;

    // Fetch the promotion fresh
    const det = await authedFetch(site, `/api/bo/promotion/${orph.promotion_id}`);
    const row = det.data.rows;
    const fmtDate = (iso) => iso ? String(iso).replace(/T/, ' ').replace(/\.\d+Z?$/, '').slice(0, 19) : null;
    const catIds = (row.promotion_category || []).map(x => x.category_id);
    const body = {
      id: row.id, code: row.code, name: row.name,
      free_spin_game_provider_id: row.free_spin_game_provider_id ?? 0,
      promotion_category_turnover: catIds,
      promotion_category_winloss: [],
      promo_type: row.promo_type,
      promo_sub_type: Number(row.promo_sub_type),
      promotion_ids: [],
      valid_from: fmtDate(row.valid_from),
      valid_to: fmtDate(row.valid_to),
      validity: row.validity,
      reward_validity: row.reward_validity,
      frequency_type: row.frequency_type,
      frequency: row.frequency,
      limit_transfer_out: row.limit_transfer_out,
      limit_transfer_in: row.limit_transfer_in,
      restrict_claim_round_active: row.restrict_claim_round_active,
      restrict_same_provider_launch: row.restrict_same_provider_launch,
      bonus_rate: row.bonus_rate,
      auto_unlock: row.auto_unlock,
      transfer_unlock: row.transfer_unlock,
      allow_cancel: row.allow_cancel,
      last_deposit: row.last_deposit,
      auto_approve: row.auto_approve,
      recurring: Number(row.recurring),
      reset_frequency: row.reset_frequency,
      reset_day: row.reset_day,
      max_per_player: row.max_per_player,
      daily_max: row.daily_max,
      eligible_types: row.eligible_types,
      kyc_basic: row.kyc_basic,
      kyc_advanced: row.kyc_advanced,
      kyc_pro: row.kyc_pro,
      requires_email: row.requires_email,
      requires_mobile: row.requires_mobile,
      requires_dob: row.requires_dob,
      requires_fullname: row.requires_fullname,
      visible_by_affiliate: row.visible_by_affiliate,
      blacklist_id: row.blacklist_id,
      target: row.target,
      member_group_ids: row.member_group_ids || [],
      game_provider_ids: row.game_provider_ids || [],
      message_template_id: row.message_template_id,
      message_template_sms_id: row.message_template_sms_id,
      dialog_popup_list: {
        '0': {
          id: popupId,
          start_date: fmtDate(popupStart) || fmtDate(row.valid_from),
          end_date: null,
          promotion_id: orph.promotion_id,
          labelKey: popupLabel ? `${popupCode} (${String(popupLabel).slice(0, 14)} . . . )` : popupCode,
          code: popupCode,
        },
      },
    };
    if (!commit) return { ...orph, popup_id: popupId, popup_code: popupCode, action: 'DRY_RUN_PUT' };
    await updatePromotion(site, orph.promotion_id, body);
    return { ...orph, popup_id: popupId, popup_code: popupCode, action: 'RELINKED' };
  } catch (e) {
    return { ...orph, action: 'FAILED', error: e.message.slice(0, 250) };
  }
}

async function runBatched(items, fn, concurrency = 20) {
  const results = new Array(items.length);
  let next = 0, done = 0;
  async function worker() {
    while (true) {
      const i = next++; if (i >= items.length) break;
      results[i] = await fn(items[i]);
      done++;
      if (done % 25 === 0) process.stderr.write(`  re-link ${done}/${items.length}\n`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

async function phaseB() {
  return runBatched(inventory, relinkPopup, 20);
}

// ────────────────────────────────────────────────────────────────────────
// Run both phases in parallel
// ────────────────────────────────────────────────────────────────────────
console.log(`Mode: ${commit ? 'LIVE (--commit)' : 'DRY-RUN'}`);
console.log(`Phase A: ${SMS_TPL_IDS.length * 2} SMS template PUTs (parallel)`);
console.log(`Phase B: ${inventory.length} promo re-link PUTs (parallel concurrency=20)`);
console.log('━━━━━━━━━━ Running both phases ━━━━━━━━━━');

const t0 = Date.now();
const [phaseAResults, phaseBResults] = await Promise.all([phaseA(), phaseB()]);
const dur = ((Date.now() - t0) / 1000).toFixed(1);

console.log(`\nDone in ${dur}s`);

console.log('\n━━━━━━━━━━ PHASE A — SMS template fixes ━━━━━━━━━━');
for (const r of phaseAResults) console.log(`  ${r.brand}  id=${r.tplId}  → ${r.action}${r.changes ? ` (${r.changes} replacements)` : ''}${r.error ? `  err=${r.error}` : ''}`);

console.log('\n━━━━━━━━━━ PHASE B — popup re-link ━━━━━━━━━━');
const tally = {};
for (const r of phaseBResults) tally[r.action] = (tally[r.action] || 0) + 1;
console.log('Tally:', JSON.stringify(tally));
const fails = phaseBResults.filter(r => r.action === 'FAILED');
if (fails.length) {
  console.log('\nFailures (first 10):');
  fails.slice(0, 10).forEach(r => console.log(`  ${r.rn} ${r.brand} id=${r.promotion_id} — ${r.error}`));
}

fs.writeFileSync(`captures/api-runs/sms-and-popup-fix-${commit ? 'commit' : 'dryrun'}.json`,
  JSON.stringify({ generated: new Date().toISOString(), mode: commit ? 'live' : 'dryrun',
    phaseA: phaseAResults, phaseB: phaseBResults, tally }, null, 2));
console.log(`\nReport → captures/api-runs/sms-and-popup-fix-${commit ? 'commit' : 'dryrun'}.json`);

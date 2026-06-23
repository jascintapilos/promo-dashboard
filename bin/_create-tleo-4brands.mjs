#!/usr/bin/env node
// Create all 54 TLEO codes from qpro2 → qpro5, qpro7, qpro15, qpro16.
// MYR only, MY_EN + MY_ZH. Full clone per code:
//   promo + blacklist(by name) + category-restricted providers (slot PP-rule)
//   + inbox MT (localized) + SMS MT (2 generics, localized) + names + popup.
//
// Content localization: brand refs "12HUAT"/"12huatmy.com" → :brandname;
//   T&C hyperlink domain stripped → relative path (brand-agnostic).
//
// Run: node bin/_create-tleo-4brands.mjs --dry-run [--brand=qpro5] [--limit=2]
//      node bin/_create-tleo-4brands.mjs --commit  [--brand=qpro5] [--limit=2]

import { parseArgs } from './_args.js';
import {
  authedFetch, createPromotion, createMessageTemplate, addPromotionName,
  updatePromotion, createDialogPopup, findPromotionByCode,
} from '../src/api-client.js';
import { getSite } from '../src/sites.js';
import { buildApiPlan } from '../src/api-mapper-qpro.js';
import { getBlacklistTemplates, _resetCache } from '../src/blacklist-template.js';

const { flags } = parseArgs(process.argv.slice(2));
const commit = flags.commit === true;
const dryRun = !commit;
const brandFilter = flags.brand ? String(flags.brand).toLowerCase() : null;
const LIMIT = flags.limit ? Number(flags.limit) : Infinity;

const SRC = 'qpro2';
const TARGETS = ['qpro5', 'qpro7', 'qpro15', 'qpro16'].filter(t => !brandFilter || t === brandFilter);
const BRAND_LABEL = { qpro5: 'QPRO5', qpro7: 'QPRO7', qpro15: 'QPRO15', qpro16: 'QPRO16' };
const LOCALES = ['MY_EN', 'MY_ZH'];
const LOCALE_TO_ID = { MY_EN: '1', MY_ZH: '3', SG_EN: '6', SG_ZH: '7' };

const arrToObj = a => Object.fromEntries((a || []).map((v, i) => [String(i), v]));
const fmtDate = d => d ? String(d).replace('T', ' ').replace(/\.\d+Z?$/, '') : d;
const nowYmdHms = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = s => String(s || '').trim().toLowerCase();

// Content localization: strip source brand/domain, use :brandname placeholder.
function localize(s) {
  if (s == null) return s;
  return String(s)
    .replace(/https?:\/\/12huatmy\.com/gi, '')      // T&C href → relative path
    .replace(/12huatmy\{dot\}com/gi, ':brandname')   // SMS literal domain
    .replace(/12huatmy\.com/gi, ':brandname')
    .replace(/12huatmy/gi, ':brandname')
    .replace(/12HUAT/g, ':brandname')
    .replace(/12huat/gi, ':brandname');
}

function catOf(code) {
  if (/TLEO_FC|_FC\d/.test(code)) return 'both';
  if (/_LC_/.test(code) || /^FT_REL_TLEO_LC/.test(code) || /_LC$/.test(code)) return 'lc';
  return 'slots';
}

// ── 1. Preload qpro2 source (all 54 codes) ───────────────────────────────────
const srcSite = getSite(SRC);
const srcGp = await authedFetch(srcSite, '/api/bo/gameprovider?perPage=300&page=1');
const srcIdToCode = {}; Object.values(srcGp.data?.rows || {}).forEach(g => { srcIdToCode[g.id] = g.code; });
const srcTpls = await getBlacklistTemplates(srcSite);
const srcBtName = Object.fromEntries(srcTpls.map(t => [t.id, t.name]));

const listR = await authedFetch(srcSite, '/api/bo/promotion?code=TLEO&perPage=200&page=1');
const srcList = Object.values(listR.data?.rows || {}).filter(p => p.code?.includes('TLEO'));

// SMS templates (2 generics) content
async function getMt(id) {
  const r = await authedFetch(srcSite, `/api/bo/messagetemplate/${id}`);
  return { meta: r.data?.message_template || r.data, details: r.data?.message_details || {} };
}
// popup cache
const srcPopups = new Map();
for (let pg = 1; pg <= 6; pg++) {
  const pr = await authedFetch(srcSite, `/api/bo/popups?perPage=300&page=${pg}`);
  const arr = Object.values(pr.data?.rows || {});
  if (!arr.length) break;
  arr.forEach(p => srcPopups.set(p.id, p));
}

const SOURCE = {};
const smsIds = new Set();
console.log(`Preloading ${srcList.length} source codes from ${SRC}…`);
for (const lp of srcList) {
  const d = await authedFetch(srcSite, `/api/bo/promotion/${lp.id}`);
  const p = d.data?.rows;
  const cur = await authedFetch(srcSite, `/api/bo/promotioncurrency?promotion_id=${lp.id}&perPage=20&page=1`);
  const myr = Object.values(cur.data?.rows || {}).find(c => c.currency === 'MYR');
  const inbox = p.message_template_id ? await getMt(p.message_template_id) : null;
  if (p.message_template_sms_id) smsIds.add(p.message_template_sms_id);
  const popupId = (Array.isArray(lp.dialog_popup_list) && lp.dialog_popup_list[0]) ? lp.dialog_popup_list[0].popup_id : null;
  SOURCE[p.code] = {
    detail: p, cat: catOf(p.code),
    gp_codes: (p.game_provider_ids || []).map(id => srcIdToCode[id]).filter(Boolean),
    blacklist_name: srcBtName[p.blacklist_id] || null,
    sms_id: p.message_template_sms_id || null,
    myr, inbox, popup: popupId ? srcPopups.get(popupId) : null,
    names: { en: lp.name, },
  };
}
// SMS content
const SMS = {};
for (const id of smsIds) SMS[id] = await getMt(id);
console.log(`  loaded. SMS generics: ${[...smsIds].join(',')}`);

// ── 2. buildResolved for the mapper ──────────────────────────────────────────
function buildResolved(code, s) {
  const p = s.detail;
  const isLC = s.cat === 'lc', isFC = s.cat === 'both';
  const minDep = Number(s.myr?.min_transfer ?? 0);
  const maxBonus = Number(s.myr?.max_bonus ?? 0);
  const to = p.target?.[0]?.multiplier ?? (isLC ? 8 : 3);
  const bonusRate = Number(p.bonus_rate) || (code.match(/_(\d+)PCT/) ? Number(code.match(/_(\d+)PCT/)[1]) : 0);
  const fcAmount = isFC ? Number(s.myr?.free_credit_amount ?? s.myr?.bonus_amount ?? 0) : 0;
  // names from source promotion_name rows (EN/ZH) — fetch admin name; consumer names mirror EN
  const nameEn = p.name;
  return {
    promo_code: code,
    name_details_raw: p.name,
    bonus_type: isFC ? 'Free Credit' : 'Deposit',
    bonus_sub_type: isFC ? null : 'Reload',
    validity_days: p.validity ?? 1,
    rewards_validity_days: p.reward_validity ?? 1,
    recurring: p.recurring === 1 || p.recurring === true,
    max_per_player: p.max_per_player ?? 999999,
    daily_max: p.daily_max ?? 999999,
    currencies: ['MYR'],
    locales: LOCALES,
    promotion_name_en: nameEn,
    promotion_name_zh_id: nameEn,
    inbox_message: true,
    popup_dialog: false,
    parsed: {
      bonus_rate_pct: bonusRate, max_bonus: maxBonus, min_deposit: minDep,
      to_multiplier: to, free_credit_amount: fcAmount, game: 'All games',
    },
    per_currency_overrides: { MYR: { min_deposit: minDep, max_bonus: maxBonus, free_credit_amount: fcAmount } },
    instructions: {
      categories_only: isLC ? ['live casino'] : isFC ? ['slots', 'live casino'] : ['slots'],
    },
  };
}

// GP: source codes → target ids, apply slot PP-rule (exclude PP, ensure PP2)
function resolveGp(s, targetByCode) {
  let codes = [...s.gp_codes];
  if (s.cat === 'slots') { codes = codes.filter(c => c !== 'PP'); if (!codes.includes('PP2')) codes.push('PP2'); }
  const ids = []; const missing = [];
  for (const c of codes) { const id = targetByCode[c]; if (id == null) missing.push(c); else ids.push(id); }
  return { ids: ids.sort((a, b) => a - b), missing };
}

// build localized MT details for target locales
function localizedMtDetails(srcDetails) {
  const out = {};
  for (const loc of LOCALES) {
    const id = LOCALE_TO_ID[loc];
    const d = srcDetails[id];
    if (d) out[id] = { settings_locale_id: Number(id), subject: localize(d.subject), message: localize(d.message) };
  }
  return Object.keys(out).length ? out : null;
}

// ── 3. Per-target execution ───────────────────────────────────────────────────
let totalOk = 0, totalFail = 0, totalSkip = 0;
const failures = [];

for (const tid of TARGETS) {
  const site = getSite(tid);
  const brand = BRAND_LABEL[tid];
  console.log(`\n━━━━━━━━ ${brand} (${tid}) ━━━━━━━━`);
  _resetCache();
  const gp = await authedFetch(site, '/api/bo/gameprovider?perPage=300&page=1');
  const tgtByCode = {}; Object.values(gp.data?.rows || {}).forEach(g => { tgtByCode[g.code] = g.id; });
  const tpls = await getBlacklistTemplates(site);
  const btByName = {}; tpls.forEach(t => { btByName[norm(t.name)] = t.id; });
  const resolveBt = name => name ? (btByName[norm(name)] ?? null) : null;

  // Existing message templates (code→id) for SMS reuse / idempotency
  const mtCodeToId = {};
  if (!dryRun) {
    for (let pg = 1; pg <= 4; pg++) {
      const mr = await authedFetch(site, `/api/bo/messagetemplate?perPage=200&page=${pg}`);
      const arr = Object.values(mr.data?.rows || {});
      if (!arr.length) break;
      arr.forEach(t => { if (t.code) mtCodeToId[t.code.toUpperCase()] = t.id; }); // BO uppercases codes
      if (arr.length < 200) break;
    }
  }

  // Create (or reuse) the 2 SMS generics (localized) → map srcSmsId → tgtSmsId
  const smsMap = {};
  for (const sid of Object.keys(SMS)) {
    const src = SMS[sid];
    const smsCode = `PROMOTIONS.SMS.${src.meta.name}`;
    const upper = smsCode.toUpperCase();
    const details = {};
    for (const loc of LOCALES) { const id = LOCALE_TO_ID[loc]; const d = src.details[id]; if (d) details[id] = { settings_locale_id: Number(id), subject: localize(d.subject), message: localize(d.message) }; }
    const body = { name: src.meta.name, code: smsCode, section: Number(src.meta.section), type: Number(src.meta.type), status: 1, details };
    if (dryRun) { console.log(`  DRY SMS ${src.meta.name}: ${Object.keys(details).length} locales`); smsMap[sid] = `<sms:${sid}>`; continue; }
    if (mtCodeToId[upper]) { smsMap[sid] = mtCodeToId[upper]; console.log(`  SMS reuse ${src.meta.name} → id=${smsMap[sid]}`); continue; }
    try {
      const r = await createMessageTemplate(site, body); await sleep(120);
      smsMap[sid] = r.data?.rows?.id || r.data?.id;
      console.log(`  SMS created ${src.meta.name} → id=${smsMap[sid]}`);
    } catch (e) {
      if (!/already been taken/i.test(e.message)) throw e;
      let found = null;
      for (let pg = 1; pg <= 4 && !found; pg++) {
        const mr = await authedFetch(site, `/api/bo/messagetemplate?perPage=200&page=${pg}`);
        const arr = Object.values(mr.data?.rows || {});
        found = arr.find(t => (t.code || '').toUpperCase() === upper);
        if (arr.length < 200) break;
      }
      if (!found) throw e;
      smsMap[sid] = found.id;
      console.log(`  SMS recovered ${src.meta.name} → id=${smsMap[sid]} (existing)`);
    }
    mtCodeToId[upper] = smsMap[sid];
  }

  let n = 0;
  for (const [code, s] of Object.entries(SOURCE)) {
    if (n >= LIMIT) { console.log(`  (limit ${LIMIT} reached)`); break; }
    n++;
    try {
      if (!dryRun) {
        const existing = await findPromotionByCode(site, code);
        if (existing) { console.log(`  SKIP ${code}: exists id=${existing.id}`); totalSkip++; continue; }
      }
      const resolved = buildResolved(code, s);
      const btId = resolveBt(s.blacklist_name);
      resolved.instructions.blacklist_id = btId;  // explicit (incl null) → mapper uses in POST + PUT
      const plan = await buildApiPlan(resolved, { brand, site });
      const { ids: gpIds, missing } = resolveGp(s, tgtByCode);
      if (missing.length) console.log(`    [GP] ${code}: unmapped ${missing.join(',')}`);
      plan.promotion.game_provider_ids = arrToObj(gpIds);
      if (plan.promotion.target?.['0']) plan.promotion.target['0'].game_provider_ids = arrToObj(gpIds);
      const inboxDetails = s.inbox ? localizedMtDetails(s.inbox.details) : null;

      if (dryRun) {
        console.log(`  DRY ${code} [${s.cat}] gp=${gpIds.length} bt=${s.blacklist_name||'null'}→${btId} inbox=${inboxDetails?Object.keys(inboxDetails).length:0}loc sms=${s.sms_id?'y':'n'} popup=${s.popup?'y':'n'} minDep=${resolved.parsed.min_deposit} maxBns=${resolved.parsed.max_bonus}${s.cat==='both'?` fc=${resolved.parsed.free_credit_amount}`:''}`);
        totalOk++; continue;
      }

      // POST promo
      const created = await createPromotion(site, plan.promotion); await sleep(120);
      const pid = created.data?.rows?.id || created.data?.id;
      if (!pid) throw new Error('no promo id');
      // inbox MT
      let mtId = 0;
      if (inboxDetails) {
        const mtBody = { name: code, code: `PROMOTIONS.MESSAGE.${code}`, section: 8, type: 1, status: 1, details: inboxDetails };
        const mr = await createMessageTemplate(site, mtBody); await sleep(120);
        mtId = mr.data?.rows?.id || mr.data?.id || 0;
      }
      // names
      for (const nb of plan.buildNames(pid)) { await addPromotionName(site, nb); await sleep(80); }
      // popup (clone source content, no localization needed)
      let dialogEntry = null;
      if (s.popup) {
        const contents = {};
        for (const c of (s.popup.contents || [])) {
          contents[String(c.locale_id)] = {
            locale_id: c.locale_id, content: c.content, title: c.title,
            mobile_link: null, desktop_link: null, video_mobile_link: null, video_desktop_link: null, media_type: null,
            cta_button_type: c.cta_button_type, cta_button_text_1: c.cta_button_text_1, cta_button_link_1: c.cta_button_link_1,
            cta_button_text_2: c.cta_button_text_2, cta_button_link_2: c.cta_button_link_2,
          };
        }
        // keep only target locales (MY_EN=1, MY_ZH=3)
        const filtered = {}; for (const k of ['1', '3']) if (contents[k]) filtered[k] = contents[k];
        const popBody = { platform: 1, start_date: nowYmdHms(), session: 3, position: 99, status: 1, location: 1, affiliates_visibility: 0, always_pop: 0, label: code, contents: Object.keys(filtered).length ? filtered : contents };
        const pr = await createDialogPopup(site, popBody); await sleep(120);
        const pd = pr.data?.rows || pr.data;
        if (pd?.id) dialogEntry = { id: pd.id, start_date: pd.start_date || nowYmdHms(), end_date: null, promotion_id: pid, labelKey: `${pd.code} (${String(resolved.promotion_name_en).slice(0, 14)} . . . )`, code: pd.code };
      }
      // PUT link: mt + sms + popup. Override GP (buildUpdate otherwise resets
      // to the mapper's Layer-1 set — the trap that left earlier clones unrestricted).
      const putBody = plan.buildUpdate(pid, mtId, dialogEntry);
      putBody.message_template_sms_id = smsMap[s.sms_id] || 0;
      putBody.game_provider_ids = arrToObj(gpIds);
      if (putBody.target) for (const k of Object.keys(putBody.target)) if (putBody.target[k]) putBody.target[k].game_provider_ids = arrToObj(gpIds);
      await updatePromotion(site, pid, putBody); await sleep(150);
      // verify
      const vl = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(code)}&perPage=5`);
      const vrow = Object.values(vl.data?.rows || {}).find(x => x.code === code);
      const vCount = (vrow?.game_provider || '').split(',').map(x => x.trim()).filter(Boolean).length;
      const vPopup = Array.isArray(vrow?.dialog_popup_list) ? vrow.dialog_popup_list.length > 0 : false;
      const okv = !!vrow && vCount === gpIds.length && vrow.message_template_id > 0
        && (!s.sms_id || vrow.message_template_sms_id > 0) && (!s.popup || vPopup);
      console.log(`  ${okv ? '✓' : '⚠'} ${code} id=${pid} gp=${vCount}/${gpIds.length} mt=${vrow?.message_template_id} sms=${vrow?.message_template_sms_id} popup=${vPopup ? (dialogEntry ? dialogEntry.id : 'y') : '-'} bt=${btId}`);
      if (okv) totalOk++; else { totalFail++; failures.push(`${tid} ${code}: verify gp=${vCount}/${gpIds.length} mt=${vrow?.message_template_id} sms=${vrow?.message_template_sms_id} popup=${vPopup}`); }
    } catch (e) {
      console.error(`  ✗ ${code}: ${e.message.split('\n')[0]}`);
      totalFail++; failures.push(`${tid} ${code}: ${e.message.split('\n')[0]}`);
    }
  }
}

console.log(`\n=== SUMMARY ===  OK: ${totalOk}  Failed: ${totalFail}  Skipped: ${totalSkip}${dryRun ? '  (DRY RUN)' : ''}`);
if (failures.length) failures.forEach(f => console.log('  ' + f));

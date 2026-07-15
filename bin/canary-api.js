#!/usr/bin/env node
// canary-api — API-direct equivalent of canary-write.js.
//
// Hits the QPRO Back Office REST endpoints directly instead of driving the
// Create-form UI through Playwright. Designed to produce the same final
// state as a successful canary-write run (idempotency check + main POST +
// per-locale Names + Message Template + final PUT to link the template).
//
//   node bin/canary-api.js <handle> [--commit] [--site=<id>] [--parallel-qc]
//
//   --commit       actually hit the BO. Without it, prints the action plan
//                  and the would-be POST/PUT bodies (no network IO).
//   --site=<id>    overrides the BO site (defaults to brand → site map).
//   --parallel-qc  fire post-save QC Level 1/2/3 fetches concurrently
//                  (~3-5s → ~1-2s). Output format identical; opt-in only.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from './_args.js';
import { loadAllRequests, resolveDuplicates, validatePlan, resolveHandle } from '../src/planner.js';
import { loadBoCodeIndex, fetchBoCodeAsRecord } from '../src/bo-cache.js';
import { getSite } from '../src/sites.js';
import { BRAND_TO_SITE } from '../src/ingest.js';
import {
  createPromotion, addPromotionName, createMessageTemplate,
  createDialogPopup, updatePromotion, findPromotionByCode,
  getPromotionDetail,
} from '../src/api-client.js';
import { buildApiPlan } from '../src/api-mapper-qpro.js';
import { qcMtTncHyperlink } from '../src/qc-mt-tnc.js';
import { writebackPromoFields } from '../src/sheet-writeback.js';

// Clean-exit helper. `process.exit(N)` from top-level after async work
// races libuv on still-closing keepalive sockets (Windows: STATUS_STACK_
// BUFFER_OVERRUN 3221226505). Setting `exitCode` and unref-deferring the
// hard exit lets pending I/O drain first. All early-exit paths use
// `return bail(N)` inside the main async IIFE.
function bail(code) {
  process.exitCode = code;
  setTimeout(() => process.exit(code), 50).unref();
}

await (async () => {

// ── Args ──────────────────────────────────────────────────────────────
const { flags, positional } = parseArgs(process.argv.slice(2));
const userInput = positional[0];
if (!userInput) {
  console.error('usage: canary-api.js <handle|P###> [--commit] [--brand=QPROx] [--site=<id>]');
  return bail(2);
}
const commit = flags.commit === true;
const brandOverride = flags.brand;
const siteOverride = flags.site;
const parallelQc = flags['parallel-qc'] === true;
const allowRecreate = flags['allow-recreate'] === true; // skip idempotency bail when code exists but inactive

// ── Load + resolve ────────────────────────────────────────────────────
const { byHandle, byId, byCode } = await loadAllRequests();
// Auto-resolve bare P### → current-month handle.
const handle = resolveHandle(userInput, { byHandle, byId });
if (!handle) {
  console.error(`request "${userInput}" not found in captures/requests/`);
  console.error('  If this is a new request, run: node bin/ingest-requests.js');
  return bail(2);
}
if (handle !== userInput) console.log(`(auto-resolved "${userInput}" → "${handle}" — current-month row)`);
const request = byHandle.get(handle);
if (!request) { console.error(`handle "${handle}" not found`); return bail(2); }
const bo = await loadBoCodeIndex();
let resolved = await resolveDuplicates(request, byCode, { boIndex: bo.byCode, boFetcher: fetchBoCodeAsRecord });
// Col W can hold multi-line codes (e.g. "CODE\nWS2: CODE_V2"). QPRO always uses line 1.
if (resolved.promo_code && resolved.promo_code.includes('\n')) {
  resolved = { ...resolved, promo_code: resolved.promo_code.split('\n')[0].trim() };
}

// ── Brand whitelist (QPRO only — QP2 routes through canary-api-qp2) ───
// QPRO18 (Pokies Palace, AUD) + QPRO19 (OzPokies77, AUD) dropped 2026-05-16
// per operator (separate AUD ops cluster, no promo_testbot account).
const SAFE_BRANDS = new Set([
  'QPRO1','QPRO2','QPRO3','QPRO4','QPRO5','QPRO6','QPRO7','QPRO8','QPRO9',
  'QPRO10','QPRO11','QPRO12','QPRO13','QPRO14','QPRO15','QPRO16','QPRO17',
]);
// If --brand=QPROx is passed AND it's on the safe-list AND it's in the
// request's brand list, use it. Otherwise fall back to picking the
// first matching QPRO brand from the request.
const targetBrand = (brandOverride && SAFE_BRANDS.has(brandOverride) && resolved.brands.includes(brandOverride))
  ? brandOverride
  : resolved.brands.find((b) => SAFE_BRANDS.has(b));
if (!targetBrand) {
  console.error(`REFUSED: brands [${resolved.brands.join(', ')}] none on QPRO safe-list.`);
  return bail(3);
}
const platform = (BRAND_TO_SITE[targetBrand]?.platform || 'qpro').toLowerCase();
if (platform !== 'qpro') {
  console.error(`REFUSED: platform "${platform}" not supported yet (this runner is QPRO-only). For QP2 brands use canary-write.js.`);
  return bail(3);
}
const siteId = siteOverride || BRAND_TO_SITE[targetBrand].siteId;
const site = getSite(siteId);

const gaps = validatePlan(resolved);
if (gaps.length) {
  console.error(`REFUSED: plan has ${gaps.length} gap(s):`);
  gaps.forEach((g) => console.error(`  • ${g}`));
  return bail(4);
}

// ── Build the API plan ────────────────────────────────────────────────
const plan = await buildApiPlan(resolved, { brand: targetBrand, site });

// ── Preview ───────────────────────────────────────────────────────────
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`API-DIRECT PROMO CREATE — ${commit ? 'LIVE (--commit)' : 'DRY-RUN'}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`Request:   ${handle}  (${resolved.requestor})`);
console.log(`Target:    ${targetBrand} on ${siteId}  (${site.label})`);
console.log(`Code:      ${resolved.promo_code}`);
console.log(`Bonus:     ${resolved.bonus_type}${resolved.bonus_sub_type ? ' / ' + resolved.bonus_sub_type : ''}`);
console.log(`Currencies:${(resolved.currencies||[]).join(', ')}  Locales: ${(resolved.locales||[]).join(', ')}`);
if (plan.currencyFilter) {
  console.log(`           ↳ FS provider supports only ${plan.currencyFilter.kept.join(', ')} on ${targetBrand} — dropped ${plan.currencyFilter.dropped.join(', ')}`);
}
if (plan.tierConstraint) {
  console.log(`Tier:      ${plan.tierConstraint.tier} and ${plan.tierConstraint.direction} → [${(plan.tierConstraint.eligible_tiers||[]).join(', ')}] (QPRO reference only; member_group_ids stays [])`);
}
if (plan.categoriesOnly) {
  console.log(`Categories only: ${plan.categoriesOnly.join(', ')}`);
}
console.log('');
console.log('Calls:');
let step = 1;
console.log(`  ${step++}. POST /api/bo/promotion           body=${JSON.stringify(plan.promotion).length} bytes`);
if (plan.messageTemplate) console.log(`  ${step++}. POST /api/bo/messagetemplate     body=${JSON.stringify(plan.messageTemplate).length} bytes (inbox locales: ${Object.keys(plan.messageTemplate.details).join(', ')})`);
if (plan.smsTemplate) console.log(`  ${step++}. POST /api/bo/messagetemplate     body=${JSON.stringify(plan.smsTemplate).length} bytes (sms locales: ${Object.keys(plan.smsTemplate.details).join(', ')})`);
if (plan.dialogPopup) console.log(`  ${step++}. POST /api/bo/popups              body=${JSON.stringify(plan.dialogPopup).length} bytes (locales: ${Object.keys(plan.dialogPopup.contents).join(', ')})`);
const namePreviews = plan.buildNames(0);
console.log(`  ${step++}. POST /api/bo/promotionname × ${namePreviews.length} (locales: ${namePreviews.map((n) => n.settings_locale_id).join(', ')})`);
console.log(`  ${step++}. PUT  /api/bo/promotion/{id}      (link inbox MT + sms MT + dialog popup)`);
console.log('');

// ── Idempotency check (live via /api/bo/promotion?code=…) ─────────────
// The snapshot under captures/bo-codes/ is stale by design (only refreshed
// by sync-promo-codes.js). A live lookup catches codes created between
// snapshots — including by this same canary on a previous --commit run.
const merchantKey = (BRAND_TO_SITE[targetBrand]?.merchantName || targetBrand).toUpperCase();
try {
  const existing = await findPromotionByCode(site, resolved.promo_code);
  if (existing) {
    const inactive = existing.status === 0 || existing.status === '0';
    if (inactive && allowRecreate) {
      console.log(`⚠ Code "${resolved.promo_code}" exists but is inactive (id=${existing.id}) — proceeding with --allow-recreate`);
    } else {
      console.error(`✖ IDEMPOTENCY: code "${resolved.promo_code}" already exists on ${siteId}/${merchantKey} (id=${existing.id}, status=${existing.status}).`);
      if (inactive) console.error('  Promo is inactive — re-run with --allow-recreate to proceed.');
      else console.error('  Skipping. Change the promo_code (sheet col W) and re-ingest if you need a fresh save.');
      return bail(5);
    }
  } else {
    console.log(`✓ Idempotency (live): no existing "${resolved.promo_code}" on ${siteId}/${merchantKey}`);
  }
} catch (e) {
  console.log(`⚠ Idempotency check skipped (live lookup failed): ${e.message.split('\n')[0]}`);
  // Don't abort — the BO will still reject duplicates server-side with 422.
}

// Dry-run branch — write the request bodies for inspection and fall
// through to natural exit (don't process.exit; that races libuv on
// pending keepalive sockets and asserts on Windows).
if (!commit) {
  console.log('');
  console.log('Dry-run. To run for real: add --commit.');
  // Dump the bodies so the operator can inspect.
  const dryDir = path.resolve('captures/api-runs');
  await mkdir(dryDir, { recursive: true });
  const dryPath = path.join(dryDir, `dryrun-${handle}-${new Date().toISOString().replace(/[:.]/g,'-')}.json`);
  await writeFile(dryPath, JSON.stringify({
    handle, brand: targetBrand, site: siteId, code: resolved.promo_code,
    promotion: plan.promotion,
    messageTemplate: plan.messageTemplate,
    smsTemplate: plan.smsTemplate,
    dialogPopup: plan.dialogPopup,
    names: plan.buildNames('<promotion_id>'),
    update: plan.buildUpdate('<promotion_id>', '<template_id>', { id: '<popup_id>', code: '<popup_code>', start_date: '<popup_start>', label: resolved.promotion_name_en }, '<sms_template_id>'),
  }, null, 2));
  console.log(`Dry-run dump: ${dryPath}`);

  // ── Pre-QC plan bundle (Layer B, plan-side input) ─────────────────────
  // Self-contained snapshot consumed by /pre-qc skill to drive sub-agent
  // review BEFORE the user commits. One file per (handle, brand). Stale
  // bundles are overwritten on next dry-run. Failure to write is non-fatal.
  try {
    const planDir = path.resolve('captures/qc-plans');
    await mkdir(planDir, { recursive: true });
    const planBundle = {
      handle, brand: targetBrand, platform: 'qpro', site: siteId,
      promo_code: resolved.promo_code,
      bonus_type: resolved.bonus_type,
      bonus_sub_type: resolved.bonus_sub_type || null,
      planned_at: new Date().toISOString(),
      source: {
        categories: resolved.categories || resolved.parsed?.categories || null,
        regions: resolved.regions || null,
        currencies: resolved.currencies || null,
        locales: resolved.locales || null,
        parsed: resolved.parsed || {},
        promotion_name_en: resolved.promotion_name_en,
        promotion_name_zh: resolved.promotion_name_zh,
        promotion_name_id: resolved.promotion_name_id,
        max_per_player: resolved.max_per_player,
        daily_max: resolved.daily_max,
        max_withdraw: resolved.max_withdraw,
        instructions: resolved.instructions || null,
        campaign: resolved.campaign || null,
        remark: resolved.remark || null,
        requestor: resolved.requestor || null,
        per_currency_overrides: resolved.per_currency_overrides ?? {},
      },
      plan: {
        promotion: plan.promotion,
        messageTemplate: plan.messageTemplate,
        smsTemplate: plan.smsTemplate,
        dialogPopup: plan.dialogPopup,
        names: plan.buildNames('<promotion_id>'),
        update: plan.buildUpdate('<promotion_id>', '<template_id>', { id: '<popup_id>', code: '<popup_code>', start_date: '<popup_start>', label: resolved.promotion_name_en }, '<sms_template_id>'),
        tierConstraint: plan.tierConstraint || null,
        categoriesOnly: plan.categoriesOnly || null,
        currencyFilter: plan.currencyFilter || null,
      },
    };
    const planPath = path.join(planDir, `${handle}__${targetBrand}.json`);
    await writeFile(planPath, JSON.stringify(planBundle, null, 2));
    console.log(`Pre-QC plan bundle: ${planPath}`);
  } catch (e) {
    console.log(`  ⚠ Pre-QC plan bundle write failed (non-fatal): ${e.message.split('\n')[0]}`);
  }

  process.exitCode = 0;
} else {

// ── Live execution ────────────────────────────────────────────────────
const runDir = path.resolve('captures/api-runs');
await mkdir(runDir, { recursive: true });
const runId = `${new Date().toISOString().replace(/[:.]/g,'-')}-${handle}-${targetBrand}-api`;
const runLog = path.join(runDir, `${runId}.json`);
const log = { runId, handle, brand: targetBrand, site: siteId, code: resolved.promo_code, calls: [] };

async function call(label, fn) {
  const t0 = Date.now();
  console.log(`  → ${label}…`);
  try {
    const res = await fn();
    log.calls.push({ label, ok: true, ms: Date.now() - t0, response: res });
    return res;
  } catch (e) {
    log.calls.push({ label, ok: false, ms: Date.now() - t0, error: e.message });
    throw e;
  }
}

let promotionId = null;
let templateId  = null;
let smsTemplateId = null;
let dialogPopup = null; // { id, code, start_date, label }

try {
  // 1. Create the promotion
  const r1 = await call('POST /api/bo/promotion', () => createPromotion(site, plan.promotion));
  promotionId = r1?.data?.rows?.id;
  if (!promotionId) throw new Error(`POST /promotion did not return an id (response: ${JSON.stringify(r1).slice(0,300)})`);
  console.log(`    ✓ promotion id = ${promotionId}`);

  // 2. Create the message template (if any)
  if (plan.messageTemplate) {
    const r2 = await call('POST /api/bo/messagetemplate', () => createMessageTemplate(site, plan.messageTemplate));
    templateId = r2?.data?.rows?.id;
    if (!templateId) throw new Error(`POST /messagetemplate did not return an id (response: ${JSON.stringify(r2).slice(0,300)})`);
    console.log(`    ✓ template id = ${templateId}`);
  }

  // 2b. Create the SMS template (if required).
  if (plan.smsTemplate) {
    const r2b = await call('POST /api/bo/messagetemplate (sms)', () => createMessageTemplate(site, plan.smsTemplate));
    smsTemplateId = r2b?.data?.rows?.id;
    if (!smsTemplateId) throw new Error(`POST /messagetemplate (sms) did not return an id (response: ${JSON.stringify(r2b).slice(0,300)})`);
    console.log(`    ✓ sms template id = ${smsTemplateId}`);
  }

  // 3. Create the dialog popup (if any). The id/code/start_date go into
  //    the PUT's dialog_popup_list (QPRO 6-field shape).
  if (plan.dialogPopup) {
    const r3 = await call('POST /api/bo/popups', () => createDialogPopup(site, plan.dialogPopup));
    const popupRows = r3?.data?.rows || r3?.data;
    if (popupRows?.id && popupRows?.code) {
      dialogPopup = {
        id: popupRows.id,
        code: popupRows.code,
        start_date: popupRows.start_date || plan.dialogPopup.start_date,
        label: resolved.promotion_name_en,
      };
      console.log(`    ✓ dialog popup id=${dialogPopup.id} code=${dialogPopup.code}`);
    } else {
      console.log('    ⚠ POST /popups returned no id/code; PUT will leave dialog_popup_list empty');
    }
  }

  // 4. Per-locale Names
  for (const name of plan.buildNames(promotionId)) {
    await call(`POST /api/bo/promotionname (locale ${name.settings_locale_id})`, () => addPromotionName(site, name));
    console.log(`    ✓ added name for settings_locale_id=${name.settings_locale_id}`);
  }

  // 5. PUT to link the template + dialog popup.
  const putBody = plan.buildUpdate(promotionId, templateId || 0, dialogPopup, smsTemplateId || 0);
  await call(`PUT /api/bo/promotion/${promotionId}`, () => updatePromotion(site, promotionId, putBody));
  console.log(`    ✓ PUT completed (message_template_id=${templateId || 0}, message_template_sms_id=${smsTemplateId || 0}${dialogPopup ? `, dialog_popup_id=${dialogPopup.id}` : ''})`);

  log.success = true;
  console.log('');
  console.log(`✓ API-direct save complete.   promo_code=${resolved.promo_code}   promotion_id=${promotionId}${templateId ? `   template_id=${templateId}` : ''}${smsTemplateId ? `   sms_template_id=${smsTemplateId}` : ''}${dialogPopup ? `   dialog_popup_id=${dialogPopup.id}` : ''}`);

  // ── Sheet write-back ──────────────────────────────────────────────────
  try {
    await writebackPromoFields(resolved);
  } catch (e) {
    console.log(`  ⚠ Sheet write-back failed (non-fatal): ${e.message.split('\n')[0]}`);
  }

  // ── QC: verify saved record, mechanics, message template, dialog popup ─
  // Three independent network calls (findPromotionByCode, getPromotionDetail,
  // qcMtTncHyperlink). With --parallel-qc they fire concurrently; output
  // format is identical to sequential mode, only wall-clock changes.
  const wrap = (p) => p.then((v) => ({ ok: true, value: v }), (e) => ({ ok: false, error: e.message }));
  const fetchL1 = wrap(findPromotionByCode(site, resolved.promo_code));
  const fetchL2 = wrap(getPromotionDetail(site, promotionId));
  const fetchL3 = templateId ? wrap(qcMtTncHyperlink(site, templateId, 'qpro')) : Promise.resolve(null);
  let qcR1, qcR2, qcR3;
  if (parallelQc) {
    console.log('');
    console.log('(--parallel-qc: Level 1/2/3 fetches running concurrently)');
    [qcR1, qcR2, qcR3] = await Promise.all([fetchL1, fetchL2, fetchL3]);
  } else {
    qcR1 = await fetchL1;
    qcR2 = await fetchL2;
    qcR3 = await fetchL3;
  }

  console.log('');
  console.log('── QC (Level 1: Record exists) ─────────────────────────────');
  const listRow = qcR1.ok ? qcR1.value : null;
  let l1Pass = false;
  if (!listRow) {
    console.error(`✗ QC L1 FAIL — code not found on BO after save${qcR1.ok ? '' : ` (${qcR1.error})`}`);
  } else {
    const l1 = {
      codeMatch: listRow.code === resolved.promo_code,
      nameSet:   !!listRow.name && listRow.name.length > 0,
      idMatch:   listRow.id === promotionId,
    };
    console.log(`  PromotionId:   ${listRow.id}  ${l1.idMatch ? '✓' : '✗'}`);
    console.log(`  Code:          ${listRow.code}  ${l1.codeMatch ? '✓' : '✗'}`);
    console.log(`  Name:          ${listRow.name}  ${l1.nameSet ? '✓' : '✗'}`);
    console.log(`  Status:        ${listRow.status}`);
    l1Pass = Object.values(l1).every(Boolean);
    if (l1Pass) {
      console.log('✓ QC Level 1 PASS');
    } else {
      const failing = Object.entries(l1).filter(([,v]) => !v).map(([k]) => k).join(', ');
      console.error(`✗ QC L1 FAIL — ${failing}`);
    }
  }

  console.log('');
  console.log('── QC (Level 2: Mechanics) ─────────────────────────────────');
  let l2Pass = false;
  if (!qcR2.ok) {
    console.warn(`⚠ QC Level 2 skipped: ${qcR2.error}`);
  } else {
    const det = qcR2.value;
    const bo = det.parsed || {};
    const mechLog = [];
    const mechChecks = {};
    const mChk = (label, boVal, expected) => {
      const ok = Number(boVal) === Number(expected);
      mechChecks[label] = ok;
      mechLog.push(`  ${label.padEnd(22)} BO=${boVal}  expected=${expected}  ${ok ? '✓' : '✗'}`);
    };
    const src = resolved.parsed || {};
    if (src.min_deposit != null) mChk('MinDeposit', bo.min_deposit, src.min_deposit);
    if (src.bonus_rate_pct != null) mChk('BonusPct', bo.bonus_rate_pct, src.bonus_rate_pct);
    if (src.to_multiplier != null) mChk('Turnover', bo.to_multiplier, src.to_multiplier);
    if (src.max_bonus != null) mChk('MaxBonus', bo.max_bonus, src.max_bonus);
    if (src.free_credit_amount != null) mChk('FreeCredit', bo.free_credit_amount, src.free_credit_amount);
    if (src.spin_count != null) mChk('SpinCount', bo.spin_count, src.spin_count);
    if (src.value_per_spin != null) mChk('ValuePerSpin', bo.value_per_spin, src.value_per_spin);
    if (resolved.max_withdraw != null && resolved.max_withdraw > 0) {
      const boCur = Object.values(det.per_currency_overrides || {})[0] || {};
      mChk('MaxWithdraw', boCur.max_transfer_out, resolved.max_withdraw);
    }
    for (const line of mechLog) console.log(line);
    if (Object.keys(mechChecks).length === 0) {
      console.log('  (no numeric fields to verify for this bonus type)');
      l2Pass = true;
    } else if (Object.values(mechChecks).every(Boolean)) {
      l2Pass = true;
      console.log('✓ QC Level 2 PASS');
    } else {
      const failing = Object.entries(mechChecks).filter(([,v]) => !v).map(([k]) => k).join(', ');
      console.error(`✗ QC L2 FAIL — ${failing}`);
    }
  }

  console.log('');
  console.log('── QC (Level 3: Message Template + Dialog Popup) ────────────');
  const l3 = {};
  let l3Pass = false;
  if (templateId) {
    l3['MT_linked'] = listRow && listRow.message_template_id === templateId;
    console.log(`  MT linked:        id=${templateId}  ${l3['MT_linked'] ? '✓' : `✗ (BO has ${listRow?.message_template_id})`}`);
    if (qcR3 && qcR3.ok) {
      for (const msg of qcR3.value.messages) console.log(msg);
      Object.assign(l3, qcR3.value.checks);
    } else if (qcR3 && !qcR3.ok) {
      console.warn(`  MT T&C check skipped: ${qcR3.error}`);
    }
  } else {
    console.log('  MT:               (none expected)');
  }
  if (smsTemplateId) {
    l3['SMS_linked'] = listRow && listRow.message_template_sms_id === smsTemplateId;
    console.log(`  SMS linked:       id=${smsTemplateId}  ${l3['SMS_linked'] ? '✓' : `✗ (BO has ${listRow?.message_template_sms_id})`}`);
  } else {
    console.log('  SMS:              (none expected)');
  }
  if (dialogPopup) {
    const boPopups = listRow?.dialog_popup_list || [];
    const linked = boPopups.some((p) => p.popup_id === dialogPopup.id);
    l3['Dialog_linked'] = linked;
    console.log(`  Dialog linked:    id=${dialogPopup.id}  ${linked ? '✓' : '✗'}`);
  } else {
    console.log('  Dialog:           (none expected)');
  }
  if (Object.keys(l3).length > 0 && Object.values(l3).every(Boolean)) {
    l3Pass = true;
    console.log('✓ QC Level 3 PASS');
  } else if (Object.keys(l3).length > 0) {
    const failing = Object.entries(l3).filter(([,v]) => !v).map(([k]) => k).join(', ');
    console.error(`✗ QC L3 FAIL — ${failing}`);
  } else {
    l3Pass = true;
    console.log('✓ QC Level 3 PASS (nothing to link)');
  }

  // ── Deep-QC bundle (Layer B input) ───────────────────────────────────
  // Writes a self-contained JSON consumed by /deep-qc skill to drive
  // sub-agent fan-out. One file per (handle, brand) save. Read-only data —
  // failure to write is non-fatal.
  try {
    const bundleDir = path.resolve('captures/qc-bundles');
    await mkdir(bundleDir, { recursive: true });
    const bundle = {
      handle, brand: targetBrand, platform: 'qpro', site: siteId,
      promo_code: resolved.promo_code,
      promotion_id: promotionId, template_id: templateId, sms_template_id: smsTemplateId,
      dialog_popup_id: dialogPopup?.id || null,
      saved_at: new Date().toISOString(),
      source: {
        bonus_type: resolved.bonus_type,
        categories: resolved.categories || resolved.parsed?.categories || null,
        regions: resolved.regions || null,
        parsed: resolved.parsed || {},
        promotion_name_en: resolved.promotion_name_en,
        promotion_name_zh: resolved.promotion_name_zh,
        promotion_name_id: resolved.promotion_name_id,
        max_per_player: resolved.max_per_player,
        daily_max: resolved.daily_max,
        max_withdraw: resolved.max_withdraw,
        instructions: resolved.instructions || null,
        campaign: resolved.campaign || null,
        remark: resolved.remark || null,
      },
      qc_endpoints: {
        list:       `GET /api/bo/promotion?code=${resolved.promo_code}`,
        detail:     `GET /api/bo/promotion/${promotionId}`,
        currencies: `GET /api/bo/promotion/${promotionId}/promotioncurrency`,
        template:   templateId ? `GET /api/bo/messagetemplate/${templateId}` : null,
        sms_template: smsTemplateId ? `GET /api/bo/messagetemplate/${smsTemplateId}` : null,
        popup:      dialogPopup?.id ? `GET /api/bo/popups/${dialogPopup.id}` : null,
      },
      // Inline the BO state already fetched during QC so sub-agents need no auth.
      live_state: {
        list_row: qcR1?.ok ? qcR1.value : null,
        detail:   qcR2?.ok ? qcR2.value : null,
        tnc:      qcR3?.ok ? qcR3.value : null,
      },
    };
    const bundlePath = path.join(bundleDir, `${handle}__${targetBrand}.json`);
    await writeFile(bundlePath, JSON.stringify(bundle, null, 2));
    console.log(`Deep-QC bundle: ${bundlePath}`);
  } catch (e) {
    console.log(`  ⚠ Deep-QC bundle write failed (non-fatal): ${e.message.split('\n')[0]}`);
  }

  if (!(l1Pass && l2Pass && l3Pass)) {
    const failedLevels = [
      l1Pass ? null : 'L1',
      l2Pass ? null : 'L2',
      l3Pass ? null : 'L3',
    ].filter(Boolean).join(', ');
    console.error(`✗ Deterministic post-save QC failed — ${failedLevels}`);
    return bail(8);
  }

  console.log('✓ Deterministic post-save QC passed');

} catch (e) {
  log.success = false;
  log.error = e.message;
  console.error('');
  console.error(`✖ FAILED on ${log.calls.at(-1)?.label || 'unknown step'}: ${e.message}`);
  console.error(`  Partial state may exist: promotion_id=${promotionId}, template_id=${templateId}, sms_template_id=${smsTemplateId}, dialog_popup=${dialogPopup ? dialogPopup.id : 'null'}`);
  process.exitCode = 6;
} finally {
  await writeFile(runLog, JSON.stringify(log, null, 2));
  console.log(`Run log: ${runLog}`);
}

}  // end of live-execution else-branch

})();  // end of main async IIFE — falls through to natural exit

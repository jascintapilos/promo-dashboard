#!/usr/bin/env node
// canary-api-qp2 — API-direct equivalent of canary-write.js for QP2 brands.
//
// Hits the QP2 BO REST endpoints directly instead of driving the Create-form
// UI through Playwright. Designed to produce the same final state as a
// successful canary-write run on QP2A (idempotency check + main POST + per-
// locale Names + Message Template + Dialog Popup + final PUT to link both).
//
// Why a separate runner: Playwright's page.route() fires reliably on QPRO11
// but doesn't intercept QP2A's promotion PUT (probably an Angular HttpClient
// quirk on QP2's BO build). The API-direct path bypasses Playwright entirely
// — same auth (encrypted password via reqSignKey, same access-token headers
// the Angular SPA uses).
//
// Usage:
//   node bin/canary-api-qp2.js <handle> [--commit] [--brand=QP2A] [--site=<id>] [--parallel-qc]
//
//   --commit       actually hit the BO. Without it, prints the plan + would-be bodies.
//   --brand=<B>    pick which QP2 brand to target when the request has multiple.
//   --site=<id>    override the BO site (defaults to brand → site map).
//   --parallel-qc  fire post-save QC Level 1/2/3 fetches concurrently (~3-5s → ~1-2s).
//                  Output format identical to sequential mode; opt-in only.
//
// Currently supports: QP2A FC. Deposit + Free Spin throw on body-build.
// QP2B/C/D need their merchant_id captured before they can be enabled.

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
  getPromotionDetail, authedFetch,
} from '../src/api-client.js';
import { buildApiPlan, QP2_BRAND_TO_IDS } from '../src/api-mapper-qp2.js';
import { qcMtTncHyperlink } from '../src/qc-mt-tnc.js';
import { recordPopup } from '../src/qp2-popup-registry.js';
import { writebackPromoFields } from '../src/sheet-writeback.js';

// Clean-exit helper. `process.exit(N)` from top-level after async work
// races libuv on still-closing keepalive sockets (Windows: STATUS_STACK_
// BUFFER_OVERRUN 3221226505). Setting `exitCode` and unref-deferring the
// hard exit lets pending I/O drain first. All early-exit paths below use
// this instead of calling process.exit directly.
function bail(code) {
  process.exitCode = code;
  setTimeout(() => process.exit(code), 50).unref();
}

// Main flow wrapped in an async IIFE so early-exit paths can `return`
// rather than `process.exit(N)` (which races libuv on Windows — see
// `bail()` above). Each early-exit becomes `return bail(N)`.
await (async () => {

// ── Args ──────────────────────────────────────────────────────────────
const { flags, positional } = parseArgs(process.argv.slice(2));
const userInput = positional[0];
if (!userInput) {
  console.error('usage: canary-api-qp2.js <handle|P###> [--commit] [--brand=QP2A] [--site=<id>]');
  return bail(2);
}
const commit = flags.commit === true;
const brandOverride = flags.brand;
const siteOverride = flags.site;
const parallelQc = flags['parallel-qc'] === true;

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
const resolved = await resolveDuplicates(request, byCode, { boIndex: bo.byCode, boFetcher: fetchBoCodeAsRecord });

// ── Brand whitelist (QP2 only — QPRO uses canary-api.js) ──────────────
const SAFE_BRANDS = new Set(['QP2A', 'QP2B', 'QP2C', 'QP2D']);
const targetBrand = brandOverride && SAFE_BRANDS.has(brandOverride)
  ? brandOverride
  : resolved.brands.find((b) => SAFE_BRANDS.has(b));
if (!targetBrand) {
  console.error(`REFUSED: brands [${resolved.brands.join(', ')}] none on QP2 safe-list (${[...SAFE_BRANDS].join(',')}).`);
  return bail(3);
}
const platform = (BRAND_TO_SITE[targetBrand]?.platform || 'qp2').toLowerCase();
if (platform !== 'qp2') {
  console.error(`REFUSED: platform "${platform}" not supported by canary-api-qp2 (this runner is QP2-only). For QPRO brands use canary-api.js.`);
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
let plan;
try {
  plan = await buildApiPlan(resolved, { brand: targetBrand, site });
} catch (e) {
  console.error(`✖ build failed: ${e.message}`);
  return bail(7);
}

// ── Preview ───────────────────────────────────────────────────────────
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`API-DIRECT (QP2) — ${commit ? 'LIVE (--commit)' : 'DRY-RUN'}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`Request:   ${handle}  (${resolved.requestor || ''})`);
console.log(`Target:    ${targetBrand} on ${siteId}  (${site.label || site.id})`);
console.log(`Code:      ${resolved.promo_code}`);
console.log(`Bonus:     ${resolved.bonus_type}${resolved.bonus_sub_type ? ' / ' + resolved.bonus_sub_type : ''}`);
console.log(`Currencies:${(resolved.currencies||[]).join(', ')}  Locales: ${(resolved.locales||[]).join(', ')}`);
if (plan.currencyFilter) {
  console.log(`           ↳ FS provider supports only ${plan.currencyFilter.kept.join(', ')} on ${targetBrand} — dropped ${plan.currencyFilter.dropped.join(', ')}`);
}
if (resolved.instructions?.tier_constraint) {
  const t = resolved.instructions.tier_constraint;
  console.log(`Tier:      ${t.tier} and ${t.direction} → [${(t.eligible_tiers||[]).join(', ')}]; member_group_ids=${plan.memberGroupIds?.length || 0}`);
}
if (resolved.instructions?.categories_only) {
  console.log(`Categories only: ${resolved.instructions.categories_only.join(', ')}`);
}
console.log('');
console.log('Calls:');
console.log(`  1. POST /api/bo/promotion           body=${JSON.stringify(plan.promotion).length} bytes`);
if (plan.messageTemplate) console.log(`  2. POST /api/bo/messagetemplate     body=${JSON.stringify(plan.messageTemplate).length} bytes (locales: ${Object.keys(plan.messageTemplate.details).join(', ')})`);
if (plan.dialogPopup) console.log(`  3. POST /api/bo/popups              body=${JSON.stringify(plan.dialogPopup).length} bytes (locales: ${Object.keys(plan.dialogPopup.contents).join(', ')})`);
const namePreviews = plan.buildNames(0);
console.log(`  4. POST /api/bo/promotionname × ${namePreviews.length} (locales: ${namePreviews.map((n) => n.settings_locale_id).join(', ')})`);
console.log(`  5. PUT  /api/bo/promotion/{id}      (link message_template_id + dialog_popup_list)`);
console.log('');

// ── Idempotency check (live via /api/bo/promotion?code=…) ─────────────
// The IBC22 BO enforces code uniqueness GLOBALLY across QP2A/B/C/D. But
// per operator rule (feedback_qp2_multi_merchant_share_code.md) the right
// response is to EXTEND the existing promo's merchant_ids — not skip. A
// single promotion row attached to multiple merchants is the canonical
// pattern for a shared-config multi-merchant promo.
const merchantKey = (BRAND_TO_SITE[targetBrand]?.merchantName || targetBrand).toUpperCase();
const myMerchantId = QP2_BRAND_TO_IDS[targetBrand]?.merchantId;
try {
  const existing = await findPromotionByCode(site, resolved.promo_code);
  if (existing) {
    // Fetch the row's current merchant_ids to decide between extend vs true-skip.
    let currentMerchantObjs = [];
    try {
      const detail = await authedFetch(site, `/api/bo/promotion/${existing.id}`);
      currentMerchantObjs = detail.data.rows.merchant_ids || [];
    } catch (_) { /* fall through to skip if detail unavailable */ }
    const currentIds = currentMerchantObjs.map((m) => (typeof m === 'object' ? m.id : m));
    if (currentIds.includes(myMerchantId)) {
      console.error(`✖ IDEMPOTENCY: code "${resolved.promo_code}" already exists on ${siteId} with ${targetBrand} attached (id=${existing.id}).`);
      console.error('  Truly idempotent — skipping.');
      return bail(5);
    }
    if (commit && myMerchantId) {
      console.log(`↺ EXTEND: code "${resolved.promo_code}" exists on ${siteId} (id=${existing.id}) — adding ${targetBrand} (merchant_id=${myMerchantId}) to its merchant_ids.`);
      // Fetch list-endpoint row for dialog_popup_list (the detail endpoint
      // drops it). Each merchant's popup is a SEPARATE row, so we both
      // preserve existing entries AND POST a new popup for this merchant.
      let dialogPopupList = [];
      try {
        const listResp = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(resolved.promo_code)}&perPage=10`);
        const listRow = (listResp.data?.rows || []).find((r) => r.id === existing.id);
        if (Array.isArray(listRow?.dialog_popup_list)) dialogPopupList = listRow.dialog_popup_list;
      } catch (_) { /* ignore — empty list is acceptable */ }
      // POST a per-merchant popup clone (site_id = this brand's merchantId)
      // so the dialog renders on this merchant's player UI. plan.dialogPopup
      // was built with the correct site_id for the current brand via the
      // mapper's QP2_BRAND_TO_IDS lookup.
      let clonedPopup = null;
      if (plan.dialogPopup) {
        try {
          console.log(`  → POST /api/bo/popups (clone for ${targetBrand}, site_id=${myMerchantId})…`);
          const popResp = await createDialogPopup(site, plan.dialogPopup);
          const popRows = popResp?.data?.rows || popResp?.data;
          if (popRows?.id) {
            clonedPopup = popRows;
            console.log(`    ✓ popup id=${clonedPopup.id} code=${clonedPopup.code}`);
            recordPopup(resolved.promo_code, myMerchantId, clonedPopup.id, clonedPopup.created_at);
          }
        } catch (e) {
          console.log(`    ⚠ popup clone failed: ${e.message.split('\n')[0]} — proceeding without popup for ${targetBrand}`);
        }
      }
      // Rebuild the plan with the expanded merchant_ids so the mapper resolves
      // member_group_ids across ALL attached merchants (operator rule 2026-05-16
      // — feedback_qp2_multi_merchant_share_code.md). The mapper's name-match
      // adds each new merchant's standard tiers (Normal/Bronze/Silver/Gold/
      // Platinum/Diamond + their Trial variants) to the eligible list; without
      // this, QP2B/C/D members can't claim the promo even though merchant_ids
      // includes them.
      const allIds = [...currentIds, myMerchantId];
      const expandedPlan = await buildApiPlan(resolved, { brand: targetBrand, site, merchantIds: allIds });
      const detailRow = (await authedFetch(site, `/api/bo/promotion/${existing.id}`)).data.rows;
      const putBody = expandedPlan.buildUpdate(existing.id, detailRow.message_template_id || 0, null);
      const merchantIdsObj = {};
      allIds.forEach((id, i) => { merchantIdsObj[String(i)] = id; });
      putBody.merchant_ids = merchantIdsObj;
      // Build dialog_popup_list: existing entries (other merchants) +
      // newly-cloned popup entry for this merchant.
      const combined = [...dialogPopupList];
      if (clonedPopup) {
        combined.push({
          ...clonedPopup,
          promotion_id: existing.id,
        });
      }
      if (combined.length) {
        const dl = {};
        combined.forEach((d, i) => { dl[String(i)] = d; });
        putBody.dialog_popup_list = dl;
      }
      try {
        console.log(`  → PUT /api/bo/promotion/${existing.id} (extend merchant_ids${clonedPopup ? ' + link popup' : ''})…`);
        await updatePromotion(site, existing.id, putBody);
        console.log(`✓ Extended. merchant_ids now: ${allIds.join(', ')}${clonedPopup ? `; popup id=${clonedPopup.id} attached` : ''}`);
        if (expandedPlan.memberGroupIds) {
          console.log(`  member_group_ids expanded: ${expandedPlan.memberGroupIds.length} groups across merchants [${allIds.join(',')}]`);
        }
        return bail(0);
      } catch (e) {
        console.error(`✖ FAILED extending merchant_ids: ${e.message}`);
        return bail(6);
      }
    }
    // Dry-run or no merchant id mapping — report what would happen.
    console.log(`(would extend code "${resolved.promo_code}" id=${existing.id} with ${targetBrand} — currently has merchants [${currentIds.join(', ')}])`);
    return bail(0);
  }
  console.log(`✓ Idempotency (live): no existing "${resolved.promo_code}" anywhere on ${siteId} (cross-merchant)`);
} catch (e) {
  console.log(`⚠ Idempotency check skipped (live lookup failed): ${e.message.split('\n')[0]}`);
}

// Dry-run branch — write the request bodies for inspection and fall
// through to natural exit (don't process.exit; that races libuv on
// pending keepalive sockets and asserts on Windows).
if (!commit) {
  console.log('');
  console.log('Dry-run. To run for real: add --commit.');
  const dryDir = path.resolve('captures/api-runs');
  await mkdir(dryDir, { recursive: true });
  const dryPath = path.join(dryDir, `dryrun-${handle}-${targetBrand}-${new Date().toISOString().replace(/[:.]/g,'-')}.json`);
  await writeFile(dryPath, JSON.stringify({
    handle, brand: targetBrand, site: siteId, code: resolved.promo_code,
    promotion: plan.promotion,
    messageTemplate: plan.messageTemplate,
    dialogPopup: plan.dialogPopup,
    names: plan.buildNames('<promotion_id>'),
    update: plan.buildUpdate('<promotion_id>', '<template_id>', { id: '<popup_id>', code: '<popup_code>', start_date: '<popup_start>', label: resolved.promotion_name_en }),
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
      handle, brand: targetBrand, platform: 'qp2', site: siteId,
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
        remark: resolved.remark || null,
        requestor: resolved.requestor || null,
      },
      plan: {
        promotion: plan.promotion,
        messageTemplate: plan.messageTemplate,
        dialogPopup: plan.dialogPopup,
        names: plan.buildNames('<promotion_id>'),
        update: plan.buildUpdate('<promotion_id>', '<template_id>', { id: '<popup_id>', code: '<popup_code>', start_date: '<popup_start>', label: resolved.promotion_name_en }),
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
const runId = `${new Date().toISOString().replace(/[:.]/g,'-')}-${handle}-${targetBrand}-api-qp2`;
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
let dialogPopup = null; // { id, code, start_date }

try {
  // 1. Create the promotion. The QP2A BO occasionally returns 500 on
  // deposit-type bodies AFTER actually creating the row (side-effect
  // event-bus failure, root cause unknown). If we see a 500, look up the
  // code — if it exists, treat the create as successful and continue.
  try {
    const r1 = await call('POST /api/bo/promotion', () => createPromotion(site, plan.promotion));
    promotionId = r1?.data?.rows?.id;
    if (!promotionId) throw new Error(`POST /promotion did not return an id (response: ${JSON.stringify(r1).slice(0,300)})`);
    console.log(`    ✓ promotion id = ${promotionId}`);
  } catch (e) {
    if (/HTTP 500/.test(e.message)) {
      console.log(`    ⚠ POST /promotion returned 500 — checking if row was created anyway…`);
      const existing = await findPromotionByCode(site, resolved.promo_code);
      if (existing?.id) {
        promotionId = existing.id;
        log.calls.at(-1).recovered = true;
        log.calls.at(-1).note = `BO returned 500 but row id=${promotionId} exists; continuing chain.`;
        console.log(`    ✓ recovered: promotion id = ${promotionId} (created despite 500)`);
      } else {
        throw e;  // genuine failure — row really not created
      }
    } else {
      throw e;
    }
  }

  // 2. Message template (if any)
  if (plan.messageTemplate) {
    const r2 = await call('POST /api/bo/messagetemplate', () => createMessageTemplate(site, plan.messageTemplate));
    templateId = r2?.data?.rows?.id;
    if (!templateId) throw new Error(`POST /messagetemplate did not return an id (response: ${JSON.stringify(r2).slice(0,300)})`);
    console.log(`    ✓ template id = ${templateId}`);
  }

  // 3. Dialog popup (if any). The full row from the response goes into
  // the PUT's dialog_popup_list field (QP2 link requires the full popup
  // object — see api-mapper-qp2.js).
  if (plan.dialogPopup) {
    const r3 = await call('POST /api/bo/popups', () => createDialogPopup(site, plan.dialogPopup));
    const popupRows = r3?.data?.rows || r3?.data;
    if (popupRows?.id && popupRows?.code) {
      dialogPopup = {
        id: popupRows.id,
        code: popupRows.code,
        start_date: popupRows.start_date || plan.dialogPopup.start_date,
        label: resolved.promotion_name_en,
        fullRow: popupRows,  // QP2's dialog_popup_list PUT shape needs the whole row
      };
      console.log(`    ✓ dialog popup id=${dialogPopup.id} code=${dialogPopup.code}`);
      // Record for deterministic relink (site_id = this brand's merchant id).
      recordPopup(resolved.promo_code, QP2_BRAND_TO_IDS[targetBrand]?.merchantId, dialogPopup.id, popupRows.created_at);
    } else {
      console.log(`    ⚠ POST /popups returned no id/code; link step will skip`);
    }
  }

  // 4. Per-locale Names
  for (const name of plan.buildNames(promotionId)) {
    await call(`POST /api/bo/promotionname (locale ${name.settings_locale_id})`, () => addPromotionName(site, name));
    console.log(`    ✓ added name for settings_locale_id=${name.settings_locale_id}`);
  }

  // 5. PUT to link message template + dialog popup
  const putBody = plan.buildUpdate(promotionId, templateId || 0, dialogPopup);
  await call(`PUT /api/bo/promotion/${promotionId}`, () => updatePromotion(site, promotionId, putBody));
  console.log(`    ✓ PUT completed (message_template_id=${templateId || 0}${dialogPopup ? `, dialog_popup_id=${dialogPopup.id}` : ''})`);

  log.success = true;
  console.log('');
  console.log(`✓ API-direct save complete.   promo_code=${resolved.promo_code}   promotion_id=${promotionId}${templateId ? `   template_id=${templateId}` : ''}${dialogPopup ? `   dialog_popup_id=${dialogPopup.id}` : ''}`);

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
  const fetchL3 = templateId ? wrap(qcMtTncHyperlink(site, templateId, 'qp2')) : Promise.resolve(null);
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
    if (Object.values(l1).every(Boolean)) {
      console.log('✓ QC Level 1 PASS');
    } else {
      const failing = Object.entries(l1).filter(([,v]) => !v).map(([k]) => k).join(', ');
      console.error(`✗ QC L1 FAIL — ${failing}`);
    }
  }

  console.log('');
  console.log('── QC (Level 2: Mechanics) ─────────────────────────────────');
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
    } else if (Object.values(mechChecks).every(Boolean)) {
      console.log('✓ QC Level 2 PASS');
    } else {
      const failing = Object.entries(mechChecks).filter(([,v]) => !v).map(([k]) => k).join(', ');
      console.error(`✗ QC L2 FAIL — ${failing}`);
    }
  }

  console.log('');
  console.log('── QC (Level 3: Message Template + Dialog Popup) ────────────');
  const l3 = {};
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
  if (dialogPopup) {
    const boPopups = listRow?.dialog_popup_list || [];
    const linked = boPopups.some((p) => p.popup_id === dialogPopup.id);
    l3['Dialog_linked'] = linked;
    console.log(`  Dialog linked:    id=${dialogPopup.id}  ${linked ? '✓' : '✗'}`);
  } else {
    console.log('  Dialog:           (none expected)');
  }
  if (Object.keys(l3).length > 0 && Object.values(l3).every(Boolean)) {
    console.log('✓ QC Level 3 PASS');
  } else if (Object.keys(l3).length > 0) {
    const failing = Object.entries(l3).filter(([,v]) => !v).map(([k]) => k).join(', ');
    console.error(`✗ QC L3 FAIL — ${failing}`);
  } else {
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
      handle, brand: targetBrand, platform: 'qp2', site: siteId,
      promo_code: resolved.promo_code,
      promotion_id: promotionId, template_id: templateId,
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
        remark: resolved.remark || null,
      },
      qc_endpoints: {
        list:       `GET /api/bo/promotion?code=${resolved.promo_code}`,
        detail:     `GET /api/bo/promotion/${promotionId}`,
        currencies: `GET /api/bo/promotion/${promotionId}/promotioncurrency`,
        template:   templateId ? `GET /api/bo/messagetemplate/${templateId}` : null,
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

} catch (e) {
  log.success = false;
  log.error = e.message;
  console.error('');
  console.error(`✖ FAILED on ${log.calls.at(-1)?.label || 'unknown step'}: ${e.message}`);
  console.error(`  Partial state may exist: promotion_id=${promotionId}, template_id=${templateId}, dialog_popup=${dialogPopup ? dialogPopup.id : 'null'}`);
  process.exitCode = 6;
} finally {
  await writeFile(runLog, JSON.stringify(log, null, 2));
  console.log(`Run log: ${runLog}`);
}

}  // end of live-execution else-branch

})();  // end of main async IIFE — falls through to natural exit

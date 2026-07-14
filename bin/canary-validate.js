#!/usr/bin/env node
// canary-validate.js — inline triage + plan completeness checker.
//
// Replaces the /qc-engine and /pre-qc subagent gates with deterministic
// file-read checks. Zero network calls. Runs in <500ms.
//
// WHAT IT CHECKS (not exhaustive — MT content analysis stays with Sentinel):
//   Triage : required fields, currency/region alignment, parsed keys,
//            FS spin ceiling (REL_/RET_), campaign prefix tokens (NOTE)
//   Plan   : blacklist_template, merchant_ids, promotion_currency coverage,
//            reward-value vs source match, QP2 deposit_status, IGMP game
//            resolution, campaign prefix tokens (FAIL severity)
//
// WHAT IT DOES NOT CHECK (deferred to Sentinel post-save):
//   MT body content/vocabulary, HTML entity encoding, dialog body vocabulary,
//   T&C hyperlink format, QPRO promo_type/sub_type pair correctness.
//
// Usage:
//   node bin/canary-validate.js <handle>          # triage only (after ingest)
//   node bin/canary-validate.js <handle> --plan   # plan check only (after dry-run)
//   node bin/canary-validate.js <handle> --all    # triage + plan check

import { readFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from './_args.js';
import { loadAllRequests, resolveHandle } from '../src/planner.js';

const { flags, positional } = parseArgs(process.argv.slice(2));
const userInput = positional[0];
if (!userInput) {
  console.error('usage: canary-validate.js <handle|P###> [--plan] [--all]');
  process.exit(2);
}

const doPlan   = flags.plan === true || flags.all === true;
const doTriage = flags.plan !== true || flags.all === true; // omit = triage; --plan = plan only; --all = both

const { byHandle, byId } = await loadAllRequests();
const handle = resolveHandle(userInput, { byHandle, byId });
if (!handle) {
  console.error(`request "${userInput}" not found — run node bin/ingest-requests.js`);
  process.exit(2);
}
if (handle !== userInput) console.log(`(auto-resolved "${userInput}" → "${handle}")`);

const requestPath = path.resolve('captures/requests', `${handle}.json`);
const request = JSON.parse(await readFile(requestPath, 'utf8'));

// ── Constants ─────────────────────────────────────────────────────────────

const KNOWN_BONUS_TYPES = new Set(['deposit bonus', 'free credit', 'free spin', 'deposit', 'cashback']);
const CURRENCY_FOR_REGION = { MY: 'MYR', SG: 'SGD', ID: 'IDR', TH: 'THB', KH: 'KHR' };
const CURRENCY_ID = { MYR: '1', SGD: '3', IDR: '4', THB: '5', USD: '7', KHR: '8' };
const MIN_DEP_FLOORS = { MYR: 30, SGD: 50, IDR: 25000, THB: 50, USD: 5, KHR: 0 };

// Campaign prefix maps (rebuilt 2026-07-09, Pillar-based)
const PILLAR_FROM_CAMPAIGN = {
  'acq - welcome': 'ACQ', 'acq - reload': 'ACQ',
  'retention': 'RET', 'churn - reactivation': 'RET', 'ad hoc': 'RET',
  'vip - churn': 'VIP',
  'grooming': 'WHALE', 'whale - probe': 'WHALE',
  'branding': 'BRA',
};
const OBJ_FROM_CAMPAIGN = {
  'acq - welcome': 'WELC', 'branding': 'WELC',
  'acq - reload': 'REL', 'retention': 'REL',
  'churn - reactivation': 'CHURN', 'vip - churn': 'CHURN',
  'ad hoc': 'ADHOC',
  'grooming': 'GROOM',
  'whale - probe': 'PROBE',
};

// ── Shared helpers ─────────────────────────────────────────────────────────

function checkCampaignPrefix(code, campaign, campaignOwner, noDeposit) {
  if (!campaign) return [];
  const stripped = String(code || '').replace(/^(TEST_|FT_)/, '');
  const parts = stripped.split('_');
  const hasSeg = (tok) => parts.includes(tok);
  const findings = [];

  if (campaignOwner) {
    const cKey = campaign.toLowerCase();
    const pillar = PILLAR_FROM_CAMPAIGN[cKey];
    const obj    = OBJ_FROM_CAMPAIGN[cKey];
    const missing = [];
    if (!hasSeg(campaignOwner)) missing.push(`team "${campaignOwner}"`);
    if (pillar && !hasSeg(pillar)) missing.push(`pillar "${pillar}"`);
    if (obj    && !hasSeg(obj))   missing.push(`objective "${obj}"`);
    if (noDeposit && !hasSeg('NODEP')) missing.push('"NODEP"');
    if (missing.length) findings.push(`Missing campaign tokens: ${missing.join(', ')}`);
  } else {
    // Legacy mapping
    const cLow = campaign.toLowerCase();
    const hasStr = (t) => stripped.includes(t);
    let required = null;
    if (cLow.startsWith('acq'))                                   required = ['ACQ_', 'WELC_'];
    else if (cLow.includes('retention') && cLow.includes('adhoc')) required = ['ADHOC_', 'RET_'];
    else if (cLow.includes('crm') && cLow.includes('retention'))   required = ['CRM_', 'REL_'];
    else if (cLow.includes('crm') && cLow.includes('churn'))       required = ['CRM_', 'CHURN_', 'RET_'];
    else if (cLow.includes('vip') && cLow.includes('groom'))       required = ['VIP_', 'GROOM_', 'REL_'];
    else if (cLow.includes('vip') && cLow.includes('adhoc'))       required = ['VIP_', 'ADHOC_'];
    else if (cLow.includes('vip') && cLow.includes('churn'))       required = ['VIP_', 'CHURN_', 'RET_'];
    else if (cLow.includes('vip') && cLow.includes('retention'))   required = ['VIP_', 'REL_'];
    else if (cLow.includes('tsm') && cLow.includes('churn'))       required = ['TSM_', 'CHURN_'];
    else if (cLow.includes('tsm') && cLow.includes('ret'))         required = ['TSM_', 'RET_'];
    if (required) {
      const missing = required.filter((t) => !hasStr(t));
      if (missing.length) findings.push(`Missing legacy campaign tokens: ${missing.join(', ')}`);
    }
  }
  return findings;
}

// ── TRIAGE ─────────────────────────────────────────────────────────────────

let triageVerdict = 'READY';
const triageIssues = [];

if (doTriage) {
  const note   = (field, msg, action = '') => { triageIssues.push({ sev: 'NOTE',   field, msg, action }); if (triageVerdict === 'READY') triageVerdict = 'NOTE'; };
  const reject = (field, msg, action = '') => { triageIssues.push({ sev: 'RETURN', field, msg, action }); triageVerdict = 'RETURN'; };

  const bt = (request.bonus_type || '').toLowerCase();
  const p  = request.parsed || {};

  if (!request.bonus_type || !KNOWN_BONUS_TYPES.has(bt)) {
    reject('bonus_type', `Unknown or missing bonus_type: "${request.bonus_type}"`, 'Set bonus_type in source sheet col E');
  }
  if (!request.brands?.length)  reject('brands',  'No brands listed', 'Add brands to source sheet');
  if (!request.regions?.length) reject('regions', 'No regions listed', 'Add regions to source sheet');
  if (!request.locales?.length) reject('locales', 'No locales listed', 'Add locales to source sheet');
  if (!request.promo_code)      reject('promo_code', 'promo_code missing', 'Set promo_code in col W');
  if (!request.promotion_name_en) reject('promotion_name_en', 'promotion_name_en missing', 'Set promo name in col X');
  if (!request.requestor)       note('requestor', 'requestor not set', 'Set requestor field');

  // Currency / region alignment
  for (const region of (request.regions || [])) {
    const expected = CURRENCY_FOR_REGION[region];
    if (expected && !(request.currencies || []).includes(expected)) {
      reject('currencies', `Region ${region} requires ${expected} but it is missing from currencies list`);
    }
  }

  // Required parsed fields per bonus type
  const REQUIRED = {
    'deposit bonus': ['min_deposit', 'bonus_rate_pct', 'to_multiplier', 'max_bonus'],
    'deposit':       ['min_deposit', 'bonus_rate_pct', 'to_multiplier', 'max_bonus'],
    'cashback':      ['min_deposit', 'bonus_rate_pct', 'to_multiplier', 'max_bonus'],
    'free credit':   ['free_credit_amount', 'to_multiplier'],
    'free spin':     ['spin_count', 'value_per_spin', 'to_multiplier'],
  };
  for (const field of (REQUIRED[bt] || [])) {
    if (p[field] == null) reject(`parsed.${field}`, `parsed.${field} missing for ${request.bonus_type}`, 'Fill in the relevant source sheet column');
  }

  // FS spin ceiling on REL_/RET_ (NOTE only — operator may intentionally override)
  if (bt === 'free spin' && p.spin_count != null) {
    const code       = (request.promo_code || '').replace(/^(TEST_|FT_)/, '');
    const isRelRet   = code.includes('_REL_') || code.includes('_RET_');
    const isWelc     = code.includes('_WELC_');
    const isReferral = code.startsWith('REFEREE_') || code.startsWith('REFERRER_');
    if (isRelRet && !isWelc && !isReferral && p.spin_count > 88) {
      note('parsed.spin_count', `spin_count=${p.spin_count} exceeds 88-spin ceiling for REL_/RET_ codes`, 'Confirm with operator or reduce spin count');
    }
  }

  // Min deposit floor check (NOTE — operator may intentionally deviate)
  if (p.min_deposit != null) {
    for (const [currency, floor] of Object.entries(MIN_DEP_FLOORS)) {
      if (floor > 0 && (request.currencies || []).includes(currency) && Number(p.min_deposit) < floor) {
        note('parsed.min_deposit', `min_deposit=${p.min_deposit} is below the ${currency} platform floor of ${floor}`, 'Confirm with operator');
      }
    }
  }

  // Campaign prefix (NOTE at triage — can still be fixed before dry-run)
  const campFindings = checkCampaignPrefix(request.promo_code, request.campaign, request.campaign_owner, request.no_deposit);
  for (const f of campFindings) note('promo_code', f, 'Fix promo_code in col W before dry-run');

  // Category restriction reminder
  const catOnly = request.instructions?.categories_only || request.instructions?.category_only;
  if (catOnly && (!Array.isArray(catOnly) || catOnly.length > 0)) {
    note('instructions.categories_only', 'Category-restricted promo — plan must restrict game_provider_codes together with categories', 'Verify plan bundles after dry-run');
  }

  // Print result
  console.log('');
  console.log(`── TRIAGE  ${handle} ${'─'.repeat(Math.max(0, 58 - handle.length))}`);
  if (triageVerdict === 'READY') {
    console.log('✓ READY — all required fields present');
  } else {
    const icon = triageVerdict === 'RETURN' ? '✗' : '⚠';
    console.log(`${icon} ${triageVerdict} — ${triageIssues.length} issue(s):`);
    for (const i of triageIssues) {
      const sIcon = i.sev === 'RETURN' ? '✗' : '⚠';
      console.log(`  ${sIcon} [${i.sev}] ${i.field}: ${i.msg}`);
      if (i.action) console.log(`         → ${i.action}`);
    }
    if (triageVerdict === 'RETURN') {
      console.log('');
      console.log('STOP — fix source sheet and re-ingest before dry-run.');
      process.exitCode = 1;
      if (!doPlan) process.exit(1);
    }
  }
}

// ── PLAN CHECK ─────────────────────────────────────────────────────────────

if (doPlan) {
  const planDir = path.resolve('captures/qc-plans');
  const bundles = existsSync(planDir)
    ? readdirSync(planDir)
        .filter((f) => f.startsWith(`${handle}__`) && f.endsWith('.json'))
        .sort()
    : [];

  console.log('');
  console.log(`── PLAN    ${handle} ${'─'.repeat(Math.max(0, 58 - handle.length))}`);

  if (!bundles.length) {
    console.log(`⚠ No plan bundles for ${handle} — run dry-run first:`);
    console.log(`  node bin/canary-multi-brand.js ${handle} --parallel`);
    process.exit(1);
  }

  let anyFail = false;
  let anyWarn = false;

  for (const filename of bundles) {
    const bundle   = JSON.parse(await readFile(path.join(planDir, filename), 'utf8'));
    const brand    = bundle.brand;
    const platform = (bundle.platform || '').toLowerCase();
    const src      = bundle.source || {};
    const plan     = bundle.plan   || {};
    const prom     = plan.promotion || {};
    const bt       = (bundle.bonus_type || '').toLowerCase();
    const p        = src.parsed || {};
    const currencies = src.currencies || [];

    const pFail = (field, msg) => findings.push({ sev: 'FAIL', field, msg });
    const pWarn = (field, msg) => findings.push({ sev: 'WARN', field, msg });
    const findings = [];

    // ── Structural ──────────────────────────────────────────────────────────
    if (!plan.promotion) {
      pFail('plan.promotion', 'plan.promotion missing — canary aborted before building the body?');
    }

    // IGMP: _unimplemented blocks
    if (platform === 'igmp' && Array.isArray(plan._unimplemented) && plan._unimplemented.length > 0) {
      pFail('plan._unimplemented', `Commit will 422 — unresolved fields: ${plan._unimplemented.join(', ')}`);
    }

    // ── Blacklist template (QPRO + QP2 only) ────────────────────────────────
    if (platform !== 'igmp') {
      const blt = prom.blacklist_template_id ?? prom.blacklist_id;
      if (blt == null || blt === 0) {
        pFail('blacklist_template_id', 'No blacklist template — BO record will have no blacklist protection');
      }
    }

    // ── QP2 merchant_ids ─────────────────────────────────────────────────────
    if (platform === 'qp2') {
      const mids = prom.merchant_ids;
      if (!mids || Object.keys(mids).length === 0) {
        pFail('merchant_ids', 'merchant_ids empty — promo won\'t be claimable by any merchant');
      }
    }

    // ── Currency coverage (QPRO + QP2) ──────────────────────────────────────
    if (platform !== 'igmp' && currencies.length > 0) {
      const promCur = prom.promotion_currency;
      if (!promCur || Object.keys(promCur).length === 0) {
        pFail('promotion_currency', `No currency rows built (expected: ${currencies.join(', ')})`);
      } else {
        for (const c of currencies) {
          const expectedId = CURRENCY_ID[c];
          if (expectedId && !Object.values(promCur).some((row) => String(row.currency_id) === expectedId)) {
            pWarn('promotion_currency', `No row for ${c} (currency_id=${expectedId})`);
          }
        }
      }
    }

    // ── Reward value matching (per platform + bonus type) ───────────────────
    if (platform !== 'igmp') {
      const promCur = prom.promotion_currency;
      const firstRow = promCur ? Object.values(promCur)[0] : null;

      if (bt === 'deposit bonus' || bt === 'deposit' || bt === 'cashback') {
        // QP2: bonus_rate in currency row; QPRO: top-level bonus_rate
        const planRate = firstRow?.bonus_rate ?? prom.bonus_rate;
        if (planRate != null && p.bonus_rate_pct != null && Number(planRate) !== Number(p.bonus_rate_pct)) {
          pFail('bonus_rate_pct', `Plan=${planRate} vs source=${p.bonus_rate_pct}`);
        }
        const planMaxBonus = firstRow?.max_bonus ?? prom.max_bonus;
        if (planMaxBonus != null && p.max_bonus != null && Number(planMaxBonus) !== Number(p.max_bonus)) {
          pWarn('max_bonus', `First currency row max_bonus=${planMaxBonus} vs source=${p.max_bonus}`);
        }

      } else if (bt === 'free credit') {
        // QP2: bonus_amount in currency row
        const planAmt = firstRow?.bonus_amount ?? firstRow?.free_credit_amount ?? prom.free_credit_amount;
        if (planAmt != null && p.free_credit_amount != null && Number(planAmt) !== Number(p.free_credit_amount)) {
          pFail('free_credit_amount', `Plan=${planAmt} vs source=${p.free_credit_amount}`);
        }

      } else if (bt === 'free spin') {
        // QP2: rounds in currency row
        const planSpins = firstRow?.rounds ?? firstRow?.spin_count ?? prom.spin_count;
        if (planSpins != null && p.spin_count != null && Number(planSpins) !== Number(p.spin_count)) {
          pFail('spin_count', `Plan=${planSpins} vs source=${p.spin_count}`);
        }
        // Spin ceiling (FAIL here — code already in the plan)
        const code       = (bundle.promo_code || '').replace(/^(TEST_|FT_)/, '');
        const isWelc     = code.includes('_WELC_');
        const isReferral = code.startsWith('REFEREE_') || code.startsWith('REFERRER_');
        if (!isWelc && !isReferral && p.spin_count > 88) {
          pFail('spin_count', `spin_count=${p.spin_count} exceeds 88-spin ceiling`);
        }
        // FS game code resolved
        if (!prom.free_spin_game_code && !prom.fs_game_code) {
          pFail('free_spin_game_code', 'FS game code not resolved — commit will fail');
        }
      }
    }

    // ── IGMP reward checks ───────────────────────────────────────────────────
    if (platform === 'igmp') {
      const rewards = prom.PromotionRewards || [];
      if (bt === 'deposit bonus' || bt === 'deposit') {
        const r = rewards[0] || {};
        if (p.bonus_rate_pct != null && Number(r.BonusPercentage) !== Number(p.bonus_rate_pct)) {
          pFail('BonusPercentage', `Plan=${r.BonusPercentage} vs source=${p.bonus_rate_pct}`);
        }
        if (p.to_multiplier != null && Number(r.RolloverMultiplier) !== Number(p.to_multiplier)) {
          pFail('RolloverMultiplier', `Plan=${r.RolloverMultiplier} vs source=${p.to_multiplier}`);
        }
      } else if (bt === 'free credit') {
        const r = rewards[0] || {};
        if (p.free_credit_amount != null && Number(r.FixedBonusAmount) !== Number(p.free_credit_amount)) {
          pFail('FixedBonusAmount', `Plan=${r.FixedBonusAmount} vs source=${p.free_credit_amount}`);
        }
      } else if (bt === 'free spin') {
        const fu = (plan.followups || [])[0]?.body || {};
        const fs = fu.FreeSpin || {};
        if (!fs.GameId)    pFail('FreeSpin.GameId',    'FS game not resolved — commit will 422');
        if (!fs.ProductId) pFail('FreeSpin.ProductId', 'FS ProductId not resolved — commit will 422');
        if (p.spin_count != null && Number(fs.FreeSpinRounds) !== Number(p.spin_count)) {
          pFail('FreeSpinRounds', `Plan=${fs.FreeSpinRounds} vs source=${p.spin_count}`);
        }
      }
    }

    // ── QP2 deposit_status ────────────────────────────────────────────────────
    if (platform === 'qp2' && bt !== 'free spin') {
      const ds     = Number(prom.deposit_status);
      const minDep = Number(p.min_deposit ?? 0);
      if (minDep === 0 && ds !== 1) {
        pFail('deposit_status', `min_deposit=0 but deposit_status=${ds} (expected 1=None)`);
      } else if (minDep > 0 && ds === 1) {
        pFail('deposit_status', `min_deposit=${minDep} but deposit_status=1 (None) — expected 4=Last Deposit`);
      }
    }

    // ── Category + provider must be paired ────────────────────────────────────
    if (platform !== 'igmp') {
      const catOnly = src.instructions?.categories_only || src.instructions?.category_only;
      const hasCatRestriction = catOnly && (!Array.isArray(catOnly) || catOnly.length > 0);
      if (hasCatRestriction) {
        const gpField = prom.game_provider_codes || prom.game_provider_ids;
        if (!gpField || Object.keys(gpField).length === 0) {
          pFail('game_provider_codes', 'categories_only set but game_provider_codes is empty — bonus unscoped to category');
        }
      }
    }

    // ── Campaign prefix (FAIL at plan stage — code is now built, fixing requires re-dry-run) ──
    const campFindings = checkCampaignPrefix(bundle.promo_code, src.campaign, src.campaign_owner, src.no_deposit);
    for (const f of campFindings) findings.push({ sev: 'FAIL', field: 'promo_code', msg: f });

    // ── Print brand row ────────────────────────────────────────────────────────
    const hasFail = findings.some((i) => i.sev === 'FAIL');
    const hasWarn = findings.some((i) => i.sev === 'WARN');
    const verdict = hasFail ? 'FAIL' : hasWarn ? 'WARN' : 'PASS';
    const icon    = hasFail ? '✗' : hasWarn ? '⚠' : '✓';
    console.log(`  ${icon} ${brand.padEnd(10)} ${verdict}`);
    for (const i of findings) {
      const fi = i.sev === 'FAIL' ? '✗' : '⚠';
      console.log(`      ${fi} [${i.sev}] ${i.field}: ${i.msg}`);
    }
    if (hasFail) anyFail = true;
    if (hasWarn) anyWarn = true;
  }

  console.log('');
  if (anyFail) {
    console.log('✗ Plan check FAIL — fix issues above, re-ingest, and re-run dry-run before committing.');
    process.exitCode = 1;
  } else if (anyWarn) {
    console.log('⚠ Plan check WARN — warnings noted; ready to commit when you are.');
  } else {
    console.log('✓ Plan check PASS — ready to commit when you are.');
  }
}

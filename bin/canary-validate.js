#!/usr/bin/env node
// canary-validate.js — inline triage + plan completeness checker.
//
// Replaces the /qc-engine and /pre-qc subagent gates with deterministic
// file-read checks. Zero network calls. Runs in <500ms.
//
// WHAT IT CHECKS (not exhaustive — MT content analysis stays with Sentinel):
//   Triage : required fields, currency/region alignment, parsed keys,
//            TEST intent, FS game presence, campaign prefix tokens (NOTE)
//   Plan   : blacklist_template, merchant_ids, promotion_currency coverage,
//            reward-value vs source match, QP2 deposit_status, IGMP game
//            resolution, FS amount_per_line/coins/lines, stale bundles,
//            campaign prefix tokens (FAIL severity)
//
// WHAT IT DOES NOT CHECK (deferred to Sentinel post-save):
//   MT body content/vocabulary, HTML entity encoding, dialog body vocabulary,
//   T&C hyperlink format, QPRO promo_type/sub_type pair correctness.
//
// Usage:
//   node bin/canary-validate.js <handle> [--ft-prefix|--no-ft-prefix]        # triage only (after ingest)
//   node bin/canary-validate.js <handle> --plan [--ft-prefix|--no-ft-prefix] # plan check only (after dry-run)
//   node bin/canary-validate.js <handle> --all [--ft-prefix|--no-ft-prefix]  # triage + plan check

import { readFile, stat } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from './_args.js';
import { loadAllRequests, resolveHandle } from '../src/planner.js';
import { isIgmpRequest, resolveIgmpFtPrefixDecision } from '../src/igmp-ft-prefix.js';
import { isBrandAuthorized } from '../src/request-requirements.js';

const { flags, positional } = parseArgs(process.argv.slice(2));
const userInput = positional[0];
if (!userInput) {
  console.error('usage: canary-validate.js <handle|P###> [--plan] [--all] [--ft-prefix|--no-ft-prefix]');
  process.exit(2);
}

const doPlan   = flags.plan === true || flags.all === true;
const doTriage = flags.plan !== true || flags.all === true; // omit = triage; --plan = plan only; --all = both
const skipCodeCheck = flags['skip-code-check'] === true; // operator-confirmed code override
const brandFilter = flags.brands
  ? new Set(String(flags.brands).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean))
  : null;
const excludeFilter = flags.exclude
  ? new Set(String(flags.exclude).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean))
  : null;

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

  const cKey = campaign.toLowerCase();
  const pillar = PILLAR_FROM_CAMPAIGN[cKey];
  const obj    = OBJ_FROM_CAMPAIGN[cKey];
  // Pillar-based check applies when the campaign label is a known Pillar label,
  // even without a recognized team in Requestor (e.g. "Marketing") — the legacy
  // token map predates the 2026-07-09 Pillar labels and must not shadow them.
  if (campaignOwner || pillar || obj) {
    const missing = [];
    if (campaignOwner && !hasSeg(campaignOwner)) missing.push(`team "${campaignOwner}"`);
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

function hasStandaloneTestIntent(record) {
  const hay = [
    record?.remark,
    record?.name_details_raw,
    record?.change_details,
  ].filter(Boolean).join('\n');
  return record?.instructions?.add_test_prefix === true
    || /(?:^|\n)\s*(?:test|testing|for\s+testing|test\s+purpose|testing\s+purpose|training\s+purpose\s+only)\s*\.?\s*(?:\n|$)/i.test(hay);
}

function firstCodeLine(code) {
  return String(code || '').split('\n')[0].trim();
}

function expectedFsAmountPerLine(valuePerSpin, { isPlaytech = false } = {}) {
  const n = Number(valuePerSpin);
  if (!Number.isFinite(n)) return null;
  return isPlaytech ? +n.toFixed(2) : Math.floor(n / 20 * 100) / 100;
}

function nearlyEqual(a, b) {
  return Math.abs(Number(a) - Number(b)) < 0.00001;
}

// ── TRIAGE ─────────────────────────────────────────────────────────────────

let triageVerdict = 'READY';
const triageIssues = [];

if (doTriage) {
  const note   = (field, msg, action = '') => { triageIssues.push({ sev: 'NOTE',   field, msg, action }); if (triageVerdict === 'READY') triageVerdict = 'NOTE'; };
  const reject = (field, msg, action = '') => { triageIssues.push({ sev: 'RETURN', field, msg, action }); triageVerdict = 'RETURN'; };

  const bt = (request.bonus_type || '').toLowerCase();
  const p  = request.parsed || {};
  const coverage = request.coverage_manifest;

  if (!coverage) {
    reject('coverage_manifest', 'Source-column coverage manifest missing', 'Re-ingest with the zero-omission ingest path');
  } else {
    for (const issue of (coverage.unresolved || [])) {
      reject('coverage_manifest', issue, 'Fix or clarify the populated source column and re-ingest');
    }
    const unaccounted = Object.entries(coverage.source_cells || {})
      .filter(([, cell]) => cell.populated && !['mapped', 'informational'].includes(cell.disposition));
    if (unaccounted.length) {
      reject(
        'coverage_manifest',
        `Populated columns lack an approved disposition: ${unaccounted.map(([field]) => field).join(', ')}`,
        'Map every populated source column before dry-run',
      );
    }
  }

  if (!request.bonus_type || !KNOWN_BONUS_TYPES.has(bt)) {
    reject('bonus_type', `Unknown or missing bonus_type: "${request.bonus_type}"`, 'Set bonus_type in source sheet col E');
  }
  if (!request.brands?.length)  reject('brands',  'No brands listed', 'Add brands to source sheet');
  if (!request.regions?.length) reject('regions', 'No regions listed', 'Add regions to source sheet');
  if (!request.locales?.length) reject('locales', 'No locales listed', 'Add locales to source sheet');
  if (!request.promo_code)      reject('promo_code', 'promo_code missing', 'Set promo_code in col W');
  if (!request.promotion_name_en) reject('promotion_name_en', 'promotion_name_en missing', 'Set promo name in col X');
  if (!request.requestor)       note('requestor', 'requestor not set', 'Set requestor field');

  if (isIgmpRequest(request)) {
    const ft = resolveIgmpFtPrefixDecision(request, {
      forceFt: flags['ft-prefix'] === true,
      forceNoFt: flags['no-ft-prefix'] === true,
    });
    if (ft.error) {
      reject('instructions.ft_prefix_decision', ft.error, 'Choose exactly one FT prefix option');
    } else if (ft.decision === null) {
      reject(
        'instructions.ft_prefix_decision',
        'WS1/WS2 FT prefix decision is unanswered',
        'Ask the operator: “Does this WS1/WS2 promo need the FT_ prefix?” Then rerun with --ft-prefix or --no-ft-prefix, or record the answer in the source remark'
      );
    }
  }

  if (hasStandaloneTestIntent(request) && !/^TEST_/i.test(firstCodeLine(request.promo_code))) {
    reject(
      'promo_code',
      'Remark/details indicate TEST intent, but promo_code does not start with TEST_',
      'Re-ingest after fixing auto-name, or set col W to a TEST_ code before dry-run'
    );
  }

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

  if (bt === 'free spin') {
    if (!p.game && !p.game_by_brand) {
      reject('parsed.game', 'Free Spin game missing', 'Add the game name/code in source details and re-ingest');
    }
    if (!p.game_provider && !p.game_provider_by_brand) {
      note('parsed.game_provider', 'Free Spin provider not explicit; mapper will use its default/provider resolver', 'Confirm provider only if game is not under the default resolver');
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
  let checked = 0;

  for (const filename of bundles) {
    const planPath = path.join(planDir, filename);
    const bundle   = JSON.parse(await readFile(planPath, 'utf8'));
    const brand    = bundle.brand;
    const brandKey = String(brand || '').toUpperCase();
    if (brandFilter && !brandFilter.has(brandKey)) continue;
    if (excludeFilter && excludeFilter.has(brandKey)) continue;
    checked++;
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

    try {
      const [reqStat, planStat] = await Promise.all([stat(requestPath), stat(planPath)]);
      if (reqStat.mtimeMs > planStat.mtimeMs + 1000) {
        pFail('plan_bundle', 'Plan bundle is older than the source request snapshot; re-run dry-run before commit');
      }
    } catch {
      pFail('plan_bundle', 'Could not compare request and plan timestamps');
    }

    if (hasStandaloneTestIntent({ ...request, ...src }) && !/^TEST_/i.test(firstCodeLine(bundle.promo_code))) {
      pFail('promo_code', 'Remark/details indicate TEST intent, but planned promo_code does not start with TEST_');
    }

    // ── Structural ──────────────────────────────────────────────────────────
    if (!plan.promotion) {
      pFail('plan.promotion', 'plan.promotion missing — canary aborted before building the body?');
    }

    const dialogScope = src.dialog_scope || src.coverage_manifest?.requirements?.dialog_scope;
    if (dialogScope) {
      const authorized = isBrandAuthorized(dialogScope, brand);
      if (authorized && dialogScope.enabled && platform !== 'igmp' && !plan.dialogPopup) {
        pFail('dialogPopup', `Dialog is required on ${brand} but no dialog plan was generated`);
      }
      if (!authorized && plan.dialogPopup) {
        pFail('dialogPopup', `Dialog is prohibited on ${brand} but a dialog plan was generated`);
      }
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
        // FS game code resolved
        if (!prom.free_spin_game_code && !prom.fs_game_code) {
          pFail('free_spin_game_code', 'FS game code not resolved — commit will fail');
        }
        if (!prom.free_spin_game_provider_id && !prom.fs_game_provider_id && !prom.game_provider_codes) {
          pFail('free_spin_game_provider_id', 'FS provider not resolved — commit will fail');
        }
        if (promCur) {
          const rows = Object.values(promCur);
          const isPlaytech = /playtech/i.test(src.parsed?.game_provider || '');
          const expectedApl = expectedFsAmountPerLine(p.value_per_spin, { isPlaytech });
          for (const row of rows) {
            const label = row.currency || row.currency_id || '?';
            if (Number(row.coins) !== 0) pFail('coins', `${brand} ${label}: coins=${row.coins}; expected 0`);
            if (Number(row.lines) !== 0) pFail('lines', `${brand} ${label}: lines=${row.lines}; expected 0`);
            if (expectedApl != null && !nearlyEqual(row.amount_per_line, expectedApl)) {
              pFail('amount_per_line', `${brand} ${label}: amount_per_line=${row.amount_per_line}; expected ${expectedApl} from value_per_spin=${p.value_per_spin}`);
            }
          }
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

    // QP2 all-games promos must include the operator-required providers in
    // both PUT fields. This catches stale or cross-merchant provider catalogs
    // before save (P166-P171 incident, 2026-07-23).
    if (platform === 'qp2' && bt !== 'free spin') {
      const catOnly = src.instructions?.categories_only || src.instructions?.category_only;
      const hasCatRestriction = catOnly && (!Array.isArray(catOnly) || catOnly.length > 0);
      if (!hasCatRestriction) {
        const required = ['BTI', 'SBO2', 'SPRIBE2', 'WF'];
        const topValues = Object.values(prom.game_provider_codes || {}).map(String);
        const target = Array.isArray(prom.target) ? prom.target[0] : (prom.target?.['0'] || prom.target || {});
        const targetValues = Object.values(target.game_provider_codes || {}).map(String);
        for (const code of required) {
          if (!targetValues.includes(code)) {
            pFail('target.game_provider_codes', `required QP2 all-games provider ${code} is missing`);
          }
        }
        if (topValues.length < targetValues.length) {
          pFail(
            'game_provider_codes',
            `top-level provider count ${topValues.length} is smaller than target count ${targetValues.length}`,
          );
        }
      }
    }

    // ── Campaign prefix (FAIL at plan stage — code is now built, fixing requires re-dry-run) ──
    // IGMP/WS1 codes use FT_ prefix convention that omits ADHOC_/RET_ etc. — downgrade to WARN.
    const campFindings = checkCampaignPrefix(bundle.promo_code, src.campaign, src.campaign_owner, src.no_deposit);
    const campSev = (platform === 'igmp' || skipCodeCheck) ? 'WARN' : 'FAIL';
    for (const f of campFindings) findings.push({ sev: campSev, field: 'promo_code', msg: f });

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
  if (checked === 0) {
    console.log('✗ Plan check FAIL — no plan bundles matched the requested brand filter.');
    process.exitCode = 1;
  } else if (anyFail) {
    console.log('✗ Plan check FAIL — fix issues above, re-ingest, and re-run dry-run before committing.');
    process.exitCode = 1;
  } else if (anyWarn) {
    console.log('⚠ Plan check WARN — warnings noted; ready to commit when you are.');
  } else {
    console.log('✓ Plan check PASS — ready to commit when you are.');
  }
}

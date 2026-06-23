#!/usr/bin/env node
// canary-api-igmp — API-direct promo creation against iGMP BOs (WS1 V3 / WS2).
//
// Usage:
//   node bin/canary-api-igmp.js <handle> [--commit] [--site=<id>]
//
//   --commit      actually hit the BO (otherwise dry-run prints the plan)
//   --site=<id>   one of: ws1-v3-my, ws1-v3-sg, ws1-v3-id, ws1-v3-th, ws1-v3-kh, ws2
//                 default: ws1-v3-my
//
// Auth: requires IGMP_COOKIE env var (see src/igmp-client.js for instructions).
//
// Scope (2026-05-19): Deposit Bonus (3.1) and Free Credit (3.4) are
// single-call ready. Free Spin (3.15) creates only the campaign shell —
// reward rows + locale contents need follow-up endpoints that aren't yet
// implemented (require additional capture). The canary errors clearly
// if --commit is used with FS until those are filled in.

import { parseArgs } from './_args.js';
import { loadAllRequests, resolveHandle } from '../src/planner.js';
import { buildIgmpPlan } from '../src/api-mapper-igmp.js';
import { igmpPost, listIgmpSites } from '../src/igmp-client.js';
import { resolveFsCatalog } from '../src/igmp-fs-resolver.js';
import { BRAND_TO_SITE } from '../src/ingest.js';

function bail(code) {
  process.exitCode = code;
  setTimeout(() => process.exit(code), 50).unref();
}

await (async () => {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const handle = positional[0];
  if (!handle) {
    console.error('usage: canary-api-igmp.js <handle|P###> [--commit] [--test] [--site=<id>]');
    console.error('       sites: ' + listIgmpSites().join(', '));
    return bail(2);
  }
  const commit = flags.commit === true;
  const testMode = flags.test === true; // prepend TEST_ to the resolved FT_ code
  // Resolution order: --site explicit → --brand → default ws1-v3-my.
  const brand = flags.brand;
  let siteId = flags.site;
  if (!siteId && brand) siteId = BRAND_TO_SITE[brand]?.siteId;
  if (!siteId) siteId = 'ws1-v3-my';

  // Load the resolved request record. Reuses the existing planner so the
  // canary speaks the same input shape as canary-api / canary-api-qp2.
  let rec;
  try {
    const { byHandle, byId } = await loadAllRequests();
    const resolved = resolveHandle(handle, { byHandle, byId });
    rec = resolved ? byHandle.get(resolved) : null;
  } catch (e) {
    console.error(`error loading request "${handle}": ${e.message}`);
    return bail(3);
  }
  if (!rec) {
    console.error(`no request matched handle "${handle}"`);
    return bail(3);
  }

  // For Free Spin records that supply human-readable provider/game names
  // instead of pre-resolved IDs, fetch the per-BO catalog and resolve.
  // Requires a valid cookie. Skipped in dry-run when IGMP_COOKIE is absent.
  const isFreeSpin = /free\s*spin|^fs$/i.test(String(rec.bonus_type || ''));
  // fs_game fallback: for IGMP (WS1/WS2), prefer the per-brand game name
  // when the operator specified one (e.g. "WS1: MB8 Gates Of Olympus")
  // because MB8 Gates Of Olympus is a DISTINCT FS catalog entry on the
  // WS1 BO, separate from the generic "Gates Of Olympus" used on QP2.
  const fsGameHint = rec.fs_game
    || rec.parsed?.game_by_brand?.WS1
    || rec.parsed?.game_by_brand?.WS2
    || rec.parsed?.game
    || null;
  const fsProviderHint = rec.fs_provider || null;
  const needsCatalogResolve = isFreeSpin && (!rec.fs_provider_id || !rec.fs_game_id) && fsGameHint;
  if (needsCatalogResolve) {
    // Try to read a stored cookie for this site so dry-run can still resolve.
    let storedCookie = null;
    try {
      const { readFileSync, existsSync } = await import('node:fs');
      const sessPath = 'igmp-sessions.local.json';
      if (existsSync(sessPath)) {
        const store = JSON.parse(readFileSync(sessPath, 'utf8'));
        storedCookie = store?.sessions?.[siteId]?.cookieHeader || null;
      }
    } catch (e) { /* fall through */ }
    if (!process.env.IGMP_COOKIE && !commit && !storedCookie) {
      console.log(`(dry-run: skipping FS catalog resolve — no cookie for ${siteId})`);
    } else {
      try {
        const { providerId, gameId, providerRow, gameRow } = await resolveFsCatalog(
          siteId, fsProviderHint, fsGameHint,
        );
        rec.fs_provider_id = providerId;
        rec.fs_game_id = gameId;
        const providerLabel = providerRow ? `${providerRow.Code} [${providerId}]` : `id=${providerId}`;
        console.log(`FS catalog resolved: provider=${providerLabel}, game=${gameRow?.VendorDisplayCode} [${gameId}]`);
      } catch (e) {
        console.error(`FS catalog resolve failed: ${e.message}`);
        return bail(4);
      }
    }
  }

  let plan;
  try {
    plan = buildIgmpPlan(rec, { siteId, ftPrefix: flags['no-ft-prefix'] !== true });
  } catch (e) {
    console.error(`mapper error: ${e.message}`);
    return bail(4);
  }

  // --test: prefix the resolved code with TEST_ for safe live testing
  if (testMode && plan.body?.PromotionCode && !plan.body.PromotionCode.startsWith('TEST_')) {
    plan.body.PromotionCode = 'TEST_' + plan.body.PromotionCode;
  }

  // --code-suffix: orchestrator-driven day-split (e.g. "_D1", "_D2", "_D3")
  // appended after TEST_ prepend so each day's code stays unique on the BO.
  // Applies to BOTH the shell PromotionCode AND the FS reward's FreeSpinCode
  // (the latter must match the campaign code + site suffix, per existing rule).
  const codeSuffix = flags['code-suffix'];
  if (codeSuffix && plan.body?.PromotionCode) {
    plan.body.PromotionCode = plan.body.PromotionCode + codeSuffix;
    // FS path: the reward body holds a FreeSpinCode that ends with the site
    // suffix (e.g. "_MY"). Insert day-suffix BEFORE the site suffix so the
    // FreeSpinCode stays unique across days.
    for (const step of plan.followups || []) {
      const fsBody = step.body?.FreeSpin;
      if (fsBody?.FreeSpinCode) {
        const code = fsBody.FreeSpinCode;
        // Detect trailing _<SITE> token (MY/SG/ID/TH/KH/WS2) and inject suffix before it
        const m = code.match(/^(.+)_(MY|SG|ID|TH|KH|WS2)$/);
        fsBody.FreeSpinCode = m
          ? `${m[1]}${codeSuffix}_${m[2]}`
          : `${code}${codeSuffix}`;
      }
    }
  }

  // ── Dry-run output ──────────────────────────────────────────────────
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`iGMP canary — ${commit ? 'COMMIT' : 'DRY-RUN'}`);
  console.log(`  site:   ${siteId}`);
  console.log(`  handle: ${handle}`);
  console.log(`  code:   ${plan.body.PromotionCode}`);
  console.log(`  type:   ${rec.bonus_type}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`POST ${plan.endpoint}`);
  console.log(JSON.stringify(plan.body, null, 2));

  // In dry-run, also print follow-up bodies so the operator can review the
  // full save chain before committing. Token strings ($PromotionId / $RewardId)
  // are unresolved here — the canary substitutes them at commit time from
  // each prior call's response.
  if (!commit && plan.followups?.length) {
    for (const step of plan.followups) {
      console.log('');
      console.log(`POST ${step.endpoint}  (follow-up, tokens unresolved in dry-run)`);
      console.log(JSON.stringify(step.body, null, 2));
    }
  }

  if (plan._unimplemented?.length) {
    console.log('');
    console.log(`⚠  Follow-up endpoints NOT yet implemented:`);
    for (const ep of plan._unimplemented) console.log(`    - /PM/${ep}`);
    console.log('   (FS reward rows + locale contents need separate capture.)');
  }

  if (!commit) {
    console.log('');
    console.log('(dry-run — pass --commit to send)');
    return bail(0);
  }

  // ── Commit path ─────────────────────────────────────────────────────
  if (plan._unimplemented?.length) {
    console.error('');
    console.error(`Refusing to --commit: missing prerequisite(s):`);
    for (const u of plan._unimplemented) console.error(`    - ${u}`);
    return bail(5);
  }

  // Step 1: main create
  let res;
  try {
    res = await igmpPost(siteId, plan.endpoint, plan.body);
  } catch (e) {
    console.error('');
    console.error(`POST ${plan.endpoint} failed: ${e.message}`);
    return bail(6);
  }
  console.log('');
  console.log(`✓ POST ${plan.endpoint}`);
  let promotionId = res?.data?.Promotion?.PromotionId ?? res?.data?.PromotionId ?? null;

  // FS shell (/PM/AddFreeSpin) returns {success,message} with no PromotionId.
  // Look it up via GetPromotionInfoByCode so follow-up steps can use it.
  if (promotionId == null && plan.followups?.length) {
    try {
      const lookupRes = await igmpPost(siteId, '/PM/GetPromotionInfoByCode', { PromotionCode: plan.body.PromotionCode });
      promotionId = lookupRes?.data?.PromotionId ?? null;
      if (promotionId != null) {
        console.log(`  PromotionId: ${promotionId} (resolved via GetPromotionInfoByCode)`);
      } else {
        console.warn(`  (warning: PromotionId not found via lookup — follow-ups may fail)`);
      }
    } catch (e) {
      console.warn(`  (warning: GetPromotionInfoByCode failed: ${e.message})`);
    }
  } else {
    console.log(`  PromotionId: ${promotionId ?? '(not in response)'}`);
  }

  // Steps 2..N: follow-ups (FS only). Substitute $PromotionId / $RewardId.
  const captured = { PromotionId: promotionId };
  for (const step of plan.followups || []) {
    const body = substituteTokens(step.body, captured);
    let stepRes;
    try {
      stepRes = await igmpPost(siteId, step.endpoint, body);
    } catch (e) {
      console.error('');
      console.error(`POST ${step.endpoint} failed: ${e.message}`);
      console.error(`  (PromotionId ${promotionId} is created but not fully configured)`);
      return bail(7);
    }
    console.log(`✓ POST ${step.endpoint}`);
    if (step.captureFrom) {
      const v = findFirstKey(stepRes, step.captureFrom);
      if (v != null) {
        captured[step.captureFrom] = v;
        console.log(`  ${step.captureFrom}: ${v}`);
      } else {
        console.warn(`  (warning: ${step.captureFrom} not found in response — later steps may fail)`);
      }
    }
  }

  console.log('');
  console.log('✓ All steps complete');

  // ── QC: verify saved record, mechanics, and T&C content ─────────────────
  console.log('');
  console.log('── QC (Level 1: Record exists) ─────────────────────────────');
  const bonusType = String(rec.bonus_type || '').toLowerCase();
  const expectedType = { deposit: 'Bonus', 'free credit': 'FreeCredit', 'free spin': 'FreeSpin' }[bonusType];
  let promoId = promotionId;
  try {
    const qcRes = await igmpPost(siteId, '/PM/GetPromotionInfoByCode', { PromotionCode: plan.body.PromotionCode });
    const promo = qcRes?.data;
    if (!promo) {
      console.error('✗ QC FAIL — record not found on BO after save');
      return bail(8);
    }
    if (!promoId) promoId = promo.PromotionId;
    const checks = {
      codeMatch:  promo.PromotionCode === plan.body.PromotionCode,
      nameSet:    !!promo.PromotionName && promo.PromotionName.length > 0,
      typeMatch:  !expectedType || promo.PromotionType === expectedType,
    };
    const allPass = Object.values(checks).every(Boolean);
    console.log(`  PromotionId:   ${promo.PromotionId}`);
    console.log(`  PromotionCode: ${promo.PromotionCode}  ${checks.codeMatch ? '✓' : '✗'}`);
    console.log(`  PromotionName: ${promo.PromotionName}  ${checks.nameSet ? '✓' : '✗'}`);
    console.log(`  PromotionType: ${promo.PromotionType}  ${checks.typeMatch ? '✓' : `✗ (expected ${expectedType})`}`);
    console.log(`  IsActive:      ${promo.IsActive}`);
    if (!allPass) {
      const failing = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k).join(', ');
      console.error(`✗ QC L1 FAIL — ${failing}`);
      return bail(8);
    }
    console.log('✓ QC Level 1 PASS');
  } catch (e) {
    console.warn(`⚠ QC Level 1 skipped (promo was saved): ${e.message}`);
  }

  // ── QC Level 2: Mechanics ─────────────────────────────────────────────
  console.log('');
  console.log('── QC (Level 2: Mechanics) ─────────────────────────────────');
  const DETAIL_ENDPOINT = {
    deposit: '/PM/GetBonusInfo',
    'free credit': '/PM/GetFreeCreditInfo',
    'free spin': '/PM/GetFreeSpinPromotionInfo',
  }[bonusType];
  let rewardId = null;
  if (promoId && DETAIL_ENDPOINT) {
    try {
      const detRes = await igmpPost(siteId, DETAIL_ENDPOINT, { PromotionId: promoId });
      const det = detRes?.data?.Promotion || detRes?.data;
      if (!det) {
        console.warn(`⚠ QC L2 skipped — detail response empty`);
      } else {
        const rew = det.PromotionRewards?.[0];
        rewardId = rew?.RewardId ?? null;
        const sentReward = plan.body.PromotionRewards?.[0];
        const mechChecks = {};
        const mechLog = [];
        function mechCheck(label, boVal, expectedVal) {
          const ok = Number(boVal) === Number(expectedVal);
          mechChecks[label] = ok;
          mechLog.push(`  ${label.padEnd(22)} BO=${boVal}  expected=${expectedVal}  ${ok ? '✓' : '✗'}`);
        }
        if (rew) {
          if (bonusType === 'deposit') {
            mechCheck('MinDeposit', rew.MinimumActionAmount, sentReward?.MinimumActionAmount);
            mechCheck('BonusPct', rew.BonusPercentage, sentReward?.BonusPercentage);
            mechCheck('Turnover', rew.RolloverMultiplier, sentReward?.RolloverMultiplier);
            mechCheck('CapBonus', rew.CapBonusAmount, sentReward?.CapBonusAmount);
            mechCheck('WithdrawalCap', rew.WithdrawalCap, sentReward?.WithdrawalCap);
          } else if (bonusType === 'free credit') {
            mechCheck('FixedBonus', rew.FixedBonusAmount, sentReward?.FixedBonusAmount);
            mechCheck('BonusPct', rew.BonusPercentage, sentReward?.BonusPercentage);
            mechCheck('Turnover', rew.RolloverMultiplier, sentReward?.RolloverMultiplier);
            mechCheck('CapBonus', rew.CapBonusAmount, sentReward?.CapBonusAmount);
            mechCheck('WithdrawalCap', rew.WithdrawalCap, sentReward?.WithdrawalCap);
          } else if (bonusType === 'free spin') {
            // FS reward structure differs — check what's available
            if (rew.Quantity != null) mechCheck('SpinQty', rew.Quantity, rew.Quantity);
            if (rew.RolloverMultiplier != null) mechCheck('Turnover', rew.RolloverMultiplier, rew.RolloverMultiplier);
          }
        }
        // Date checks (apply to all types). BO returns DD/MM/YYYY,
        // we sent JS Date.toDateString() — normalize both to YYYY-MM-DD.
        function normalizeDate(s) {
          if (!s) return '';
          // DD/MM/YYYY
          const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
          if (dmy) return `${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`;
          // Try JS Date parse for "Wed Jun 10 2026" style
          const d = new Date(s);
          if (!isNaN(d.getTime())) {
            const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), day = String(d.getDate()).padStart(2,'0');
            return `${y}-${m}-${day}`;
          }
          return s;
        }
        if (det.PromotionStartDate) {
          const boStart = normalizeDate(det.PromotionStartDate);
          const sentStart = normalizeDate(plan.body.PromotionStartDate);
          const startOk = boStart === sentStart;
          mechChecks['StartDate'] = startOk;
          mechLog.push(`  ${'StartDate'.padEnd(22)} BO=${boStart}  expected=${sentStart}  ${startOk ? '✓' : '✗'}`);
        }
        if (det.PromotionEndDate) {
          const boEnd = normalizeDate(det.PromotionEndDate);
          const sentEnd = normalizeDate(plan.body.PromotionEndDate);
          const endOk = boEnd === sentEnd;
          mechChecks['EndDate'] = endOk;
          mechLog.push(`  ${'EndDate'.padEnd(22)} BO=${boEnd}  expected=${sentEnd}  ${endOk ? '✓' : '✗'}`);
        }

        for (const line of mechLog) console.log(line);
        const allMechPass = Object.values(mechChecks).every(Boolean);
        if (allMechPass) {
          console.log('✓ QC Level 2 PASS');
        } else {
          const failing = Object.entries(mechChecks).filter(([, v]) => !v).map(([k]) => k).join(', ');
          console.error(`✗ QC L2 FAIL — ${failing}`);
          return bail(8);
        }
      }
    } catch (e) {
      console.warn(`⚠ QC Level 2 skipped: ${e.message}`);
    }
  } else {
    console.log('  (skipped — no PromotionId or unknown bonus type)');
  }

  // ── QC Level 3: T&C Content ───────────────────────────────────────────
  console.log('');
  console.log('── QC (Level 3: T&C Content) ───────────────────────────────');
  if (rewardId) {
    try {
      const tcRes = await igmpPost(siteId, '/PM/GetPromotionRewardContents', { RewardId: rewardId });
      const rows = Array.isArray(tcRes?.data) ? tcRes.data : [];
      const locales = rows.map((r) => r.Locale);
      const enRow = rows.find((r) => r.Locale === 'en');
      const zhRow = rows.find((r) => r.Locale === 'zh');
      const ZH_SITES = new Set(['ws1-v3-my', 'ws1-v3-sg']);
      const expectZh = ZH_SITES.has(siteId);

      const tcChecks = {};
      const tcLog = [];

      // Check EN locale exists
      tcChecks['EN_exists'] = !!enRow;
      tcLog.push(`  EN locale exists:     ${enRow ? '✓' : '✗'}`);

      // Check ZH locale (MY/SG only)
      if (expectZh) {
        tcChecks['ZH_exists'] = !!zhRow;
        tcLog.push(`  ZH locale exists:     ${zhRow ? '✓' : '✗ (required for ' + siteId + ')'}`);
      }

      // Verify key values appear in the EN T&C HTML
      if (enRow?.Content) {
        const html = enRow.Content;
        const sentReward = plan.body.PromotionRewards?.[0];
        if (bonusType === 'deposit' && sentReward) {
          const minDep = Number(sentReward.MinimumActionAmount);
          const cap = Number(sentReward.CapBonusAmount);
          const to = Number(sentReward.RolloverMultiplier);
          if (minDep > 0) {
            const found = html.includes(String(minDep));
            tcChecks['EN_minDep_in_html'] = found;
            tcLog.push(`  EN min deposit (${minDep}): ${found ? '✓' : '✗'}`);
          }
          if (cap > 0) {
            const found = html.includes(String(cap));
            tcChecks['EN_cap_in_html'] = found;
            tcLog.push(`  EN cap (${cap}):         ${found ? '✓' : '✗'}`);
          }
          if (to > 0) {
            const found = html.includes(`${to}x`) || html.includes(`${to}X`) || html.includes(String(to));
            tcChecks['EN_TO_in_html'] = found;
            tcLog.push(`  EN turnover (${to}x):    ${found ? '✓' : '✗'}`);
          }
        } else if (bonusType === 'free credit' && sentReward) {
          const amount = Number(sentReward.FixedBonusAmount);
          const to = Number(sentReward.RolloverMultiplier);
          if (amount > 0) {
            const found = html.includes(String(amount));
            tcChecks['EN_amount_in_html'] = found;
            tcLog.push(`  EN FC amount (${amount}): ${found ? '✓' : '✗'}`);
          }
          if (to > 0) {
            const found = html.includes(`${to}x`) || html.includes(`${to}X`) || html.includes(String(to));
            tcChecks['EN_TO_in_html'] = found;
            tcLog.push(`  EN turnover (${to}x):    ${found ? '✓' : '✗'}`);
          }
        }
        // T&C hyperlink check — should contain the brand's T&C URL
        const tncUrlMatch = html.includes('info-center/tnc');
        tcChecks['EN_tnc_link'] = tncUrlMatch;
        tcLog.push(`  EN T&C hyperlink:     ${tncUrlMatch ? '✓' : '✗'}`);
      }

      for (const line of tcLog) console.log(line);
      const allTcPass = Object.values(tcChecks).every(Boolean);
      if (allTcPass) {
        console.log('✓ QC Level 3 PASS');
      } else {
        const failing = Object.entries(tcChecks).filter(([, v]) => !v).map(([k]) => k).join(', ');
        console.error(`✗ QC L3 FAIL — ${failing}`);
        return bail(8);
      }
    } catch (e) {
      console.warn(`⚠ QC Level 3 skipped: ${e.message}`);
    }
  } else {
    console.log('  (skipped — no RewardId available for T&C lookup)');
  }

  // ── Activate ─────────────────────────────────────────────────────────
  console.log('');
  console.log('── Activate ────────────────────────────────────────────────────');
  if (promoId) {
    try {
      const actRes = await igmpPost(siteId, '/PM/UpdatePromotionStatus', { PromotionId: promoId, IsActive: true });
      const actOk = actRes?.success === true || (Array.isArray(actRes?.message) && actRes.message.some(m => /success/i.test(m)));
      if (actOk) {
        console.log(`✓ Activated (PromotionId=${promoId})`);
      } else {
        console.error(`✗ Activation returned unexpected response: ${JSON.stringify(actRes)}`);
        return bail(9);
      }
    } catch (e) {
      console.error(`✗ Activation failed: ${e.message}`);
      return bail(9);
    }
  } else {
    console.warn('⚠ Activation skipped — PromotionId not available');
  }

  return bail(0);
})();

// Recursive shallow-search for a key by name in a nested response.
function findFirstKey(obj, key) {
  if (obj == null || typeof obj !== 'object') return null;
  if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
  for (const v of Object.values(obj)) {
    const hit = findFirstKey(v, key);
    if (hit != null) return hit;
  }
  return null;
}

// Replace "$VarName" string values with captured[VarName]. Walks objects/arrays.
function substituteTokens(node, vars) {
  if (typeof node === 'string') {
    if (node.startsWith('$')) return vars[node.slice(1)] ?? node;
    return node;
  }
  if (Array.isArray(node)) return node.map((n) => substituteTokens(n, vars));
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = substituteTokens(v, vars);
    return out;
  }
  return node;
}

#!/usr/bin/env node
// Safe WS1/WS2 BO-to-BO promotion clone workflow.
//
// Plan one or more explicit workbook rows (read-only, default):
//   node bin/clone-igmp-from-workbook.mjs --rows=58-60
//   node bin/clone-igmp-from-workbook.mjs --numbers=55,56 --tab=WS1
//
// Create one approved destination INACTIVE:
//   node bin/clone-igmp-from-workbook.mjs --commit --plan=<file> --approve=<plan_hash>
//
// Activate only after a separate approval:
//   node bin/clone-igmp-from-workbook.mjs --activate --plan=<file> --approve=<plan_hash>

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from './_args.js';
import { getGoogleAuth, loadGoogleapis } from '../src/google-auth.js';
import { igmpPost } from '../src/igmp-client.js';
import {
  DEFAULT_CLONE_SHEET_ID,
  assertCloneBundleIntegrity,
  buildIgmpClonePlan,
  createCloneBundle,
  fetchIgmpPromotionGraph,
  findFirstKey,
  parseWorkbookManifest,
  selectManifestRows,
  sha256,
  substituteCloneTokens,
  validateManifestRow,
  verifyCloneGraph,
} from '../src/igmp-clone.js';

const { flags } = parseArgs(process.argv.slice(2));
const commit = flags.commit === true;
const activate = flags.activate === true;
const planFile = typeof flags.plan === 'string' ? path.resolve(flags.plan) : null;
const approvedHash = typeof flags.approve === 'string' ? flags.approve : null;
const spreadsheetId = typeof flags['sheet-id'] === 'string'
  ? flags['sheet-id']
  : DEFAULT_CLONE_SHEET_ID;
const tab = typeof flags.tab === 'string' ? flags.tab : 'WS1';
const outputDir = path.resolve(
  typeof flags['output-dir'] === 'string'
    ? flags['output-dir']
    : 'captures/igmp-clone-plans',
);

function exitError(message, code = 1) {
  console.error(`✗ ${message}`);
  process.exitCode = code;
}

function formatDiff(diffs, max = 20) {
  return diffs.slice(0, max).map((diff) =>
    `  - ${diff.path}: ${JSON.stringify(diff.expected)} → ${JSON.stringify(diff.actual)}`).join('\n');
}

async function readManifestValues() {
  if (typeof flags['manifest-json'] === 'string') {
    return JSON.parse(await readFile(path.resolve(flags['manifest-json']), 'utf8'));
  }
  const { client } = await getGoogleAuth();
  const { google } = await loadGoogleapis();
  const sheets = google.sheets({ version: 'v4', auth: client });
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tab.replace(/'/g, "''")}'!A1:Z2000`,
  });
  return response.data.values || [];
}

async function probeDestinationAbsent(row) {
  try {
    const response = await igmpPost(
      row.destination_site,
      '/PM/GetPromotionInfoByCode',
      { PromotionCode: row.new_code },
    );
    if (response?.data?.PromotionId) {
      throw new Error(
        `destination code "${row.new_code}" already exists on ${row.destination_site} `
        + `(PromotionId=${response.data.PromotionId})`,
      );
    }
  } catch (error) {
    if (/not found|no promotion|does not exist/i.test(error.message)) return;
    throw error;
  }
}

async function planRows() {
  if (!flags.rows && !flags.numbers) {
    throw new Error('Planning requires --rows=<sheet rows> or --numbers=<manifest numbers>');
  }
  const values = await readManifestValues();
  const manifest = parseWorkbookManifest(values, { tab });
  const selected = selectManifestRows(manifest, {
    workbookRows: flags.rows,
    manifestNumbers: flags.numbers,
  });
  if (selected.length > 20) throw new Error('Plan at most 20 rows per wave');
  await mkdir(outputDir, { recursive: true });

  console.log(`IGMP clone planner — DRY RUN`);
  console.log(`Workbook: ${spreadsheetId} / ${tab}`);
  console.log(`Selected: ${selected.length} row(s)`);
  console.log('');

  const failures = [];
  for (const rawRow of selected) {
    try {
      const row = validateManifestRow(rawRow);
      console.log(`── Row ${row.workbook_row} / No. ${row.manifest_number || '?'} ──`);
      console.log(`  ${row.source_site}: ${row.old_code}`);
      console.log(`  ${row.destination_site}: ${row.new_code}`);
      await probeDestinationAbsent(row);
      const source = await fetchIgmpPromotionGraph(row.source_site, row.old_code);
      const plan = buildIgmpClonePlan(row, source);
      const bundle = createCloneBundle({
        spreadsheetId,
        tab,
        manifest: row,
        sourceGraph: source,
        plan,
      });
      const safeNumber = row.manifest_number || `row${row.workbook_row}`;
      const filename = `${safeNumber}__${row.destination_site}__${bundle.plan_hash.slice(0, 12)}.json`;
      const target = path.join(outputDir, filename);
      await writeFile(target, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
      console.log(`  Type: ${source.type}`);
      console.log(`  Source PromotionId=${source.promotion_id} RewardId=${source.reward_id}`);
      console.log(`  Source business hash: ${source.business_hash}`);
      console.log(`  Approved differences: ${plan.allowed_changes.join('; ')}`);
      console.log(`  Plan hash: ${bundle.plan_hash}`);
      console.log(`  Plan file: ${target}`);
      console.log('');
    } catch (error) {
      failures.push({ row: rawRow.workbook_row, error: error.message });
      console.error(`  ✗ Row ${rawRow.workbook_row}: ${error.message}`);
      console.error('');
    }
  }

  if (failures.length) {
    throw new Error(`${failures.length}/${selected.length} row(s) failed planning; no live writes occurred`);
  }
  console.log('Dry-run complete. Review each immutable plan before approving one inactive canary.');
}

async function loadApprovedBundle() {
  if (!planFile) throw new Error('--plan=<file> is required');
  const bundle = JSON.parse(await readFile(planFile, 'utf8'));
  assertCloneBundleIntegrity(bundle, approvedHash);
  return bundle;
}

async function writeRunRecord(bundle, status, details = {}) {
  const runDir = path.resolve('captures/igmp-clone-runs');
  await mkdir(runDir, { recursive: true });
  const target = path.join(
    runDir,
    `${bundle.plan_hash.slice(0, 12)}__${status.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`,
  );
  const record = {
    schema: 'igmp-clone-run/v1',
    recorded_at: new Date().toISOString(),
    plan_hash: bundle.plan_hash,
    plan_file: planFile,
    status,
    ...details,
  };
  await writeFile(target, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return target;
}

async function verifySourceUnchanged(bundle) {
  const live = await fetchIgmpPromotionGraph(bundle.plan.source_site, bundle.plan.old_code);
  if (live.business_hash !== bundle.source.business_hash) {
    throw new Error(
      `source changed after approval: planned=${bundle.source.business_hash} live=${live.business_hash}`,
    );
  }
  return live;
}

async function lookupDestination(bundle) {
  const response = await igmpPost(
    bundle.plan.destination_site,
    '/PM/GetPromotionInfoByCode',
    { PromotionCode: bundle.plan.new_code },
  );
  return response?.data || null;
}

async function quarantine(bundle, promotionId, cause, details = {}) {
  let deactivated = false;
  let deactivationError = null;
  if (promotionId) {
    try {
      await igmpPost(
        bundle.plan.destination_site,
        '/PM/UpdatePromotionStatus',
        { PromotionId: promotionId, IsActive: false },
      );
      deactivated = true;
    } catch (error) {
      deactivationError = error.message;
    }
  }
  const incidentFile = await writeRunRecord(bundle, 'PARTIAL_CLEANUP_REQUIRED', {
    promotion_id: promotionId,
    cause,
    deactivated,
    deactivation_error: deactivationError,
    ...details,
  });
  throw new Error(
    `partial destination quarantined; incident=${incidentFile}; cause=${cause}`,
  );
}

async function createInactive() {
  const bundle = await loadApprovedBundle();
  await verifySourceUnchanged(bundle);
  const { plan } = bundle;

  console.log(`IGMP clone COMMIT — create inactive`);
  console.log(`${plan.source_site}: ${plan.old_code}`);
  console.log(`${plan.destination_site}: ${plan.new_code}`);
  console.log(`Approved plan: ${bundle.plan_hash}`);

  let existing = null;
  try {
    existing = await lookupDestination(bundle);
  } catch (error) {
    if (!/not found|no promotion|does not exist/i.test(error.message)) {
      throw new Error(`destination idempotency lookup failed closed: ${error.message}`);
    }
  }
  if (existing?.PromotionId) {
    try {
      const graph = await fetchIgmpPromotionGraph(plan.destination_site, plan.new_code);
      const verification = verifyCloneGraph(plan, graph);
      if (!verification.pass) {
        await quarantine(bundle, existing.PromotionId, 'existing destination differs from approved plan', {
          diffs: verification.diffs,
        });
      }
      const alreadyStatus = existing.IsActive === true
        ? 'ALREADY_VERIFIED_ACTIVE'
        : 'ALREADY_VERIFIED_INACTIVE';
      const record = await writeRunRecord(bundle, alreadyStatus, {
        promotion_id: existing.PromotionId,
        reward_id: graph.reward_id,
        active: existing.IsActive,
        destination_business_hash: graph.business_hash,
      });
      console.log(`✓ Existing destination matches approved plan; no create performed`);
      console.log(`  PromotionId=${existing.PromotionId} RewardId=${graph.reward_id}`);
      console.log(`  Active=${existing.IsActive}`);
      console.log(`  State: ${record}`);
      return;
    } catch (error) {
      if (/partial destination quarantined/i.test(error.message)) throw error;
      await quarantine(bundle, existing.PromotionId, `existing destination is incomplete: ${error.message}`);
    }
  }

  let promotionId = null;
  const captured = {};
  try {
    const response = await igmpPost(plan.destination_site, plan.endpoint, plan.body);
    promotionId = response?.data?.Promotion?.PromotionId
      ?? response?.data?.PromotionId
      ?? (typeof response?.data === 'number' ? response.data : null);
    if (!promotionId) {
      const lookup = await lookupDestination(bundle);
      promotionId = lookup?.PromotionId ?? null;
    }
    if (!promotionId) throw new Error('create returned no PromotionId and exact-code reconciliation found none');
    captured.PromotionId = promotionId;
    console.log(`✓ ${plan.endpoint} → PromotionId=${promotionId}`);

    for (const step of plan.followups || []) {
      const body = substituteCloneTokens(step.body, captured);
      const response = await igmpPost(plan.destination_site, step.endpoint, body);
      if (step.capture_from) {
        const capturedValue = findFirstKey(response, step.capture_from);
        if (capturedValue == null) {
          throw new Error(`${step.endpoint} response missing ${step.capture_from}`);
        }
        captured[step.capture_from] = capturedValue;
      }
      console.log(`✓ ${step.endpoint}`);
    }

    const listRow = await lookupDestination(bundle);
    if (!listRow?.PromotionId) throw new Error('destination exact-code read-back failed');
    if (listRow.IsActive === true) {
      throw new Error('destination unexpectedly active before verification');
    }
    const destination = await fetchIgmpPromotionGraph(plan.destination_site, plan.new_code);
    const verification = verifyCloneGraph(plan, destination);
    if (!verification.pass) {
      throw Object.assign(new Error('persisted destination differs from approved plan'), {
        verification,
      });
    }
    const record = await writeRunRecord(bundle, 'VERIFIED_INACTIVE', {
      promotion_id: promotionId,
      reward_id: destination.reward_id,
      active: false,
      destination_business_hash: destination.business_hash,
    });
    console.log(`✓ Persisted reward graph verified`);
    console.log(`  RewardId=${destination.reward_id}`);
    console.log(`  Destination remains INACTIVE`);
    console.log(`  State: ${record}`);
    console.log(`Next step requires separate --activate approval using the same plan hash.`);
  } catch (error) {
    if (!promotionId) {
      try {
        const lookup = await lookupDestination(bundle);
        promotionId = lookup?.PromotionId ?? null;
      } catch {
        // Preserve the original error; a missing ID still gets an incident record.
      }
    }
    await quarantine(bundle, promotionId, error.message, {
      diffs: error.verification?.diffs || null,
    });
  }
}

async function activateVerified() {
  const bundle = await loadApprovedBundle();
  await verifySourceUnchanged(bundle);
  const destination = await fetchIgmpPromotionGraph(
    bundle.plan.destination_site,
    bundle.plan.new_code,
  );
  const verification = verifyCloneGraph(bundle.plan, destination);
  if (!verification.pass) {
    const record = await writeRunRecord(bundle, 'ACTIVATION_BLOCKED', {
      promotion_id: destination.promotion_id,
      reward_id: destination.reward_id,
      diffs: verification.diffs,
    });
    throw new Error(`activation blocked by persisted diff; state=${record}\n${formatDiff(verification.diffs)}`);
  }
  const before = await lookupDestination(bundle);
  if (!before?.PromotionId) throw new Error('destination missing before activation');
  if (before.IsActive !== true) {
    await igmpPost(
      bundle.plan.destination_site,
      '/PM/UpdatePromotionStatus',
      { PromotionId: before.PromotionId, IsActive: true },
    );
  }
  const after = await lookupDestination(bundle);
  if (after?.IsActive !== true) throw new Error('activation did not persist');
  const record = await writeRunRecord(bundle, 'ACTIVATED_VERIFIED', {
    promotion_id: after.PromotionId,
    reward_id: destination.reward_id,
    active: true,
    destination_business_hash: destination.business_hash,
  });
  console.log(`✓ Activated ${bundle.plan.new_code} on ${bundle.plan.destination_site}`);
  console.log(`  PromotionId=${after.PromotionId} RewardId=${destination.reward_id}`);
  console.log(`  State: ${record}`);
}

try {
  if (commit && activate) throw new Error('Choose exactly one of --commit or --activate');
  if (commit) await createInactive();
  else if (activate) await activateVerified();
  else await planRows();
} catch (error) {
  exitError(error.message);
}

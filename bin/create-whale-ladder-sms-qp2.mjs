#!/usr/bin/env node
// Create SMS (section=8 type=2) message templates for July Whale-Probe Ladder
// QP2 codes (ibc22 only). QPRO to follow separately.
//
// After creation, links each SMS MT to its promotion via message_template_sms_id.
//
// Usage:
//   node bin/create-whale-ladder-sms-qp2.mjs          # dry-run
//   node bin/create-whale-ladder-sms-qp2.mjs --commit  # live write

import { parseArgs } from './_args.js';
import { authedFetch, createMessageTemplate, findPromotionByCode, updatePromotion } from '../src/api-client.js';
import { buildApiPlan } from '../src/api-mapper-qp2.js';
import { loadAllRequests, resolveDuplicates, resolveHandle } from '../src/planner.js';
import { getSite } from '../src/sites.js';

const { flags } = parseArgs(process.argv.slice(2));
const COMMIT = flags.commit === true;
if (!COMMIT) console.log('[DRY RUN] Pass --commit to execute\n');

const site = getSite('ibc22');

// Locale IDs
const MY_EN = 1, MY_ZH = 3, SG_EN = 6, SG_ZH = 7;

// ── Promo definitions ──────────────────────────────────────────────────────
const PROMOS = [
  // Free Spins
  {
    handle: 'P065-r66',
    code: 'WHALE_CRM_PROBE_GOO50FS_10X_6K',
    type: 'fs',
    en: { spins: 50, minDep: 'RM6k', spinVal: 'RM50', to: '10x', maxWd: 'RM30k' },
    zh: { spins: 50, minDep: 'RM6k', spinVal: 'RM50', to: '10', maxWd: 'RM30k' },
  },
  {
    handle: 'P066-r67',
    code: 'WHALE_CRM_PROBE_GOO60FS_12X',
    type: 'fs',
    en: { spins: 60, minDep: 'RM3k', spinVal: 'RM25', to: '12x', maxWd: 'RM15k' },
    zh: { spins: 60, minDep: 'RM3k', spinVal: 'RM25', to: '12', maxWd: 'RM15k' },
  },
  {
    handle: 'P067-r68',
    code: 'WHALE_CRM_PROBE_GOO75FS_12X',
    type: 'fs',
    en: { spins: 75, minDep: 'RM1.5k', spinVal: 'RM10', to: '12x', maxWd: 'RM7.5k' },
    zh: { spins: 75, minDep: 'RM1.5k', spinVal: 'RM10', to: '12', maxWd: 'RM7.5k' },
  },
  {
    handle: 'P068-r69',
    code: 'WHALE_CRM_PROBE_GOO100FS_12X',
    type: 'fs',
    en: { spins: 100, minDep: 'RM1k', spinVal: 'RM5', to: '12x', maxWd: 'RM5k' },
    zh: { spins: 100, minDep: 'RM1k', spinVal: 'RM5', to: '12', maxWd: 'RM5k' },
  },
  // Deposit Reload
  {
    handle: 'P069-r70',
    code: 'WHALE_CRM_PROBE_DEP50PCT_3K_10X',
    type: 'dep',
    en: { minDep: 'RM6k', maxBns: 'RM3k', to: '10x' },
    zh: { minDep: 'RM6k', maxBns: 'RM3k', to: '10' },
  },
  {
    handle: 'P070-r71',
    code: 'WHALE_CRM_PROBE_DEP50PCT_1500_12X',
    type: 'dep',
    en: { minDep: 'RM3k', maxBns: 'RM1.5k', to: '12x' },
    zh: { minDep: 'RM3k', maxBns: 'RM1.5k', to: '12' },
  },
  {
    handle: 'P071-r72',
    code: 'WHALE_CRM_PROBE_DEP50PCT_750_12X',
    type: 'dep',
    en: { minDep: 'RM1.5k', maxBns: 'RM750', to: '12x' },
    zh: { minDep: 'RM1.5k', maxBns: 'RM750', to: '12' },
  },
  {
    handle: 'P072-r73',
    code: 'WHALE_CRM_PROBE_DEP50PCT_500_12X',
    type: 'dep',
    en: { minDep: 'RM1k', maxBns: 'RM500', to: '12x' },
    zh: { minDep: 'RM1k', maxBns: 'RM500', to: '12' },
  },
];

// ── Body builders ──────────────────────────────────────────────────────────
function fsDetails(p) {
  const { en } = p;
  const msg = `:merchantname: Get ${en.spins} FS with ${en.minDep} dep. ${en.spinVal}/spin | ${en.to} TO | Max WD ${en.maxWd}. :url`;
  const subj = `VIP Exclusive — ${en.spins} Free Spins`;
  return {
    [MY_EN]: { settings_locale_id: MY_EN, subject: subj, message: msg },
    [MY_ZH]: { settings_locale_id: MY_ZH, subject: subj, message: msg },
    [SG_EN]: { settings_locale_id: SG_EN, subject: subj, message: msg },
    [SG_ZH]: { settings_locale_id: SG_ZH, subject: subj, message: msg },
  };
}

function depDetails(p) {
  const { en } = p;
  const msg = `:merchantname: Get 50% reload up to ${en.maxBns} with ${en.minDep} dep. ${en.to} TO. :url`;
  const subj = `VIP Exclusive — 50% Reload Bonus`;
  return {
    [MY_EN]: { settings_locale_id: MY_EN, subject: subj, message: msg },
    [MY_ZH]: { settings_locale_id: MY_ZH, subject: subj, message: msg },
    [SG_EN]: { settings_locale_id: SG_EN, subject: subj, message: msg },
    [SG_ZH]: { settings_locale_id: SG_ZH, subject: subj, message: msg },
  };
}

// ── Main ───────────────────────────────────────────────────────────────────
const { byHandle, byCode } = await loadAllRequests();
const results = [];

for (const promo of PROMOS) {
  const details = promo.type === 'fs' ? fsDetails(promo) : depDetails(promo);
  const enMsg = details[MY_EN].message;
  console.log(`\n── ${promo.code} ──`);
  console.log(`  EN: ${enMsg}`);

  let mtId = null;

  if (!COMMIT) {
    console.log(`  [DRY RUN] Would create SMS MT + link to promotion`);
    results.push({ code: promo.code, dry: true });
    continue;
  }

  // Step 1: Create SMS MT
  try {
    const body = {
      name: `SMS ${promo.code}`,
      section: 8,
      type: 2,
      status: 1,
      details,
      code: `PROMOTIONS.SMS.${promo.code}`,
    };
    const res = await createMessageTemplate(site, body);
    mtId = res?.data?.rows?.id ?? res?.rows?.id ?? res?.id;
    if (!mtId) throw new Error(`No MT id in response: ${JSON.stringify(res).slice(0, 150)}`);
    console.log(`  ✓ SMS MT created  id=${mtId}`);
  } catch (e) {
    console.error(`  ✗ MT create failed: ${e.message.slice(0, 120)}`);
    results.push({ code: promo.code, error: e.message });
    continue;
  }

  // Step 2: Link SMS MT to promotion via message_template_sms_id
  try {
    const handle = resolveHandle(promo.handle, { byHandle, byId: new Map(), byCode });
    const request = byHandle.get(handle);
    if (!request) throw new Error(`fixture ${promo.handle} not found`);
    const resolved = await resolveDuplicates(request, byCode, {});

    const existing = await findPromotionByCode(site, promo.code, { merchantId: 1 });
    if (!existing) throw new Error(`promo ${promo.code} not found on ibc22`);

    const detailRes = await authedFetch(site, `/api/bo/promotion/${existing.id}`);
    const detailRow = detailRes?.data?.rows;
    const templateId = detailRow?.message_template_id || 0;
    const merchantIds = (detailRow?.merchant_ids || []).map((m) => typeof m === 'object' ? m.id : m);

    const plan = await buildApiPlan(resolved, { brand: 'QP2A', site, merchantIds });
    const putBody = plan.buildUpdate(existing.id, templateId, null);

    // Preserve merchant_ids
    const mObj = {};
    merchantIds.forEach((id, i) => { mObj[String(i)] = id; });
    putBody.merchant_ids = mObj;

    // Preserve dialog_popup_list
    const listRes = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(promo.code)}&perPage=10`);
    const listRow = (listRes?.data?.rows || []).find((r) => r.id === existing.id);
    if (Array.isArray(listRow?.dialog_popup_list) && listRow.dialog_popup_list.length) {
      const dl = {};
      listRow.dialog_popup_list.forEach((d, i) => { dl[String(i)] = d; });
      putBody.dialog_popup_list = dl;
    }

    // Set SMS template ID
    putBody.message_template_sms_id = mtId;

    await updatePromotion(site, existing.id, putBody);

    // Verify
    const verify = await authedFetch(site, `/api/bo/promotion/${existing.id}`);
    const linked = verify?.data?.rows?.message_template_sms_id;
    if (Number(linked) === mtId) {
      console.log(`  ✓ Linked to promo ${existing.id}  message_template_sms_id=${linked}`);
    } else {
      console.log(`  ⚠ Link verify: expected ${mtId}, got ${linked}`);
    }

    results.push({ code: promo.code, mtId, promoId: existing.id });
  } catch (e) {
    console.error(`  ✗ Link failed: ${e.message.slice(0, 120)}`);
    results.push({ code: promo.code, mtId, linkError: e.message });
  }
}

// ── Summary ────────────────────────────────────────────────────────────────
console.log('\n── Summary ──');
if (!COMMIT) {
  console.log(`[DRY RUN] ${PROMOS.length} SMS templates would be created and linked`);
} else {
  const ok  = results.filter((r) => r.mtId && !r.linkError).length;
  const partial = results.filter((r) => r.mtId && r.linkError).length;
  const err = results.filter((r) => r.error).length;
  console.log(`✓ Full success: ${ok}  ⚠ MT created but link failed: ${partial}  ✗ Errors: ${err}`);
  results.forEach((r) => {
    if (r.error) console.log(`  ✗ ${r.code}: ${r.error}`);
    if (r.linkError) console.log(`  ⚠ ${r.code} MT#${r.mtId} link failed: ${r.linkError}`);
  });
}

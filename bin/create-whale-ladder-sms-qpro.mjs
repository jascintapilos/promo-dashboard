#!/usr/bin/env node
// Create SMS (section=8 type=2) message templates for July Whale-Probe Ladder
// QPRO sites (qpro1–qpro10, qpro15, qpro16). All 8 promos × 12 sites.
//
// After creation, links each SMS MT to its promotion via message_template_sms_id,
// preserving the existing dialog popup via buildApiPlan + buildUpdate.
//
// Usage:
//   node bin/create-whale-ladder-sms-qpro.mjs          # dry-run
//   node bin/create-whale-ladder-sms-qpro.mjs --commit  # live write

import { parseArgs } from './_args.js';
import { authedFetch, createMessageTemplate, findPromotionByCode, updatePromotion, getPopupDetail } from '../src/api-client.js';
import { buildApiPlan } from '../src/api-mapper-qpro.js';
import { loadAllRequests, resolveDuplicates, resolveHandle } from '../src/planner.js';
import { getSite } from '../src/sites.js';

const { flags } = parseArgs(process.argv.slice(2));
const COMMIT = flags.commit === true;
if (!COMMIT) console.log('[DRY RUN] Pass --commit to execute\n');

// Locale IDs
const MY_EN = 1, MY_ZH = 3, SG_EN = 6, SG_ZH = 7;

const QPRO_SITES = [
  'qpro1','qpro2','qpro3','qpro4','qpro5','qpro6',
  'qpro7','qpro8','qpro9','qpro10','qpro15','qpro16',
];

// ── Promo definitions ──────────────────────────────────────────────────────
const PROMOS = [
  // Free Spins
  {
    handle: 'P065-r66',
    code: 'WHALE_CRM_PROBE_GOO50FS_10X_6K',
    type: 'fs',
    en: { spins: 50, minDep: 'RM6k', spinVal: 'RM50', to: '10x', maxWd: 'RM30k' },
  },
  {
    handle: 'P066-r67',
    code: 'WHALE_CRM_PROBE_GOO60FS_12X',
    type: 'fs',
    en: { spins: 60, minDep: 'RM3k', spinVal: 'RM25', to: '12x', maxWd: 'RM15k' },
  },
  {
    handle: 'P067-r68',
    code: 'WHALE_CRM_PROBE_GOO75FS_12X',
    type: 'fs',
    en: { spins: 75, minDep: 'RM1.5k', spinVal: 'RM10', to: '12x', maxWd: 'RM7.5k' },
  },
  {
    handle: 'P068-r69',
    code: 'WHALE_CRM_PROBE_GOO100FS_12X',
    type: 'fs',
    en: { spins: 100, minDep: 'RM1k', spinVal: 'RM5', to: '12x', maxWd: 'RM5k' },
  },
  // Deposit Reload
  {
    handle: 'P069-r70',
    code: 'WHALE_CRM_PROBE_DEP50PCT_3K_10X',
    type: 'dep',
    en: { minDep: 'RM6k', maxBns: 'RM3k', to: '10x' },
  },
  {
    handle: 'P070-r71',
    code: 'WHALE_CRM_PROBE_DEP50PCT_1500_12X',
    type: 'dep',
    en: { minDep: 'RM3k', maxBns: 'RM1.5k', to: '12x' },
  },
  {
    handle: 'P071-r72',
    code: 'WHALE_CRM_PROBE_DEP50PCT_750_12X',
    type: 'dep',
    en: { minDep: 'RM1.5k', maxBns: 'RM750', to: '12x' },
  },
  {
    handle: 'P072-r73',
    code: 'WHALE_CRM_PROBE_DEP50PCT_500_12X',
    type: 'dep',
    en: { minDep: 'RM1k', maxBns: 'RM500', to: '12x' },
  },
];

// ── Body builders ──────────────────────────────────────────────────────────
function buildDetails(promo) {
  let msg, subj;
  if (promo.type === 'fs') {
    const { spins, minDep, spinVal, to, maxWd } = promo.en;
    msg  = `:brandname: Get ${spins} FS with ${minDep} dep. ${spinVal}/spin | ${to} TO | Max WD ${maxWd}. :url`;
    subj = `VIP Exclusive — ${spins} Free Spins`;
  } else {
    const { minDep, maxBns, to } = promo.en;
    msg  = `:brandname: Get 50% reload up to ${maxBns} with ${minDep} dep. ${to} TO. :url`;
    subj = `VIP Exclusive — 50% Reload Bonus`;
  }
  // All 4 locales use same EN content (no ZH translation)
  return {
    [MY_EN]: { settings_locale_id: MY_EN, subject: subj, message: msg },
    [MY_ZH]: { settings_locale_id: MY_ZH, subject: subj, message: msg },
    [SG_EN]: { settings_locale_id: SG_EN, subject: subj, message: msg },
    [SG_ZH]: { settings_locale_id: SG_ZH, subject: subj, message: msg },
  };
}

// ── Main ───────────────────────────────────────────────────────────────────
const { byHandle, byCode } = await loadAllRequests();

const summary = [];   // { siteId, code, mtId, promoId, error, linkError }
let totalOk = 0, totalPartial = 0, totalErr = 0;

for (const siteId of QPRO_SITES) {
  const site  = getSite(siteId);
  const brand = siteId.toUpperCase();   // qpro1 → QPRO1
  console.log(`\n══ ${brand} ══`);

  for (const promo of PROMOS) {
    const details = buildDetails(promo);
    console.log(`\n  ── ${promo.code} ──`);
    console.log(`     ${details[MY_EN].message}`);

    if (!COMMIT) {
      console.log(`     [DRY RUN] Would create SMS MT + link`);
      summary.push({ siteId, code: promo.code, dry: true });
      continue;
    }

    // ── Step 1: Create SMS MT ────────────────────────────────────────────
    let mtId = null;
    try {
      const body = {
        name:    `SMS ${promo.code}`,
        section: 8,
        type:    2,
        status:  1,
        details,
        code:    `PROMOTIONS.SMS.${promo.code}`,
      };
      const res = await createMessageTemplate(site, body);
      mtId = res?.data?.rows?.id ?? res?.rows?.id ?? res?.id;
      if (!mtId) throw new Error(`No MT id: ${JSON.stringify(res).slice(0, 120)}`);
      console.log(`     ✓ SMS MT id=${mtId}`);
    } catch (e) {
      console.error(`     ✗ MT create: ${e.message.slice(0, 100)}`);
      summary.push({ siteId, code: promo.code, error: e.message });
      totalErr++;
      continue;
    }

    // ── Step 2: Find promotion + existing template/dialog ────────────────
    let promoId = null, templateId = 0, existingPopup = null;
    try {
      const listRes = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(promo.code)}&perPage=10`);
      const listRow = (listRes?.data?.rows || []).find((r) => r.code === promo.code);
      if (!listRow) throw new Error(`promo ${promo.code} not found on ${siteId}`);

      promoId    = listRow.id;
      templateId = listRow.message_template_id || 0;

      // Preserve existing dialog popup
      const popupEntry = Array.isArray(listRow.dialog_popup_list) && listRow.dialog_popup_list[0];
      if (popupEntry?.popup_id) {
        const popup = await getPopupDetail(site, popupEntry.popup_id);
        if (popup?.id) existingPopup = popup;
      }
    } catch (e) {
      console.error(`     ✗ Promo fetch: ${e.message.slice(0, 100)}`);
      summary.push({ siteId, code: promo.code, mtId, linkError: e.message });
      totalPartial++;
      continue;
    }

    // ── Step 3: Build update body via QPRO mapper ────────────────────────
    try {
      const handle   = resolveHandle(promo.handle, { byHandle, byId: new Map(), byCode });
      const request  = byHandle.get(handle);
      if (!request) throw new Error(`fixture ${promo.handle} not found`);
      const resolved = await resolveDuplicates(request, byCode, {});

      const plan    = await buildApiPlan(resolved, { brand, site });
      const putBody = plan.buildUpdate(promoId, templateId, existingPopup);

      // Set SMS template ID
      putBody.message_template_sms_id = mtId;

      await updatePromotion(site, promoId, putBody);

      // Verify
      const verifyRes  = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(promo.code)}&perPage=10`);
      const verifyRow  = (verifyRes?.data?.rows || []).find((r) => r.id === promoId);
      const linkedSmsId = verifyRow?.message_template_sms_id;
      if (Number(linkedSmsId) === mtId) {
        console.log(`     ✓ Linked  promo=${promoId}  sms_mt=${linkedSmsId}`);
        summary.push({ siteId, code: promo.code, mtId, promoId });
        totalOk++;
      } else {
        console.log(`     ⚠ Link verify: expected ${mtId}, got ${linkedSmsId}`);
        summary.push({ siteId, code: promo.code, mtId, promoId, linkError: `sms_id mismatch: got ${linkedSmsId}` });
        totalPartial++;
      }
    } catch (e) {
      console.error(`     ✗ Link: ${e.message.slice(0, 100)}`);
      summary.push({ siteId, code: promo.code, mtId, promoId, linkError: e.message });
      totalPartial++;
    }
  }
}

// ── Summary ────────────────────────────────────────────────────────────────
console.log('\n── Summary ──');
if (!COMMIT) {
  console.log(`[DRY RUN] ${QPRO_SITES.length * PROMOS.length} SMS templates would be created and linked`);
} else {
  console.log(`✓ Full success: ${totalOk}  ⚠ MT created but link failed: ${totalPartial}  ✗ Errors: ${totalErr}`);
  const failures = summary.filter((r) => r.error || r.linkError);
  failures.forEach((r) => {
    if (r.error)     console.log(`  ✗ ${r.siteId} ${r.code}: ${r.error}`);
    if (r.linkError) console.log(`  ⚠ ${r.siteId} ${r.code} MT#${r.mtId} link: ${r.linkError}`);
  });
}

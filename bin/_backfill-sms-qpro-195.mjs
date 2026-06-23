// Backfill SMS templates onto the 195 P124-P163 saves on QPRO3/4/6/8/10.
//
// Step A — PARALLEL: For each of 5 QPRO brands, create 2 SMS templates
// (Silver/VIP variant = QP2D template 913; Bronze variant = QP2D 914).
// Idempotent: if a template with the same code already exists on the brand,
// reuses its id instead of creating a duplicate.
//
// Step B — PARALLEL (concurrency 20): For each of 195 promotions, PUT
// /api/bo/promotion/{id} with message_template_sms_id set to the correct
// brand-local template id (Silver vs Bronze classified by the source's
// QP2D sms_template_id of 913 vs 914).
//
// Default = dry-run; pass --commit to actually send POSTs + PUTs.

import fs from 'node:fs';
import { authedFetch, createMessageTemplate, updatePromotion } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const commit = process.argv.includes('--commit');

const probe = JSON.parse(fs.readFileSync('captures/api-runs/qp2d-sms-probe.json', 'utf8'));
const inventory = JSON.parse(fs.readFileSync('captures/api-runs/orphan-inventory-p124-163.json', 'utf8'));

// Build code → "silver" | "bronze" classification from QP2D source.
const codeToTier = new Map();
for (const c of probe.codeInfo) {
  if (c.sms_template_id === 913) codeToTier.set(c.code, 'silver');
  else if (c.sms_template_id === 914) codeToTier.set(c.code, 'bronze');
}

// Template bodies from QP2D probe — locale_id keyed details.
const SILVER_TPL = probe.templates.find(t => t.id === 913)?.details || {};
const BRONZE_TPL = probe.templates.find(t => t.id === 914)?.details || {};

function buildTemplateBody(name, code, sourceDetails) {
  // Convert source details (locale_id → {subject, message, ...}) into the
  // POST shape. BO wants settings_locale_id explicitly inside each entry.
  const details = {};
  for (const [localeId, d] of Object.entries(sourceDetails)) {
    details[localeId] = {
      subject: d.subject,
      message: d.message,
      settings_locale_id: Number(localeId),
    };
  }
  return {
    name,
    code,
    section: 8,    // Promotions
    type: 2,       // SMS
    status: 1,
    details,
  };
}

const SILVER_BODY = buildTemplateBody('FT_REL_TLEO_Generic', 'PROMOTIONS.SMS.FT_REL_TLEO_GENERIC', SILVER_TPL);
const BRONZE_BODY = buildTemplateBody('FT_REL_TLEO_Generic_BR', 'PROMOTIONS.SMS.FT_REL_TLEO_GENERIC_BR', BRONZE_TPL);

const BRANDS = ['QPRO3', 'QPRO4', 'QPRO6', 'QPRO8', 'QPRO10'];
const BRAND_TO_SITE = { QPRO3: 'qpro3', QPRO4: 'qpro4', QPRO6: 'qpro6', QPRO8: 'qpro8', QPRO10: 'qpro10' };

// Tally inventory
const silverCount = inventory.filter(o => codeToTier.get(o.code) === 'silver').length;
const bronzeCount = inventory.filter(o => codeToTier.get(o.code) === 'bronze').length;
const noTier = inventory.filter(o => !codeToTier.get(o.code));
console.log(`Inventory: ${inventory.length} orphans  silver=${silverCount}  bronze=${bronzeCount}  unclassified=${noTier.length}`);
if (noTier.length) {
  console.log('  ⚠ unclassified codes (no QP2D SMS template):');
  [...new Set(noTier.map(o => o.code))].forEach(c => console.log(`    ${c}`));
}

console.log(`\nMode: ${commit ? 'LIVE (--commit)' : 'DRY-RUN'}`);
console.log('━━━━━━━━━━ Step A: ensure SMS templates per brand ━━━━━━━━━━');

async function ensureTemplate(brand, body) {
  const site = getSite(BRAND_TO_SITE[brand]);
  try {
    const search = await authedFetch(site, `/api/bo/messagetemplate?code=${encodeURIComponent(body.code)}&perPage=5`);
    const existing = (search?.data?.rows || []).find(r => r.code === body.code && r.type == 2);
    if (existing) return { brand, code: body.code, action: 'REUSED', template_id: existing.id };
  } catch {}
  if (!commit) return { brand, code: body.code, action: 'DRY_RUN_POST' };
  try {
    const res = await createMessageTemplate(site, body);
    const id = res?.data?.rows?.id ?? res?.data?.id ?? null;
    return { brand, code: body.code, action: 'CREATED', template_id: id };
  } catch (e) {
    return { brand, code: body.code, action: 'FAILED', error: e.message.slice(0, 200) };
  }
}

const templateTasks = [];
for (const brand of BRANDS) {
  templateTasks.push(ensureTemplate(brand, SILVER_BODY));
  templateTasks.push(ensureTemplate(brand, BRONZE_BODY));
}
const templateResults = await Promise.all(templateTasks);
for (const r of templateResults) console.log(`  ${r.brand}  ${r.code}  → ${r.action}${r.template_id ? ` (id=${r.template_id})` : ''}${r.error ? ` ${r.error}` : ''}`);

// Build brand → tier → template_id map
const brandTplMap = {};
for (const r of templateResults) {
  if (!brandTplMap[r.brand]) brandTplMap[r.brand] = {};
  const tier = r.code.endsWith('_BR') ? 'bronze' : 'silver';
  if (r.template_id) brandTplMap[r.brand][tier] = r.template_id;
}

console.log('\n━━━━━━━━━━ Step B: link 195 promos to their SMS templates (parallel) ━━━━━━━━━━');

async function linkOne(orph) {
  const tier = codeToTier.get(orph.code);
  if (!tier) return { ...orph, action: 'SKIP_NO_TIER' };
  const site = getSite(BRAND_TO_SITE[orph.brand]);
  const smsId = brandTplMap[orph.brand]?.[tier];
  if (!smsId) {
    // Dry-run mode: template not yet created so id unknown — still report plan
    if (!commit) return { ...orph, tier, action: 'DRY_RUN_PUT', sms_template_id: '<pending>' };
    return { ...orph, tier, action: 'FAILED', error: `no ${tier} template id for ${orph.brand}` };
  }
  if (!commit) return { ...orph, tier, action: 'DRY_RUN_PUT', sms_template_id: smsId };
  try {
    // GET current promotion, modify only message_template_sms_id, PUT.
    const det = await authedFetch(site, `/api/bo/promotion/${orph.promotion_id}`);
    const row = det.data.rows;
    if (row.message_template_sms_id === smsId) {
      return { ...orph, tier, action: 'ALREADY_LINKED', sms_template_id: smsId };
    }
    // Build PUT body — same pattern as the QPRO2 bonus_rate fix.
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
      message_template_sms_id: smsId,    // ← THE CHANGE
      dialog_popup_list: row.dialog_popup_list || [],
    };
    await updatePromotion(site, orph.promotion_id, body);
    return { ...orph, tier, action: 'LINKED', sms_template_id: smsId };
  } catch (e) {
    return { ...orph, tier, action: 'FAILED', error: e.message.slice(0, 200) };
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
      if (done % 25 === 0) process.stderr.write(`  ${done}/${items.length}\n`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

const t0 = Date.now();
const linkResults = await runBatched(inventory, linkOne, 20);
const dur = ((Date.now() - t0) / 1000).toFixed(1);

const tally = { LINKED: 0, ALREADY_LINKED: 0, DRY_RUN_PUT: 0, SKIP_NO_TIER: 0, FAILED: 0 };
for (const r of linkResults) tally[r.action] = (tally[r.action] || 0) + 1;
console.log(`\nLink step done in ${dur}s`);
console.log('Tally:', JSON.stringify(tally));

const fails = linkResults.filter(r => r.action === 'FAILED');
if (fails.length) {
  console.log('\nFailures:');
  fails.slice(0, 10).forEach(r => console.log(`  ${r.rn} ${r.brand} id=${r.promotion_id} — ${r.error}`));
}

fs.writeFileSync(`captures/api-runs/sms-backfill-${commit ? 'commit' : 'dryrun'}.json`, JSON.stringify({
  generated: new Date().toISOString(), mode: commit ? 'live' : 'dryrun',
  templateResults, linkResults, tally,
}, null, 2));
console.log(`\nReport → captures/api-runs/sms-backfill-${commit ? 'commit' : 'dryrun'}.json`);

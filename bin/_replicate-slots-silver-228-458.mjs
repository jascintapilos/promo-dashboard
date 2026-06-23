#!/usr/bin/env node
// Replicate FT_REL_TLEO_45PCT_228MX and FT_REL_TLEO_45PCT_458MX
// from QPRO2 → QPRO3/4/6/8/10 + WS1 MY.
// Source: QPRO2 id=422 (228MX), id=423 (458MX)
//
// Usage:
//   node bin/_replicate-slots-silver-228-458.mjs --dry-run
//   node bin/_replicate-slots-silver-228-458.mjs --commit

import { parseArgs } from './_args.js';
import { authedFetch, createPromotion, addPromotionName, createMessageTemplate, updatePromotion, findPromotionByCode } from '../src/api-client.js';
import { igmpPost, igmpBaseUrl } from '../src/igmp-client.js';
import { buildIgmpPlan } from '../src/api-mapper-igmp.js';
import { getSite } from '../src/sites.js';

const { flags } = parseArgs(process.argv.slice(2));
const commit = flags.commit === true;
const dryRun = !commit;

if (dryRun) console.log('\n[DRY-RUN] — pass --commit to save\n');

const arrayToIntObj = (arr) => Object.fromEntries(arr.map((id, i) => [String(i), id]));
const isoToYmdHms  = (iso)  => { const m = String(iso).match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/); return m ? `${m[1]} ${m[2]}` : iso; };
const nowYmdHms    = ()     => new Date().toISOString().slice(0, 19).replace('T', ' ');

// Source codes
const SOURCES = [
  { code: 'FT_REL_TLEO_45PCT_228MX', srcId: 422, mtSrcId: 354, minMyr: 500, maxMyr: 228, minSgd: 500, maxSgd: 228 },
  { code: 'FT_REL_TLEO_45PCT_458MX', srcId: 423, mtSrcId: 355, minMyr: 1000, maxMyr: 458, minSgd: 1000, maxSgd: 458 },
];

const QPRO_TARGETS = ['qpro3','qpro4','qpro6','qpro8','qpro10'];
const WS1_SITE     = 'ws1-v3-my';
const site2        = getSite('qpro2');

// ── Step 1: Build QPRO2 provider name lookup ──────────────────────────────
const gpRes2 = await authedFetch(site2, '/api/bo/gameprovider?perPage=200');
const q2Providers = gpRes2.data?.rows || [];
const q2Id2Name = Object.fromEntries(q2Providers.map(p => [p.id, p.name]));

// ── Step 2: For each source code, load full source data from QPRO2 ────────
const sourceData = {};
for (const src of SOURCES) {
  const det = await authedFetch(site2, `/api/bo/promotion/${src.srcId}`);
  const d = det.data.rows;
  const mt = await authedFetch(site2, `/api/bo/messagetemplate/${src.mtSrcId}`);
  sourceData[src.code] = {
    src,
    det: d,
    gpIds: d.target?.[0]?.game_provider_ids || [],
    gpNames: (d.target?.[0]?.game_provider_ids || []).map(id => q2Id2Name[id]).filter(Boolean),
    mt: mt.data?.message_details || {},
    mtTmpl: mt.data?.message_template,
    blsc: d.blacklist_sub_categories || [],
    categories: (d.promotion_category || []).map(c => c.category_id),
    multiplier: d.target?.[0]?.multiplier ?? 3,
    bonusRate: Number(d.bonus_rate) || 45,
    name: d.name,
  };
  console.log(`Source ${src.code}: gpIds=${sourceData[src.code].gpIds.length} gpNames=${sourceData[src.code].gpNames.length} blsc=${sourceData[src.code].blsc.length}`);
}

// ── Helper: QPRO create one code on one brand ─────────────────────────────
async function createQpro(brandId, src) {
  const sd = sourceData[src.code];
  const site = getSite(brandId);

  // Map QPRO2 gp_ids → target brand ids by name
  const gpResT = await authedFetch(site, '/api/bo/gameprovider?perPage=200');
  const tProviders = gpResT.data?.rows || [];
  const tName2Id = {};
  for (const p of tProviders) {
    if (!tName2Id[p.name]) tName2Id[p.name] = p.id;
  }
  const mappedGpIds = sd.gpNames.map(name => tName2Id[name]).filter(id => id != null);
  const uniqueGpIds = [...new Set(mappedGpIds)];

  // Idempotency
  const existing = await findPromotionByCode(site, src.code);
  if (existing) {
    console.log(`  ${brandId.toUpperCase()} ${src.code}: SKIP (exists id=${existing.id})`);
    return;
  }

  if (dryRun) {
    console.log(`  [DRY] ${brandId.toUpperCase()} ${src.code}: gp_ids=${uniqueGpIds.length} min_myr=${src.minMyr} max_myr=${src.maxMyr}`);
    return;
  }

  // POST promotion
  const promoCurrencies = {
    '0': { currency_id: '1', currency: 'MYR', min_transfer: src.minMyr, max_bonus: src.maxMyr, max_total_applications: 0, max_total_bonus: 0, status: '1', max_transfer_out: 0, promo_type: 2, current_players: 0, used_budget: 0 },
    '1': { currency_id: '3', currency: 'SGD', min_transfer: src.minSgd, max_bonus: src.maxSgd, max_total_applications: 0, max_total_bonus: 0, status: '1', max_transfer_out: 0, promo_type: 2, current_players: 0, used_budget: 0 },
  };
  const promoBody = {
    code: src.code,
    name: sd.name,
    promo_type: sd.det.promo_type,
    promo_sub_type: String(sd.det.promo_sub_type),
    valid_from: nowYmdHms(),
    validity: sd.det.validity,
    reward_validity: sd.det.reward_validity,
    recurring: String(sd.det.recurring),
    reset_frequency: sd.det.reset_frequency ?? 1,
    frequency_type: String(sd.det.frequency_type ?? '1'),
    frequency: sd.det.frequency || [],
    max_per_player: sd.det.max_per_player,
    daily_max: sd.det.daily_max,
    first_deposit: sd.det.first_deposit ?? 0,
    last_deposit: sd.det.last_deposit ?? 1,
    auto_approve: sd.det.auto_approve ? 1 : 0,
    auto_unlock: sd.det.auto_unlock ? 1 : 0,
    allow_cancel: sd.det.allow_cancel ?? 0,
    eligible_types: String(sd.det.eligible_types ?? '1'),
    visible_by_affiliate: sd.det.visible_by_affiliate ?? 0,
    restrict_claim_round_active: sd.det.restrict_claim_round_active ?? 0,
    restrict_same_provider_launch: sd.det.restrict_same_provider_launch ?? 0,
    limit_transfer_in: sd.det.limit_transfer_in ? 1 : 0,
    limit_transfer_out: sd.det.limit_transfer_out ? 1 : 0,
    bonus_rate: sd.bonusRate,
    free_spin_game_provider_id: 0,
    fixed_amount: 0,
    deposit_count: 0,
    message_template_id: 0,
    requires_email:    sd.det.requires_email ?? false,
    requires_mobile:   sd.det.requires_mobile ?? false,
    requires_dob:      sd.det.requires_dob ?? false,
    requires_fullname: sd.det.requires_fullname ?? false,
    transfer_unlock:   sd.det.transfer_unlock ?? false,
    kyc_basic:    sd.det.kyc_basic ?? true,
    kyc_advanced: sd.det.kyc_advanced ?? true,
    kyc_pro:      sd.det.kyc_pro ?? true,
    telemarketer_ids: [],
    normal_account_manager_ids: [],
    vip_account_manager_ids: [],
    game_provider_ids: arrayToIntObj(uniqueGpIds),
    target: { '0': { type: sd.det.target?.[0]?.type ?? 1, multiplier: sd.multiplier, game_provider_ids: arrayToIntObj(uniqueGpIds) } },
    promotion_currency: promoCurrencies,
    promotion_category_turnover: arrayToIntObj(sd.categories),
  };

  const created = await createPromotion(site, promoBody);
  const promoId = created.data?.rows?.id || created.data?.id;
  if (!promoId) throw new Error(`No id: ${JSON.stringify(created).slice(0,200)}`);

  // POST MT (clone from QPRO2)
  const mtRes = await createMessageTemplate(site, {
    code:    `PROMOTIONS.MESSAGE.${src.code}`,
    name:    src.code,
    section: '8',
    type:    '1',
    status:  1,
    details: Object.fromEntries(
      Object.entries(sd.mt).map(([lid, v]) => [lid, { settings_locale_id: Number(lid), subject: v.subject, message: v.message }])
    ),
  });
  const newMtId = mtRes.data?.rows?.id || mtRes.data?.id;

  // POST 4 names
  const nameRows = [
    { promotion_id: promoId, currency_id: 1, settings_locale_id: 1, promotion_name: 'Time Limited Exclusive Offer - 45% Reload Bonus', rewards_name: 'Time Limited Exclusive Offer - 45% Reload Bonus' },
    { promotion_id: promoId, currency_id: 1, settings_locale_id: 3, promotion_name: '限时独家优惠 - 45% 充値奖金', rewards_name: '限时独家优惠 - 45% 充値奖金' },
    { promotion_id: promoId, currency_id: 3, settings_locale_id: 6, promotion_name: 'Time Limited Exclusive Offer - 45% Reload Bonus', rewards_name: 'Time Limited Exclusive Offer - 45% Reload Bonus' },
    { promotion_id: promoId, currency_id: 3, settings_locale_id: 7, promotion_name: '限时独家优惠 - 45% 充値奖金', rewards_name: '限时独家优惠 - 45% 充値奖金' },
  ];
  for (const nb of nameRows) await addPromotionName(site, nb);

  // PUT to link MT (explicit gp_ids to prevent overwrite)
  const det = (await authedFetch(site, `/api/bo/promotion/${promoId}`)).data.rows;
  const putBody = {
    code: det.code, name: det.name,
    free_spin_game_provider_id: det.free_spin_game_provider_id ?? 0,
    promotion_category_turnover: arrayToIntObj((det.promotion_category||[]).map(c => c.category_id)),
    promo_type: det.promo_type, promo_sub_type: String(det.promo_sub_type),
    valid_from: isoToYmdHms(det.valid_from), validity: det.validity, reward_validity: det.reward_validity,
    frequency: det.frequency || [], frequency_type: String(det.frequency_type ?? '1'),
    first_deposit: det.first_deposit ?? 0, last_deposit: det.last_deposit ?? 1,
    auto_approve: det.auto_approve ? 1 : 0, visible_by_affiliate: det.visible_by_affiliate ?? 0,
    recurring: String(det.recurring ?? 0), reset_frequency: det.reset_frequency ?? 1,
    max_per_player: det.max_per_player, daily_max: det.daily_max,
    limit_transfer_in: det.limit_transfer_in ? 1 : 0, limit_transfer_out: det.limit_transfer_out ? 1 : 0,
    restrict_claim_round_active: det.restrict_claim_round_active ?? 0,
    restrict_same_provider_launch: det.restrict_same_provider_launch ?? 0,
    auto_unlock: det.auto_unlock ? 1 : 0, allow_cancel: det.allow_cancel ?? 0,
    fixed_amount: 0, deposit_count: 0,
    game_provider_ids: arrayToIntObj(uniqueGpIds),
    target: { '0': { type: det.target?.[0]?.type ?? 1, multiplier: sd.multiplier, game_provider_ids: arrayToIntObj(uniqueGpIds) } },
    eligible_types: String(det.eligible_types ?? '1'),
    telemarketer_ids: [], normal_account_manager_ids: [], vip_account_manager_ids: [],
    requires_email: det.requires_email ?? false, requires_mobile: det.requires_mobile ?? false,
    requires_dob: det.requires_dob ?? false, requires_fullname: det.requires_fullname ?? false,
    transfer_unlock: det.transfer_unlock ?? false,
    kyc_basic: det.kyc_basic ?? true, kyc_advanced: det.kyc_advanced ?? true, kyc_pro: det.kyc_pro ?? true,
    bonus_rate: sd.bonusRate,
    message_template_id: newMtId,
  };
  await updatePromotion(site, promoId, putBody);

  // Apply blacklist (by provider code, not ID)
  if (sd.blsc.length > 0) {
    const srcMap = {};
    for (const item of sd.blsc) {
      const arr = Array.isArray(item.sub_category_name) ? item.sub_category_name : [item.sub_category_name];
      const deduped = [...new Set(arr.map(s => String(s).toLowerCase()))];
      srcMap[item.game_provider_code] = new Set(deduped);
    }
    const bg = await authedFetch(site, '/api/bo/promotion/blacklistgame', {
      method: 'POST',
      body: { promotion_id: promoId, game_provider_ids: uniqueGpIds, categories: ['SLOTS'] },
    });
    const bgRows = bg.data?.rows || [];
    let marked = 0;
    for (const r of bgRows) {
      const srcSubs = srcMap[r.game_provider_code];
      if (!srcSubs) continue;
      for (const sc of r.sub_categories) {
        if (srcSubs.has(String(sc.name).toLowerCase())) { sc.status = 1; marked++; }
      }
    }
    await authedFetch(site, '/api/bo/promotion/updateblacklistgame', {
      method: 'POST',
      body: { promotion_id: promoId, black_list_sub_categories: bgRows },
    });
    console.log(`  ✓ ${brandId.toUpperCase()} ${src.code}: id=${promoId} MT=${newMtId} gp=${uniqueGpIds.length} bl_marked=${marked}`);
  } else {
    console.log(`  ✓ ${brandId.toUpperCase()} ${src.code}: id=${promoId} MT=${newMtId} gp=${uniqueGpIds.length} (no blacklist)`);
  }
}

// ── Helper: WS1 create one code ──────────────────────────────────────────
async function createWs1(src, sd) {
  // Idempotency
  try {
    const ck = await igmpPost(WS1_SITE, '/PM/GetPromotionInfoByCode', { PromotionCode: src.code });
    if (ck?.data?.PromotionId) {
      console.log(`  WS1 ${src.code}: SKIP (exists id=${ck.data.PromotionId})`);
      return;
    }
  } catch {}

  const rec = {
    promo_code: src.code,
    promotion_name: 'Time Limited Exclusive Offer - 45% Reload Bonus',
    promotion_name_en: 'Time Limited Exclusive Offer - 45% Reload Bonus',
    promotion_name_zh_id: '限时独家优惠 - 45% 充值奖金',
    column_m: sd.name,
    description: sd.name,
    bonus_type: 'Deposit',
    bonus_sub_type: 'Reload',
    min_deposit: src.minMyr,
    bonus_pct: sd.bonusRate,
    turnover_multiplier: sd.multiplier,
    cap_bonus_amount: src.maxMyr,
    max_bonus: src.maxMyr,
    reward_type: 0,
    rollover_type: 0,
    redeemable_quantity: 999999,
    redeemable_count: 0,
    kyc_level: 0,
    redeemable_days: null,
    redeemable_start_time: '00:00',
    redeemable_end_time: '23:59',
    expiry_minutes_ws1: 1440,
    withdrawal_cap: 0,
    maximum_balance: 0,
    fixed_bonus_amount: 0,
    fixed_rollover_amount: 0,
    region: 'MY',
    currencies: ['MYR'],
    locales: ['MY_EN', 'MY_ZH'],
    parsed: { bonus_rate_pct: sd.bonusRate, max_bonus: src.maxMyr, min_deposit: src.minMyr, to_multiplier: sd.multiplier, game: 'All games' },
  };

  const plan = buildIgmpPlan(rec, { siteId: WS1_SITE });

  if (dryRun) {
    const rw = plan.body.PromotionRewards?.[0];
    console.log(`  [DRY] WS1 ${src.code}: min=${rw?.MinimumActionAmount} pct=${rw?.BonusPercentage} cap=${rw?.CapBonusAmount} RO=${rw?.RolloverMultiplier}`);
    return;
  }

  const res = await igmpPost(WS1_SITE, plan.endpoint, plan.body);
  const success = res?.success === true || res?.data?.Promotion?.PromotionId != null;
  const promoId = res?.data?.Promotion?.PromotionId ?? res?.data?.PromotionId ?? null;
  console.log(`  ${success ? '✓' : '✗'} WS1 ${src.code}: PromotionId=${promoId} msg=${res?.message ?? JSON.stringify(res).slice(0,100)}`);
}

// ── Run ──────────────────────────────────────────────────────────────────
for (const src of SOURCES) {
  console.log(`\n━━━ ${src.code} ━━━`);
  const sd = sourceData[src.code];

  // QPRO brands sequentially per code
  for (const brandId of QPRO_TARGETS) {
    try { await createQpro(brandId, src); }
    catch (e) { console.log(`  ERROR ${brandId.toUpperCase()} ${src.code}: ${e.message.slice(0,200)}`); }
  }

  // WS1
  try { await createWs1(src, sd); }
  catch (e) { console.log(`  ERROR WS1 ${src.code}: ${e.message.slice(0,200)}`); }
}

console.log('\nDone.');

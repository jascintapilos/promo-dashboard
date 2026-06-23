#!/usr/bin/env node
// Deep field-by-field QC: compare source QPRO2 promo against each replicated target.
// Surfaces every drift, not just the headline counts.

import fs from 'node:fs';
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';
import { igmpPost } from '../src/igmp-client.js';

const CODE_TO_SRC_ID = {
  'FT_REL_TLEO_LC_20PCT_20MX_BR':  451,
  'FT_REL_TLEO_LC_20PCT_300MX_BR': 468,
  'FT_REL_TLEO_LC_20PCT_400MX_BR': 469,
  'FT_REL_TLEO_20PCT_300MX_BR':    470,
  'FT_REL_TLEO_20PCT_400MX_BR':    471,
  'FT_REL_TLEO_LC_45PCT_138MX':    442,
  'FT_REL_TLEO_LC_45PCT_228MX_BR': 443,
  'FT_REL_TLEO_LC_45PCT_458MX_BR': 444,
  'FT_REL_TLEO_45PCT_688MX':       425,
  'FT_REL_TLEO_45PCT_888MX':       426,
};

const sourceSite = getSite('qpro2');
const targets = ['qpro3', 'qpro4', 'qpro6', 'qpro8', 'qpro10'];

// Fields to compare directly (excluding ids/timestamps/auto-managed).
const COMPARE_FIELDS = [
  'name', 'promo_type', 'promo_sub_type', 'validity', 'reward_validity',
  'recurring', 'reset_frequency', 'max_per_player', 'daily_max',
  'frequency_type', 'first_deposit', 'last_deposit', 'auto_approve',
  'auto_unlock', 'allow_cancel', 'transfer_unlock',
  'limit_transfer_in', 'limit_transfer_out',
  'restrict_claim_round_active', 'restrict_same_provider_launch',
  'eligible_types', 'kyc_basic', 'kyc_advanced', 'kyc_pro',
  'requires_email', 'requires_mobile', 'requires_dob', 'requires_fullname',
  'bonus_rate', 'visible_by_affiliate',
];

// Coerce booleans to 0/1 for stable comparison (BO returns true/1 inconsistently)
function n01(v) { if (v === true) return 1; if (v === false) return 0; return v; }
function eq(a, b) { return JSON.stringify(n01(a)) === JSON.stringify(n01(b)); }

async function fetchDetail(site, code) {
  const list = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(code)}&perPage=5`);
  const row = (list.data?.rows || []).find((r) => r.code === code);
  if (!row) return null;
  const [d, c, n] = await Promise.all([
    authedFetch(site, `/api/bo/promotion/${row.id}`),
    authedFetch(site, `/api/bo/promotioncurrency?promotion_id=${row.id}`),
    authedFetch(site, `/api/bo/promotionname?promotion_id=${row.id}`),
  ]);
  return { row, main: d.data.rows, currencies: c.data.rows, names: n.data.rows };
}

async function fetchMt(site, mtId) {
  if (!mtId) return null;
  try {
    const res = await authedFetch(site, `/api/bo/messagetemplate/${mtId}`);
    return { template: res.data.message_template, details: res.data.message_details };
  } catch { return null; }
}

const out = {};
for (const target of targets) {
  console.log(`\n━━━ ${target} ━━━`);
  out[target] = {};
  const tsite = getSite(target);
  const expectsSG = target === 'qpro3';

  for (const [code, srcId] of Object.entries(CODE_TO_SRC_ID)) {
    const [srcAll, tgtAll] = await Promise.all([
      authedFetch(sourceSite, `/api/bo/promotion/${srcId}`).then(async (d) => ({
        main: d.data.rows,
        currencies: (await authedFetch(sourceSite, `/api/bo/promotioncurrency?promotion_id=${srcId}`)).data.rows,
        names: (await authedFetch(sourceSite, `/api/bo/promotionname?promotion_id=${srcId}`)).data.rows,
      })),
      fetchDetail(tsite, code),
    ]);
    if (!tgtAll) { out[target][code] = { errs: ['TARGET_NOT_FOUND'] }; console.log(`  ✗ ${code}: TARGET_NOT_FOUND`); continue; }

    const errs = [];

    // Field-by-field on main row
    for (const f of COMPARE_FIELDS) {
      const sv = srcAll.main[f];
      const tv = tgtAll.main[f];
      if (!eq(sv, tv)) errs.push(`${f}: src=${JSON.stringify(n01(sv))} tgt=${JSON.stringify(n01(tv))}`);
    }

    // promotion_category set (LC=2 or SLOTS=3)
    const srcCatIds = (srcAll.main.promotion_category || []).map((c) => c.category_id).sort();
    const tgtCatIds = (tgtAll.main.promotion_category || []).map((c) => c.category_id).sort();
    if (JSON.stringify(srcCatIds) !== JSON.stringify(tgtCatIds)) {
      errs.push(`cat_ids src=${JSON.stringify(srcCatIds)} tgt=${JSON.stringify(tgtCatIds)}`);
    }

    // target.0.multiplier match
    const srcTo = srcAll.main.target?.[0]?.multiplier;
    const tgtTo = tgtAll.main.target?.[0]?.multiplier;
    if (srcTo !== tgtTo) errs.push(`TO: src=${srcTo} tgt=${tgtTo}`);

    // Per-currency check
    const srcMyr = srcAll.currencies.find((c) => c.currency === 'MYR');
    const tgtMyr = tgtAll.currencies.find((c) => c.currency === 'MYR');
    if (!tgtMyr) errs.push('MYR_currency_row_missing');
    else {
      if (Number(srcMyr.min_transfer) !== Number(tgtMyr.min_transfer)) errs.push(`MYR.min_transfer src=${srcMyr.min_transfer} tgt=${tgtMyr.min_transfer}`);
      if (Number(srcMyr.max_bonus) !== Number(tgtMyr.max_bonus)) errs.push(`MYR.max_bonus src=${srcMyr.max_bonus} tgt=${tgtMyr.max_bonus}`);
    }
    if (expectsSG) {
      const srcSgd = srcAll.currencies.find((c) => c.currency === 'SGD');
      const tgtSgd = tgtAll.currencies.find((c) => c.currency === 'SGD');
      if (!tgtSgd) errs.push('SGD_currency_row_missing');
      else if (srcSgd) {
        if (Number(srcSgd.min_transfer) !== Number(tgtSgd.min_transfer)) errs.push(`SGD.min_transfer src=${srcSgd.min_transfer} tgt=${tgtSgd.min_transfer}`);
        if (Number(srcSgd.max_bonus) !== Number(tgtSgd.max_bonus)) errs.push(`SGD.max_bonus src=${srcSgd.max_bonus} tgt=${tgtSgd.max_bonus}`);
      }
    }

    // promotion_name comparison
    const expectedLocales = expectsSG ? ['MY_EN','MY_ZH','SG_EN','SG_ZH'] : ['MY_EN','MY_ZH'];
    for (const loc of expectedLocales) {
      const srcN = srcAll.names.find((n) => n.locale === loc);
      const tgtN = tgtAll.names.find((n) => n.locale === loc);
      if (!tgtN) { errs.push(`name[${loc}]_missing`); continue; }
      if (!srcN) continue;
      if (srcN.promotion_name !== tgtN.promotion_name) errs.push(`name[${loc}] src="${srcN.promotion_name}" tgt="${tgtN.promotion_name}"`);
      if (srcN.rewards_name !== tgtN.rewards_name) errs.push(`rewards_name[${loc}] src="${srcN.rewards_name}" tgt="${tgtN.rewards_name}"`);
    }

    // Message template comparison
    const srcMt = await fetchMt(sourceSite, srcAll.main.message_template_id);
    const tgtMt = await fetchMt(tsite, tgtAll.main.message_template_id);
    if (!tgtMt) errs.push('MT_missing');
    else if (srcMt) {
      const srcLocs = Object.keys(srcMt.details || {}).sort();
      const tgtLocs = Object.keys(tgtMt.details || {}).filter((l) =>
        expectsSG ? true : ['1','3'].includes(l)).sort();
      const expLocs = expectsSG ? srcLocs : srcLocs.filter((l) => ['1','3'].includes(l));
      if (JSON.stringify(expLocs) !== JSON.stringify(tgtLocs)) {
        errs.push(`MT_locale_set src=${JSON.stringify(expLocs)} tgt=${JSON.stringify(tgtLocs)}`);
      }
      for (const lid of expLocs) {
        const sd = srcMt.details[lid];
        const td = tgtMt.details[lid];
        if (!td) { errs.push(`MT[${lid}]_missing`); continue; }
        if (sd.subject !== td.subject) errs.push(`MT[${lid}].subject differs`);
        if (sd.message !== td.message) errs.push(`MT[${lid}].message differs (src_len=${sd.message?.length} tgt_len=${td.message?.length})`);
      }
    }

    // Blacklist sub-categories — source has 8 entries, target may differ
    const srcBlk = srcAll.main.blacklist_sub_categories?.length || 0;
    const tgtBlk = tgtAll.main.blacklist_sub_categories?.length || 0;
    if (srcBlk !== tgtBlk) errs.push(`blacklist_sub_categories src=${srcBlk} tgt=${tgtBlk}`);

    // member_group_ids should be [] on QPRO per saved rule
    if ((tgtAll.main.member_group_ids || []).length !== 0) errs.push(`member_group_ids non-empty`);

    out[target][code] = { id: tgtAll.main.id, errs };
    if (errs.length === 0) console.log(`  ✓ ${code} (id=${tgtAll.main.id})`);
    else console.log(`  ✗ ${code} (id=${tgtAll.main.id}): ${errs.length} drifts\n    - ${errs.join('\n    - ')}`);
  }
}

fs.writeFileSync('tmp/tleo-deep-qc.json', JSON.stringify(out, null, 2));
console.log('\nWrote tmp/tleo-deep-qc.json');

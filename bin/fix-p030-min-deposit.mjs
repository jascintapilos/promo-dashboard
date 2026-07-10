#!/usr/bin/env node
// fix-p030-min-deposit.mjs
//
// P030-r31 was committed with buildCurrencyBlockFC() missing min_transfer
// (QPRO) and min_deposit + min_transfer (QP2). Additionally the MT body
// showed "SGD 30" for SG locales — below the platform floor of SGD 50.
//
// This script patches the live BO:
//  1. PUT each promotion_currency row with floor-aware min_transfer (+ min_deposit for QP2)
//  2. Re-render and PUT the SG locale MT body (locales 6=SG_EN, 7=SG_ZH) with SGD 50
//
// Usage: node bin/fix-p030-min-deposit.mjs [--commit]

import fs from 'node:fs';
import { authedFetch } from '../src/api-client.js';
import { renderBody } from '../src/message-template-renderer.js';
import { getSite } from '../src/sites.js';

const resolved = JSON.parse(fs.readFileSync('captures/requests/P030-r31.json', 'utf8'));
const commit = process.argv.includes('--commit');

const DEPOSIT_FLOOR = { MYR: 30, SGD: 50, IDR: 25000, THB: 50 };
const CURRENCY_ID_TO_LABEL = { 1: 'MYR', 3: 'SGD', 4: 'IDR' };

function flooredMinDep(currency) {
  const raw = Number(resolved.per_currency_overrides?.[currency]?.min_deposit ?? resolved.parsed?.min_deposit ?? 0);
  return raw > 0 ? Math.max(raw, DEPOSIT_FLOOR[currency] ?? 0) : 0;
}

// ── Targets (from captures/qc-bundles/P030-r31__*.json) ──────────────────
const qproTargets = [
  { brand: 'QPRO1',  site: 'qpro1',  promotionId: 1083, templateId: 1071 },
  { brand: 'QPRO2',  site: 'qpro2',  promotionId:  548, templateId:  461 },
  { brand: 'QPRO3',  site: 'qpro3',  promotionId:  585, templateId:  545 },
  { brand: 'QPRO4',  site: 'qpro4',  promotionId:  515, templateId:  477 },
  { brand: 'QPRO5',  site: 'qpro5',  promotionId:  453, templateId:  376 },
  { brand: 'QPRO6',  site: 'qpro6',  promotionId:  495, templateId:  623 },
  { brand: 'QPRO7',  site: 'qpro7',  promotionId:  445, templateId:  569 },
  { brand: 'QPRO8',  site: 'qpro8',  promotionId:  578, templateId:  692 },
  { brand: 'QPRO9',  site: 'qpro9',  promotionId:  363, templateId:  501 },
  { brand: 'QPRO10', site: 'qpro10', promotionId:  362, templateId:  561 },
  { brand: 'QPRO11', site: 'qpro11', promotionId:  217, templateId:  242 },
  { brand: 'QPRO12', site: 'qpro12', promotionId:  181, templateId:  209 },
  { brand: 'QPRO15', site: 'qpro15', promotionId:  352, templateId:  383 },
  { brand: 'QPRO16', site: 'qpro16', promotionId:  320, templateId:  360 },
  { brand: 'QPRO17', site: 'qpro17', promotionId:  171, templateId:  207 },
];

// QP2: shared promotion (id=1361) across QP2A-D on ibc22
const qp2Target = { site: 'ibc22', promotionId: 1361, templateId: 1286 };

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`FIX P030 min_deposit — ${commit ? 'LIVE COMMIT' : 'DRY-RUN'}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`Source min_deposit: ${resolved.parsed?.min_deposit}  Floors: MYR ${DEPOSIT_FLOOR.MYR}, SGD ${DEPOSIT_FLOOR.SGD}`);
console.log(`  → MYR min_transfer: ${flooredMinDep('MYR')}  SGD min_transfer: ${flooredMinDep('SGD')}`);

// ── QPRO: fix promotion_currency min_transfer + MT SG locale ─────────────
for (const t of qproTargets) {
  const site = getSite(t.site);
  console.log(`\n${t.brand}  promo=${t.promotionId}  mt=${t.templateId}`);

  // 1. Currency rows
  const pcResp = await authedFetch(site, `/api/bo/promotioncurrency?promotion_id=${t.promotionId}&perPage=20`);
  const pcRows = pcResp.data?.rows || [];
  console.log(`  currency rows: ${pcRows.length}`);
  for (const row of pcRows) {
    const cid = row.settings_currency_id ?? row.currency_id;
    const label = row.currency || CURRENCY_ID_TO_LABEL[Number(cid)] || `cid=${cid}`;
    const newVal = flooredMinDep(label);
    console.log(`    [${label}] min_transfer: ${row.min_transfer ?? 'null'} → ${newVal}`);
    if (commit) {
      await authedFetch(site, `/api/bo/promotioncurrency/${row.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...row, currency_id: row.settings_currency_id ?? cid, min_transfer: newVal }),
      });
      console.log(`    ✓ PUT promotioncurrency/${row.id}`);
    }
  }

  // 2. MT SG locale body (SG_EN=6, SG_ZH=7)
  // GET /api/bo/messagetemplate/{id} returns { data: { message_template, message_details } }
  // message_details is keyed by settings_locale_id string, values include { id, subject, message }
  const mtResp = (await authedFetch(site, `/api/bo/messagetemplate/${t.templateId}`)).data;
  const mtMeta = mtResp?.message_template;
  const mtDet  = mtResp?.message_details;
  if (!mtMeta || !mtDet) {
    console.log(`  MT ${t.templateId}: GET returned unexpected shape — skipping`);
    continue;
  }
  // Build details dict: preserve existing locales, overwrite SG ones with re-render
  const updatedDetails = {};
  for (const [k, v] of Object.entries(mtDet)) {
    updatedDetails[k] = { settings_locale_id: Number(k), subject: v.subject, message: v.message };
  }
  for (const [localeKey, settingsId] of [['SG_EN', 6], ['SG_ZH', 7]]) {
    const rendered = await renderBody({
      bonusType: resolved.bonus_type,
      locale: localeKey,
      brand: t.brand,
      platform: 'qpro',
      resolved,
    });
    if (rendered.skipped) {
      console.log(`  MT[${settingsId}=${localeKey}]: skipped — ${rendered.reason}`);
      continue;
    }
    const prev = String(mtDet[String(settingsId)]?.message || '').slice(0, 80).replace(/\n/g, ' ');
    console.log(`  MT[${settingsId}=${localeKey}]: subject="${rendered.subject}"`);
    console.log(`    was:  "${prev}"`);
    console.log(`    now:  "${rendered.html.slice(0, 80).replace(/\n/g, ' ')}"`);
    updatedDetails[String(settingsId)] = {
      settings_locale_id: settingsId,
      subject: rendered.subject || '',
      message: rendered.html,
    };
  }
  if (commit) {
    await authedFetch(site, `/api/bo/messagetemplate/${t.templateId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: mtMeta.name,
        section: mtMeta.section,
        type: mtMeta.type,
        status: mtMeta.status,
        details: updatedDetails,
      }),
    });
    console.log(`  ✓ PUT messagetemplate/${t.templateId}`);
  }
}

// ── QP2: fix promotion_currency min_deposit + min_transfer + MT SG locale ─
{
  const t = qp2Target;
  const site = getSite(t.site);
  console.log(`\nQP2 (shared)  promo=${t.promotionId}  mt=${t.templateId}  site=${t.site}`);

  // 1. Currency rows
  const pcResp = await authedFetch(site, `/api/bo/promotioncurrency?promotion_id=${t.promotionId}&perPage=20`);
  const pcRows = pcResp.data?.rows || [];
  console.log(`  currency rows: ${pcRows.length}`);
  for (const row of pcRows) {
    const cid = row.settings_currency_id ?? row.currency_id;
    const label = row.currency || CURRENCY_ID_TO_LABEL[Number(cid)] || `cid=${cid}`;
    const newVal = flooredMinDep(label);
    console.log(`    [${label}] min_transfer: ${row.min_transfer ?? 'null'}, min_deposit: ${row.min_deposit ?? 'null'} → ${newVal}`);
    if (commit) {
      await authedFetch(site, `/api/bo/promotioncurrency/${row.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...row,
          currency_id: row.settings_currency_id ?? cid,
          min_transfer: newVal,
          min_deposit: newVal,
          max_total_applications: null,
          max_total_bonus: null,
          max_withdraw: null,
        }),
      });
      console.log(`    ✓ PUT promotioncurrency/${row.id}`);
    }
  }

  // 2. MT SG locale body (QP2 uses platform='qp2' so renderer emits :merchantname)
  const mtResp2 = (await authedFetch(site, `/api/bo/messagetemplate/${t.templateId}`)).data;
  const mtMeta2 = mtResp2?.message_template;
  const mtDet2  = mtResp2?.message_details;
  if (mtMeta2 && mtDet2) {
    const updatedDetails = {};
    for (const [k, v] of Object.entries(mtDet2)) {
      updatedDetails[k] = { settings_locale_id: Number(k), subject: v.subject, message: v.message };
    }
    for (const [localeKey, settingsId] of [['SG_EN', 6], ['SG_ZH', 7]]) {
      const rendered = await renderBody({
        bonusType: resolved.bonus_type,
        locale: localeKey,
        brand: 'QP2A',
        platform: 'qp2',
        resolved,
      });
      if (rendered.skipped) {
        console.log(`  MT[${settingsId}=${localeKey}]: skipped — ${rendered.reason}`);
        continue;
      }
      const prev = String(mtDet2[String(settingsId)]?.message || '').slice(0, 80).replace(/\n/g, ' ');
      console.log(`  MT[${settingsId}=${localeKey}]: subject="${rendered.subject}"`);
      console.log(`    was:  "${prev}"`);
      console.log(`    now:  "${rendered.html.slice(0, 80).replace(/\n/g, ' ')}"`);
      updatedDetails[String(settingsId)] = {
        settings_locale_id: settingsId,
        subject: rendered.subject || '',
        message: rendered.html,
      };
    }
    if (commit) {
      await authedFetch(site, `/api/bo/messagetemplate/${t.templateId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: mtMeta2.name,
          section: mtMeta2.section,
          type: mtMeta2.type,
          status: mtMeta2.status,
          details: updatedDetails,
        }),
      });
      console.log(`  ✓ PUT messagetemplate/${t.templateId}`);
    }
  } else {
    console.log(`  MT ${t.templateId}: GET returned unexpected shape — skipping`);
  }
}

console.log('\nDone.');

#!/usr/bin/env node
/**
 * Construct deep-QC bundles for already-saved P128-P133 promos across their
 * full multi-brand footprint (QPRO1+2+3+4 + QP2A). Mimics the bundle shape
 * that canary-api-qpro.js / canary-api-qp2.js write at --commit time.
 *
 * Usage: node bin/build-bundles-p128-p133.mjs
 */

import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { findPromotionByCode, getPromotionDetail } from '../src/api-client.js';
import { qcMtTncHyperlink } from '../src/qc-mt-tnc.js';
import { getSite } from '../src/sites.js';

const TARGETS = [
  { handle: 'P128-r129', code: 'RET_LC_BASE_15PCT' },
  { handle: 'P129-r130', code: 'RET_LC_BOOST_18PCT' },
  { handle: 'P130-r131', code: 'RET_SPORTS_BASE_12PCT' },
  { handle: 'P131-r132', code: 'RET_SPORTS_BOOST_15PCT' },
  { handle: 'P132-r133', code: 'REL_BASE_12PCT_5X' },
  { handle: 'P133-r134', code: 'REL_BOOSTER_15PCT_5X' },
];

const BRAND_SITES = {
  QPRO1: { siteId: 'qpro1', platform: 'qpro' },
  QPRO2: { siteId: 'qpro2', platform: 'qpro' },
  QPRO3: { siteId: 'qpro3', platform: 'qpro' },
  QPRO4: { siteId: 'qpro4', platform: 'qpro' },
  QP2A:  { siteId: 'ibc22', platform: 'qp2'  },
};

const bundleDir = path.resolve('captures/qc-bundles');
await mkdir(bundleDir, { recursive: true });

let total = 0;
for (const t of TARGETS) {
  console.log(`\n── ${t.handle} (${t.code}) ──`);
  const reqPath = path.resolve(`captures/requests/${t.handle}.json`);
  const request = JSON.parse(await readFile(reqPath, 'utf8'));

  for (const [brand, { siteId, platform }] of Object.entries(BRAND_SITES)) {
    const site = getSite(siteId);
    const row = await findPromotionByCode(site, t.code);
    if (!row) {
      console.log(`  ${brand} — not found, skipping`);
      continue;
    }

    let detail = null, tnc = null;
    try {
      detail = await getPromotionDetail(site, row.id);
    } catch (e) {
      console.log(`  ${brand} — detail fetch failed: ${e.message.split('\n')[0]}`);
    }
    const templateId = row.message_template_id;
    if (templateId) {
      try {
        tnc = await qcMtTncHyperlink(site, templateId, platform);
      } catch (e) {
        console.log(`  ${brand} — tnc check failed: ${e.message.split('\n')[0]}`);
      }
    }

    const dialogPopupId = row.dialog_popup_list?.[0]?.popup_id || null;

    const bundle = {
      handle: t.handle,
      brand,
      platform,
      site: siteId,
      promo_code: t.code,
      promotion_id: row.id,
      template_id: templateId || null,
      dialog_popup_id: dialogPopupId,
      saved_at: row.created_at || row.updated_at || new Date().toISOString(),
      source: {
        bonus_type: request.bonus_type,
        categories: request.categories || request.parsed?.categories || null,
        regions: request.regions || null,
        parsed: request.parsed || {},
        promotion_name_en: request.promotion_name_en,
        promotion_name_zh: request.promotion_name_zh,
        promotion_name_id: request.promotion_name_id,
        promotion_name_zh_id: request.promotion_name_zh_id,
        max_per_player: request.max_per_player,
        daily_max: request.daily_max,
        max_withdraw: request.max_withdraw,
        instructions: request.instructions || null,
        remark: request.remark || null,
      },
      qc_endpoints: {
        list:       `GET /api/bo/promotion?code=${t.code}`,
        detail:     `GET /api/bo/promotion/${row.id}`,
        currencies: `GET /api/bo/promotioncurrency?promotion_id=${row.id}`,
        template:   templateId ? `GET /api/bo/messagetemplate/${templateId}` : null,
      },
      live_state: {
        list_row: row,
        detail,
        tnc,
        refreshed_at: new Date().toISOString(),
      },
    };

    const bundlePath = path.join(bundleDir, `${t.handle}__${brand}.json`);
    await writeFile(bundlePath, JSON.stringify(bundle, null, 2));
    console.log(`  ${brand} — id=${row.id} template_id=${templateId || 'null'} popup_id=${dialogPopupId || 'null'} tnc=${tnc ? JSON.stringify(tnc.checks) : 'null'}`);
    total++;
  }
}

console.log(`\n✓ Wrote ${total} bundles to ${bundleDir}`);

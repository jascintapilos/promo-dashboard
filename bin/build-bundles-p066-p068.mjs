#!/usr/bin/env node
// Build deep-QC bundles for P066/P067/P068 (Whale Probe FS) from live BO state.
// Covers QPRO1-10/15/16, QP2A-D (ibc22), WS1-MY, WS1-SG, WS2.

import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { findPromotionByCode, getPromotionDetail } from '../src/api-client.js';
import { qcMtTncHyperlink } from '../src/qc-mt-tnc.js';
import { getSite } from '../src/sites.js';
import { igmpPost } from '../src/igmp-client.js';

const HANDLES = ['P066-r67', 'P067-r68', 'P068-r69'];

const QPRO_BRANDS = [
  { brand: 'QPRO1',  siteId: 'qpro1'  },
  { brand: 'QPRO2',  siteId: 'qpro2'  },
  { brand: 'QPRO3',  siteId: 'qpro3'  },
  { brand: 'QPRO4',  siteId: 'qpro4'  },
  { brand: 'QPRO5',  siteId: 'qpro5'  },
  { brand: 'QPRO6',  siteId: 'qpro6'  },
  { brand: 'QPRO7',  siteId: 'qpro7'  },
  { brand: 'QPRO8',  siteId: 'qpro8'  },
  { brand: 'QPRO9',  siteId: 'qpro9'  },
  { brand: 'QPRO10', siteId: 'qpro10' },
  { brand: 'QPRO15', siteId: 'qpro15' },
  { brand: 'QPRO16', siteId: 'qpro16' },
];

const QP2_BRANDS = [
  { brand: 'QP2A', siteId: 'ibc22', merchantId: 1 },
  { brand: 'QP2B', siteId: 'ibc22', merchantId: 2 },
  { brand: 'QP2C', siteId: 'ibc22', merchantId: 3 },
  { brand: 'QP2D', siteId: 'ibc22', merchantId: 4 },
];

const IGMP_SITES = [
  { brand: 'WS1_MY', siteId: 'ws1-v3-my' },
  { brand: 'WS1_SG', siteId: 'ws1-v3-sg' },
  { brand: 'WS2',    siteId: 'ws2'        },
];

const bundleDir = path.resolve('captures/qc-bundles');
await mkdir(bundleDir, { recursive: true });

let total = 0, errors = 0;

for (const handle of HANDLES) {
  const reqPath = path.resolve(`captures/requests/${handle}.json`);
  const request = JSON.parse(await readFile(reqPath, 'utf8'));
  const code = request.promo_code;
  console.log(`\n══ ${handle} — ${code} ══`);

  // ── QPRO brands ──────────────────────────────────────────────────────────
  for (const b of QPRO_BRANDS) {
    process.stdout.write(`  ${b.brand.padEnd(8)} `);
    try {
      const site = getSite(b.siteId);
      const row = await findPromotionByCode(site, code);
      if (!row) { console.log('NOT FOUND'); errors++; continue; }

      let detail = null;
      try { detail = await getPromotionDetail(site, row.id); } catch {}

      const templateId = row.message_template_id || null;
      let tnc = null;
      if (templateId) {
        try { tnc = await qcMtTncHyperlink(site, templateId, 'qpro'); } catch {}
      }

      const dialogPopupId = row.dialog_popup_list?.[0]?.popup_id || null;

      const bundle = {
        handle, brand: b.brand, platform: 'qpro', site: b.siteId,
        promo_code: code,
        promotion_id: row.id, template_id: templateId, dialog_popup_id: dialogPopupId,
        saved_at: row.created_at || row.updated_at || new Date().toISOString(),
        source: {
          bonus_type: request.bonus_type, bonus_sub_type: request.bonus_sub_type,
          promo_code: request.promo_code,
          promotion_name_en: request.promotion_name_en,
          promotion_name_zh_id: request.promotion_name_zh_id,
          validity_days: request.validity_days,
          rewards_validity_days: request.rewards_validity_days,
          recurring: request.recurring,
          max_per_player: request.max_per_player,
          daily_max: request.daily_max,
          regions: request.regions, currencies: request.currencies,
          parsed: request.parsed,
          instructions: request.instructions || null,
        },
        qc_endpoints: {
          list:       `GET /api/bo/promotion?code=${code}`,
          detail:     `GET /api/bo/promotion/${row.id}`,
          currencies: `GET /api/bo/promotioncurrency?promotion_id=${row.id}`,
          template:   templateId ? `GET /api/bo/messagetemplate/${templateId}` : null,
        },
        live_state: { list_row: row, detail, tnc, refreshed_at: new Date().toISOString() },
      };

      await writeFile(path.join(bundleDir, `${handle}__${b.brand}.json`), JSON.stringify(bundle, null, 2));
      console.log(`id=${row.id} tmpl=${templateId || '-'} popup=${dialogPopupId || '-'} tnc=${tnc ? JSON.stringify(tnc.checks) : '-'}`);
      total++;
    } catch (e) {
      console.log(`ERROR: ${e.message.split('\n')[0]}`); errors++;
    }
  }

  // ── QP2 brands (shared ibc22 BO) ─────────────────────────────────────────
  for (const b of QP2_BRANDS) {
    process.stdout.write(`  ${b.brand.padEnd(8)} `);
    try {
      const site = getSite(b.siteId);
      const row = await findPromotionByCode(site, code, { merchantId: b.merchantId });
      if (!row) { console.log('NOT FOUND'); errors++; continue; }

      let detail = null;
      try { detail = await getPromotionDetail(site, row.id); } catch {}

      const templateId = row.message_template_id || null;
      let tnc = null;
      if (templateId) {
        try { tnc = await qcMtTncHyperlink(site, templateId, 'qp2'); } catch {}
      }

      const dialogPopupId = row.dialog_popup_list?.[0]?.popup_id || null;

      const bundle = {
        handle, brand: b.brand, platform: 'qp2', site: b.siteId,
        promo_code: code,
        promotion_id: row.id, template_id: templateId, dialog_popup_id: dialogPopupId,
        saved_at: row.created_at || row.updated_at || new Date().toISOString(),
        source: {
          bonus_type: request.bonus_type, bonus_sub_type: request.bonus_sub_type,
          promo_code: request.promo_code,
          promotion_name_en: request.promotion_name_en,
          promotion_name_zh_id: request.promotion_name_zh_id,
          validity_days: request.validity_days,
          rewards_validity_days: request.rewards_validity_days,
          recurring: request.recurring,
          max_per_player: request.max_per_player,
          daily_max: request.daily_max,
          regions: request.regions, currencies: request.currencies,
          parsed: request.parsed,
          instructions: request.instructions || null,
        },
        qc_endpoints: {
          list:       `GET /api/bo/promotion?code=${code}&merchant_id=${b.merchantId}`,
          detail:     `GET /api/bo/promotion/${row.id}`,
          currencies: `GET /api/bo/promotioncurrency?promotion_id=${row.id}`,
          template:   templateId ? `GET /api/bo/messagetemplate/${templateId}` : null,
        },
        live_state: { list_row: row, detail, tnc, refreshed_at: new Date().toISOString() },
      };

      await writeFile(path.join(bundleDir, `${handle}__${b.brand}.json`), JSON.stringify(bundle, null, 2));
      console.log(`id=${row.id} tmpl=${templateId || '-'} popup=${dialogPopupId || '-'} tnc=${tnc ? JSON.stringify(tnc.checks) : '-'}`);
      total++;
    } catch (e) {
      console.log(`ERROR: ${e.message.split('\n')[0]}`); errors++;
    }
  }

  // ── IGMP brands ───────────────────────────────────────────────────────────
  for (const b of IGMP_SITES) {
    process.stdout.write(`  ${b.brand.padEnd(8)} `);
    try {
      const listRes = await igmpPost(b.siteId, '/PM/GetPromotionInfoByCode', { PromotionCode: code });
      const listRow = listRes?.data;
      if (!listRow?.PromotionId) { console.log('NOT FOUND'); errors++; continue; }

      const promoId = listRow.PromotionId;

      let detail = null, rewardId = null, tncMessages = [];
      try {
        const dr = await igmpPost(b.siteId, '/PM/GetFreeSpinPromotionInfo', { PromotionId: promoId });
        if (dr?.data?.Promotion) {
          detail = dr.data.Promotion;
          rewardId = detail.PromotionRewards?.[0]?.RewardId ?? null;
        }
      } catch {}

      if (rewardId) {
        try {
          const tr = await igmpPost(b.siteId, '/PM/GetPromotionRewardContents', { RewardId: rewardId });
          tncMessages = tr?.data || [];
        } catch {}
      }

      const enMsg = tncMessages.find(r => (r.Locale || '').toLowerCase() === 'en');
      const sentence11 = enMsg ? /<a\s[^>]*href/i.test((enMsg.Content || '').slice(Math.floor((enMsg.Content||'').length * 0.6))) : false;

      const bundle = {
        handle, brand: b.brand, platform: 'igmp', site: b.siteId,
        promo_code: code,
        promotion_id: promoId, reward_id: rewardId, template_id: null, dialog_popup_id: null,
        saved_at: null,
        source: {
          bonus_type: request.bonus_type, bonus_sub_type: request.bonus_sub_type,
          promo_code: request.promo_code,
          promotion_name_en: request.promotion_name_en,
          promotion_name_zh_id: request.promotion_name_zh_id,
          validity_days: request.validity_days,
          rewards_validity_days: request.rewards_validity_days,
          recurring: request.recurring,
          max_per_player: request.max_per_player,
          daily_max: request.daily_max,
          regions: request.regions, currencies: request.currencies,
          parsed: request.parsed,
          instructions: request.instructions || null,
        },
        qc_endpoints: {
          list:   '/PM/GetPromotionInfoByCode',
          detail: '/PM/GetFreeSpinPromotionInfo',
          tnc:    '/PM/GetPromotionRewardContents',
        },
        live_state: {
          list_row: listRow, detail,
          tnc: { messages: tncMessages, checks: { sentence_11_has_link: sentence11 } },
          refreshed_at: new Date().toISOString(),
        },
      };

      await writeFile(path.join(bundleDir, `${handle}__${b.brand}.json`), JSON.stringify(bundle, null, 2));
      console.log(`id=${promoId} reward=${rewardId || '-'} tnc_locales=[${tncMessages.map(r=>r.Locale).join(',')}]`);
      total++;
    } catch (e) {
      console.log(`ERROR: ${e.message.split('\n')[0]}`); errors++;
    }
  }
}

console.log(`\n✓ ${total} bundles written   ${errors ? `✗ ${errors} errors` : ''}`);

// Patch P069-P072: set recurring=true + rewards_validity_days=7 on all saved promos.
//
// Triggered after: sheet col S → Recurring, col Q → 7, re-ingest (2026-07-11).
// Changes per platform:
//   QPRO: recurring='1', reward_validity=7, reset_frequency=1 via buildApiPlan+buildUpdate
//   QP2:  recurring=1,   reward_validity=7 via buildApiPlan+buildUpdate
//   IGMP: ExpiryMinutes=10080, T&C clause-2 text (once per day) via UpdatePromotionRewardDetails
//
// MT HTML patches applied to QPRO/QP2 in all locales:
//   EN: "only once." → "once per day."
//   ZH: "仅限领取一次此优惠。" → "每日限领取一次此优惠。"
//   EN: "claimed within three (3) days" → "claimed within seven (7) days"
//   ZH: "优惠需在 3 天内领取" → "优惠需在 7 天内领取"

import { readFileSync, readdirSync } from 'node:fs';
import { buildApiPlan as buildQproPlan } from '../src/api-mapper-qpro.js';
import { buildApiPlan as buildQp2Plan } from '../src/api-mapper-qp2.js';
import { buildIgmpPlan } from '../src/api-mapper-igmp.js';
import { updatePromotion, authedFetch } from '../src/api-client.js';
import { igmpPost } from '../src/igmp-client.js';
import { getSite } from '../src/sites.js';

const HANDLES = ['P069-r70', 'P070-r71', 'P071-r72', 'P072-r73'];
const BUNDLE_DIR = 'captures/qc-bundles';
// Optional platform filter: node bin/patch-p069-p072-recurring.mjs qp2
const ONLY_PLATFORM = process.argv[2] || null;

const MT_PATCHES = [
  { from: 'Each member can claim this promotion only once.',  to: 'Each member can claim this promotion once per day.' },
  { from: '每位会员仅限领取一次此优惠。',                       to: '每位会员每日限领取一次此优惠。' },
  { from: 'claimed within three (3) days',                    to: 'claimed within seven (7) days' },
  { from: '优惠需在 3 天内领取',                               to: '优惠需在 7 天内领取' },
  { from: 'promotion only once.</li>',                        to: 'promotion once per day.</li>' },
];

async function patchMt(site, templateId, isQpro) {
  const res = await authedFetch(site, `/api/bo/messagetemplate/${templateId}`);
  const data = res?.data?.rows || res?.data;
  const tmpl = data?.message_template;
  const msgDetails = data?.message_details || {};
  if (!tmpl) throw new Error(`MT ${templateId} not found on ${site}`);

  const details = {};
  let patched = 0;
  for (const [localeId, entry] of Object.entries(msgDetails)) {
    let message = entry.message;
    for (const { from, to } of MT_PATCHES) {
      if (message.includes(from)) { message = message.split(from).join(to); patched++; }
    }
    details[localeId] = { settings_locale_id: entry.settings_locale_id, subject: entry.subject, message };
  }

  const putBody = { name: tmpl.name, section: tmpl.section, type: tmpl.type, status: tmpl.status, details };
  if (isQpro) putBody.code = tmpl.code;
  await authedFetch(site, `/api/bo/messagetemplate/${templateId}`, { method: 'PUT', body: putBody });
  return patched;
}

async function getPopupCode(site, popupId) {
  let page = 1;
  while (true) {
    const res = await authedFetch(site, `/api/bo/popups?page=${page}&perPage=100`);
    const rows = res?.data?.rows || [];
    const found = rows.find(r => r.id === popupId);
    if (found) return { id: found.id, code: found.code, start_date: found.start_date };
    if (rows.length < 100) return null;
    page++;
  }
}

const seenQp2Sites = new Set(); // QP2 MT is shared — patch once per site per handle

for (const handle of HANDLES) {
  const resolved = JSON.parse(readFileSync(`captures/requests/${handle}.json`, 'utf8'));
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`${handle}  recurring=${resolved.recurring}  rewards_validity=${resolved.rewards_validity_days}`);
  console.log('─'.repeat(60));

  seenQp2Sites.clear();
  const bundles = readdirSync(BUNDLE_DIR)
    .filter(f => f.startsWith(`${handle}__`))
    .map(f => JSON.parse(readFileSync(`${BUNDLE_DIR}/${f}`, 'utf8')));

  for (const bundle of bundles) {
    const { platform, site, brand, promotion_id, template_id, dialog_popup_id } = bundle;
    if (ONLY_PLATFORM && platform !== ONLY_PLATFORM) continue;

    try {
      if (platform === 'qpro') {
        // ── QPRO ──────────────────────────────────────────────────────
        const plan = await buildQproPlan(resolved, { brand, site });
        let dialogPopup = null;
        if (dialog_popup_id) {
          const p = await getPopupCode(site, dialog_popup_id);
          if (p) dialogPopup = { ...p, label: resolved.promotion_name_en };
        }
        const updateBody = plan.buildUpdate(promotion_id, template_id, dialogPopup);
        await updatePromotion(site, promotion_id, updateBody);
        console.log(`  ✓ [QPRO] ${brand}  promo=${promotion_id}  recurring=1 reward_validity=7`);

        const n = await patchMt(site, template_id, true);
        console.log(`    ✓ MT ${template_id}: ${n} text patch(es)`);

      } else if (platform === 'qp2') {
        // ── QP2 ───────────────────────────────────────────────────────
        // One shared promo for QP2A/B/C/D. Must preserve merchant_ids and
        // dialog_popup_list across the PUT (canary-api-qp2.js extend flow).
        const siteObj = getSite(site); // object required: blacklist resolver routes by site.platform

        // Current merchants from detail; dialog list from LISTING (detail drops it)
        const detail = (await authedFetch(siteObj, `/api/bo/promotion/${promotion_id}`)).data.rows;
        const currentIds = (detail.merchant_ids || []).map((m) => (typeof m === 'object' ? m.id : m));
        let dialogPopupList = [];
        try {
          const listResp = await authedFetch(siteObj, `/api/bo/promotion?code=${encodeURIComponent(resolved.promo_code)}&perPage=10`);
          const listRow = (listResp.data?.rows || []).find((r) => r.id === promotion_id);
          if (Array.isArray(listRow?.dialog_popup_list)) dialogPopupList = listRow.dialog_popup_list;
        } catch (_) { /* empty list acceptable */ }

        const plan = await buildQp2Plan(resolved, { brand, site: siteObj, merchantIds: currentIds });
        const putBody = plan.buildUpdate(promotion_id, detail.message_template_id || template_id, null);
        const merchantIdsObj = {};
        currentIds.forEach((id, i) => { merchantIdsObj[String(i)] = id; });
        putBody.merchant_ids = merchantIdsObj;
        if (dialogPopupList.length) {
          const dl = {};
          dialogPopupList.forEach((d, i) => { dl[String(i)] = d; });
          putBody.dialog_popup_list = dl;
        }

        await updatePromotion(siteObj, promotion_id, putBody);

        // Read-after-write: merchants survived + fields actually landed
        const verify = (await authedFetch(siteObj, `/api/bo/promotion/${promotion_id}`)).data.rows;
        const verifyIds = (verify.merchant_ids || []).map((m) => (typeof m === 'object' ? m.id : m));
        const merchantsOk = currentIds.every((id) => verifyIds.includes(id));
        const verifyPopups = Array.isArray(verify.dialog_popup_list) ? verify.dialog_popup_list.length : 'n/a(detail)';
        if (!merchantsOk) throw new Error(`merchant_ids wiped! before=[${currentIds}] after=[${verifyIds}] — REPAIR NEEDED`);
        console.log(`  ✓ [QP2] ${brand}/${site}  promo=${promotion_id}  recurring=${verify.recurring} reward_validity=${verify.reward_validity}  merchants=[${verifyIds.join(',')}] popups_sent=${dialogPopupList.length} (verify:${verifyPopups})`);

        // MT is shared across QP2 merchants — patch once per site per handle
        const mtKey = `${site}:${detail.message_template_id || template_id}`;
        if (!seenQp2Sites.has(mtKey)) {
          seenQp2Sites.add(mtKey);
          const n = await patchMt(siteObj, detail.message_template_id || template_id, false);
          console.log(`    ✓ QP2 MT ${detail.message_template_id || template_id}: ${n} text patch(es)`);
        }

      } else if (platform === 'igmp') {
        // ── IGMP (WS1/WS2) ───────────────────────────────────────────
        const { reward_id } = bundle;
        const igmpPlan = buildIgmpPlan(resolved, { siteId: site });
        const reward = igmpPlan.body.PromotionRewards[0];

        // Add identity fields for the update endpoint
        const rewardUpdate = {
          ...reward,
          PromotionId: promotion_id,
          RewardId: reward_id,
        };

        const r = await igmpPost(site, '/PM/UpdatePromotionRewardDetails', rewardUpdate);
        const ok = r?.success === true || (Array.isArray(r?.message) && r.message.some(m => /success/i.test(m)));
        if (!ok) throw new Error(`UpdatePromotionRewardDetails returned: ${JSON.stringify(r).slice(0, 200)}`);
        console.log(`  ✓ [IGMP] ${brand}/${site}  reward=${reward_id}  ExpiryMinutes=${reward.ExpiryMinutes}  T&C updated`);
      }
    } catch (e) {
      console.error(`  ✗ [${platform?.toUpperCase()}] ${brand}/${site}: ${e.message}`);
    }
  }
}

console.log('\nDone.');

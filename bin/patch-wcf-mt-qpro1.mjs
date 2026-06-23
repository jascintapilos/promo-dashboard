#!/usr/bin/env node
// Patch the 9 WCF MT records on QPRO1 with fixed renderer output:
//   - World Cup themed subjects + intros
//   - SGD currency for SG locales (MY_EN/MY_ZH stay on MYR)
//
// Usage:
//   node bin/patch-wcf-mt-qpro1.mjs            -- dry run (renders but does NOT PUT)
//   node bin/patch-wcf-mt-qpro1.mjs --commit   -- live PUT

import { authedFetch } from '../src/api-client.js';
import { renderBody } from '../src/message-template-renderer.js';

const COMMIT = process.argv.includes('--commit');
const SITE = 'qpro1';

const LOCALE_TO_SETTINGS_ID = {
  MY_EN: 1, MY_ZH: 3, SG_EN: 6, SG_ZH: 7,
};

const PROMOS = [
  { code: 'WCF_FREEBET5',      mtId: 939, bonus_type: 'Free Credit',   promotion_name_en: 'World Cup Free Bet',      promotion_name_zh_id: '世界杯免费注码', parsed: { free_credit_amount: 5,    to_multiplier: 10 } },
  { code: 'WCF_FREEBET8',      mtId: 940, bonus_type: 'Free Credit',   promotion_name_en: 'World Cup Free Bet',      promotion_name_zh_id: '世界杯免费注码', parsed: { free_credit_amount: 8,    to_multiplier: 10 } },
  { code: 'WCF_FREEBET10',     mtId: 941, bonus_type: 'Free Credit',   promotion_name_en: 'World Cup Free Bet',      promotion_name_zh_id: '世界杯免费注码', parsed: { free_credit_amount: 10,   to_multiplier: 10 } },
  { code: 'WCF_VIP100GET20',   mtId: 942, bonus_type: 'Deposit Bonus', promotion_name_en: 'World Cup Reload Bonus',  promotion_name_zh_id: '世界杯充值奖励', parsed: { min_deposit: 100,  max_bonus: 20,  bonus_rate_pct: 100, to_multiplier: 15 } },
  { code: 'WCF_VIP200GET50',   mtId: 943, bonus_type: 'Deposit Bonus', promotion_name_en: 'World Cup Reload Bonus',  promotion_name_zh_id: '世界杯充值奖励', parsed: { min_deposit: 200,  max_bonus: 50,  bonus_rate_pct: 100, to_multiplier: 15 } },
  { code: 'WCF_VIP300GET60',   mtId: 944, bonus_type: 'Deposit Bonus', promotion_name_en: 'World Cup Reload Bonus',  promotion_name_zh_id: '世界杯充值奖励', parsed: { min_deposit: 300,  max_bonus: 60,  bonus_rate_pct: 100, to_multiplier: 15 } },
  { code: 'WCF_VIP400GET70',   mtId: 945, bonus_type: 'Deposit Bonus', promotion_name_en: 'World Cup Reload Bonus',  promotion_name_zh_id: '世界杯充值奖励', parsed: { min_deposit: 400,  max_bonus: 70,  bonus_rate_pct: 100, to_multiplier: 15 } },
  { code: 'WCF_VIP500GET88',   mtId: 946, bonus_type: 'Deposit Bonus', promotion_name_en: 'World Cup Reload Bonus',  promotion_name_zh_id: '世界杯充值奖励', parsed: { min_deposit: 500,  max_bonus: 88,  bonus_rate_pct: 100, to_multiplier: 15 } },
  { code: 'WCF_VIP1000GET888', mtId: 947, bonus_type: 'Deposit Bonus', promotion_name_en: 'World Cup Reload Bonus',  promotion_name_zh_id: '世界杯充值奖励', parsed: { min_deposit: 1000, max_bonus: 888, bonus_rate_pct: 100, to_multiplier: 15 } },
];

async function renderLocales(promo) {
  const resolved = {
    promo_code:           promo.code,
    bonus_type:           promo.bonus_type,
    promotion_name_en:    promo.promotion_name_en,
    promotion_name_zh_id: promo.promotion_name_zh_id,
    campaign:             'World Cup Festival',
    currencies:           ['MYR', 'SGD'],
    // Ingest semantics (sheet cols P/Q): validity_days = col P "Validity
    // (After Claim)" = 7; rewards_validity_days = col Q "Rewards Validity
    // (Before Claim)" = 30. The renderer bridges these to the template's
    // claim-window / after-claim sentence positions.
    validity_days:         7,   // col P — bonus valid 7 days AFTER claim
    rewards_validity_days: 30,  // col Q — 30-day claim window BEFORE claim
    parsed:               promo.parsed,
  };

  const details = {};
  for (const [locale, settingsId] of Object.entries(LOCALE_TO_SETTINGS_ID)) {
    const rendered = await renderBody({
      bonusType: promo.bonus_type,
      locale,
      brand:    'QPRO1',
      platform: 'qpro',
      resolved,
    });
    if (rendered.skipped) {
      console.log(`    SKIP ${locale}: ${rendered.reason}`);
      continue;
    }
    details[String(settingsId)] = {
      settings_locale_id: settingsId,
      subject: rendered.subject,
      message: rendered.html,
    };
  }
  return details;
}

async function run() {
  console.log(`\n=== WCF MT patch — QPRO1 (${COMMIT ? 'LIVE' : 'DRY RUN'}) ===\n`);

  for (const promo of PROMOS) {
    console.log(`[${promo.code}] mt_id=${promo.mtId}`);
    const details = await renderLocales(promo);

    for (const [sid, d] of Object.entries(details)) {
      const localeLabel = Object.entries(LOCALE_TO_SETTINGS_ID).find(([, v]) => v === d.settings_locale_id)?.[0] || sid;
      const curHit = d.message.includes('SGD') ? 'SGD' : d.message.includes('MYR') ? 'MYR' : '???';
      console.log(`    locale=${localeLabel}  subject="${d.subject}"  currency=${curHit}  bodyStart="${d.message.slice(0,60).replace(/\n/g,' ')}"`);
    }

    if (!COMMIT) {
      console.log(`    → DRY RUN: skipping PUT\n`);
      continue;
    }

    // GET existing MT to read top-level fields
    const existing = await authedFetch(SITE, `/api/bo/messagetemplate/${promo.mtId}`);
    const tmpl = existing?.data?.message_template || existing?.message_template || {};

    const putBody = {
      id:      promo.mtId,
      name:    tmpl.name || promo.code,
      section: tmpl.section ?? 8,
      type:    tmpl.type   ?? 1,
      status:  tmpl.status ?? 1,
      code:    tmpl.code   || `PROMOTIONS.MESSAGE.${promo.code}`,
      details,
    };

    const res = await authedFetch(SITE, `/api/bo/messagetemplate/${promo.mtId}`, {
      method: 'PUT',
      body:   putBody,
    });

    const ok = res?.code === 200 || res?.status === 'ok' || res?.data != null || res?.message_template != null;
    console.log(`    → PUT ${ok ? 'OK' : 'FAILED'}  raw=${JSON.stringify(res).slice(0, 120)}\n`);
  }

  console.log('Done.');
}

run().catch(err => { console.error(err); process.exit(1); });

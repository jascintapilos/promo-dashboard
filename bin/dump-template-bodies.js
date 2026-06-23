#!/usr/bin/env node
// Render Free Credit + Free Spin Message Template bodies for QP2 and QPRO,
// using realistic values that match the canary's `resolved.parsed.*` shape.

import { renderBody } from '../src/message-template-renderer.js';

// VIP-targeted FC (VM blast). No withdrawal cap, slots+live casino eligible.
const fcResolved = {
  promo_code: 'VIP_30FC_5X',
  brand: 'QP2A',
  bonus_type: 'free credit',
  bonus_sub_type: 'Free Credit',
  currencies: ['MYR'],
  validity_days: 1,
  rewards_validity_days: 1,
  promotion_name_en: 'VIP Exclusive Offer - 30 Free Credit',
  is_vip: true,
  parsed: {
    min_deposit: 0,
    bonus_rate_pct: 0,
    max_bonus: 30,
    to_multiplier: 5,
    categories: ['Slot', 'Live Casino'],
    max_transfer_out: 0,
    free_credit_amount: 30,
  },
  per_currency_overrides: { MYR: { max_transfer_out: 0, free_credit_amount: 30 } },
  locales: ['EN', 'ZH', 'ID'],
};

// Non-VIP FC for comparison (FastTrack public). Has a withdrawal cap.
const fcResolvedNonVip = {
  promo_code: 'FT_FC_50_3X',
  brand: 'QP2A',
  bonus_type: 'free credit',
  bonus_sub_type: 'Free Credit',
  currencies: ['MYR'],
  validity_days: 7,
  rewards_validity_days: 7,
  promotion_name_en: 'MYR 50 Free Credit',
  is_vip: false,
  parsed: {
    min_deposit: 0,
    bonus_rate_pct: 0,
    max_bonus: 50,
    to_multiplier: 3,
    categories: ['Slot', 'Live Casino'],
    max_transfer_out: 500,
    free_credit_amount: 50,
  },
  per_currency_overrides: { MYR: { max_transfer_out: 500, free_credit_amount: 50 } },
  locales: ['EN', 'ZH', 'ID'],
};

const fsResolved = {
  promo_code: 'FS50_SWEETBONANZA_20X',
  brand: 'QP2A',
  bonus_type: 'free spin',
  bonus_sub_type: 'Welcome',
  currencies: ['MYR'],
  validity_days: 14,
  rewards_validity_days: 14,
  promotion_name_en: '50 Free Spins on Sweet Bonanza',
  parsed: {
    min_deposit: 0,
    bonus_rate_pct: 0,
    max_bonus: 0,
    to_multiplier: 20,
    categories: ['Slot'],
    spin_count: 50,
    game_provider: 'PP2 - Pragmatic Play',
    game: 'Sweet Bonanza',
    transfer_amount: 50,
    max_transfer_out: 200,
  },
  per_currency_overrides: { MYR: { max_transfer_out: 200 } },
  locales: ['EN', 'ZH', 'ID'],
};

// Tabs differ by platform.
const TABS = {
  qp2:  ['MY_EN', 'MY_ZH', 'ID_EN', 'ID_ID'],
  qpro: ['MY_EN', 'MY_ZH'],
};

async function dump(label, bonus, resolved, platform, brand) {
  const tabs = TABS[platform];
  console.log(`\n\n══════════════════════════════════════════════════════════`);
  console.log(`${label}  (platform=${platform}, brand=${brand})`);
  console.log(`══════════════════════════════════════════════════════════`);
  for (const tab of tabs) {
    const r = await renderBody({ bonusType: bonus, locale: tab, brand, platform, resolved: { ...resolved, brand } });
    console.log(`\n──── TAB: ${tab}   docKey=${r.docKey}   slug=${r.slug} ────`);
    console.log(`Subject: ${r.subject}`);
    console.log(``);
    console.log(r.html);
  }
}

await dump('FREE CREDIT VIP — QP2',     'free credit', fcResolved,       'qp2',  'QP2A');
await dump('FREE CREDIT non-VIP — QP2', 'free credit', fcResolvedNonVip, 'qp2',  'QP2A');
await dump('FREE CREDIT VIP — QPRO',    'free credit', fcResolved,       'qpro', 'QPRO11');
await dump('FREE SPIN — QP2',           'free spin',   fsResolved,       'qp2',  'QP2A');
await dump('FREE SPIN — QPRO',          'free spin',   fsResolved,       'qpro', 'QPRO11');

// Comprehensive post-save QC for P164–P168 on QP2C (ibc22) + QPRO4.
// Compares live BO state to the ingest fixtures and flags any drift.

import { readFileSync } from 'fs';
import { authedFetch, getPromotionDetail } from '../src/api-client.js';

const BATCH = [
  { rn: 'P164', file: 'P164-r165.json', qp2c: 1209, qpro4: 425 },
  { rn: 'P165', file: 'P165-r166.json', qp2c: 1210, qpro4: 426 },
  { rn: 'P166', file: 'P166-r167.json', qp2c: 1211, qpro4: 427 },
  { rn: 'P167', file: 'P167-r168.json', qp2c: 1212, qpro4: 428 },
  { rn: 'P168', file: 'P168-r169.json', qp2c: 1213, qpro4: 429 },
];

const TICK = '✓', CROSS = '✗', WARN = '⚠';
let errors = 0, warnings = 0;

function cmp(label, expected, actual, opts = {}) {
  const ok = opts.test ? opts.test(expected, actual) : String(expected) === String(actual);
  const mark = ok ? TICK : (opts.warn ? WARN : CROSS);
  if (!ok) { if (opts.warn) warnings++; else errors++; }
  return { ok, line: `    ${mark} ${label}: expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}` };
}

async function qcOne(site, promoId, label, fixture, expectSgd) {
  console.log(`  ── ${label} #${promoId} ──`);
  const d = await getPromotionDetail(site, promoId);
  const det = await authedFetch(site, '/api/bo/promotion/' + promoId);
  const raw = det?.data?.rows || {};
  const curRows = (await authedFetch(site, '/api/bo/promotioncurrency?promotion_id=' + promoId))?.data?.rows || [];
  const nameRows = (await authedFetch(site, '/api/bo/promotionname?promotion_id=' + promoId))?.data?.rows || [];

  const lines = [];
  lines.push(cmp('promo_code', fixture.promo_code, d.promo_code).line);
  lines.push(cmp('validity_days', fixture.validity_days, d.validity_days).line);
  lines.push(cmp('rewards_validity_days', fixture.rewards_validity_days, d.rewards_validity_days).line);
  lines.push(cmp('recurring', fixture.recurring === true, d.recurring).line);
  lines.push(cmp('to_multiplier', fixture.parsed.to_multiplier, Number(d.parsed.to_multiplier)).line);
  lines.push(cmp('min_deposit', fixture.parsed.min_deposit, d.parsed.min_deposit).line);
  lines.push(cmp('max_bonus', fixture.parsed.max_bonus, d.parsed.max_bonus).line);
  lines.push(cmp('max_per_player', fixture.max_per_player, raw.max_per_player).line);
  lines.push(cmp('daily_max', fixture.daily_max, raw.daily_max).line);
  lines.push(cmp('status (active=1)', 1, raw.status).line);
  lines.push(cmp('message_template_id linked', true, !!raw.message_template_id, { test: (e, a) => a === e }).line);

  // Currency check
  const expectedCurs = expectSgd ? ['MYR', 'SGD'] : ['MYR'];
  const actualCurs = curRows.map(r => r.currency).sort();
  lines.push(cmp('currencies', expectedCurs.sort(), actualCurs, { test: (e, a) => JSON.stringify(e) === JSON.stringify(a) }).line);

  // Per-currency min_deposit + max_bonus
  for (const cur of expectedCurs) {
    const row = curRows.find(r => r.currency === cur);
    if (!row) { lines.push(`    ${CROSS} ${cur}: MISSING currency row`); errors++; continue; }
    lines.push(cmp(`${cur}.min_deposit`, fixture.parsed.min_deposit, Number(row.min_deposit)).line);
    lines.push(cmp(`${cur}.max_bonus`, fixture.parsed.max_bonus, Number(row.max_bonus)).line);
    lines.push(cmp(`${cur}.bonus_rate`, fixture.parsed.bonus_rate_pct, Number(row.bonus_rate)).line);
  }

  // Locales
  const expectedLocaleCount = expectSgd ? 4 : 2;
  lines.push(cmp('locale_count', expectedLocaleCount, nameRows.length).line);
  const enName = nameRows.find(n => n.locale?.endsWith('_EN'))?.promotion_name;
  const zhName = nameRows.find(n => n.locale?.endsWith('_ZH'))?.promotion_name;
  lines.push(cmp('name_en', fixture.promotion_name_en, enName).line);
  lines.push(cmp('name_zh', fixture.promotion_name_zh_id, zhName).line);

  // Popup (auto-created — fixture had popup_dialog:false but BO has them)
  const popupLinked = !!(raw.dialog_popup_list && raw.dialog_popup_list[0]?.popup_id);
  lines.push(cmp('dialog_popup linked (auto-created)', true, popupLinked, { warn: !popupLinked }).line);

  for (const l of lines) console.log(l);
}

(async () => {
  for (const row of BATCH) {
    const fixture = JSON.parse(readFileSync('./captures/requests/' + row.file, 'utf8'));
    console.log(`\n════════ ${row.rn}  (min_deposit=${fixture.parsed.min_deposit}) ════════`);
    await qcOne('ibc22', row.qp2c, 'QP2C', fixture, true);
    await qcOne('qpro4', row.qpro4, 'QPRO4', fixture, false);
  }
  console.log(`\n══════════════════════════════════════`);
  console.log(`  TOTAL: ${errors} error(s), ${warnings} warning(s)`);
  console.log(`══════════════════════════════════════`);
  process.exit(errors > 0 ? 1 : 0);
})().catch(e => { console.error('QC ERROR:', e.message); process.exit(2); });

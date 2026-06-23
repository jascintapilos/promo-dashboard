import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const site = getSite('ibc22');
const CODES = ['TEST_QP2_DEP_0608', 'TEST_QP2_FC_0608', 'TEST_QP2_FS_0608'];

const PROMO_TYPE = { '1':'Manual','2':'Deposit Bonus','3':'Free Credit','4':'Free Spin' };
const DEP_STATUS = { '1':'None','2':'Before Deposit','3':'First Deposit','4':'Last Deposit' };
const ok = (v, want) => v === want ? '✅' : `❌ got ${v}, want ${want}`;

for (const code of CODES) {
  console.log(`\n${'═'.repeat(62)}`);
  console.log(`QC: ${code}`);
  console.log('═'.repeat(62));

  const listResp = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(code)}&perPage=10`);
  const row = (listResp.data?.rows || []).find(r => r.code === code);
  if (!row) { console.log('  ✖ NOT FOUND'); continue; }

  const detResp = await authedFetch(site, `/api/bo/promotion/${row.id}`);
  const d = detResp.data?.rows || {};

  const namesResp = await authedFetch(site, `/api/bo/promotionname?promotion_id=${row.id}&perPage=50`);
  const names = namesResp.data?.rows || [];

  let mt = null;
  if (d.message_template_id) {
    try {
      const r = await authedFetch(site, `/api/bo/messagetemplate/${d.message_template_id}`);
      mt = r.data?.rows;
    } catch(e) { mt = { error: e.message }; }
  }

  const popups = Array.isArray(row.dialog_popup_list) ? row.dialog_popup_list : [];

  console.log(`\n  MAIN FIELDS`);
  console.log(`  promo_type          : ${d.promo_type} (${PROMO_TYPE[String(d.promo_type)] || '?'})`);
  console.log(`  promo_sub_type      : ${d.promo_sub_type}`);
  console.log(`  auto_reward_activ.  : ${ok(d.auto_reward_activation, 1)}`);
  console.log(`  auto_approve        : ${ok(d.auto_approve, 1)}`);
  console.log(`  auto_unlock         : ${ok(d.auto_unlock, 1)}`);
  console.log(`  allow_deposit       : ${ok(d.allow_deposit, 0)}`);
  console.log(`  deposit_status      : ${d.deposit_status} (${DEP_STATUS[String(d.deposit_status)] || '?'})`);
  console.log(`  freespin_check      : ${d.freespin_check}`);
  console.log(`  allow_cont_claim    : ${ok(d.allow_continuous_claim, 0)}`);
  console.log(`  withdrawal_unlock   : ${ok(d.withdrawal_unlock, 0)}`);
  console.log(`  fingerprint_check   : ${ok(d.fingerprint_check, 0)}`);
  console.log(`  recurring           : ${d.recurring}`);
  console.log(`  validity            : ${d.validity}d   reward_validity: ${d.reward_validity}d`);
  console.log(`  max_per_player      : ${d.max_per_player}   daily_max: ${d.daily_max}`);
  console.log(`  bonus_rate          : ${d.bonus_rate}`);

  const cats = Object.values(d.promotion_category_ids || {});
  console.log(`\n  CATEGORIES  (${cats.length}): [${cats.join(', ')}]  ${cats.length > 0 ? '✅' : '❌ EMPTY'}`);

  const gps = Object.values(d.game_provider_codes || {});
  console.log(`  GAME PROVIDERS (${gps.length}): ${gps.length > 5 ? gps.slice(0,5).join(',')+' ...' : gps.join(', ')}  ${gps.length > 0 ? '✅' : '❌ EMPTY'}`);

  const mgs = Object.values(d.member_group_ids || {});
  console.log(`  MEMBER GROUPS  (${mgs.length}): ${mgs.length >= 20 ? '✅' : mgs.length > 0 ? '⚠ only '+mgs.length : '❌ EMPTY'}`);

  const currs = Object.values(d.promotion_currency || {});
  console.log(`\n  CURRENCY BLOCKS (${currs.length}):`);
  for (const c of currs) {
    const parts = [
      `bonus_type=${c.bonus_type}`,
      c.bonus_amount != null ? `bonus_amount=${c.bonus_amount}` : null,
      c.bonus_rate   != null ? `bonus_rate=${c.bonus_rate}` : null,
      c.min_deposit  != null ? `min_dep=${c.min_deposit}` : null,
      c.max_bonus    != null ? `max_bonus=${c.max_bonus}` : null,
      c.rounds       != null ? `rounds=${c.rounds}` : null,
      c.amount_per_line != null ? `amt_per_line=${c.amount_per_line}` : null,
      `max_withdraw=${c.max_withdraw}`,
      `max_total_apps=${c.max_total_applications}`,
      `max_total_bonus=${c.max_total_bonus}`,
    ].filter(Boolean);
    console.log(`    [${c.currency}] ${parts.join('  ')}`);
  }

  console.log(`\n  NAMES (${names.length}):`);
  for (const n of names) {
    console.log(`    locale=${n.settings_locale_id} ccy=${n.currency_id}: "${n.promotion_name}"  ${n.promotion_name ? '✅' : '❌ EMPTY'}`);
  }

  console.log(`\n  MESSAGE TEMPLATE: id=${d.message_template_id || 'NONE'}`);
  if (mt && !mt.error) {
    const locales = Object.keys(mt.details || {});
    console.log(`    code=${mt.code}  status=${mt.status}  locales=[${locales.join(', ')}]  ${locales.length > 0 ? '✅' : '❌ NO DETAILS'}`);
    for (const [lid, det] of Object.entries(mt.details || {})) {
      console.log(`    [${lid}] subject="${det.subject}"  body=${det.message?.length || 0} chars`);
    }
  } else if (mt?.error) {
    console.log(`    ❌ ${mt.error}`);
  } else {
    console.log(`    ❌ none linked`);
  }

  console.log(`\n  DIALOG POPUP (${popups.length}):`);
  if (popups.length > 0) {
    for (const p of popups) {
      const pid = p.popup_id || p.id;
      console.log(`    id=${pid}  position=${p.position}  session=${p.session}  ✅`);
      try {
        const pr = await authedFetch(site, `/api/bo/popups/${pid}`);
        const pd = pr.data?.rows || {};
        const clocs = Object.keys(pd.contents || {});
        console.log(`    contents locales: [${clocs.join(', ')}]  ${clocs.length > 0 ? '✅' : '❌ EMPTY'}`);
        for (const [lid, con] of Object.entries(pd.contents || {})) {
          console.log(`    [${lid}] title="${con.title}"`);
          console.log(`          cta1="${con.cta_button_text_1}" → ${con.cta_button_link_1}`);
          console.log(`          cta2="${con.cta_button_text_2}" → ${con.cta_button_link_2}`);
          console.log(`          body=${con.content?.length || 0} chars`);
        }
      } catch(e) { console.log(`    ⚠ popup detail error: ${e.message}`); }
    }
  } else {
    console.log(`    ❌ NONE LINKED`);
  }
}
console.log(`\n${'═'.repeat(62)}\nQC complete.\n`);

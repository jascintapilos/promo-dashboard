// Probe the correct request-side field name for POST /api/bo/promotioncurrency
// 422 "Deposit options is required" persists even when we send `deposit_options`,
// so the field key on the request side must be different. Try a handful.

import { authedFetch } from '../src/api-client.js';

const SITE = 'ibc22';
const PROMO_ID = 1209;  // P164 QP2C — already has MYR, needs SGD added

// Pull the working SGD bank-account ID list from sibling promo 1208
const ref = await authedFetch(SITE, '/api/bo/promotioncurrency?promotion_id=1208');
const refSgd = (ref.data?.rows||[]).find(c => c.currency === 'SGD');
const sgdIds = refSgd.deposit_options;  // 180 IDs proven to work
console.log('reference SGD ids count:', sgdIds.length);

const baseBlock = {
  promotion_id: PROMO_ID,
  settings_currency_id: 3,
  currency: 'SGD',
  currency_id: 3,
  gmt: '+8',
  start_time: '00:00:00',
  end_time: '23:59:59',
  max_total_applications: 0,
  max_total_bonus: 0,
  bonus_type: 2,
  bonus_amount: 0,
  bonus_rate: 30,
  min_transfer: 1000,
  min_deposit: 1000,
  bypass_min_deposit: 0,
  max_withdraw_type: 1,
  max_withdraw: 0,
  max_bonus: 600,
  min_bonus: 0,
  threshold: 0,
  rounds: 0,
  amount_per_line: 0,
  lines: 0,
  coins: 0,
  status: 1,
  reset: 0,
  reset_name: 'None',
  promo_type: 2,
};

// Try multiple field-name variants — only one should pass validation.
const variants = [
  { label: 'deposit_options (array)',            patch: { deposit_options: sgdIds } },
  { label: 'deposit_options (obj-map)',          patch: { deposit_options: Object.fromEntries(sgdIds.map((id,i)=>[String(i),id])) } },
  { label: 'deposit_option (singular array)',    patch: { deposit_option: sgdIds } },
  { label: 'deposit_option_ids (array)',         patch: { deposit_option_ids: sgdIds } },
  { label: 'merchant_bank_account_ids (array)',  patch: { merchant_bank_account_ids: sgdIds } },
  { label: 'bank_ids (array)',                   patch: { bank_ids: sgdIds } },
  { label: 'depositOptions (camelCase)',         patch: { depositOptions: sgdIds } },
];

for (const v of variants) {
  const body = { ...baseBlock, ...v.patch };
  process.stdout.write('  ' + v.label.padEnd(40) + ' → ');
  try {
    const res = await authedFetch(SITE, '/api/bo/promotioncurrency', { method: 'POST', body });
    console.log('SUCCESS! id=' + res.data?.rows?.id);
    // Delete this row so we don't pile up dupes during the probe
    if (res.data?.rows?.id) {
      try { await authedFetch(SITE, '/api/bo/promotioncurrency/' + res.data.rows.id, { method: 'DELETE' }); console.log('     (cleaned up — DELETE ok)'); }
      catch (e) { console.log('     (could not DELETE — leftover row id=' + res.data.rows.id + ': ' + e.message.slice(0,60) + ')'); }
    }
    break;  // First success wins
  } catch (e) {
    const m = String(e.message).match(/HTTP (\d+)[\s\S]*?\n\s*(.+)/);
    console.log(m ? `${m[1]}  ${m[2].slice(0,80)}` : e.message.slice(0,100));
  }
}

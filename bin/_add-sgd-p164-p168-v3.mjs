// v3: Use CORRECT field name merchant_bank_ids (object-map), confirmed via
// Chrome XHR capture from the live BO form. Previous attempts used
// deposit_options which the server doesn't recognise → always 422.

import { readFileSync } from 'fs';
import { authedFetch } from '../src/api-client.js';

const SITE = 'ibc22';
const TARGETS = [
  { rn: 'P164', file: 'P164-r165.json', promoId: 1209, minDeposit: 1000 },
  { rn: 'P165', file: 'P165-r166.json', promoId: 1210, minDeposit: 1500 },
  { rn: 'P166', file: 'P166-r167.json', promoId: 1211, minDeposit: 2000 },
  { rn: 'P167', file: 'P167-r168.json', promoId: 1212, minDeposit: 2500 },
  { rn: 'P168', file: 'P168-r169.json', promoId: 1213, minDeposit: 3500 },
];

// 184 SGD bank IDs — full active set captured from live BO form
const SGD_BANK_IDS = [323,291,318,268,273,304,281,296,365,393,282,255,275,411,136,347,168,171,123,43,412,342,122,102,374,135,172,125,104,124,350,267,353,145,352,283,307,265,272,173,140,262,264,174,71,389,167,402,337,178,288,324,343,370,408,380,351,396,289,361,335,303,338,349,334,382,372,316,274,401,297,328,294,312,179,315,346,345,415,355,256,317,388,271,383,293,360,386,373,381,368,331,371,394,390,391,287,327,138,409,137,410,314,326,413,270,329,406,333,403,405,163,175,362,209,369,397,320,69,322,78,79,48,77,379,266,38,364,14,34,64,164,165,67,144,176,177,82,81,80,66,146,42,49,57,55,56,96,100,95,94,93,166,128,126,127,129,236,234,235,237,358,356,359,27,25,26,75,416,418,419,417,149,147,148,150,120,62,119,121,37,35,36,74];

const merchantBankIds = Object.fromEntries(SGD_BANK_IDS.map((id, i) => [String(i), id]));
console.log(`Using ${SGD_BANK_IDS.length} SGD bank IDs as merchant_bank_ids object-map\n`);

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

let pass = 0, fail = 0;

for (const t of TARGETS) {
  const fixture = JSON.parse(readFileSync('./captures/requests/' + t.file, 'utf8'));
  const r = fixture.parsed;
  const minDep = r?.min_deposit ?? t.minDeposit;
  const maxBonus = r?.max_bonus ?? 600;
  const bonusRate = r?.bonus_rate_pct ?? 30;

  // Check if SGD already exists
  const exist = await authedFetch(SITE, '/api/bo/promotioncurrency?promotion_id=' + t.promoId);
  const hasSgd = (exist.data?.rows || []).some(c => c.currency === 'SGD' || c.currency_id === 3);
  if (hasSgd) {
    const sgdRow = (exist.data?.rows || []).find(c => c.currency === 'SGD' || c.currency_id === 3);
    console.log(`  ${t.rn} #${t.promoId} — SGD already exists (id=${sgdRow?.id}), skip`);
    pass++;
    continue;
  }

  const body = {
    promotion_id: t.promoId,
    currency_id: '3',          // STRING — as captured from live BO form
    bonus_rate: bonusRate,
    bypass_min_deposit: 0,
    max_bonus: maxBonus,
    max_balance_claim: null,
    status: 1,
    reset: 0,
    start_time: '00:00:00',
    end_time: '23:59:59',
    min_deposit: minDep,
    max_withdraw_type: '1',    // STRING — as captured from live BO form
    max_withdraw: null,
    max_total_applications: null,
    max_total_bonus: null,
    merchant_bank_ids: merchantBankIds,
  };

  process.stdout.write(`  ${t.rn} #${t.promoId} (min_dep=${minDep}, max_bonus=${maxBonus}) → `);
  try {
    const res = await authedFetch(SITE, '/api/bo/promotioncurrency', { method: 'POST', body });
    console.log('SUCCESS id=' + res.data?.rows?.id);
    pass++;
  } catch (e) {
    const m = String(e.message).match(/HTTP (\d+)[\s\S]*?\n\s*(.+)/);
    console.log(m ? `FAIL ${m[1]} ${m[2].slice(0, 120)}` : e.message.slice(0, 200));
    fail++;
  }
  await sleep(800);
}

console.log(`\n══ POST results: ${pass} ok, ${fail} fail ══\n`);

// Verify final state
console.log('Final state:');
for (const t of TARGETS) {
  const r = await authedFetch(SITE, '/api/bo/promotioncurrency?promotion_id=' + t.promoId);
  const rows = r.data?.rows || [];
  const cs = rows.map(c => c.currency).sort().join(',');
  const sgd = rows.find(c => c.currency === 'SGD');
  const extra = sgd
    ? ` SGD id=${sgd.id} min_dep=${sgd.min_deposit} max_bonus=${sgd.max_bonus} banks=${Array.isArray(sgd.merchant_bank_ids) ? sgd.merchant_bank_ids.length : Object.keys(sgd.merchant_bank_ids || {}).length}`
    : ' (NO SGD)';
  console.log(`  ${t.rn} #${t.promoId}: [${cs}]${extra}`);
}

process.exit(fail > 0 ? 1 : 0);

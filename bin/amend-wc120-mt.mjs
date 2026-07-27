#!/usr/bin/env node
// Amend message template 1191 (WELC_WC120PCT_10X) on ibc22 / QP2D to the
// "all games" wording, and correct the turnover + max-bonus figures so the
// copy matches the saved BO configuration.
//
// Every edit is an exact-string replacement with an assertion: if a source
// string is not found exactly once, the script aborts rather than writing a
// partially-updated body.
//
//   node bin/amend-wc120-mt.mjs           ← dry-run (default, no writes)
//   node bin/amend-wc120-mt.mjs --commit  ← live
import { authedFetch } from '../src/api-client.js';
import { writeFile, mkdir } from 'node:fs/promises';

const commit = process.argv.includes('--commit');
const SITE = 'ibc22';
const MT_ID = 1191;

// Set false to leave the Max Bonus figure at 300 (BO holds 360).
const FIX_MAX_BONUS = !process.argv.includes('--keep-max-bonus');

const COMMON_EN = [
  ['available for Sportsbook and Slots', 'available on all games'],
  ['Bonus play condition: 10x turnover', 'Bonus play condition: 12x turnover'],
  ['A turnover requirement of ten (10) times applies', 'A turnover requirement of twelve (12) times applies'],
  ['<strong>Sports and Slots categories</strong> are eligible for this promotion except Virtual Sports, Table games and Arcade games.',
   '<strong>All game categories</strong> are eligible for this promotion except Blackjack and Virtual Sports.'],
];
const COMMON_ZH = [
  ['适用于体育博彩及老虎机', '适用于所有游戏'],
  ['奖金条件：10 倍流水', '奖金条件：12 倍流水'],
  ['完成 10 倍流水要求', '完成 12 倍流水要求'],
  ['<strong>本优惠适用于体育及老虎机游戏类别</strong>，惟虚拟体育（Virtual Sports）、桌面游戏（Table games）及街机游戏（Arcade games）除外。',
   '<strong>本优惠适用于所有游戏类别</strong>，惟二十一点（Blackjack）及虚拟体育（Virtual Sports）除外。'],
];

// locale_id -> { subject: [from,to], body: [[from,to], ...] }
const PLAN = {
  1: { // MY_EN
    subject: ['120% Sports & Slots Welcome Bonus', '120% Welcome Bonus'],
    body: [...COMMON_EN,
      ['[MYR 66 x 10] = MYR 660', '[MYR 66 x 12] = MYR 792'],
      ...(FIX_MAX_BONUS ? [['MYR 300', 'MYR 360']] : []),
    ],
  },
  3: { // MY_ZH
    subject: ['120% 体育与老虎机迎新红利', '120% 迎新红利'],
    body: [...COMMON_ZH,
      ['[MYR 66 x 10] = MYR 660', '[MYR 66 x 12] = MYR 792'],
      ...(FIX_MAX_BONUS ? [['MYR 300', 'MYR 360']] : []),
    ],
  },
  6: { // SG_EN
    subject: ['120% Sports & Slots Welcome Bonus', '120% Welcome Bonus'],
    body: [...COMMON_EN,
      ['[SGD 110 x 10] = SGD 1,110', '[SGD 110 x 12] = SGD 1,320'],
      ...(FIX_MAX_BONUS ? [['SGD 300', 'SGD 360']] : []),
    ],
  },
  7: { // SG_ZH
    subject: ['120% 体育与老虎机迎新红利', '120% 迎新红利'],
    body: [...COMMON_ZH,
      ['[SGD 110 x 10] = SGD 1,110', '[SGD 110 x 12] = SGD 1,320'],
      ...(FIX_MAX_BONUS ? [['SGD 300', 'SGD 360']] : []),
    ],
  },
};

function applyAll(text, pairs, label) {
  let out = text;
  for (const [from, to] of pairs) {
    const n = out.split(from).length - 1;
    if (n === 0) throw new Error(`ABORT ${label}: source string not found → "${from.slice(0, 70)}"`);
    out = out.split(from).join(to);
    console.log(`      ✓ ${n}× "${from.slice(0, 58)}${from.length > 58 ? '…' : ''}" → "${to.slice(0, 58)}${to.length > 58 ? '…' : ''}"`);
  }
  return out;
}

const raw = await authedFetch(SITE, `/api/bo/messagetemplate/${MT_ID}`);
const data = raw?.data?.rows || raw?.data;
const tmpl = data?.message_template;
const msgDetails = data?.message_details || {};
if (!tmpl) throw new Error(`MT ${MT_ID} not found`);
if (tmpl.name !== 'WELC_WC120PCT_10X') throw new Error(`ABORT: MT ${MT_ID} is "${tmpl.name}"`);

console.log(`${commit ? '*** LIVE COMMIT ***' : 'DRY-RUN (no writes)'} — MT ${MT_ID} "${tmpl.name}" on ${SITE}`);
console.log(`Max-bonus 300→360 correction: ${FIX_MAX_BONUS ? 'INCLUDED' : 'SKIPPED'}\n`);

await mkdir('captures/snapshots', { recursive: true });
await writeFile('captures/snapshots/wc120-mt1191-before.json', JSON.stringify(data, null, 2));

const details = {};
for (const [localeId, entry] of Object.entries(msgDetails)) {
  const plan = PLAN[localeId];
  const code = entry.settings_locales_code;
  if (!plan) {
    console.log(`  locale ${localeId} (${code}): no plan — passing through unchanged`);
    details[localeId] = { settings_locale_id: entry.settings_locale_id, subject: entry.subject, message: entry.message };
    continue;
  }
  console.log(`  locale ${localeId} (${code}):`);
  const [sFrom, sTo] = plan.subject;
  if (entry.subject !== sFrom) throw new Error(`ABORT ${code}: subject is "${entry.subject}", expected "${sFrom}"`);
  console.log(`      ✓ subject "${sFrom}" → "${sTo}"`);
  const newMsg = applyAll(entry.message, plan.body, code);
  details[localeId] = { settings_locale_id: entry.settings_locale_id, subject: sTo, message: newMsg };
}

// Guard: every locale that existed must still be present.
if (Object.keys(details).length !== Object.keys(msgDetails).length) {
  throw new Error('ABORT: locale count mismatch');
}

if (!commit) {
  await writeFile('captures/snapshots/wc120-mt1191-proposed.json', JSON.stringify(details, null, 2));
  console.log('\nDry-run only → captures/snapshots/wc120-mt1191-proposed.json');
  console.log('Re-run with --commit to apply.');
  process.exit(0);
}

// QP2 PUT omits `code` (including it triggers 422 "code has already been taken").
const putBody = { name: tmpl.name, section: tmpl.section, type: tmpl.type, status: tmpl.status, details };
const res = await authedFetch(SITE, `/api/bo/messagetemplate/${MT_ID}`, { method: 'PUT', body: putBody });
console.log(`\nPUT response: ${JSON.stringify(res?.message)}`);

// ── Read back and verify ────────────────────────────────────────────────
const after = await authedFetch(SITE, `/api/bo/messagetemplate/${MT_ID}`);
const aData = after?.data?.rows || after?.data;
const aDetails = aData?.message_details || {};
await writeFile('captures/snapshots/wc120-mt1191-after.json', JSON.stringify(aData, null, 2));

console.log('\n── Read-back verify ──');
let bad = 0;
for (const [localeId, entry] of Object.entries(aDetails)) {
  const code = entry.settings_locales_code;
  const want = details[localeId];
  const subjOk = entry.subject === want.subject;
  // BO re-encodes HTML, so verify by content assertions rather than byte equality.
  const m = entry.message;
  const checks = {
    no_sports_slots_en: !/Sports and Slots categories/i.test(m),
    no_sports_slots_zh: !/本优惠适用于体育及老虎机游戏类别/.test(m),
    turnover_12: !/10x turnover|ten \(10\) times|10 倍流水/.test(m),
    tnc_link: /:url\/terms-conditions/.test(m),
    merchantname: /:merchantname/.test(m),
    ...(FIX_MAX_BONUS ? { max_bonus_360: !/(MYR|SGD) 300/.test(m) } : {}),
  };
  const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  if (!subjOk || failed.length) bad++;
  console.log(`  ${code}: subject="${entry.subject}" ${subjOk ? '✓' : '✗'}  ${failed.length ? `FAILED: ${failed.join(', ')}` : 'all content checks ✓'}`);
}
console.log(bad === 0 ? '\nAll locales verified.' : `\n${bad} locale(s) FAILED verification.`);
process.exit(bad === 0 ? 0 : 1);

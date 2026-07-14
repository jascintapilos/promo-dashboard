// Final content fix for all 78 Whale Probe SMS MTs.
// Changes from last update:
//   EN: Credits→FC, Slots→SL, Bonus→BNS, Live Casino→LC, drop "TO: x"
//   ZH: 老虎机→SL, 真人赌场→LC, 奖金→BNS, drop 流水x倍
//
// Usage:
//   node bin/fix-whale-sms-final.mjs          # dry-run
//   node bin/fix-whale-sms-final.mjs --commit

import { parseArgs } from './_args.js';
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const { flags } = parseArgs(process.argv.slice(2));
const COMMIT = flags.commit === true;

const L1 = 1, L3 = 3, L6 = 6, L7 = 7;

// ── Detail builders ───────────────────────────────────────────────────

function fcQpro(amount, locales) {
  const d = {};
  if (locales.has(L1)) d[L1] = {
    settings_locale_id: L1,
    subject: `You've Got ${amount} FC — Yours to Claim!`,
    message: `RM0 :brandname: :username , ${amount} FC are yours — no strings attached! Claim now: :url`,
  };
  if (locales.has(L3)) d[L3] = {
    settings_locale_id: L3,
    subject: `您有${amount}体验金等您领取！`,
    message: `RM0 :brandname：:username ${amount} 体验金等您领取！立即领取：:url`,
  };
  if (locales.has(L6)) d[L6] = {
    settings_locale_id: L6,
    subject: `You've Got ${amount} FC — Yours to Claim!`,
    message: `:brandname: :username , ${amount} FC are yours — no strings attached! Claim now: :url`,
  };
  if (locales.has(L7)) d[L7] = {
    settings_locale_id: L7,
    subject: `您有${amount}体验金等您领取！`,
    message: `:brandname：:username ${amount} 体验金等您领取！立即领取：:url`,
  };
  return d;
}

function fcQp2(amount) {
  return {
    [L1]: { settings_locale_id: L1, subject: `You've Got ${amount} FC — Yours to Claim!`, message: `RM0 :merchantname: :username , ${amount} FC are yours — no strings attached! Claim now: :url` },
    [L3]: { settings_locale_id: L3, subject: `您有${amount}体验金等您领取！`, message: `RM0 :merchantname：:username ${amount} 体验金等您领取！立即领取：:url` },
    [L6]: { settings_locale_id: L6, subject: `You've Got ${amount} FC — Yours to Claim!`, message: `:merchantname: :username , ${amount} FC are yours — no strings attached! Claim now: :url` },
    [L7]: { settings_locale_id: L7, subject: `您有${amount}体验金等您领取！`, message: `:merchantname：:username ${amount} 体验金等您领取！立即领取：:url` },
  };
}

const R88_QPRO = {
  [L1]: { settings_locale_id: L1, subject: 'Your Exclusive 88% SL Reload BNS is Ready!', message: 'RM0 :brandname: :username , a personalised 88% SL Reload BNS awaits you! Claim now: :url' },
  [L3]: { settings_locale_id: L3, subject: '您的专属88% SL 回充BNS已准备好！', message: 'RM0 :brandname：:username 您的专属88% SL 回充BNS等您领取！立即领取：:url' },
  [L6]: { settings_locale_id: L6, subject: 'Your Exclusive 88% SL Reload BNS is Ready!', message: ':brandname: :username , a personalised 88% SL Reload BNS awaits you! Claim now: :url' },
  [L7]: { settings_locale_id: L7, subject: '您的专属88% SL 回充BNS已准备好！', message: ':brandname：:username 您的专属88% SL 回充BNS等您领取！立即领取：:url' },
};

const R88_QP2 = {
  [L1]: { settings_locale_id: L1, subject: 'Your Exclusive 88% SL Reload BNS is Ready!', message: 'RM0 :merchantname: :username , a personalised 88% SL Reload BNS awaits you! Claim now: :url' },
  [L3]: { settings_locale_id: L3, subject: '您的专属88% SL 回充BNS已准备好！', message: 'RM0 :merchantname：:username 您的专属88% SL 回充BNS等您领取！立即领取：:url' },
  [L6]: { settings_locale_id: L6, subject: 'Your Exclusive 88% SL Reload BNS is Ready!', message: ':merchantname: :username , a personalised 88% SL Reload BNS awaits you! Claim now: :url' },
  [L7]: { settings_locale_id: L7, subject: '您的专属88% SL 回充BNS已准备好！', message: ':merchantname：:username 您的专属88% SL 回充BNS等您领取！立即领取：:url' },
};

const R20_QPRO = {
  [L1]: { settings_locale_id: L1, subject: 'Your Exclusive 20% LC Reload BNS is Waiting!', message: 'RM0 :brandname: :username , a personalised 20% LC Reload BNS is ready for you! Claim now: :url' },
  [L3]: { settings_locale_id: L3, subject: '您的专属20% LC 回充BNS等您领取！', message: 'RM0 :brandname：:username 您的专属20% LC 回充BNS已为您准备好！立即领取：:url' },
  [L6]: { settings_locale_id: L6, subject: 'Your Exclusive 20% LC Reload BNS is Waiting!', message: ':brandname: :username , a personalised 20% LC Reload BNS is ready for you! Claim now: :url' },
  [L7]: { settings_locale_id: L7, subject: '您的专属20% LC 回充BNS等您领取！', message: ':brandname：:username 您的专属20% LC 回充BNS已为您准备好！立即领取：:url' },
};

const R20_QP2 = {
  [L1]: { settings_locale_id: L1, subject: 'Your Exclusive 20% LC Reload BNS is Waiting!', message: 'RM0 :merchantname: :username , a personalised 20% LC Reload BNS is ready for you! Claim now: :url' },
  [L3]: { settings_locale_id: L3, subject: '您的专属20% LC 回充BNS等您领取！', message: 'RM0 :merchantname：:username 您的专属20% LC 回充BNS已为您准备好！立即领取：:url' },
  [L6]: { settings_locale_id: L6, subject: 'Your Exclusive 20% LC Reload BNS is Waiting!', message: ':merchantname: :username , a personalised 20% LC Reload BNS is ready for you! Claim now: :url' },
  [L7]: { settings_locale_id: L7, subject: '您的专属20% LC 回充BNS等您领取！', message: ':merchantname：:username 您的专属20% LC 回充BNS已为您准备好！立即领取：:url' },
};

// ── MT ID map ─────────────────────────────────────────────────────────
const FC_IDS = {
  qpro1:  { FC88: 1097, FC118: 1098, FC138: 1099, FC148: 1100 },
  qpro2:  { FC88:  487, FC118:  488, FC138:  489, FC148:  490 },
  qpro3:  { FC88:  571, FC118:  572, FC138:  573, FC148:  574 },
  qpro4:  { FC88:  503, FC118:  504, FC138:  505, FC148:  506 },
  qpro5:  { FC88:  402, FC118:  403, FC138:  404, FC148:  405 },
  qpro6:  { FC88:  649, FC118:  650, FC138:  651, FC148:  652 },
  qpro7:  { FC88:  595, FC118:  596, FC138:  597, FC148:  598 },
  qpro8:  { FC88:  721, FC118:  722, FC138:  723, FC148:  724 },
  qpro9:  { FC88:  527, FC118:  528, FC138:  529, FC148:  530 },
  qpro10: { FC88:  587, FC118:  588, FC138:  589, FC148:  590 },
  qpro15: { FC88:  409, FC118:  410, FC138:  411, FC148:  412 },
  qpro16: { FC88:  386, FC118:  387, FC138:  388, FC148:  389 },
  ibc22:  { FC88: 1316, FC118: 1317, FC138: 1318, FC148: 1319 },
};

const RELOAD_IDS = {
  qpro1:  { '88PCT': 1101, '20PCT': 1102 },
  qpro2:  { '88PCT':  491, '20PCT':  492 },
  qpro3:  { '88PCT':  575, '20PCT':  576 },
  qpro4:  { '88PCT':  507, '20PCT':  508 },
  qpro5:  { '88PCT':  406, '20PCT':  407 },
  qpro6:  { '88PCT':  653, '20PCT':  654 },
  qpro7:  { '88PCT':  599, '20PCT':  600 },
  qpro8:  { '88PCT':  725, '20PCT':  726 },
  qpro9:  { '88PCT':  531, '20PCT':  532 },
  qpro10: { '88PCT':  591, '20PCT':  592 },
  qpro15: { '88PCT':  413, '20PCT':  414 },
  qpro16: { '88PCT':  390, '20PCT':  391 },
  ibc22:  { '88PCT': 1320, '20PCT': 1321 },
};

const FC_AMOUNTS = { FC88: 88, FC118: 118, FC138: 138, FC148: 148 };
const ALL_LOCALES = new Set([1, 3, 6, 7]);

async function put(site, id, name, details) {
  if (!COMMIT) return { dry: true };
  return authedFetch(site, `/api/bo/messagetemplate/${id}`, {
    method: 'PUT',
    body: { name, section: 8, type: 2, status: 1, details },
  });
}

// ── Main ──────────────────────────────────────────────────────────────
console.log(COMMIT ? '▶ COMMIT MODE' : '▶ DRY RUN');
console.log('Final content update — 78 MTs\n');

let ok = 0, err = 0;

// FC SMS
console.log('── FC SMS (52) ──');
for (const [siteId, ids] of Object.entries(FC_IDS)) {
  const isQP2 = siteId === 'ibc22';
  const site  = getSite(siteId);
  for (const [key, amount] of Object.entries(FC_AMOUNTS)) {
    const name    = `SMS WHALE_VM_PROBE_NODEP_FC${amount}_20X`;
    const details = isQP2 ? fcQp2(amount) : fcQpro(amount, ALL_LOCALES);
    try {
      const r = await put(site, ids[key], name, details);
      r?.dry ? console.log(`  [dry] ${siteId} MT#${ids[key]} ${key}`) : (console.log(`  ✓ ${siteId} MT#${ids[key]} ${key}`), ok++);
    } catch (e) {
      console.log(`  ✗ ${siteId} MT#${ids[key]} ${key}: ${e.message.slice(0, 80)}`);
      err++;
    }
  }
}

// Reload SMS
console.log('\n── Reload SMS (26) ──');
for (const [siteId, ids] of Object.entries(RELOAD_IDS)) {
  const isQP2 = siteId === 'ibc22';
  const site  = getSite(siteId);
  for (const type of ['88PCT', '20PCT']) {
    const name    = `SMS WHALE_CRM_PROBE_${type}_RELOAD`;
    const details = isQP2
      ? (type === '88PCT' ? R88_QP2 : R20_QP2)
      : (type === '88PCT' ? R88_QPRO : R20_QPRO);
    try {
      const r = await put(site, ids[type], name, details);
      r?.dry ? console.log(`  [dry] ${siteId} MT#${ids[type]} ${type}`) : (console.log(`  ✓ ${siteId} MT#${ids[type]} ${type}`), ok++);
    } catch (e) {
      console.log(`  ✗ ${siteId} MT#${ids[type]} ${type}: ${e.message.slice(0, 80)}`);
      err++;
    }
  }
}

if (COMMIT) console.log(`\n── Summary ──\n✓ Updated: ${ok}  ✗ Errors: ${err}`);

// Fix all 78 Whale Probe SMS MTs:
//  - :brandnamemys{dot}com / :brandname{dot}com / :merchantname*{dot}com → :url
//  - FC bodies: "Free Credits" → "Credits", remove "no deposit needed"
//  - FC subjects: remove "免费" / "无需存款"
//  - ZH reload bodies: "存款奖金" → "回充奖金"
//
// Usage:
//   node bin/fix-whale-sms-url-content.mjs          # dry-run
//   node bin/fix-whale-sms-url-content.mjs --commit  # live write

import { parseArgs } from './_args.js';
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const { flags } = parseArgs(process.argv.slice(2));
const COMMIT = flags.commit === true;

const L1 = 1, L3 = 3, L6 = 6, L7 = 7; // MY_EN, MY_ZH, SG_EN, SG_ZH

// ── Corrected detail builders ─────────────────────────────────────────

function fcQproDetails(amount, locales) {
  const d = {};
  if (locales.has(L1)) d[L1] = {
    settings_locale_id: L1,
    subject: `You've Got ${amount} Credits — Yours to Claim!`,
    message: `RM0 :brandname: :username , ${amount} Credits are yours — no strings attached! TO: 20x. Claim now: :url`,
  };
  if (locales.has(L3)) d[L3] = {
    settings_locale_id: L3,
    subject: `您有${amount}体验金等您领取！`,
    message: `RM0 :brandname：:username ${amount} 体验金等您领取！流水20倍。立即领取：:url`,
  };
  if (locales.has(L6)) d[L6] = {
    settings_locale_id: L6,
    subject: `You've Got ${amount} Credits — Yours to Claim!`,
    message: `:brandname: :username , ${amount} Credits are yours — no strings attached! TO: 20x. Claim now: :url`,
  };
  if (locales.has(L7)) d[L7] = {
    settings_locale_id: L7,
    subject: `您有${amount}体验金等您领取！`,
    message: `:brandname：:username ${amount} 体验金等您领取！流水20倍。立即领取：:url`,
  };
  return d;
}

function fcQp2Details(amount) {
  return {
    [L1]: { settings_locale_id: L1, subject: `You've Got ${amount} Credits — Yours to Claim!`, message: `RM0 :merchantname: :username , ${amount} Credits are yours — no strings attached! TO: 20x. Claim now: :url` },
    [L3]: { settings_locale_id: L3, subject: `您有${amount}体验金等您领取！`, message: `RM0 :merchantname：:username ${amount} 体验金等您领取！流水20倍。立即领取：:url` },
    [L6]: { settings_locale_id: L6, subject: `You've Got ${amount} Credits — Yours to Claim!`, message: `:merchantname: :username , ${amount} Credits are yours — no strings attached! TO: 20x. Claim now: :url` },
    [L7]: { settings_locale_id: L7, subject: `您有${amount}体验金等您领取！`, message: `:merchantname：:username ${amount} 体验金等您领取！流水20倍。立即领取：:url` },
  };
}

const RELOAD_QPRO = {
  '88PCT': {
    details: {
      [L1]: { settings_locale_id: L1, subject: 'Your Exclusive 88% Slots Reload Bonus is Ready!', message: 'RM0 :brandname: :username , a personalised 88% Slots Reload Bonus awaits you! TO: 10x. Claim now: :url' },
      [L3]: { settings_locale_id: L3, subject: '您的专属88%老虎机回充奖金已准备好！', message: 'RM0 :brandname：:username 您的专属88%老虎机回充奖金等您领取！流水10倍。立即领取：:url' },
      [L6]: { settings_locale_id: L6, subject: 'Your Exclusive 88% Slots Reload Bonus is Ready!', message: ':brandname: :username , a personalised 88% Slots Reload Bonus awaits you! TO: 10x. Claim now: :url' },
      [L7]: { settings_locale_id: L7, subject: '您的专属88%老虎机回充奖金已准备好！', message: ':brandname：:username 您的专属88%老虎机回充奖金等您领取！流水10倍。立即领取：:url' },
    },
  },
  '20PCT': {
    details: {
      [L1]: { settings_locale_id: L1, subject: 'Your Exclusive 20% Live Casino Reload is Waiting!', message: 'RM0 :brandname: :username , a personalised 20% Live Casino Reload Bonus is ready for you! TO: 15x. Claim now: :url' },
      [L3]: { settings_locale_id: L3, subject: '您的专属20%真人赌场回充奖金等您领取！', message: 'RM0 :brandname：:username 您的专属20%真人赌场回充奖金已为您准备好！流水15倍。立即领取：:url' },
      [L6]: { settings_locale_id: L6, subject: 'Your Exclusive 20% Live Casino Reload is Waiting!', message: ':brandname: :username , a personalised 20% Live Casino Reload Bonus is ready for you! TO: 15x. Claim now: :url' },
      [L7]: { settings_locale_id: L7, subject: '您的专属20%真人赌场回充奖金等您领取！', message: ':brandname：:username 您的专属20%真人赌场回充奖金已为您准备好！流水15倍。立即领取：:url' },
    },
  },
};

const RELOAD_QP2 = {
  '88PCT': {
    details: {
      [L1]: { settings_locale_id: L1, subject: 'Your Exclusive 88% Slots Reload Bonus is Ready!', message: 'RM0 :merchantname: :username , a personalised 88% Slots Reload Bonus awaits you! TO: 10x. Claim now: :url' },
      [L3]: { settings_locale_id: L3, subject: '您的专属88%老虎机回充奖金已准备好！', message: 'RM0 :merchantname：:username 您的专属88%老虎机回充奖金等您领取！流水10倍。立即领取：:url' },
      [L6]: { settings_locale_id: L6, subject: 'Your Exclusive 88% Slots Reload Bonus is Ready!', message: ':merchantname: :username , a personalised 88% Slots Reload Bonus awaits you! TO: 10x. Claim now: :url' },
      [L7]: { settings_locale_id: L7, subject: '您的专属88%老虎机回充奖金已准备好！', message: ':merchantname：:username 您的专属88%老虎机回充奖金等您领取！流水10倍。立即领取：:url' },
    },
  },
  '20PCT': {
    details: {
      [L1]: { settings_locale_id: L1, subject: 'Your Exclusive 20% Live Casino Reload is Waiting!', message: 'RM0 :merchantname: :username , a personalised 20% Live Casino Reload Bonus is ready for you! TO: 15x. Claim now: :url' },
      [L3]: { settings_locale_id: L3, subject: '您的专属20%真人赌场回充奖金等您领取！', message: 'RM0 :merchantname：:username 您的专属20%真人赌场回充奖金已为您准备好！流水15倍。立即领取：:url' },
      [L6]: { settings_locale_id: L6, subject: 'Your Exclusive 20% Live Casino Reload is Waiting!', message: ':merchantname: :username , a personalised 20% Live Casino Reload Bonus is ready for you! TO: 15x. Claim now: :url' },
      [L7]: { settings_locale_id: L7, subject: '您的专属20%真人赌场回充奖金等您领取！', message: ':merchantname：:username 您的专属20%真人赌场回充奖金已为您准备好！流水15倍。立即领取：:url' },
    },
  },
};

// ── MT ID map (from creation output) ─────────────────────────────────
// FC SMS — keyed by siteId → { FC88, FC118, FC138, FC148 }
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

// Reload SMS — keyed by siteId → { '88PCT', '20PCT' }
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

async function putMT(site, id, name, section, type, details) {
  if (!COMMIT) return { dry: true };
  const res = await authedFetch(site, `/api/bo/messagetemplate/${id}`, {
    method: 'PUT',
    body: { name, section, type, status: 1, details },
  });
  return res;
}

// ── Main ──────────────────────────────────────────────────────────────
console.log(COMMIT ? '▶ COMMIT MODE' : '▶ DRY RUN');
console.log('Updating 78 MTs: 52 FC + 26 reload\n');

let ok = 0, err = 0;

const QPRO_SITES = ['qpro1','qpro2','qpro3','qpro4','qpro5','qpro6','qpro7','qpro8','qpro9','qpro10','qpro15','qpro16'];

// ── FC SMS updates ────────────────────────────────────────────────────
console.log('── FC SMS (52 MTs) ──');
for (const [siteId, ids] of Object.entries(FC_IDS)) {
  const isQP2 = siteId === 'ibc22';
  const site  = getSite(siteId);
  for (const [key, amount] of Object.entries(FC_AMOUNTS)) {
    const mtId   = ids[key];
    const code   = `WHALE_VM_PROBE_NODEP_FC${amount}_20X`;
    const name   = `SMS ${code}`;
    const details = isQP2
      ? fcQp2Details(amount)
      : fcQproDetails(amount, ALL_LOCALES);
    try {
      const r = await putMT(site, mtId, name, 8, 2, details);
      if (r?.dry) {
        console.log(`  [dry] ${siteId} MT#${mtId} ${key}`);
      } else {
        console.log(`  ✓ ${siteId} MT#${mtId} ${key}`);
        ok++;
      }
    } catch (e) {
      console.log(`  ✗ ${siteId} MT#${mtId} ${key}: ${e.message.slice(0, 80)}`);
      err++;
    }
  }
}

// ── Reload SMS updates ────────────────────────────────────────────────
console.log('\n── Reload SMS (26 MTs) ──');
for (const [siteId, ids] of Object.entries(RELOAD_IDS)) {
  const isQP2 = siteId === 'ibc22';
  const site  = getSite(siteId);
  for (const type of ['88PCT', '20PCT']) {
    const mtId   = ids[type];
    const name   = `SMS WHALE_CRM_PROBE_${type}_RELOAD`;
    const details = isQP2 ? RELOAD_QP2[type].details : RELOAD_QPRO[type].details;
    try {
      const r = await putMT(site, mtId, name, 8, 2, details);
      if (r?.dry) {
        console.log(`  [dry] ${siteId} MT#${mtId} ${type}`);
      } else {
        console.log(`  ✓ ${siteId} MT#${mtId} ${type}`);
        ok++;
      }
    } catch (e) {
      console.log(`  ✗ ${siteId} MT#${mtId} ${type}: ${e.message.slice(0, 80)}`);
      err++;
    }
  }
}

if (COMMIT) {
  console.log(`\n── Summary ──`);
  console.log(`✓ Updated: ${ok}  ✗ Errors: ${err}`);
}

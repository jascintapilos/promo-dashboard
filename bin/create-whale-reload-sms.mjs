// One-shot: create SMS (section=8 type=2) message templates for
// Whale Probe reload bonuses — 2 templates per BO (88PCT + 20PCT).
//
// Usage:
//   node bin/create-whale-reload-sms.mjs          # dry-run
//   node bin/create-whale-reload-sms.mjs --commit  # live write

import { parseArgs } from './_args.js';
import { createMessageTemplate } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const { flags } = parseArgs(process.argv.slice(2));
const COMMIT = flags.commit === true;

const QPRO_SITES = [
  'qpro1','qpro2','qpro3','qpro4','qpro5','qpro6',
  'qpro7','qpro8','qpro9','qpro10','qpro15','qpro16',
];
const QP2_SITE = 'ibc22';

const LOCALE_MY_EN = 1;
const LOCALE_MY_ZH = 3;
const LOCALE_SG_EN = 6;
const LOCALE_SG_ZH = 7;

// ── QPRO template definitions ─────────────────────────────────────────
const QPRO_TEMPLATES = [
  {
    name: 'SMS WHALE_CRM_PROBE_88PCT_RELOAD',
    code: 'PROMOTIONS.SMS.WHALE_CRM_PROBE_88PCT',
    details: {
      [LOCALE_MY_EN]: {
        settings_locale_id: LOCALE_MY_EN,
        subject: 'Your Exclusive 88% Slots Reload Bonus is Ready!',
        message: 'RM0 :brandname: :username , a personalised 88% Slots Reload Bonus awaits you! TO: 10x. Claim now: :brandnamemys{dot}com',
      },
      [LOCALE_MY_ZH]: {
        settings_locale_id: LOCALE_MY_ZH,
        subject: '您的专属88%老虎机存款奖金已准备好！',
        message: 'RM0 :brandname：:username 您的专属88%老虎机存款奖金等您领取！流水10倍。立即领取：:brandnamemys{dot}com',
      },
      [LOCALE_SG_EN]: {
        settings_locale_id: LOCALE_SG_EN,
        subject: 'Your Exclusive 88% Slots Reload Bonus is Ready!',
        message: ':brandname: :username , a personalised 88% Slots Reload Bonus awaits you! TO: 10x. Claim now: :brandname{dot}com',
      },
      [LOCALE_SG_ZH]: {
        settings_locale_id: LOCALE_SG_ZH,
        subject: '您的专属88%老虎机存款奖金已准备好！',
        message: ':brandname：:username 您的专属88%老虎机存款奖金等您领取！流水10倍。立即领取：:brandname{dot}com',
      },
    },
  },
  {
    name: 'SMS WHALE_CRM_PROBE_20PCT_RELOAD',
    code: 'PROMOTIONS.SMS.WHALE_CRM_PROBE_20PCT',
    details: {
      [LOCALE_MY_EN]: {
        settings_locale_id: LOCALE_MY_EN,
        subject: 'Your Exclusive 20% Live Casino Reload is Waiting!',
        message: 'RM0 :brandname: :username , a personalised 20% Live Casino Reload Bonus is ready for you! TO: 15x. Claim now: :brandnamemys{dot}com',
      },
      [LOCALE_MY_ZH]: {
        settings_locale_id: LOCALE_MY_ZH,
        subject: '您的专属20%真人赌场存款奖金等您领取！',
        message: 'RM0 :brandname：:username 您的专属20%真人赌场存款奖金已为您准备好！流水15倍。立即领取：:brandnamemys{dot}com',
      },
      [LOCALE_SG_EN]: {
        settings_locale_id: LOCALE_SG_EN,
        subject: 'Your Exclusive 20% Live Casino Reload is Waiting!',
        message: ':brandname: :username , a personalised 20% Live Casino Reload Bonus is ready for you! TO: 15x. Claim now: :brandname{dot}com',
      },
      [LOCALE_SG_ZH]: {
        settings_locale_id: LOCALE_SG_ZH,
        subject: '您的专属20%真人赌场存款奖金等您领取！',
        message: ':brandname：:username 您的专属20%真人赌场存款奖金已为您准备好！流水15倍。立即领取：:brandname{dot}com',
      },
    },
  },
];

// ── QP2 template definitions ──────────────────────────────────────────
const QP2_TEMPLATES = [
  {
    name: 'SMS WHALE_CRM_PROBE_88PCT_RELOAD',
    code: 'PROMOTIONS.SMS.WHALE_CRM_PROBE_88PCT',
    details: {
      [LOCALE_MY_EN]: {
        settings_locale_id: LOCALE_MY_EN,
        subject: 'Your Exclusive 88% Slots Reload Bonus is Ready!',
        message: 'RM0 :merchantname: :username , a personalised 88% Slots Reload Bonus awaits you! TO: 10x. Claim now: :merchantnamemy(dot)com',
      },
      [LOCALE_MY_ZH]: {
        settings_locale_id: LOCALE_MY_ZH,
        subject: '您的专属88%老虎机存款奖金已准备好！',
        message: 'RM0 :merchantname：:username 您的专属88%老虎机存款奖金等您领取！流水10倍。立即领取：:merchantnamemy(dot)com',
      },
      [LOCALE_SG_EN]: {
        settings_locale_id: LOCALE_SG_EN,
        subject: 'Your Exclusive 88% Slots Reload Bonus is Ready!',
        message: ':merchantname: :username , a personalised 88% Slots Reload Bonus awaits you! TO: 10x. Claim now: :merchantnamesg(dot)com',
      },
      [LOCALE_SG_ZH]: {
        settings_locale_id: LOCALE_SG_ZH,
        subject: '您的专属88%老虎机存款奖金已准备好！',
        message: ':merchantname：:username 您的专属88%老虎机存款奖金等您领取！流水10倍。立即领取：:merchantnamesg(dot)com',
      },
    },
  },
  {
    name: 'SMS WHALE_CRM_PROBE_20PCT_RELOAD',
    code: 'PROMOTIONS.SMS.WHALE_CRM_PROBE_20PCT',
    details: {
      [LOCALE_MY_EN]: {
        settings_locale_id: LOCALE_MY_EN,
        subject: 'Your Exclusive 20% Live Casino Reload is Waiting!',
        message: 'RM0 :merchantname: :username , a personalised 20% Live Casino Reload Bonus is ready for you! TO: 15x. Claim now: :merchantnamemy(dot)com',
      },
      [LOCALE_MY_ZH]: {
        settings_locale_id: LOCALE_MY_ZH,
        subject: '您的专属20%真人赌场存款奖金等您领取！',
        message: 'RM0 :merchantname：:username 您的专属20%真人赌场存款奖金已为您准备好！流水15倍。立即领取：:merchantnamemy(dot)com',
      },
      [LOCALE_SG_EN]: {
        settings_locale_id: LOCALE_SG_EN,
        subject: 'Your Exclusive 20% Live Casino Reload is Waiting!',
        message: ':merchantname: :username , a personalised 20% Live Casino Reload Bonus is ready for you! TO: 15x. Claim now: :merchantnamesg(dot)com',
      },
      [LOCALE_SG_ZH]: {
        settings_locale_id: LOCALE_SG_ZH,
        subject: '您的专属20%真人赌场存款奖金等您领取！',
        message: ':merchantname：:username 您的专属20%真人赌场存款奖金已为您准备好！流水15倍。立即领取：:merchantnamesg(dot)com',
      },
    },
  },
];

// ── Create helper ─────────────────────────────────────────────────────
async function createSMS(site, tpl) {
  if (!COMMIT) return { dry: true };
  const res = await createMessageTemplate(site, {
    name: tpl.name,
    section: 8,
    type: 2,
    status: 1,
    details: tpl.details,
    code: tpl.code,
  });
  const id = res?.data?.rows?.id ?? res?.rows?.id ?? res?.id;
  return { id };
}

// ── Main ──────────────────────────────────────────────────────────────
console.log(COMMIT ? '▶ COMMIT MODE — writing to BO' : '▶ DRY RUN — no writes');
console.log('Creating 26 SMS templates (2 per BO × 13 BOs)\n');

const results = [];

for (const siteId of QPRO_SITES) {
  const site = getSite(siteId);
  for (const tpl of QPRO_TEMPLATES) {
    try {
      const r = await createSMS(site, tpl);
      if (r.dry) {
        console.log(`[dry] ${siteId}: ${tpl.name}`);
      } else {
        console.log(`  ✓ ${siteId}: ${tpl.name} → MT#${r.id}`);
        results.push({ site: siteId, name: tpl.name, mtId: r.id });
      }
    } catch (e) {
      console.log(`  ✗ ${siteId}: ${tpl.name}: ${e.message.slice(0, 80)}`);
      results.push({ site: siteId, name: tpl.name, error: e.message.slice(0, 80) });
    }
  }
}

const qp2Site = getSite(QP2_SITE);
for (const tpl of QP2_TEMPLATES) {
  try {
    const r = await createSMS(qp2Site, tpl);
    if (r.dry) {
      console.log(`[dry] ibc22: ${tpl.name}`);
    } else {
      console.log(`  ✓ ibc22: ${tpl.name} → MT#${r.id}`);
      results.push({ site: 'ibc22', name: tpl.name, mtId: r.id });
    }
  } catch (e) {
    console.log(`  ✗ ibc22: ${tpl.name}: ${e.message.slice(0, 80)}`);
    results.push({ site: 'ibc22', name: tpl.name, error: e.message.slice(0, 80) });
  }
}

if (COMMIT) {
  const ok  = results.filter((r) => r.mtId).length;
  const err = results.filter((r) => r.error).length;
  console.log(`\n── Summary ──`);
  console.log(`✓ Created: ${ok}  ✗ Errors: ${err}`);
  if (err) results.filter((r) => r.error).forEach((r) => console.log(`  ${r.site} ${r.name}: ${r.error}`));
}

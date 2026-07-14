// One-shot: create SMS (section=8 type=2) message templates for
// WHALE_VM_PROBE_NODEP_FC88/118/138/148_20X across all QPRO + QP2 brands.
//
// Usage:
//   node bin/create-whale-probe-sms.mjs          # dry-run
//   node bin/create-whale-probe-sms.mjs --commit  # live write

import { parseArgs } from './_args.js';
import { authedFetch, createMessageTemplate } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const { flags } = parseArgs(process.argv.slice(2));
const COMMIT = flags.commit === true;

// ── Promos ─────────────────────────────────────────────────────────────
const PROMOS = [
  { code: 'WHALE_VM_PROBE_NODEP_FC88_20X',  amount: 88  },
  { code: 'WHALE_VM_PROBE_NODEP_FC118_20X', amount: 118 },
  { code: 'WHALE_VM_PROBE_NODEP_FC138_20X', amount: 138 },
  { code: 'WHALE_VM_PROBE_NODEP_FC148_20X', amount: 148 },
];

// ── Targets ────────────────────────────────────────────────────────────
const QPRO_SITES = [
  'qpro1','qpro2','qpro3','qpro4','qpro5','qpro6',
  'qpro7','qpro8','qpro9','qpro10','qpro15','qpro16',
];
const QP2_SITE = 'ibc22';

// Locale IDs: 1=MY_EN, 3=MY_ZH, 6=SG_EN, 7=SG_ZH
const LOCALE_MY_EN = 1;
const LOCALE_MY_ZH = 3;
const LOCALE_SG_EN = 6;
const LOCALE_SG_ZH = 7;

// ── Body builders ──────────────────────────────────────────────────────
function qproDetails(amount, locales) {
  const d = {};
  if (locales.has(LOCALE_MY_EN)) d[LOCALE_MY_EN] = {
    settings_locale_id: LOCALE_MY_EN,
    subject: `You've Got ${amount} Free Credits — No Deposit!`,
    message: `RM0 :brandname: :username , ${amount} Free Credits are yours — no deposit needed! TO: 20x. Claim now: :brandnamemys{dot}com`,
  };
  if (locales.has(LOCALE_MY_ZH)) d[LOCALE_MY_ZH] = {
    settings_locale_id: LOCALE_MY_ZH,
    subject: `您获得了${amount}免费体验金 — 无需存款！`,
    message: `RM0 :brandname：:username ${amount} 免费体验金等您领取，无需存款！流水20倍。立即领取：:brandnamemys{dot}com`,
  };
  if (locales.has(LOCALE_SG_EN)) d[LOCALE_SG_EN] = {
    settings_locale_id: LOCALE_SG_EN,
    subject: `You've Got ${amount} Free Credits — No Deposit!`,
    message: `:brandname: :username , ${amount} Free Credits are yours — no deposit needed! TO: 20x. Claim now: :brandname{dot}com`,
  };
  if (locales.has(LOCALE_SG_ZH)) d[LOCALE_SG_ZH] = {
    settings_locale_id: LOCALE_SG_ZH,
    subject: `您获得了${amount}免费体验金 — 无需存款！`,
    message: `:brandname：:username ${amount} 免费体验金等您领取，无需存款！流水20倍。立即领取：:brandname{dot}com`,
  };
  return d;
}

function qp2Details(amount) {
  return {
    [LOCALE_MY_EN]: {
      settings_locale_id: LOCALE_MY_EN,
      subject: `You've Got ${amount} Free Credits — No Deposit!`,
      message: `RM0 :merchantname: :username , ${amount} Free Credits are yours — no deposit needed! TO: 20x. Claim now: :merchantnamemy(dot)com`,
    },
    [LOCALE_MY_ZH]: {
      settings_locale_id: LOCALE_MY_ZH,
      subject: `您获得了${amount}免费体验金 — 无需存款！`,
      message: `RM0 :merchantname：:username ${amount} 免费体验金等您领取，无需存款！流水20倍。立即领取：:merchantnamemy(dot)com`,
    },
    [LOCALE_SG_EN]: {
      settings_locale_id: LOCALE_SG_EN,
      subject: `You've Got ${amount} Free Credits — No Deposit!`,
      message: `:merchantname: :username , ${amount} Free Credits are yours — no deposit needed! TO: 20x. Claim now: :merchantnamesg(dot)com`,
    },
    [LOCALE_SG_ZH]: {
      settings_locale_id: LOCALE_SG_ZH,
      subject: `您获得了${amount}免费体验金 — 无需存款！`,
      message: `:merchantname：:username ${amount} 免费体验金等您领取，无需存款！流水20倍。立即领取：:merchantnamesg(dot)com`,
    },
  };
}

// ── Helpers ────────────────────────────────────────────────────────────

// Read the existing inbox MT for a promo code on a site and return its locale set.
// Falls back to MY-only if not found.
async function getExistingLocales(site, promoCode) {
  try {
    const res = await authedFetch(site, `/api/bo/messagetemplate?page=1&perPage=200`);
    const rows = res?.rows || res?.data?.rows || [];
    const arr = Array.isArray(rows) ? rows : (rows?.data || []);
    const match = arr.find((t) => t.name === promoCode && t.type == 1);
    if (!match) return new Set([LOCALE_MY_EN, LOCALE_MY_ZH]); // fallback MY-only
    // Read detail to get locale ids
    const det = await authedFetch(site, `/api/bo/messagetemplate/${match.id}`);
    const details = (det?.rows || det?.data?.rows || det?.data || det)?.message_details || {};
    return new Set(Object.keys(details).map(Number).filter(Boolean));
  } catch {
    return new Set([LOCALE_MY_EN, LOCALE_MY_ZH]);
  }
}

async function createSMS(site, promo, details) {
  const body = {
    name: `SMS ${promo.code}`,
    section: 8,
    type: 2,
    status: 1,
    details,
    code: `PROMOTIONS.SMS.${promo.code}`,
  };
  if (!COMMIT) return { dry: true, body };
  const res = await createMessageTemplate(site, body);
  const id = res?.data?.rows?.id ?? res?.rows?.id ?? res?.id;
  return { id, code: promo.code };
}

// ── Main ───────────────────────────────────────────────────────────────
console.log(COMMIT ? '▶ COMMIT MODE — writing to BO' : '▶ DRY RUN — no writes');
console.log(`Creating ${PROMOS.length * (QPRO_SITES.length + 1)} SMS templates\n`);

const results = [];

// ── QPRO brands ────────────────────────────────────────────────────────
for (const siteId of QPRO_SITES) {
  const site = getSite(siteId);
  // Get locale set from existing inbox MT for first promo (same across all 4)
  const locales = await getExistingLocales(site, PROMOS[0].code);
  console.log(`${siteId}: locales=[${[...locales].join(',')}]`);

  for (const promo of PROMOS) {
    const details = qproDetails(promo.amount, locales);
    try {
      const r = await createSMS(site, promo, details);
      if (r.dry) {
        console.log(`  [dry] ${promo.code} → ${Object.keys(details).length} locales`);
      } else {
        console.log(`  ✓ ${promo.code} → MT#${r.id}`);
        results.push({ site: siteId, code: promo.code, mtId: r.id });
      }
    } catch (e) {
      console.log(`  ✗ ${promo.code}: ${e.message.slice(0, 80)}`);
      results.push({ site: siteId, code: promo.code, error: e.message.slice(0, 80) });
    }
  }
}

// ── QP2 (ibc22) ────────────────────────────────────────────────────────
console.log(`\nibc22 (QP2): 4 locales [MY+SG EN+ZH]`);
const qp2Site = getSite(QP2_SITE);
for (const promo of PROMOS) {
  const details = qp2Details(promo.amount);
  try {
    const r = await createSMS(qp2Site, promo, details);
    if (r.dry) {
      console.log(`  [dry] ${promo.code} → 4 locales`);
    } else {
      console.log(`  ✓ ${promo.code} → MT#${r.id}`);
      results.push({ site: 'ibc22', code: promo.code, mtId: r.id });
    }
  } catch (e) {
    console.log(`  ✗ ${promo.code}: ${e.message.slice(0, 80)}`);
    results.push({ site: 'ibc22', code: promo.code, error: e.message.slice(0, 80) });
  }
}

// ── Summary ────────────────────────────────────────────────────────────
if (COMMIT) {
  const ok  = results.filter((r) => r.mtId).length;
  const err = results.filter((r) => r.error).length;
  console.log(`\n── Summary ──`);
  console.log(`✓ Created: ${ok}  ✗ Errors: ${err}`);
  if (err) {
    console.log('Failures:');
    results.filter((r) => r.error).forEach((r) => console.log(`  ${r.site} ${r.code}: ${r.error}`));
  }
}

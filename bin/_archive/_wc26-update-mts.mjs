#!/usr/bin/env node
// Re-skin MT subject + opening hook paragraph with World Cup theme for
// P005-P009 on QP2D + QPRO2. Preserves How-to-Redeem / Promo Details table /
// Bonus Condition Example / full Terms and Conditions verbatim — only the
// marketing hook (subject + first <p>) changes.
//
// Usage: node bin/_wc26-update-mts.mjs           # dry-run
//        node bin/_wc26-update-mts.mjs --commit   # live

import { getSite } from '../src/sites.js';
import { authedFetch, findPromotionByCode } from '../src/api-client.js';

const COMMIT = process.argv.includes('--commit');

const TARGETS = [
  { rn: 'P005', code: 'VIP_100FC_5x_SPRTS',    brand: 'QP2D',  site: 'ibc22', merchantId: 4, kind: 'fc'     },
  { rn: 'P005', code: 'VIP_100FC_5x_SPRTS',    brand: 'QPRO2', site: 'qpro2',                 kind: 'fc'     },
  { rn: 'P006', code: 'VIP_160FC_5x_SPRTS',    brand: 'QP2D',  site: 'ibc22', merchantId: 4, kind: 'fc'     },
  { rn: 'P006', code: 'VIP_160FC_5x_SPRTS',    brand: 'QPRO2', site: 'qpro2',                 kind: 'fc'     },
  { rn: 'P007', code: 'VIP_250FC_5x_SPRTS',    brand: 'QP2D',  site: 'ibc22', merchantId: 4, kind: 'fc'     },
  { rn: 'P007', code: 'VIP_250FC_5x_SPRTS',    brand: 'QPRO2', site: 'qpro2',                 kind: 'fc'     },
  { rn: 'P008', code: 'VIP_REL_30PCT_12X_GLD', brand: 'QP2D',  site: 'ibc22', merchantId: 4, kind: 'reload' },
  { rn: 'P008', code: 'VIP_REL_30PCT_12X_GLD', brand: 'QPRO2', site: 'qpro2',                 kind: 'reload' },
  { rn: 'P009', code: 'VIP_REL_30PCT_12X_DMD', brand: 'QP2D',  site: 'ibc22', merchantId: 4, kind: 'reload' },
  { rn: 'P009', code: 'VIP_REL_30PCT_12X_DMD', brand: 'QPRO2', site: 'qpro2',                 kind: 'reload' },
];

// ── World Cup hook copy (subject + opening paragraph only) ────────────────
const FC_HOOK = {
  en: {
    subjectPrefix: '⚽ World Cup Kickoff Bonus — ',
    para: 'The World Cup is here, and the excitement is contagious! As one of our premier members, we’ve reserved an exclusive Free Bet just for you — score big and enjoy the tournament with credits on the house.',
  },
  zh: {
    subjectPrefix: '⚽ 世界杯开踢大礼 — ',
    para: '世界杯盛宴正式开踢，激情满满！作为我们最尊贵的会员，我们特别为您预留了专属免费体验金——尽享绿茵场上的精彩，体验金由我们买单！',
  },
};
const RELOAD_HOOK = {
  en: {
    subjectPrefix: '🏆 World Cup Reload Bonus — ',
    para: 'The World Cup fever is on, and we’re upping the stakes! As one of our most valued members, your exclusive World Cup reload bonus is ready and waiting. Top up now and get in on the action.',
  },
  zh: {
    subjectPrefix: '🏆 世界杯充值奖励 — ',
    para: '世界杯热潮席卷而来，我们与您共襄盛举！作为我们最尊贵的会员，专属世界杯充值奖励已为您备妥——即刻充值，尽情投入这场精彩赛事。',
  },
};

function localeLang(settingsLocaleId) {
  // 1=MY_EN, 3=MY_ZH, 6=SG_EN, 7=SG_ZH
  return (settingsLocaleId === 3 || settingsLocaleId === 7) ? 'zh' : 'en';
}

function reskinMessage(originalMessage, kind, lang) {
  const hook = kind === 'fc' ? FC_HOOK[lang] : RELOAD_HOOK[lang];
  // Replace the FIRST <p>...</p> block (the marketing hook) with the new copy.
  // Everything from "How to Redeem"/"Promo Details:" onward is untouched.
  const firstPClose = originalMessage.indexOf('</p>');
  if (firstPClose === -1) return originalMessage; // safety: don't touch if shape unexpected
  const rest = originalMessage.slice(firstPClose + 4);
  return `<p>${hook.para}</p>${rest}`;
}

function reskinSubject(originalSubject, kind, lang) {
  const hook = kind === 'fc' ? FC_HOOK[lang] : RELOAD_HOOK[lang];
  // Strip old generic prefix, keep the amount/pct suffix (e.g. "— 100 Free Credits")
  const dashIdx = originalSubject.indexOf(' — ');
  const suffix = dashIdx !== -1 ? originalSubject.slice(dashIdx + 3) : originalSubject;
  return `${hook.subjectPrefix}${suffix}`;
}

console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`WC26 MT RE-SKIN — ${COMMIT ? 'LIVE (--commit)' : 'DRY-RUN'}`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

const results = [];
for (const t of TARGETS) {
  const site = getSite(t.site);
  const found = await findPromotionByCode(site, t.code, t.merchantId ? { merchantId: t.merchantId } : {});
  if (!found) { console.log(`${t.rn} ${t.brand}: promo NOT FOUND`); results.push({ ...t, ok: false }); continue; }

  const mtDetail = await authedFetch(site, `/api/bo/messagetemplate/${(await authedFetch(site, `/api/bo/promotion/${found.id}`))?.data?.rows?.message_template_id}`);
  const tmpl = mtDetail?.data?.message_template;
  const details = mtDetail?.data?.message_details;
  if (!tmpl || !details) { console.log(`${t.rn} ${t.brand}: MT not found`); results.push({ ...t, ok: false }); continue; }

  const detailsArr = Array.isArray(details) ? details : Object.entries(details);
  const newDetails = {};
  for (const [key, d] of (Array.isArray(details) ? details.map((d, i) => [String(i), d]) : Object.entries(details))) {
    const lang = localeLang(d.settings_locale_id);
    newDetails[key] = {
      id: d.id,
      settings_locale_id: d.settings_locale_id,
      subject: reskinSubject(d.subject, t.kind, lang),
      message: reskinMessage(d.message, t.kind, lang),
    };
  }

  console.log(`\n── ${t.rn} ${t.brand} (promo=${found.id}, mt=${tmpl.id}) ──`);
  for (const [key, d] of Object.entries(newDetails)) {
    console.log(`  [locale=${d.settings_locale_id}] "${d.subject}"`);
  }

  if (COMMIT) {
    const putBody = {
      id: tmpl.id,
      code: tmpl.code,
      name: tmpl.name,
      section: tmpl.section,
      type: tmpl.type,
      status: tmpl.status,
      details: newDetails,
    };
    try {
      const res = await authedFetch(site, `/api/bo/messagetemplate/${tmpl.id}`, { method: 'PUT', body: putBody });
      const ok = res?.success !== false;
      console.log(`  → PUT: ${ok ? '✅ OK' : '❌ ' + JSON.stringify(res).slice(0, 200)}`);
      results.push({ ...t, ok });
    } catch (e) {
      console.log(`  → PUT: ❌ ${e.message.split('\n')[0].slice(0, 200)}`);
      results.push({ ...t, ok: false, err: e.message });
    }
  } else {
    results.push({ ...t, ok: true, dry: true });
  }
}

console.log(`\n\nSummary: ${results.filter(r => r.ok).length}/${results.length} ${COMMIT ? 'updated' : 'would update'}`);
if (!COMMIT) console.log('Re-run with --commit to apply.');

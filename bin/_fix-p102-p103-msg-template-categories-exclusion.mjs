// Add the inverse-category exclusion clause to the P102/P103 message-template
// categories T&C line. Replaces the simpler "All game categories are eligible
// for this promotion." (from the earlier grammar fix) with the FC-style
// "All game categories are eligible for this promotion except Blackjack and
// Virtual Sports." structure. EN + ZH on QPRO3/4/5/9 (8 templates).
//
// Usage: node bin/_fix-p102-p103-msg-template-categories-exclusion.mjs [--commit]

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const COMMIT = process.argv.includes('--commit');

const REPLACEMENTS = {
  1: {  // MY_EN
    find:    '<li>All game categories are eligible for this promotion.</li>',
    replace: '<li>All game categories are eligible for this promotion except Blackjack and Virtual Sports.</li>',
  },
  3: {  // MY_ZH
    find:    '<li>本优惠适用于所有游戏类别。</li>',
    replace: '<li>除了 二十一点和虚拟体育 外，所有游戏类别均适用于此优惠活动。</li>',
  },
};

const TARGETS = [
  { rn: 'P102', brand: 'QPRO3', siteId: 'qpro3', tmplId: 410 },
  { rn: 'P102', brand: 'QPRO4', siteId: 'qpro4', tmplId: 332 },
  { rn: 'P102', brand: 'QPRO5', siteId: 'qpro5', tmplId: 261 },
  { rn: 'P102', brand: 'QPRO9', siteId: 'qpro9', tmplId: 467 },
  { rn: 'P103', brand: 'QPRO3', siteId: 'qpro3', tmplId: 411 },
  { rn: 'P103', brand: 'QPRO4', siteId: 'qpro4', tmplId: 333 },
  { rn: 'P103', brand: 'QPRO5', siteId: 'qpro5', tmplId: 262 },
  { rn: 'P103', brand: 'QPRO9', siteId: 'qpro9', tmplId: 468 },
];

console.log(`Mode: ${COMMIT ? 'LIVE' : 'DRY-RUN'}`);

async function patchTemplate({ rn, brand, siteId, tmplId }) {
  const site = getSite(siteId);
  const res = await authedFetch(site, `/api/bo/messagetemplate/${tmplId}`);
  const mt = res.data.message_template;
  const md = res.data.message_details || {};

  const details = {};
  const changedLocales = [];
  for (const [localeKey, row] of Object.entries(md)) {
    const localeId = Number(localeKey);
    const rep = REPLACEMENTS[localeId];
    let message = row.message;
    if (rep && message.includes(rep.find)) {
      message = message.split(rep.find).join(rep.replace);
      changedLocales.push(localeId);
    }
    details[localeKey] = {
      settings_locale_id: localeId,
      subject: row.subject,
      message,
    };
  }

  if (changedLocales.length === 0) {
    console.log(`  ${rn} ${brand} tmpl=${tmplId} — no matching line found (already updated?)`);
    return;
  }

  if (!COMMIT) {
    console.log(`  ${rn} ${brand} tmpl=${tmplId} — would update locales: ${changedLocales.join(', ')}`);
    return;
  }

  const body = { id: tmplId, name: mt.name, section: mt.section, type: mt.type, status: mt.status, code: mt.code, details };
  await authedFetch(site, `/api/bo/messagetemplate/${tmplId}`, { method: 'PUT', body });
  console.log(`  ${rn} ${brand} tmpl=${tmplId} ✓ updated locales: ${changedLocales.join(', ')}`);
}

for (const t of TARGETS) {
  try {
    await patchTemplate(t);
  } catch (e) {
    console.log(`  ${t.rn} ${t.brand} tmpl=${t.tmplId} ✗ ${e.message.split('\n')[0]}`);
  }
}

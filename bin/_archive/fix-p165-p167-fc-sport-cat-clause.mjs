// Fix P165/P166/P167 FC message templates: replace all-categories clause with
// Sports-specific clause for EN and ZH locales across 8 brands (QPRO3/4/5/7/10/15/16 + QP2C).
//
// Root cause: FC body template lacked the {{#if_all_categories}} conditional that
// Deposit templates already had. When categories_only=SPORT was set, the body still
// rendered "All game categories are eligible..." instead of "Sports categories are eligible..."
//
// Fixed in src/message-template-bodies/free-credit/EN.html + ZH.html + ID.html.
//
// Usage: node bin/_archive/fix-p165-p167-fc-sport-cat-clause.mjs [--commit]

import { authedFetch } from '../../src/api-client.js';
import { getSite } from '../../src/sites.js';

const COMMIT = process.argv.includes('--commit');

const REPLACEMENTS = {
  1: {  // MY_EN
    find:    '<li>Sports categories are eligible for this promotion except Virtual Sports and Number Games.</li>',
    replace: '<li>Sports category is eligible for this promotion except Virtual Sports and Number Games.</li>',
  },
  6: {  // SG_EN
    find:    '<li>Sports categories are eligible for this promotion except Virtual Sports and Number Games.</li>',
    replace: '<li>Sports category is eligible for this promotion except Virtual Sports and Number Games.</li>',
  },
  // ZH (locales 3+7) already correct from first patch run — no change needed
};

const TARGETS = [
  // P165 — WC_GLD_100FC_10X
  { rn: 'P165', brand: 'QP2C',   siteId: 'ibc22',  tmplId: 1219 },
  { rn: 'P165', brand: 'QPRO10', siteId: 'qpro10', tmplId: 522  },
  { rn: 'P165', brand: 'QPRO15', siteId: 'qpro15', tmplId: 345  },
  { rn: 'P165', brand: 'QPRO16', siteId: 'qpro16', tmplId: 322  },
  { rn: 'P165', brand: 'QPRO3',  siteId: 'qpro3',  tmplId: 504  },
  { rn: 'P165', brand: 'QPRO4',  siteId: 'qpro4',  tmplId: 436  },
  { rn: 'P165', brand: 'QPRO5',  siteId: 'qpro5',  tmplId: 338  },
  { rn: 'P165', brand: 'QPRO7',  siteId: 'qpro7',  tmplId: 531  },
  // P166 — WC_PLT_188FC_10X
  { rn: 'P166', brand: 'QP2C',   siteId: 'ibc22',  tmplId: 1220 },
  { rn: 'P166', brand: 'QPRO10', siteId: 'qpro10', tmplId: 523  },
  { rn: 'P166', brand: 'QPRO15', siteId: 'qpro15', tmplId: 346  },
  { rn: 'P166', brand: 'QPRO16', siteId: 'qpro16', tmplId: 323  },
  { rn: 'P166', brand: 'QPRO3',  siteId: 'qpro3',  tmplId: 505  },
  { rn: 'P166', brand: 'QPRO4',  siteId: 'qpro4',  tmplId: 437  },
  { rn: 'P166', brand: 'QPRO5',  siteId: 'qpro5',  tmplId: 339  },
  { rn: 'P166', brand: 'QPRO7',  siteId: 'qpro7',  tmplId: 532  },
  // P167 — WC_DMD_288FC_10X
  { rn: 'P167', brand: 'QP2C',   siteId: 'ibc22',  tmplId: 1221 },
  { rn: 'P167', brand: 'QPRO10', siteId: 'qpro10', tmplId: 524  },
  { rn: 'P167', brand: 'QPRO15', siteId: 'qpro15', tmplId: 347  },
  { rn: 'P167', brand: 'QPRO16', siteId: 'qpro16', tmplId: 324  },
  { rn: 'P167', brand: 'QPRO3',  siteId: 'qpro3',  tmplId: 506  },
  { rn: 'P167', brand: 'QPRO4',  siteId: 'qpro4',  tmplId: 438  },
  { rn: 'P167', brand: 'QPRO5',  siteId: 'qpro5',  tmplId: 340  },
  { rn: 'P167', brand: 'QPRO7',  siteId: 'qpro7',  tmplId: 533  },
];

console.log(`Mode: ${COMMIT ? 'LIVE' : 'DRY-RUN'}`);
console.log(`Targets: ${TARGETS.length} templates\n`);

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
    console.log(`  ${rn} ${brand} tmpl=${tmplId} — no match (already updated?)`);
    return;
  }

  if (!COMMIT) {
    console.log(`  ${rn} ${brand} tmpl=${tmplId} — would patch locales: ${changedLocales.join(', ')}`);
    return;
  }

  const body = { id: tmplId, name: mt.name, section: mt.section, type: mt.type, status: mt.status, code: mt.code, details };
  await authedFetch(site, `/api/bo/messagetemplate/${tmplId}`, { method: 'PUT', body });
  console.log(`  ${rn} ${brand} tmpl=${tmplId} ✓ patched locales: ${changedLocales.join(', ')}`);
}

for (const t of TARGETS) {
  try {
    await patchTemplate(t);
  } catch (e) {
    console.log(`  ${t.rn} ${t.brand} tmpl=${t.tmplId} ✗ ${e.message.split('\n')[0]}`);
  }
}

console.log('\nDone.');

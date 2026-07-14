// Fix &amp; entity in MT bodies for P065-r66
// Brands: QPRO1, QPRO3, QPRO5, QPRO9, QPRO10, QPRO15, QPRO16, QP2A
//   node bin/fix-p065-mt-amp.mjs           # dry-run
//   node bin/fix-p065-mt-amp.mjs --commit  # live

import { authedFetch } from '../src/api-client.js';

const DRY_RUN = !process.argv.includes('--commit');

const TARGETS = [
  { brand: 'QPRO1',  site: 'qpro1',  mtId: 1106 },
  { brand: 'QPRO3',  site: 'qpro3',  mtId: 580  },
  { brand: 'QPRO5',  site: 'qpro5',  mtId: 411  },
  { brand: 'QPRO9',  site: 'qpro9',  mtId: 536  },
  { brand: 'QPRO10', site: 'qpro10', mtId: 596  },
  { brand: 'QPRO15', site: 'qpro15', mtId: 418  },
  { brand: 'QPRO16', site: 'qpro16', mtId: 395  },
  { brand: 'QP2A',   site: 'ibc22',  mtId: 1325 },
];

for (const { brand, site, mtId } of TARGETS) {
  let r;
  try {
    r = await authedFetch(site, `/api/bo/messagetemplate/${mtId}`);
  } catch (e) {
    console.error(`✗ ${brand}: GET failed — ${e.message.split('\n')[0]}`);
    continue;
  }

  const mt = r.data.message_template;
  const details = r.data.message_details;

  if (!mt || !details) {
    console.error(`✗ ${brand}: unexpected GET shape`);
    continue;
  }

  let anyFixed = false;
  const fixedDetails = {};
  for (const [lid, d] of Object.entries(details)) {
    const origMsg = d.message || '';
    const fixedMsg = origMsg.replace(/&amp;/g, '&');
    const origSubj = d.subject || '';
    const fixedSubj = origSubj.replace(/&amp;/g, '&');
    if (fixedMsg !== origMsg || fixedSubj !== origSubj) anyFixed = true;
    fixedDetails[lid] = {
      settings_locale_id: d.settings_locale_id,
      subject: fixedSubj,
      message: fixedMsg,
    };
  }

  if (!anyFixed) {
    console.log(`${brand}: no &amp; found — skipping`);
    continue;
  }

  const putBody = {
    name: mt.name,
    section: mt.section,
    type: mt.type,
    status: mt.status,
    details: fixedDetails,
  };

  // QP2 quirk: omit 'code' from PUT (QPRO accepts it, QP2 422s on it)
  // We never include code — safe for both.

  if (DRY_RUN) {
    const localesFixed = Object.entries(fixedDetails)
      .filter(([lid, d]) => d.message !== details[lid].message || d.subject !== details[lid].subject)
      .map(([lid]) => lid).join(', ');
    console.log(`${brand}: [DRY RUN] would PUT /api/bo/messagetemplate/${mtId} (locales fixed: ${localesFixed})`);
    continue;
  }

  try {
    const res = await authedFetch(site, `/api/bo/messagetemplate/${mtId}`, { method: 'PUT', body: putBody });
    if (res.success || (res.data && res.data.message)) {
      console.log(`✓ ${brand}: MT ${mtId} updated`);
    } else {
      console.error(`✗ ${brand}: PUT returned unexpected response: ${JSON.stringify(res).substring(0,120)}`);
    }
  } catch (e) {
    console.error(`✗ ${brand}: PUT failed — ${e.message.split('\n')[0]}`);
  }
}

console.log(DRY_RUN ? '\n[DRY RUN] Re-run with --commit to apply.' : '\nDone.');
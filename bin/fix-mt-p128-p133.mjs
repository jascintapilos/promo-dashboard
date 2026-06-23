// Fix MT bonus condition example block for P128–P133 on QPRO2/3/4.
// The original MTs used min_deposit (50) paired with max_bonus — inconsistent.
// Corrected: example_deposit = max_bonus / (rate/100), shows rate formula.
//
// Usage:
//   node bin/fix-mt-p128-p133.mjs             # dry run
//   node bin/fix-mt-p128-p133.mjs --commit    # live PUT
import { authedFetch } from '../src/api-client.js';
import { renderBody } from '../src/message-template-renderer.js';
import { getSite } from '../src/sites.js';
import { readFileSync } from 'fs';

const DRY_RUN = !process.argv.includes('--commit');
if (DRY_RUN) console.log('[DRY RUN] Pass --commit to execute\n');

// MT ids created in this session, keyed by handle → site → mt_id
const MT_MAP = {
  'P128-r129': { qpro2: 423, qpro3: 492, qpro4: 424 },
  'P129-r130': { qpro2: 424, qpro3: 493, qpro4: 425 },
  'P130-r131': { qpro2: 425, qpro3: 494, qpro4: 426 },
  'P131-r132': { qpro2: 426, qpro3: 495, qpro4: 427 },
  'P132-r133': { qpro2: 427, qpro3: 496, qpro4: 428 },
  'P133-r134': { qpro2: 428, qpro3: 497, qpro4: 429 },
};

const SITES = ['qpro2', 'qpro3', 'qpro4'];

let fixed = 0, skipped = 0, errors = 0;

for (const [handle, siteMap] of Object.entries(MT_MAP)) {
  const fixture = JSON.parse(readFileSync(`./captures/requests/${handle}.json`, 'utf8'));

  for (const siteId of SITES) {
    const mtId = siteMap[siteId];
    const site = getSite(siteId);
    console.log(`\n${handle} ${siteId} MT=${mtId}`);

    // Render corrected bodies
    const enRes = await renderBody({ bonusType: 'Deposit', locale: 'SG_EN', brand: siteId.toUpperCase(), platform: 'qpro', resolved: fixture });
    const zhRes = await renderBody({ bonusType: 'Deposit', locale: 'SG_ZH', brand: siteId.toUpperCase(), platform: 'qpro', resolved: fixture });

    // Show example block
    const exEN = enRes.html?.slice(enRes.html.indexOf('Bonus Condition'), enRes.html.indexOf('</ul>', enRes.html.indexOf('Bonus Condition'))+5).replace(/<[^>]+>/g,'').replace(/\n\s*\n/g,'\n').trim();
    console.log('  EN example:', exEN?.split('\n').slice(1,3).join(' | '));

    if (DRY_RUN) { skipped++; continue; }

    // GET current MT to confirm it exists and grab template metadata
    const dr = await authedFetch(site, `/api/bo/messagetemplate/${mtId}`);
    const tmpl = dr?.data?.message_template;
    if (!tmpl) { console.log(`  ✗ MT not found`); errors++; continue; }

    const putBody = {
      name: tmpl.name,
      section: tmpl.section,
      type: tmpl.type,
      status: tmpl.status,
      code: tmpl.code,
      details: {
        '6': { settings_locale_id: 6, subject: enRes.subject, message: enRes.html },
        '7': { settings_locale_id: 7, subject: zhRes.subject, message: zhRes.html },
      },
    };

    const putRes = await authedFetch(site, `/api/bo/messagetemplate/${mtId}`, { method: 'PUT', body: putBody });
    const ok = putRes?.success === true || putRes?.status === 0;
    if (ok) { console.log(`  ✓ updated`); fixed++; }
    else { console.log(`  ✗ PUT failed: ${JSON.stringify(putRes)?.slice(0,200)}`); errors++; }
  }
}

console.log(`\nSummary: ${fixed} fixed, ${skipped} skipped, ${errors} errors`);

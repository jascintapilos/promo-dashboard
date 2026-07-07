// Final QC pass: FT_REL_30PCT_8X after fix-ft-rel-30pct-8x.mjs --commit.
// Read-only. Checks saved MT content + blacklist assignment per BO.

import { authedFetch } from '../src/api-client.js';

const CODE = 'FT_REL_30PCT_8X';
const SITES = [
  { site: 'qpro3',  platform: 'qpro' }, { site: 'qpro4',  platform: 'qpro' },
  { site: 'qpro5',  platform: 'qpro' }, { site: 'qpro7',  platform: 'qpro' },
  { site: 'qpro10', platform: 'qpro' }, { site: 'qpro15', platform: 'qpro' },
  { site: 'qpro16', platform: 'qpro' }, { site: 'ibc22',  platform: 'qp2'  },
];
const objVals = (o) => (o == null ? [] : Array.isArray(o) ? o : Object.values(o));
let pass = 0, fail = 0;

for (const { site, platform } of SITES) {
  const listing = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(CODE)}&perPage=10`);
  const promo = objVals(listing.data?.rows).find((p) => p.code === CODE);
  const det = (await authedFetch(site, `/api/bo/promotion/${promo.id}`)).data.rows;
  const mt = (await authedFetch(site, `/api/bo/messagetemplate/${promo.message_template_id}`)).data;
  const issues = [];

  for (const d of Object.values(mt.message_details)) {
    const loc = d.settings_locales_code;
    const isZh = loc.endsWith('_ZH');
    const wantSubject = isZh ? '独家优惠' : 'Exclusive Offer';
    if (d.subject !== wantSubject) issues.push(`${loc}: subject "${d.subject}"`);
    if (/Year of the Horse|马年|Free Spins|免费旋转/i.test(d.message)) issues.push(`${loc}: CNY/FS copy remnant`);
    if (!/Promo Details|优惠详情/.test(d.message)) issues.push(`${loc}: missing Promo Details block`);
    const sgd = loc.startsWith('SG');
    const minDep = sgd ? 50 : 30;
    const ccyRe = new RegExp(`(MYR|SGD)\\s*${minDep}`);
    if (!ccyRe.test(d.message)) issues.push(`${loc}: min-dep ${minDep} not found`);
    if (!/300/.test(d.message)) issues.push(`${loc}: max bonus 300 not found`);
    if (platform === 'qp2') {
      if (!/:url\/terms-conditions/.test(d.message)) issues.push(`${loc}: :url T&C placeholder missing`);
      if (/:brandname/.test(d.message)) issues.push(`${loc}: :brandname leaked (QP2 wants :merchantname)`);
    } else {
      if (!/<a href='https:\/\/[^']+\/terms-and-conditions'>/.test(d.message)) issues.push(`${loc}: brand-domain T&C anchor missing`);
    }
  }

  let blNote;
  if (platform === 'qp2') {
    blNote = `blacklist_template_id=${det.blacklist_template_id}`;
    if (det.blacklist_template_id !== 1) issues.push(`blacklist_template_id=${det.blacklist_template_id} (want 1)`);
  } else {
    const cat = (await authedFetch(site, '/api/bo/blacklist?perPage=200&page=1')).data?.rows || [];
    const tpl = cat.find((t) => t.id === det.blacklist_id);
    blNote = `blacklist_id=${det.blacklist_id} "${tpl?.name ?? '??'}"`;
    if (!tpl || !/^all games$/i.test(tpl.name)) issues.push(blNote + ' not All games');
  }

  if (issues.length === 0) { pass++; console.log(`✓ ${site.padEnd(7)} PASS — ${Object.keys(mt.message_details).length} locales OK, ${blNote}`); }
  else { fail++; console.log(`✗ ${site.padEnd(7)} FAIL — ${issues.join('; ')}`); }
}
console.log(`\n${pass}/${SITES.length} PASS, ${fail} FAIL`);

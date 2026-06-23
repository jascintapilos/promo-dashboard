// Copy MT content (subject + message) from QPRO2 MTs → QPRO1 MTs for P128-P133.
// Uses :url/:brandname placeholders — no domain swap needed.
// Preserves QPRO1 detail row IDs so the PUT updates in place.
//
// Usage:
//   node bin/clone-mt-qpro2-to-qpro1.mjs          # dry run
//   node bin/clone-mt-qpro2-to-qpro1.mjs --commit  # live

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const DRY_RUN = !process.argv.includes('--commit');
if (DRY_RUN) console.log('[DRY RUN] Pass --commit to execute\n');

const s1 = getSite('qpro1');
const s2 = getSite('qpro2');

const PAIRS = [
  { rn:'P128', qpro1MtId:820, qpro2MtId:423 },
  { rn:'P129', qpro1MtId:821, qpro2MtId:424 },
  { rn:'P130', qpro1MtId:816, qpro2MtId:425 },
  { rn:'P131', qpro1MtId:817, qpro2MtId:426 },
  { rn:'P132', qpro1MtId:836, qpro2MtId:427 },
  { rn:'P133', qpro1MtId:837, qpro2MtId:428 },
];

let ok = 0, err = 0;

for (const pair of PAIRS) {
  console.log(`\n── ${pair.rn}  (qpro2 MT ${pair.qpro2MtId} → qpro1 MT ${pair.qpro1MtId}) ──`);

  // GET source (QPRO2)
  const src = await authedFetch(s2, `/api/bo/messagetemplate/${pair.qpro2MtId}`);
  const srcData = src?.data?.rows ?? src?.data;
  const srcDetails = srcData?.message_details;
  if (!srcDetails) { console.log('  ✗ could not fetch QPRO2 MT'); err++; continue; }

  // GET target (QPRO1) — need existing detail row IDs for in-place PUT
  const tgt = await authedFetch(s1, `/api/bo/messagetemplate/${pair.qpro1MtId}`);
  const tgtData = tgt?.data?.rows ?? tgt?.data;
  const tgtTmpl = tgtData?.message_template;
  const tgtDetails = tgtData?.message_details;
  if (!tgtTmpl || !tgtDetails) { console.log('  ✗ could not fetch QPRO1 MT'); err++; continue; }

  // Show diff summary
  for (const [locKey, tgtDet] of Object.entries(tgtDetails)) {
    const srcDet = Object.values(srcDetails).find(d => d.settings_locales_code === tgtDet.settings_locales_code);
    if (!srcDet) { console.log(`  ⚠ locale ${tgtDet.settings_locales_code} not in source — will keep existing`); continue; }
    const subjectChanged = srcDet.subject !== tgtDet.subject;
    const bodyChanged    = srcDet.message  !== tgtDet.message;
    console.log(`  ${tgtDet.settings_locales_code}: subject=${subjectChanged?'CHANGED':'same'} body=${bodyChanged?'CHANGED':'same'}`);
  }

  if (DRY_RUN) { ok++; continue; }

  // Build fixed details: QPRO1 row IDs, QPRO2 subject+message
  const fixedDetails = {};
  for (const [locKey, tgtDet] of Object.entries(tgtDetails)) {
    const srcDet = Object.values(srcDetails).find(d => d.settings_locales_code === tgtDet.settings_locales_code);
    fixedDetails[locKey] = {
      id: tgtDet.id,
      settings_locale_id: tgtDet.settings_locale_id,
      subject: srcDet ? srcDet.subject : tgtDet.subject,
      message: srcDet ? srcDet.message : tgtDet.message,
    };
  }

  const putBody = {
    id:      tgtTmpl.id,
    code:    tgtTmpl.code,
    name:    tgtTmpl.name,
    section: tgtTmpl.section,
    type:    tgtTmpl.type,
    status:  tgtTmpl.status,
    details: fixedDetails,
  };

  const res = await authedFetch(s1, `/api/bo/messagetemplate/${pair.qpro1MtId}`, { method: 'PUT', body: putBody });
  if (res?.success) {
    console.log(`  ✓ MT ${pair.qpro1MtId} updated`);
    ok++;
  } else {
    console.log(`  ✗ PUT failed: ${JSON.stringify(res).slice(0, 150)}`);
    err++;
  }
}

console.log(`\nSummary: ${ok} updated, ${err} errors`);

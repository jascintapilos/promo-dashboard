#!/usr/bin/env node
// Seed QC bundles for P124-P133 (externally-modified saves — recurring
// settings changed via direct API/browser automation, not our canary).
// Creates minimal bundle files so qc-fanout --refresh can populate live_state.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const BUNDLE_DIR = path.resolve('captures/qc-bundles');
await mkdir(BUNDLE_DIR, { recursive: true });

const HANDLES = {
  P124: 'P124-r125', P125: 'P125-r126', P126: 'P126-r127', P127: 'P127-r128',
  P128: 'P128-r129', P129: 'P129-r130', P130: 'P130-r131', P131: 'P131-r132',
  P132: 'P132-r133', P133: 'P133-r134',
};

// QPRO1 gets a distinct suffixed code on P124/126/127; shares base code with QPRO2-4 on P128-133.
const CODES = {
  P124: { qpro1: 'REL_BASE_60FS_GOOSS_12X_V2B', shared: 'REL_BASE_60FS_GOOSS_12X_V2' },
  P125: { qpro1: 'REL_BOOSTER_80FS_GOOSS_15X_V2', shared: 'REL_BOOSTER_80FS_GOOSS_15X' },
  P126: { qpro1: 'RET_GOOSS_BASE_50FS_10X_V2', shared: 'RET_GOOSS_BASE_50FS_10X' },
  P127: { qpro1: 'RET_GOOSS_BOOST_60FS_12X_V2', shared: 'RET_GOOSS_BOOST_60FS_12X' },
  P128: { qpro1: 'RET_LC_BASE_15PCT', shared: 'RET_LC_BASE_15PCT' },
  P129: { qpro1: 'RET_LC_BOOST_18PCT', shared: 'RET_LC_BOOST_18PCT' },
  P130: { qpro1: 'RET_SPORTS_BASE_12PCT', shared: 'RET_SPORTS_BASE_12PCT' },
  P131: { qpro1: 'RET_SPORTS_BOOST_15PCT', shared: 'RET_SPORTS_BOOST_15PCT' },
  P132: { qpro1: 'REL_BASE_12PCT_5X', shared: 'REL_BASE_12PCT_5X' },
  P133: { qpro1: 'REL_BOOSTER_15PCT_5X', shared: 'REL_BOOSTER_15PCT_5X' },
};

// promotion_id per brand per request, collected via direct BO probes this session.
const IDS = {
  QP2A:  { P124: 1269, P125: 1270, P126: 1271, P127: 1272, P128: 860, P129: 861, P130: 859, P131: 862, P132: 898, P133: 899 },
  QPRO1: { P124: 1034, P125: 1035, P126: 1036, P127: 1037, P128: 788, P129: 789, P130: 790, P131: 791, P132: 812, P133: 813 },
  QPRO2: { P124: 514,  P125: 511,  P126: 512,  P127: 513,  P128: 515, P129: 516, P130: 517, P131: 518, P132: 519, P133: 520 },
  QPRO3: { P124: 537,  P125: 534,  P126: 535,  P127: 536,  P128: 538, P129: 539, P130: 540, P131: 541, P132: 542, P133: 543 },
  QPRO4: { P124: 466,  P125: 463,  P126: 464,  P127: 465,  P128: 467, P129: 468, P130: 469, P131: 470, P132: 471, P133: 472 },
};

const BRAND_META = {
  QP2A:  { site: 'ibc22', platform: 'qp2',  merchantId: 1 },
  QPRO1: { site: 'qpro1', platform: 'qpro' },
  QPRO2: { site: 'qpro2', platform: 'qpro' },
  QPRO3: { site: 'qpro3', platform: 'qpro' },
  QPRO4: { site: 'qpro4', platform: 'qpro' },
};

let seeded = 0;
for (const rn of Object.keys(HANDLES)) {
  const handle = HANDLES[rn];
  const source = JSON.parse(await readFile(`captures/requests/${handle}.json`, 'utf-8'));

  for (const brand of ['QPRO1', 'QPRO2', 'QPRO3', 'QPRO4', 'QP2A']) {
    const promotion_id = IDS[brand][rn];
    if (!promotion_id) { console.log(`⚠ no id for ${rn} ${brand} — skipping`); continue; }
    const code = brand === 'QPRO1' ? CODES[rn].qpro1 : CODES[rn].shared;
    const meta = BRAND_META[brand];

    const bundle = {
      handle,
      brand,
      promo_code: code,
      site: meta.site,
      platform: meta.platform,
      promotion_id,
      template_id: null,
      dialog_popup_id: null,
      saved_at: new Date().toISOString(),
      seeded_by: 'probe (recurring-settings edit via direct API/browser automation, 2026-07-03 — not canary-saved)',
      source,
      live_state: null,
    };
    const file = path.join(BUNDLE_DIR, `${handle}__${brand}.json`);
    await writeFile(file, JSON.stringify(bundle, null, 2));
    seeded++;
  }
}
console.log(`\n✓ seeded ${seeded} bundle files`);
console.log('\nNow run --refresh per handle to populate live_state.');

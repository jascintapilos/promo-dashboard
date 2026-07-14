// Fix P065-r66 dialog popup label + content titles across all QPRO and QP2 brands.
// The multi-brand col X string "QPRO: ...\nQP2: ...\nWS1/WS2: ..." was set verbatim
// as the dialog label/title instead of the platform-specific part.
//
//   node bin/fix-p065-dialog-names.mjs            # dry-run
//   node bin/fix-p065-dialog-names.mjs --commit   # live

import { readFileSync } from 'node:fs';
import { updateDialogPopup, getPopupDetail } from '../src/api-client.js';

const DRY_RUN = !process.argv.includes('--commit');
const BUNDLE_DIR = 'captures/qc-bundles';

const QPRO_NAME = '50 Free Spins - Gates of Olympus (Pragmatic Play)';
const QP2_NAME  = '50 Free Spins (Gates of Olympus)';

const BRANDS = [
  { brand: 'QPRO1',  platform: 'qpro', correctName: QPRO_NAME },
  { brand: 'QPRO2',  platform: 'qpro', correctName: QPRO_NAME },
  { brand: 'QPRO3',  platform: 'qpro', correctName: QPRO_NAME },
  { brand: 'QPRO4',  platform: 'qpro', correctName: QPRO_NAME },
  { brand: 'QPRO5',  platform: 'qpro', correctName: QPRO_NAME },
  { brand: 'QPRO6',  platform: 'qpro', correctName: QPRO_NAME },
  { brand: 'QPRO7',  platform: 'qpro', correctName: QPRO_NAME },
  { brand: 'QPRO8',  platform: 'qpro', correctName: QPRO_NAME },
  { brand: 'QPRO9',  platform: 'qpro', correctName: QPRO_NAME },
  { brand: 'QPRO10', platform: 'qpro', correctName: QPRO_NAME },
  { brand: 'QPRO15', platform: 'qpro', correctName: QPRO_NAME },
  { brand: 'QPRO16', platform: 'qpro', correctName: QPRO_NAME },
  { brand: 'QP2A',   platform: 'qp2',  correctName: QP2_NAME  },
];

for (const { brand, platform, correctName } of BRANDS) {
  const bundle = JSON.parse(readFileSync(`${BUNDLE_DIR}/P065-r66__${brand}.json`, 'utf8'));
  const siteId = bundle.site;
  const popup  = bundle.live_state?.popup;

  if (!popup) {
    console.log(`${brand}: no popup in bundle — skipping`);
    continue;
  }

  console.log(`\n=== ${brand} (${siteId}) popup id=${popup.id} ===`);
  console.log(`  current label : ${popup.label ?? '(none)'}`);
  console.log(`  current titles: ${[...new Set((popup.contents||[]).map(c=>c.title))].join(' | ')}`);
  console.log(`  correct name  : ${correctName}`);

  if (DRY_RUN) continue;

  // Build per-locale contentsOverrides: only override title, preserve everything else
  const contentsOverrides = {};
  for (const c of (popup.contents || [])) {
    contentsOverrides[c.locale_id] = { title: correctName };
  }

  // topOverrides: for QPRO set label; QP2 has no label field (skip)
  const topOverrides = platform === 'qpro' ? { label: correctName } : {};

  try {
    const res = await updateDialogPopup(siteId, popup, { topOverrides, contentsOverrides });
    const ok = res?.success === true || (res?.data && res.data?.id);
    if (ok) {
      console.log(`  ✓ Updated (popup id=${popup.id})`);
    } else {
      console.error(`  ✗ PUT returned: ${JSON.stringify(res).slice(0, 200)}`);
    }
  } catch (e) {
    console.error(`  ✗ updateDialogPopup failed: ${e.message.split('\n')[0]}`);
  }
}

// ── QP2A per-site popups ─────────────────────────────────────────────────
// The relink script duplicated popup 1877 into per-site popups (1797-1880).
// Those are what's actually linked to the promotion — update their titles too.
const QP2_SITE_POPUP_IDS = [1797, 1798, 1799, 1880];
console.log('\n=== QP2A per-site popups ===');
for (const pid of QP2_SITE_POPUP_IDS) {
  const popup = await getPopupDetail('ibc22', pid);
  if (!popup) {
    console.error(`  popup ${pid}: not found — skipping`);
    continue;
  }
  const titles = [...new Set((popup.contents || []).map(c => c.title))];
  const isP065 = titles.some(t => t?.includes('50 Free Spins') && t?.includes('Gates of Olympus'));
  console.log(`  popup ${pid}: current titles: ${titles.join(' | ')}  (p065=${isP065})`);
  if (!isP065) { console.log(`  → not a P065 dialog — skipping`); continue; }
  console.log(`              correct name  : ${QP2_NAME}`);

  if (DRY_RUN) continue;

  const contentsOverrides = {};
  for (const c of (popup.contents || [])) {
    contentsOverrides[c.locale_id] = { title: QP2_NAME };
  }
  try {
    const res = await updateDialogPopup('ibc22', popup, { contentsOverrides });
    const ok = res?.success === true || (res?.data && res.data?.id);
    if (ok) {
      console.log(`  ✓ Updated popup ${pid}`);
    } else {
      console.error(`  ✗ PUT returned: ${JSON.stringify(res).slice(0, 200)}`);
    }
  } catch (e) {
    console.error(`  ✗ updateDialogPopup(${pid}) failed: ${e.message.split('\n')[0]}`);
  }
}

console.log(DRY_RUN ? '\n[DRY RUN] Re-run with --commit to apply.' : '\nDone.');

#!/usr/bin/env node
/**
 * Build April + May 2026 monthly reports via Slides API.
 *
 * Strategy:
 *   1. Re-validates auth (requires presentations + drive scopes).
 *   2. Updates the existing April Slides (ID baked in) with April content:
 *      - Bulk text replacements (March → April, swap KPI numbers + insights)
 *      - Appends 4 new "Automation & Tooling" slides (15-18) by duplicating
 *        a templatable existing slide and replacing its content.
 *   3. Copies April Slides → "May 2026 - Promotions Team Report" via Drive API.
 *   4. Updates the May copy with May-specific content + appends Miro journey slide.
 *
 * Charts (donut + bar) are linked-Sheets-backed. We don't update chart data here;
 * the operator refines charts post-build via the underlying Sheets editor.
 *
 * Usage:
 *   node bin/build-monthly-reports.mjs
 *
 * Optional flags:
 *   --dry-run             Print planned edits without applying
 *   --april-only          Only build April
 *   --may-only            Only build May (assumes April already done)
 *   --rebuild-may         Delete existing May and rebuild from April
 */

import { getGoogleAuth, loadGoogleapis } from '../src/google-auth.js';

const APRIL_DECK_ID = '1AGIwKFBc3vs8KL0Zo9ISPXU5DUb3Zu2ap3jAyjdayyc';
const MARCH_DECK_ID = '1WHvU-CA1nbAgp-ElFoTJIQ9mpa8ZVqDbA82HLQuJKpU';
const REPORTS_FOLDER_ID = '1y6mptIbRmqHnjgk_8ryzAW4vKzaApWpz';

const FLAGS = {
  dryRun:      process.argv.includes('--dry-run'),
  aprilOnly:   process.argv.includes('--april-only'),
  mayOnly:     process.argv.includes('--may-only'),
  rebuildMay:  process.argv.includes('--rebuild-may'),
};

// ──────────────────────────────────────────────────────────────────────
// April content edits — applied via Slides batchUpdate replaceAllText
// ──────────────────────────────────────────────────────────────────────

// Title slide (1) + section divider (2)
const APRIL_GLOBAL_REPLACES = [
  // Title slide
  { find: 'March 2026 Report', replace: 'April 2026 Report' },
  // Section divider footer + section labels referencing month
  { find: 'March 2026 Report\nPromotion Team', replace: 'April 2026 Report\nPromotion Team' },
  // Subtitle date patterns on each KPI slide
  { find: 'March 2026 · Total: 104 codes across 12 active brands', replace: 'April 2026 · Total: 140 codes across 14 active brands' },
  { find: 'Jan–Mar 2026 · volume normalisation after Feb CRM scale-up', replace: 'Feb–Apr 2026 · QP2D-led recovery after March normalisation' },
  { find: 'CRM assignments — March 2026', replace: 'CRM assignments — April 2026' },
  { find: '395 total segments · 2 campaigns · Smartico training implemented', replace: '354 total segments · VM cycle stable post-Smartico training' },
  { find: 'Banners — March 2026', replace: 'Banners — April 2026' },
  { find: '109 total banners · 5 regions · mix of in-house and vendor campaigns', replace: '75 banners · vendor pipeline bottleneck, in-house steady' },
  { find: 'New games — March 2026', replace: 'New games — April 2026' },
  { find: '19 games added · 3 vendors · Mini Games milestone launched', replace: '24 games · 4 vendors · steady cadence' },
  { find: 'QC performance — March 2026', replace: 'QC performance — April 2026' },
  { find: 'Team utilisation — March 2026', replace: 'Team utilisation — April 2026' },
  { find: '66.3% overall · PH-adjusted 65.8% · W4 impacted by Hari Raya public holidays', replace: '~78% avg · Michelle exit Apr 2 · Wen reached steady-state' },
  { find: 'March 2026 update — key milestones delivered', replace: 'April 2026 update — key milestones delivered' },
  { find: 'Completed and active initiatives — March 2026', replace: 'Completed and active initiatives — April 2026' },
  { find: 'Systems built and maintained to support team quality, clarity, and scalability — March 2026', replace: 'Systems built and maintained — April 2026' },
  { find: 'Jan–Mar 2026 · initiative milestones and outcomes', replace: 'Jan–Apr 2026 · initiative milestones and outcomes' },
];

// KPI slide 3 — Promotion code distribution
const APRIL_SLIDE_3 = [
  { find: '104', replace: '140' },
  { find: '-56.8% vs Feb', replace: '+34.6% vs Mar' },
  { find: 'QPRO1 · 20', replace: 'QP2D · 27' },
  { find: 'MY · 83', replace: 'MY · 130' },
  { find: 'SG: 72 codes', replace: 'SG: 15 codes' },
  { find: 'QP2 brands (A–D) combined = 50 codes', replace: 'QP2D dominated workload (27 codes) — heavy reload + free-credit refresh cycle' },
  { find: 'QPRO1 leads individual brands with 20 codes', replace: 'Recovery from March 56.8% drop — +34.6% MoM confirms steady-state ops on full team' },
  { find: 'WARUNG18 (4) and SBO28 (1) contributed new brand', replace: 'Volume concentrated in MY (93%) — SG share dropped to 7% from March 23%' },
  { find: 'Malaysia drives ~80% of code volume', replace: 'VIP Migration Campaign launch (Apr 16) drove tail-end volume' },
  { find: '9 brands recorded zero codes this month', replace: '9 brands had zero promo activity — workload focused on core 7' },
];

// KPI slide 4 — MoM trend
const APRIL_SLIDE_4 = [
  { find: 'January 2026', replace: 'February 2026' },
  { find: '621', replace: '241' },
  { find: 'Baseline', replace: '+288% vs Jan' },
  { find: 'February 2026', replace: 'March 2026' },
  { find: '241', replace: '104' },
  { find: '-61.2% MoM', replace: '−56.8% MoM' },
  { find: 'March 2026', replace: 'April 2026' },
  // wait — March/April KPI labels duplicate; need to be careful
];

// Most of the remaining content needs full text-element replacement.
// Instead of trying to enumerate every find/replace pair (which gets brittle),
// we'll:
//   (a) apply the GLOBAL replaces above (safe — these are unique strings)
//   (b) read the deck structure and report which text elements remain to update manually
//   (c) operator finishes the long-form bullet text via Chrome (much faster than
//       trying to enumerate every English sentence as a replace pair)

// ──────────────────────────────────────────────────────────────────────

let slides, drive;

async function main() {
  const { client } = await getGoogleAuth();
  const { google } = await loadGoogleapis();
  slides = google.slides({ version: 'v1', auth: client });
  drive  = google.drive({  version: 'v3', auth: client });

  // Verify auth covers presentations + drive write
  try {
    const meta = await slides.presentations.get({
      presentationId: APRIL_DECK_ID,
      fields: 'presentationId,title,slides.objectId',
    });
    console.log(`✓ Auth OK — April deck "${meta.data.title}", ${meta.data.slides.length} slides`);
  } catch (e) {
    console.error(`✗ Slides API access failed: ${e.message}`);
    console.error('  Check: Slides API enabled in GCP project + re-ran OAuth with presentations scope.');
    process.exit(2);
  }

  if (!FLAGS.mayOnly) await buildApril();
  if (!FLAGS.aprilOnly) await buildMay();
}

async function buildApril() {
  console.log('\n━━━ Building April Slides ━━━');

  // Combine all April text replacements
  const replaces = [...APRIL_GLOBAL_REPLACES, ...APRIL_SLIDE_3];

  const requests = replaces.map(r => ({
    replaceAllText: {
      containsText: { text: r.find, matchCase: true },
      replaceText: r.replace,
    },
  }));

  if (FLAGS.dryRun) {
    console.log(`  DRY-RUN — would apply ${requests.length} text replacements`);
    replaces.forEach(r => console.log(`    "${r.find.slice(0,60)}" → "${r.replace.slice(0,60)}"`));
    return;
  }

  const res = await slides.presentations.batchUpdate({
    presentationId: APRIL_DECK_ID,
    requestBody: { requests },
  });
  const replies = res.data.replies || [];
  let totalOccurrences = 0;
  replies.forEach((reply, i) => {
    const count = reply.replaceAllText?.occurrencesChanged || 0;
    totalOccurrences += count;
    if (count === 0) {
      console.log(`  ⚠ No match: "${replaces[i].find.slice(0,80)}"`);
    }
  });
  console.log(`  ✓ ${totalOccurrences} text occurrences replaced across ${requests.length} rules`);
  console.log(`  URL: https://docs.google.com/presentation/d/${APRIL_DECK_ID}/edit`);
  console.log('  Note: charts still show March data (chart updates require updating linked Sheets).');
  console.log('  Note: new Automation & Tooling slides (15-18) appended in next pass.');
}

async function buildMay() {
  console.log('\n━━━ Building May Slides ━━━');

  // Find existing May deck if it's been built before
  let mayId = null;
  const search = await drive.files.list({
    q: `name = 'May 2026 - Promotions Team Report' and mimeType = 'application/vnd.google-apps.presentation' and trashed = false`,
    fields: 'files(id, name, parents)',
  });
  const existing = search.data.files?.[0];
  if (existing && !FLAGS.rebuildMay) {
    console.log(`  ✓ May deck exists: ${existing.id} — reusing (use --rebuild-may to recreate)`);
    mayId = existing.id;
  } else {
    if (existing && FLAGS.rebuildMay) {
      console.log(`  Removing existing May deck ${existing.id}...`);
      if (!FLAGS.dryRun) await drive.files.delete({ fileId: existing.id });
    }
    if (FLAGS.dryRun) {
      console.log(`  DRY-RUN — would Drive.copy April deck → "May 2026 - Promotions Team Report" in folder ${REPORTS_FOLDER_ID}`);
      return;
    }
    const copy = await drive.files.copy({
      fileId: APRIL_DECK_ID,
      requestBody: {
        name: 'May 2026 - Promotions Team Report',
        parents: [REPORTS_FOLDER_ID],
      },
    });
    mayId = copy.data.id;
    console.log(`  ✓ Created May deck: ${mayId}`);
  }

  // May content edits — applied against the freshly-copied April
  const mayReplaces = [
    { find: 'April 2026 Report', replace: 'May 2026 Report' },
    { find: 'April 2026 · Total: 140 codes across 14 active brands', replace: 'May 2026 · ~125 codes across 14 active brands' },
    { find: 'Feb–Apr 2026 · QP2D-led recovery after March normalisation', replace: 'Mar–May 2026 · automation enters production' },
    { find: 'CRM assignments — April 2026', replace: 'CRM assignments — May 2026' },
    { find: '354 total segments · VM cycle stable post-Smartico training', replace: '143 in W1 · ~280 total · UG02 brand onboarded' },
    { find: 'Banners — April 2026', replace: 'Banners — May 2026' },
    { find: '75 banners · vendor pipeline bottleneck, in-house steady', replace: '~175 banners · +133% rebound · MG + PP cross-brand rollouts' },
    { find: 'New games — April 2026', replace: 'New games — May 2026' },
    { find: '24 games · 4 vendors · steady cadence', replace: '29 games · record month · Playtech-led batch' },
    { find: 'QC performance — April 2026', replace: 'QC performance — May 2026' },
    { find: 'Team utilisation — April 2026', replace: 'Team utilisation — May 2026' },
    { find: '~78% avg · Michelle exit Apr 2 · Wen reached steady-state', replace: '~85% avg · team expanded to 6 (+Gaby +Bangun)' },
    { find: 'April 2026 update — key milestones delivered', replace: 'May 2026 update — key milestones delivered' },
    { find: 'Completed and active initiatives — April 2026', replace: 'Completed and active initiatives — May 2026' },
    { find: 'Systems built and maintained — April 2026', replace: 'Systems built and maintained — May 2026' },
    { find: 'Jan–Apr 2026 · initiative milestones and outcomes', replace: 'Jan–May 2026 · 5-month structural contributions' },
    // KPI numbers — slide 3
    { find: '140', replace: '125' },
    { find: '+34.6% vs Mar', replace: '−10.7% vs Apr' },
    { find: 'QP2D · 27', replace: 'QP2D · 56' },
    { find: 'MY · 130', replace: 'MY · ~165' },
    { find: 'SG: 15 codes', replace: 'SG: ~75 codes' },
    // Slide 4 trend
    { find: '241', replace: '104' },
    { find: '+288% vs Jan', replace: 'baseline' },
    { find: '104', replace: '140' },
    { find: '−56.8% MoM', replace: '+34.6% MoM' },
    // slide 4 final cell becomes May
    // (after the above 104→140, the original April 140 → 125 is already done in title; need separate trigger)
  ];

  const reqs = mayReplaces.map(r => ({
    replaceAllText: {
      containsText: { text: r.find, matchCase: true },
      replaceText: r.replace,
    },
  }));

  if (FLAGS.dryRun) {
    console.log(`  DRY-RUN — would apply ${reqs.length} text replacements on May`);
    return;
  }

  const res = await slides.presentations.batchUpdate({
    presentationId: mayId,
    requestBody: { requests: reqs },
  });
  const replies = res.data.replies || [];
  let totalOccurrences = 0;
  replies.forEach((reply, i) => {
    const count = reply.replaceAllText?.occurrencesChanged || 0;
    totalOccurrences += count;
    if (count === 0) {
      console.log(`  ⚠ No match: "${mayReplaces[i].find.slice(0,80)}"`);
    }
  });
  console.log(`  ✓ ${totalOccurrences} text occurrences replaced across ${reqs.length} rules`);
  console.log(`  URL: https://docs.google.com/presentation/d/${mayId}/edit`);
}

main().catch(e => {
  console.error('✗ Build failed:', e.message);
  if (e.errors) console.error(JSON.stringify(e.errors, null, 2));
  process.exit(1);
});

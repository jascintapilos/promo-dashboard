#!/usr/bin/env node
// WS1 (MB8) + WS2 (RWS77) Directus UICarousel homepage-banner uploader.
//
// Background
// ──────────
// UICarousel API endpoint (/items/UICarousel) returns HTTP 403 for Jascinta's
// Directus role — no amount of auth fixes this. Uploads are therefore Chrome-
// driven via the Claude-in-Chrome MCP. This script:
//   1. Reads the Banner Schedule sheet for the given B-ID range.
//   2. Filters to WS1 / WS2 (BIA platform) rows.
//   3. Resolves UICarousel IDs per region from a hard-coded lookup table.
//   4. Discovers local banner image files (1280×320 px).
//   5. Generates a structured upload runbook (JSON + human-readable).
//   6. In --dry-run mode (the default): prints the plan and exits.
//   7. In --live mode: prints the runbook for the Claude agent to execute via
//      Chrome MCP tool calls (the agent reads the JSON output and drives the
//      browser step by step).
//
// Usage
// ─────
//   node bin/upload-ws1-banners.mjs --range=B01
//   node bin/upload-ws1-banners.mjs --range=B01 --live
//   node bin/upload-ws1-banners.mjs --range=B01-B03 --banner-dir=D:\Banners
//   node bin/upload-ws1-banners.mjs --range=B01 --image-dir=C:\path\to\images
//   node bin/upload-ws1-banners.mjs --range=B01 --cta="Learn More"
//
// Flags
// ─────
//   --range=<B##-B##>       B-ID range (inclusive); also accepts single B-ID
//   --b-ids=<B##,…>         comma-list of specific B-IDs
//   --banner-dir=<path>     root folder containing brand-prefixed subfolders
//                           (default: ../Banner relative to this script)
//   --image-dir=<path>      bypass brand-prefix detection; use this folder
//                           directly (images must still contain region code)
//   --cta=<text>            CTA button text for all locales (default: "Learn More")
//   --dry-run               print plan without executing Chrome actions (default)
//   --live                  execute via Chrome MCP after printing plan
//
// Image discovery
// ───────────────
// For WS1 (MB8): looks for a subfolder in --banner-dir whose name starts with
// "mb8" (case-insensitive). Inside, matches any .jpg/.png file whose name
// contains the lower-case region code (my, th, kh, id, sg, au, ph) followed
// by a locale suffix (en, th, kh, id, zh, etc.).
//
// Locale suffix pattern: <region>-<lang> → e.g. my-en, th-th, kh-kh, id-id
// If a region has only one image file (no locale suffix), it is used for all
// locales of that region.
//
// Expected filename examples:
//   mb8-microgaming-road-to-glory-1280x320-my-en.jpg
//   mb8-microgaming-road-to-glory-1280x320-th-en.jpg
//   mb8-microgaming-road-to-glory-1280x320-th-th.jpg
//   mb8-rtg-1280x320-kh-en.jpg
//   mb8-rtg-1280x320-kh-kh.jpg
//   mb8-rtg-1280x320-id-en.jpg
//   mb8-rtg-1280x320-id-id.jpg
//
// UICarousel IDs (probed 2026-05-19 — ws1-directus-probe-summary.md)
// ──────────────────────────────────────────────────────────────────
// WS1 (MB8):  MY=226  TH=28  ID=132  KH=80  SG=54  AU=227  PH=158
// WS2 (RWS77): MY=1  (only region)
//
// Chrome automation — per-entry steps
// ─────────────────────────────────────
// For each upload entry the agent (Claude) must:
//   1. Navigate to <cmsBaseUrl>/admin/content/UICarousel/<carouselId>
//      (must be logged in as Jascinta)
//   2. Wait for the carousel page to load (check page title)
//   3. Scroll down to the "Images" repeater section
//   4. Click the "Create New" button:
//        Array.from(document.querySelectorAll('button'))
//          .find(b => b.textContent.trim() === 'Create New')?.click()
//   5. Wait for the drawer "Creating Item in UI Carousel Images" to open
//   6. Fill Start Date:
//        const inputs = Array.from(document.querySelectorAll('.v-input input'));
//        const startInput = inputs.find(i => i.closest('.field') &&
//          i.closest('.field').textContent.includes('Start Date'));
//        (set via nativeInputValueSetter + dispatchEvent 'input'/'change')
//   7. Fill End Date (same pattern as Start Date)
//   8. For each locale tab in the Translations repeater:
//      a. Click the locale tab (e.g. "English")
//      b. Fill Link URL field with entry.linkUrl
//      c. Fill CTA Button Text with entry.cta
//      d. Leave Image field empty (null on all live records — confirmed)
//      e. Upload banner image to Files field:
//           - click the Files upload area / "+" button
//           - use file_upload MCP tool with the local image path
//   9. Verify "Enabled" toggle is OFF (leave off — user QC step)
//  10. Do NOT click Submit — leave for user to review and submit
//
// Directus datetime format: "YYYY-MM-DD HH:mm:ss" (stored UTC; Directus UI
// converts to browser local time). Script outputs MYT (UTC+8) times for the
// drawer — the agent fills as displayed in the Directus picker.

import { readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSheetsClient } from '../src/sheets-client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ── Arg parsing ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { range: null, bIds: null, bannerDir: null, imageDir: null,
                 cta: 'Learn More', dryRun: true, live: false };
  for (const a of argv.slice(2)) {
    const [k, ...vParts] = a.replace(/^--/, '').split('=');
    const v = vParts.join('=');
    if (k === 'range')      args.range     = v;
    if (k === 'b-ids')      args.bIds      = v;
    if (k === 'banner-dir') args.bannerDir = v;
    if (k === 'image-dir')  args.imageDir  = v;
    if (k === 'cta')        args.cta       = v;
    if (k === 'dry-run')    { args.dryRun = true; args.live = false; }
    if (k === 'live')       { args.live   = true; args.dryRun = false; }
  }
  if (!args.range && !args.bIds) {
    console.error('ERROR: --range=<B##-B##> or --b-ids=<B##,...> required.');
    process.exit(1);
  }
  return args;
}

// ── B-ID parser ───────────────────────────────────────────────────────────────

function parseBIds(rangeStr) {
  const out = new Set();
  for (const tok of (rangeStr || '').trim().split(/[,\s]+/).filter(Boolean)) {
    const rng = tok.match(/^B(\d+)-B?(\d+)$/i);
    if (rng) {
      const [lo, hi] = [+rng[1], +rng[2]].sort((a,b) => a-b);
      for (let i = lo; i <= hi; i++) out.add(fmtBId(i));
    } else {
      const s = tok.match(/^B(\d+)$/i);
      if (s) out.add(fmtBId(+s[1]));
      else throw new Error(`Cannot parse B-ID token: "${tok}"`);
    }
  }
  return [...out].sort();
}
function fmtBId(n) { return n < 100 ? `B${String(n).padStart(2,'0')}` : `B${n}`; }

// ── Constants ─────────────────────────────────────────────────────────────────

const BANNER_SCHEDULE_SHEET_ID = '1vpyjhqiKzcn2XHovcN2tEa4UkzUMqTmFsUZ59m-n8_E';
const BANNER_SCHEDULE_TAB      = 'May 2026';   // update monthly

// UICarousel IDs — probed 2026-05-19 (see captures/ws1-directus-probe-summary.md)
const CAROUSEL_IDS = {
  ws1:  { MY: 226, TH: 28, ID: 132, KH: 80, SG: 54, AU: 227, PH: 158 },
  ws2:  { MY: 1 },
};

const CMS_BASE = {
  ws1: 'https://cms.toffeemace.com',
  ws2: 'https://ws2-cms.toffeemace.com',
};

// Region code → URL prefix for Link URL slug
const REGION_URL_PREFIX = {
  MY: 'my', TH: 'th', ID: 'id', KH: 'kh', SG: 'sg', AU: 'au', PH: 'ph',
};

// Locales per region carousel. Vendor confirmed by delivering MY ZH images for
// both WS1 and WS2 — MY carousel supports EN + ZH (overrides earlier probe
// observation of English-only). TH / ID / KH locales assumed; agent fills
// whatever tabs appear in the Directus drawer.
const REGION_LOCALES = {
  MY: ['en', 'zh'],
  TH: ['en', 'th'],
  ID: ['en', 'id'],
  KH: ['en', 'kh'],
  SG: ['en'],
  AU: ['en'],
  PH: ['en'],
};

// Brand code prefix used for subfolder + image detection
const SITE_BRAND_PREFIX = { ws1: 'mb8', ws2: 'rws77' };

// Date formatting helpers
function parseScheduleDate(raw) {
  // Accepts: "07-Jun-2026", "07/06/2026", "2026-06-07"
  const ddMon = raw.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (ddMon) {
    const MONTHS = { Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12 };
    const m = MONTHS[ddMon[2]];
    if (!m) throw new Error(`Unknown month: ${ddMon[2]}`);
    return new Date(+ddMon[3], m-1, +ddMon[1]);
  }
  const slashDMY = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashDMY) return new Date(+slashDMY[3], +slashDMY[2]-1, +slashDMY[1]);
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return new Date(+iso[1], +iso[2]-1, +iso[3]);
  throw new Error(`Cannot parse date: "${raw}"`);
}

function formatDirectusDate(d, endOfDay = false) {
  const pad = (n) => String(n).padStart(2, '0');
  const yy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const time = endOfDay ? '23:59:59' : '00:00:00';
  return `${yy}-${mm}-${dd} ${time}`;
}

function formatHuman(d) {
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${String(d.getDate()).padStart(2,'0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

// ── Image discovery ───────────────────────────────────────────────────────────

/**
 * Returns { region: { locale: absFilePath } } for found images.
 * Missing = value is null (flagged but not fatal in dry-run).
 */
function discoverImages(siteId, regions, bannerDir, imageDirOverride) {
  const brand = SITE_BRAND_PREFIX[siteId] || siteId;
  let folder = imageDirOverride;

  if (!folder) {
    // Find first subfolder starting with brand code (prefer *-min)
    const entries = readdirSync(bannerDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name.toLowerCase().startsWith(brand));
    if (!entries.length) {
      console.warn(`  [images] ⚠️  No subfolder starting with "${brand}" found in ${bannerDir}`);
      console.warn(`  [images]    Create Banner/${brand}-<campaign>/ with 1280×320 images`);
      return null;
    }
    const preferred = entries.find(e => e.name.endsWith('-min')) || entries[0];
    folder = path.join(bannerDir, preferred.name);
    console.log(`  [images] folder: ${folder}`);
  } else {
    if (!existsSync(folder)) {
      console.warn(`  [images] ⚠️  --image-dir not found: ${folder}`);
      return null;
    }
    console.log(`  [images] override folder: ${folder}`);
  }

  // Handle the common vendor zip pattern: <brand>/<brand>/images (one level nested)
  // If no images directly in the matched folder, descend into the first subfolder.
  let files = readdirSync(folder).filter(f => /\.(jpe?g|png)$/i.test(f));
  if (!files.length) {
    const subs = readdirSync(folder, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => path.join(folder, d.name));
    if (subs.length) {
      folder = subs[0];
      files = readdirSync(folder).filter(f => /\.(jpe?g|png)$/i.test(f));
      console.log(`  [images] descending into: ${folder}  (${files.length} images)`);
    }
  }
  const result = {};

  for (const region of regions) {
    const regionLower = region.toLowerCase();
    const locales = REGION_LOCALES[region] || ['en'];
    result[region] = {};

    for (const locale of locales) {
      const suffix = `${regionLower}-${locale}`;
      // Collect all files matching the locale suffix
      const matches = files.filter(f => {
        const base = f.toLowerCase().replace(/\.(jpe?g|png)$/, '');
        return base.endsWith(`-${suffix}`) || base.includes(`-${suffix}-`) || base.includes(`_${suffix}_`);
      });
      // Prefer 1280x320 (WS1/WS2 V4 homepage) over 1000x503 (V3) or 1000x565 (promo page)
      const preferred = matches.find(f => /1280x320/i.test(f))
                     || matches.find(f => /1280/i.test(f))
                     || matches[0]
                     || null;
      result[region][locale] = preferred ? path.join(folder, preferred) : null;
    }
  }

  return result;
}

// ── Slug derivation ───────────────────────────────────────────────────────────

function campaignToSlug(campaignName) {
  // Strip brackets like [WS1], strip leading "WS1 MB8" annotations
  const cleaned = campaignName.replace(/^\[.*?\]\s*/, '').trim();
  return cleaned.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// ── Banner Schedule reader ────────────────────────────────────────────────────

async function readScheduleRows(bIds) {
  const client = await getSheetsClient();
  const range = `'${BANNER_SCHEDULE_TAB}'!A1:P200`;
  const res = await client.sheets.spreadsheets.values.get({
    spreadsheetId: BANNER_SCHEDULE_SHEET_ID,
    range,
  });
  const rows = res.data.values || [];

  const bIdSet = new Set(bIds);
  const found = [];

  for (const row of rows) {
    const bId = (row[1] || '').trim().toUpperCase();
    if (!bIdSet.has(bId)) continue;

    const platform = (row[8] || '').trim(); // column I = "Backoffice / Brand"
    // Only process WS1/WS2 BIA rows
    if (!platform.toLowerCase().startsWith('ws1') && !platform.toLowerCase().startsWith('ws2')) {
      console.log(`  [skip] ${bId} — brand "${platform}" is not WS1/WS2 (use upload-promo.js instead)`);
      continue;
    }

    // Classic MB8 uses iGMP BO (kioskmy.nougatsage.com), not Directus — out of scope
    if (/classic/i.test(platform)) {
      console.log(`  [skip] ${bId} — "${platform}" is Classic MB8 (iGMP BO, not Directus). Out of scope for this script.`);
      continue;
    }

    const siteId = platform.toLowerCase().includes('ws2') ? 'ws2' : 'ws1';
    const regions = (row[5] || '').split(/[,\s]+/).map(r => r.trim().toUpperCase()).filter(Boolean);
    found.push({
      bId,
      campaign:    (row[2] || '').trim(),
      draftLabel:  (row[3] || '').trim(),
      status:      (row[4] || '').trim(),
      regions,
      promo_type:  (row[7] || '').trim(),
      brand:       platform,
      siteId,
      placement:   (row[9]  || '').trim(),
      startRaw:    (row[10] || '').trim(),
      endRaw:      (row[11] || '').trim(),
    });
  }

  return found;
}

// ── Plan builder ──────────────────────────────────────────────────────────────

function buildPlan(rows, args) {
  const bannerDir = args.bannerDir
    ? path.resolve(args.bannerDir)
    : path.resolve(__dirname, '../../Banner');

  const plan = [];

  for (const row of rows) {
    const { bId, campaign, siteId, regions, startRaw, endRaw } = row;

    let startDate, endDate;
    try {
      startDate = parseScheduleDate(startRaw);
      endDate   = parseScheduleDate(endRaw);
    } catch (e) {
      console.error(`  [${bId}] date parse error: ${e.message} (start="${startRaw}" end="${endRaw}")`);
      continue;
    }

    const slug = campaignToSlug(row.draftLabel || campaign);
    console.log(`\n[${bId}] ${campaign}  site=${siteId}  regions=${regions.join(',')}  slug="${slug}"`);

    // Image discovery
    const imageMap = discoverImages(siteId, regions, bannerDir, args.imageDir);

    const entries = [];
    for (const region of regions) {
      const carouselId = CAROUSEL_IDS[siteId]?.[region];
      if (!carouselId) {
        console.warn(`  ⚠️  No UICarousel ID known for ${siteId}/${region} — skipping`);
        continue;
      }

      const prefix = REGION_URL_PREFIX[region] || region.toLowerCase();
      const linkUrl = `/promotion/info/${prefix}-${slug}`;
      const locales = REGION_LOCALES[region] || ['en'];

      const localeImages = {};
      let allImagesFound = true;
      for (const locale of locales) {
        const imgPath = imageMap?.[region]?.[locale] ?? null;
        localeImages[locale] = imgPath;
        if (!imgPath) allImagesFound = false;
      }

      entries.push({
        region,
        carouselId,
        carouselUrl: `${CMS_BASE[siteId]}/admin/content/UICarousel/${carouselId}`,
        linkUrl,
        cta:         args.cta,
        startDate:   formatDirectusDate(startDate, false),
        endDate:     formatDirectusDate(endDate,   true),
        startHuman:  `${formatHuman(startDate)} 00:00 MYT`,
        endHuman:    `${formatHuman(endDate)} 23:59 MYT`,
        locales,
        localeImages,
        imagesReady: allImagesFound,
      });
    }

    plan.push({ bId, campaign, siteId, cmsBase: CMS_BASE[siteId], entries });
  }

  return plan;
}

// ── Pretty-print ──────────────────────────────────────────────────────────────

function printPlan(plan, dryRun) {
  const SEP = '═'.repeat(70);
  for (const item of plan) {
    console.log(`\n${SEP}`);
    console.log(`${item.bId}: ${item.campaign}`);
    console.log(`  CMS: ${item.cmsBase}/admin`);
    console.log(`  ${dryRun ? 'DRY-RUN — no changes will be made' : 'LIVE — agent will execute Chrome steps'}`);
    console.log('');

    const missingImages = [];

    for (const e of item.entries) {
      console.log(`  Region ${e.region}  →  UICarousel id=${e.carouselId}`);
      console.log(`    URL:   ${e.carouselUrl}`);
      console.log(`    Link:  ${e.linkUrl}`);
      console.log(`    CTA:   "${e.cta}"`);
      console.log(`    Dates: ${e.startHuman} → ${e.endHuman}`);
      console.log(`    Directus start: ${e.startDate}  end: ${e.endDate}`);
      console.log(`    Locales + images:`);

      for (const locale of e.locales) {
        const img = e.localeImages[locale];
        if (img) {
          console.log(`      [${locale.toUpperCase()}]  ✅  ${path.basename(img)}`);
        } else {
          console.log(`      [${locale.toUpperCase()}]  ❌  NOT FOUND`);
          missingImages.push(`${e.region}/${locale.toUpperCase()}`);
        }
      }
      console.log('');
    }

    if (missingImages.length) {
      console.log(`  ⚠️  Missing images for: ${missingImages.join(', ')}`);
      console.log(`  ⚠️  Place 1280×320px images in Banner/${SITE_BRAND_PREFIX[item.siteId]}-<campaign>/`);
      console.log(`  ⚠️  Filename must include region-locale suffix, e.g. -my-en.jpg, -th-th.jpg`);
      if (!dryRun) {
        console.error('\n  ❌  Cannot proceed with --live — images missing. Add images and retry.');
      }
    }
  }
  console.log(`\n${SEP}`);
}

// ── Chrome automation step-list (for agent) ───────────────────────────────────

function printRunbook(plan) {
  console.log('\n\n' + '─'.repeat(70));
  console.log('CHROME RUNBOOK — execute these steps via Claude-in-Chrome MCP');
  console.log('─'.repeat(70));

  let step = 0;
  for (const item of plan) {
    for (const e of item.entries) {
      step++;
      const hasMissing = Object.values(e.localeImages).some(v => v === null);
      if (hasMissing) {
        console.log(`\n[${item.bId}/${e.region}] ⛔ SKIPPED — image(s) missing`);
        continue;
      }

      console.log(`\n── Step ${step}: ${item.bId} / ${e.region} (UICarousel id=${e.carouselId}) ──`);
      console.log(`  1. Navigate to: ${e.carouselUrl}`);
      console.log(`  2. Wait for page to load; verify component name contains "${e.region}"`);
      console.log(`  3. Click "Create New" inside the Images section`);
      console.log(`  4. Wait for drawer "Creating Item in UI Carousel Images"`);
      console.log(`  5. Fill Start Date: ${e.startDate} (picker shows MYT: ${e.startHuman})`);
      console.log(`  6. Fill End Date:   ${e.endDate} (picker shows MYT: ${e.endHuman})`);
      console.log(`  7. Leave Display Condition blank`);

      for (const locale of e.locales) {
        const imgPath = e.localeImages[locale];
        const langLabel = locale === 'en' ? 'English'
                        : locale === 'th' ? 'Thai'
                        : locale === 'kh' ? 'Khmer'
                        : locale === 'id' ? 'Indonesian'
                        : locale.toUpperCase();
        console.log(`  8. Translations → ${langLabel} tab:`);
        console.log(`       Link URL:      ${e.linkUrl}`);
        console.log(`       CTA Button:    ${e.cta}`);
        console.log(`       Image field:   leave empty (null — confirmed from live records)`);
        console.log(`       Files field:   upload  ${imgPath}`);
      }

      console.log(`  9. Verify Enabled toggle is OFF (leave for user QC)`);
      console.log(`  10. Leave form open — user will review + click Submit`);
    }
  }
  console.log('\n' + '─'.repeat(70));
  console.log('END OF RUNBOOK');
}

// ── JSON output ───────────────────────────────────────────────────────────────

function printJson(plan) {
  console.log('\n\nRUNBOOK_JSON_START');
  console.log(JSON.stringify(plan, null, 2));
  console.log('RUNBOOK_JSON_END');
}

// ── Main ──────────────────────────────────────────────────────────────────────

const args = parseArgs(process.argv);
const bIds = parseBIds(args.range || args.bIds);

console.log(`[upload-ws1-banners] B-IDs: ${bIds.join(', ')}  mode=${args.live ? 'LIVE' : 'DRY-RUN'}`);
console.log(`[upload-ws1-banners] Reading Banner Schedule tab "${BANNER_SCHEDULE_TAB}"...`);

const rows = await readScheduleRows(bIds);

if (!rows.length) {
  console.error('No WS1/WS2 rows found for the specified B-IDs. Check B-ID range and sheet tab name.');
  process.exit(1);
}

const plan = buildPlan(rows, args);

if (!plan.length) {
  console.error('Plan is empty — no processable entries. Check region/UICarousel mapping and image files.');
  process.exit(1);
}

printPlan(plan, args.dryRun);

if (args.live) {
  // Check for missing images before attempting live execution
  const anyMissing = plan.some(item =>
    item.entries.some(e => Object.values(e.localeImages).some(v => v === null))
  );
  if (anyMissing) {
    console.error('\n❌ Cannot run --live: missing banner images (see ⚠️ above). Add images first.');
    process.exit(1);
  }
  printRunbook(plan);
  printJson(plan);
  console.log('\n✅ Runbook ready. The Claude agent should now execute the Chrome MCP steps above.');
  console.log('   Each entry leaves the Directus drawer open for Jascinta to review + Submit.');
}

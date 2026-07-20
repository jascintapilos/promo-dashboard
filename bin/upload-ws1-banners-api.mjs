#!/usr/bin/env node
// WS1 (MB8) + WS2 (RWS77) Directus UICarousel banner uploader — API-direct.
//
// Replaces the Chrome-MCP runbook in upload-ws1-banners.mjs with a fully
// automated API upload using promo_testbot credentials (cms-creds.local.json).
// Verified permissions: POST /files + POST /items/UICarousel_images +
// POST /items/UICarousel_images_translations all return 200/201. No 403.
//
// Usage
// ─────
//   node bin/upload-ws1-banners-api.mjs --range=B50
//   node bin/upload-ws1-banners-api.mjs --range=B50 --commit
//   node bin/upload-ws1-banners-api.mjs --range=B48-B52 --commit
//   node bin/upload-ws1-banners-api.mjs --range=B50 --cta="Claim Now"
//   node bin/upload-ws1-banners-api.mjs --range=B50 --commit --tag=TEST
//
// Flags
// ─────
//   --range=<B##-B##>     B-ID range (inclusive); also single B-ID
//   --b-ids=<B##,...>     comma-list of specific B-IDs
//   --banner-dir=<path>   banner image root (default: ../Banner/ rel to this script)
//   --image-dir=<path>    bypass brand detection; use this folder directly
//   --cta=<text>          CTA button text for all locales (default: "Learn More")
//   --dry-run             print plan without uploading (default)
//   --commit              live upload via Directus API
//   --tag=<label>         extra label for image subfolder search (e.g. TEST)
//
// API shape (Directus, cms.toffeemace.com)
// ──────────────────────────────────────────
//   1. POST /files                                → upload image → UUID
//   2. POST /items/UICarousel_images              → slide row
//   3. POST /items/UICarousel_images_translations → per-locale row, links image UUID
//
// Outputs QC bundles to captures/banner-qc-bundles/{b_id}__ws1__{region}.json
//
// UICarousel IDs (probed 2026-05-19 — ws1-directus-probe-summary.md)
// ──────────────────────────────────────────────────────────────────
//   WS1 (MB8):  MY=226  TH=28  ID=132  KH=80  SG=54  AU=227  PH=158
//   WS2 (RWS77): MY=1

import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cmsClient } from '../src/cms-client.js';
import { getSheetsClient } from '../src/sheets-client.js';
import { resolveScheduleTab } from '../src/banner-schedule.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ── Constants ─────────────────────────────────────────────────────────────────

const BANNER_SCHEDULE_SHEET_ID = '1vpyjhqiKzcn2XHovcN2tEa4UkzUMqTmFsUZ59m-n8_E';

// UICarousel IDs — probed 2026-05-19
const CAROUSEL_IDS = {
  ws1:  { MY: 226, TH: 28, ID: 132, KH: 80, SG: 54, AU: 227, PH: 158 },
  ws2:  { MY: 1 },
};

const CMS_HOST = {
  ws1: 'https://cms.toffeemace.com',
  ws2: 'https://ws2-cms.toffeemace.com',
};

// Locales per region. MY supports EN+ZH confirmed by vendor delivery.
// Locale codes match Directus languages_code values (from /items/languages probe).
const REGION_LOCALES = {
  MY: ['en', 'zh'],
  TH: ['en', 'th'],
  ID: ['en', 'id'],
  KH: ['en', 'km'],
  SG: ['en'],
  AU: ['en'],
  PH: ['en'],
};

// Some Directus locale codes differ from image filename suffix conventions used
// by the design team. This map translates Directus code → filename suffix.
// e.g. Khmer: Directus uses 'km' but design team filenames use 'kh'.
const LOCALE_FILENAME_SUFFIX = {
  km: 'kh',
};

// Region → URL path prefix used in /promotion/info/{prefix}-{slug}
const REGION_URL_PREFIX = {
  MY: 'my', TH: 'th', ID: 'id', KH: 'kh', SG: 'sg', AU: 'au', PH: 'ph',
};

const SITE_BRAND_PREFIX = { ws1: 'mb8', ws2: 'rws77' };

// ── Arg parsing ───────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    range: null, bIds: null, bannerDir: null, imageDir: null,
    cta: 'Learn More', dryRun: true, commit: false, tag: null,
  };
  for (const a of argv.slice(2)) {
    const [k, ...vParts] = a.replace(/^--/, '').split('=');
    const v = vParts.join('=');
    if (k === 'range')      args.range     = v;
    if (k === 'b-ids')      args.bIds      = v;
    if (k === 'banner-dir') args.bannerDir = v;
    if (k === 'image-dir')  args.imageDir  = v;
    if (k === 'cta')        args.cta       = v;
    if (k === 'tag')        args.tag       = v;
    if (k === 'dry-run')    { args.dryRun = true;  args.commit = false; }
    if (k === 'commit')     { args.commit = true;  args.dryRun = false; }
  }
  if (!args.range && !args.bIds) {
    console.error('ERROR: --range=<B##-B##> or --b-ids=<B##,...> required.');
    process.exit(1);
  }
  return args;
}

function parseBIds(rangeStr) {
  const out = new Set();
  for (const tok of (rangeStr || '').trim().split(/[,\s]+/).filter(Boolean)) {
    const rng = tok.match(/^B(\d+)-B?(\d+)$/i);
    if (rng) {
      const [lo, hi] = [+rng[1], +rng[2]].sort((a, b) => a - b);
      for (let i = lo; i <= hi; i++) out.add(fmtBId(i));
    } else {
      const s = tok.match(/^B(\d+)$/i);
      if (s) out.add(fmtBId(+s[1]));
      else throw new Error(`Cannot parse B-ID token: "${tok}"`);
    }
  }
  return [...out].sort();
}
function fmtBId(n) { return n < 100 ? `B${String(n).padStart(2, '0')}` : `B${n}`; }

// ── Date helpers ──────────────────────────────────────────────────────────────

function parseScheduleDate(raw) {
  const ddMon = raw.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (ddMon) {
    const MONTHS = { Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12 };
    const m = MONTHS[ddMon[2]]; if (!m) throw new Error(`Unknown month: ${ddMon[2]}`);
    return new Date(+ddMon[3], m - 1, +ddMon[1]);
  }
  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) return new Date(+slash[3], +slash[2] - 1, +slash[1]);
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3]);
  throw new Error(`Cannot parse date: "${raw}"`);
}

function toDirectusDate(d, endOfDay = false) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${endOfDay ? '23:59:59' : '00:00:00'}`;
}

function toISO(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ── Banner Schedule reader ────────────────────────────────────────────────────

async function readScheduleRows(bIds) {
  const sheetsClient = await getSheetsClient();
  const tab = await resolveScheduleTab(sheetsClient);
  console.log(`[schedule] Reading tab "${tab}"...`);

  const res = await sheetsClient.sheets.spreadsheets.values.get({
    spreadsheetId: BANNER_SCHEDULE_SHEET_ID,
    range: `'${tab}'!A1:P300`,
  });
  const rows = res.data.values || [];
  const bIdSet = new Set(bIds);
  const found = [];

  for (const row of rows) {
    const bId = (row[1] || '').trim().toUpperCase();
    if (!bIdSet.has(bId)) continue;

    const brand = (row[8] || '').trim();
    const brandLow = brand.toLowerCase();
    if (!brandLow.startsWith('ws1') && !brandLow.startsWith('ws2')) {
      console.log(`  [skip] ${bId} — brand "${brand}" is not WS1/WS2 (use upload-promo.js instead)`);
      continue;
    }
    if (/classic/i.test(brand)) {
      console.log(`  [skip] ${bId} — "${brand}" is Classic MB8 (iGMP BO). Out of scope.`);
      continue;
    }

    const siteId = brandLow.startsWith('ws2') ? 'ws2' : 'ws1';
    const regions = (row[5] || '').split(/[,\s]+/).map((r) => r.trim().toUpperCase()).filter(Boolean);
    found.push({
      bId,
      campaign:   (row[2] || '').trim(),
      draftLabel: (row[3] || '').trim(),
      status:     (row[4] || '').trim(),
      regions,
      brand, siteId,
      startRaw:   (row[10] || '').trim(),
      endRaw:     (row[11] || '').trim(),
    });
  }
  return found;
}

// ── Image discovery ───────────────────────────────────────────────────────────

function discoverImages(siteId, regions, bannerDir, imageDirOverride, tag) {
  const brand = SITE_BRAND_PREFIX[siteId] || siteId;
  let folder = imageDirOverride;

  if (!folder) {
    // Find subfolder starting with brand code (prefer *-min; if tag given prefer tag match)
    const entries = readdirSync(bannerDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.toLowerCase().startsWith(brand));
    if (!entries.length) {
      console.warn(`  [images] ⚠  No subfolder starting with "${brand}" in ${bannerDir}`);
      return null;
    }
    const preferred = (tag ? entries.find((e) => e.name.toLowerCase().includes(tag.toLowerCase())) : null)
                   || entries.find((e) => e.name.endsWith('-min'))
                   || entries[0];
    folder = path.join(bannerDir, preferred.name);
    console.log(`  [images] folder: ${path.basename(folder)}`);
  } else {
    if (!existsSync(folder)) { console.warn(`  [images] ⚠  --image-dir not found: ${folder}`); return null; }
    console.log(`  [images] override folder: ${folder}`);
  }

  // Descend one level if no images directly in matched folder
  let files = readdirSync(folder).filter((f) => /\.(jpe?g|png)$/i.test(f));
  if (!files.length) {
    const subs = readdirSync(folder, { withFileTypes: true })
      .filter((d) => d.isDirectory()).map((d) => path.join(folder, d.name));
    if (subs.length) {
      folder = subs[0];
      files = readdirSync(folder).filter((f) => /\.(jpe?g|png)$/i.test(f));
      console.log(`  [images] descending: ${path.basename(folder)}  (${files.length} images)`);
    }
  }

  // Build result: region → locale → { desktop, mobile }
  // Prefer -up- (1280×) for desktop, -mup- (960×/640×) for mobile.
  // If only one file per locale-region, use it for both.
  const result = {};
  for (const region of regions) {
    const regionLow = region.toLowerCase();
    const locales = REGION_LOCALES[region] || ['en'];
    result[region] = {};

    for (const locale of locales) {
      // Use filename suffix override if design team uses a different code than Directus
      const filenameSuffix = LOCALE_FILENAME_SUFFIX[locale] || locale;
      const suffix = `${regionLow}-${filenameSuffix}`;
      let matches = files.filter((f) => {
        const base = f.toLowerCase().replace(/\.(jpe?g|png)$/, '');
        return base.endsWith(`-${suffix}`) || base.includes(`-${suffix}-`) || base.includes(`_${suffix}_`);
      });

      // Fallback: locale-only suffix (Nextcloud files use -en/-zh/-id/-kh/-th
      // without a region prefix — one file covers all regions for that locale).
      if (!matches.length) {
        matches = files.filter((f) => {
          const base = f.toLowerCase().replace(/\.(jpe?g|png)$/, '');
          return base.endsWith(`-${filenameSuffix}`);
        });
        if (matches.length) {
          console.log(`    [${region}/${locale}] locale-only fallback — ${matches.length} file(s) found`);
        }
      }

      const desktopFile = matches.find((f) => /-up[^a-z]/i.test(f) || /1280|1920/i.test(f))
                       || matches.find((f) => !/mup/i.test(f))
                       || matches[0]
                       || null;
      // For mobile: prefer explicit -mup-/960/640 markers, then any file that is
      // NOT the 1280/1920 desktop (e.g. 1000x503 or 1000x565 from Nextcloud).
      const mobileFile  = matches.find((f) => /mup/i.test(f) || /960|640/i.test(f))
                       || (matches.length > 1
                           ? matches.find((f) => !/1280|1920/i.test(f))
                           : null)
                       || desktopFile;

      result[region][locale] = {
        desktop: desktopFile ? path.join(folder, desktopFile) : null,
        mobile:  mobileFile  ? path.join(folder, mobileFile)  : null,
      };
    }
  }
  return result;
}

// ── Link URL helper ───────────────────────────────────────────────────────────

function campaignToSlug(label) {
  return label.replace(/^\[.*?\]\s*/, '').trim()
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// ── Plan builder ──────────────────────────────────────────────────────────────

function buildPlan(rows, args) {
  const bannerDir = args.bannerDir
    ? path.resolve(args.bannerDir)
    : path.resolve(__dirname, '../Banner');

  const plan = [];
  for (const row of rows) {
    const { bId, campaign, draftLabel, siteId, regions, startRaw, endRaw } = row;

    let startDate, endDate;
    try {
      startDate = parseScheduleDate(startRaw);
      endDate   = parseScheduleDate(endRaw);
    } catch (e) {
      console.error(`  [${bId}] date error: ${e.message} (start="${startRaw}" end="${endRaw}")`);
      continue;
    }

    const slug = campaignToSlug(draftLabel || campaign);
    console.log(`\n[${bId}] ${campaign}  site=${siteId}  regions=${regions.join(',')}  slug="${slug}"`);

    const imageMap = discoverImages(siteId, regions, bannerDir, args.imageDir, args.tag);

    const entries = [];
    for (const region of regions) {
      const carouselId = CAROUSEL_IDS[siteId]?.[region];
      if (!carouselId) {
        console.warn(`  ⚠  No UICarousel ID for ${siteId}/${region} — skipping`);
        continue;
      }

      const prefix  = REGION_URL_PREFIX[region] || region.toLowerCase();
      const linkUrl = `/promotion/info/${prefix}-${slug}`;
      const locales = REGION_LOCALES[region] || ['en'];

      const localeImages = {};
      let allPresent = true;
      for (const locale of locales) {
        const pair = imageMap?.[region]?.[locale] ?? { desktop: null, mobile: null };
        localeImages[locale] = pair;
        if (!pair.desktop) allPresent = false;
      }

      entries.push({
        region, carouselId, linkUrl, cta: args.cta, locales, localeImages,
        startDate: toDirectusDate(startDate, false),
        endDate:   toDirectusDate(endDate,   true),
        startISO:  toISO(startDate),
        endISO:    toISO(endDate),
        imagesReady: allPresent,
      });
    }

    plan.push({ bId, campaign, siteId, cmsHost: CMS_HOST[siteId], entries });
  }
  return plan;
}

// ── Dry-run printer ───────────────────────────────────────────────────────────

function printPlan(plan) {
  const SEP = '═'.repeat(72);
  const missing = [];
  for (const item of plan) {
    console.log(`\n${SEP}`);
    console.log(`${item.bId}: ${item.campaign}  [${item.siteId.toUpperCase()}]  DRY-RUN`);
    for (const e of item.entries) {
      console.log(`\n  Region ${e.region}  carouselId=${e.carouselId}  ${e.startISO} → ${e.endISO}`);
      console.log(`    Link: ${e.linkUrl}  CTA: "${e.cta}"`);
      for (const locale of e.locales) {
        const p = e.localeImages[locale];
        const d = p.desktop ? `✔ ${path.basename(p.desktop)}` : '✘ NOT FOUND';
        const m = p.mobile  ? (p.mobile === p.desktop ? '(same)' : `✔ ${path.basename(p.mobile)}`) : '✘ NOT FOUND';
        console.log(`    [${locale.toUpperCase()}] desktop: ${d}`);
        console.log(`         mobile:  ${m}`);
        if (!p.desktop) missing.push(`${item.bId}/${e.region}/${locale.toUpperCase()}`);
      }
    }
  }
  console.log(`\n${SEP}`);
  if (missing.length) {
    console.log(`\n⚠  Missing images: ${missing.join(', ')}`);
    console.log('   Add images to Banner/{brand}-{campaign}/ and retry.');
  } else {
    console.log('\n✔ All images found. Run with --commit to upload.');
  }
}

// ── Directus API helpers ──────────────────────────────────────────────────────

async function uploadFile(client, filePath, title) {
  const buf = readFileSync(filePath);
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const name = path.basename(filePath);

  // Guard 1 — minimum size. Anything under 10 KB is a placeholder, a failed
  // download, or an empty file. Real carousel banners are 200 KB+.
  if (buf.length < 10_000) {
    throw new Error(
      `Image too small (${buf.length} bytes) — looks like a placeholder or corrupt download: ${name}\n` +
      `  Expected ≥ 10 KB. Check the staged file and re-pull from Nextcloud.`
    );
  }

  // Guard 2 — magic bytes. Confirm the file actually IS what the extension claims.
  // JPEG: FF D8 FF  |  PNG: 89 50 4E 47
  const isJpeg = buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF;
  const isPng  = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47;
  if (ext === 'png' && !isPng) {
    throw new Error(`Magic bytes don't match PNG — file may be corrupted or mislabelled: ${name}`);
  }
  if ((ext === 'jpg' || ext === 'jpeg') && !isJpeg) {
    throw new Error(`Magic bytes don't match JPEG — file may be corrupted or mislabelled: ${name}`);
  }

  const mime = isPng ? 'image/png' : 'image/jpeg';
  const fd = new FormData();
  fd.append('title', title);
  fd.append('file', new Blob([buf], { type: mime }), path.basename(filePath));
  const res = await fetch(`${client.host}/files`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${client.token}` },
    body: fd,
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`File upload failed [${res.status}]: ${JSON.stringify(body?.errors || body).slice(0, 200)}`);
  return body.data.id;
}

async function createImageRow(client, { carouselId, startDate, endDate }) {
  const res = await fetch(`${client.host}/items/UICarousel_images`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${client.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ UICarousel_id: carouselId, startDate, endDate }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Create image row failed [${res.status}]: ${JSON.stringify(body?.errors || body).slice(0, 200)}`);
  return body.data.id;
}

async function createTranslation(client, { imageRowId, locale, linkUrl, cta, desktopUuid, mobileUuid }) {
  const res = await fetch(`${client.host}/items/UICarousel_images_translations`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${client.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      UICarousel_images_id: imageRowId,
      languages_code: locale,
      linkUrl,
      ctaButtonText: cta || null,
      image: desktopUuid || null,
      files: mobileUuid  || null,
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Create translation failed [${res.status}]: ${JSON.stringify(body?.errors || body).slice(0, 200)}`);
  return body.data.id;
}

// ── Commit ────────────────────────────────────────────────────────────────────

async function commitPlan(plan) {
  const qcDir = path.resolve('captures/banner-qc-bundles');
  mkdirSync(qcDir, { recursive: true });

  const results = [];

  for (const item of plan) {
    const cms = await cmsClient(item.cmsHost);
    console.log(`\n[${item.bId}] ${item.campaign}  CMS: ${item.cmsHost}`);

    for (const e of item.entries) {
      if (!e.imagesReady) {
        console.warn(`  ⚠  [${e.region}] skipping — missing images`);
        results.push({ bId: item.bId, region: e.region, status: 'SKIPPED', reason: 'missing images' });
        continue;
      }

      try {
        // Step 1: upload images per locale
        const localeUuids = {};
        for (const locale of e.locales) {
          const { desktop, mobile } = e.localeImages[locale];
          process.stdout.write(`  [${e.region}/${locale.toUpperCase()}] uploading desktop...`);
          const desktopUuid = await uploadFile(cms, desktop, `${item.bId}-${e.region}-${locale}-desktop`);
          process.stdout.write(` ${desktopUuid.slice(0, 8)}…`);

          let mobileUuid = desktopUuid;
          if (mobile && mobile !== desktop) {
            process.stdout.write('  mobile...');
            mobileUuid = await uploadFile(cms, mobile, `${item.bId}-${e.region}-${locale}-mobile`);
            process.stdout.write(` ${mobileUuid.slice(0, 8)}…`);
          }
          localeUuids[locale] = { desktop: desktopUuid, mobile: mobileUuid };
          process.stdout.write(' ✔\n');
        }

        // Step 2: create UICarousel_images row
        process.stdout.write(`  [${e.region}] creating image row...`);
        const imageRowId = await createImageRow(cms, {
          carouselId: e.carouselId,
          startDate: e.startDate,
          endDate:   e.endDate,
        });
        process.stdout.write(` id=${imageRowId} ✔\n`);

        // Step 3: create translation rows
        const translationIds = {};
        for (const locale of e.locales) {
          const { desktop, mobile } = localeUuids[locale];
          process.stdout.write(`  [${e.region}/${locale.toUpperCase()}] creating translation...`);
          const translationId = await createTranslation(cms, {
            imageRowId,
            locale,
            linkUrl: e.linkUrl,
            cta: e.cta,
            desktopUuid: desktop,
            mobileUuid:  mobile,
          });
          translationIds[locale] = translationId;
          process.stdout.write(` id=${translationId} ✔\n`);
        }

        // Write QC bundle
        const bundleKey = `${item.bId}__${item.siteId}__${e.region.toLowerCase()}`;
        const bundle = {
          b_id:          item.bId,
          site_id:       item.siteId,
          region:        e.region,
          campaign:      item.campaign,
          cms_host:      item.cmsHost,
          carousel_id:   e.carouselId,
          image_row_id:  imageRowId,
          translation_ids: translationIds,
          locale_uuids:    localeUuids,
          link_url:      e.linkUrl,
          cta:           e.cta,
          start_date:    e.startDate,
          end_date:      e.endDate,
          created_at:    new Date().toISOString(),
        };
        writeFileSync(path.join(qcDir, `${bundleKey}.json`), JSON.stringify(bundle, null, 2));

        results.push({ bId: item.bId, region: e.region, status: 'OK', imageRowId, translationIds });
        console.log(`  [${e.region}] ✔ QC bundle → captures/banner-qc-bundles/${bundleKey}.json`);

      } catch (err) {
        console.error(`  [${e.region}] ✘ ${err.message}`);
        results.push({ bId: item.bId, region: e.region, status: 'ERROR', error: err.message });
      }
    }
  }

  return results;
}

// ── Results table ─────────────────────────────────────────────────────────────

function printResults(results) {
  console.log('\n' + '─'.repeat(60));
  console.log('UPLOAD RESULTS');
  console.log('─'.repeat(60));
  for (const r of results) {
    if (r.status === 'OK') {
      console.log(`✔ ${r.bId}/${r.region}  imageRow=${r.imageRowId}  translations=${JSON.stringify(r.translationIds)}`);
    } else if (r.status === 'SKIPPED') {
      console.log(`⚠ ${r.bId}/${r.region}  SKIPPED — ${r.reason}`);
    } else {
      console.log(`✘ ${r.bId}/${r.region}  ERROR — ${r.error}`);
    }
  }
  const ok = results.filter((r) => r.status === 'OK').length;
  console.log(`\n${ok}/${results.length} regions uploaded successfully.`);
  if (ok === results.length) {
    console.log('Next: verify banners in Directus CMS admin, then activate the carousel.');
    console.log('      Run /banner-deep-qc for post-upload verification.');
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

const args = parseArgs(process.argv);
const bIds = parseBIds(args.range || args.bIds);

console.log(`[upload-ws1-banners-api] B-IDs: ${bIds.join(', ')}  mode=${args.commit ? 'COMMIT' : 'DRY-RUN'}`);
if (args.tag) console.log(`[upload-ws1-banners-api] tag=${args.tag}`);

const rows = await readScheduleRows(bIds);
if (!rows.length) {
  console.error('No WS1/WS2 rows found for the given B-IDs. Check B-ID and sheet tab.');
  process.exit(1);
}

const plan = buildPlan(rows, args);
if (!plan.length) {
  console.error('Plan is empty — check region/UICarousel mapping and image files.');
  process.exit(1);
}

if (args.dryRun) {
  printPlan(plan);
  process.exit(0);
}

// Check for missing images before committing
const anyMissing = plan.some((item) => item.entries.some((e) => !e.imagesReady));
if (anyMissing) {
  printPlan(plan);
  console.error('\n✘ Cannot commit — missing banner images (see ⚠ above). Add images first.');
  process.exit(1);
}

const results = await commitPlan(plan);
printResults(results);

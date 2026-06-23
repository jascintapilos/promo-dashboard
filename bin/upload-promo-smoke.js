#!/usr/bin/env node
// Phase 2d smoke test — API-direct 3.3 + 14.2 chain on QPRO4.
// Body shapes captured live from the SPA on 2026-05-18.
//
//   node bin/upload-promo-smoke.js --site=qpro4

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from './_args.js';
import { getSite } from '../src/sites.js';
import {
  createPromotionContent,
  emptyPromoContentDetail,
  localToUtcBoDate,
  createBanner,
  uploadFile,
  getAllCategories,
} from '../src/api-client.js';

const { flags } = parseArgs(process.argv.slice(2));
const site = getSite(flags.site || 'qpro4');

const stamp = Date.now().toString().slice(-6);
const code = `TEST_API_${stamp}`.slice(0, 15);

console.log(`[smoke] site: ${site.id}  code: ${code}`);

// Local times → UTC for the BO (it expects UTC despite UI showing GMT+8)
const startLocal = '2026-04-21 00:00:00';
const endLocal   = '2026-05-03 23:59:00';
const startUtc = localToUtcBoDate(startLocal);
const endUtc   = localToUtcBoDate(endLocal);

const desktopPath = 'C:\\Users\\vdiuser\\Downloads\\promo-automation\\Banner\\ye55-min\\ye55-up-microgaming-playboy-ultimate-extravaganza-1920x400px-my-en.jpg';
const mobilePath  = 'C:\\Users\\vdiuser\\Downloads\\promo-automation\\Banner\\ye55-min\\ye55-mup-microgaming-playboy-ultimate-extravaganza-960x400px-my-en.jpg';

// ── Step 0: categories ────────────────────────────────────────────────
const cats = await getAllCategories(site);
const catObj = Object.fromEntries(cats.map((c, i) => [String(i), c.id]));
console.log(`[smoke] ${cats.length} categories → select-all`);

// ── Step 1: upload promo-page image via /api/bo/file?type=promotions ──
console.log(`[smoke] uploadFile (promotions)…`);
const upRes = await uploadFile(site, readFileSync(mobilePath), path.basename(mobilePath), { type: 'promotions' });
console.log(`[smoke] raw upload response:`, JSON.stringify(upRes, null, 2).slice(0, 800));
// Response shape confirmed: { data: { files: [<url>, ...] } }
const promoImageUrl = upRes?.data?.files?.[0] || null;
console.log(`[smoke] uploaded → ${promoImageUrl}`);
if (!promoImageUrl) {
  console.error(`[smoke] ❌ could not extract image URL from upload response. See raw above.`);
  process.exit(1);
}

// ── Step 2: 3.3 Promotion Content ─────────────────────────────────────
// settings_locale_id catalog observed on QPRO4: 1=MY_EN, 2=MY_ZH, 3=US_EN
// Must include all-null stubs for unused locales.
const detail1 = {
  ...emptyPromoContentDetail(),
  settings_locale_id: 1,
  title: 'Microgaming Playboy Ultimate Extravaganza (API TEST)',
  description: 'Enter the Game of Glamour and Fortune!',
  start: startUtc,
  end: endUtc,
  publish_at: startUtc,
  expire_at: endUtc,
  image: typeof promoImageUrl === 'string' ? promoImageUrl : null,
  content: '<p>API smoke test.</p>',
};

const promoBody = {
  code,
  category_id: catObj,
  content_type: { '1': true, '2': true },
  member_visibility: 0,
  position: 99,
  apply_action: 0,
  max_application: 0,
  details: {
    '1': detail1,
    '2': emptyPromoContentDetail(),
    '3': emptyPromoContentDetail(),
  },
};

let promoContentId;
try {
  const res = await createPromotionContent(site, promoBody);
  promoContentId = res?.data?.rows?.id ?? res?.data?.id ?? res?.data?.rows?.[0]?.id;
  if (promoContentId == null) console.log(`[smoke] raw 3.3 response:`, JSON.stringify(res?.data, null, 2).slice(0, 400));
  console.log(`[smoke] ✅ 3.3 created — id=${promoContentId}, code=${code}`);
} catch (e) {
  console.error(`[smoke] ❌ 3.3 create failed:`, e.message);
  console.error(`[smoke] body keys:`, Object.keys(promoBody));
  console.error(`[smoke] details keys:`, Object.keys(promoBody.details));
  console.error(`[smoke] detail.1 keys:`, Object.keys(promoBody.details['1']));
  process.exit(1);
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Step 3: upload banner images via /api/bo/file?type=banners ────────
await delay(1500);
console.log(`[smoke] uploadFile desktop (banners)…`);
const dRes = await uploadFile(site, readFileSync(desktopPath), path.basename(desktopPath), { type: 'banners' });
const desktopUrl = dRes?.data?.files?.[0] || null;
console.log(`[smoke] desktop URL: ${desktopUrl}`);

await delay(3000);
console.log(`[smoke] uploadFile mobile (banners)…`);
const mRes = await uploadFile(site, readFileSync(mobilePath), path.basename(mobilePath), { type: 'banners' });
const mobileUrl = mRes?.data?.files?.[0] || null;
console.log(`[smoke] mobile URL: ${mobileUrl}`);

// ── Step 4: 14.2 Banner ──────────────────────────────────────────────
// Body shape inferred (not yet captured exactly); first run reveals 422s.
const bannerBody = {
  label: 'Microgaming Playboy Ultimate Extravaganza (API TEST)',
  link: `/promotion?code=${code}`,
  start_datetime: startUtc,
  end_datetime: endUtc,
  position: 99,
  status: 0,
  session: 1,
  platform_type_id: 1,
  images: [
    { settings_locale_id: 1, image_desktop: desktopUrl, image_mobile: mobileUrl },
  ],
};

await delay(1500);
try {
  const res = await createBanner(site, bannerBody);
  console.log(`[smoke] ✅ banner created — id=${res?.data?.rows?.id || res?.data?.id}`);
} catch (e) {
  console.error(`[smoke] ❌ banner create failed:`, e.message);
  console.error(`[smoke] body sent:`, JSON.stringify(bannerBody, null, 2));
}

console.log(`[smoke] ============================================`);
console.log(`[smoke] DONE. 3.3 id=${promoContentId}, code=${code}, both saved as Inactive.`);

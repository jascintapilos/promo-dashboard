// Two fixes for B46/BP9 (qpro1), banner id=839, content id=198:
//   1. Correct MY_EN's description/content (undo the old doc-parsing bug's output)
//   2. Add the ID_EN locale (id=8) to both banner and content, reusing MY_EN's
//      banner images and doc content (per user direction: no id-en asset exists)
//
// Safe PUT pattern (matches bin/fix-bp9-b46-content2.mjs): fetch full current
// state, mutate only what's intended, strip server-only fields, PUT the whole
// body back so nothing else gets silently wiped.

import { authedFetch, updateBanner } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const DRY_RUN = !process.argv.includes('--commit');
const SITE_ID = 'qpro1';
const BANNER_ID = 839;
const CONTENT_ID = 198;
const SERVER_FIELDS = new Set(['id', 'promotion_content_id', 'settings_locale_code', 'created_at', 'updated_at']);

const CORRECTED_DESCRIPTION = 'Catch the Drop. Claim Your Reward.';
const LEADING_CONTENT_PARAGRAPH =
  '<p>Step into the stunning aqua-themed world of Amazing Baccarat, featuring 5 Lucky Cards with multipliers of up to 200x of fast-paced Speed Baccarat action. From 20 – 31 July, we’re turning up the excitement with 5,000 Cash Drop prizes worth a total of USD 50,000 and the best part? With no minimum bet required, every qualifying bet gives you a chance to catch a Cash Drop reward!</p>';

const site = getSite(SITE_ID);

console.log(`[fix-b46] mode=${DRY_RUN ? 'DRY-RUN' : 'COMMIT'}\n`);

// ── 1. Promotion content (3.3) ──────────────────────────────────────────────
const contentRes = await authedFetch(site, `/api/bo/promotioncontent/${CONTENT_ID}`);
const content = contentRes?.data?.content;
const details = JSON.parse(JSON.stringify(contentRes?.data?.details || {}));

if (!content || !details['1']) {
  throw new Error('Unexpected content shape — aborting before any write.\n' + JSON.stringify(contentRes).slice(0, 500));
}

console.log('Existing content locales:', Object.keys(details).join(', '));

// Fix MY_EN (locale 1): correct description, prepend the missing opening paragraph
const myEn = details['1'];
console.log('\nMY_EN description BEFORE:', JSON.stringify(myEn.description));
myEn.description = CORRECTED_DESCRIPTION;
console.log('MY_EN description AFTER: ', JSON.stringify(myEn.description));
console.log('MY_EN content BEFORE (first 100 chars):', myEn.content.slice(0, 100));
if (!myEn.content.includes('Step into the stunning aqua-themed world')) {
  myEn.content = LEADING_CONTENT_PARAGRAPH + myEn.content;
  console.log('MY_EN content AFTER  (first 150 chars):', myEn.content.slice(0, 150));
} else {
  console.log('MY_EN content already contains the opening paragraph — skipping prepend.');
}

// Add ID_EN (locale 8): reuse MY_EN's doc content + image entirely
if (details['8']) {
  console.log('\nID_EN (locale 8) already exists on this content — leaving untouched.');
} else {
  details['8'] = {
    ...myEn,
    settings_locale_id: 8,
  };
  console.log('\nID_EN (locale 8) added — reusing MY_EN title/description/content/image.');
}

function cleanDetails(det) {
  const out = {};
  for (const [k, d] of Object.entries(det)) {
    if (!d) { out[k] = d; continue; }
    out[k] = Object.fromEntries(Object.entries(d).filter(([f]) => !SERVER_FIELDS.has(f)));
  }
  return out;
}

const categoryObj = Object.fromEntries((content.category_id || []).map((id, i) => [String(i), id]));
const contentTypeObj = Object.fromEntries((content.content_type || []).map((t) => [String(t), true]));
const contentPutBody = {
  code: content.code,
  category_id: categoryObj,
  content_type: contentTypeObj,
  member_visibility: content.member_visibility,
  position: content.position,
  apply_action: content.apply_action,
  allow_apply: content.allow_apply,
  status: content.status,
  max_application: content.max_application,
  details: cleanDetails(details),
};

console.log('\n--- CONTENT PUT BODY locales:', Object.keys(contentPutBody.details).join(', '), '---');
console.log(JSON.stringify(contentPutBody, null, 2).slice(0, 2000));

if (!DRY_RUN) {
  const r = await authedFetch(site, `/api/bo/promotioncontent/${CONTENT_ID}`, { method: 'PUT', body: contentPutBody });
  console.log('\nContent PUT result:', JSON.stringify(r?.message || r?.success || r).slice(0, 300));
} else {
  console.log('\n[DRY-RUN] would PUT content now — no write performed.');
}

// ── 2. Banner (14.2) ─────────────────────────────────────────────────────────
const bannerRes = await authedFetch(site, `/api/bo/banner/${BANNER_ID}`);
const banner = bannerRes?.data?.rows ?? bannerRes?.data;

console.log('\n\nBanner detail top-level keys:', banner ? Object.keys(banner).join(', ') : '(none)');

if (!banner || !Array.isArray(banner.locale)) {
  throw new Error('Unexpected banner shape — aborting before any write.\n' + JSON.stringify(bannerRes).slice(0, 500));
}

const images = banner.locale.map((l) => ({
  settings_locale_id: l.settings_locale_id,
  image_desktop: l.image_desktop,
  image_mobile: l.image_mobile,
}));
console.log('Existing banner locales:', images.map((i) => i.settings_locale_id).join(', '));

const myEnImages = images.find((im) => im.settings_locale_id === 1);
if (!myEnImages) throw new Error('MY_EN (locale 1) images not found on banner — aborting.');

if (images.some((im) => im.settings_locale_id === 8)) {
  console.log('ID_EN (locale 8) already exists on this banner — leaving untouched.');
} else {
  images.push({
    settings_locale_id: 8,
    image_desktop: myEnImages.image_desktop,
    image_mobile: myEnImages.image_mobile,
  });
  console.log('ID_EN (locale 8) added to banner images — reusing MY_EN image URLs.');
}

const bannerPutBody = {
  label: banner.label,
  link: banner.link,
  session: banner.session,
  platform_type_id: banner.platform_type_id,
  position: banner.position,
  status: banner.status,
  start_datetime: String(banner.start_datetime).slice(0, 19).replace('T', ' '),
  end_datetime: String(banner.end_datetime).slice(0, 19).replace('T', ' '),
  images,
};

console.log('\n--- BANNER PUT BODY ---');
console.log(JSON.stringify(bannerPutBody, null, 2));

if (!DRY_RUN) {
  const r = await updateBanner(site, BANNER_ID, bannerPutBody);
  console.log('\nBanner PUT result:', JSON.stringify(r?.message || r?.success || r).slice(0, 300));
} else {
  console.log('\n[DRY-RUN] would PUT banner now — no write performed.');
}

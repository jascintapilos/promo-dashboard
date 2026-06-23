#!/usr/bin/env node
// One-shot: create EVEMGRTGA 3.3 Promotion Content + 14.2 Banner on QP2A (IBC22)
// for the Microgaming Road to Glory campaign.
//
// Context:
//   EVEMGRTGB/C/D already exist for KING333/ACE66/SPADE66 (ids 206/207/208).
//   EVEMGRTGA for IBC22 (site_id=1) was never created — this script fills the gap.
//
// /api/bo/promotioncontent GET/list returns 500 on QP2 (server bug) but POST works.
// /api/bo/banner works normally.
//
// Run: node bin/create-qp2a-rtg.mjs
// Dry-run: node bin/create-qp2a-rtg.mjs --dry-run

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { authedFetch, uploadFile, createBanner } from '../src/api-client.js';
import { getSite } from '../src/sites.js';
import { getSheetsClient } from '../src/sheets-client.js';
import { loadGoogleapis } from '../src/google-auth.js';

const DRY_RUN = process.argv.includes('--dry-run');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const SITE_ID       = 'ibc22';
const QP2_SITE_ID   = 1;          // IBC22 merchant id in QP2 BO
const PROMO_CODE    = 'EVEMGRTGA';
const PROMO_FOLDER  = '1SFsw9pH0vxOgIrh0dbRnIOExqxTYnsk5';  // Microgaming Road to Glory Drive folder

// Dates — same as EVEMGRTGB/C/D (stored UTC in BO)
// 07 Jun 2026 00:00 MYT = 06 Jun 2026 16:00:00 UTC
// 12 Jul 2026 23:59:59 MYT = 12 Jul 2026 15:59:59 UTC
const START_UTC = '2026-06-06 16:00:00';
const END_UTC   = '2026-07-12 15:59:59';

// Banner label + link
const BANNER_LABEL = 'MICROGAMING Road to Glory';
const BANNER_LINK  = `/promotion?code=${PROMO_CODE}`;
const BANNER_POS   = 7;

// category_id: same as EVEMGRTGB/C/D = [1=Show All, 10=Slots]
const CATEGORY_ID = { '0': 1, '1': 10 };

// Images — ibc22-min compressed folder
// mup (790×400) = 3.3 promo content image
// up  (1920×400) = 14.2 banner desktop
const IMG_BASE = 'C:\\Users\\vdiuser\\Downloads\\promo-automation\\Banner\\Microgaming Road to Glory\\ibc22-min';
const LOCALE_IMAGE_MAP = {
  MY_EN: {
    mup: 'qp2a-ibc22-mup-road-to-glory-790x400-my-en.jpg',
    up:  'qp2a-ibc22-up-road-to-glory-1920x400-my-en.jpg',
  },
  MY_ZH: {
    mup: 'qp2a-ibc22-mup-road-to-glory-790x400-my-zh.jpg',
    up:  'qp2a-ibc22-up-road-to-glory-1920x400-my-zh.jpg',
  },
};

// ── fetchDocHtml — same pipeline as upload-promo.js (keep in sync) ────────────
async function fetchDocHtml(drive, docId) {
  const res = await drive.files.export({ fileId: docId, mimeType: 'text/html' });
  let html = typeof res.data === 'string' ? res.data : String(res.data);

  html = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  html = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  html = bodyMatch ? bodyMatch[1] : html;

  html = html.replace(/<span[^>]*font-weight\s*:\s*(?:700|bold)[^>]*>([\s\S]*?)<\/span>/gi,
    (_m, inner) => `<strong>${inner}</strong>`);
  html = html.replace(/<span[^>]*font-style\s*:\s*italic[^>]*>([\s\S]*?)<\/span>/gi,
    (_m, inner) => `<em>${inner}</em>`);
  html = html.replace(/https:\/\/www\.google\.com\/url\?q=([^&"]+)[^"]*/g,
    (_m, enc) => { try { return decodeURIComponent(enc); } catch { return enc; } });

  html = html.replace(/<(\w+)([^>]*)>/g, (_m, tag, attrs) => {
    const t = tag.toLowerCase();
    const out = [];
    if (t === 'a') {
      const m = attrs.match(/\bhref="([^"]*)"/i);
      if (m) out.push(`href="${m[1]}"`);
    }
    if (t === 'p') {
      const sm = attrs.match(/\bstyle="([^"]*)"/i);
      if (sm) {
        const ta = sm[1].match(/text-align\s*:\s*[^;"]*/i);
        if (ta && !/text-align\s*:\s*left/i.test(ta[0])) {
          out.push(`style="${ta[0].trim()}"`);
        }
      }
    }
    return out.length ? `<${tag} ${out.join(' ')}>` : `<${tag}>`;
  });

  html = html.replace(/<colgroup>[\s\S]*?<\/colgroup>/gi, '');
  html = html.replace(/<\/?span>/gi, '');

  let description = '';
  const headerSection = html.match(/^([\s\S]*?)<hr/i);
  if (headerSection) {
    const nonEmptyTexts = [];
    for (const m of headerSection[1].matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) {
      const text = m[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
      if (text) nonEmptyTexts.push(text);
    }
    description = nonEmptyTexts[1] || nonEmptyTexts[0] || '';
  }

  html = html.replace(/^[\s\S]*?<hr[^>]*>/i, '');
  html = html.replace(/<\/p>\s*<hr[^>]*>\s*<p[^>]*>/gi, '<hr>');
  html = html.replace(/<\/p>\s*<hr[^>]*>/gi,             '<hr>');
  html = html.replace(/<hr[^>]*>\s*<p[^>]*>/gi,          '<hr>');
  html = html.replace(/<\/?span>/gi, '');
  html = html.replace(/<td>\s*<p style="text-align:center">/gi, '<td style="text-align:center">');

  for (let pass = 0; pass < 3; pass++) {
    html = html.replace(/<(strong|em)>\s*(?:<br>)?\s*<\/\1>/gi, '');
    html = html.replace(/<p[^>]*>\s*(?:<br>)?\s*<\/p>/gi, '');
  }

  html = html.replace(/^(\s*<p[^>]*>&nbsp;<\/p>\s*)+/, '');
  html = html.replace(/(<p[^>]*>)\s*<br>\s*/i, '$1');
  html = html.replace(/<\/p>\s*<p[^>]*>&nbsp;<\/p>\s*<p[^>]*>/gi, '<br><br>');
  html = html.replace(/<p[^>]*>&nbsp;<\/p>/gi, '<br><br>');
  html = html.replace(/<\/p>\s*<p[^>]*>/gi,    '<br><br>');
  html = html.replace(/<\/p>\s*(<table[^>]*>)/gi,            '<br><br>$1');
  html = html.replace(/<\/p>\s*(<(?:ol|ul)[^>]*>)/gi,        '<br><br>$1');
  html = html.replace(/(<\/table>)\s*<p[^>]*>/gi,             '$1<br><br>');
  html = html.replace(/(<\/(?:ol|ul)>)\s*<p[^>]*>/gi,         '$1<br><br>');
  html = html.replace(/(<\/(?:ol|ul)>)\s*(<table[^>]*>)/gi,   '$1<br><br>$2');
  html = html.replace(/(<\/table>)\s*(<(?:ol|ul)[^>]*>)/gi,   '$1<br><br>$2');
  html = html.replace(/<p[^>]*>|<\/p>/gi, '');

  html = html.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, inner) => {
    const items = [...inner.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => m[1].trim());
    return items.map((t, i) => `${i + 1}. ${t}`).join('<br><br>');
  });
  html = html.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, inner) => {
    const items = [...inner.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => m[1].trim());
    return items.map((t) => `• ${t}`).join('<br><br>');
  });

  html = html.replace(/(?:<br>)*(<hr>)/gi, '<br><br>$1');
  html = html.replace(/(<hr>)(?:<br>)*/gi, '$1<br><br>');
  html = html.replace(/<br><br>(?:\s*&nbsp;\s*)+<br><br>/gi, '<br><br>');
  html = html.replace(/(<br>){3,}/gi, '<br><br>');
  html = html.replace(/^(\s*<br>)+/i, '');

  return { content: html.trim(), description };
}

function docNameToLocaleKey(name) {
  const slash = name.match(/\b([A-Z]{2})\/([A-Z]{2,3})\s*$/i);
  if (slash) return `${slash[1].toUpperCase()}_${slash[2].toUpperCase()}`;
  const low = (name || '').toLowerCase();
  if (/[一-鿿]/.test(name)) return 'MY_ZH';
  if (/\b(zh|chi(nese)?)\b/.test(low)) return 'MY_ZH';
  if (/\b(id|ind(onesia(n)?)?)\b/.test(low)) return 'ID_EN';
  return 'MY_EN';
}

// ── T&C hyperlink injector ────────────────────────────────────────────────────
// QP2 T&C format (confirmed from EVEMGRTGB):
//   General :merchantname <a target="_blank" href="{domain}/terms-conditions?lang={LOCALE}">terms and conditions</a> apply.
// The Drive doc may have plain text OR a link with a different merchant's domain.
// This function normalises it to the IBC22-specific URL for each locale.
const TC_DOMAIN = 'https://ibc22myr.com';

function fixTnC(content, locCode) {
  const link = `<a target="_blank" href="${TC_DOMAIN}/terms-conditions?lang=${locCode}">terms and conditions</a>`;
  // Handle all variants found in Drive docs:
  //   - plain text with :merchantname (QP2 doc)
  //   - plain text with :brandname (QPRO doc re-used for QP2 — same Drive folder)
  //   - hyperlinked with any domain (existing BO content re-used)
  return content.replace(
    /General\s+:(?:merchantname|brandname)\s+(?:<a[^>]*>terms and conditions<\/a>|terms and conditions)\s+apply\./gi,
    `General :merchantname ${link} apply.`,
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

const site = getSite(SITE_ID);
console.log(`[create-qp2a-rtg] site=${SITE_ID}  code=${PROMO_CODE}  dry-run=${DRY_RUN}`);

// ── 1. Fetch Drive docs ───────────────────────────────────────────────────────
console.log('\n── Fetching promo docs from Drive ──');
const sheetsClient = await getSheetsClient();
const { google } = await loadGoogleapis();
const drive = google.drive({ version: 'v3', auth: sheetsClient.auth });

const fileList = await drive.files.list({
  q: `'${PROMO_FOLDER}' in parents and mimeType = 'application/vnd.google-apps.document' and trashed = false`,
  fields: 'files(id,name)',
  pageSize: 20,
  includeItemsFromAllDrives: true,
  supportsAllDrives: true,
});
const docs = fileList.data.files || [];
console.log(`  found ${docs.length} doc(s): ${docs.map((d) => d.name).join(', ')}`);

const docContentMap = {};
for (const doc of docs) {
  const locKey = docNameToLocaleKey(doc.name);
  console.log(`  exporting "${doc.name}" → ${locKey}…`);
  try {
    docContentMap[locKey] = await fetchDocHtml(drive, doc.id);
    await delay(800);
  } catch (e) {
    console.warn(`  export failed: ${e.message}`);
  }
}
console.log(`  available: ${Object.keys(docContentMap).join(', ')}`);

// ── 2. Upload images ──────────────────────────────────────────────────────────
console.log('\n── Uploading images ──');

// localeId map
const locRes = await authedFetch(site, '/api/bo/locale?perPage=100');
const localeMap = Object.fromEntries((locRes?.data?.rows || []).map((r) => [r.code, r.id]));

const contentImages  = {};  // localeId → CDN url (mup, for 3.3)
const bannerDesktop  = {};  // localeId → CDN url (up, for 14.2)
const bannerMobile   = {};  // localeId → CDN url (mup, for 14.2)

for (const [locCode, files] of Object.entries(LOCALE_IMAGE_MAP)) {
  const locId = localeMap[locCode];
  if (!locId) { console.warn(`  ${locCode}: not in locale map — skip`); continue; }

  if (DRY_RUN) {
    console.log(`  [DRY-RUN] would upload ${locCode}: ${files.mup} + ${files.up}`);
    contentImages[locId] = `DRY_RUN_CONTENT_${locCode}`;
    bannerDesktop[locId] = `DRY_RUN_DESKTOP_${locCode}`;
    bannerMobile[locId]  = `DRY_RUN_MOBILE_${locCode}`;
    continue;
  }

  // mup → promotions (3.3 image + banner mobile)
  await delay(3000);
  const mupBuf = readFileSync(path.join(IMG_BASE, files.mup));
  const mupUp = await uploadFile(site, mupBuf, files.mup, { type: 'promotions' });
  const mupUrl = mupUp?.data?.files?.[0];
  if (!mupUrl) { console.error(`  ${locCode}: mup upload failed`); continue; }
  contentImages[locId] = mupUrl;
  bannerMobile[locId]  = mupUrl;
  console.log(`  ${locCode} mup → ${mupUrl}`);

  // up → banners (14.2 desktop)
  await delay(3000);
  const upBuf = readFileSync(path.join(IMG_BASE, files.up));
  const upUp = await uploadFile(site, upBuf, files.up, { type: 'banners' });
  const upUrl = upUp?.data?.files?.[0];
  if (!upUrl) { console.error(`  ${locCode}: up upload failed`); continue; }
  bannerDesktop[locId] = upUrl;
  console.log(`  ${locCode} up  → ${upUrl}`);
}

// ── 3. Create 3.3 Promotion Content ──────────────────────────────────────────
console.log('\n── Creating 3.3 Promotion Content ──');

const details = {};
for (const [locCode, locId] of Object.entries(localeMap)) {
  if (!contentImages[locId]) continue;   // no image = locale not in scope

  const countryEn = locCode.replace(/_[^_]+$/, '_EN');
  const docEntry = docContentMap[locCode] || docContentMap[countryEn] || docContentMap['MY_EN']
                || Object.values(docContentMap)[0] || null;
  if (!docEntry) { console.warn(`  ${locCode}: no doc content — skip`); continue; }

  const locContent = fixTnC(docEntry.content, locCode);

  details[String(locId)] = {
    settings_locale_id: locId,
    title:       BANNER_LABEL,
    description: docEntry.description || BANNER_LABEL,
    start:       START_UTC,
    end:         END_UTC,
    publish_at:  START_UTC,
    expire_at:   END_UTC,
    image:       contentImages[locId],
    content:     locContent,
    promotion_type:   0,
    promotion_amount: 0,
    form_title:             null,
    form_content:           null,
    form_button_text:       null,
    main_button_text_before: null,
    main_button_text_after:  null,
  };
  console.log(`  ${locCode} (id=${locId}): content=${locContent.length}chars  desc="${docEntry.description}"`);
}

if (!Object.keys(details).length) {
  console.error('No locale details built — aborting.');
  process.exit(1);
}

const contentBody = {
  site_id:          QP2_SITE_ID,
  code:             PROMO_CODE,
  category_id:      CATEGORY_ID,
  content_type:     { '1': true, '2': true },
  member_visibility: 0,
  position:         BANNER_POS,
  apply_action:     0,
  allow_apply:      0,
  status:           1,
  max_application:  0,
  details,
};

let promoContentId;
if (DRY_RUN) {
  console.log(`  [DRY-RUN] would POST /api/bo/promotioncontent with ${Object.keys(details).length} locale(s)`);
  promoContentId = 'DRY_RUN_ID';
} else {
  await delay(1500);
  const pcRes = await authedFetch(site, '/api/bo/promotioncontent', { method: 'POST', body: contentBody });
  promoContentId = pcRes?.data?.content?.id ?? pcRes?.data?.id;
  const ok = pcRes?.success !== false;
  console.log(`  POST ${ok ? '✅ OK' : '❌ FAILED'} — id=${promoContentId}  msg=${JSON.stringify(pcRes?.message || '')}`);
  if (!ok) { console.error('Aborting — content creation failed.'); process.exit(1); }
}

// ── 4. Create 14.2 Banner ─────────────────────────────────────────────────────
console.log('\n── Creating 14.2 Banner ──');

const bannerImages = Object.entries(bannerDesktop).map(([locId, desktop]) => ({
  settings_locale_id: Number(locId),
  image_desktop: desktop,
  image_mobile:  bannerMobile[locId] || desktop,
}));

const bannerBody = {
  site_id:        QP2_SITE_ID,
  label:          BANNER_LABEL,
  link:           BANNER_LINK,
  start_datetime: START_UTC,
  end_datetime:   END_UTC,
  position:       BANNER_POS,
  status:         1,
  session:        1,
  platform_type_id: 1,
  images:         bannerImages,
};

if (DRY_RUN) {
  console.log(`  [DRY-RUN] would POST /api/bo/banner with ${bannerImages.length} image(s)`);
  console.log(`  link=${BANNER_LINK}`);
} else {
  await delay(1500);
  const bnRes = await authedFetch(site, '/api/bo/banner', { method: 'POST', body: bannerBody });
  const bannerId = bnRes?.data?.id ?? bnRes?.data?.rows?.id;
  const ok = bnRes?.success !== false;
  console.log(`  POST ${ok ? '✅ OK' : '❌ FAILED'} — banner id=${bannerId}  msg=${JSON.stringify(bnRes?.message || '')}`);
}

console.log(`\n═══════════════════ DONE ═══════════════════`);
console.log(`  code=${PROMO_CODE}  promotioncontent_id=${promoContentId}`);
if (DRY_RUN) console.log('  (dry-run — no changes made)');

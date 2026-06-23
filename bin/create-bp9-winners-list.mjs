// One-off: create a 3.3 Promotion Content entry on QPRO1 (BP9) for the
// B46 Mid-Year Spend & Win winners-list page (future-dated 2026-07-15 to 2026-10-15).
//
// Source: Banner/BP9 Mid-Year Spend & Win/bp9-up-mup-mid-year-spend-and-win-winner-list/
// Per-lang 1920x3800 jpgs (en, zh, id). Fanned out to 6 BO locales:
//   MY_EN/SG_EN/ID_EN ← en   MY_ZH/SG_ZH ← zh   ID_ID ← id
//
// For each locale:
//   - upload full tall image as type='promotions' → use as content body inline
//   - upload top-cropped thumbnail (790x400 from top) as type='promotions' → image field
//
// No 14.2 banner, no doc fetch. Title/description = "Mid-Year Spend & Win" (matches B46 main).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { authedFetch, createPromotionContent, uploadFile, getAllCategories, emptyPromoContentDetail } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const SITE_ID = 'qpro1';
const PROMO_CODE = 'EVEJ2PWLBMMDWL';
const LABEL = 'Mid-Year Spend & Win';
const START_UTC = '2026-07-14 16:00:00';  // 2026-07-15 00:00 SGT == 2026-07-14 16:00 UTC
const END_UTC   = '2026-10-15 15:59:59';  // 2026-10-15 23:59 SGT == 2026-10-15 15:59 UTC

const TALL_DIR = 'C:\\Users\\vdiuser\\Downloads\\promo-automation\\Banner\\BP9 Mid-Year Spend & Win\\bp9-up-mup-mid-year-spend-and-win-winner-list';

const LANG_FILES = {
  en: 'bp9-up-mup-mid-year-spend-and-win-winner-list-1920x3800px-en.jpg',
  zh: 'bp9-up-mup-mid-year-spend-and-win-winner-list-1920x3800px-zh.jpg',
  id: 'bp9-up-mup-mid-year-spend-and-win-winner-list-1920x3800px-id.jpg',
};

// BO locale code → source language
const LOCALE_TO_LANG = {
  MY_EN: 'en', SG_EN: 'en', ID_EN: 'en',
  MY_ZH: 'zh', SG_ZH: 'zh',
  ID_ID: 'id',
};

const DRY_RUN = process.argv.includes('--dry-run');

async function getLocaleMap(site) {
  const res = await authedFetch(site, '/api/bo/locale?perPage=100');
  return Object.fromEntries((res?.data?.rows || []).map((r) => [r.code, r.id]));
}

// Use emptyPromoContentDetail() from api-client for full 14-field shape.

async function main() {
  const site = getSite(SITE_ID);
  console.log(`[winners-list] site=${SITE_ID} (${site.loginMerchantCode}) code=${PROMO_CODE} dates=${START_UTC} → ${END_UTC} dry=${DRY_RUN}`);

  const localeMap = await getLocaleMap(site);
  console.log(`[winners-list] BO locales: ${Object.entries(localeMap).map(([c, i]) => `${c}=${i}`).join(', ')}`);

  // Pick category WIN
  const allCats = await getAllCategories(site);
  const winCat = allCats.find((c) => c.code === 'WIN');
  if (!winCat) throw new Error('WIN category not found on QPRO1');
  const catObj = { '0': winCat.id };
  console.log(`[winners-list] category: WIN=${winCat.name} (id=${winCat.id})`);

  // Per-language upload: full image + top-crop thumb. Cache by lang so we don't
  // re-upload the same file for each locale that shares the lang.
  const langAssets = {};

  for (const [lang, filename] of Object.entries(LANG_FILES)) {
    const fullPath = path.join(TALL_DIR, filename);
    const fullBuf = readFileSync(fullPath);
    console.log(`[winners-list] [${lang}] crop top 790x400 from 1920x3800…`);
    // Sharp top-crop: extract top 1920×632 then resize to 790×260 (proportional),
    // or directly fit:'cover' position:'top' to 790×400 (forced aspect).
    // Use cover+top: scales horizontally to width=790, then crops top of resized image to height=400.
    // BP9 winners-list-top region is the visual header so top crop preserves the lockup.
    const thumbBuf = await sharp(fullBuf)
      .resize({ width: 790, height: 400, fit: 'cover', position: 'top' })
      .jpeg({ quality: 88 })
      .toBuffer();

    if (DRY_RUN) {
      console.log(`  [${lang}] full: ${filename} (${(fullBuf.length / 1024).toFixed(0)} KB)`);
      console.log(`  [${lang}] thumb: ${(thumbBuf.length / 1024).toFixed(0)} KB (top crop 790x400)`);
      langAssets[lang] = { contentUrl: '<dry-content>', thumbUrl: '<dry-thumb>' };
      continue;
    }

    await new Promise((r) => setTimeout(r, 5000));
    console.log(`  [${lang}] upload full → promotions…`);
    const fRes = await uploadFile(site, fullBuf, filename, { type: 'promotions' });
    const contentUrl = fRes?.data?.files?.[0];
    if (!contentUrl) throw new Error(`upload full failed for ${lang}`);

    await new Promise((r) => setTimeout(r, 5000));
    console.log(`  [${lang}] upload thumb → promotions…`);
    const thumbName = filename.replace(/(\.[a-z]+)$/i, '-thumb-790x400$1');
    const tRes = await uploadFile(site, thumbBuf, thumbName, { type: 'promotions' });
    const thumbUrl = tRes?.data?.files?.[0];
    if (!thumbUrl) throw new Error(`upload thumb failed for ${lang}`);

    langAssets[lang] = { contentUrl, thumbUrl };
    console.log(`  [${lang}] content=${contentUrl}  thumb=${thumbUrl}`);
  }

  // Build details for all BO locales (fill the 6 we care about, leave others empty)
  const detailsObj = {};
  for (const [locCode, locId] of Object.entries(localeMap)) {
    const lang = LOCALE_TO_LANG[locCode];
    if (!lang) {
      detailsObj[String(locId)] = emptyPromoContentDetail();
      continue;
    }
    const { contentUrl, thumbUrl } = langAssets[lang];
    detailsObj[String(locId)] = {
      ...emptyPromoContentDetail(),
      settings_locale_id: locId,
      title: LABEL,
      description: LABEL,
      start: START_UTC,
      end: END_UTC,
      publish_at: START_UTC,
      expire_at: END_UTC,
      image: thumbUrl,
      content: `<p><img src="${contentUrl}" style="max-width:100%;height:auto;"></p>`,
    };
  }

  console.log(`[winners-list] details prepared for: ${Object.keys(LOCALE_TO_LANG).join(', ')}`);

  if (DRY_RUN) {
    console.log(`[winners-list] DRY-RUN — would POST with code=${PROMO_CODE}`);
    console.log(JSON.stringify({
      code: PROMO_CODE,
      category_id: catObj,
      content_type: { '1': true, '2': true },
      member_visibility: 0,
      position: 99,
      apply_action: 0,
      max_application: 0,
      details: Object.fromEntries(
        Object.entries(detailsObj).filter(([_, d]) => d.title)
          .map(([k, d]) => [k, { ...d, content: d.content.slice(0, 80) + '…' }])
      ),
    }, null, 2));
    return;
  }

  // POST with auto-suffix on conflict
  let pcRes;
  let finalCode = PROMO_CODE;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const codeAttempt = attempt === 1 ? PROMO_CODE : `${PROMO_CODE.slice(0, 13)}${attempt}`;
    console.log(`[winners-list] POST 3.3 (code=${codeAttempt}) attempt ${attempt}…`);
    try {
      pcRes = await createPromotionContent(site, {
        code: codeAttempt,
        category_id: catObj,
        content_type: { '1': true, '2': true },
        member_visibility: 0,
        position: 99,
        apply_action: 0,
        max_application: 0,
        details: detailsObj,
      });
      finalCode = codeAttempt;
      break;
    } catch (e) {
      if (e.message && /code.*taken|already.*taken/i.test(e.message) && attempt < 5) {
        console.warn(`  code "${codeAttempt}" taken — trying suffix ${attempt + 1}`);
      } else {
        throw e;
      }
    }
  }
  const pcId = pcRes?.data?.rows?.id ?? pcRes?.data?.id ?? pcRes?.data?.rows?.[0]?.id;
  console.log(`[winners-list] ✅ 3.3 created id=${pcId} code=${finalCode}`);
}

main().catch((e) => { console.error(e); process.exit(1); });

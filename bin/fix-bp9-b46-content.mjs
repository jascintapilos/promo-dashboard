// Fix QPRO1 (BP9) B46 "Mid-Year Spend & Win" — three issues:
//
//  1. pc_id=181 (EVEJ2PWLBMMD, main promo): T&C text not hyperlinked in any locale.
//     Pattern: skip <strong>heading</strong>, link all other "terms and conditions" (EN)
//     and "条款与条件" entity pattern (ZH) to per-locale bp9mys.com T&C URLs.
//
//  2. pc_id=181: MY_ZH + SG_ZH descriptions saved as "Mid-Year Spend & Win" (English).
//     Extract real Chinese tagline from ZH content body and use as description.
//
//  3. pc_id=183 (EVEJ2PWLBMMDW2, winners list): thumbnails are top-crops of the
//     tall 1920x3800 image. Replace with the main banner's per-locale thumbnails
//     (the 790x400 images already on pc_id=181).
//
// Run:     node bin/fix-bp9-b46-content.mjs
// Dry-run: node bin/fix-bp9-b46-content.mjs --dry-run

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const SITE_ID = 'qpro1';
const MAIN_ID = 181;
const WL_ID   = 183;
const DRY_RUN = process.argv.includes('--dry-run');
const delay   = (ms) => new Promise((r) => setTimeout(r, ms));

const SERVER_FIELDS = new Set(['id', 'promotion_content_id', 'settings_locale_code', 'created_at', 'updated_at']);

// Per-locale T&C URLs for QPRO1 (from Directory TNC link tab, row 7-8)
const LOCALE_TNC = {
  MY_EN: 'https://bp9mys.com/en-my/info-center/terms-and-conditions',
  MY_ZH: 'https://bp9mys.com/zh-my/info-center/terms-and-conditions',
  SG_EN: 'https://bp9mys.com/en-sg/info-center/terms-and-conditions',
  SG_ZH: 'https://bp9mys.com/zh-sg/info-center/terms-and-conditions',
  ID_EN: 'https://bp9mys.com/en-id/info-center/terms-and-conditions',
  ID_ID: 'https://bp9mys.com/id-id/info-center/terms-and-conditions',
};

// Entity string for 条款与条件
const ZH_TNC_ENTITY = '&#26465;&#27454;&#19982;&#26465;&#20214;';

function decodeEntities(str) {
  return str
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

// Link all T&C text in EN content (skip <strong> section heading)
function fixTnCEn(content, url) {
  const PLACEHOLDER = '\x00TNC_HDR\x00';
  let c = content.replace(/<strong>Terms and Conditions<\/strong>/g, PLACEHOLDER);
  c = c.replace(/<a[^>]*>terms and conditions<\/a>/gi, 'terms and conditions');
  c = c.replace(/terms and conditions/gi, `<a href="${url}">terms and conditions</a>`);
  return c.replace(PLACEHOLDER, '<strong>Terms and Conditions</strong>');
}

// Link all T&C entity text in ZH content (skip <strong> section heading)
function fixTnCZh(content, url) {
  const PLACEHOLDER = '\x00TNC_ZH_HDR\x00';
  let c = content.replace(`<strong>${ZH_TNC_ENTITY}</strong>`, PLACEHOLDER);
  c = c.replace(new RegExp(`<a[^>]*>${ZH_TNC_ENTITY}</a>`, 'g'), ZH_TNC_ENTITY);
  c = c.replace(new RegExp(ZH_TNC_ENTITY, 'g'), `<a href="${url}">${ZH_TNC_ENTITY}</a>`);
  return c.replace(PLACEHOLDER, `<strong>${ZH_TNC_ENTITY}</strong>`);
}

// Extract ZH tagline: first text block after the <strong>title</strong> line
function extractZhTagline(content) {
  const start = content.indexOf('<br><br>');
  if (start === -1) return null;
  const rest = content.slice(start + 8);
  const end  = rest.indexOf('<br><br>');
  const raw  = (end === -1 ? rest : rest.slice(0, end))
    .replace(/<[^>]+>/g, '').trim();
  return decodeEntities(raw) || null;
}

function buildPutBody(content, cleanDetails) {
  const categoryObj    = Object.fromEntries((content.category_id  || []).map((id, i) => [String(i), id]));
  const contentTypeObj = Object.fromEntries((content.content_type || []).map((t)      => [String(t), true]));
  return {
    code:              content.code,
    category_id:       categoryObj,
    content_type:      contentTypeObj,
    member_visibility: content.member_visibility,
    position:          content.position,
    apply_action:      content.apply_action,
    allow_apply:       content.allow_apply,
    status:            content.status,
    max_application:   content.max_application,
    details:           cleanDetails,
  };
}

function cleanDetailsCopy(details) {
  const out = {};
  for (const [k, d] of Object.entries(details)) {
    if (!d) { out[k] = d; continue; }
    out[k] = Object.fromEntries(Object.entries(d).filter(([f]) => !SERVER_FIELDS.has(f)));
  }
  return out;
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log(`[fix-bp9-b46] site=${SITE_ID}  dry=${DRY_RUN}\n`);
const site = getSite(SITE_ID);

// ── 1. Fix pc_id=181: T&C hyperlinks + ZH descriptions ───────────────────────
console.log(`── pc_id=${MAIN_ID} (EVEJ2PWLBMMD) ──`);
{
  const res     = await authedFetch(site, `/api/bo/promotioncontent/${MAIN_ID}`);
  const content = res?.data?.content;
  const details = JSON.parse(JSON.stringify(res?.data?.details || {}));

  let changed = 0;
  for (const [locId, d] of Object.entries(details)) {
    if (!d?.content && !d?.settings_locale_code) continue;
    const code = d.settings_locale_code;
    const url  = LOCALE_TNC[code];
    if (!url) { console.log(`  [${code}] no T&C URL configured — skip`); continue; }

    const isZh = code.endsWith('_ZH');
    const isId = code === 'ID_ID';

    let newContent = d.content || '';
    let newDesc    = d.description || '';
    let contentChanged = false;
    let descChanged    = false;

    // T&C hyperlinks
    if (d.content) {
      const fixed = isZh ? fixTnCZh(d.content, url) : fixTnCEn(d.content, url);
      if (fixed !== d.content) {
        newContent = fixed;
        contentChanged = true;
      }
    }

    // ZH descriptions: MY_ZH and SG_ZH saved as English title — fix
    if (isZh && d.description === 'Mid-Year Spend & Win') {
      const tagline = extractZhTagline(d.content || '');
      if (tagline) {
        newDesc = tagline;
        descChanged = true;
        console.log(`  [${code}] description: "${d.description}" → "${tagline}"`);
      } else {
        console.log(`  [${code}] could not extract ZH tagline — description unchanged`);
      }
    }

    if (contentChanged || descChanged) {
      const tncCount = isZh
        ? (newContent.split(`<a href="${url}">${ZH_TNC_ENTITY}</a>`).length - 1)
        : (newContent.toLowerCase().split(`<a href="${url}">terms and conditions</a>`).length - 1);
      console.log(`  [${code}] T&C links added: ${tncCount}  desc changed: ${descChanged}`);
      details[locId].content     = newContent;
      details[locId].description = newDesc;
      changed++;
    } else {
      console.log(`  [${code}] no changes needed`);
    }
  }

  if (!changed) {
    console.log('  nothing to update\n');
  } else if (DRY_RUN) {
    console.log(`  [DRY-RUN] would PUT (${changed} locale(s) patched)\n`);
  } else {
    await delay(1500);
    const putRes = await authedFetch(site, `/api/bo/promotioncontent/${MAIN_ID}`, {
      method: 'PUT',
      body: buildPutBody(content, cleanDetailsCopy(details)),
    });
    const ok = putRes?.success !== false;
    console.log(`  PUT ${ok ? '✅ OK' : '❌ FAILED'} — ${JSON.stringify(putRes?.message || putRes?.errors || '')}\n`);
  }
}

// ── 2. Fix pc_id=183: replace thumbnails with main banner's per-locale images ─
console.log(`── pc_id=${WL_ID} (EVEJ2PWLBMMDW2) ──`);
{
  const mainRes  = await authedFetch(site, `/api/bo/promotioncontent/${MAIN_ID}`);
  const mainDetails = mainRes?.data?.details || {};

  // Build localeId → thumbnail URL map from pc_id=181
  const mainThumb = {};
  for (const [locId, d] of Object.entries(mainDetails)) {
    if (d?.image) mainThumb[locId] = d.image;
  }
  console.log('  Main banner thumbs:', JSON.stringify(mainThumb));

  const wlRes    = await authedFetch(site, `/api/bo/promotioncontent/${WL_ID}`);
  const wlContent = wlRes?.data?.content;
  const wlDetails = JSON.parse(JSON.stringify(wlRes?.data?.details || {}));

  let changed = 0;
  for (const [locId, d] of Object.entries(wlDetails)) {
    if (!d?.settings_locale_id) continue;
    const newThumb = mainThumb[locId];
    if (!newThumb) { console.log(`  [locale ${locId}] no main thumb found — skip`); continue; }
    if (d.image === newThumb) { console.log(`  [locale ${locId}] thumb already matches — skip`); continue; }
    console.log(`  [locale ${locId} ${d.settings_locale_code}] thumb: ${d.image?.slice(-40)} → ${newThumb.slice(-40)}`);
    wlDetails[locId].image = newThumb;
    changed++;
  }

  if (!changed) {
    console.log('  nothing to update\n');
  } else if (DRY_RUN) {
    console.log(`  [DRY-RUN] would PUT (${changed} locale(s) patched)\n`);
  } else {
    await delay(1500);
    const putRes = await authedFetch(site, `/api/bo/promotioncontent/${WL_ID}`, {
      method: 'PUT',
      body: buildPutBody(wlContent, cleanDetailsCopy(wlDetails)),
    });
    const ok = putRes?.success !== false;
    console.log(`  PUT ${ok ? '✅ OK' : '❌ FAILED'} — ${JSON.stringify(putRes?.message || putRes?.errors || '')}\n`);
  }
}

console.log('═══════════════════ DONE ═══════════════════');
if (DRY_RUN) console.log('  (dry-run — no changes made)');

#!/usr/bin/env node
// One-shot: update the 3.3 Promotion Content `content` (HTML body) on QPRO16 + QPRO17
// to use the correctly-formatted HTML (with <hr> dividers, text-align:center, and
// <figure class="table"> format) re-exported from the Drive promo-draft docs.
//
// Uses the corrected fetchDocHtml logic (same as the current upload-promo.js).
// Run AFTER fix-b16-b17-image.mjs (which fixes the `image` field).

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';
import { getSheetsClient } from '../src/sheets-client.js';
import { loadGoogleapis } from '../src/google-auth.js';

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const PROMO_FOLDER_ID = '1SFsw9pH0vxOgIrh0dbRnIOExqxTYnsk5';  // "Microgaming Road to Glory" drafts

const JOBS = [
  { siteId: 'qpro16' },
  { siteId: 'qpro17' },
];

// ── Locale key from doc name ─────────────────────────────────────────────────
function docNameToLocaleKey(name) {
  const slash = name.match(/\b([A-Z]{2})\/([A-Z]{2,3})\s*$/i);
  if (slash) return `${slash[1].toUpperCase()}_${slash[2].toUpperCase()}`;
  const low = (name || '').toLowerCase();
  if (/[一-鿿]/.test(name)) return 'MY_ZH';
  if (/\b(zh|chi(nese)?)\b/.test(low)) return 'MY_ZH';
  if (/\b(id|ind(onesia(n)?)?)\b/.test(low)) return 'ID_EN';
  return 'MY_EN';
}

// ── fetchDocHtml — export Google Doc → clean BO-format HTML ─────────────────
// Must stay in sync with the copy in bin/upload-promo.js.
// Returns { content, description }.
async function fetchDocHtml(drive, docId) {
  const res = await drive.files.export({ fileId: docId, mimeType: 'text/html' });
  let html = typeof res.data === 'string' ? res.data : String(res.data);

  html = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  html = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');

  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  html = bodyMatch ? bodyMatch[1] : html;

  // Promote bold/italic spans → semantic tags (before attrs stripped)
  html = html.replace(/<span[^>]*font-weight\s*:\s*(?:700|bold)[^>]*>([\s\S]*?)<\/span>/gi,
    (_m, inner) => `<strong>${inner}</strong>`);
  html = html.replace(/<span[^>]*font-style\s*:\s*italic[^>]*>([\s\S]*?)<\/span>/gi,
    (_m, inner) => `<em>${inner}</em>`);

  // Unwrap Google redirect URLs
  html = html.replace(/https:\/\/www\.google\.com\/url\?q=([^&"]+)[^"]*/g,
    (_m, enc) => { try { return decodeURIComponent(enc); } catch { return enc; } });

  // Strip ALL element attributes; keep only semantic ones
  html = html.replace(/<(\w+)([^>]*)>/g, (_m, tag, attrs) => {
    const t = tag.toLowerCase();
    const out = [];
    if (t === 'a') {
      const m = attrs.match(/\bhref="([^"]*)"/i);
      if (m) out.push(`href="${m[1]}"`);
    }
    // <p>: preserve text-align only when non-default (center/right/justify).
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

  // Remove colgroup / col (column-width artefacts)
  html = html.replace(/<colgroup>[\s\S]*?<\/colgroup>/gi, '');

  // Strip span wrappers
  html = html.replace(/<\/?span>/gi, '');

  // Extract description from header (second non-empty <p> before first <hr>)
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

  // Strip header block (doc title + tagline before first <hr>)
  html = html.replace(/^[\s\S]*?<hr[^>]*>/i, '');

  // Preserve <hr> section dividers — strip surrounding <p> context
  html = html.replace(/<\/p>\s*<hr[^>]*>\s*<p[^>]*>/gi, '<hr>');
  html = html.replace(/<\/p>\s*<hr[^>]*>/gi,             '<hr>');
  html = html.replace(/<hr[^>]*>\s*<p[^>]*>/gi,          '<hr>');

  // Strip span wrappers (second pass — any remaining after tag-stripping)
  html = html.replace(/<\/?span>/gi, '');

  // Promote text-align:center from inner <p> to the <td>
  html = html.replace(/<td>\s*<p style="text-align:center">/gi, '<td style="text-align:center">');

  // Remove near-empty paragraphs
  for (let pass = 0; pass < 3; pass++) {
    html = html.replace(/<(strong|em)>\s*(?:<br>)?\s*<\/\1>/gi, '');
    html = html.replace(/<p[^>]*>\s*(?:<br>)?\s*<\/p>/gi, '');
  }

  // Strip leading spacers
  html = html.replace(/^(\s*<p[^>]*>&nbsp;<\/p>\s*)+/, '');
  html = html.replace(/(<p[^>]*>)\s*<br>\s*/i, '$1');

  // Convert <p> paragraph breaks → <br><br>
  html = html.replace(/<\/p>\s*<p[^>]*>&nbsp;<\/p>\s*<p[^>]*>/gi, '<br><br>');
  html = html.replace(/<p[^>]*>&nbsp;<\/p>/gi, '<br><br>');
  html = html.replace(/<\/p>\s*<p[^>]*>/gi,    '<br><br>');
  // Block transitions
  html = html.replace(/<\/p>\s*(<table[^>]*>)/gi,       '<br><br>$1');
  html = html.replace(/<\/p>\s*(<(?:ol|ul)[^>]*>)/gi,  '<br><br>$1');
  html = html.replace(/(<\/table>)\s*<p[^>]*>/gi,        '$1<br><br>');
  html = html.replace(/(<\/(?:ol|ul)>)\s*<p[^>]*>/gi,   '$1<br><br>');
  html = html.replace(/(<\/(?:ol|ul)>)\s*(<table[^>]*>)/gi, '$1<br><br>$2');
  html = html.replace(/(<\/table>)\s*(<(?:ol|ul)[^>]*>)/gi,  '$1<br><br>$2');
  html = html.replace(/<p[^>]*>|<\/p>/gi, '');

  // Convert lists to manually-numbered / bulleted inline text
  html = html.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, inner) => {
    const items = [...inner.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => m[1].trim());
    return items.map((t, i) => `${i + 1}. ${t}`).join('<br><br>');
  });
  html = html.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, inner) => {
    const items = [...inner.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => m[1].trim());
    return items.map((t) => `• ${t}`).join('<br><br>');
  });

  // Add breathing room around <hr> dividers
  html = html.replace(/(?:<br>)*(<hr>)/gi, '<br><br>$1');
  html = html.replace(/(<hr>)(?:<br>)*/gi, '$1<br><br>');

  // Cleanup
  html = html.replace(/<br><br>(?:\s*&nbsp;\s*)+<br><br>/gi, '<br><br>');
  html = html.replace(/(<br>){3,}/gi, '<br><br>');
  html = html.replace(/^(\s*<br>)+/i, '');

  return { content: html.trim(), description };
}

// ── Build locale→{ content, description } map from Drive folder ──────────────
async function getDocContentMap(drive, folderId) {
  const r = await drive.files.list({
    q: `'${folderId}' in parents and mimeType = 'application/vnd.google-apps.document' and trashed = false`,
    fields: 'files(id,name)',
    pageSize: 20,
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
  });
  const files = r.data.files || [];
  if (!files.length) { console.warn('  [docs] no Google Docs found in folder'); return {}; }
  console.log(`  [docs] found ${files.length} doc(s): ${files.map((f) => f.name).join(', ')}`);

  const contentMap = {};
  for (const doc of files) {
    const localeKey = docNameToLocaleKey(doc.name);
    console.log(`  [docs] exporting "${doc.name}" → ${localeKey}…`);
    try {
      contentMap[localeKey] = await fetchDocHtml(drive, doc.id);
      await delay(800);
    } catch (e) {
      console.warn(`  [docs] export failed for "${doc.name}": ${e.message}`);
    }
  }
  return contentMap;
}

// ── Main ─────────────────────────────────────────────────────────────────────

// Init Drive client via existing OAuth
const sheetsClient = await getSheetsClient();
const { google } = await loadGoogleapis();
const drive = google.drive({ version: 'v3', auth: sheetsClient.auth });

// Export docs once — same content for both brands
console.log(`\nExporting promo draft docs from folder ${PROMO_FOLDER_ID}…`);
const docContentMap = await getDocContentMap(drive, PROMO_FOLDER_ID);
if (!Object.keys(docContentMap).length) {
  console.error('No docs exported — aborting.');
  process.exit(1);
}
console.log(`  locales available: ${Object.keys(docContentMap).join(', ')}`);

for (const job of JOBS) {
  const site = getSite(job.siteId);
  console.log(`\n── ${job.siteId} ────────────────────────────────`);

  // 1. Find EVEMRTG
  const search = await authedFetch(site, '/api/bo/promotioncontent?perPage=50&search=EVEMRTG');
  const found = (search?.data?.rows || []).find((r) => r.code === 'EVEMRTG');
  if (!found) { console.error(`  EVEMRTG not found on ${job.siteId}`); continue; }
  console.log(`  EVEMRTG id=${found.id}`);

  // 2. GET full record
  const detail = await authedFetch(site, `/api/bo/promotioncontent/${found.id}`);
  const content = detail?.data?.content;
  const details = JSON.parse(JSON.stringify(detail?.data?.details || {}));

  // 3. Locale map
  const locRes = await authedFetch(site, '/api/bo/locale?perPage=100');
  const localeMap = Object.fromEntries((locRes?.data?.rows || []).map((r) => [r.code, r.id]));

  // 4. Patch content + description fields for each locale
  for (const [locCode, locId] of Object.entries(localeMap)) {
    const countryEn = locCode.replace(/_[^_]+$/, '_EN');
    const docEntry = docContentMap[locCode]
                  || docContentMap[countryEn]
                  || docContentMap['MY_EN']
                  || Object.values(docContentMap)[0]
                  || null;
    if (!docEntry) { console.log(`  ${locCode}: no doc entry — skip`); continue; }

    const key = String(locId);
    if (details[key]) {
      details[key].content     = docEntry.content;
      details[key].description = docEntry.description || details[key].description;
      console.log(`  ${locCode} (id=${locId}) content=${docEntry.content.length}chars  description="${docEntry.description}"`);
    } else {
      console.warn(`  ${locCode} (id=${locId}) — key not found in details; skipping`);
    }
  }

  // 5. Build PUT body (same shape as fix-b16-b17-image.mjs)
  const categoryObj    = Object.fromEntries((content.category_id || []).map((id, i) => [String(i), id]));
  const contentTypeObj = Object.fromEntries((content.content_type || []).map((t) => [String(t), true]));

  const SERVER_FIELDS = new Set(['id', 'promotion_content_id', 'settings_locale_code', 'created_at', 'updated_at']);
  const cleanDetails = {};
  for (const [k, d] of Object.entries(details)) {
    if (!d) { cleanDetails[k] = d; continue; }
    cleanDetails[k] = Object.fromEntries(Object.entries(d).filter(([f]) => !SERVER_FIELDS.has(f)));
  }

  const putBody = {
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

  await delay(1500);
  console.log(`  PUTting updated details…`);
  const putRes = await authedFetch(site, `/api/bo/promotioncontent/${found.id}`, {
    method: 'PUT',
    body: putBody,
  });
  const ok = putRes?.success !== false;
  console.log(`  ${job.siteId}: PUT ${ok ? '✅ OK' : '❌ FAILED'} — ${JSON.stringify(putRes?.message || '')}`);
}

#!/usr/bin/env node
// Fix EVEMRTG on qpro15/16/17 — two issues:
//
//  1. category_id includes id=2 (LIVE CASINO) → remove; keep SLOTS + SHOW ALL only
//  2. MY_ZH (locale 3): wrong title/description + header not stripped from content
//     (ZH Drive doc has no <hr>, so fetchDocHtml left the title/tagline in the body)
//
// Run:      node bin/fix-qpro-evemrtg.mjs
// Dry-run:  node bin/fix-qpro-evemrtg.mjs --dry-run

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';
import { getSheetsClient } from '../src/sheets-client.js';
import { loadGoogleapis } from '../src/google-auth.js';

const DRY_RUN = process.argv.includes('--dry-run');
const delay   = (ms) => new Promise((r) => setTimeout(r, ms));

const PROMO_FOLDER_ID = '1SFsw9pH0vxOgIrh0dbRnIOExqxTYnsk5';

const JOBS = [
  { siteId: 'qpro15', contentId: 53 },
  { siteId: 'qpro16', contentId: 53 },
  { siteId: 'qpro17', contentId: 52 },
];

// Decode numeric HTML entities (&#NNN;) → actual Unicode
function decodeHtmlEntities(str) {
  return str
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&nbsp;/g, ' ');
}

// ── fetchDocHtml — same pipeline as upload-promo.js ──────────────────────────
// Extended: handles ZH docs with no <hr> via fallback header extraction.
async function fetchDocHtml(drive, docId) {
  const res = await drive.files.export({ fileId: docId, mimeType: 'text/html' });
  let html = typeof res.data === 'string' ? res.data : String(res.data);

  html = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  html = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  html = bodyMatch ? bodyMatch[1] : html;

  // Promote bold/italic spans
  html = html.replace(/<span[^>]*font-weight\s*:\s*(?:700|bold)[^>]*>([\s\S]*?)<\/span>/gi,
    (_m, inner) => `<strong>${inner}</strong>`);
  html = html.replace(/<span[^>]*font-style\s*:\s*italic[^>]*>([\s\S]*?)<\/span>/gi,
    (_m, inner) => `<em>${inner}</em>`);

  // Unwrap Google redirects
  html = html.replace(/https:\/\/www\.google\.com\/url\?q=([^&"]+)[^"]*/g,
    (_m, enc) => { try { return decodeURIComponent(enc); } catch { return enc; } });

  // Strip attributes; keep href on <a>, non-left text-align on <p>
  html = html.replace(/<(\w+)([^>]*)>/g, (_m, tag, attrs) => {
    const t = tag.toLowerCase(); const out = [];
    if (t === 'a') { const m = attrs.match(/\bhref="([^"]*)"/i); if (m) out.push(`href="${m[1]}"`); }
    if (t === 'p') {
      const sm = attrs.match(/\bstyle="([^"]*)"/i);
      if (sm) { const ta = sm[1].match(/text-align\s*:\s*[^;"]*/i); if (ta && !/text-align\s*:\s*left/i.test(ta[0])) out.push(`style="${ta[0].trim()}"`); }
    }
    return out.length ? `<${tag} ${out.join(' ')}>` : `<${tag}>`;
  });

  html = html.replace(/<colgroup>[\s\S]*?<\/colgroup>/gi, '');
  html = html.replace(/<\/?span>/gi, '');

  // ── Header extraction ─────────────────────────────────────────────────────
  let description = '';
  const headerSection = html.match(/^([\s\S]*?)<hr/i);

  if (headerSection) {
    // Standard path: <hr> present
    const nonEmptyTexts = [];
    for (const m of headerSection[1].matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) {
      const text = m[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
      if (text) nonEmptyTexts.push(text);
    }
    description = nonEmptyTexts[1] || nonEmptyTexts[0] || '';
    html = html.replace(/^[\s\S]*?<hr[^>]*>/i, '');
  } else {
    // Fallback: no <hr> (e.g. ZH doc) — extract first 2 non-empty <p> as header,
    // then strip them so the content body starts cleanly.
    const allP = [...html.matchAll(/<p[^>]*>[\s\S]*?<\/p>/gi)];
    const nonEmptyP = allP.filter(m => m[0].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim());
    if (nonEmptyP.length >= 2) {
      description = nonEmptyP[1][0].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
      let stripped = html;
      for (const p of nonEmptyP.slice(0, 2)) {
        stripped = stripped.replace(p[0], '');
      }
      html = stripped;
    } else if (nonEmptyP.length === 1) {
      description = nonEmptyP[0][0].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
      html = html.replace(nonEmptyP[0][0], '');
    }
  }

  // ── Rest of pipeline ──────────────────────────────────────────────────────
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

// Extract plain title from first non-empty <p> of raw HTML
function extractDocTitle(rawHtml) {
  rawHtml = rawHtml.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  const body = rawHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] || rawHtml;
  for (const m of body.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) {
    const text = m[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
    if (text) return text;
  }
  return '';
}

// ── Main ─────────────────────────────────────────────────────────────────────
console.log(`[fix-qpro-evemrtg]  dry-run=${DRY_RUN}\n`);

// Export ZH doc once (shared across all 3 QPRO sites)
console.log('Exporting ZH doc from Drive…');
const sheetsClient = await getSheetsClient();
const { google }   = await loadGoogleapis();
const drive        = google.drive({ version: 'v3', auth: sheetsClient.auth });

const fileList = await drive.files.list({
  q: `'${PROMO_FOLDER_ID}' in parents and mimeType = 'application/vnd.google-apps.document' and trashed = false`,
  fields: 'files(id,name)', pageSize: 20, includeItemsFromAllDrives: true, supportsAllDrives: true,
});
const zhDoc = (fileList.data.files || []).find(f => /my.?zh|zh.*my/i.test(f.name));
if (!zhDoc) { console.error('ZH doc not found'); process.exit(1); }
console.log('  ZH doc:', zhDoc.name);

const rawRes  = await drive.files.export({ fileId: zhDoc.id, mimeType: 'text/html' });
const rawHtml = typeof rawRes.data === 'string' ? rawRes.data : String(rawRes.data);
const zhTitleRaw = extractDocTitle(rawHtml);
const zhTitle    = decodeHtmlEntities(zhTitleRaw);
console.log('  ZH title (raw):', zhTitleRaw);
console.log('  ZH title (decoded):', zhTitle);

const { content: zhContent, description: zhDescRaw } = await fetchDocHtml(drive, zhDoc.id);
const zhDesc = decodeHtmlEntities(zhDescRaw) || '荣耀始于开赛之刻，于每场对决中崛起。';
console.log('  ZH description (decoded):', zhDesc);
console.log('  ZH content length:', zhContent.length, 'chars\n');

const SERVER_FIELDS = new Set(['id', 'promotion_content_id', 'settings_locale_code', 'created_at', 'updated_at']);

for (const { siteId, contentId } of JOBS) {
  const site = getSite(siteId);
  console.log(`── ${siteId}  content_id=${contentId} ──`);

  const detail  = await authedFetch(site, `/api/bo/promotioncontent/${contentId}`);
  const content = detail?.data?.content;
  const details = JSON.parse(JSON.stringify(detail?.data?.details || {}));

  // Locale map
  const locRes    = await authedFetch(site, '/api/bo/locale?perPage=100');
  const localeMap = Object.fromEntries((locRes?.data?.rows || []).map(r => [r.code, r.id]));
  const ZH_ID     = String(localeMap['MY_ZH'] || 3);

  // ── Fix 1: Remove LIVE CASINO (id=2) from category_id ────────────────────
  const origCats  = content?.category_id || [];
  const fixedCats = origCats.filter(id => id !== 2);
  console.log(`  category_id: [${origCats}] → [${fixedCats}]`);

  // ── Fix 2: MY_ZH title / description / content ───────────────────────────
  if (details[ZH_ID]) {
    console.log(`  ZH locale (${ZH_ID}): title "${details[ZH_ID].title}" → "${zhTitle}"`);
    console.log(`           desc  "${details[ZH_ID].description}" → "${zhDesc}"`);
    details[ZH_ID].title       = zhTitle;
    details[ZH_ID].description = zhDesc;
    details[ZH_ID].content     = zhContent;
  } else {
    console.log(`  ZH locale (${ZH_ID}): not found in details — skipping ZH fix`);
  }

  if (DRY_RUN) {
    console.log(`  [DRY-RUN] would PUT\n`);
    continue;
  }

  // ── Build PUT body ────────────────────────────────────────────────────────
  const categoryObj    = Object.fromEntries(fixedCats.map((id, i) => [String(i), id]));
  const contentTypeObj = Object.fromEntries((content.content_type || []).map(t => [String(t), true]));

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
  const putRes = await authedFetch(site, `/api/bo/promotioncontent/${contentId}`, { method: 'PUT', body: putBody });
  const ok = putRes?.success !== false;
  console.log(`  PUT ${ok ? '✅ OK' : '❌ FAILED'} — ${JSON.stringify(putRes?.message || '')}\n`);
}

console.log('═══════════════════ DONE ═══════════════════');
if (DRY_RUN) console.log('  (dry-run — no changes made)');

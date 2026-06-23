// Fetch the Indonesian promo doc from B46 Drive folder and update ID_ID locale on pc_id=181.
//
// The ID/ID doc structure is inverted vs EN docs:
//   [Indonesian content — full body + rules + T&C]  ← we want THIS
//   <hr>
//   [English reference copy]                         ← discarded
//
// So we take everything BEFORE the first <hr>, process it through the same
// fetchDocHtml pipeline (minus the header-strip step), then split out
// title / description / body the same way we do for ZH docs.

import { getSheetsClient } from '../src/sheets-client.js';
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';
import { google } from 'googleapis';

const FOLDER_ID = '14-PU4X29LvBDeIhkUf5AlqzMkIEvDYJU';
const PC_ID     = 181;
const SITE_ID   = 'qpro1';
const DRY_RUN   = process.argv.includes('--dry-run');
const delay     = (ms) => new Promise((r) => setTimeout(r, ms));
const SERVER_FIELDS = new Set(['id', 'promotion_content_id', 'settings_locale_code', 'created_at', 'updated_at']);

// T&C URL for ID_ID
const TNC_URL = 'https://bp9mys.com/id-id/info-center/terms-and-conditions';

// ── Drive setup ───────────────────────────────────────────────────────────────
const client = await getSheetsClient();
const drive  = google.drive({ version: 'v3', auth: client.auth });

// ── Find ID/ID doc ────────────────────────────────────────────────────────────
const listRes = await drive.files.list({
  q:                       `'${FOLDER_ID}' in parents and mimeType = 'application/vnd.google-apps.document' and trashed = false`,
  fields:                  'files(id,name)',
  pageSize:                20,
  includeItemsFromAllDrives: true,
  supportsAllDrives:       true,
});
const files = listRes.data.files || [];
const idDoc = files.find((f) => /\bID\/ID\b/.test(f.name) || /\bid[-_\s]?id\b/i.test(f.name));
if (!idDoc) throw new Error('Could not find ID/ID doc — available: ' + files.map((f) => f.name).join(', '));
console.log(`Using: "${idDoc.name}"  id=${idDoc.id}`);

// ── Export doc HTML ───────────────────────────────────────────────────────────
const exportRes = await drive.files.export({ fileId: idDoc.id, mimeType: 'text/html' });
let html = typeof exportRes.data === 'string' ? exportRes.data : String(exportRes.data);

// ── Apply fetchDocHtml pipeline (same as upload-promo.js) ────────────────────
// Steps 1-N: cleanup, attribute stripping, list conversion — same logic.

html = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
html = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
html = bodyMatch ? bodyMatch[1] : html;

// Promote bold/italic spans
html = html.replace(/<span[^>]*font-weight\s*:\s*(?:700|bold)[^>]*>([\s\S]*?)<\/span>/gi, (_m, inner) => `<strong>${inner}</strong>`);
html = html.replace(/<span[^>]*font-style\s*:\s*italic[^>]*>([\s\S]*?)<\/span>/gi, (_m, inner) => `<em>${inner}</em>`);

// Unwrap Google redirect URLs
html = html.replace(/https:\/\/www\.google\.com\/url\?q=([^&"]+)[^"]*/g, (_m, enc) => { try { return decodeURIComponent(enc); } catch { return enc; } });

// Strip all attrs; keep href on <a>, text-align (non-left) on <p>
html = html.replace(/<(\w+)([^>]*)>/g, (_m, tag, attrs) => {
  const t = tag.toLowerCase();
  const out = [];
  if (t === 'a') { const m = attrs.match(/\bhref="([^"]*)"/i); if (m) out.push(`href="${m[1]}"`); }
  if (t === 'p') {
    const sm = attrs.match(/\bstyle="([^"]*)"/i);
    if (sm) { const ta = sm[1].match(/text-align\s*:\s*[^;"]*/i); if (ta && !/text-align\s*:\s*left/i.test(ta[0])) out.push(`style="${ta[0].trim()}"`); }
  }
  return out.length ? `<${tag} ${out.join(' ')}>` : `<${tag}>`;
});

html = html.replace(/<colgroup>[\s\S]*?<\/colgroup>/gi, '');
html = html.replace(/<\/?span>/gi, '');

// ── SPLIT: take only the content BEFORE the first <hr> (the ID section) ──────
// The ID doc has ID content → <hr> → English reference. We want the ID part only.
const firstHr = html.search(/<hr/i);
if (firstHr !== -1) {
  html = html.slice(0, firstHr);
  console.log('Split at first <hr>: using pre-<hr> Indonesian section');
} else {
  console.warn('No <hr> found — using full doc');
}

// Extract description (tagline) from second non-empty <p>
const nonEmptyTexts = [];
for (const m of html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) {
  const text = m[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
  if (text) nonEmptyTexts.push(text);
}
const rawDesc = nonEmptyTexts[1] || nonEmptyTexts[0] || '';
const description = rawDesc
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
  .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
  .replace(/&rsquo;/g, '’').replace(/&ldquo;/g, '“').replace(/&rdquo;/g, '”')
  .replace(/&quot;/g, '"');
console.log('Extracted description:', description);

// ── Continue pipeline (same as fetchDocHtml after header-strip) ───────────────
// Promote td text-align:center from inner <p>
html = html.replace(/<td>\s*<p style="text-align:center">/gi, '<td style="text-align:center">');

// Remove empty paragraphs
for (let pass = 0; pass < 3; pass++) {
  html = html.replace(/<(strong|em)>\s*(?:<br>)?\s*<\/\1>/gi, '');
  html = html.replace(/<p[^>]*>\s*(?:<br>)?\s*<\/p>/gi, '');
}
html = html.replace(/^(\s*<p[^>]*>&nbsp;<\/p>\s*)+/, '');
html = html.replace(/(<p[^>]*>)\s*<br>\s*/i, '$1');

// Convert <p> breaks → <br><br>
html = html.replace(/<\/p>\s*<p[^>]*>&nbsp;<\/p>\s*<p[^>]*>/gi, '<br><br>');
html = html.replace(/<p[^>]*>&nbsp;<\/p>/gi, '<br><br>');
html = html.replace(/<\/p>\s*<p[^>]*>/gi,    '<br><br>');
html = html.replace(/<\/p>\s*(<table[^>]*>)/gi,        '<br><br>$1');
html = html.replace(/<\/p>\s*(<(?:ol|ul)[^>]*>)/gi,    '<br><br>$1');
html = html.replace(/(<\/table>)\s*<p[^>]*>/gi,         '$1<br><br>');
html = html.replace(/(<\/(?:ol|ul)>)\s*<p[^>]*>/gi,    '$1<br><br>');
html = html.replace(/(<\/(?:ol|ul)>)\s*(<table[^>]*>)/gi, '$1<br><br>$2');
html = html.replace(/(<\/table>)\s*(<(?:ol|ul)[^>]*>)/gi,  '$1<br><br>$2');
html = html.replace(/<p[^>]*>|<\/p>/gi, '');

// Convert numbered/bulleted lists
html = html.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, inner) => {
  const items = [...inner.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => m[1].trim());
  return items.map((t, i) => `${i + 1}. ${t}`).join('<br><br>');
});
html = html.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, inner) => {
  const items = [...inner.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => m[1].trim());
  return items.map((t) => `• ${t}`).join('<br><br>');
});

// Cleanup spacing
html = html.replace(/<br><br>(?:\s*&nbsp;\s*)+<br><br>/gi, '<br><br>');
html = html.replace(/(<br>){3,}/gi, '<br><br>');
html = html.replace(/^(\s*<br>)+/i, '');
html = html.trim();

// ── ZH-style split: strip title + tagline from content body ──────────────────
// Structure: <strong>title</strong><br><br>tagline<br><br>body...
// Strip first two <br><br>-delimited segments (title + tagline).
const segs = html.split('<br><br>');
// segs[0] = <strong>BP9 Belanja & Menang Tengah Tahun</strong>
// segs[1] = tagline
// segs[2..] = body
let content = segs.slice(2).join('<br><br>');

// ── Fix numbered list: post-table items labeled 1/2 should be 3/4 ────────────
// Indonesian text from doc (exact plain text from conversion)
const ID_ITEM3_OLD = '<br><br>1. Semakin banyak tiket yang Anda kumpulkan, semakin besar peluang Anda terpilih sebagai pemenang.';
const ID_ITEM3_NEW = '<br><br>3. Semakin banyak tiket yang Anda kumpulkan, semakin besar peluang Anda terpilih sebagai pemenang.';
const ID_ITEM4_OLD = '<br><br>2. Pemenang beruntung akan dihubungi oleh tim Promosi kami setelah acara berakhir.';
const ID_ITEM4_NEW = '<br><br>4. Pemenang beruntung akan dihubungi oleh tim Promosi kami setelah acara berakhir.';

content = content.replace(ID_ITEM3_OLD, ID_ITEM3_NEW).replace(ID_ITEM4_OLD, ID_ITEM4_NEW);

// ── T&C line-11 hyperlink (sentence 11: "Syarat dan ketentuan umum :brandname berlaku.") ─
// Keep <strong>Syarat dan Ketentuan</strong> heading unlinked.
// Only link "Syarat dan ketentuan" in the final T&C clause.
const ID_TNC_HEADING = '<strong>Syarat dan Ketentuan</strong>';
const PLACEHOLDER = '\x00TNC_ID_HDR\x00';
content = content.replace(ID_TNC_HEADING, PLACEHOLDER);
// Strip any existing links on this phrase
content = content.replace(/<a[^>]*>Syarat dan ketentuan<\/a>/gi, 'Syarat dan ketentuan');
// Link only in the "... umum :brandname berlaku." sentence
content = content.replace(
  /Syarat dan ketentuan umum :brandname berlaku\./gi,
  `<a href="${TNC_URL}">Syarat dan ketentuan</a> umum :brandname berlaku.`,
);
content = content.replace(PLACEHOLDER, ID_TNC_HEADING);

console.log('\nContent (first 500 chars):', content.slice(0, 500));
console.log('\nContent (last 300 chars):', content.slice(-300));

if (DRY_RUN) {
  console.log('\n[DRY-RUN] would update ID_ID content + description');
  process.exit(0);
}

// ── Patch ID_ID locale on pc_id=181 ──────────────────────────────────────────
await delay(1000);
const site      = getSite(SITE_ID);
const pcRes     = await authedFetch(site, `/api/bo/promotioncontent/${PC_ID}`);
const pcContent = pcRes?.data?.content;
const details   = JSON.parse(JSON.stringify(pcRes?.data?.details || {}));

const idIdEntry = Object.entries(details).find(([, d]) => d?.settings_locale_code === 'ID_ID');
if (!idIdEntry) throw new Error('ID_ID locale not found');
const [locId] = idIdEntry;

details[locId].content     = content;
details[locId].description = description;

const cleanDetails = {};
for (const [k, det] of Object.entries(details)) {
  if (!det) { cleanDetails[k] = det; continue; }
  cleanDetails[k] = Object.fromEntries(Object.entries(det).filter(([f]) => !SERVER_FIELDS.has(f)));
}

const catObj  = Object.fromEntries((pcContent.category_id  || []).map((id, i) => [String(i), id]));
const typeObj = Object.fromEntries((pcContent.content_type || []).map((t)      => [String(t), true]));

await delay(1000);
const r = await authedFetch(site, `/api/bo/promotioncontent/${PC_ID}`, {
  method: 'PUT',
  body: {
    code: pcContent.code, category_id: catObj, content_type: typeObj,
    member_visibility: pcContent.member_visibility, position: pcContent.position,
    apply_action: pcContent.apply_action, allow_apply: pcContent.allow_apply,
    status: pcContent.status, max_application: pcContent.max_application,
    details: cleanDetails,
  },
});
const ok = r?.success !== false;
console.log(`\nPUT ${ok ? '✅ OK' : '❌ FAILED'} — ${JSON.stringify(r?.message || r?.errors || '')}`);

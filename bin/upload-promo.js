#!/usr/bin/env node
// Banner upload CLI — reads Banner Schedule, discovers local image files,
// and API-directly creates QPRO 3.3 Promotion Content + 14.2 Banner rows.
//
// SAFE BY DEFAULT: with no flags, this makes NO writes to the gaming Back Office
// (BO) — no banner, no 3.3 content, nothing created or modified there. You must
// pass --commit to actually write anything live. (Fixed 2026-07-09 — previously
// --commit was a no-op and the bare command wrote live; see
// memory/project_banner_upload_handover.md for the incident context.)
//
// Dry-run is write-free, NOT network-free: it always makes a real, read-only
// Google Sheets API call to load the Banner Schedule, and — if a promo-draft
// Drive folder resolves for the campaign — a real, read-only Google Drive API
// call to check whether that folder actually yields usable doc content. The
// Drive check is what lets the plan bundle flag `contentIsStub` (the 3.3 page
// would otherwise silently ship as a bare image with no title/description/T&C)
// before any BO write happens — there's no way to know that without attempting
// the fetch (a folder can exist but be empty, permission-blocked, or contain no
// native Docs; a "does a URL exist" check alone would miss all of those).
//
// Usage (flags require = syntax):
//   node bin/upload-promo.js --range=B01-B03                  (dry-run — plan only, no BO calls)
//   node bin/upload-promo.js --range=B01-B03 --commit         (live — actually writes)
//   node bin/upload-promo.js --b-ids=B01,B05,B09 --commit
//   node bin/upload-promo.js --range=B16 --banner-dir=D:\Banners --commit
//   node bin/upload-promo.js --range=B16 --skip-content --commit       (14.2 only, 3.3 already exists)
//   node bin/upload-promo.js --range=B16 --promo-code=MYCODE --commit  (link to existing 3.3 code)
//   node bin/upload-promo.js --range=B23-B26 --image-dir=C:\path\to\ye55-min --commit  (test images, bypass brand-prefix filter)
//   node bin/upload-promo.js --b-ids=B16 --image-dir=... --promo-folder=<Drive-folder-id-or-url> --commit
//
// Flags:
//   --range=<B##-B##>          B-ID range (inclusive)
//   --b-ids=<B##,…>            comma-list of B-IDs
//   --commit                   REQUIRED to actually write to BO — omit for a safe dry-run
//   --dry-run                  explicit no-op alias for the default (dry-run); mutually exclusive with --commit
//   --banner-dir=<path>        root folder containing {brandCode}-min/ subfolders
//                              (default: C:\Users\vdiuser\Downloads\promo-automation\Banner)
//   --skip-content             skip 3.3 Promotion Content creation (banner-only run)
//   --promo-code=<code>        link banner to an existing 3.3 code (implies skip-content)
//   --promo-folder=<id|url>    Drive folder ID or URL containing promo draft Google Docs;
//                              overrides column D lookup + campaign fallback for all B-IDs in run
//
// Image discovery: looks for {loginMerchantCode.lower()}-up-*-{locale}.jpg (desktop)
//   and {loginMerchantCode.lower()}-mup-*-{locale}.jpg (mobile) in any subfolder of
//   --banner-dir whose name starts with the brand code (prefers *-min over *-ext).
//   Date formats accepted: YYYY-MM-DD, DD/MM/YYYY, DD-Mon-YYYY (e.g. 21-Apr-2026).

import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from './_args.js';
import { getSite } from '../src/sites.js';
import { parseBannerIdRange } from '../src/banner-schedule.js';
import {
  authedFetch,
  getAllCategories,
  createPromotionContent,
  emptyPromoContentDetail,
  localToUtcBoDate,
  createBanner,
  uploadFile,
} from '../src/api-client.js';
import { getSheetsClient } from '../src/sheets-client.js';
import { loadGoogleapis } from '../src/google-auth.js';

// ── Constants ────────────────────────────────────────────────────────────────

const BANNER_SCHEDULE_SHEET_ID = '1vpyjhqiKzcn2XHovcN2tEa4UkzUMqTmFsUZ59m-n8_E';
// The schedule has one tab per month ("May 2026", "Jun 2026", ...). Resolve the
// CURRENT month tab dynamically so this never silently goes stale (it was pinned
// to a hardcoded May GID and kept reading last month's rows into June). Override
// with --month="Jun 2026" or --gid=<numeric> for back-dated runs.
const SCHEDULE_GID_OVERRIDE = (() => {
  const a = process.argv.find((x) => x.startsWith('--gid='));
  return a ? Number(a.split('=')[1]) : null;
})();
const SCHEDULE_MONTH_OVERRIDE = (() => {
  const a = process.argv.find((x) => x.startsWith('--month='));
  return a ? a.split('=').slice(1).join('=') : null;
})();
const DEFAULT_BANNER_DIR = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '../../Banner',
);

// Locale suffix in filenames → canonical key used for lookup
// e.g. "my-en" → "MY_EN"
function suffixToCode(suffix) {
  return suffix.toUpperCase().replace('-', '_');
}

// ── Locale ID resolver ───────────────────────────────────────────────────────

const localeCache = new Map();

async function getLocaleMap(site) {
  if (localeCache.has(site.id)) return localeCache.get(site.id);
  const res = await authedFetch(site, '/api/bo/locale?perPage=100');
  const rows = res?.data?.rows || [];
  // Build { MY_EN: 1, MY_ZH: 3, … }
  const map = Object.fromEntries(rows.map((r) => [r.code, r.id]));
  localeCache.set(site.id, map);
  return map;
}

// ── Image discovery ──────────────────────────────────────────────────────────
// Looks for {brandCode}-up-*-{locale}.jpg (desktop) and {brandCode}-mup-*-{locale}.jpg
// (mobile) inside any subfolder of bannerDir whose name starts with brandCode.
// brandCode = site.loginMerchantCode (e.g. "YE55" for qpro4) lowercased.
//
// Returns: [{ localeSuffix, desktopPath, mobilePath }, ...]

// imageDirOverride: when provided, use this folder directly and match any *-up-* / *-mup-* files
// (ignores brand-code prefix requirement — for testing with cross-brand image sets)
function discoverImages(siteId, bannerDir, imageDirOverride = null) {
  const site = getSite(siteId);
  const brandCode = (site.loginMerchantCode || siteId).toLowerCase();

  let folder;
  let prefixRegexDesktop;
  let prefixRegexMobile;

  if (imageDirOverride) {
    folder = imageDirOverride;
    prefixRegexDesktop = /^.+-up-/i;
    prefixRegexMobile  = /^.+-mup-/i;
    console.log(`  [images] using override folder: ${folder}`);
  } else {
    const siteKey = brandCode;
    // Find matching subfolders (e.g. ye55-min, ye55-ext)
    const subfolders = readdirSync(bannerDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.toLowerCase().startsWith(siteKey))
      .map((d) => path.join(bannerDir, d.name));

    if (!subfolders.length) {
      throw new Error(`No banner subfolder starting with "${siteKey}" found in ${bannerDir}.\n  Available: ${readdirSync(bannerDir).join(', ')}`);
    }

    // Prefer -min (compressed) over -ext if both exist
    folder = subfolders.find((f) => f.endsWith('-min')) || subfolders[0];
    console.log(`  [images] using folder: ${folder}`);
    prefixRegexDesktop = new RegExp(`^${siteKey}-up-`, 'i');
    prefixRegexMobile  = new RegExp(`^${siteKey}-mup-`, 'i');
  }

  const files = readdirSync(folder);
  const desktopFiles = files.filter((f) => prefixRegexDesktop.test(f) && /\.(jpe?g|png)$/i.test(f));
  const mobileFiles  = files.filter((f) => prefixRegexMobile.test(f)  && /\.(jpe?g|png)$/i.test(f));

  // Extract locale suffix from filename: last "-{country}-{lang}" before extension
  const getLocale = (filename) => {
    const m = filename.match(/-([a-z]{2}-[a-z]{2,3})\.[a-z]+$/i);
    return m ? m[1].toLowerCase() : null;
  };

  // Group by locale
  const byLocale = new Map();
  for (const f of desktopFiles) {
    const loc = getLocale(f);
    if (!loc) continue;
    if (!byLocale.has(loc)) byLocale.set(loc, {});
    byLocale.get(loc).desktopPath = path.join(folder, f);
  }
  for (const f of mobileFiles) {
    const loc = getLocale(f);
    if (!loc) continue;
    if (!byLocale.has(loc)) byLocale.set(loc, {});
    byLocale.get(loc).mobilePath = path.join(folder, f);
  }

  const results = [];
  for (const [localeSuffix, paths] of byLocale) {
    if (!paths.desktopPath || !paths.mobilePath) {
      console.warn(`  [images] locale ${localeSuffix}: missing ${paths.desktopPath ? 'mobile' : 'desktop'} — skipping`);
      continue;
    }
    results.push({ localeSuffix, ...paths });
  }

  if (!results.length) throw new Error(`No complete desktop+mobile pairs found in ${folder}`);
  return results;
}

// ── Banner schedule reader ────────────────────────────────────────────────────
// Reads all rows from the banner schedule spreadsheet (different sheet from
// the promo request tracker). Resolves the tab name from the numeric GID first,
// then fetches the entire A:P data range.

async function readScheduleRows(client) {
  const { sheets } = client;

  // Resolve the tab: explicit --gid wins, then --month, then the current month,
  // then the first "Mon YYYY" tab as a last resort.
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: BANNER_SCHEDULE_SHEET_ID,
    fields: 'sheets.properties(sheetId,title)',
  });
  const props = (meta.data.sheets || []).map((s) => s.properties);
  let tabName;
  if (SCHEDULE_GID_OVERRIDE != null) {
    const t = props.find((p) => p.sheetId === SCHEDULE_GID_OVERRIDE);
    if (!t) throw new Error(`--gid ${SCHEDULE_GID_OVERRIDE} not found in banner schedule spreadsheet`);
    tabName = t.title;
  } else {
    const want = SCHEDULE_MONTH_OVERRIDE
      || new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' }); // "Jun 2026"
    const t = props.find((p) => p.title.toLowerCase() === want.toLowerCase())
      || props.find((p) => /^[A-Za-z]{3}\s+\d{4}$/.test(p.title));
    if (!t) throw new Error(`No month tab "${want}" found in banner schedule; tabs: ${props.map((p) => p.title).join(', ')}`);
    tabName = t.title;
  }
  console.log(`  [schedule] tab: ${tabName}`);

  // Use includeGridData so we can extract hyperlinks from column D
  const res = await sheets.spreadsheets.get({
    spreadsheetId: BANNER_SCHEDULE_SHEET_ID,
    ranges: [`'${tabName}'!A:P`],
    includeGridData: true,
    fields: 'sheets.data.rowData.values(formattedValue,hyperlink,textFormatRuns)',
  });

  const rowData = res.data.sheets?.[0]?.data?.[0]?.rowData || [];
  const rows = [];
  const hyperlinks = [];   // parallel array: hyperlinks[i][j] = URL or null

  for (const row of rowData) {
    const cellVals = [];
    const cellLinks = [];
    for (const cell of (row.values || [])) {
      cellVals.push(cell.formattedValue ?? '');
      const link = cell.hyperlink
                || cell.textFormatRuns?.[0]?.format?.link?.uri
                || null;
      cellLinks.push(link);
    }
    rows.push(cellVals);
    hyperlinks.push(cellLinks);
  }

  return { rows, hyperlinks };
}

// ── Category selector ─────────────────────────────────────────────────────────
// Picks the right promotion categories (SL, LC, WIN, ALL, etc.) from the
// campaign title by detecting provider names and content keywords.
// Always appends SHOW ALL (code=ALL) for game-related promos.
// Falls back to ALL-only when nothing specific matched.

function selectCategories(campaign, allCats) {
  const text = (campaign || '').toLowerCase();
  const byCode = new Map(allCats.map((c) => [c.code, c]));
  const picked = new Set();
  const pick = (code) => { if (byCode.has(code)) picked.add(code); };

  // ── Provider → game category rules ──────────────────────────────────────
  // Multi-game providers (Slots + Live Casino)
  if (/microgaming/.test(text))                      { pick('SL'); pick('LC'); }
  if (/playtech/.test(text))                         { pick('SL'); pick('LC'); }

  // Primarily-slots providers
  if (/pragmatic.play|pg.soft|pg slot|netent|play.?n.?go|habanero|joker|cq9|jdb|rtg|betsoft|spadegaming|skywind|blueprint|red.tiger|nolimit/.test(text)) pick('SL');

  // Primarily-live-casino providers
  if (/evolution|sa.gaming|sexy.bac|dream.gaming|wm.casino|allbet|ebet|biggaming|bg.live|ag.gaming/.test(text)) pick('LC');

  // Crash / trading
  if (/spribe|aviator/.test(text)) pick('CG');

  // ── Title keyword rules ──────────────────────────────────────────────────
  if (/\bslot|\bspin|free.?spin/.test(text))           pick('SL');
  if (/live.casino|baccarat|blackjack|roulette/.test(text)) pick('LC');
  if (/\bfish/.test(text))                             pick('FS');
  if (/crash/.test(text))                              pick('CG');
  if (/\blotter|\blotto/.test(text))                   pick('LT');
  if (/\bpoker/.test(text))                            pick('PK');
  if (/\bsport|\bfootball|\bsoccer/.test(text))        pick('SP');
  if (/\barcade/.test(text))                           pick('AR');
  if (/e.?sport/.test(text))                           pick('ES');

  // ── Display/filter category rules ───────────────────────────────────────
  if (/winner|winning.list|winners.list/.test(text))   pick('WIN');
  if (/new.member|new.player|\bwelcome|\bftd/.test(text)) pick('NEW');
  if (/\bapp\b|download.app/.test(text))               pick('APP');

  // SHOW ALL only for game-related promos (not winner/new-member-only content)
  const GAME_CODES = new Set(['SL','LC','SP','FS','CG','ES','LT','PK','TB','AR']);
  const hasGame = [...picked].some((c) => GAME_CODES.has(c));
  if (hasGame) pick('ALL');

  const result = allCats.filter((c) => picked.has(c.code));
  // Fallback: just SHOW ALL
  if (!result.length) {
    const showAll = byCode.get('ALL');
    return showAll ? [showAll] : [];
  }
  return result;
}

// ── Drive / Google Doc helpers ────────────────────────────────────────────────

// Extract the Drive folder ID from a full URL or a bare ID string.
function extractFolderIdFromUrl(url) {
  if (!url) return null;
  const m = (url + '').match(/\/folders\/([a-zA-Z0-9_-]{10,})/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9_-]{10,}$/.test(url)) return url;
  return null;
}

// Extract a locale key from the doc filename.
// Handles the naming pattern:  "{Campaign title} CC/LANG"  e.g. "… MY/EN", "… ID/ZH"
// Returns e.g. "MY_EN", "ID_ID", "MY_ZH".
// Falls back to crude heuristics when the pattern is absent.
function docNameToLocaleKey(name) {
  // Pattern: "… XX/YY" at end of filename (CC = 2 alpha, LANG = 2-3 alpha)
  const slash = name.match(/\b([A-Z]{2})\/([A-Z]{2,3})\s*$/i);
  if (slash) return `${slash[1].toUpperCase()}_${slash[2].toUpperCase()}`;
  const low = (name || '').toLowerCase();
  // Chinese characters in the name
  if (/[一-鿿]/.test(name)) return 'MY_ZH';
  if (/\b(zh|chi(nese)?)\b/.test(low)) return 'MY_ZH';
  if (/\b(id|ind(onesia(n)?)?)\b/.test(low)) return 'ID_EN';
  return 'MY_EN';
}

// Export a Google Doc as HTML and produce clean BO-format HTML.
// Returns { content, description } where:
//   content     — full BO-format HTML for the 3.3 article body
//   description — second non-empty line from the doc header (plain text); used for
//                 the 3.3 Promotion Content `description` field shown in listings
// Output uses only BO-native tags: <p>, <ol>/<li>, <table>/<tr>/<td>,
// <strong>, <em>, <a href>. No inline styles, no Google fonts/colours.
// Doc title+subtitle header (before first <hr>) is stripped after extracting description.
// <hr> section dividers are preserved (not converted to spacers).
// <p style="text-align:center;"> inside <td> is preserved for centred table headings.
async function fetchDocHtml(drive, docId) {
  const res = await drive.files.export({ fileId: docId, mimeType: 'text/html' });
  let html = typeof res.data === 'string' ? res.data : String(res.data);

  // Remove <style> / <script> blocks
  html = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  html = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');

  // Extract body
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  html = bodyMatch ? bodyMatch[1] : html;

  // ── Promote bold/italic spans → semantic tags (before attrs stripped) ────
  html = html.replace(/<span[^>]*font-weight\s*:\s*(?:700|bold)[^>]*>([\s\S]*?)<\/span>/gi,
    (_m, inner) => `<strong>${inner}</strong>`);
  html = html.replace(/<span[^>]*font-style\s*:\s*italic[^>]*>([\s\S]*?)<\/span>/gi,
    (_m, inner) => `<em>${inner}</em>`);

  // ── Unwrap Google redirect URLs ──────────────────────────────────────────
  html = html.replace(/https:\/\/www\.google\.com\/url\?q=([^&"]+)[^"]*/g,
    (_m, enc) => { try { return decodeURIComponent(enc); } catch { return enc; } });

  // ── Strip ALL element attributes; keep only semantic ones ────────────────
  html = html.replace(/<(\w+)([^>]*)>/g, (_m, tag, attrs) => {
    const t = tag.toLowerCase();
    const out = [];
    if (t === 'a') {
      const m = attrs.match(/\bhref="([^"]*)"/i);
      if (m) out.push(`href="${m[1]}"`);
    }
    // <table>: no attributes — CKEditor wraps in <figure class="table"> automatically
    // <p>: preserve text-align only when non-default (center/right/justify).
    // text-align:left is the default and never needs explicit styling — keeping it
    // would make the p tag attributed and break all the para→<br><br> conversions.
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

  // ── Remove colgroup / col (column-width artefacts) ───────────────────────
  html = html.replace(/<colgroup>[\s\S]*?<\/colgroup>/gi, '');

  // ── Strip span wrappers (all Docs text is wrapped in <span>) ─────────────
  html = html.replace(/<\/?span>/gi, '');

  // ── Extract description from header (before first <hr>) ─────────────────
  // Doc structure: line 1 = title, line 2 = description/tagline, then <hr>.
  // At this point spans/attrs are already stripped so paragraphs are clean text.
  let description = '';
  const headerSection = html.match(/^([\s\S]*?)<hr/i);
  if (headerSection) {
    const nonEmptyTexts = [];
    for (const m of headerSection[1].matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) {
      const text = m[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
      if (text) nonEmptyTexts.push(text);
    }
    // Second non-empty paragraph = tagline/description (first = doc title)
    description = nonEmptyTexts[1] || nonEmptyTexts[0] || '';
  }

  // ── Strip header block ──────────────────────────────────────────────────
  // Google Docs: [Doc Title + Subtitle] lives before the first <hr>. Drop it.
  html = html.replace(/^[\s\S]*?<hr[^>]*>/i, '');

  // ── Preserve <hr> section dividers ─────────────────────────────────────
  // Strip surrounding <p> context so <hr> becomes a clean standalone element.
  // The paragraph-conversion steps below will handle the text on either side.
  html = html.replace(/<\/p>\s*<hr[^>]*>\s*<p[^>]*>/gi, '<hr>');  // </p><hr><p> → just <hr>
  html = html.replace(/<\/p>\s*<hr[^>]*>/gi,             '<hr>');  // trailing </p><hr>
  html = html.replace(/<hr[^>]*>\s*<p[^>]*>/gi,          '<hr>');  // <hr><p> at start

  // ── Promote text-align:center from inner <p> to the <td> ───────────────
  // <p> tags are stripped later; doing this first preserves centred alignment on cells.
  html = html.replace(/<td>\s*<p style="text-align:center">/gi, '<td style="text-align:center">');

  // ── Remove near-empty paragraphs (Google Docs spacer + empty-bold artefacts)
  // Strip empty <strong>/<em> first, then empty <p>, repeated for nested cases.
  // Use <p[^>]*> to catch both bare <p> and attributed <p style="text-align:..."> variants.
  for (let pass = 0; pass < 3; pass++) {
    html = html.replace(/<(strong|em)>\s*(?:<br>)?\s*<\/\1>/gi, '');
    html = html.replace(/<p[^>]*>\s*(?:<br>)?\s*<\/p>/gi, '');
  }

  // ── Strip leading spacer(s) and any leading <br> artefact ───────────────
  html = html.replace(/^(\s*<p[^>]*>&nbsp;<\/p>\s*)+/, '');
  html = html.replace(/(<p[^>]*>)\s*<br>\s*/i, '$1');

  // ── Convert <p> paragraph breaks → <br><br> (double shift-enter spacing) ─
  // Section spacers <p>&nbsp;</p> also become <br><br>.
  // Also insert <br><br> at boundaries between <p> and block elements (table/ol/ul).
  // All patterns use <p[^>]*> to handle both bare <p> and attributed variants.
  html = html.replace(/<\/p>\s*<p[^>]*>&nbsp;<\/p>\s*<p[^>]*>/gi, '<br><br>');  // spacer between paras
  html = html.replace(/<p[^>]*>&nbsp;<\/p>/gi, '<br><br>');                       // standalone spacer
  html = html.replace(/<\/p>\s*<p[^>]*>/gi,    '<br><br>');                       // normal para break
  // Transitions between paragraphs and block elements.
  // Tables: keep <br><br> either side (they're used as visual content boxes).
  // Lists (<ol>/<ul>): they are block elements that create their own spacing —
  //   do NOT insert <br><br> before them. Keep <br><br> after them.
  html = html.replace(/<\/p>\s*(<table[^>]*>)/gi,       '<br><br>$1');   // para → table
  html = html.replace(/<\/p>\s*(<(?:ol|ul)[^>]*>)/gi,  '<br><br>$1');   // para → list (double break)
  html = html.replace(/(<\/table>)\s*<p[^>]*>/gi,        '$1<br><br>');  // table → para
  html = html.replace(/(<\/(?:ol|ul)>)\s*<p[^>]*>/gi,   '$1<br><br>');  // list → para
  html = html.replace(/(<\/(?:ol|ul)>)\s*(<table[^>]*>)/gi, '$1<br><br>$2'); // list → table
  html = html.replace(/(<\/table>)\s*(<(?:ol|ul)[^>]*>)/gi,  '$1<br><br>$2'); // table → list
  html = html.replace(/<p[^>]*>|<\/p>/gi, '');                            // strip remaining p tags

  // ── Convert lists to manually-numbered / bulleted inline text ────────────
  // <ol>/<ul> are block elements — <br><br> before them is invisible in CKEditor.
  // Converting to plain numbered text makes spacing visible and matches the native
  // QPRO BO format (e.g. "1. item<br><br>2. item…").
  html = html.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, inner) => {
    const items = [...inner.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => m[1].trim());
    return items.map((t, i) => `${i + 1}. ${t}`).join('<br><br>');
  });
  html = html.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, inner) => {
    const items = [...inner.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => m[1].trim());
    return items.map((t) => `• ${t}`).join('<br><br>');
  });

  // Add breathing room around <hr> section dividers (runs after <p> stripping so
  // all surrounding text is already in the flat <br> stream).
  // Any existing <br> before/after <hr> is consumed and replaced uniformly with <br><br>.
  html = html.replace(/(?:<br>)*(<hr>)/gi, '<br><br>$1');   // → <br><br><hr>
  html = html.replace(/(<hr>)(?:<br>)*/gi, '$1<br><br>');   // → <hr><br><br>

  // Remove lone &nbsp; sitting between <br><br> pairs (section-spacer artefact)
  html = html.replace(/<br><br>(?:\s*&nbsp;\s*)+<br><br>/gi, '<br><br>');
  // Collapse 3+ consecutive <br> down to 2
  html = html.replace(/(<br>){3,}/gi, '<br><br>');
  // Strip any leading <br> left at the very start
  html = html.replace(/^(\s*<br>)+/i, '');

  return { content: html.trim(), description };
}

// List Google Docs in a Drive folder and return a locale→{ content, description } map.
// { MY_EN: { content: '<p>…</p>', description: 'Glory Begins at…' }, … }
// Gracefully returns {} if the folder is empty or Drive API errors.
async function getDocContentMap(drive, folderUrl) {
  const folderId = extractFolderIdFromUrl(folderUrl);
  if (!folderId) { console.warn(`  [docs] invalid folder URL: ${folderUrl}`); return {}; }

  let files;
  try {
    const r = await drive.files.list({
      q: `'${folderId}' in parents and mimeType = 'application/vnd.google-apps.document' and trashed = false`,
      fields: 'files(id,name)',
      pageSize: 20,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
    });
    files = r.data.files || [];
  } catch (e) {
    console.warn(`  [docs] Drive API list failed: ${e.message}`);
    return {};
  }

  if (!files.length) { console.log(`  [docs] no Google Docs in folder ${folderId}`); return {}; }
  console.log(`  [docs] found ${files.length} doc(s): ${files.map((f) => f.name).join(', ')}`);

  const contentMap = {};
  for (const doc of files) {
    const localeKey = docNameToLocaleKey(doc.name);
    try {
      console.log(`  [docs] exporting "${doc.name}" → ${localeKey}…`);
      contentMap[localeKey] = await fetchDocHtml(drive, doc.id);
      await delay(800);
    } catch (e) {
      console.warn(`  [docs] export failed for "${doc.name}": ${e.message}`);
    }
  }
  return contentMap;
}

// ── Per-B-ID upload ──────────────────────────────────────────────────────────

const docContentCache = new Map();

async function getCachedDocContentMap(drive, folderUrl) {
  const folderId = extractFolderIdFromUrl(folderUrl);
  if (!folderId) return getDocContentMap(drive, folderUrl);
  if (docContentCache.has(folderId)) return docContentCache.get(folderId);
  const contentMap = await getDocContentMap(drive, folderUrl);
  docContentCache.set(folderId, contentMap);
  return contentMap;
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Creative-match guard ──────────────────────────────────────────────────────
// Image discovery matches files by BRAND PREFIX only, so a folder still holding
// last month's campaign images would be uploaded under THIS month's campaign
// label (the exact trap that pinned-to-May GID created). Compare keywords from
// the campaign title against keywords in the staged filenames; zero overlap is
// almost certainly the wrong creative — block unless explicitly overridden.
const ALLOW_CREATIVE_MISMATCH = process.argv.includes('--allow-creative-mismatch');

const CREATIVE_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'your', 'you', 'get', 'off', 'new', 'now', 'from',
  'daily', 'season', 'level', 'bonus', 'promo', 'promotion', 'campaign', 'multibrand',
]);
function keywordsFromText(t) {
  return [...new Set(
    String(t).toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ')
      .filter((w) => w.length >= 3 && !CREATIVE_STOPWORDS.has(w) && !/^\d+$/.test(w)),
  )];
}
function keywordsFromFilenames(names) {
  const sizeRe = /^\d+x\d+px?$/;
  const locale = new Set(['my', 'sg', 'id', 'th', 'km', 'en', 'zh', 'ms', 'us']);
  return [...new Set(
    names.flatMap((n) => path.basename(n).toLowerCase().replace(/\.[a-z0-9]+$/, '').split(/[-_]+/).slice(1))
      // drop brand prefix, up/mup tags, sizes, locale codes, pure numbers
      .filter((w) => w.length >= 3 && !['up', 'mup', 'px'].includes(w) && !sizeRe.test(w) && !locale.has(w) && !/^\d+$/.test(w)),
  )];
}
function checkCreativeMatch(campaignText, imageLocales) {
  const campKw = keywordsFromText(campaignText);
  const fileKw = new Set(keywordsFromFilenames(imageLocales.flatMap((l) => [l.desktopPath, l.mobilePath])));
  // Exact whole-word overlap only. Substring matching is too loose — e.g. the
  // "play" in "Pragmatic Play" would false-match "playboy" and let last month's
  // creative through.
  const overlap = campKw.filter((c) => fileKw.has(c));
  const weak = campKw.length === 0;
  return { ok: weak || overlap.length > 0, weak, overlap, campKw, fileKw: [...fileKw] };
}

async function uploadBanner(bRec, { bannerDir, imageDirOverride, skipContent, promoCodeOverride, dryRun, drive, campaignFolderMap, promoFolderOverride }) {
  const { b_id, site_id, campaign, draft_folder_label, folder_url, start_date, end_date, regions, platform } = bRec;

  if (!site_id) {
    return { b_id, status: 'skipped', reason: `brand "${bRec.brand_raw}" not configured (${bRec._brand_unconfigured_note || 'no site_id'})` };
  }

  if (platform === 'bia') {
    return { b_id, status: 'skipped', reason: 'BIA (WS1/WS2) requires MCP-driven upload — use banner-batch-uploader skill' };
  }

  if (platform !== 'qpro') {
    return { b_id, status: 'skipped', reason: `platform "${platform}" not yet supported in upload-promo.js (only qpro)` };
  }

  const site = getSite(site_id);
  // Strip leading [Tag] prefixes (e.g. "[Multibrand]", "[WS1]") from display title
  const rawLabel = draft_folder_label || campaign || b_id;
  const label = rawLabel.replace(/^(\s*\[[^\]]*\]\s*)+/, '').trim() || rawLabel;

  // Convert "DD/MM/YYYY" or "YYYY-MM-DD" → UTC BO date
  const MONTH_ABBR = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12' };
  const toBoDate = (raw, endOfDay = false) => {
    if (!raw) return null;
    const s = String(raw).trim();
    let iso;
    const dmY  = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);          // 21/04/2026
    const Ymd  = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);                 // 2026-04-21
    const dMoY = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);         // 21-Apr-2026
    if (dmY)  iso = `${dmY[3]}-${dmY[2].padStart(2,'0')}-${dmY[1].padStart(2,'0')}`;
    else if (Ymd)  iso = `${Ymd[1]}-${Ymd[2]}-${Ymd[3]}`;
    else if (dMoY) {
      const mo = MONTH_ABBR[dMoY[2].toLowerCase()];
      iso = mo ? `${dMoY[3]}-${mo}-${dMoY[1].padStart(2,'0')}` : null;
    }
    if (!iso) { console.warn(`  toBoDate: unrecognised format "${s}"`); return null; }
    const time = endOfDay ? '23:59:00' : '00:00:00';
    return localToUtcBoDate(`${iso} ${time}`);
  };

  const startUtc = toBoDate(start_date, false);
  const endUtc   = toBoDate(end_date, true);

  console.log(`\n[${b_id}] site=${site_id}  label="${label}"  ${start_date} → ${end_date}`);

  // ── Discover local images ────────────────────────────────────────────────
  let imageLocales;
  try {
    imageLocales = discoverImages(site_id, bannerDir, imageDirOverride);
  } catch (e) {
    return { b_id, status: 'error', reason: e.message };
  }
  console.log(`  [${b_id}] found ${imageLocales.length} locale(s): ${imageLocales.map((l) => l.localeSuffix).join(', ')}`);

  // ── Creative-match guard ─────────────────────────────────────────────────
  // Catch "wrong month's images under this campaign's name" before it goes live.
  if (!imageDirOverride) {
    const m = checkCreativeMatch(campaign || label, imageLocales);
    if (!m.ok) {
      const msg = `staged images don't match campaign "${label}". `
        + `Campaign keywords [${m.campKw.join(', ')}] share nothing with filename keywords [${m.fileKw.slice(0, 8).join(', ')}] — likely last month's creative still in the folder.`;
      if (ALLOW_CREATIVE_MISMATCH) {
        console.warn(`  [${b_id}] ⚠ CREATIVE MISMATCH (continuing — --allow-creative-mismatch): ${msg}`);
      } else {
        console.log(`  [${b_id}] ✗ BLOCKED — ${msg}`);
        console.log(`  [${b_id}]   Stage the correct creative in the brand folder, or re-run with --allow-creative-mismatch to override.`);
        return { b_id, status: 'creative-mismatch', reason: msg };
      }
    } else if (m.weak) {
      console.warn(`  [${b_id}] WARNING: creative-match guard could not evaluate campaign "${label}" because it has no usable keywords after stopword filtering.`);
    }
  }

  // ── Locale ID map ────────────────────────────────────────────────────────
  const localeMap = await getLocaleMap(site);

  // Resolve promo draft docs before dry-run returns so plan bundles can flag stubs.
  const resolvedFolderUrl = promoFolderOverride
    || folder_url
    || (campaignFolderMap && campaignFolderMap.get((campaign || '').trim().toLowerCase()))
    || null;

  let docContentMap = {};
  if (!skipContent && resolvedFolderUrl && drive) {
    console.log(`  [${b_id}] fetching promo doc content from folder...`);
    docContentMap = await getCachedDocContentMap(drive, resolvedFolderUrl);
    const langs = Object.keys(docContentMap);
    if (langs.length) {
      console.log(`  [${b_id}] doc content loaded for: ${langs.join(', ')}`);
    } else {
      console.log(`  [${b_id}] no doc content found - will fall back to image-only content`);
    }
  } else if (!skipContent && !drive) {
    console.log(`  [${b_id}] Drive API not available - using image-only content`);
  } else if (!skipContent) {
    console.log(`  [${b_id}] no Drive folder resolved for campaign "${campaign}" - using image-only content`);
  }

  let contentIsStub = !skipContent && Object.keys(docContentMap).length === 0;

  if (dryRun) {
    const cleanCampaignDry = (campaign || label).replace(/^(\s*\[[^\]]*\]\s*)+/, '').trim();
    const acronymDry = cleanCampaignDry.split(/\s+/).map((w) => w[0]?.toUpperCase() || '').filter((c) => /[A-Z0-9]/.test(c)).join('');
    const codeDry = promoCodeOverride || `EVE${acronymDry}`.slice(0, 15);
    const allCatsDry = await getAllCategories(site);
    const selCatsDry = selectCategories(cleanCampaignDry, allCatsDry);
    console.log(`  [${b_id}] DRY-RUN — promo code would be: ${codeDry}`);
    console.log(`  [${b_id}] DRY-RUN — categories: ${selCatsDry.map((c) => c.code + '=' + c.name).join(', ')}`);
    console.log(`  [${b_id}] DRY-RUN — would upload (3 files per locale: desktop banner, mobile banner, promo content image):`);
    for (const { localeSuffix, desktopPath, mobilePath } of imageLocales) {
      const code = suffixToCode(localeSuffix);
      const locId = localeMap[code];
      console.log(`    locale ${code} (id=${locId}):`);
      console.log(`      [banners]    desktop: ${path.basename(desktopPath)}`);
      console.log(`      [banners]    mobile:  ${path.basename(mobilePath)}`);
      console.log(`      [promotions] content: ${path.basename(mobilePath)}  (mup — mobile crop)`);
    }
    return {
      b_id, status: 'dry-run', promoCode: codeDry,
      site_id, label, campaign, startUtc, endUtc,
      contentIsStub,
      stagedImages: imageLocales.map((il) => ({ localeSuffix: il.localeSuffix, desktop: il.desktopPath, mobile: il.mobilePath })),
    };
  }

  // ── Upload banner images ─────────────────────────────────────────────────
  // imageRows      — for 14.2 banner (type='banners')
  // contentImages  — for 3.3 promo content image field (type='promotions')
  const imageRows     = [];
  const contentImages = new Map(); // locId → { promoImageUrl, desktopBannerUrl }

  for (const { localeSuffix, desktopPath, mobilePath } of imageLocales) {
    const locCode = suffixToCode(localeSuffix);
    const locId = localeMap[locCode];
    if (!locId) {
      console.warn(`  [${b_id}] locale ${locCode} not in BO locale map — skipping`);
      continue;
    }

    await delay(5000);
    console.log(`  [${b_id}] upload desktop banner (${locCode})…`);
    const dRes = await uploadFile(site, readFileSync(desktopPath), path.basename(desktopPath), { type: 'banners' });
    const desktopUrl = dRes?.data?.files?.[0];
    if (!desktopUrl) throw new Error(`No URL returned from desktop banner upload for ${b_id} ${locCode}`);

    await delay(3000);
    console.log(`  [${b_id}] upload mobile banner (${locCode})…`);
    const mRes = await uploadFile(site, readFileSync(mobilePath), path.basename(mobilePath), { type: 'banners' });
    const mobileUrl = mRes?.data?.files?.[0];
    if (!mobileUrl) throw new Error(`No URL returned from mobile banner upload for ${b_id} ${locCode}`);

    await delay(3000);
    // 3.3 Promotion Content image = mobile size (mup), NOT the 1920×400 desktop banner.
    // QPRO promo page thumbnail is the mobile-banner crop (790–960×400 depending on brand).
    console.log(`  [${b_id}] upload promo content image (${locCode})…`);
    const pRes = await uploadFile(site, readFileSync(mobilePath), path.basename(mobilePath), { type: 'promotions' });
    const promoImageUrl = pRes?.data?.files?.[0];
    if (!promoImageUrl) throw new Error(`No URL returned from promotions upload for ${b_id} ${locCode}`);

    imageRows.push({ settings_locale_id: locId, image_desktop: desktopUrl, image_mobile: mobileUrl });
    contentImages.set(locId, { promoImageUrl, desktopBannerUrl: desktopUrl });
  }


  // ── 3.3 Promotion Content (optional) ────────────────────────────────────
  let promoCode = promoCodeOverride || null;
  let contentDetails = null;

  if (!skipContent) {
    // Code = EVE + first-letter acronym of each campaign word (brackets stripped).
    // Skip words whose first character isn't alphanumeric (e.g. "&", ":") to keep
    // the code URL-safe in /promotion?code=… deep-links.
    const cleanCampaign = (campaign || label).replace(/^(\s*\[[^\]]*\]\s*)+/, '').trim();
    const acronym = cleanCampaign.split(/\s+/).map((w) => w[0]?.toUpperCase() || '').filter((c) => /[A-Z0-9]/.test(c)).join('');
    promoCode = promoCodeOverride || `EVE${acronym}`.slice(0, 15);

    const allCats = await getAllCategories(site);
    const selectedCats = selectCategories(cleanCampaign, allCats);
    console.log(`  [${b_id}] categories: ${selectedCats.map((c) => c.code + '=' + c.name).join(', ')}`);
    const catObj = Object.fromEntries(selectedCats.map((c, i) => [String(i), c.id]));

    const localesInBo = Object.keys(localeMap).filter((k) => localeMap[k]);
    const detailsObj = {};
    for (const locCode of localesInBo) {
      const locId = localeMap[locCode];
      const imgLocale = imageLocales.find((il) => suffixToCode(il.localeSuffix) === locCode);
      if (imgLocale) {
        const { promoImageUrl } = contentImages.get(locId) || {};
        // Doc content: exact locale match → same country EN → any EN → none
        const countryEn = locCode.replace(/_[^_]+$/, '_EN');
        const docEntry = docContentMap[locCode]
                      || docContentMap[countryEn]
                      || docContentMap['MY_EN']
                      || Object.values(docContentMap)[0]
                      || null;
        if (!docEntry) contentIsStub = true;
        const content = docEntry?.content
          || (promoImageUrl ? `<p><img src="${promoImageUrl}" style="max-width:100%;height:auto;"></p>` : '<p>&nbsp;</p>');
        // description = tagline from the doc header (second line); fall back to label
        const docDescription = docEntry?.description || label;
        detailsObj[String(locId)] = {
          ...emptyPromoContentDetail(),
          settings_locale_id: locId,
          title: label,
          description: docDescription,
          start: startUtc,
          end: endUtc,
          publish_at: startUtc,
          expire_at: endUtc,
          image: promoImageUrl || null,
          content,
          content_is_stub: !docEntry,
        };
      } else {
        detailsObj[String(locId)] = emptyPromoContentDetail();
      }
    }
    // Ensure at least one locale entry is populated if locale map didn't align
    if (Object.values(detailsObj).every((d) => !d.title)) {
      const firstLocId = imageRows[0]?.settings_locale_id;
      if (firstLocId && detailsObj[String(firstLocId)]) {
        const { promoImageUrl } = contentImages.get(firstLocId) || {};
        const fallbackEntry = docContentMap['MY_EN'] || Object.values(docContentMap)[0] || null;
        if (!fallbackEntry) contentIsStub = true;
        detailsObj[String(firstLocId)].title = label;
        detailsObj[String(firstLocId)].description = fallbackEntry?.description || label;
        detailsObj[String(firstLocId)].start = startUtc;
        detailsObj[String(firstLocId)].end = endUtc;
        detailsObj[String(firstLocId)].publish_at = startUtc;
        detailsObj[String(firstLocId)].expire_at = endUtc;
        detailsObj[String(firstLocId)].image = promoImageUrl || null;
        detailsObj[String(firstLocId)].content = fallbackEntry?.content
          || (promoImageUrl ? `<p><img src="${promoImageUrl}" style="max-width:100%;height:auto;"></p>` : '<p>&nbsp;</p>');
        detailsObj[String(firstLocId)].settings_locale_id = firstLocId;
        detailsObj[String(firstLocId)].content_is_stub = !fallbackEntry;
      }
    }

    // Auto-suffix on code conflict: EVEMPUE → EVEMPUE2 → EVEMPUE3 …
    contentDetails = detailsObj;

    let pcRes;
    for (let attempt = 1; attempt <= 5; attempt++) {
      const codeAttempt = attempt === 1 ? promoCode : `${promoCode.slice(0, 13)}${attempt}`;
      if (attempt > 1) await delay(1500);
      console.log(`  [${b_id}] create 3.3 promo content (code=${codeAttempt})…`);
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
        promoCode = codeAttempt;
        break;
      } catch (e) {
        if (e.message && /code.*taken|already.*taken/i.test(e.message) && attempt < 5) {
          console.warn(`  [${b_id}] code "${codeAttempt}" taken — trying suffix ${attempt + 1}`);
        } else {
          throw e;
        }
      }
    }
    const pcId = pcRes?.data?.rows?.id ?? pcRes?.data?.id ?? pcRes?.data?.rows?.[0]?.id;
    console.log(`  [${b_id}] ✅ 3.3 created id=${pcId} code=${promoCode}`);
  }

  // ── 14.2 Banner ──────────────────────────────────────────────────────────
  const bannerBody = {
    label,
    link: promoCode ? `/promotion?code=${promoCode}` : '',
    start_datetime: startUtc,
    end_datetime: endUtc,
    position: 99,
    status: 0,          // Inactive / draft
    session: 1,         // All
    platform_type_id: 1, // User Portal
    images: imageRows,
  };

  await delay(1500);
  console.log(`  [${b_id}] create 14.2 banner…`);
  const bannerRes = await createBanner(site, bannerBody);
  const bannerId = bannerRes?.data?.rows?.id ?? bannerRes?.data?.id;
  console.log(`  [${b_id}] ✅ banner created id=${bannerId}  link=${bannerBody.link}`);

  return {
    b_id, status: 'ok', promoCode, bannerId, pcId,
    site_id, label, campaign, startUtc, endUtc,
    contentDetails: skipContent ? null : contentDetails,
    contentIsStub,
    imageRows, bannerPosition: bannerBody.position,
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────

const { flags } = parseArgs(process.argv.slice(2));

const bIds = flags.range
  ? parseBannerIdRange(flags.range)
  : flags['b-ids']
    ? parseBannerIdRange(flags['b-ids'])
    : (() => { throw new Error('Pass --range B01-B03 or --b-ids B01,B02'); })();

const bannerDir = flags['banner-dir']
  ? path.resolve(flags['banner-dir'])
  : path.resolve('C:\\Users\\vdiuser\\Downloads\\promo-automation\\Banner');

const skipContent         = !!flags['skip-content'];
const promoCodeOverride   = flags['promo-code'] || null;
const commit              = !!flags.commit;
const dryRun              = !commit;   // safe default: dry-run unless --commit is explicitly passed
const imageDirOverride    = flags['image-dir'] ? path.resolve(flags['image-dir']) : null;
const promoFolderOverride = flags['promo-folder'] || null;  // Drive folder ID or URL

if (flags['dry-run'] && commit) {
  console.error('ERROR: --dry-run and --commit are mutually exclusive.');
  process.exit(1);
}

if (!existsSync(bannerDir)) {
  console.error(`Banner dir not found: ${bannerDir}`);
  process.exit(1);
}

console.log(`[upload-promo] B-IDs: ${bIds.join(', ')}  banner-dir: ${bannerDir}  skip-content=${skipContent}  mode=${commit ? 'COMMIT (live)' : 'DRY-RUN (add --commit for live)'}`);

// Load schedule from Google Sheets
const client = await getSheetsClient();
const { rows, hyperlinks } = await readScheduleRows(client);

// Parse rows into a Map keyed by B-ID
// Column B = b_id, col D = draft_folder_label (Promo Drafts Link), col I = brand, etc.
const scheduleMap = new Map();
const headerRow = rows[0] || [];

const h = headerRow.map((c) => (c || '').trim().toLowerCase());
const colIdx = {
  b_id:               h.indexOf('b id') !== -1 ? h.indexOf('b id') : 1,
  campaign:           h.indexOf('campaign') !== -1 ? h.indexOf('campaign') : 2,
  draft_folder_label: 3,  // col D — Promo Drafts Link (hyperlink extracted separately)
  status:             4,
  region:             5,
  requestor_class:    6,
  promo_type:         7,
  brand:              h.indexOf('brand') !== -1 ? h.indexOf('brand') : 8,
  placement:          9,
  start_date:        10,
  end_date:          11,
};

import { BANNER_BRAND_TO_SITE, normalizeBrand } from '../src/banner-schedule.js';

for (let ri = 1; ri < rows.length; ri++) {
  const row  = rows[ri];
  const hrow = hyperlinks[ri] || [];
  const bIdRaw = (row[colIdx.b_id] || '').trim();
  if (!/^B\d+$/i.test(bIdRaw)) continue;
  const bId = bIdRaw.toUpperCase();
  const brandRaw = (row[colIdx.brand] || '').trim();
  const brandInfo = BANNER_BRAND_TO_SITE[normalizeBrand(brandRaw)] || null;

  // column D hyperlink = Drive folder URL for promo content docs
  const folderUrl = hrow[colIdx.draft_folder_label] || null;

  scheduleMap.set(bId, {
    b_id: bId,
    campaign: (row[colIdx.campaign] || '').trim(),
    draft_folder_label: (row[colIdx.draft_folder_label] || '').trim(),
    folder_url: folderUrl,
    status: (row[colIdx.status] || '').trim(),
    regions: (row[colIdx.region] || '').split(/[,\s]+/).filter(Boolean),
    brand_raw: brandRaw,
    site_id: brandInfo?.siteId || null,
    platform: brandInfo?.platform || null,
    merchant_name: brandInfo?.merchantName || null,
    start_date: (row[colIdx.start_date] || '').trim(),
    end_date: (row[colIdx.end_date] || '').trim(),
    _brand_unconfigured_note: brandInfo?.note || null,
  });
}

// Build campaign-name → folder URL fallback map.
// When a B-ID has no column D URL, look up others with the same campaign name.
const campaignFolderMap = new Map();
for (const rec of scheduleMap.values()) {
  if (rec.folder_url && rec.campaign) {
    const key = rec.campaign.trim().toLowerCase();
    if (!campaignFolderMap.has(key)) campaignFolderMap.set(key, rec.folder_url);
  }
}

// Initialise Drive client (graceful — fails quietly if API not enabled yet)
let drive = null;
try {
  const { google } = await loadGoogleapis();
  drive = google.drive({ version: 'v3', auth: client.auth });
  // Quick probe to verify Drive API is enabled
  await drive.about.get({ fields: 'user' });
  console.log('[upload-promo] Drive API ✓');
} catch (e) {
  console.warn(`[upload-promo] Drive API unavailable (${e.message.split('\n')[0]}) — doc content will be skipped`);
  drive = null;
}

const results = [];
for (const bId of bIds) {
  const rec = scheduleMap.get(bId);
  if (!rec) {
    results.push({ b_id: bId, status: 'error', reason: `Not found in banner schedule` });
    continue;
  }
  try {
    const r = await uploadBanner(rec, { bannerDir, imageDirOverride, skipContent, promoCodeOverride, dryRun, drive, campaignFolderMap, promoFolderOverride });
    results.push(r);
  } catch (e) {
    console.error(`  [${bId}] ❌ error:`, e.message);
    results.push({ b_id: bId, status: 'error', reason: e.message });
  }
}

console.log('\n═══════════════════ RESULTS ═══════════════════');
for (const r of results) {
  const badge = r.status === 'ok' ? '✅' : r.status === 'dry-run' ? '🔵' : r.status === 'skipped' ? '⚪' : '❌';
  const detail = r.status === 'ok' ? `  code=${r.promoCode}  banner_id=${r.bannerId}` : `  ${r.reason || ''}`;
  console.log(`  ${badge} ${r.b_id}${detail}`);
}

// ── QC bundle writing ─────────────────────────────────────────────────────────
// dry-run  → captures/banner-qc-plans/{b_id}__{site_id}.json   (for /banner-pre-qc)
// --commit → captures/banner-qc-bundles/{b_id}__{site_id}.json (for /banner-deep-qc)
const brandDir = (() => {
  try { return JSON.parse(readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname.slice(1)), '..', 'data', 'brand-directory.json'), 'utf8')); }
  catch { return {}; }
})();

function getBrandWebsite(siteId) {
  const qproM = siteId.match(/^qpro(\d+)$/i);
  if (qproM) return brandDir.qpro?.[`QPRO${qproM[1]}`]?.website || null;
  const qp2Map = { ibc22: 'QP2A', king333: 'QP2B', ace66: 'QP2C', spade66: 'QP2D' };
  const qp2Key = qp2Map[siteId.toLowerCase()];
  if (qp2Key) return brandDir.qp2?.[qp2Key]?.website || null;
  return null;
}

const bundlesWritten = [];
for (const r of results) {
  if (r.status !== 'ok' && r.status !== 'dry-run') continue;
  const isplan = r.status === 'dry-run';
  const dir = path.join(path.dirname(new URL(import.meta.url).pathname.slice(1)), '..', isplan ? 'captures/banner-qc-plans' : 'captures/banner-qc-bundles');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${r.b_id}__${r.site_id}.json`);
  const bundle = isplan
    ? { b_id: r.b_id, site_id: r.site_id, label: r.label, campaign: r.campaign, promo_code: r.promoCode, start_datetime: r.startUtc, end_datetime: r.endUtc, contentIsStub: !!r.contentIsStub, staged_images: r.stagedImages, website: getBrandWebsite(r.site_id), type: 'plan', created_at: new Date().toISOString() }
    : { b_id: r.b_id, site_id: r.site_id, label: r.label, campaign: r.campaign, promo_code: r.promoCode, banner_id: r.bannerId, content_id: r.pcId, start_datetime: r.startUtc, end_datetime: r.endUtc, position: r.bannerPosition, image_rows: r.imageRows, content_details: r.contentDetails || null, contentIsStub: !!r.contentIsStub, website: getBrandWebsite(r.site_id), type: 'saved', created_at: new Date().toISOString() };
  writeFileSync(file, JSON.stringify(bundle, null, 2));
  bundlesWritten.push(file);
}
if (bundlesWritten.length) {
  const label = dryRun ? 'banner-qc-plans' : 'banner-qc-bundles';
  console.log(`\n[qc] ${bundlesWritten.length} bundle(s) written to captures/${label}/`);
  console.log(`[qc] Next: ${dryRun ? 'node bin/upload-promo.js --range=... --commit → /banner-pre-qc' : '/banner-deep-qc'}`);
}

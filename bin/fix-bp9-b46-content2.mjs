// Fix #2 — QPRO1 (BP9) B46 "Mid-Year Spend & Win"
//
//  1. T&C hyperlink: undo over-linking from fix 1; keep ONLY sentence 11
//     "General :brandname <a href>terms and conditions</a> apply."
//
//  2. ZH titles (pc 181 + pc 183): extract from content L1 (first <strong>),
//     strip "BP9 " brand prefix → "年中消费抽奖大放送".
//
//  3. pc_id=183 descriptions: all locales currently "Mid-Year Spend & Win";
//     copy the real description from pc_id=181 per locale
//     (second visible line of each locale's content / tagline).
//
// Run:     node bin/fix-bp9-b46-content2.mjs
// Dry-run: node bin/fix-bp9-b46-content2.mjs --dry-run

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const SITE_ID = 'qpro1';
const MAIN_ID = 181;
const WL_ID   = 183;
const DRY_RUN = process.argv.includes('--dry-run');
const delay   = (ms) => new Promise((r) => setTimeout(r, ms));

const SERVER_FIELDS = new Set(['id', 'promotion_content_id', 'settings_locale_code', 'created_at', 'updated_at']);

// Per-locale T&C URLs (from Directory TNC link tab, QPRO1 rows)
const LOCALE_TNC = {
  MY_EN: 'https://bp9mys.com/en-my/info-center/terms-and-conditions',
  MY_ZH: 'https://bp9mys.com/zh-my/info-center/terms-and-conditions',
  SG_EN: 'https://bp9mys.com/en-sg/info-center/terms-and-conditions',
  SG_ZH: 'https://bp9mys.com/zh-sg/info-center/terms-and-conditions',
  ID_EN: 'https://bp9mys.com/en-id/info-center/terms-and-conditions',
  ID_ID: 'https://bp9mys.com/id-id/info-center/terms-and-conditions',
};

const ZH_TNC_ENTITY = '&#26465;&#27454;&#19982;&#26465;&#20214;'; // 条款与条件

function decodeEntities(str) {
  return (str || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
    .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
    .replace(/&rsquo;/g, '’').replace(/&ldquo;/g, '“').replace(/&rdquo;/g, '”');
}

// Extract title from first <strong>…</strong> in content body, decode, strip "BP9 " prefix
function extractTitleFromContent(content) {
  const m = (content || '').match(/^<strong>([\s\S]*?)<\/strong>/);
  if (!m) return null;
  return decodeEntities(m[1]).replace(/^BP9\s+/, '').trim() || null;
}

// T&C fix — EN: strip all, re-add only sentence 11
function fixTnCLine11EN(content, url) {
  let c = content.replace(/<a[^>]*>terms and conditions<\/a>/gi, 'terms and conditions');
  c = c.replace(
    /General :brandname terms and conditions apply\./gi,
    `General :brandname <a href="${url}">terms and conditions</a> apply.`,
  );
  return c;
}

// T&C fix — ZH: strip all (except <strong> heading), re-add only sentence 11
function fixTnCLine11ZH(content, url) {
  const PLACEHOLDER = '\x00TNC_ZH_HDR\x00';
  let c = content.replace(`<strong>${ZH_TNC_ENTITY}</strong>`, PLACEHOLDER);
  c = c.replace(new RegExp(`<a[^>]*>${ZH_TNC_ENTITY}</a>`, 'g'), ZH_TNC_ENTITY);
  // Only link the "一般条款与条件同样适用" final sentence
  c = c.replace(
    `:brandname &#19968;&#33324;${ZH_TNC_ENTITY}&#21516;&#26679;&#36866;&#29992;&#12290;`,
    `:brandname &#19968;&#33324;<a href="${url}">${ZH_TNC_ENTITY}</a>&#21516;&#26679;&#36866;&#29992;&#12290;`,
  );
  return c.replace(PLACEHOLDER, `<strong>${ZH_TNC_ENTITY}</strong>`);
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

function cleanCopy(details) {
  const out = {};
  for (const [k, d] of Object.entries(details)) {
    if (!d) { out[k] = d; continue; }
    out[k] = Object.fromEntries(Object.entries(d).filter(([f]) => !SERVER_FIELDS.has(f)));
  }
  return out;
}

console.log(`[fix-bp9-b46-2] site=${SITE_ID}  dry=${DRY_RUN}\n`);
const site = getSite(SITE_ID);

// ── Fetch both records upfront ────────────────────────────────────────────────
const mainRes   = await authedFetch(site, `/api/bo/promotioncontent/${MAIN_ID}`);
const mainCont  = mainRes?.data?.content;
const mainDets  = JSON.parse(JSON.stringify(mainRes?.data?.details || {}));

const wlRes     = await authedFetch(site, `/api/bo/promotioncontent/${WL_ID}`);
const wlCont    = wlRes?.data?.content;
const wlDets    = JSON.parse(JSON.stringify(wlRes?.data?.details || {}));

// ── pc_id=181: T&C (line 11 only) + ZH titles ────────────────────────────────
console.log(`── pc_id=${MAIN_ID} (EVEJ2PWLBMMD) ──`);
{
  let changed = 0;
  for (const [locId, d] of Object.entries(mainDets)) {
    if (!d?.settings_locale_id) continue;
    const code  = d.settings_locale_code;
    const url   = LOCALE_TNC[code];
    const isZh  = code?.endsWith('_ZH');

    let newContent = d.content || '';
    let newTitle   = d.title;
    let contentChanged = false;
    let titleChanged   = false;

    // T&C: re-apply line-11-only rule
    if (d.content && url) {
      const fixed = isZh ? fixTnCLine11ZH(d.content, url) : fixTnCLine11EN(d.content, url);
      if (fixed !== d.content) { newContent = fixed; contentChanged = true; }
    }

    // ZH title: extract from content L1, strip "BP9 " prefix
    if (isZh) {
      const extracted = extractTitleFromContent(d.content || '');
      if (extracted && extracted !== d.title) {
        newTitle = extracted;
        titleChanged = true;
      }
    }

    if (contentChanged || titleChanged) {
      console.log(`  [${code}] T&C changed=${contentChanged}  title: "${d.title}" → "${newTitle}"`);
      mainDets[locId].content = newContent;
      mainDets[locId].title   = newTitle;
      changed++;
    } else {
      console.log(`  [${code}] no changes`);
    }
  }

  if (!changed) {
    console.log('  nothing to update\n');
  } else if (DRY_RUN) {
    console.log(`  [DRY-RUN] would PUT (${changed} locale(s))\n`);
  } else {
    await delay(1500);
    const r = await authedFetch(site, `/api/bo/promotioncontent/${MAIN_ID}`, {
      method: 'PUT', body: buildPutBody(mainCont, cleanCopy(mainDets)),
    });
    const ok = r?.success !== false;
    console.log(`  PUT ${ok ? '✅ OK' : '❌ FAILED'} — ${JSON.stringify(r?.message || r?.errors || '')}\n`);
  }
}

// ── pc_id=183: ZH titles + all descriptions from pc_id=181 ───────────────────
console.log(`── pc_id=${WL_ID} (EVEJ2PWLBMMDW2) ──`);
{
  let changed = 0;
  for (const [locId, d] of Object.entries(wlDets)) {
    if (!d?.settings_locale_id) continue;
    const code  = d.settings_locale_code;
    const isZh  = code?.endsWith('_ZH');

    // Source title/description from pc_id=181 for this locale
    const src = mainDets[locId];  // same locId key in both records

    let newTitle = d.title;
    let newDesc  = d.description;
    let changed_ = false;

    // ZH title: use extracted ZH title (already updated in mainDets above)
    if (isZh && src?.title && src.title !== d.title) {
      newTitle  = src.title;
      changed_  = true;
    }

    // Description: copy from pc_id=181 per locale
    if (src?.description && src.description !== d.description) {
      newDesc  = src.description;
      changed_ = true;
    }

    if (changed_) {
      console.log(`  [${code}] title: "${d.title}" → "${newTitle}"`);
      console.log(`         desc:  "${d.description}" → "${newDesc}"`);
      wlDets[locId].title       = newTitle;
      wlDets[locId].description = newDesc;
      changed++;
    } else {
      console.log(`  [${code}] no changes`);
    }
  }

  if (!changed) {
    console.log('  nothing to update\n');
  } else if (DRY_RUN) {
    console.log(`  [DRY-RUN] would PUT (${changed} locale(s))\n`);
  } else {
    await delay(1500);
    const r = await authedFetch(site, `/api/bo/promotioncontent/${WL_ID}`, {
      method: 'PUT', body: buildPutBody(wlCont, cleanCopy(wlDets)),
    });
    const ok = r?.success !== false;
    console.log(`  PUT ${ok ? '✅ OK' : '❌ FAILED'} — ${JSON.stringify(r?.message || r?.errors || '')}\n`);
  }
}

console.log('═══════════════════ DONE ═══════════════════');
if (DRY_RUN) console.log('  (dry-run — no changes made)');

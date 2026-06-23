// Fix #4 — QPRO1 (BP9) B46 "Mid-Year Spend & Win"
//
//  1. EN locales (MY_EN, SG_EN, ID_EN): prepend missing intro section
//     (body paragraph + prizes table + <hr>) before "Promotion Details".
//     Extracted from ID_ID which has the full structure.
//
//  2. All locales: fix numbered list restart after deposit table.
//     Post-table items labeled 1/2 should be 3/4.
//
// Run:     node bin/fix-bp9-b46-content4.mjs
// Dry-run: node bin/fix-bp9-b46-content4.mjs --dry-run

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const SITE_ID = 'qpro1';
const PC_ID   = 181;
const DRY_RUN = process.argv.includes('--dry-run');
const delay   = (ms) => new Promise((r) => setTimeout(r, ms));

const SERVER_FIELDS = new Set(['id', 'promotion_content_id', 'settings_locale_code', 'created_at', 'updated_at']);

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

// Extract intro section from ID_ID content (body intro + prizes table + <hr>).
// ID_ID structure: <strong>title</strong><br><br>tagline<br><br>body<br><br>table<br><br><hr><br><br><strong>Promotion Details</strong>...
// Skip first 2 segments (title + tagline), take everything up to "Promotion Details".
function extractIntroFromIdId(idIdContent) {
  const detailsMarker = '<strong>Promotion Details</strong>';
  const idx = idIdContent.indexOf(detailsMarker);
  if (idx === -1) return null;
  const before = idIdContent.slice(0, idx);   // ends with <br><br>
  const segs   = before.split('<br><br>');
  // segs[0]=title, segs[1]=tagline, segs[2]=body intro, segs[3]=table, segs[4]=<hr>, segs[5]=''
  return segs.slice(2).join('<br><br>');       // body<br><br>table<br><br><hr><br><br>
}

// Fix numbered list: items 1/2 that appear after the deposit-example table should be 3/4.
// EN pattern (exact strings from Drive doc):
const EN_ITEM3_OLD = '<br><br>1. The more tickets you collect, the higher your chances of being drawn as a lucky winner.';
const EN_ITEM3_NEW = '<br><br>3. The more tickets you collect, the higher your chances of being drawn as a lucky winner.';
const EN_ITEM4_OLD = '<br><br>2. Lucky winners will be contacted by our Promotion team after the event ends.';
const EN_ITEM4_NEW = '<br><br>4. Lucky winners will be contacted by our Promotion team after the event ends.';

// ZH pattern (entity-encoded):
const ZH_ITEM3_OLD = '<br><br>1. &#25277;&#22870;&#21048;&#36234;&#22810;&#65292;&#34987;&#25277;&#20013;&#30340;&#20960;&#29575;&#36234;&#39640;&#12290;';
const ZH_ITEM3_NEW = '<br><br>3. &#25277;&#22870;&#21048;&#36234;&#22810;&#65292;&#34987;&#25277;&#20013;&#30340;&#20960;&#29575;&#36234;&#39640;&#12290;';
const ZH_ITEM4_OLD = '<br><br>2. &#27963;&#21160;&#32467;&#26463;&#21518;&#65292;&#24184;&#36816;&#24471;&#20027;&#23558;&#30001;&#25105;&#20204;&#30340;&#20419;&#38144;&#22242;&#38431;&#32852;&#32476;&#12290;';
const ZH_ITEM4_NEW = '<br><br>4. &#27963;&#21160;&#32467;&#26463;&#21518;&#65292;&#24184;&#36816;&#24471;&#20027;&#23558;&#30001;&#25105;&#20204;&#30340;&#20419;&#38144;&#22242;&#38431;&#32852;&#32476;&#12290;';

console.log(`[fix-bp9-b46-4] site=${SITE_ID}  dry=${DRY_RUN}\n`);
const site = getSite(SITE_ID);

const res     = await authedFetch(site, `/api/bo/promotioncontent/${PC_ID}`);
const content = res?.data?.content;
const details = JSON.parse(JSON.stringify(res?.data?.details || {}));

// Grab intro section from ID_ID
const idIdLocale = Object.values(details).find((d) => d?.settings_locale_code === 'ID_ID');
const introEN = idIdLocale ? extractIntroFromIdId(idIdLocale.content || '') : null;
if (!introEN) throw new Error('Could not extract intro section from ID_ID content');
console.log('Intro section extracted from ID_ID (first 120 chars):', introEN.slice(0, 120));

let changed = 0;
for (const [locId, d] of Object.entries(details)) {
  if (!d?.settings_locale_id) continue;
  const code = d.settings_locale_code;
  const isZh = code?.endsWith('_ZH');
  const isEn = code?.endsWith('_EN');
  const isIdId = code === 'ID_ID';

  let c = d.content || '';
  let log = [];

  // ── 1. Prepend intro section to EN locales ─────────────────────────────────
  if (isEn) {
    const marker = '<strong>Promotion Details</strong>';
    if (c.startsWith(marker)) {
      c = introEN + marker + c.slice(marker.length);
      log.push('intro prepended');
    } else {
      log.push('intro: already has intro or unexpected structure — skipped');
    }
  }

  // ── 2. Fix numbered list (1→3, 2→4 post-table) ────────────────────────────
  if (isEn || isIdId) {
    const c2 = c.replace(EN_ITEM3_OLD, EN_ITEM3_NEW).replace(EN_ITEM4_OLD, EN_ITEM4_NEW);
    if (c2 !== c) { c = c2; log.push('numbered list 1→3, 2→4'); }
    else { log.push('numbered list: no match (already fixed or different text)'); }
  }
  if (isZh) {
    const c2 = c.replace(ZH_ITEM3_OLD, ZH_ITEM3_NEW).replace(ZH_ITEM4_OLD, ZH_ITEM4_NEW);
    if (c2 !== c) { c = c2; log.push('numbered list 1→3, 2→4 (ZH)'); }
    else { log.push('numbered list ZH: no match (already fixed or different text)'); }
  }

  if (c !== d.content) {
    console.log(`  [${code}] ${log.join(' | ')}`);
    details[locId].content = c;
    changed++;
  } else {
    console.log(`  [${code}] no changes (${log.join(', ')})`);
  }
}

if (!changed) {
  console.log('\nNothing to update.');
} else if (DRY_RUN) {
  console.log(`\n[DRY-RUN] would PUT (${changed} locale(s))`);
} else {
  await delay(1500);
  const r = await authedFetch(site, `/api/bo/promotioncontent/${PC_ID}`, {
    method: 'PUT', body: buildPutBody(content, cleanCopy(details)),
  });
  const ok = r?.success !== false;
  console.log(`\nPUT ${ok ? '✅ OK' : '❌ FAILED'} — ${JSON.stringify(r?.message || r?.errors || '')}`);
}

console.log('\n═══════════════════ DONE ═══════════════════');
if (DRY_RUN) console.log('  (dry-run — no changes made)');

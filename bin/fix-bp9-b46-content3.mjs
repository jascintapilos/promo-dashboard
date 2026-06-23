// Fix #3 — QPRO1 (BP9) B46 "Mid-Year Spend & Win"
//
//  Decode HTML entities in description fields for all locales in
//  both pc_id=181 (EVEJ2PWLBMMD) and pc_id=183 (EVEJ2PWLBMMDW2).
//
//  The fetchDocHtml pipeline stored raw HTML entities (e.g. &mdash; &ndash; &#NNNNN;)
//  in description fields. BO renders them as literal text rather than decoded chars.
//
// Run:     node bin/fix-bp9-b46-content3.mjs
// Dry-run: node bin/fix-bp9-b46-content3.mjs --dry-run

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const SITE_ID = 'qpro1';
const MAIN_ID = 181;
const WL_ID   = 183;
const DRY_RUN = process.argv.includes('--dry-run');
const delay   = (ms) => new Promise((r) => setTimeout(r, ms));

const SERVER_FIELDS = new Set(['id', 'promotion_content_id', 'settings_locale_code', 'created_at', 'updated_at']);

function decodeEntities(str) {
  if (!str) return str;
  return str
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&mdash;/g,  '—')
    .replace(/&ndash;/g,  '–')
    .replace(/&amp;/g,    '&')
    .replace(/&nbsp;/g,   ' ')
    .replace(/&rsquo;/g,  '’')
    .replace(/&lsquo;/g,  '‘')
    .replace(/&ldquo;/g,  '“')
    .replace(/&rdquo;/g,  '”')
    .replace(/&lt;/g,     '<')
    .replace(/&gt;/g,     '>');
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

async function fixDescriptions(label, pcId, site) {
  console.log(`\n── pc_id=${pcId} (${label}) ──`);
  const res     = await authedFetch(site, `/api/bo/promotioncontent/${pcId}`);
  const content = res?.data?.content;
  const details = JSON.parse(JSON.stringify(res?.data?.details || {}));

  if (!content) throw new Error(`Failed to fetch pc ${pcId}: ${JSON.stringify(res)}`);

  let changed = 0;
  for (const [locId, d] of Object.entries(details)) {
    if (!d?.settings_locale_id) continue;
    const code    = d.settings_locale_code;
    const raw     = d.description || '';
    const decoded = decodeEntities(raw);
    if (decoded === raw) {
      console.log(`  [${code}] description unchanged`);
    } else {
      console.log(`  [${code}] "${raw}" → "${decoded}"`);
      details[locId].description = decoded;
      changed++;
    }
  }

  if (!changed) {
    console.log('  nothing to update');
    return;
  }
  if (DRY_RUN) {
    console.log(`  [DRY-RUN] would PUT (${changed} locale(s))`);
    return;
  }

  await delay(1500);
  const r = await authedFetch(site, `/api/bo/promotioncontent/${pcId}`, {
    method: 'PUT', body: buildPutBody(content, cleanCopy(details)),
  });
  const ok = r?.success !== false;
  console.log(`  PUT ${ok ? '✅ OK' : '❌ FAILED'} — ${JSON.stringify(r?.message || r?.errors || '')}`);
}

console.log(`[fix-bp9-b46-3] site=${SITE_ID}  dry=${DRY_RUN}`);
const site = getSite(SITE_ID);

await fixDescriptions('EVEJ2PWLBMMD',  MAIN_ID, site);
await fixDescriptions('EVEJ2PWLBMMDW2', WL_ID,  site);

console.log('\n═══════════════════ DONE ═══════════════════');
if (DRY_RUN) console.log('  (dry-run — no changes made)');

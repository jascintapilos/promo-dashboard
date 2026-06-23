// Fix "GOOSS 0" → "Gates of Olympus Super Scatter" in MT and dialog popup
// content for promos 1032-1037.
//
// Usage:
//   node bin/fix-gooss-game-name.mjs          # dry run
//   node bin/fix-gooss-game-name.mjs --commit  # live

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const DRY_RUN = !process.argv.includes('--commit');
if (DRY_RUN) console.log('[DRY RUN] Pass --commit to execute\n');

const s = getSite('qpro1');
function toMysql(iso) {
  if (!iso) return iso;
  return String(iso).replace('T', ' ').replace(/\.\d+Z$/, '').replace('Z', '');
}

const FROM = 'GOOSS 0';
const TO   = 'Gates of Olympus Super Scatter';

const MT_IDS = [1024, 1025, 1026, 1027, 1028, 1029];
const POPUP_IDS = [561, 562, 563, 564, 565, 566];

function fix(str) {
  return str ? str.split(FROM).join(TO) : str;
}

// ── MT fixes ──────────────────────────────────────────────────────────────
console.log('\n=== Message Templates ===');
let mtOk = 0, mtErr = 0;

for (const mtId of MT_IDS) {
  const r = await authedFetch(s, `/api/bo/messagetemplate/${mtId}`);
  const data = r?.data?.rows ?? r?.data;
  const tmpl = data?.message_template;
  const details = data?.message_details;
  if (!tmpl || !details) { console.log(`MT ${mtId}: not found`); mtErr++; continue; }

  // Check if fix needed
  const hasIssue = Object.values(details).some(d => String(d?.message || '').includes(FROM));
  console.log(`MT ${mtId} (${tmpl.name}): ${hasIssue ? 'NEEDS FIX' : 'ok'}`);
  if (!hasIssue) { mtOk++; continue; }

  // Build fixed details object
  const fixedDetails = {};
  for (const [k, d] of Object.entries(details)) {
    fixedDetails[k] = {
      id: d.id,
      settings_locale_id: d.settings_locale_id,
      subject: d.subject,
      message: fix(d.message),
    };
  }

  if (DRY_RUN) {
    for (const [k, d] of Object.entries(fixedDetails)) {
      const before = details[k]?.message?.match(/GOOSS 0/g)?.length || 0;
      console.log(`  [DRY] locale ${k}: ${before} occurrence(s) fixed`);
    }
    mtOk++;
    continue;
  }

  const putBody = {
    id: tmpl.id,
    code: tmpl.code,
    name: tmpl.name,
    section: tmpl.section,
    type: tmpl.type,
    status: tmpl.status,
    details: fixedDetails,
  };

  const res = await authedFetch(s, `/api/bo/messagetemplate/${mtId}`, { method: 'PUT', body: putBody });
  if (res?.success) {
    console.log(`  ✓ MT ${mtId} fixed`);
    mtOk++;
  } else {
    console.log(`  ✗ MT ${mtId} failed: ${JSON.stringify(res).slice(0, 150)}`);
    mtErr++;
  }
}

// ── Dialog popup fixes ─────────────────────────────────────────────────────
console.log('\n=== Dialog Popups ===');
let popOk = 0, popErr = 0;

// Fetch popup list (all 561-566 should be on page 1)
const listR = await authedFetch(s, '/api/bo/popups?per_page=100&page=1');
const allPopups = listR?.data?.rows || [];

for (const popupId of POPUP_IDS) {
  const popup = allPopups.find(p => p.id === popupId);
  if (!popup) { console.log(`Popup ${popupId}: not in list`); popErr++; continue; }

  const contents = popup.contents;
  const contVals = typeof contents === 'object' && !Array.isArray(contents)
    ? Object.values(contents) : (contents || []);

  const hasIssue = contVals.some(c => String(c?.content || '').includes(FROM));
  console.log(`Popup ${popupId} (${popup.code}): ${hasIssue ? 'NEEDS FIX' : 'ok'}`);
  if (!hasIssue) { popOk++; continue; }

  const fixedContents = {};
  for (const c of contVals) {
    fixedContents[String(c.locale_id)] = {
      id: c.id,
      locale_id: c.locale_id,
      title: c.title,
      content: fix(c.content),
      raw_content: fix(c.raw_content),
      media_type: c.media_type,
      desktop_link: c.desktop_link,
      mobile_link: c.mobile_link,
      video_mobile_link: c.video_mobile_link ?? null,
      video_desktop_link: c.video_desktop_link ?? null,
      cta_button_type: c.cta_button_type,
      cta_button_text_1: c.cta_button_text_1,
      cta_button_link_1: c.cta_button_link_1,
      cta_button_text_2: c.cta_button_text_2,
      cta_button_link_2: c.cta_button_link_2,
    };
  }

  if (DRY_RUN) {
    for (const c of contVals) {
      const n = (c.content?.match(/GOOSS 0/g) || []).length;
      console.log(`  [DRY] locale ${c.locale_id}: ${n} occurrence(s) fixed`);
    }
    popOk++;
    continue;
  }

  const putBody = {
    id: popup.id,
    platform: popup.platform,
    start_date: toMysql(popup.start_date),
    session: popup.session,
    position: popup.position,
    status: popup.status,
    location: popup.location,
    affiliates_visibility: popup.affiliates_visibility,
    always_pop: popup.always_pop,
    label: popup.label,
    contents: fixedContents,
  };

  const res = await authedFetch(s, `/api/bo/popups/${popupId}`, { method: 'PUT', body: putBody });
  if (res?.success) {
    console.log(`  ✓ Popup ${popupId} fixed`);
    popOk++;
  } else {
    console.log(`  ✗ Popup ${popupId} failed: ${JSON.stringify(res).slice(0, 150)}`);
    popErr++;
  }
}

console.log(`\nSummary: MT ${mtOk} ok, ${mtErr} err | Popup ${popOk} ok, ${popErr} err`);

#!/usr/bin/env node
// Fix bare "Exclusive Offer" titles on qpro3/4/10 — update MT subjects + popup
// labels + per-locale popup titles + popup content references.
//
// Canonical titles sourced from qpro5 (per code, per locale).
// Affected: 8 codes × 3 brands = 24 MT updates + up to 24 popup updates.
//
// Per code we update:
//   1. MT subject (MY_EN + MY_ZH) — preserves message body
//   2. Popup label (= MY_EN title)
//   3. Per-locale popup title (MY_EN, MY_ZH, SG_EN, SG_ZH)
//   4. Popup content — string-replace "Exclusive Offer" → titleEn (MY_EN/SG_EN)
//      and "独家优惠" → titleZh (MY_ZH/SG_ZH)
//
// Idempotent: only touches codes whose current MY_EN subject is "Exclusive Offer"
// or whose current MY_ZH subject is "独家优惠".

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const TARGETS = ['qpro3', 'qpro4', 'qpro10'];
const CANONICAL = 'qpro5';
const CODES = [
  'FT_REL_TLEO_20PCT_200MX','FT_REL_TLEO_20PCT_20MX_BR','FT_REL_TLEO_45PCT_138MX','FT_REL_TLEO_45PCT_48MX',
  'FT_REL_TLEO_45PCT_888MX','FT_REL_TLEO_50PCT_25MX_LC','FT_REL_TLEO_50PCT_25MX_SLOT',
  'FT_REL_TLEO_LC_20PCT_20MX_BR','FT_REL_TLEO_LC_45PCT_138MX','FT_REL_TLEO_LC_45PCT_48MX','REL_TLEO_SL_20PCT_10MX',
];
const DRY = process.argv.includes('--dry-run');
const CANARY = process.argv.includes('--canary');
if (DRY) console.log('*** DRY RUN ***\n');
if (CANARY) console.log('*** CANARY (qpro3 + 1 code) ***\n');

const sleep = ms => new Promise(r => setTimeout(r, ms));

// 1) Load qpro5 canonical: code -> {1: subj, 3: subj, 6: subj, 7: subj}
const csite = getSite(CANONICAL);
const canon = {};
for (const code of CODES) {
  const lr = await authedFetch(csite, `/api/bo/promotion?code=${code}&perPage=5`);
  const lp = Object.values(lr.data?.rows || {}).find(p => p.code === code);
  if (!lp?.message_template_id) { canon[code] = null; continue; }
  const im = await authedFetch(csite, `/api/bo/messagetemplate/${lp.message_template_id}`);
  const subjByLid = {};
  for (const d of Object.values(im.data?.message_details || {})) {
    subjByLid[Number(d.settings_locale_id)] = d.subject || '';
  }
  canon[code] = subjByLid;
}
console.log(`Loaded canonical for ${Object.values(canon).filter(Boolean).length}/${CODES.length} codes\n`);

const brands = CANARY ? ['qpro3'] : TARGETS;
let mtOk = 0, mtSkip = 0, mtFail = 0, popOk = 0, popSkip = 0, popFail = 0;
const failures = [];

for (const brand of brands) {
  const site = getSite(brand);
  console.log(`\n━━━ ${brand.toUpperCase()} ━━━`);
  // load brand popups by label (= original MT subject)
  const popByLabel = new Map();
  const popById = new Map();
  for (let pg = 1; pg <= 6; pg++) {
    const pr = await authedFetch(site, `/api/bo/popups?perPage=300&page=${pg}`);
    const arr = Object.values(pr.data?.rows || {});
    if (!arr.length) break;
    for (const p of arr) { if (p.label) popByLabel.set(p.label, p); popById.set(p.id, p); }
    if (arr.length < 300) break;
  }
  let codes = CODES;
  if (CANARY) codes = ['FT_REL_TLEO_20PCT_200MX'];

  for (const code of codes) {
    const can = canon[code]; if (!can) { console.log(`  ⊘ ${code}: no canonical`); continue; }
    const lr = await authedFetch(site, `/api/bo/promotion?code=${code}&perPage=5`);
    const lp = Object.values(lr.data?.rows || {}).find(p => p.code === code);
    if (!lp?.message_template_id) { console.log(`  ⊘ ${code}: no MT id`); continue; }

    // === Step A: fix MT subjects ===
    const im = await authedFetch(site, `/api/bo/messagetemplate/${lp.message_template_id}`);
    const meta = im.data?.message_template || im.data;
    const cur = im.data?.message_details || {};
    const newDetails = {};
    let mtDirty = false;
    // SG locales fallback to MY canonical (qpro5 is MYR-only so can[6]/can[7] often missing)
    const enCanon = can[1];
    const zhCanon = can[3];
    for (const d of Object.values(cur)) {
      const lid = Number(d.settings_locale_id);
      let wanted = can[lid];
      if (!wanted) { wanted = (lid === 6) ? enCanon : (lid === 7) ? zhCanon : null; }
      let subj = d.subject || '';
      if (wanted && subj !== wanted && (subj === 'Exclusive Offer' || subj === '独家优惠')) {
        subj = wanted; mtDirty = true;
      }
      newDetails[lid] = { settings_locale_id: lid, subject: subj, message: d.message || '' };
    }
    if (mtDirty) {
      if (DRY) { console.log(`  DRY MT ${code} mt=${lp.message_template_id}`); mtOk++; }
      else {
        try {
          await authedFetch(site, `/api/bo/messagetemplate/${lp.message_template_id}`, {
            method: 'PUT',
            body: { name: meta.name, code: meta.code, section: Number(meta.section), type: Number(meta.type), status: Number(meta.status) || 1, details: newDetails },
          });
          await sleep(120);
          mtOk++;
        } catch (e) { console.log(`  ✗ MT ${code}: ${e.message.split('\n')[0]}`); mtFail++; failures.push(`MT ${brand} ${code}: ${e.message.split('\n')[0]}`); }
      }
    } else { mtSkip++; }

    // === Step B: fix popup (label + per-locale title + content) ===
    // popup is linked via dialog_popup_list; pull popup_id from list-row
    const link = Array.isArray(lp.dialog_popup_list) ? lp.dialog_popup_list[0] : null;
    if (!link?.popup_id) { console.log(`  ⊘ ${code}: no linked popup`); popSkip++; continue; }
    const pop = popById.get(link.popup_id);
    if (!pop) { console.log(`  ⊘ ${code}: popup ${link.popup_id} not in catalog`); popSkip++; continue; }

    // Build new contents object
    const titleEn = can[1] || pop.label;
    const titleZh = can[3] || titleEn;
    const titleEnSg = can[6] || titleEn;
    const titleZhSg = can[7] || titleZh;
    const newLabel = titleEn;
    let popDirty = pop.label === 'Exclusive Offer' || pop.label !== titleEn;
    const contentsObj = {};
    for (const c of pop.contents || []) {
      const lid = Number(c.locale_id);
      let newTitle = c.title, newContent = c.content;
      if (lid === 1) {
        if (c.title === 'Exclusive Offer' || c.title !== titleEn) { newTitle = titleEn; popDirty = true; }
        if (/Exclusive Offer/.test(c.content || '')) { newContent = c.content.replaceAll('Exclusive Offer', titleEn); popDirty = true; }
      } else if (lid === 3) {
        if (c.title === '独家优惠' || c.title !== titleZh) { newTitle = titleZh; popDirty = true; }
        if (/独家优惠/.test(c.content || '')) { newContent = c.content.replaceAll('独家优惠', titleZh); popDirty = true; }
      } else if (lid === 6) {
        if (c.title === 'Exclusive Offer' || c.title !== titleEnSg) { newTitle = titleEnSg; popDirty = true; }
        if (/Exclusive Offer/.test(c.content || '')) { newContent = c.content.replaceAll('Exclusive Offer', titleEnSg); popDirty = true; }
      } else if (lid === 7) {
        if (c.title === '独家优惠' || c.title !== titleZhSg) { newTitle = titleZhSg; popDirty = true; }
        if (/独家优惠/.test(c.content || '')) { newContent = c.content.replaceAll('独家优惠', titleZhSg); popDirty = true; }
      }
      contentsObj[String(lid)] = {
        id: c.id, locale_id: lid, title: newTitle, content: newContent,
        media_type: c.media_type, mobile_link: c.mobile_link, desktop_link: c.desktop_link,
        video_mobile_link: c.video_mobile_link ?? null, video_desktop_link: c.video_desktop_link ?? null,
        cta_button_type: c.cta_button_type,
        cta_button_text_1: c.cta_button_text_1, cta_button_link_1: c.cta_button_link_1,
        cta_button_text_2: c.cta_button_text_2, cta_button_link_2: c.cta_button_link_2,
      };
    }
    if (!popDirty) { popSkip++; console.log(`  ⊘ popup ${pop.id}: already canonical`); continue; }
    const body = {
      platform: pop.platform, start_date: String(pop.start_date).replace('T',' ').replace(/\.\d+Z?$/,''),
      end_date: pop.end_date, session: pop.session, position: pop.position,
      status: pop.status, location: pop.location, affiliates_visibility: pop.affiliates_visibility,
      always_pop: pop.always_pop, label: newLabel, contents: contentsObj,
    };
    if (DRY) { console.log(`  DRY popup ${pop.id} → label="${newLabel}"`); popOk++; continue; }
    try {
      await authedFetch(site, `/api/bo/popups/${pop.id}`, { method: 'PUT', body });
      await sleep(120);
      console.log(`  ✓ ${code} (mt=${lp.message_template_id}, pop=${pop.id}) → "${newLabel}"`);
      popOk++;
    } catch (e) { console.log(`  ✗ popup ${pop.id}: ${e.message.split('\n')[0]}`); popFail++; failures.push(`POP ${brand} ${code}: ${e.message.split('\n')[0]}`); }
  }
}

console.log(`\n=== SUMMARY ===`);
console.log(`  MT updates: ok=${mtOk} skip=${mtSkip} fail=${mtFail}`);
console.log(`  Popup updates: ok=${popOk} skip=${popSkip} fail=${popFail}`);
if (failures.length) failures.forEach(f => console.log('  ' + f));

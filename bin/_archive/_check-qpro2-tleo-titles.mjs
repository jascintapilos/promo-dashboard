#!/usr/bin/env node
// Check qpro2 for the two failure modes seen on qpro3/4/10:
//   (A) TLEO promos missing popup link
//   (B) MT subjects bare ("Exclusive Offer" / "独家优惠")
// Reports per-code status. No writes.
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const BRAND = 'qpro2';
const site = getSite(BRAND);
const hasPopup = p => { const d = p.dialog_popup_list; return Array.isArray(d) ? d.length > 0 : (d && Object.keys(d || {}).length > 0); };

// Load all TLEO codes on qpro2
const r = await authedFetch(site, '/api/bo/promotion?code=TLEO&perPage=200&page=1');
const tleo = Object.values(r.data?.rows || {}).filter(p => p.code?.includes('TLEO'));
console.log(`Loaded ${tleo.length} TLEO codes on ${BRAND}`);

// Load popups for cross-check (label-based)
const labelToPopup = new Map();
for (let pg = 1; pg <= 6; pg++) {
  const pr = await authedFetch(site, `/api/bo/popups?perPage=300&page=${pg}`);
  const arr = Object.values(pr.data?.rows || {});
  if (!arr.length) break;
  arr.forEach(p => { if (p.label) labelToPopup.set(p.label, p); });
  if (arr.length < 300) break;
}
console.log(`Loaded ${labelToPopup.size} popups (by label)\n`);

const issues = { noPopup: [], noPopupRecord: [], bareMtMyEn: [], bareMtMyZh: [], barePopupLabel: [] };

for (const p of tleo) {
  // (A) popup link / record
  const popup = hasPopup(p);
  if (!popup) {
    const popRec = labelToPopup.get(p.code);
    if (popRec) issues.noPopup.push({ code: p.code, popup_id: popRec.id });
    else issues.noPopupRecord.push(p.code);
  }
  // (B) MT subject bare
  if (p.message_template_id > 0) {
    try {
      const im = await authedFetch(site, `/api/bo/messagetemplate/${p.message_template_id}`);
      for (const d of Object.values(im.data?.message_details || {})) {
        const lid = Number(d.settings_locale_id);
        const subj = String(d.subject || '');
        if (lid === 1 && subj === 'Exclusive Offer') issues.bareMtMyEn.push(`${p.code} (mt=${p.message_template_id})`);
        if (lid === 3 && subj === '独家优惠') issues.bareMtMyZh.push(`${p.code} (mt=${p.message_template_id})`);
      }
    } catch (e) { /* skip */ }
  }
}

// Also check linked popup labels for bare titles
for (const p of tleo) {
  const link = Array.isArray(p.dialog_popup_list) ? p.dialog_popup_list[0] : null;
  if (!link?.popup_id) continue;
  // re-find popup by id since labelToPopup map is by label
  const all = [...labelToPopup.values()];
  const pop = all.find(x => x.id === link.popup_id);
  if (pop && (pop.label === 'Exclusive Offer' || pop.label === '独家优惠')) {
    issues.barePopupLabel.push(`${p.code} → pop ${pop.id} label="${pop.label}"`);
  }
}

console.log('━━━ ISSUE REPORT for qpro2 ━━━');
console.log(`Total TLEO: ${tleo.length}`);
console.log(`(A) Popup unlinked (record exists): ${issues.noPopup.length}`);
if (issues.noPopup.length) issues.noPopup.forEach(i => console.log(`   ⚠ ${i.code} (popup ${i.popup_id} exists)`));
console.log(`(A') Popup record missing entirely: ${issues.noPopupRecord.length}`);
if (issues.noPopupRecord.length) issues.noPopupRecord.forEach(c => console.log(`   ✗ ${c}`));
console.log(`(B) MT MY_EN subject = bare "Exclusive Offer": ${issues.bareMtMyEn.length}`);
if (issues.bareMtMyEn.length) issues.bareMtMyEn.forEach(c => console.log(`   ⚠ ${c}`));
console.log(`(B') MT MY_ZH subject = bare "独家优惠": ${issues.bareMtMyZh.length}`);
if (issues.bareMtMyZh.length) issues.bareMtMyZh.forEach(c => console.log(`   ⚠ ${c}`));
console.log(`(C) Linked popup label is bare: ${issues.barePopupLabel.length}`);
if (issues.barePopupLabel.length) issues.barePopupLabel.forEach(c => console.log(`   ⚠ ${c}`));

const clean = !issues.noPopup.length && !issues.noPopupRecord.length && !issues.bareMtMyEn.length && !issues.bareMtMyZh.length && !issues.barePopupLabel.length;
console.log(`\n${clean ? '✓ qpro2 CLEAN — no issues found' : '⚠ qpro2 has issues — see above'}`);

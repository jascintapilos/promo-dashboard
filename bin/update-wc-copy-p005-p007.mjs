#!/usr/bin/env node
// Update World Cup FC copy (P005-P007) so it reads "ongoing" not "just started".
// Changes ONLY: MT subject + MT body opening sentence, and dialog popup title.
// Everything else (How-to-Redeem, T&C, popup body) is preserved verbatim.
// Uses the proven GET->patch->PUT pattern from bin/apply-copy-generator-p001-p008.mjs.
//
//   node bin/update-wc-copy-p005-p007.mjs            ← dry-run (shows before→after)
//   node bin/update-wc-copy-p005-p007.mjs --commit   ← live
import { authedFetch, findPromotionByCode } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const commit = process.argv.includes('--commit');

const TARGETS = [
  { handle: 'P005', amt: 100, code: 'VIP_100FC_5x_SPRTS' },
  { handle: 'P006', amt: 160, code: 'VIP_160FC_5x_SPRTS' },
  { handle: 'P007', amt: 250, code: 'VIP_250FC_5x_SPRTS' },
];
const BRANDS = [
  { brand: 'QP2D', siteId: 'ibc22', platform: 'qp2' },
  { brand: 'QPRO2', siteId: 'qpro2', platform: 'qpro' },
];

// New copy (approved). {AMT} filled per target.
const subjectEN = (a) => `⚽ World Cup Free Bet — ${a} Free Credits`;
const subjectZH = (a) => `⚽ 世界杯免费投注 — ${a} 免费体验金`;
const titleEN   = (a) => `⚽ World Cup Free Bet — ${a} Free Bet Credits!`;
const titleZH   = (a) => `⚽ 世界杯免费投注 — ${a}免费体验金！`;
// Body opening sentence replacement (only the first sentence changes).
const BODY_EN = ['The World Cup is here, and the excitement is contagious!', 'The World Cup is in full swing, and the excitement is contagious!'];
const BODY_ZH = ['世界杯盛宴正式开踢，激情满满！', '世界杯激战正酣，激情满满！'];

const ZH_LOCALES = new Set([3, 7]);        // MY_ZH, SG_ZH
const toBoDate = (iso) => (iso ? String(iso).replace('T', ' ').replace(/\.\d+Z?$/, '').replace(/Z$/, '') : iso);

let ok = 0, fail = 0, warn = 0;

for (const t of TARGETS) {
  for (const b of BRANDS) {
    const site = getSite(b.siteId);
    console.log(`\n── ${t.handle} ${b.brand} (${t.code}) ──`);
    let row;
    try { row = await findPromotionByCode(site, t.code); }
    catch (e) { console.log(`  ✗ promo lookup failed: ${e.message.split('\n')[0]}`); fail++; continue; }
    if (!row) { console.log('  ✗ promo not found'); fail++; continue; }
    const mtId = row.message_template_id;
    const popupId = (row.dialog_popup_list || [])[0]?.popup_id;

    // ── MESSAGE TEMPLATE ────────────────────────────────────────────────
    try {
      const res = await authedFetch(site, `/api/bo/messagetemplate/${mtId}`);
      const data = res?.data || res;
      const tmpl = data.message_template;
      const msgDetails = data.message_details || {};
      const details = {};
      for (const [localeId, entry] of Object.entries(msgDetails)) {
        const isZH = ZH_LOCALES.has(Number(entry.settings_locale_id)) || /_ZH$/.test(entry.settings_locales_code || '');
        const newSubject = isZH ? subjectZH(t.amt) : subjectEN(t.amt);
        const [find, repl] = isZH ? BODY_ZH : BODY_EN;
        let newMessage = entry.message;
        if (entry.message.includes(find)) newMessage = entry.message.split(find).join(repl);
        else { console.log(`    ⚠ MT ${entry.settings_locales_code}: opening phrase not found — body left unchanged`); warn++; }
        details[localeId] = { settings_locale_id: entry.settings_locale_id, subject: newSubject, message: newMessage };
        const bodyChanged = newMessage !== entry.message;
        console.log(`    MT ${entry.settings_locales_code}: subject → "${newSubject}"  body-opening ${bodyChanged ? 'updated' : 'UNCHANGED'}`);
      }
      if (commit) {
        const putBody = { name: tmpl.name, section: tmpl.section, type: tmpl.type, status: tmpl.status, details };
        if (b.platform === 'qpro') putBody.code = tmpl.code;
        const pr = await authedFetch(site, `/api/bo/messagetemplate/${mtId}`, { method: 'PUT', body: putBody });
        console.log(`    MT PUT → ${pr?.success === true || pr?.data != null ? '✓' : '✗'} (id=${mtId})`);
      }
    } catch (e) { console.log(`  ✗ MT update failed: ${e.message.split('\n')[0]}`); fail++; }

    // ── DIALOG POPUP (title only) ───────────────────────────────────────
    if (!popupId) { console.log('    (no dialog popup linked — skip)'); }
    else try {
      // Fetch full popup row from listing (GET /popups/{id} returns 405).
      let popupRow = null, page = 1;
      while (!popupRow) {
        const r = await authedFetch(site, `/api/bo/popups?page=${page}&perPage=50&sort_by=id&sort_order=desc`);
        const rows = r?.data?.rows || [];
        popupRow = rows.find((p) => p.id === popupId);
        if (rows.length < 50 || popupRow) break;
        page++;
      }
      if (!popupRow) { console.log(`    ✗ popup ${popupId} not found in listing`); fail++; }
      else {
        const rawContents = popupRow.contents || {};
        const entries = Array.isArray(rawContents) ? rawContents.map((c, i) => [String(i), c]) : Object.entries(rawContents);
        const contents = {};
        for (const [idx, c] of entries) {
          const isZH = ZH_LOCALES.has(Number(c.locale_id)) || /中文|ZH/i.test(c.locale_name || '');
          const newTitle = isZH ? titleZH(t.amt) : titleEN(t.amt);
          contents[idx] = { ...c, title: newTitle };
          console.log(`    POPUP loc ${c.locale_id}: title → "${newTitle}" (body unchanged)`);
        }
        if (commit) {
          const putBody = { ...popupRow, start_date: toBoDate(popupRow.start_date), end_date: toBoDate(popupRow.end_date), contents };
          const pr = await authedFetch(site, `/api/bo/popups/${popupId}`, { method: 'PUT', body: putBody });
          console.log(`    POPUP PUT → ${pr?.success === true || pr?.data != null ? '✓' : '✗'} (id=${popupId})`);
        }
      }
    } catch (e) { console.log(`  ✗ popup update failed: ${e.message.split('\n')[0]}`); fail++; }

    ok++;
  }
}

console.log(`\n${commit ? 'LIVE' : 'DRY-RUN'} done. instances=${ok} failures=${fail} warnings=${warn}`);
if (!commit) console.log('Re-run with --commit to apply.');

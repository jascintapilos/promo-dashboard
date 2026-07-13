#!/usr/bin/env node
// Patch MTs and dialog popups for P073-P075 (WC Semi Finals) on QPRO8 + QP2A.
// Updates: subject lines, intro paragraphs, and dialog popup titles.
//
// Usage:
//   node bin/patch-wcsf-mt-dialog.mjs            -- dry run
//   node bin/patch-wcsf-mt-dialog.mjs --commit   -- live PUT

import { authedFetch } from '../src/api-client.js';

const COMMIT = process.argv.includes('--commit');

// New copy for World Cup Semi Finals (EN and ZH; locale 6=SG_EN shares EN, 7=SG_ZH shares ZH)
const SF_COPY = {
  EN: {
    subject:      'World Cup Semi Finals — Exclusive 20% Reload Bonus',
    intro:        'The World Cup Semi Finals are here! Back the biggest matches of the tournament — deposit now and earn a 20% reload bonus on us.',
    dialog_title: 'WC Semi Finals — 20% Reload Bonus ⚽',
  },
  ZH: {
    subject:      '世界杯半决赛 — 专属 20% 充值奖励',
    intro:        '世界杯半决赛激情来袭！支持最精彩的赛事——立即充值，专属享受 20% 充值奖励。',
    dialog_title: '世界杯半决赛 — 20% 充值奖励 ⚽',
  },
};

const LOCALE_ID_TO_LANG = { 1: 'EN', 3: 'ZH', 6: 'EN', 7: 'ZH' };

const MT_TARGETS = [
  { site: 'qpro8', code: 'RET_CRM_ADHOC_20PCT_12X_BR',  mtId: 718 },
  { site: 'qpro8', code: 'RET_CRM_ADHOC_20PCT_12X_SIL', mtId: 719 },
  { site: 'qpro8', code: 'RET_CRM_ADHOC_20PCT_12X_GLD', mtId: 720 },
  { site: 'ibc22', code: 'RET_CRM_ADHOC_20PCT_12X_BR',  mtId: 1313 },
  { site: 'ibc22', code: 'RET_CRM_ADHOC_20PCT_12X_SIL', mtId: 1315 },
  { site: 'ibc22', code: 'RET_CRM_ADHOC_20PCT_12X_GLD', mtId: 1314 },
];

const POPUP_TARGETS = [
  { site: 'qpro8', code: 'RET_CRM_ADHOC_20PCT_12X_BR',  popupId: 303 },
  { site: 'qpro8', code: 'RET_CRM_ADHOC_20PCT_12X_SIL', popupId: 304 },
  { site: 'qpro8', code: 'RET_CRM_ADHOC_20PCT_12X_GLD', popupId: 305 },
  { site: 'ibc22', code: 'RET_CRM_ADHOC_20PCT_12X_BR',  popupId: 1859 },
  { site: 'ibc22', code: 'RET_CRM_ADHOC_20PCT_12X_SIL', popupId: 1861 },
  { site: 'ibc22', code: 'RET_CRM_ADHOC_20PCT_12X_GLD', popupId: 1860 },
];

// Replace the first plain <p>...</p> (not opening with <strong>) with the new intro.
function replaceIntro(html, newIntro) {
  const m = html.match(/^(\s*<p>)([\s\S]*?)(<\/p>\s*)/);
  if (m && !/^\s*<strong>/.test(m[2])) {
    return `<p>${newIntro}</p>\n` + html.slice(m[0].length);
  }
  return `<p>${newIntro}</p>\n${html}`;
}

// Walk listing pages to find a popup by id (direct GET returns 405).
async function findPopupById(site, popupId) {
  const perPage = 200;
  for (let page = 1; page <= 25; page++) {
    const res = await authedFetch(site, `/api/bo/popups?per_page=${perPage}&page=${page}`);
    const rows = res?.data?.rows || res?.data?.data || (Array.isArray(res?.data) ? res.data : []);
    if (!rows.length) break;
    const found = rows.find(p => p.id === popupId);
    if (found) return found;
    if (rows.length < perPage) break;
  }
  return null;
}

async function patchMTs() {
  console.log(`\n=== MT Patch — WC Semi Finals (${COMMIT ? 'LIVE' : 'DRY RUN'}) ===\n`);

  for (const { site, code, mtId } of MT_TARGETS) {
    console.log(`[${code}] site=${site} mt_id=${mtId}`);

    const res = await authedFetch(site, `/api/bo/messagetemplate/${mtId}`);
    const tmpl = res?.data?.message_template || res?.message_template || res?.data || {};

    // QPRO/QP2 API returns details under data.message_details (dict keyed by locale id string)
    const rawDetails = res?.data?.message_details || tmpl.details || tmpl.detail || {};
    // Normalise to array; dict key IS the settings_locale_id
    const detailsArr = Array.isArray(rawDetails)
      ? rawDetails
      : Object.entries(rawDetails).map(([k, v]) => ({ settings_locale_id: Number(k), ...v }));

    if (!detailsArr.length) {
      console.log(`  → No details returned — SKIP (check API response)\n`);
      continue;
    }

    const updatedDetails = {};
    for (const d of detailsArr) {
      const sid = d.settings_locale_id ?? d.id;
      const lang = LOCALE_ID_TO_LANG[sid];
      const copy = lang ? SF_COPY[lang] : null;

      if (!copy) {
        updatedDetails[String(sid)] = { settings_locale_id: sid, subject: d.subject, message: d.message };
        continue;
      }

      const newMessage = replaceIntro(d.message, copy.intro);
      console.log(`  locale_id=${sid} (${lang})  subject="${copy.subject}"`);
      updatedDetails[String(sid)] = { settings_locale_id: sid, subject: copy.subject, message: newMessage };
    }

    if (!COMMIT) { console.log(`  → DRY RUN: skipping PUT\n`); continue; }

    const putBody = {
      id:      mtId,
      name:    tmpl.name || code,
      section: tmpl.section ?? 8,
      type:    tmpl.type   ?? 1,
      status:  tmpl.status ?? 1,
      code:    tmpl.code   || `PROMOTIONS.MESSAGE.${code}`,
      details: updatedDetails,
    };

    const putRes = await authedFetch(site, `/api/bo/messagetemplate/${mtId}`, { method: 'PUT', body: putBody });
    const ok = putRes?.success === true || putRes?.code === 200 || putRes?.status === 'ok' || putRes?.data != null;
    console.log(`  → PUT ${ok ? 'OK' : 'FAILED'}  raw=${JSON.stringify(putRes).slice(0, 140)}\n`);
  }
}

async function patchPopups() {
  console.log(`\n=== Dialog Popup Patch — WC Semi Finals (${COMMIT ? 'LIVE' : 'DRY RUN'}) ===\n`);

  for (const { site, code, popupId } of POPUP_TARGETS) {
    console.log(`[${code}] site=${site} popup_id=${popupId}`);

    const popupRow = await findPopupById(site, popupId);
    if (!popupRow) {
      console.log(`  → popup_id=${popupId} not found in listing — SKIP\n`);
      continue;
    }

    // QPRO uses 'label'; QP2A uses 'code' for the popup name field
    const nameField = popupRow.label !== undefined ? 'label' : 'code';
    const nameValue = popupRow.label ?? popupRow.code ?? 'popup';
    console.log(`  ${nameField}="${nameValue}"`);

    const newContents = {};
    for (const existing of (popupRow.contents || [])) {
      const lid = existing.locale_id;
      const lang = LOCALE_ID_TO_LANG[lid];
      const copy = lang ? SF_COPY[lang] : null;

      if (copy) {
        console.log(`  locale_id=${lid} (${lang})  new_title="${copy.dialog_title}"`);
      }

      newContents[String(lid)] = {
        locale_id:            lid,
        title:                copy ? copy.dialog_title : existing.title,
        content:              existing.content,
        mobile_link:          existing.mobile_link         ?? null,
        desktop_link:         existing.desktop_link        ?? null,
        video_mobile_link:    existing.video_mobile_link   ?? null,
        video_desktop_link:   existing.video_desktop_link  ?? null,
        media_type:           existing.media_type          ?? null,
        cta_button_type:      existing.cta_button_type     ?? 2,
        cta_button_text_1:    existing.cta_button_text_1,
        cta_button_link_1:    existing.cta_button_link_1,
        cta_button_text_2:    existing.cta_button_text_2,
        cta_button_link_2:    existing.cta_button_link_2,
      };
    }

    if (!COMMIT) { console.log(`  → DRY RUN: skipping PUT\n`); continue; }

    const fmtDate = (iso) => iso ? iso.replace('T', ' ').replace(/\.\d+Z?$/, '') : null;
    const putBody = {
      affiliates_visibility: popupRow.affiliates_visibility ?? 0,
      always_pop:            popupRow.always_pop            ?? 0,
      platform:              popupRow.platform              ?? 1,
      [nameField]:           nameValue,
      location:              popupRow.location              ?? 1,
      start_date:            fmtDate(popupRow.start_date),
      end_date:              popupRow.end_date ? fmtDate(popupRow.end_date) : null,
      session:               String(popupRow.session        ?? 3),
      position:              popupRow.position              ?? 99,
      status:                popupRow.status                ?? 1,
      contents:              newContents,
      // QP2A requires site_id; QPRO ignores it if not present
      ...(popupRow.site_id != null ? { site_id: popupRow.site_id } : {}),
    };

    const putRes = await authedFetch(site, `/api/bo/popups/${popupId}`, { method: 'PUT', body: putBody });
    const ok = putRes?.success === true || putRes?.code === 200 || putRes?.data != null;
    console.log(`  → PUT ${ok ? 'OK' : 'FAILED'}  raw=${JSON.stringify(putRes).slice(0, 150)}\n`);
  }
}

async function run() {
  await patchMTs();
  await patchPopups();
  console.log('Done.');
}

run().catch(err => { console.error(err); process.exit(1); });

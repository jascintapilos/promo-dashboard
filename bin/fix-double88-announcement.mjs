#!/usr/bin/env node
// Prepend Double 8.8 campaign announcement to:
//   1. QP2 dialog popups (1970, 1972, 1973, 1974)
//   2. QPRO2/6/8 + QP2 inbox MTs for 88FS and 100FS codes
//   3. WS1 PromotionRewardContents T&C for P235 (188FS) + P237 (288FS)
//
// Usage: node bin/fix-double88-announcement.mjs [--commit]

import { authedFetch, getPopupDetail, updateDialogPopup } from '../src/api-client.js';
import { getSite } from '../src/sites.js';
import { igmpPost } from '../src/igmp-client.js';

const COMMIT = process.argv.includes('--commit');

// ─── Announcement text ────────────────────────────────────────────────────
const ANNOUNCE = {
  en: '<p>🎉 Double 8.8 is here! Spin to win during this exclusive 3-day campaign (7-9 Aug)</p>',
  zh: '<p>🎉 双 8.8 来啦！在这场限时3日活动（8月7日–9日）旋转赢大奖</p>',
};

const isEnLocale = (lid) => [1, 6].includes(Number(lid));  // 1=MY_EN, 6=SG_EN

function prepend(existing, tag) {
  const line = ANNOUNCE[tag];
  if (!existing) return line;
  if (existing.startsWith(line)) return existing;  // idempotency guard
  return line + '\n' + existing;
}

// ─── 1. QP2 dialog popups ─────────────────────────────────────────────────
console.log('\n═══ 1. QP2 Dialog Popups ═══');
const qp2 = getSite('qp2');
const POPUP_IDS = [1970, 1972, 1973, 1974];

for (const id of POPUP_IDS) {
  const popup = await getPopupDetail(qp2, id);
  if (!popup) { console.log(`  popup ${id}: NOT FOUND`); continue; }
  const overrides = {};
  for (const c of (popup.contents || [])) {
    const tag = isEnLocale(c.locale_id) ? 'en' : 'zh';
    const newContent = prepend(c.content, tag);
    if (newContent !== c.content) overrides[c.locale_id] = { content: newContent };
  }
  const changed = Object.keys(overrides).length;
  console.log(`  popup ${id} (site_id=${popup.site_id}): ${changed} locale(s) to update`);
  if (!changed) { console.log('    (already prefixed — skip)'); continue; }
  if (COMMIT) {
    await updateDialogPopup(qp2, popup, { contentsOverrides: overrides });
    console.log(`  ✓ popup ${id} updated`);
  } else {
    for (const [lid, o] of Object.entries(overrides)) {
      console.log(`    DRY locale ${lid}: "${o.content?.slice(0, 80)}..."`);
    }
  }
}

// ─── 2. MTs — QPRO2, QPRO6, QPRO8, QP2 ──────────────────────────────────
console.log('\n═══ 2. Message Templates ═══');

const MT_TARGETS = [
  { brand: 'qpro2', id88: 523,  id100: 524,  isQp2: false },
  { brand: 'qpro6', id88: 672,  id100: 673,  isQp2: false },
  { brand: 'qpro8', id88: 749,  id100: 750,  isQp2: false },
  { brand: 'qp2',   id88: 1371, id100: 1372, isQp2: true  },
];

for (const { brand, id88, id100, isQp2 } of MT_TARGETS) {
  const site = getSite(brand);
  for (const [mtId, label] of [[id88, '88FS'], [id100, '100FS']]) {
    const r = await authedFetch(site, `/api/bo/messagetemplate/${mtId}?with_locales=1`);
    const tpl = r?.data?.message_template || {};
    const dets = r?.data?.message_details || {};
    if (!tpl.id) { console.log(`  ${brand} MT${mtId}: fetch failed`); continue; }

    const newDetails = {};
    let changed = 0;
    for (const [lid, d] of Object.entries(dets)) {
      const tag = isEnLocale(lid) ? 'en' : 'zh';
      const newMsg = prepend(d.message, tag);
      const didChange = newMsg !== d.message;
      if (didChange) changed++;
      newDetails[lid] = { settings_locale_id: Number(lid), subject: d.subject, message: newMsg };
    }

    console.log(`  ${brand} MT${mtId} (${label}): ${changed}/${Object.keys(dets).length} locale(s) to update`);
    if (!changed) { console.log('    (already prefixed — skip)'); continue; }

    const putBody = {
      name: tpl.name,
      section: tpl.section,
      type: tpl.type,
      status: tpl.status,
      details: newDetails,
    };
    if (!isQp2) putBody.code = tpl.code;  // QP2 quirk: omit code

    if (COMMIT) {
      await authedFetch(site, `/api/bo/messagetemplate/${mtId}`, { method: 'PUT', body: putBody });
      console.log(`  ✓ ${brand} MT${mtId} updated`);
    } else {
      console.log(`    DRY: would PUT ${brand} MT${mtId}`);
    }
  }
}

// ─── 3. WS1 PromotionRewardContents (T&C) ────────────────────────────────
console.log('\n═══ 3. WS1 T&C (PromotionRewardContents) ═══');

const WS1_PROMOS = [
  { site: 'ws1-v3-my', rewardId: 15502, label: 'P235(188FS) MY' },
  { site: 'ws1-v3-sg', rewardId: 13256, label: 'P235(188FS) SG' },
  { site: 'ws1-v3-my', rewardId: 15504, label: 'P237(288FS) MY' },
  { site: 'ws1-v3-sg', rewardId: 13258, label: 'P237(288FS) SG' },
];

for (const { site, rewardId, label } of WS1_PROMOS) {
  const r = await igmpPost(site, '/PM/GetPromotionRewardContents', { RewardId: rewardId });
  const rows = Array.isArray(r?.data) ? r.data : [];
  if (!rows.length) { console.log(`  ${label}: no rows`); continue; }

  let changed = 0;
  const newRows = rows.map((row) => {
    const tag = row.Locale === 'zh' ? 'zh' : 'en';
    const newContent = prepend(row.Content, tag);
    if (newContent !== row.Content) changed++;
    return { ...row, Content: newContent };
  });

  console.log(`  ${label} (rewardId=${rewardId}): ${changed}/${rows.length} locale(s) to update`);
  if (!changed) { console.log('    (already prefixed — skip)'); continue; }

  if (COMMIT) {
    const put = await igmpPost(site, '/PM/BulkAddorUpdatePromotionRewardContents', {
      RewardId: rewardId,
      PromotionRewardContents: newRows,
    });
    const ok = put?.success === true || (Array.isArray(put?.message) && put.message.some(m => /success/i.test(m)));
    if (ok) console.log(`  ✓ ${label} updated`);
    else console.error(`  ✗ ${label} failed: ${JSON.stringify(put).slice(0, 200)}`);
  } else {
    console.log(`    DRY: would update ${label}`);
  }
}

if (!COMMIT) console.log('\n→ Dry-run complete. Add --commit to apply.');
else console.log('\nDone.');

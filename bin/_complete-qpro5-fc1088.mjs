#!/usr/bin/env node
// Complete the one partial code on qpro5: FT_TLEO_FC1088_10X (promo exists,
// but inbox MT / SMS / popup were never linked). Creates inbox MT (localized)
// + popup (cloned from qpro2 source), then PUTs the promo to link MT+SMS+popup,
// preserving its providers / blacklist / categories.

import { authedFetch, createMessageTemplate, createDialogPopup } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const CODE = 'FT_TLEO_FC1088_10X';
const src = getSite('qpro2');
const tgt = getSite('qpro5');
const LOCALES = { '1': 'MY_EN', '3': 'MY_ZH' };
const nowYmdHms = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const fmtDate = d => d ? String(d).replace('T', ' ').replace(/\.\d+Z?$/, '') : d;
const arrToObj = a => Object.fromEntries((a || []).map((v, i) => [String(i), v]));
const b01 = v => (v === true ? 1 : v === false ? 0 : v);
function localize(s) { if (s == null) return s; return String(s).replace(/https?:\/\/12huatmy\.com/gi, '').replace(/12huatmy\{dot\}com/gi, ':brandname').replace(/12huatmy\.com/gi, ':brandname').replace(/12huatmy/gi, ':brandname').replace(/12HUAT/g, ':brandname').replace(/12huat/gi, ':brandname'); }

// ── source qpro2 FC1088 ───────────────────────────────────────────────────────
const sr = await authedFetch(src, `/api/bo/promotion?code=${CODE}&perPage=3`);
const sp = Object.values(sr.data?.rows || {}).find(p => p.code === CODE);
const srcMt = await authedFetch(src, `/api/bo/messagetemplate/${sp.message_template_id}`);
const srcSmsName = (await authedFetch(src, `/api/bo/messagetemplate/${sp.message_template_sms_id}`)).data?.message_template?.name;
const srcPopupId = (Array.isArray(sp.dialog_popup_list) && sp.dialog_popup_list[0]) ? sp.dialog_popup_list[0].popup_id : null;
let srcPopup = null;
if (srcPopupId) { for (let pg = 1; pg <= 6; pg++) { const pr = await authedFetch(src, `/api/bo/popups?perPage=300&page=${pg}`); const arr = Object.values(pr.data?.rows || {}); if (!arr.length) break; srcPopup = arr.find(x => x.id === srcPopupId); if (srcPopup) break; } }
console.log(`Source: MT ${sp.message_template_id}, SMS "${srcSmsName}", popup ${srcPopupId}`);

// ── qpro5 promo 395 + SMS generic + MT existence ──────────────────────────────
const tr = await authedFetch(tgt, `/api/bo/promotion?code=${CODE}&perPage=3`);
const tp = Object.values(tr.data?.rows || {}).find(p => p.code === CODE);
const pid = tp.id;
const detail = (await authedFetch(tgt, `/api/bo/promotion/${pid}`)).data?.rows;
console.log(`Target qpro5 promo id=${pid} (gp=${(detail.game_provider_ids||[]).length}, bt=${detail.blacklist_id}, current mt=${detail.message_template_id} sms=${detail.message_template_sms_id})`);

// map sms generic by name, find any existing inbox MT (reuse), via template list
const mtCode = `PROMOTIONS.MESSAGE.${CODE}`;
const smsCode = `PROMOTIONS.SMS.${srcSmsName}`;
let smsId = null, existingMt = null;
for (let pg = 1; pg <= 4; pg++) {
  const mr = await authedFetch(tgt, `/api/bo/messagetemplate?perPage=200&page=${pg}`);
  const arr = Object.values(mr.data?.rows || {});
  if (!arr.length) break;
  for (const t of arr) { const c = (t.code || '').toUpperCase(); if (c === smsCode.toUpperCase()) smsId = t.id; if (c === mtCode.toUpperCase()) existingMt = t.id; }
  if (arr.length < 200) break;
}
console.log(`qpro5 SMS "${srcSmsName}" id=${smsId}, existing inbox MT=${existingMt || 'none'}`);

// ── create inbox MT (localized) ───────────────────────────────────────────────
let mtId = existingMt;
if (!mtId) {
  const details = {};
  for (const [lid] of Object.entries(LOCALES)) { const d = srcMt.data?.message_details?.[lid]; if (d) details[lid] = { settings_locale_id: Number(lid), subject: localize(d.subject), message: localize(d.message) }; }
  const mr = await createMessageTemplate(tgt, { name: CODE, code: mtCode, section: 8, type: 1, status: 1, details });
  mtId = mr.data?.rows?.id || mr.data?.id;
  console.log(`Created inbox MT id=${mtId}`);
}

// ── create popup (clone) ──────────────────────────────────────────────────────
let dialogEntry = null;
if (srcPopup) {
  const contents = {};
  for (const c of (srcPopup.contents || [])) { if (!['1', '3'].includes(String(c.locale_id))) continue; contents[String(c.locale_id)] = { locale_id: c.locale_id, content: c.content, title: c.title, mobile_link: null, desktop_link: null, video_mobile_link: null, video_desktop_link: null, media_type: null, cta_button_type: c.cta_button_type, cta_button_text_1: c.cta_button_text_1, cta_button_link_1: c.cta_button_link_1, cta_button_text_2: c.cta_button_text_2, cta_button_link_2: c.cta_button_link_2 }; }
  const pr = await createDialogPopup(tgt, { platform: 1, start_date: nowYmdHms(), session: 3, position: 99, status: 1, location: 1, affiliates_visibility: 0, always_pop: 0, label: CODE, contents });
  const pd = pr.data?.rows || pr.data;
  if (pd?.id) { dialogEntry = { id: pd.id, start_date: pd.start_date || nowYmdHms(), end_date: null, promotion_id: pid, labelKey: `${pd.code} (Time Limited Ex . . . )`, code: pd.code }; console.log(`Created popup id=${pd.id}`); }
}

// ── PUT promo 395 to link MT + SMS + popup (preserve gp/blacklist/cats) ────────
const p = detail;
const catTov = arrToObj((p.promotion_category || []).filter(c => c.target_type === 1).map(c => c.category_id));
const targetObj = {}; (p.target || []).forEach((t, i) => { targetObj[String(i)] = { type: t.type, multiplier: t.multiplier, game_provider_ids: arrToObj(t.game_provider_ids || []) }; });
const putBody = {
  id: p.id, code: p.code, name: p.name,
  free_spin_game_provider_id: p.free_spin_game_provider_id ?? 0,
  promotion_category_turnover: catTov, promotion_category_winloss: [],
  promo_type: p.promo_type, promo_sub_type: Number(p.promo_sub_type), promotion_ids: [],
  valid_from: fmtDate(p.valid_from), validity: p.validity, reward_validity: p.reward_validity,
  frequency: p.frequency ?? [], frequency_type: Number(p.frequency_type),
  first_deposit: p.first_deposit ?? 0, member_group_ids: [], last_deposit: b01(p.last_deposit ?? 0),
  auto_approve: b01(p.auto_approve), visible_by_affiliate: p.visible_by_affiliate ?? 0, recurring: Number(p.recurring),
  max_per_player: p.max_per_player, daily_max: p.daily_max, status: p.status ?? 1,
  limit_transfer_in: b01(p.limit_transfer_in ?? 0), limit_transfer_out: b01(p.limit_transfer_out ?? 0),
  restrict_claim_round_active: b01(p.restrict_claim_round_active ?? 0), restrict_same_provider_launch: b01(p.restrict_same_provider_launch ?? 0),
  bonus_rate: p.bonus_rate != null ? String(Number(p.bonus_rate).toFixed(2)) : undefined,
  ...(p.reset_frequency != null ? { reset_frequency: p.reset_frequency } : {}),
  auto_unlock: b01(p.auto_unlock), allow_cancel: p.allow_cancel,
  game_provider_ids: arrToObj(p.game_provider_ids || []), target: targetObj,
  message_template_id: mtId, message_template_sms_id: smsId || 0,
  eligible_types: Number(p.eligible_types),
  affiliate_group_ids: [], telemarketer_ids: [], normal_account_manager_ids: [], vip_account_manager_ids: [],
  requires_email: p.requires_email ?? 0, requires_mobile: p.requires_mobile ?? 0, requires_dob: p.requires_dob ?? 0, requires_fullname: p.requires_fullname ?? 0,
  transfer_unlock: b01(p.transfer_unlock ?? 0), kyc_basic: p.kyc_basic ?? 1, kyc_advanced: p.kyc_advanced ?? 1, kyc_pro: p.kyc_pro ?? 1,
  blacklist_id: p.blacklist_id, black_list_sub_categories: [], currencies_ids: p.currencies_ids ?? [],
  dialog_popup_list: dialogEntry ? { '0': dialogEntry } : [],
};
await authedFetch(tgt, `/api/bo/promotion/${pid}`, { method: 'PUT', body: putBody });

// verify
const vr = await authedFetch(tgt, `/api/bo/promotion?code=${CODE}&perPage=3`);
const v = Object.values(vr.data?.rows || {}).find(p => p.code === CODE);
const vp = Array.isArray(v.dialog_popup_list) ? v.dialog_popup_list.length > 0 : false;
console.log(`\nVERIFY: mt=${v.message_template_id} sms=${v.message_template_sms_id} popup=${vp} gp=${(await authedFetch(tgt,`/api/bo/promotion/${pid}`)).data?.rows?.game_provider_ids?.length}`);
console.log(v.message_template_id > 0 && v.message_template_sms_id > 0 && vp ? '✓ FC1088 complete' : '✗ still incomplete');

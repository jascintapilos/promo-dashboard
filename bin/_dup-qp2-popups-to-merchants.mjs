#!/usr/bin/env node
// Duplicate SPADE66 (site_id 4) TLEO Login Popups to IBC22(1), KING333(2), ACE66(3)
// on the ibc22 (QP2) BO. Each shared promo currently has only a site_id=4 popup;
// this clones that popup's content for site_id 1/2/3 and links all into
// dialog_popup_list (per-merchant popup rows + promotion_id, matching canary-api-qp2).
//
// SAFETY:
//   • clones each promo's OWN site_id=4 popup (title/min-dep differ per code)
//   • faithful QP2 PUT body (preserves blacklist/currency/FC bonus_amount/categories/merchants)
//   • aborts a promo if any provider code is unmapped (no silent provider loss)
//   • throttle + retry on 422 "Too Many Request"
//   • idempotent: skips merchants already present; skips SPADE66-only + stray
//   • verifies each promo ends with popups for all 4 site_ids
//
// Run: node bin/_dup-qp2-popups-to-merchants.mjs --dry-run
//      node bin/_dup-qp2-popups-to-merchants.mjs

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const site = getSite('ibc22');
const DRY = process.argv.includes('--dry-run');
if (DRY) console.log('*** DRY RUN — no writes ***\n');

const TARGET_MERCHANTS = [
  { id: 1, name: 'IBC22' },
  { id: 2, name: 'KING333' },
  { id: 3, name: 'ACE66' },
];
const SPADE66 = 4;

const CODE_TO_PUT_ID = {
  '365G':178,'9W':139,'AP':341,'AVI':196,'BG':15,'BOOM':268,'BNG':328,'BTG':292,
  'CMD':18,'CQ9':14,'EVOK':320,'EZ':25,'FS':122,'FP':304,'FC':184,'GXW':324,
  'HSG':197,'IM':23,'2BC':312,'JDB':110,'JILI':111,'JK':7,'KA':190,'LIVE':21,
  'LUCKY':284,'MAHA':313,'MGP':203,'MONKEY':274,'NET2':256,'NEXT':22,'NLC':257,
  'PNG':17,'AG':1,'PTI':308,'PP':35,'PP2':345,'RT2':258,'RG':349,'SA':13,
  'MAX':8,'SBO':34,'SBO2':353,'SEXY':31,'SIMPLE':10,'SG':9,'SPRIBE':187,
  'TF':117,'VIVO':332,'WBET':72,'WM':37,'XE':33,'YB':297,'YL':36,
};
const arrToObj = a => { const o = {}; (a || []).forEach((v, i) => { o[String(i)] = v; }); return o; };
const fmtDate = d => d ? String(d).replace('T', ' ').replace(/\.\d+Z?$/, '') : null;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// authedFetch with retry-on-422 (rate limit) + throttle
async function call(path, opts, { retries = 5 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await authedFetch(site, path, opts);
      if (opts?.method) await sleep(350); // throttle writes
      return res;
    } catch (e) {
      const rate = /Too Many Request|HTTP 429|HTTP 422/.test(e.message);
      if (rate && attempt < retries) {
        const backoff = Math.min(2000 * 2 ** attempt, 20000);
        console.log(`    …rate-limited, backoff ${backoff}ms (attempt ${attempt + 1}/${retries})`);
        await sleep(backoff);
        continue;
      }
      throw e;
    }
  }
}

function buildFaithfulCurrency(rows) {
  const cur = {};
  rows.forEach((row, i) => {
    const b = {
      currency_id: String(row.settings_currency_id),
      bonus_amount: Number(row.bonus_amount ?? 0),
      bonus_rate: Number(row.bonus_rate ?? 0),
      bypass_min_deposit: row.bypass_min_deposit ?? 0,
      max_balance_claim: row.max_balance_claim ?? null,
      status: String(row.status ?? 1),
      reset: row.reset ?? 0,
      start_time: row.start_time || '00:00:00',
      end_time: row.end_time || '23:59:59',
      min_transfer: Number(row.min_transfer ?? 0),
      min_deposit: Number(row.min_deposit ?? 0),
      max_withdraw_type: String(row.max_withdraw_type ?? 1),
      max_withdraw: row.max_withdraw,
      max_total_applications: row.max_total_applications == null ? 0 : Number(row.max_total_applications),
      max_total_bonus: row.max_total_bonus == null ? 0 : Number(row.max_total_bonus),
      bonus_type: row.bonus_type ?? 2,
      promo_type: row.promo_type ?? null,
      currency: row.currency,
      reset_name: row.reset_name || 'None',
      max_bonus: Number(row.max_bonus ?? 0),
      total_players: 0, current_players: 0, total_used_budget: 0, current_used_budget: 0,
    };
    if (row.deposit_options?.length) b.deposit_options = row.deposit_options;
    cur[String(i)] = b;
  });
  return cur;
}

function buildQp2PutBody(p, currencyRows, dialogList) {
  const codes = p.game_provider_codes ?? [];
  return {
    id: p.id, bonus_settings: p.bonus_settings, code: p.code, name: p.name,
    free_spin_game_provider_id: p.free_spin_game_provider_id ?? 0,
    ...(p.free_spin_game_code ? { free_spin_game_code: p.free_spin_game_code } : {}),
    promotion_category_ids: p.promotion_category_ids ?? [],
    promo_type: p.promo_type, promo_sub_type: p.promo_sub_type, promotion_ids: [],
    valid_from: fmtDate(p.valid_from), validity: p.validity, reward_validity: p.reward_validity,
    frequency: p.frequency ?? [], frequency_type: p.frequency_type,
    member_group_ids: arrToObj(p.member_group_ids || []), members_only: p.members_only ?? 0,
    fingerprint_check: p.fingerprint_check ?? 0, freespin_check: p.freespin_check ?? 0,
    auto_approve: p.auto_approve, auto_reward_activation: p.auto_reward_activation ?? 0,
    recurring: p.recurring, reset_frequency: p.reset_frequency, reset_month: p.reset_month ?? 1,
    max_per_player: p.max_per_player, daily_max: p.daily_max, status: p.status ?? 1,
    limit_transfer_in: p.limit_transfer_in ?? 0, limit_transfer_out: p.limit_transfer_out ?? 0,
    bonus_rate: 0, auto_unlock: p.auto_unlock, allow_cancel: p.allow_cancel, withdrawal_unlock: p.withdrawal_unlock ?? 0,
    game_provider_codes: arrToObj(codes.map(c => CODE_TO_PUT_ID[c]).filter(x => x !== undefined)),
    target: {
      type: (p.target?.[0]?.type) ?? 1,
      multiplier: String(Number(p.target?.[0]?.multiplier ?? 0).toFixed(2)),
      game_provider_codes: arrToObj(p.target?.[0]?.game_provider_codes ?? codes),
    },
    message_template_id: p.message_template_id ?? 0, message_template_sms_id: p.message_template_sms_id ?? 0,
    deposit_count: p.deposit_count ?? 0, active_period: p.active_period ?? 0,
    merchant_ids: arrToObj((p.merchant_ids || []).map(m => m.id ?? m)),
    allow_deposit: p.allow_deposit ?? 0, allow_continuous_claim: p.allow_continuous_claim ?? 0,
    deposit_status: p.last_deposit === 1 ? 4 : 1, eligible_types: p.eligible_types ?? 1,
    affiliate_group_ids: [], telemarketer_ids: [],
    requires_mobile: p.requires_mobile ?? 0, requires_dob: p.requires_dob ?? 0, requires_fullname: p.requires_fullname ?? 0,
    black_list_sub_categories: [], promotion_currency: buildFaithfulCurrency(currencyRows),
    dialog_popup_list: dialogList,
  };
}

// Build a popup POST body cloning a source popup, for a target site_id.
function clonePopupBody(src, siteId) {
  const contents = {};
  for (const c of src.contents) {
    contents[String(c.locale_id)] = {
      locale_id: c.locale_id, content: c.content, title: c.title,
      mobile_link: c.mobile_link ?? null, desktop_link: c.desktop_link ?? null,
      video_mobile_link: c.video_mobile_link ?? null, video_desktop_link: c.video_desktop_link ?? null,
      media_type: c.media_type ?? null,
      cta_button_type: c.cta_button_type,
      cta_button_text_1: c.cta_button_text_1, cta_button_link_1: c.cta_button_link_1,
      cta_button_text_2: c.cta_button_text_2, cta_button_link_2: c.cta_button_link_2,
    };
  }
  return {
    site_id: siteId,
    platform: src.platform ?? 1,
    location: src.location ?? 1,
    session: String(src.session ?? 3),
    position: src.position ?? 99,
    status: src.status ?? 1,
    affiliates_visibility: src.affiliates_visibility ?? 0,
    always_pop: src.always_pop ?? 0,
    do_not_show_again: src.do_not_show_again ?? 0,
    start_date: fmtDate(src.start_date) || new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, ''),
    end_date: src.end_date ?? null,
    contents,
  };
}

// ── 1. Fetch all popups → id map (with contents) ─────────────────────────────
console.log('Fetching popups catalog…');
const popupMap = new Map();
for (let pg = 1; pg <= 8; pg++) {
  const r = await authedFetch(site, `/api/bo/popups?perPage=300&page=${pg}`);
  const arr = Object.values(r.data?.rows || {});
  if (!arr.length) break;
  arr.forEach(p => popupMap.set(p.id, p));
}
console.log(`  popups loaded: ${popupMap.size}`);

// ── 2. Fetch SPADE66 TLEO promos ─────────────────────────────────────────────
const r = await authedFetch(site, '/api/bo/promotion?code=TLEO&perPage=200&page=1');
const all = Object.values(r.data?.rows || {}).filter(p => p.code?.includes('TLEO'));
const spade = all.filter(p => (p.merchant_ids || []).some(m => m.id === SPADE66));

// Targets: shared across all 4 merchants, currently missing 1/2/3 popups
const work = [];
const skip = [];
for (const p of spade) {
  const mids = (p.merchant_ids || []).map(m => m.id);
  const dp = Array.isArray(p.dialog_popup_list) ? p.dialog_popup_list : [];
  const siteIds = new Set(dp.map(d => d.site_id));
  const site4 = dp.find(d => d.site_id === SPADE66);
  const needed = TARGET_MERCHANTS.filter(m => mids.includes(m.id) && !siteIds.has(m.id));
  if (!site4) { skip.push(`${p.code} (no SPADE66 popup)`); continue; }
  if (!needed.length) { skip.push(`${p.code} (already has ${[...siteIds].sort().join(',')})`); continue; }
  work.push({ promo: p, site4PopupId: site4.popup_id, existing: dp, needed });
}

console.log(`\nTo process: ${work.length}   Skipped: ${skip.length}`);
skip.forEach(s => console.log(`  skip: ${s}`));

let ok = 0, fail = 0;
const failures = [];

for (const { promo, site4PopupId, existing, needed } of work) {
  const src = popupMap.get(site4PopupId);
  if (!src) { console.error(`✗ ${promo.code}: source popup ${site4PopupId} not in catalog`); fail++; failures.push(promo.code); continue; }

  // provider-code guard
  const detailResp = await call(`/api/bo/promotion/${promo.id}`);
  const p = detailResp.data?.rows;
  const codes = p.game_provider_codes ?? [];
  const unmapped = codes.filter(c => CODE_TO_PUT_ID[c] === undefined);
  if (unmapped.length) { console.error(`✗ ${promo.code}: unmapped provider codes ${JSON.stringify(unmapped)} — SKIP`); fail++; failures.push(`${promo.code} (unmapped gp)`); continue; }

  console.log(`\n${promo.code} (id=${promo.id}) — add site_id ${needed.map(m => m.id).join(',')} (clone popup ${site4PopupId} "${src.contents?.[0]?.title?.slice(0,40)}")`);

  if (DRY) {
    console.log(`  DRY: would POST ${needed.length} popups + PUT promo. gp=${codes.length} cats=${JSON.stringify(p.promotion_category_ids)} merchants=${JSON.stringify((p.merchant_ids||[]).map(m=>m.id))}`);
    ok++;
    continue;
  }

  try {
    const curResp = await call(`/api/bo/promotioncurrency?promotion_id=${promo.id}&perPage=20&page=1`);
    const currencyRows = Object.values(curResp.data?.rows || {});

    // existing entries preserved (site_id=4 join row), append new full popup rows
    const combinedArr = [...existing];
    for (const m of needed) {
      const body = clonePopupBody(src, m.id);
      const pr = await call('/api/bo/popups', { method: 'POST', body });
      const row = pr.data?.rows || pr.data;
      if (!row?.id) throw new Error(`popup POST (site ${m.id}) returned no id`);
      console.log(`  ✓ popup site_id=${m.id} (${m.name}) id=${row.id} code=${row.code}`);
      combinedArr.push({ ...row, promotion_id: promo.id });
    }
    const dialogList = {};
    combinedArr.forEach((d, i) => { dialogList[String(i)] = d; });

    const putBody = buildQp2PutBody(p, currencyRows, dialogList);
    await call(`/api/bo/promotion/${promo.id}`, { method: 'PUT', body: putBody });

    // verify
    const verResp = await call(`/api/bo/promotion?code=${encodeURIComponent(promo.code)}&perPage=20&page=1`);
    const verRow = Object.values(verResp.data?.rows || {}).find(x => x.id === promo.id);
    const verSiteIds = (Array.isArray(verRow?.dialog_popup_list) ? verRow.dialog_popup_list : []).map(d => d.site_id).sort();
    const verDetail = (await call(`/api/bo/promotion/${promo.id}`)).data?.rows;
    const gpOk = (verDetail.game_provider_codes || []).length === codes.length;
    const has4 = [1, 2, 3, 4].every(s => verSiteIds.includes(s));
    console.log(`  verify: popup site_ids=[${verSiteIds}] gp=${(verDetail.game_provider_codes||[]).length}/${codes.length} cats=${JSON.stringify(verDetail.promotion_category_ids)}`);
    if (has4 && gpOk) { console.log('  ✓ complete'); ok++; }
    else { console.error(`  ✗ verify FAILED (all4=${has4} gpOk=${gpOk})`); fail++; failures.push(promo.code); }
  } catch (e) {
    console.error(`  ✗ ${promo.code} ERROR: ${e.message.split('\n')[0]}`); fail++; failures.push(promo.code);
  }
}

console.log(`\n=== SUMMARY ===  OK: ${ok}  Failed: ${fail}  Skipped: ${skip.length}${DRY ? '  (DRY RUN)' : ''}`);
if (failures.length) { console.log('Failures:'); failures.forEach(f => console.log('  ' + f)); }

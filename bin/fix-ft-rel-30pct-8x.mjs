#!/usr/bin/env node
// Remediation: FT_REL_30PCT_8X (30% reload, TO 8x, max 300, min dep 30 MY / 50 SG)
// across the 8 BOs that carry it (QPRO3/4/5/7/10/15/16 + QP2C/ACE66 on ibc22).
//
// Part A — inbox message template:
//   Live MTs carry leaked CNY Free-Spin campaign copy ("Celebrate the Year of
//   the Horse with Lucky Free Spins" / "欢庆马年") on a deposit reload promo,
//   subject "30% Reload Bonus" instead of the operator-standard "Exclusive
//   Offer", a wrong category clause ("Slots, Crash, Live Casino and Fishing"
//   on an all-games promo) and no T&C hyperlink. Re-render each locale from
//   the canonical deposit body via renderBody() (same path the canary uses),
//   strip the auto-injected campaign intro, and force the standard subject.
//   Per-site claim window / expiry come from the live promo row
//   (BO validity = after-claim expiry, BO reward_validity = claim window).
//
// Part B — blacklist template (QP2 only):
//   ibc22 promo 750 has blacklist_template_id = null. All-games promo → attach
//   id=1 "All games". Echo-style PUT proven by bin/fix-wc-slvr-qp2-providers.mjs:
//   GET detail → change ONLY blacklist_template_id → PUT back. Dialog re-asserted
//   via readDialogForPreservation; promotion_currency omitted. QP2 PUT quirk:
//   top-level game_provider_codes takes NUMERIC ids, target[0] takes STRING codes.
//   QPRO sites already carry their per-BO "All games" template — verified only.
//
//   node bin/fix-ft-rel-30pct-8x.mjs            ← dry-run
//   node bin/fix-ft-rel-30pct-8x.mjs --commit   ← live

import { authedFetch, readDialogForPreservation } from '../src/api-client.js';
import { getSite } from '../src/sites.js';
import { renderBody } from '../src/message-template-renderer.js';
import { qcMtTncHyperlink } from '../src/qc-mt-tnc.js';
import { mkdirSync, appendFileSync } from 'node:fs';
import path from 'node:path';

const commit = process.argv.includes('--commit');
const CODE = 'FT_REL_30PCT_8X';

const SITES = [
  { site: 'qpro3',  brand: 'QPRO3',  platform: 'qpro' },
  { site: 'qpro4',  brand: 'QPRO4',  platform: 'qpro' },
  { site: 'qpro5',  brand: 'QPRO5',  platform: 'qpro' },
  { site: 'qpro7',  brand: 'QPRO7',  platform: 'qpro' },
  { site: 'qpro10', brand: 'QPRO10', platform: 'qpro' },
  { site: 'qpro15', brand: 'QPRO15', platform: 'qpro' },
  { site: 'qpro16', brand: 'QPRO16', platform: 'qpro' },
  { site: 'ibc22',  brand: 'QP2C',   platform: 'qp2'  },
];

// Operator rule (feedback_inbox_subject_exclusive_offer): Deposit Bonus inbox
// subject is just "Exclusive Offer" — no percentage, no sub-type.
const SUBJECT = { EN: 'Exclusive Offer', ZH: '独家优惠', ID: 'Penawaran Eksklusif' };

// QP2 code→numeric-id map, from QP2A_TARGET_GAME_PROVIDER_CODES ∥
// QP2A_PUT_GAME_PROVIDER_IDS in src/api-mapper-qp2.js (V25 captured PUT).
const QP2_CODE_TO_ID = {
  '365G': 178, '9W': 139, AP: 341, AVI: 196, BG: 15, BOOM: 268, BNG: 328, BTG: 292,
  CMD: 18, CQ9: 14, EVOK: 320, EZ: 25, FS: 122, FP: 304, FC: 184, GXW: 324,
  HSG: 197, IM: 23, '2BC': 312, JDB: 110, JILI: 111, JK: 7, KA: 190, LIVE: 21,
  LUCKY: 284, MAHA: 313, MGP: 203, MONKEY: 274, NET2: 256, NEXT: 22, NLC: 257, PNG: 17,
  AG: 1, PTI: 308, PP: 35, PP2: 345, RT2: 258, RG: 349, SA: 13, MAX: 8,
  SBO: 34, SBO2: 353, SEXY: 31, SIMPLE: 10, SG: 9, SPRIBE: 187, TF: 117, VIVO: 332,
  WBET: 72, WM: 37, XE: 33, YB: 297, YL: 36,
};
const QP2_BLACKLIST_ALL_GAMES = 1; // probed 2026-07-07: id=1 "All games" on ibc22

const objVals = (o) => (o == null ? [] : Array.isArray(o) ? o : Object.values(o));
const asNumKeyed = (arr) => Object.fromEntries(arr.map((v, i) => [String(i), v]));
const toYmdHis = (iso) => (iso ? String(iso).replace('T', ' ').replace(/\.\d+Z?$/, '') : null);

// The copy-generator always injects a tone intro <p> ahead of the canonical
// body (inferred tone when no campaign matches). Standard deposit MTs carry
// no intro — strip any leading <p> that isn't the "<p><strong>Promo Details"
// opener (EN "Promo Details:" / ZH "优惠详情：" both start with <strong>).
const stripIntro = (html) => html.replace(/^\s*<p>(?!\s*<strong>)[\s\S]*?<\/p>\s*/, '');

const OUT = path.resolve('captures/provider-fix-runs'); mkdirSync(OUT, { recursive: true });
const logFile = path.join(OUT, `ft-rel-30pct-8x-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
const log = (ev) => appendFileSync(logFile, JSON.stringify({ ts: new Date().toISOString(), ...ev }) + '\n');

console.log(`${commit ? 'LIVE (--commit)' : 'DRY-RUN'} — ${CODE} inbox MT + blacklist remediation\n`);

const results = [];

for (const { site: siteId, brand, platform } of SITES) {
  const site = getSite(siteId);
  const res = { site: siteId, brand, mt: 'pending', blacklist: 'pending' };
  results.push(res);
  console.log(`━━━━━━ ${siteId} (${brand}) ━━━━━━`);
  try {
    // ── Locate promo + MT ────────────────────────────────────────────────
    const listing = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(CODE)}&perPage=10`);
    const promo = objVals(listing.data?.rows).find((p) => p.code === CODE);
    if (!promo) { res.mt = res.blacklist = 'not_found'; console.log('  ✗ code not found\n'); continue; }
    res.promo_id = promo.id;

    const mtRes = await authedFetch(site, `/api/bo/messagetemplate/${promo.message_template_id}`);
    const meta = mtRes.data?.message_template;
    const existing = mtRes.data?.message_details || {};
    if (!meta) throw new Error(`message template ${promo.message_template_id} not found`);

    // ── Part A: re-render every locale from the canonical deposit body ──
    const resolved = {
      promo_code: CODE,
      promotion_name_en: '30% Deposit Bonus',
      bonus_type: 'Deposit',
      parsed: { min_deposit: 30, bonus_rate_pct: 30, max_bonus: 300, to_multiplier: 8, categories: [] },
      per_currency_overrides: { SGD: { min_deposit: 50 } },
      validity_days: Number(promo.validity ?? 30),                // after-claim expiry
      rewards_validity_days: Number(promo.reward_validity ?? 30), // claim window
    };

    const newDetails = {};
    for (const [localeId, entry] of Object.entries(existing)) {
      const locale = entry.settings_locales_code;
      const r = await renderBody({ bonusType: 'Deposit', locale, brand, platform, resolved });
      if (r.skipped) throw new Error(`render skipped for ${locale}: ${r.reason}`);
      newDetails[localeId] = {
        settings_locale_id: Number(localeId),
        subject: SUBJECT[r.docKey] || SUBJECT.EN,
        message: stripIntro(r.html),
      };
      const old = existing[localeId];
      const changed = old.subject !== newDetails[localeId].subject || old.message !== newDetails[localeId].message;
      console.log(`  MT ${locale}: subject "${old.subject}" → "${newDetails[localeId].subject}"${changed ? '' : ' (no change)'}`);
    }

    if (!commit) {
      res.mt = 'would_fix';
    } else {
      await authedFetch(site, `/api/bo/messagetemplate/${promo.message_template_id}`, {
        method: 'PUT',
        body: { name: meta.name, section: meta.section, type: meta.type, status: meta.status, details: newDetails },
      });
      // Verify: re-GET, compare subject + body, and run the T&C hyperlink QC.
      const after = (await authedFetch(site, `/api/bo/messagetemplate/${promo.message_template_id}`)).data?.message_details || {};
      const bad = Object.entries(newDetails).filter(([lid, nd]) =>
        after[lid]?.subject !== nd.subject || after[lid]?.message !== nd.message);
      const tnc = await qcMtTncHyperlink(site, promo.message_template_id, platform);
      const tncFail = Object.values(tnc.checks).some((v) => v === false);
      if (bad.length === 0 && !tncFail) {
        res.mt = 'ok';
        console.log(`  ✓ MT ${promo.message_template_id} saved + verified (${Object.keys(newDetails).length} locales, T&C link OK)`);
      } else {
        res.mt = 'verify_failed';
        res.mt_bad = bad.map(([lid]) => lid);
        console.log(`  ✗ MT verify failed — locales [${res.mt_bad.join(',')}]${tncFail ? ' + T&C link check failed' : ''}`);
        tnc.messages.forEach((m) => console.log(`   ${m}`));
      }
    }

    // ── Part B: blacklist template ───────────────────────────────────────
    if (platform === 'qpro') {
      const detail = (await authedFetch(site, `/api/bo/promotion/${promo.id}`)).data.rows;
      const cat = (await authedFetch(site, '/api/bo/blacklist?perPage=200&page=1')).data?.rows || [];
      const tpl = cat.find((t) => t.id === detail.blacklist_id);
      if (tpl && /^all games$/i.test(tpl.name)) {
        res.blacklist = 'ok';
        console.log(`  ✓ blacklist_id=${detail.blacklist_id} "${tpl.name}" — correct for all-games promo`);
      } else {
        res.blacklist = 'MISMATCH';
        console.log(`  ⚠ blacklist_id=${detail.blacklist_id} → "${tpl?.name ?? 'none'}" — expected an "All games" template, flagging (not auto-fixed)`);
      }
    } else {
      const d = (await authedFetch(site, `/api/bo/promotion/${promo.id}`)).data.rows;
      if (d.blacklist_template_id != null) {
        res.blacklist = 'ok';
        console.log(`  ✓ blacklist_template_id=${d.blacklist_template_id} already set`);
      } else if (!commit) {
        res.blacklist = 'would_fix';
        console.log(`  ~ blacklist_template_id=null → would set ${QP2_BLACKLIST_ALL_GAMES} ("All games")`);
      } else {
        const codes = objVals(d.game_provider_codes);
        const gpIds = codes.map((c) => QP2_CODE_TO_ID[c]).filter((v) => v != null);
        if (gpIds.length !== codes.length) throw new Error(`unmapped QP2 provider code(s): ${codes.filter((c) => QP2_CODE_TO_ID[c] == null).join(',')}`);
        const dlg = await readDialogForPreservation(site, d.code);
        if (!(dlg?.id && dlg.fullRow)) console.log(`  ⚠ dialog popup row unresolved (id=${dlg?.id ?? 'none'}) — dialog_popup_list will be empty`);
        const targetArr = Array.isArray(d.target) ? d.target : objVals(d.target);
        const target0 = targetArr[0] || { type: 1, multiplier: '8.00' };
        const merchantIds = asNumKeyed(objVals(d.merchant_ids).map((m) => (typeof m === 'object' ? m.id : m)));
        const before = {
          status: d.status, mtid: d.message_template_id,
          mg: objVals(d.member_group_ids).length,
          cats: JSON.stringify(objVals(d.promotion_category_ids)),
          gpc: codes.length,
        };
        const body = {
          id: d.id, code: d.code, name: d.name,
          bonus_settings: d.bonus_settings ?? 1,
          promo_type: d.promo_type, promo_sub_type: d.promo_sub_type,
          promotion_ids: Array.isArray(d.promo_linked_ids) ? d.promo_linked_ids : [],
          valid_from: toYmdHis(d.valid_from), valid_to: toYmdHis(d.valid_to),
          validity: d.validity ?? 1, reward_validity: d.reward_validity ?? 1,
          frequency_type: d.frequency_type ?? 1, frequency: d.frequency ?? [],
          before_ftd: d.before_ftd ?? 0, first_deposit: d.first_deposit ?? 0,
          ftd: d.ftd ?? 0, last_deposit: d.last_deposit ?? 0,
          deposit_status: d.last_deposit ? 4 : (d.first_deposit || d.ftd) ? 3 : d.before_ftd ? 2 : 1,
          limit_transfer_out: d.limit_transfer_out ?? 0, limit_transfer_in: d.limit_transfer_in ?? 0,
          auto_unlock: d.auto_unlock ?? 1, allow_cancel: d.allow_cancel ?? 0,
          withdrawal_unlock: d.withdrawal_unlock ?? 0, auto_approve: d.auto_approve ?? 1,
          auto_reward_activation: d.auto_reward_activation ?? 1,
          recurring: d.recurring ?? 0, reset_frequency: d.reset_frequency || 1, reset_month: d.reset_month || 1,
          max_per_player: d.max_per_player ?? 1, daily_max: d.daily_max ?? 1,
          members_only: d.members_only ?? 0, fingerprint_check: d.fingerprint_check ?? 0,
          freespin_check: d.freespin_check ?? 0, allow_deposit: d.allow_deposit ?? 0,
          allow_continuous_claim: d.allow_continuous_claim ?? 0,
          message_template_id: d.message_template_id ?? 0, message_template_sms_id: d.message_template_sms_id ?? 0,
          bonus_rate: d.bonus_rate ?? 0, deposit_count: d.deposit_count ?? 0,
          active_period: d.active_period ?? 0, eligible_types: d.eligible_types ?? 1,
          free_spin_game_provider_id: d.free_spin_game_provider_id ?? 0,
          ...(d.free_spin_game_code != null ? { free_spin_game_code: d.free_spin_game_code } : {}),
          blacklist_template_id: QP2_BLACKLIST_ALL_GAMES,   // ← the only intended change
          promotion_category_ids: d.promotion_category_ids ?? [],
          game_provider_codes: asNumKeyed(gpIds),           // PUT quirk: numeric ids
          target: {
            type: target0.type ?? 1,
            multiplier: Number(target0.multiplier ?? 0).toFixed(2),
            game_provider_codes: asNumKeyed(objVals(target0.game_provider_codes)), // string codes
          },
          member_group_ids: d.member_group_ids ?? [],
          affiliate_group_ids: d.affiliate_group_ids ?? [], affiliate_ids: d.affiliate_ids ?? [],
          telemarketer_ids: d.telemarketer_ids ?? [],
          requires_email: d.requires_email ?? 0, requires_mobile: d.requires_mobile ?? 0,
          requires_dob: d.requires_dob ?? 0, requires_fullname: d.requires_fullname ?? 0,
          kyc_listing: d.kyc_listing ?? 0,
          black_list_sub_categories: d.blacklist_sub_categories ?? [],
          merchant_ids: merchantIds,
          dialog_popup_list: (dlg?.id && dlg.fullRow) ? { '0': { ...dlg.fullRow, promotion_id: d.id } } : {},
          status: d.status,
        };
        await authedFetch(site, `/api/bo/promotion/${d.id}`, { method: 'PUT', body });
        const after = (await authedFetch(site, `/api/bo/promotion/${d.id}`)).data.rows;
        const drift = [];
        if (after.blacklist_template_id !== QP2_BLACKLIST_ALL_GAMES) drift.push(`blacklist(${after.blacklist_template_id})`);
        if (after.status !== before.status) drift.push('status');
        if (after.message_template_id !== before.mtid) drift.push('msg_template');
        if (objVals(after.member_group_ids).length !== before.mg) drift.push('member_groups');
        if (JSON.stringify(objVals(after.promotion_category_ids)) !== before.cats) drift.push('categories');
        if (objVals(after.game_provider_codes).length !== before.gpc) drift.push(`providers(${objVals(after.game_provider_codes).length}/${before.gpc})`);
        if (drift.length === 0) {
          res.blacklist = 'ok';
          console.log(`  ✓ blacklist_template_id set to ${QP2_BLACKLIST_ALL_GAMES} ("All games"), no drift`);
        } else {
          res.blacklist = 'DRIFT';
          res.drift = drift;
          console.log(`  ✗ DRIFT after blacklist PUT: [${drift.join(', ')}] — STOP AND INVESTIGATE`);
        }
      }
    }
  } catch (e) {
    const msg = String(e.message || e).split('\n').slice(0, 2).join(' | ').slice(0, 240);
    if (res.mt === 'pending') res.mt = 'error'; else if (res.blacklist === 'pending') res.blacklist = 'error';
    res.error = msg;
    console.log(`  ✗ ERROR — ${msg}`);
    if (commit) { console.log('\n*** STOPPING — error during live run. Investigate before continuing. ***'); log({ event: 'error', ...res }); break; }
  }
  log({ event: commit ? 'commit' : 'dry-run', ...res });
  console.log('');
}

console.log('── Summary ──');
for (const r of results) {
  console.log(`  ${r.site.padEnd(7)} ${(r.brand || '').padEnd(7)} MT: ${r.mt.padEnd(12)} blacklist: ${r.blacklist}${r.error ? ' — ' + r.error : ''}`);
}
if (!commit) console.log('\nDry-run — re-run with --commit to apply (after user confirmation).');
console.log(`Log → ${path.relative(process.cwd(), logFile)}`);

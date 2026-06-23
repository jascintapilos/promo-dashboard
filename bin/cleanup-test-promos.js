#!/usr/bin/env node
// Bulk-cleanup TEST_* promos, message templates, and dialog popups across
// all QPRO + QP2 sites configured in bo-sites.json.
//
// Workflow:
//   1. List every promo with code matching the pattern (default `TEST_`)
//      across both BOs.
//   2. List every dialog popup with `code` or `contents[].title` matching
//      the same pattern.
//   3. Print counts + a sample → exit (read-only by default).
//
// Pass --commit to actually clean:
//   • Promos: PUT status=0 (deactivate), then DELETE (archive). On QPRO
//     the BO requires status=0 before DELETE; "Only inactive promotions
//     can be archived" otherwise. On QP2 we deactivate but skip the
//     archive call since QP2 returns 422 on DELETE.
//   • Dialog popups: DELETE is HTTP 405 on both platforms — no bulk
//     archive available. Deactivate via PUT status=0 if the endpoint
//     accepts a minimal body; otherwise skip and report the orphans for
//     manual cleanup.
//
// Usage:
//   node bin/cleanup-test-promos.js                    # dry-run (list only)
//   node bin/cleanup-test-promos.js --pattern=TEST_API # filter
//   node bin/cleanup-test-promos.js --commit           # actually clean

import { parseArgs } from './_args.js';
import { getSite, listSites } from '../src/sites.js';
import { authedFetch } from '../src/api-client.js';

const { flags } = parseArgs(process.argv.slice(2));
const commit  = flags.commit === true;
const pattern = flags.pattern || 'TEST_';

// All QPRO + QP2 sites from bo-sites.json (excludes WS1/WS2 which use a
// different platform and don't have the same promo API endpoints).
const sites = listSites()
  .filter((s) => s.platform === 'qpro' || s.platform === 'qp2')
  .map((s) => s.id);

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`CLEANUP — ${commit ? 'LIVE (--commit)' : 'DRY-RUN'}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`  Pattern: code starts with "${pattern}"`);
console.log(`  Sites:   ${sites.join(', ')}`);
console.log('');

async function listTestPromos(siteId) {
  const site = getSite(siteId);
  // Page through all rows; the BO list endpoint caps perPage at 200 on
  // most platforms. We pull both active (status=1) and inactive (status=0).
  const all = [];
  for (const status of [1, 0]) {
    const r = await authedFetch(site, `/api/bo/promotion?perPage=200&page=1&status=${status}&sort_by=id&sort_order=desc`);
    const rows = r?.data?.rows || [];
    all.push(...rows.filter((p) => (p.code || '').startsWith(pattern)));
  }
  return all;
}

async function listTestPopups(siteId) {
  const site = getSite(siteId);
  // /api/bo/popups doesn't expose a code filter; pull the active list
  // and match on contents[].title which carries our promotion name.
  // Our test pattern is "TEST_" in promo_code but titles render with a
  // space ("TEST VIP ...", "TEST API QP2A ..."), so loosen to "TEST".
  const r = await authedFetch(site, '/api/bo/popups?paginate=false&status=1');
  const rows = r?.data || r?.data?.rows || [];
  const all = Array.isArray(rows) ? rows : [];
  const titlePattern = pattern.replace(/_$/, '').toUpperCase();  // "TEST_" → "TEST"
  return all.filter((p) => {
    const contentsArr = Array.isArray(p.contents)
      ? p.contents
      : Object.values(p.contents || {});
    return contentsArr.some((c) => (c.title || '').toUpperCase().includes(titlePattern));
  });
}

async function listTestMessageTemplates(siteId) {
  const site = getSite(siteId);
  // The BO list accepts ?name= as a substring filter on template name.
  // We page through in case there are many.
  const all = [];
  for (let page = 1; page <= 10; page++) {
    const r = await authedFetch(
      site,
      `/api/bo/messagetemplate?name=${encodeURIComponent(pattern)}&perPage=100&page=${page}`,
    );
    const rows = r?.data?.rows || r?.data || [];
    const list = Array.isArray(rows) ? rows : [];
    // Double-check: name must actually start with pattern (BO may do substring)
    const matched = list.filter((t) => (t.name || '').toUpperCase().startsWith(pattern.toUpperCase()));
    all.push(...matched);
    if (list.length < 100) break;
  }
  return all;
}

// Normalize GET-shape fields to PUT-shape values. GET returns ISO
// timestamps + nullable typed fields; PUT validates Y-m-d H:i:s
// timestamps + non-null types ("The free spin game code must be a
// string." etc).
function isoToYmdHms(iso) {
  if (!iso || typeof iso !== 'string') return iso;
  // "2026-05-15T07:47:10.000000Z" → "2026-05-15 07:47:10"
  return iso.replace('T', ' ').replace(/\.\d+Z?$/, '').replace(/Z$/, '');
}
function normalizePromoBody(body) {
  // Time fields — convert ISO to "Y-m-d H:i:s" form.
  if (body.valid_from) body.valid_from = isoToYmdHms(body.valid_from);
  if (body.valid_to)   body.valid_to   = isoToYmdHms(body.valid_to);
  // OMIT null typed fields entirely (BO validator rejects null on
  // "must be a string" / "must be an integer" rules).
  if (body.free_spin_game_code == null) delete body.free_spin_game_code;
  if (body.promo_p1_id == null)         delete body.promo_p1_id;
  if (body.promo_p2_id == null)         delete body.promo_p2_id;
  if (body.promo_p2_code == null)       delete body.promo_p2_code;
  if (body.promo_p2_name == null)       delete body.promo_p2_name;
  if (body.reset_day == null)           delete body.reset_day;
  if (body.reset_month == null)         delete body.reset_month;
  if (body.free_spin_game_provider_id == null) delete body.free_spin_game_provider_id;
  if (body.blacklist_template_id == null) delete body.blacklist_template_id;
  if (body.bonus_rate == null)          delete body.bonus_rate;
  // Drop GET-only metadata + GET-only relation fields the PUT doesn't accept.
  for (const k of [
    'created_at', 'updated_at', 'created_by', 'updated_by', 'deleted_at',
    'promotion_category', 'currencies', 'message_templates',
    'sms_message_templates', 'bonus_type', 'member_group', 'target_type',
    'game_provider', 'category', 'currencies_bonus_type', 'kyc_type',
    'phase_game_provider_code', 'phase_game_provider_category',
    // QP2-specific GET-only nested fields
    'kyc_listing', 'bonus_settings', 'site_name', 'merchant_name',
    'platform_name', 'frequency_text', 'before_ftd', 'ftd',
    'deposit_count_reset_frequency', 'deposit_count_reset_day',
    'fingerprint_check', 'freespin_check', 'allow_deposit',
    'allow_continuous_claim', 'auto_reward_activation', 'withdrawal_unlock',
    'active_period', 'members_only',
  ]) {
    delete body[k];
  }
  return body;
}

async function deactivatePromo(siteId, promo) {
  const site = getSite(siteId);
  const detail = await authedFetch(site, `/api/bo/promotion/${promo.id}`);
  const body = detail?.data?.rows;
  if (!body) throw new Error('GET returned no body');
  body.status = 0;
  normalizePromoBody(body);
  return authedFetch(site, `/api/bo/promotion/${promo.id}`, { method: 'PUT', body });
}

async function archivePromo(siteId, promoId) {
  const site = getSite(siteId);
  return authedFetch(site, `/api/bo/promotion/${promoId}`, { method: 'DELETE' });
}

async function deactivateMt(siteId, mt) {
  const site = getSite(siteId);
  const detResp = await authedFetch(site, `/api/bo/messagetemplate/${mt.id}`);
  // Detail shape: res.data.message_template (header) + res.data.message_details (per-locale indexed obj)
  const tmpl    = detResp?.data?.message_template;
  const details = detResp?.data?.message_details;
  if (!tmpl) throw new Error('MT detail returned no body');
  const putBody = {
    name:    tmpl.name,
    section: tmpl.section,
    type:    tmpl.type,
    status:  0,
    details: details,
  };
  // QPRO requires code field; QP2 rejects it with 422
  if (siteId.startsWith('qpro')) putBody.code = tmpl.code;
  return authedFetch(site, `/api/bo/messagetemplate/${mt.id}`, { method: 'PUT', body: putBody });
}

function isoToYmdHmsPopup(iso) {
  if (!iso || typeof iso !== 'string') return iso;
  return iso.replace('T', ' ').replace(/\.\d+Z?$/, '').replace(/Z$/, '');
}

async function deactivatePopup(siteId, popup) {
  const site = getSite(siteId);
  // Normalize contents to indexed object form (PUT requires {"0":row,...})
  const contents = Array.isArray(popup.contents)
    ? Object.fromEntries(popup.contents.map((c, i) => [String(i), c]))
    : popup.contents || {};
  const putBody = {
    ...popup,
    status:     0,
    start_date: isoToYmdHmsPopup(popup.start_date),
    end_date:   isoToYmdHmsPopup(popup.end_date),
    contents,
  };
  return authedFetch(site, `/api/bo/popups/${popup.id}`, { method: 'PUT', body: putBody });
}

// ── List phase (always runs) ────────────────────────────────────────────
const summary = {};
for (const siteId of sites) {
  console.log(`▶ ${siteId}…`);
  const promos = await listTestPromos(siteId);
  const popups = await listTestPopups(siteId);
  const mts    = await listTestMessageTemplates(siteId);
  summary[siteId] = { promos, popups, mts };
  console.log(`    ${promos.length} promos with code matching "${pattern}*"`);
  console.log(`    ${mts.length} message templates with name matching "${pattern}*"`);
  console.log(`    ${popups.length} dialog popups with title matching pattern`);
  if (promos.length) {
    console.log(`    sample promos:`);
    promos.slice(0, 5).forEach((p) => console.log(`      id=${p.id} status=${p.status} code=${p.code}`));
    if (promos.length > 5) console.log(`      … and ${promos.length - 5} more`);
  }
  if (mts.length) {
    console.log(`    sample message templates:`);
    mts.slice(0, 5).forEach((t) => console.log(`      id=${t.id} status=${t.status} name="${t.name}"`));
    if (mts.length > 5) console.log(`      … and ${mts.length - 5} more`);
  }
  if (popups.length) {
    console.log(`    sample popups:`);
    popups.slice(0, 5).forEach((p) => {
      const contentsArr = Array.isArray(p.contents) ? p.contents : Object.values(p.contents || {});
      console.log(`      id=${p.id} status=${p.status} title="${(contentsArr[0]?.title || '').slice(0, 60)}"`);
    });
    if (popups.length > 5) console.log(`      … and ${popups.length - 5} more`);
  }
  console.log('');
}

const totals = Object.values(summary).reduce((acc, s) => {
  acc.promos += s.promos.length;
  acc.popups += s.popups.length;
  acc.mts    += s.mts.length;
  return acc;
}, { promos: 0, popups: 0, mts: 0 });
console.log(`Total to clean: ${totals.promos} promos + ${totals.mts} message templates + ${totals.popups} popups across ${sites.length} sites.`);

if (!commit) {
  console.log('');
  console.log('Dry-run. To actually deactivate + archive, re-run with --commit.');
  process.exit(0);
}

// ── Live cleanup ────────────────────────────────────────────────────────
// The BO's promo PUT validator is strict: a GET→modify→PUT round-trip
// trips "Something is wrong" / 422 on most promos because the GET shape
// has nested relation fields (promotion_category, member_group, etc.)
// that don't map back cleanly. We attempt deactivate on each promo as
// best-effort and report the failures; manual cleanup via BO UI multi-
// select is faster for the leftover.

console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('CLEANING (LIVE — best-effort)');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

let okPromo = 0, failPromo = 0, archivedPromo = 0, archiveFailPromo = 0;
let okMt = 0, failMt = 0;
let okPopup = 0, failPopup = 0;
const failedList = [];

for (const siteId of sites) {
  const { promos, mts, popups } = summary[siteId];

  // ── Promos ────────────────────────────────────────────────────────────
  if (promos.length > 0) {
    console.log(`\n→ ${siteId}: ${promos.length} promo(s)`);
    for (const p of promos) {
      process.stdout.write(`  ${p.code} (id=${p.id}) `);
      try {
        if (p.status !== 0) {
          await deactivatePromo(siteId, p);
          process.stdout.write('deactivated ');
          okPromo++;
        } else {
          process.stdout.write('(already inactive) ');
        }
        try {
          await archivePromo(siteId, p.id);
          process.stdout.write('+ archived ✓');
          archivedPromo++;
        } catch (e) {
          process.stdout.write(`(archive skipped: ${e.message.match(/HTTP \d+/)?.[0] || 'fail'})`);
          archiveFailPromo++;
        }
        console.log('');
      } catch (e) {
        const httpCode = e.message.match(/HTTP \d+/)?.[0] || 'fail';
        console.log(`✖ ${httpCode}`);
        failPromo++;
        failedList.push({ siteId, code: p.code, id: p.id, httpCode });
      }
    }
  }

  // ── Message Templates ────────────────────────────────────────────────
  if (mts.length > 0) {
    console.log(`\n→ ${siteId}: ${mts.length} message template(s)`);
    for (const mt of mts) {
      process.stdout.write(`  MT "${mt.name}" (id=${mt.id}) `);
      try {
        if (Number(mt.status) !== 0) {
          await deactivateMt(siteId, mt);
          process.stdout.write('deactivated ✓');
          okMt++;
        } else {
          process.stdout.write('(already inactive) ✓');
          okMt++;
        }
        console.log('');
      } catch (e) {
        const httpCode = e.message.match(/HTTP \d+/)?.[0] || 'fail';
        console.log(`✖ ${httpCode}`);
        failMt++;
      }
    }
  }

  // ── Dialog Popups ────────────────────────────────────────────────────
  // DELETE returns HTTP 405 on both platforms; deactivate via PUT status=0.
  if (popups.length > 0) {
    console.log(`\n→ ${siteId}: ${popups.length} dialog popup(s)`);
    for (const popup of popups) {
      const contentsArr = Array.isArray(popup.contents) ? popup.contents : Object.values(popup.contents || {});
      const title = (contentsArr[0]?.title || '').slice(0, 50);
      process.stdout.write(`  Popup id=${popup.id} "${title}" `);
      try {
        if (Number(popup.status) !== 0) {
          await deactivatePopup(siteId, popup);
          process.stdout.write('deactivated ✓');
          okPopup++;
        } else {
          process.stdout.write('(already inactive) ✓');
          okPopup++;
        }
        console.log('');
      } catch (e) {
        const httpCode = e.message.match(/HTTP \d+/)?.[0] || 'fail';
        console.log(`✖ ${httpCode}`);
        failPopup++;
      }
    }
  }
}

console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('SUMMARY');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`  Promos deactivated:    ${okPromo}`);
console.log(`  Promos archived:       ${archivedPromo}`);
console.log(`  Archive skipped:       ${archiveFailPromo} (QP2 returns 422 on DELETE)`);
console.log(`  Promos failed:         ${failPromo}`);
console.log(`  Msg templates cleaned: ${okMt}   failed: ${failMt}`);
console.log(`  Popups deactivated:    ${okPopup}   failed: ${failPopup}`);
if (failedList.length > 0) {
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('MANUAL CLEANUP — open BO UI and multi-select these:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  for (const siteId of sites) {
    const failures = failedList.filter((f) => f.siteId === siteId);
    if (failures.length === 0) continue;
    const site = getSite(siteId);
    const boUrl = `${site.baseUrl}/general/promotion-codes`;
    console.log(`\n  ${siteId} (${boUrl}):`);
    console.log(`    Filter by code prefix "TEST" and multi-select these ${failures.length} ids:`);
    console.log(`      ${failures.map((f) => f.id).join(', ')}`);
  }
}

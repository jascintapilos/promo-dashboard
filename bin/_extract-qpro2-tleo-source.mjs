#!/usr/bin/env node
// Extract the qpro2 TLEO source spec (all 54 codes) + check qpro5/7/15/16
// compatibility (provider catalog mapping + blacklist templates by name).
// Read-only. Writes tmp/qpro2-tleo-source.json + prints a compat summary.

import fs from 'node:fs';
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';
import { getBlacklistTemplates } from '../src/blacklist-template.js';

const SRC = 'qpro2';
const TARGETS = ['qpro5', 'qpro7', 'qpro15', 'qpro16'];
function catOf(code, boCat) {
  // FC codes span slot+LC; reload codes are lc or slots
  if (/TLEO_FC|_FC\d/.test(code)) return 'both';
  const c = (boCat || '').toUpperCase();
  if (/LC/.test(c) || /LIVE/.test(c) || /_LC_/.test(code)) return 'lc';
  return 'slots';
}

const srcSite = getSite(SRC);

// blacklist templates (id→name) for source + targets
const srcTpls = await getBlacklistTemplates(srcSite);
const srcBtName = Object.fromEntries(srcTpls.map(t => [t.id, t.name]));

// source catalog id→code
const srcGp = await authedFetch(srcSite, '/api/bo/gameprovider?perPage=300&page=1');
const srcIdToCode = {}; Object.values(srcGp.data?.rows || {}).forEach(g => { srcIdToCode[g.id] = g.code; });

// all 54 TLEO codes (list) + per-code detail
const listR = await authedFetch(srcSite, '/api/bo/promotion?code=TLEO&perPage=200&page=1');
const list = Object.values(listR.data?.rows || {}).filter(p => p.code?.includes('TLEO'));
console.log(`Source ${SRC}: ${list.length} TLEO codes`);

const source = {};
const allGpCodes = new Set();
for (const lp of list) {
  const d = await authedFetch(srcSite, `/api/bo/promotion/${lp.id}`);
  const p = d.data?.rows;
  const gpCodes = (p.game_provider_ids || []).map(id => srcIdToCode[id]).filter(Boolean);
  gpCodes.forEach(c => allGpCodes.add(c));
  const cur = await authedFetch(srcSite, `/api/bo/promotioncurrency?promotion_id=${lp.id}&perPage=20&page=1`);
  const currencyRows = Object.values(cur.data?.rows || {});
  const myr = currencyRows.find(c => c.currency === 'MYR') || currencyRows[0];
  source[p.code] = {
    id: p.id, name: p.name, category: catOf(p.code, lp.category),
    promo_type: p.promo_type, promo_sub_type: p.promo_sub_type,
    validity: p.validity, reward_validity: p.reward_validity, recurring: p.recurring,
    max_per_player: p.max_per_player, daily_max: p.daily_max, bonus_rate: p.bonus_rate,
    blacklist_id: p.blacklist_id, blacklist_name: srcBtName[p.blacklist_id] || null,
    gp_codes: gpCodes, hasPP: gpCodes.includes('PP'), hasPP2: gpCodes.includes('PP2'),
    target_multiplier: p.target?.[0]?.multiplier,
    message_template_id: p.message_template_id, message_template_sms_id: p.message_template_sms_id,
    popup_id: (Array.isArray(lp.dialog_popup_list) && lp.dialog_popup_list[0]) ? lp.dialog_popup_list[0].popup_id : null,
    myr: myr ? { min_transfer: myr.min_transfer, max_bonus: myr.max_bonus, bonus_rate: myr.bonus_rate, min_deposit: myr.min_deposit } : null,
  };
}
fs.mkdirSync('tmp', { recursive: true });
fs.writeFileSync('tmp/qpro2-tleo-source.json', JSON.stringify(source, null, 2));

// category + blacklist + popup/mt/sms presence summary
const byCat = {}, btByCat = {};
let noMt = 0, noSms = 0, noPopup = 0;
for (const [code, s] of Object.entries(source)) {
  byCat[s.category] = (byCat[s.category] || 0) + 1;
  (btByCat[s.category] ||= {})[s.blacklist_name] = ((btByCat[s.category] || {})[s.blacklist_name] || 0) + 1;
  if (!s.message_template_id) noMt++;
  if (!s.message_template_sms_id) noSms++;
  if (!s.popup_id) noPopup++;
}
console.log('category counts:', JSON.stringify(byCat));
console.log('blacklist by category:', JSON.stringify(btByCat, null, 0));
console.log(`source completeness: missing MT=${noMt} SMS=${noSms} popup=${noPopup}`);
console.log(`distinct source GP codes used: ${allGpCodes.size}`);

// ── Target compatibility ─────────────────────────────────────────────────────
console.log('\n=== TARGET COMPATIBILITY ===');
for (const t of TARGETS) {
  const ts = getSite(t);
  const gp = await authedFetch(ts, '/api/bo/gameprovider?perPage=300&page=1');
  const codes = new Set(Object.values(gp.data?.rows || {}).map(g => g.code));
  const missingGp = [...allGpCodes].filter(c => !codes.has(c));
  const tpls = await getBlacklistTemplates(ts);
  const tplNames = new Set(tpls.map(t => t.name));
  const neededBt = [...new Set(Object.values(source).map(s => s.blacklist_name).filter(Boolean))];
  const missingBt = neededBt.filter(n => !tplNames.has(n));
  console.log(`  ${t.padEnd(7)}: gp catalog=${codes.size}, unmapped source GP=${missingGp.length ? missingGp.join(',') : 'none'} | blacklist missing=${missingBt.length ? missingBt.join(' | ') : 'none'}`);
}
console.log('\nWrote tmp/qpro2-tleo-source.json');

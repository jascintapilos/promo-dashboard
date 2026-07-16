#!/usr/bin/env node
// Promo Troubleshoot — pulls BO config + templates and cross-checks for mismatches.
// Usage:
//   node scripts/troubleshoot.mjs <promo_code> <site_id> [--cross-brand] [--json]
//
// Requires: promo-automation project at the path below.

import { resolve } from 'path';
import { pathToFileURL } from 'url';

const PROJ = 'C:/Users/vdiuser/Downloads/promo-automation/promo-automation';
const { authedFetch, findPromotionByCode, getAllCategories } = await import(pathToFileURL(resolve(PROJ, 'src/api-client.js')).href);
const { getSite, loadConfig } = await import(pathToFileURL(resolve(PROJ, 'src/sites.js')).href);
const { extractTemplateTerms, parseDiscoveryQuery, rankCandidates } = await import('./discovery-core.mjs');

const args = process.argv.slice(2);
const positional = args.filter(a => !a.startsWith('-'));
const discoverMode = args.includes('--discover');
const code = discoverMode ? null : positional[0];
const siteId = discoverMode ? positional[0] : positional[1];
const query = discoverMode ? positional.slice(1).join(' ') : null;
const crossBrand = args.includes('--cross-brand');
const jsonOut = args.includes('--json');

if ((!discoverMode && !code) || !siteId || (discoverMode && !query)) {
  console.error('Usage: troubleshoot.mjs <promo_code> <site_id> [--cross-brand] [--json]');
  console.error('   or: troubleshoot.mjs --discover <site_id> "<request text>" [--json]');
  process.exit(1);
}

// ── Locale map ─────────────────────────────────────────────────────────────
const LOCALE_NAMES = {
  1: 'MY_EN', 3: 'MY_ZH', 6: 'SG_EN', 7: 'SG_ZH', 8: 'ID_EN', 9: 'ID_ID',
};

const CURRENCY_PATTERNS = {
  MYR: [/MYR\s*(\d+(?:[.,]\d+)?)/gi, /RM\s*(\d+(?:[.,]\d+)?)/gi, /(\d+(?:[.,]\d+)?)\s*令吉/gi],
  SGD: [/SGD\s*(\d+(?:[.,]\d+)?)/gi, /S\$\s*(\d+(?:[.,]\d+)?)/gi],
  IDR: [/IDR\s*(\d+(?:[.,]\d+)?)/gi, /Rp\.?\s*(\d+(?:[.,]\d+)?)/gi],
};

// Locale → currency association
const LOCALE_CURRENCY = {
  1: 'MYR', 3: 'MYR', 6: 'SGD', 7: 'SGD', 8: 'IDR', 9: 'IDR',
};

// ── Helpers ────────────────────────────────────────────────────────────────
function extractAmounts(html, currency) {
  const patterns = CURRENCY_PATTERNS[currency] || [];
  const amounts = new Set();
  for (const pat of patterns) {
    pat.lastIndex = 0;
    let m;
    while ((m = pat.exec(html)) !== null) {
      const v = parseFloat(m[1].replace(',', ''));
      if (v > 0) amounts.add(v);
    }
  }
  return [...amounts].sort((a, b) => a - b);
}

function extractSpinCount(html) {
  const m = html.match(/(\d+)\s*(?:Free\s*Spin|次免费旋转|free\s*spin)/i);
  return m ? parseInt(m[1], 10) : null;
}

function extractGameName(html) {
  const m = html.match(/launch\s+(?:the\s+)?game\s+<strong>([^<]+)<\/strong>/i)
    || html.match(/启动游戏\s*<strong>([^<]+)<\/strong>/i)
    || html.match(/game\s*<strong>([^<]+)<\/strong>/i);
  return m ? m[1].trim() : null;
}

function nz(v) {
  const n = Number(v);
  return (n === 0 || isNaN(n)) ? null : n;
}

// ── Main fetch ─────────────────────────────────────────────────────────────
async function fetchPromoData(targetSiteId, promoCode) {
  const site = getSite(targetSiteId);

  // 1. Find promo
  const promo = await findPromotionByCode(site, promoCode);
  if (!promo) return { site: targetSiteId, error: `Promo "${promoCode}" not found` };

  // 2. Per-currency config
  const cRes = await authedFetch(site, `/api/bo/promotioncurrency?promotion_id=${promo.id}`);
  const currencies = (cRes?.data?.rows || []).map(c => ({
    currency: c.currency,
    min_deposit: nz(c.min_deposit) ?? nz(c.min_transfer),
    min_transfer: nz(c.min_transfer),
    bonus_rate: nz(c.bonus_rate),
    max_bonus: nz(c.max_bonus),
    max_transfer_out: nz(c.max_transfer_out),
    free_credit_amount: nz(c.free_credit_amount),
    rounds: c.rounds || null,
    amount_per_line: nz(c.amount_per_line),
    lines: c.lines || null,
    value_per_spin: (nz(c.amount_per_line) && c.lines) ? Number(c.amount_per_line) * c.lines : null,
  }));

  // 3. Message template (inbox)
  let inboxDetails = null;
  if (promo.message_template_id) {
    try {
      const tmplRes = await authedFetch(site, `/api/bo/messagetemplate/${promo.message_template_id}`);
      const raw = tmplRes?.data?.message_details || {};
      inboxDetails = Object.values(raw).map(d => ({
        locale_id: d.settings_locale_id,
        locale: LOCALE_NAMES[d.settings_locale_id] || `locale_${d.settings_locale_id}`,
        subject: d.subject,
        message: d.message,
      }));
    } catch (e) {
      inboxDetails = null;
    }
  }

  // 4. SMS templates (from listing response)
  const smsTemplates = (promo.sms_message_templates || []).map(s => ({
    locale_id: s.settings_locale_id,
    locale: LOCALE_NAMES[s.settings_locale_id] || `locale_${s.settings_locale_id}`,
    subject: s.subject,
    message: s.message,
  }));

  // 5. Inbox templates from listing (fallback if detail fails)
  const listingInbox = (promo.message_templates || []).map(t => ({
    locale_id: t.settings_locale_id,
    locale: LOCALE_NAMES[t.settings_locale_id] || `locale_${t.settings_locale_id}`,
    subject: t.subject,
    message: t.message,
  }));

  const inbox = inboxDetails || listingInbox;

  return {
    site: targetSiteId,
    promo_id: promo.id,
    code: promo.code,
    name: promo.name,
    status: promo.status,
    bonus_type: promo.bonus_type || `type_${promo.promo_type}`,
    promo_type: promo.promo_type,
    turnover: nz(promo.target?.[0]?.multiplier ?? promo.target?.multiplier),
    game_code: promo.free_spin_game_code || null,
    game_provider: promo.game_provider || null,
    message_template_id: promo.message_template_id,
    sms_template_id: promo.message_template_sms_id,
    currencies,
    inbox,
    sms: smsTemplates,
  };
}

function valuesOf(value) {
  return Array.isArray(value) ? value : Object.values(value || {});
}

function idsOf(value) {
  return valuesOf(value).map(v => Number(typeof v === 'object' ? (v.id ?? v.category_id) : v)).filter(Number.isFinite);
}

async function fetchDiscoveryCandidate(site, row, categoryById) {
  const [detailRes, currencyRes] = await Promise.all([
    authedFetch(site, `/api/bo/promotion/${row.id}`),
    authedFetch(site, `/api/bo/promotioncurrency?promotion_id=${row.id}`),
  ]);
  const detail = detailRes?.data?.rows || detailRes?.data || row;
  const currencies = (currencyRes?.data?.rows || []).map(c => ({
    currency: c.currency,
    min_deposit: nz(c.min_deposit) ?? nz(c.min_transfer),
    min_transfer: nz(c.min_transfer),
    bonus_rate: nz(c.bonus_rate),
    max_bonus: nz(c.max_bonus),
  }));
  const qp2CategoryIds = idsOf(detail.promotion_category_ids);
  const categoryIds = qp2CategoryIds.length ? qp2CategoryIds
    : valuesOf(detail.promotion_category).map(c => Number(c.category_id)).filter(Number.isFinite);
  return {
    id: row.id, code: detail.code || row.code, name: detail.name || row.name,
    status: Number(detail.status ?? row.status), promo_type: Number(detail.promo_type ?? row.promo_type),
    bonus_type: detail.bonus_type || row.bonus_type,
    merchant_ids: idsOf(valuesOf(detail.merchant_ids).length ? detail.merchant_ids : row.merchant_ids),
    categories: categoryIds.map(id => categoryById.get(id) || `id:${id}`), currencies,
    message_template_id: detail.message_template_id || row.message_template_id || null,
    turnover: nz(detail.target?.[0]?.multiplier ?? detail.target?.multiplier),
  };
}

async function discoverPromos(targetSiteId, requestText) {
  const site = getSite(targetSiteId);
  const facts = parseDiscoveryQuery(requestText);
  const [listRes, categories] = await Promise.all([
    authedFetch(site, '/api/bo/promotion?perPage=999&page=1&status=1'), getAllCategories(site),
  ]);
  const categoryById = new Map(categories.map(c => [Number(c.id), c.name]));
  const plausible = (listRes?.data?.rows || []).filter(row => {
    const assigned = !facts.merchant_id || idsOf(row.merchant_ids).includes(facts.merchant_id);
    const text = `${row.code || ''} ${row.name || ''} ${row.bonus_type || ''}`;
    return assigned && Number(row.status) === 1 && (!facts.welcome || /welc|welcome/i.test(text));
  });
  const hydrated = [];
  for (let i = 0; i < plausible.length; i += 8) {
    hydrated.push(...await Promise.all(plausible.slice(i, i + 8).map(row => fetchDiscoveryCandidate(site, row, categoryById))));
  }
  const ranked = rankCandidates(hydrated, facts);
  const top = ranked.candidates.slice(0, 3);
  const winner = top[0];
  if (winner?.message_template_id) {
    const tmplRes = await authedFetch(site, `/api/bo/messagetemplate/${winner.message_template_id}`);
    const details = Object.values(tmplRes?.data?.message_details || {});
    const myTemplate = details.find(d => [1, 3].includes(Number(d.settings_locale_id))) || details[0];
    const terms = extractTemplateTerms(myTemplate?.message || '', facts.currency || 'MYR');
    winner.template_terms = terms;
    winner.mismatches = [];
    const cc = winner.matched_currency || {};
    for (const [field, boValue] of Object.entries({ min_deposit: cc.min_deposit, bonus_rate: cc.bonus_rate, max_bonus: cc.max_bonus, turnover: winner.turnover })) {
      if (boValue != null && terms[field] != null && Math.abs(boValue - terms[field]) >= 0.01) {
        winner.mismatches.push({ severity: 'HIGH', type: field, bo_value: boValue, template_value: terms[field], detail: `BO ${field}=${boValue} but template says ${terms[field]}` });
      }
    }
  }
  return { mode: 'discover', site: targetSiteId, query: requestText, facts, confidence: ranked.confidence, margin: ranked.margin, candidates: top };
}

// ── Mismatch detection ─────────────────────────────────────────────────────
function detectMismatches(data) {
  const mismatches = [];
  if (data.error) return mismatches;

  const currMap = {};
  for (const c of data.currencies) currMap[c.currency] = c;

  for (const tmpl of data.inbox || []) {
    const currency = LOCALE_CURRENCY[tmpl.locale_id];
    const cc = currMap[currency];
    if (!cc || !tmpl.message) continue;

    const amounts = extractAmounts(tmpl.message, currency);

    // QP2 stores this in min_deposit; older promos may use min_transfer.
    if (cc.min_deposit && amounts.length > 0) {
      if (!amounts.includes(cc.min_deposit)) {
        mismatches.push({
          type: 'min_deposit',
          severity: 'HIGH',
          locale: tmpl.locale,
          currency,
          bo_value: cc.min_deposit,
          template_values: amounts,
          detail: `BO min_deposit=${cc.min_deposit} but template mentions ${currency} ${amounts.join(', ')}`,
        });
      }
    }

    // spin count check (FS promos)
    if (cc.rounds) {
      const templateSpins = extractSpinCount(tmpl.message);
      if (templateSpins && templateSpins !== cc.rounds) {
        mismatches.push({
          type: 'spin_count',
          severity: 'HIGH',
          locale: tmpl.locale,
          currency,
          bo_value: cc.rounds,
          template_value: templateSpins,
          detail: `BO rounds=${cc.rounds} but template says ${templateSpins} free spins`,
        });
      }
    }

    // free_credit_amount check (FC promos)
    if (cc.free_credit_amount) {
      if (!amounts.includes(cc.free_credit_amount)) {
        mismatches.push({
          type: 'free_credit_amount',
          severity: 'MEDIUM',
          locale: tmpl.locale,
          currency,
          bo_value: cc.free_credit_amount,
          template_values: amounts,
          detail: `BO free_credit_amount=${cc.free_credit_amount} not found in template amounts`,
        });
      }
    }
  }

  // Game name check (FS promos)
  if (data.game_code) {
    for (const tmpl of data.inbox || []) {
      if (!tmpl.message) continue;
      const gameName = extractGameName(tmpl.message);
      if (gameName) {
        // Just surface for manual review — game code→name mapping is complex
        mismatches.push({
          type: 'game_name_info',
          severity: 'INFO',
          locale: tmpl.locale,
          bo_game_code: data.game_code,
          template_game_name: gameName,
          detail: `BO game_code="${data.game_code}", template references "${gameName}"`,
        });
        break; // one is enough
      }
    }
  }

  return mismatches;
}

// ── Cross-brand check ──────────────────────────────────────────────────────
async function crossBrandCheck(promoCode, sourceSiteId) {
  const cfg = loadConfig();
  const platform = sourceSiteId.replace(/\d+$/, '').replace(/[a-d]$/, '');
  const siblings = Object.keys(cfg.sites).filter(s =>
    s.startsWith(platform) && s !== sourceSiteId
  );

  const results = [];
  for (const sibId of siblings) {
    try {
      const site = cfg.sites[sibId];
      const res = await authedFetch(site, `/api/bo/promotion?perPage=5&page=1&code=${encodeURIComponent(promoCode)}`);
      const row = (res?.data?.rows || []).find(r => r.code === promoCode);
      if (!row) { results.push({ site: sibId, found: false }); continue; }

      const cRes = await authedFetch(site, `/api/bo/promotioncurrency?promotion_id=${row.id}`);
      const currencies = (cRes?.data?.rows || []).map(c => ({
        currency: c.currency,
        min_transfer: nz(c.min_transfer),
        rounds: c.rounds || null,
        free_credit_amount: nz(c.free_credit_amount),
      }));

      results.push({ site: sibId, found: true, promo_id: row.id, currencies });
    } catch (e) {
      results.push({ site: sibId, error: e.message.slice(0, 80) });
    }
  }
  return results;
}

// ── Run ────────────────────────────────────────────────────────────────────
if (discoverMode) {
  const result = await discoverPromos(siteId, query);
  if (jsonOut) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`\n=== Promo discovery on ${result.site} ===`);
    console.log(`Confidence: ${result.confidence} (top margin ${result.margin})`);
    for (const [index, candidate] of result.candidates.entries()) {
      console.log(`\n${index + 1}. ${candidate.code} — score ${candidate.score}`);
      console.log(`   Evidence: ${candidate.evidence.join('; ') || 'none'}`);
      if (candidate.contradictions.length) console.log(`   Rejected clues: ${candidate.contradictions.join('; ')}`);
      for (const mismatch of candidate.mismatches || []) console.log(`   [${mismatch.severity}] ${mismatch.detail}`);
    }
  }
  process.exit(0);
}

const data = await fetchPromoData(siteId, code);
const mismatches = detectMismatches(data);

if (crossBrand && !data.error) {
  data.crossBrand = await crossBrandCheck(code, siteId);
}

if (jsonOut) {
  console.log(JSON.stringify({ ...data, mismatches }, null, 2));
} else {
  // Human-readable output
  if (data.error) {
    console.log(`ERROR: ${data.error}`);
    process.exit(1);
  }

  console.log(`\n=== ${data.code} on ${data.site} ===`);
  console.log(`Name: ${data.name}`);
  console.log(`Status: ${data.status === 1 ? 'Active' : data.status === 0 ? 'Inactive' : data.status}`);
  console.log(`Bonus type: ${data.bonus_type} (promo_type=${data.promo_type})`);
  if (data.game_code) console.log(`Game: ${data.game_code} (${data.game_provider})`);
  console.log(`Inbox template: ${data.message_template_id || 'NONE'}`);
  console.log(`SMS template: ${data.sms_template_id || 'NONE'}`);

  console.log('\n--- Per-Currency Config ---');
  for (const c of data.currencies) {
    const parts = [`${c.currency}: min_deposit=${c.min_deposit || '-'}`];
    if (c.bonus_rate) parts.push(`bonus_rate=${c.bonus_rate}%`);
    if (c.rounds) parts.push(`rounds=${c.rounds}`);
    if (c.free_credit_amount) parts.push(`fc_amount=${c.free_credit_amount}`);
    if (c.max_bonus) parts.push(`max_bonus=${c.max_bonus}`);
    if (c.value_per_spin) parts.push(`value_per_spin=${c.value_per_spin}`);
    console.log(`  ${parts.join(', ')}`);
  }

  console.log('\n--- Inbox Template Amounts ---');
  for (const tmpl of data.inbox || []) {
    const currency = LOCALE_CURRENCY[tmpl.locale_id];
    const amounts = tmpl.message ? extractAmounts(tmpl.message, currency) : [];
    const spins = tmpl.message ? extractSpinCount(tmpl.message) : null;
    const parts = [`${tmpl.locale}: ${currency} amounts=[${amounts.join(', ')}]`];
    if (spins) parts.push(`spins=${spins}`);
    console.log(`  ${parts.join(', ')}`);
  }

  if (data.sms?.length) {
    console.log('\n--- SMS Template ---');
    for (const s of data.sms) {
      const currency = LOCALE_CURRENCY[s.locale_id];
      const amounts = s.message ? extractAmounts(s.message, currency) : [];
      console.log(`  ${s.locale}: amounts=[${amounts.join(', ')}]`);
    }
  }

  console.log('\n--- Mismatches ---');
  const real = mismatches.filter(m => m.severity !== 'INFO');
  const info = mismatches.filter(m => m.severity === 'INFO');
  if (real.length === 0) {
    console.log('  No mismatches found.');
  } else {
    for (const m of real) {
      console.log(`  [${m.severity}] ${m.type} (${m.locale}): ${m.detail}`);
    }
  }
  if (info.length > 0) {
    console.log('\n--- Info ---');
    for (const m of info) {
      console.log(`  ${m.detail}`);
    }
  }

  if (data.crossBrand) {
    console.log('\n--- Cross-Brand Comparison ---');
    for (const cb of data.crossBrand) {
      if (!cb.found) { console.log(`  ${cb.site}: not found`); continue; }
      if (cb.error) { console.log(`  ${cb.site}: error — ${cb.error}`); continue; }
      for (const c of cb.currencies) {
        const parts = [`${cb.site} ${c.currency}: min_transfer=${c.min_transfer || '-'}`];
        if (c.rounds) parts.push(`rounds=${c.rounds}`);
        if (c.free_credit_amount) parts.push(`fc_amount=${c.free_credit_amount}`);
        console.log(`  ${parts.join(', ')}`);
      }
    }
  }
}

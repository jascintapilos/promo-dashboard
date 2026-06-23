#!/usr/bin/env node
// Promo Troubleshoot — pulls BO config + templates and cross-checks for mismatches.
// Usage:
//   node scripts/troubleshoot.mjs <promo_code> <site_id> [--cross-brand] [--json]
//
// Requires: promo-automation project at the path below.

import { resolve } from 'path';
import { pathToFileURL } from 'url';

const PROJ = 'C:/Users/vdiuser/Downloads/promo-automation/promo-automation';
const { authedFetch, findPromotionByCode } = await import(pathToFileURL(resolve(PROJ, 'src/api-client.js')).href);
const { getSite, loadConfig } = await import(pathToFileURL(resolve(PROJ, 'src/sites.js')).href);

const args = process.argv.slice(2);
const code = args.find(a => !a.startsWith('-'));
const siteId = args.filter(a => !a.startsWith('-'))[1];
const crossBrand = args.includes('--cross-brand');
const jsonOut = args.includes('--json');

if (!code || !siteId) {
  console.error('Usage: troubleshoot.mjs <promo_code> <site_id> [--cross-brand] [--json]');
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
    min_transfer: nz(c.min_transfer),
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
    game_code: promo.free_spin_game_code || null,
    game_provider: promo.game_provider || null,
    message_template_id: promo.message_template_id,
    sms_template_id: promo.message_template_sms_id,
    currencies,
    inbox,
    sms: smsTemplates,
  };
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

    // min_transfer check
    if (cc.min_transfer && amounts.length > 0) {
      const minInMsg = Math.min(...amounts);
      if (!amounts.includes(cc.min_transfer)) {
        mismatches.push({
          type: 'min_transfer',
          severity: 'HIGH',
          locale: tmpl.locale,
          currency,
          bo_value: cc.min_transfer,
          template_values: amounts,
          detail: `BO min_transfer=${cc.min_transfer} but template mentions ${currency} ${amounts.join(', ')}`,
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
    const parts = [`${c.currency}: min_transfer=${c.min_transfer || '-'}`];
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

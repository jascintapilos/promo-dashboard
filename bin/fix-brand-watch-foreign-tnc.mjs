#!/usr/bin/env node
// Remediation: brand-watch 2026-07-07 foreign-tnc-domain FAILs (5 promos).
// Cross-brand MT clones missed the tncDomain swap
// (feedback_cross_brand_mt_swap_tncdomain). Two leak shapes, probed live:
//   1. T&C anchor href on the SOURCE brand's tncDomain
//      (QPRO10←QPRO1/bp9mys.com, QPRO7←QPRO5/u388my.net) → swap the URL
//      origin to the owning brand's tncDomain, path preserved.
//   2. Stray empty anchor `<a href="https://king333mys.com/promotion?...">
//      </a>` (whitespace-only text) left beside the correct own-brand link
//      (QPRO8 ×3, ZH clause 1) → remove the anchor, keep its whitespace.
// Any other foreign-domain occurrence is flagged manual_review and left
// untouched (high-precision, same philosophy as src/mt-content-checks.js).
//
//   node bin/fix-brand-watch-foreign-tnc.mjs            ← dry-run (probe + plan)
//   node bin/fix-brand-watch-foreign-tnc.mjs --commit   ← live PUT + verify
//
// PUT shape per project_message_template_put_api: name+section+type+status+
// details, ALL locales included even when unchanged.

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';
import { buildDomainToBrand, buildHostContext, checkMtContent, hostOf } from '../src/mt-content-checks.js';
import { qcMtTncHyperlink } from '../src/qc-mt-tnc.js';
import { readFileSync, mkdirSync, appendFileSync } from 'node:fs';
import path from 'node:path';

const commit = process.argv.includes('--commit');

// From captures/brand-watch-report.json run 2026-07-07T06:09Z.
const TARGETS = [
  { site: 'qpro10', brand: 'QPRO10', code: 'REL_188FS_GOO_RET_190225', expectForeign: 'bp9mys.com' },
  { site: 'qpro7',  brand: 'QPRO7',  code: 'FT_REL128FS_FOO',          expectForeign: 'u388my.net' },
  { site: 'qpro8',  brand: 'QPRO8',  code: 'FT_REL_98FS_SC_5X',        expectForeign: 'king333mys.com' },
  { site: 'qpro8',  brand: 'QPRO8',  code: 'FT_REL_98FS_CBBB_5X',      expectForeign: 'king333mys.com' },
  { site: 'qpro8',  brand: 'QPRO8',  code: 'FT_REL_98FS_CBS_5X',       expectForeign: 'king333mys.com' },
];

const DIR = JSON.parse(readFileSync('data/brand-directory.json', 'utf8'));
const domainToBrand = buildDomainToBrand();
const URL_RE = /https?:\/\/[^\s"'<>]+/gi;
const objVals = (o) => (o == null ? [] : Array.isArray(o) ? o : Object.values(o));

const tncOriginFor = (brand) => String(DIR.qpro[brand].tncDomain).replace(/\/+$/, '');

// Swap foreign directory-domain URLs in one HTML string. Returns
// { out, swaps: [{kind, from, to}], manual: [url] }.
function swapForeign(html, brand) {
  const swaps = [];
  const manual = [];
  let out = html;

  // Shape 2 first: whitespace-only anchors on a foreign domain → drop whole
  // anchor, keep its inner whitespace so surrounding text spacing survives.
  out = out.replace(/<a\b[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*>(\s|&nbsp;)*<\/a>/gi, (m, url) => {
    const h = hostOf(url);
    if (!(h && domainToBrand.has(h) && domainToBrand.get(h) !== brand)) return m;
    swaps.push({ kind: 'drop-empty-anchor', from: url, to: '(removed)' });
    return ' ';
  });

  // Shape 1: remaining foreign URLs — swap origin only when the path is the
  // QPRO T&C path; anything else is out of pattern → manual review.
  for (const url of [...new Set(out.match(URL_RE) || [])]) {
    const h = hostOf(url);
    if (!(h && domainToBrand.has(h) && domainToBrand.get(h) !== brand)) continue;
    if (/\/info-center\/terms-and-conditions/i.test(url)) {
      const to = url.replace(/^https?:\/\/[^/]+/i, tncOriginFor(brand));
      out = out.split(url).join(to);
      swaps.push({ kind: 'origin-swap', from: url, to });
    } else {
      manual.push(url);
    }
  }
  return { out, swaps, manual };
}

const OUT = path.resolve('captures/provider-fix-runs'); mkdirSync(OUT, { recursive: true });
const logFile = path.join(OUT, `foreign-tnc-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
const log = (ev) => appendFileSync(logFile, JSON.stringify({ ts: new Date().toISOString(), ...ev }) + '\n');

console.log(`${commit ? 'LIVE (--commit)' : 'DRY-RUN'} — foreign-tnc-domain MT remediation (5 promos)\n`);

const results = [];
for (const t of TARGETS) {
  const site = getSite(t.site);
  const res = { ...t, status: 'pending' };
  results.push(res);
  console.log(`━━━━━━ ${t.brand} :: ${t.code} ━━━━━━`);
  try {
    const listing = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(t.code)}&perPage=10`);
    const promo = objVals(listing.data?.rows).find((p) => p.code === t.code);
    if (!promo) { res.status = 'not_found'; console.log('  ✗ code not found on BO\n'); continue; }
    res.promo_id = promo.id;
    res.mt_id = promo.message_template_id;
    res.popup_count = objVals(promo.dialog_popup_list).length;
    console.log(`  promo id=${promo.id} status=${promo.status} mt_id=${promo.message_template_id} dialog_popups=${res.popup_count}`);
    if (!promo.message_template_id) { res.status = 'no_mt'; console.log('  ✗ no message template attached\n'); continue; }

    const mtRes = await authedFetch(site, `/api/bo/messagetemplate/${promo.message_template_id}`);
    const meta = mtRes.data?.message_template;
    const existing = mtRes.data?.message_details || {};
    if (!meta) throw new Error(`message template ${promo.message_template_id} not found`);

    const newDetails = {};
    const swaps = [];
    const manual = [];
    for (const [localeId, entry] of Object.entries(existing)) {
      const locale = entry.settings_locales_code || `locale_${localeId}`;
      let subject = entry.subject || '';
      let message = entry.message || '';
      for (const field of ['subject', 'message']) {
        const r = swapForeign(field === 'subject' ? subject : message, t.brand);
        for (const s of r.swaps) console.log(`  ${locale} ${field} [${s.kind}]: ${s.from}  →  ${s.to}`);
        for (const u of r.manual) console.log(`  ${locale} ${field} [MANUAL REVIEW — untouched]: ${u}`);
        swaps.push(...r.swaps.map((s) => ({ locale, field, ...s })));
        manual.push(...r.manual.map((u) => ({ locale, field, url: u })));
        if (field === 'subject') subject = r.out; else message = r.out;
      }
      newDetails[localeId] = { settings_locale_id: Number(localeId), subject, message };
    }
    res.swaps = swaps.length;
    res.manual = manual.length;
    if (manual.length) { res.status = 'manual_review'; console.log('  ⚠ out-of-pattern foreign URL(s) — not auto-fixing this MT, needs eyes\n'); log({ event: 'manual', ...res, manualUrls: manual }); continue; }
    if (!swaps.length) { res.status = 'clean_already'; console.log('  ✓ no foreign directory domains found — already clean\n'); continue; }

    if (!commit) { res.status = 'would_fix'; console.log(`  ~ would PUT MT ${promo.message_template_id} (${swaps.length} swap(s) across ${Object.keys(newDetails).length} locale(s))\n`); log({ event: 'dry-run', ...res }); continue; }

    await authedFetch(site, `/api/bo/messagetemplate/${promo.message_template_id}`, {
      method: 'PUT',
      body: { name: meta.name, section: meta.section, type: meta.type, status: meta.status, details: newDetails },
    });

    // Verify: re-GET, re-run the exact brand-watch content check + T&C hyperlink QC.
    const after = (await authedFetch(site, `/api/bo/messagetemplate/${promo.message_template_id}`)).data?.message_details || {};
    const bad = Object.entries(newDetails).filter(([lid, nd]) => after[lid]?.message !== nd.message || after[lid]?.subject !== nd.subject);
    const cand = {
      platform: 'qpro', brand: t.brand,
      messageTemplates: Object.values(after).map((d) => ({ settings_locale_id: d.settings_locale_id, subject: d.subject, message: d.message })),
    };
    const contentFindings = checkMtContent(cand, { domainToBrand });
    const tnc = await qcMtTncHyperlink(site, promo.message_template_id, 'qpro', buildHostContext(t.brand, domainToBrand));
    const tncFail = Object.values(tnc.checks).some((v) => v === false);
    if (!bad.length && !contentFindings.length && !tncFail) {
      res.status = 'fixed_verified';
      console.log(`  ✓ MT ${promo.message_template_id} saved + verified (${swaps.length} swap(s); foreign-domain check clean; T&C anchor OK)`);
    } else {
      res.status = 'verify_failed';
      res.verify = { bad: bad.map(([lid]) => lid), contentFindings: contentFindings.map((f) => f.message), tncFail };
      console.log(`  ✗ verify failed — locales_mismatch=[${res.verify.bad}] content=[${res.verify.contentFindings}] tncFail=${tncFail}`);
      tnc.messages.forEach((m) => console.log(`   ${m}`));
    }
    log({ event: 'commit', ...res });
  } catch (e) {
    res.status = 'error';
    res.error = String(e.message || e).split('\n').slice(0, 2).join(' | ').slice(0, 240);
    console.log(`  ✗ ERROR — ${res.error}`);
    log({ event: 'error', ...res });
    if (commit) { console.log('\n*** STOPPING — error during live run. Investigate before continuing. ***'); break; }
  }
  console.log('');
}

console.log('── Summary ──');
for (const r of results) console.log(`  ${r.brand.padEnd(7)} ${r.code.padEnd(26)} ${String(r.status).padEnd(16)} swaps=${r.swaps ?? '-'} popups=${r.popup_count ?? '?'}${r.error ? ' — ' + r.error : ''}`);
if (!commit) console.log('\nDry-run — re-run with --commit to apply.');
console.log(`Log → ${path.relative(process.cwd(), logFile)}`);

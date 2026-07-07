// MT content checks that run on the promotion LIST response — the QPRO/QP2
// listing embeds every message template's full subject+HTML per locale
// (confirmed live 2026-07-07), so these cost zero extra fetches and run
// estate-wide daily in brand-watch.
//
// High-precision by design: the only hard failure is a brand domain that
// provably doesn't belong in this MT (cross-brand clone that missed the
// tncDomain swap — feedback_cross_brand_mt_swap_tncdomain — or a literal
// domain baked into a shared-BO QP2 template where only the :url
// placeholder is correct). Unknown domains never fail.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'brand-directory.json'), 'utf8'));

export function hostOf(url) {
  const m = String(url || '').match(/^https?:\/\/([^/\s"'<>]+)/i);
  return m ? m[1].replace(/^www\./i, '').toLowerCase() : '';
}

// host → brand key, across the qpro + qp2 sections of the brand directory.
export function buildDomainToBrand() {
  const map = new Map();
  for (const section of ['qpro', 'qp2']) {
    for (const [brand, info] of Object.entries(DIR[section] || {})) {
      for (const u of [info.website, info.tncDomain, ...(info.aliases || [])]) {
        const h = hostOf(u);
        if (h) map.set(h, brand);
      }
    }
  }
  return map;
}

// Own/foreign host context for one brand — the opts shape qcMtTncHyperlink
// accepts (src/qc-mt-tnc.js).
export function buildHostContext(brand, domainToBrand = buildDomainToBrand()) {
  const ownHosts = new Set();
  const foreignHostToBrand = new Map();
  for (const [host, b] of domainToBrand) {
    if (b === brand) ownHosts.add(host);
    else foreignHostToBrand.set(host, b);
  }
  return { ownHosts, foreignHostToBrand };
}

const URL_RE = /https?:\/\/[^\s"'<>]+/gi;

// Listing-level MT body scan for one candidate (QPRO/QP2 only).
// cand.messageTemplates = the listing's message_templates array
// [{settings_locale_id, subject, message}, ...].
// Returns findings in the structural-checks shape.
export function checkMtContent(cand, { domainToBrand }) {
  const mts = cand.messageTemplates || [];
  if (!mts.length) return [];
  const hits = new Map(); // host → owning brand (directory hosts found in bodies)
  for (const mt of mts) {
    for (const url of `${mt.subject || ''}\n${mt.message || ''}`.match(URL_RE) || []) {
      const h = hostOf(url);
      if (h && domainToBrand.has(h)) hits.set(h, domainToBrand.get(h));
    }
  }
  if (!hits.size) return [];

  if (cand.platform === 'qp2') {
    // Shared 4-merchant BO: templates must use the :url placeholder; ANY
    // literal directory domain (own merchant's included) is wrong.
    const list = [...hits.entries()].map(([h, b]) => `${h} (${b})`).join(', ');
    return [{ severity: 'FAIL', check: 'qp2-literal-domain', message: `MT body hardcodes brand domain(s) ${list} — QP2 shared BO must use the :url placeholder (feedback_promo_template_placeholders)` }];
  }
  // QPRO: own-brand domains are correct (that's the renderer's convention);
  // a DIFFERENT brand's domain is the cross-brand clone leak.
  const foreign = [...hits.entries()].filter(([, b]) => b !== cand.brand);
  if (foreign.length) {
    const list = foreign.map(([h, b]) => `${h} (belongs to ${b})`).join(', ');
    return [{ severity: 'FAIL', check: 'foreign-tnc-domain', message: `MT body links to another brand's domain: ${list} — cross-brand clone missed the tncDomain swap` }];
  }
  return [];
}

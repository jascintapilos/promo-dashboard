// QC check: verify message template T&C hyperlink per platform.
//
// Both QPRO and QP2: T&C <li> must contain <a href=":url/terms-conditions">
// wrapping the localized term. The BO substitutes :url per-brand at display time.

import { authedFetch } from './api-client.js';

const TNC_TERM = {
  EN: 'Terms and Conditions',
  ZH: '条款与条件',
  ID: 'Syarat dan Ketentuan',
};

function docKeyFromLocaleCode(code) {
  if (!code) return 'EN';
  if (code.endsWith('_ZH')) return 'ZH';
  if (code.endsWith('_ID')) return 'ID';
  return 'EN';
}

// Returns { checks: {locale: bool}, messages: [string] }
// opts (optional): { ownHosts: Set<host>, foreignHostToBrand: Map<host, brand> }
// — pass via buildHostContext() to enable the QPRO foreign-domain check;
// omitted = anchors to unclassified domains pass with a note.
export async function qcMtTncHyperlink(site, templateId, platform, opts = {}) {
  const checks = {};
  const messages = [];
  const isQpro = /^qpro/i.test(platform);

  let data;
  try {
    const res = await authedFetch(site, `/api/bo/messagetemplate/${templateId}`);
    data = res?.data?.rows || res?.data;
  } catch (e) {
    messages.push(`MT T&C: could not fetch template ${templateId}: ${e.message}`);
    return { checks: { MT_TnC_fetch: false }, messages };
  }

  const details = data?.message_details || {};
  if (Object.keys(details).length === 0) {
    messages.push('MT T&C: no locale details found');
    return { checks: { MT_TnC_empty: false }, messages };
  }

  for (const [localeId, entry] of Object.entries(details)) {
    const localeCode = entry.settings_locales_code || `locale_${localeId}`;
    const dk = docKeyFromLocaleCode(localeCode);
    const term = TNC_TERM[dk] || TNC_TERM.EN;
    const html = entry.message || '';

    // Find the T&C <li> — the one containing the brand placeholder + "apply" / "berlaku" / "适用"
    const tncLiMatch = html.match(/<li>[^]*?(?::brandname|:merchantname)[^]*?<\/li>/i);
    if (!tncLiMatch) {
      // Some locales (e.g. ID on QPRO) may not have T&C — skip without failing
      messages.push(`  ${localeCode}: no T&C <li> found — skipped`);
      continue;
    }
    const tncLi = tncLiMatch[0];

    const key = `MT_TnC_${localeCode}`;
    const isQp2 = !isQpro && String(platform || '').toLowerCase() === 'qp2';

    if (isQp2) {
      // QP2: :url/terms-conditions must appear as plain text in the <li>.
      // The BO substitutes :url at display time as text — NOT inside href attributes.
      // Wrapping in <a href=":url/..."> produces a broken link (verified 2026-06-25).
      const hasPlainUrl = /:url\/terms-conditions/.test(tncLi);
      const hasTerm = tncLi.includes(term);
      if (hasPlainUrl && hasTerm) {
        checks[key] = true;
        messages.push(`  ${localeCode}: ✓ "${term}" with :url placeholder (plain text, QP2 style)`);
      } else {
        checks[key] = false;
        const reasons = [];
        if (!hasTerm) reasons.push(`"${term}" not found in T&C li`);
        if (!hasPlainUrl) reasons.push(':url/terms-conditions plain text missing');
        messages.push(`  ${localeCode}: ✗ ${reasons.join('; ')}`);
      }
    } else {
      // QPRO — reconciled with message-template-renderer.js attempt-3
      // (2026-07-07; the old branch here demanded href=":url/..." which the
      // current renderer no longer produces). Estate reality is mixed
      // generations, all acceptable:
      //   gen1  <a href=":url/terms-conditions">term</a>       (legacy, live-verified common)
      //   gen2  <a href="https://<own-domain>/...">term</a>    (attempt 2, double-quoted)
      //   gen3  <a href='https://<own-domain>/...'>term</a>    (attempt 3, single-quoted)
      // Hard failure is a FOREIGN brand domain in the anchor (cross-brand MT
      // clone that missed the tncDomain swap) or no anchor/term at all.
      const termWrapped = new RegExp(`<a[^>]*>${term}</a>`, 'i').test(tncLi);
      const hrefMatch = tncLi.match(/<a[^>]*href=["']([^"']+)["'][^>]*>/i);
      const href = hrefMatch?.[1] || '';
      const hrefHost = (href.match(/^https?:\/\/([^/]+)/i)?.[1] || '').replace(/^www\./i, '').toLowerCase();
      const { ownHosts = null, foreignHostToBrand = null } = opts;

      if (!termWrapped) {
        checks[key] = false;
        messages.push(`  ${localeCode}: ✗ "${term}" not wrapped in <a>`);
      } else if (href.includes(':url')) {
        checks[key] = true;
        messages.push(`  ${localeCode}: ✓ hyperlinked "${term}" with :url placeholder (legacy style)`);
      } else if (foreignHostToBrand && hrefHost && foreignHostToBrand.has(hrefHost)) {
        checks[key] = false;
        messages.push(`  ${localeCode}: ✗ T&C anchor points at ANOTHER brand's domain (${hrefHost} = ${foreignHostToBrand.get(hrefHost)}) — cross-brand clone missed the tncDomain swap`);
      } else if (ownHosts && hrefHost && ownHosts.has(hrefHost)) {
        checks[key] = true;
        messages.push(`  ${localeCode}: ✓ hyperlinked "${term}" to own brand domain (${hrefHost})`);
      } else if (hrefHost) {
        // Anchored to a domain we can't classify (no directory context passed,
        // or a host outside the directory). Content-checks-not-byte-equality:
        // don't fail on unknowns, but say what we saw.
        checks[key] = true;
        messages.push(`  ${localeCode}: ✓ hyperlinked "${term}" (${hrefHost}${ownHosts ? ' — not in brand directory, unverified' : ''})`);
      } else {
        checks[key] = false;
        messages.push(`  ${localeCode}: ✗ anchor has no usable href`);
      }
    }
  }

  return { checks, messages };
}

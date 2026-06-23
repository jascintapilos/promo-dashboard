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
export async function qcMtTncHyperlink(site, templateId, platform) {
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

    const hrefHasUrlPlaceholder = /href=":url\/terms-conditions"/.test(tncLi);
    const termWrapped = new RegExp(`<a[^>]*>${term}</a>`, 'i').test(tncLi);

    const key = `MT_TnC_${localeCode}`;

    // Both QPRO and QP2: term must be wrapped in <a href=":url/terms-conditions">
    if (termWrapped && hrefHasUrlPlaceholder) {
      checks[key] = true;
      messages.push(`  ${localeCode}: ✓ hyperlinked "${term}" with :url placeholder`);
    } else {
      checks[key] = false;
      const reasons = [];
      if (!termWrapped) reasons.push(`"${term}" not wrapped in <a>`);
      if (!hrefHasUrlPlaceholder) reasons.push('href=":url/terms-conditions" missing');
      messages.push(`  ${localeCode}: ✗ ${reasons.join('; ')}`);
    }
  }

  return { checks, messages };
}

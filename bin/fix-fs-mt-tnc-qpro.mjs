#!/usr/bin/env node
// Fix QPRO4 FS message templates: remove :url/terms-conditions, wrap the
// T&C term in <a href="..."> per QPRO convention.

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const TNC_BASE = 'https://ye55my.com';
const TNC_URL = `${TNC_BASE}/en-my/info-center/terms-and-conditions`;

const TARGETS = [
  { templateId: 399, label: 'P001' },
  { templateId: 402, label: 'P004' },
  { templateId: 404, label: 'P006' },
];

const TNC_TERM = {
  EN: 'Terms and Conditions',
  ZH: '条款与条件',
  ID: 'Syarat dan Ketentuan',
};

function localeDocKey(code) {
  if (!code) return 'EN';
  if (code.endsWith('_ZH')) return 'ZH';
  if (code.endsWith('_ID')) return 'ID';
  return 'EN';
}

function patchHtml(html, dk) {
  let out = html;
  const term = TNC_TERM[dk] || TNC_TERM.EN;
  const link = `<a href="${TNC_URL}">${term}</a>`;

  // Remove :url/terms-conditions (may have been added by previous fix)
  out = out.replace(/\s*:url\/terms-conditions/g, '');

  // If the term is already wrapped in <a>, leave it
  if (out.includes(`<a href=`) && out.includes(term)) {
    return { patched: out, changed: out !== html };
  }

  // Wrap the bare term in the T&C <li> only (not in headings)
  // Match: <li>...Term...</li> where Term is not already in an <a>
  const liRe = new RegExp(`(<li>[^]*?)(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})([^]*?</li>)`);
  const m = out.match(liRe);
  if (m && !m[0].includes('<a ')) {
    out = out.replace(liRe, `$1${link}$3`);
  }

  return { patched: out, changed: out !== html };
}

const site = getSite('qpro4');

for (const t of TARGETS) {
  console.log(`\n── ${t.label} (template ${t.templateId}) ──`);
  const res = await authedFetch(site, `/api/bo/messagetemplate/${t.templateId}`);
  const data = res?.data?.rows || res?.data;
  if (!data?.message_template) { console.log('  ✗ fetch failed'); continue; }

  const tmpl = data.message_template;
  const msgDetails = data.message_details || {};
  const details = {};
  let totalChanges = 0;

  for (const [localeId, entry] of Object.entries(msgDetails)) {
    const dk = localeDocKey(entry.settings_locales_code);
    const { patched, changed } = patchHtml(entry.message || '', dk);
    details[localeId] = {
      settings_locale_id: entry.settings_locale_id,
      subject: entry.subject || '',
      message: patched,
    };
    if (changed) {
      totalChanges++;
      console.log(`  ${entry.settings_locales_code}: wrapped "${TNC_TERM[dk]}" + removed placeholder`);
    } else {
      console.log(`  ${entry.settings_locales_code}: no change needed`);
    }
  }

  if (totalChanges === 0) { console.log('  → skip'); continue; }

  const putBody = {
    name: tmpl.name,
    section: tmpl.section,
    type: tmpl.type,
    status: tmpl.status,
    details,
    code: tmpl.code,
  };
  try {
    const putRes = await authedFetch(site, `/api/bo/messagetemplate/${t.templateId}`, {
      method: 'PUT', body: putBody,
    });
    console.log(`  → PUT ${putRes?.success ? '✓' : '✗'} ${putRes?.message?.[0] || ''}`);
  } catch (e) {
    console.log(`  → PUT ✗ ${e.message}`);
  }
}

console.log('\nDone. Verifying...');
for (const t of TARGETS) {
  const res = await authedFetch(site, `/api/bo/messagetemplate/${t.templateId}`);
  const details = (res?.data?.rows || res?.data)?.message_details || {};
  const first = Object.values(details)[0];
  const snippet = (first?.message || '').match(/<li>[^<]*(?:<a [^>]*>[^<]*<\/a>)[^<]*<\/li>\s*\n\s*<\/ol>/);
  console.log(`  ${t.label}: ${snippet ? snippet[0].slice(0, 120) : 'NO MATCH — check manually'}`);
}

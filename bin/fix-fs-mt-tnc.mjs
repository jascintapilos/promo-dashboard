#!/usr/bin/env node
// One-shot: patch existing FS message templates to add :url/terms-conditions
// to the T&C line. Targets P001/P004/P006 on QPRO4 + QP2C.

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const TARGETS = [
  // QPRO4 — already done, skip
  // { siteId: 'qpro4', templateId: 399, label: 'P001 QPRO4' },
  // { siteId: 'qpro4', templateId: 402, label: 'P004 QPRO4' },
  // { siteId: 'qpro4', templateId: 404, label: 'P006 QPRO4' },
  // QP2C (site id = ibc22)
  { siteId: 'ibc22',  templateId: 1162, label: 'P001 QP2C' },
  { siteId: 'ibc22',  templateId: 1165, label: 'P004 QP2C' },
  { siteId: 'ibc22',  templateId: 1167, label: 'P006 QP2C' },
];

// Patterns to find the T&C line missing the hyperlink, per locale
const TNC_PATCHES = [
  // EN
  { find: /General\s+:brandname\s+Terms\s+and\s+Conditions\s+apply\.\s*<\/li>/i,
    test: /:url\/terms-conditions/,
    replace: (m) => m.replace(/<\/li>$/, ' :url/terms-conditions</li>') },
  // EN with :merchantname (QP2)
  { find: /General\s+:merchantname\s+Terms\s+and\s+Conditions\s+apply\.\s*<\/li>/i,
    test: /:url\/terms-conditions/,
    replace: (m) => m.replace(/<\/li>$/, ' :url/terms-conditions</li>') },
  // ZH
  { find: /适用\s*:brandname\s*一般条款与条件。\s*<\/li>/,
    test: /:url\/terms-conditions/,
    replace: (m) => m.replace(/<\/li>$/, ' :url/terms-conditions</li>') },
  { find: /适用\s*:merchantname\s*一般条款与条件。\s*<\/li>/,
    test: /:url\/terms-conditions/,
    replace: (m) => m.replace(/<\/li>$/, ' :url/terms-conditions</li>') },
  // ID
  { find: /Syarat\s+dan\s+Ketentuan\s+umum\s+:brandname\s+berlaku\.\s*<\/li>/i,
    test: /:url\/terms-conditions/,
    replace: (m) => m.replace(/<\/li>$/, ' :url/terms-conditions</li>') },
  { find: /Syarat\s+dan\s+Ketentuan\s+umum\s+:merchantname\s+berlaku\.\s*<\/li>/i,
    test: /:url\/terms-conditions/,
    replace: (m) => m.replace(/<\/li>$/, ' :url/terms-conditions</li>') },
];

function patchHtml(html) {
  let patched = html;
  let changes = 0;
  for (const rule of TNC_PATCHES) {
    const match = patched.match(rule.find);
    if (match && !rule.test.test(match[0])) {
      patched = patched.replace(rule.find, rule.replace);
      changes++;
    }
  }
  return { patched, changes };
}

for (const t of TARGETS) {
  const site = getSite(t.siteId);
  console.log(`\n── ${t.label} (template ${t.templateId}) ──`);

  // GET existing template — returns { message_template, message_details }
  const res = await authedFetch(site, `/api/bo/messagetemplate/${t.templateId}`);
  const data = res?.data?.rows || res?.data;
  if (!data?.message_template) {
    console.log('  ✗ could not fetch template');
    continue;
  }

  const tmpl = data.message_template;
  const msgDetails = data.message_details || {};
  let totalChanges = 0;

  // Build PUT details from existing message_details
  const details = {};
  for (const [localeId, entry] of Object.entries(msgDetails)) {
    if (!entry.message) continue;
    const { patched, changes } = patchHtml(entry.message);
    details[localeId] = {
      settings_locale_id: entry.settings_locale_id,
      subject: entry.subject || '',
      message: changes > 0 ? patched : entry.message,
    };
    if (changes > 0) {
      totalChanges += changes;
      console.log(`  locale ${localeId} (${entry.settings_locales_code}): patched ${changes} T&C line(s)`);
    } else {
      console.log(`  locale ${localeId} (${entry.settings_locales_code}): already has hyperlink or no T&C line found`);
    }
  }

  if (totalChanges === 0) {
    console.log('  → no changes needed, skipping PUT');
    continue;
  }

  // PUT updated template — omit `code` on QP2 (422 "code already taken")
  const putBody = {
    name: tmpl.name,
    section: tmpl.section,
    type: tmpl.type,
    status: tmpl.status,
    details,
  };
  if (t.siteId.startsWith('qpro')) putBody.code = tmpl.code;
  try {
    const putRes = await authedFetch(site, `/api/bo/messagetemplate/${t.templateId}`, {
      method: 'PUT',
      body: putBody,
    });
    const ok = putRes?.success === true || putRes?.data != null;
    console.log(`  → PUT ${ok ? '✓ success' : '✗ failed'}`);
    if (!ok) console.log('    response:', JSON.stringify(putRes).slice(0, 300));
  } catch (e) {
    console.log(`  → PUT ✗ error: ${e.message}`);
  }
}

console.log('\nDone.');

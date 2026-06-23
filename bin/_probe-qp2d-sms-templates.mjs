// Probe SMS templates (message_template_sms_id) for all QP2D codes in the
// QP2D Promo Codes sheet. Groups codes by template — shows whether codes
// share a single "Generic" SMS or have distinct per-code templates.

import fs from 'node:fs';
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const { uniqueCodes } = JSON.parse(fs.readFileSync('captures/api-runs/qp2d-sheet-cellmap.json', 'utf8'));
const site = getSite('ibc22');
const MERCHANT_ID = 4;

async function getCodeSmsTemplate(code) {
  const params = new URLSearchParams({ code, merchant_id: String(MERCHANT_ID), perPage: '5', page: '1' });
  const r = await authedFetch(site, `/api/bo/promotion?${params}`);
  const row = (r?.data?.rows || []).find(x => x.code === code);
  if (!row) return { code, present: false };
  return {
    code,
    present: true,
    promotion_id: row.id,
    sms_template_id: row.message_template_sms_id,
    msg_template_id: row.message_template_id,
  };
}

async function runBatched(items, fn, concurrency = 20) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) { const i = next++; if (i >= items.length) break; results[i] = await fn(items[i]); }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

console.log(`Step 1: per-code QP2D probe (${uniqueCodes.length} codes, parallel)...`);
const t0 = Date.now();
const codeInfo = await runBatched(uniqueCodes, getCodeSmsTemplate);
console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// Unique SMS template IDs
const uniqueSmsIds = [...new Set(codeInfo.filter(c => c.sms_template_id).map(c => c.sms_template_id))];
console.log(`\n${uniqueSmsIds.length} unique SMS template ID(s): ${uniqueSmsIds.join(', ')}`);

// Fetch each unique template
console.log(`\nStep 2: fetching ${uniqueSmsIds.length} SMS templates in parallel...`);
const templates = await Promise.all(uniqueSmsIds.map(async (id) => {
  try {
    const r = await authedFetch(site, `/api/bo/messagetemplate/${id}`);
    return { id, ok: true, template: r?.data?.message_template, details: r?.data?.message_details || {} };
  } catch (e) {
    return { id, ok: false, error: e.message };
  }
}));

// Output
console.log('\n━━━━━━━━━━ SMS TEMPLATES ━━━━━━━━━━');
const byTemplate = new Map();
for (const c of codeInfo) {
  if (!c.sms_template_id) continue;
  if (!byTemplate.has(c.sms_template_id)) byTemplate.set(c.sms_template_id, []);
  byTemplate.get(c.sms_template_id).push(c.code);
}

for (const tpl of templates) {
  if (!tpl.ok) { console.log(`\nTemplate id=${tpl.id}: FETCH FAILED — ${tpl.error}`); continue; }
  const t = tpl.template;
  const codes = byTemplate.get(tpl.id) || [];
  console.log(`\n■ Template id=${tpl.id}  code="${t.code}"  name="${t.name}"`);
  console.log(`  Used by ${codes.length} promo code(s): ${codes.slice(0, 3).join(', ')}${codes.length > 3 ? ` (+${codes.length - 3} more)` : ''}`);
  for (const [localeId, d] of Object.entries(tpl.details)) {
    console.log(`  ── ${d.settings_locales_code} (${d.settings_locales_name}) ──`);
    console.log(`     subject:  ${d.subject}`);
    console.log(`     message:  ${d.message.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)}`);
  }
}

// Save full probe data
fs.writeFileSync('captures/api-runs/qp2d-sms-probe.json', JSON.stringify({
  generated: new Date().toISOString(),
  codeInfo,
  uniqueSmsIds,
  templates,
}, null, 2));
console.log(`\nSaved → captures/api-runs/qp2d-sms-probe.json`);

// Tally: codes without SMS template
const noSms = codeInfo.filter(c => c.present && !c.sms_template_id);
if (noSms.length) {
  console.log(`\n⚠ ${noSms.length} code(s) have NO SMS template attached:`);
  noSms.forEach(c => console.log(`  ${c.code}`));
}

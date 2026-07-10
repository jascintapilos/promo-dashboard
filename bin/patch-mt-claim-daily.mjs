#!/usr/bin/env node
// Patch MT T&C clause 3 from "claim only once" → "once per day" on recurring
// Whale-Probe promos (P036-P046), EN + ZH, across QPRO + QP2. Targeted string
// replace on the live MT body (GET detail → replace → PUT), same PUT shape as
// bin/apply-copy-generator-p001-p008.mjs (QP2 omits code; QPRO includes code).
//
//   node bin/patch-mt-claim-daily.mjs --code=<CODE> --site=<siteId> [--commit]
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const argv = process.argv.slice(2);
const commit = argv.includes('--commit');
const code = (argv.find(a => a.startsWith('--code=')) || '').split('=')[1];
const siteId = (argv.find(a => a.startsWith('--site=')) || '').split('=')[1];
if (!code || !siteId) { console.error('pass --code= and --site='); process.exit(2); }

const EN_FROM = 'Each member can claim this promotion only once.';
const EN_TO   = 'Each member can claim this promotion once per day.';
const ZH_FROM = '每位会员仅限领取一次此优惠。';
const ZH_TO   = '每位会员每日限领取一次此优惠。';

const site = getSite(siteId);
const isQpro = site.platform === 'qpro';

// resolve promotion → message_template_id
const list = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(code)}&perPage=10`);
const row = (list.data?.rows || []).find(r => String(r.code).toUpperCase() === code.toUpperCase());
if (!row) { console.log(`${siteId} ${code}: promo not found`); process.exit(1); }
const mtId = row.message_template_id;
if (!mtId) { console.log(`${siteId} ${code}: no message_template_id`); process.exit(1); }

const res = await authedFetch(site, `/api/bo/messagetemplate/${mtId}`);
const data = res?.data || res;
const tmpl = data.message_template;
const msgDetails = data.message_details || {};

const details = {}; let changed = 0;
for (const [localeId, entry] of Object.entries(msgDetails)) {
  const isZH = /_ZH$/.test(entry.settings_locales_code || '') || [3, 7, 9].includes(Number(entry.settings_locale_id));
  let msg = entry.message;
  if (isZH && msg.includes(ZH_FROM)) { msg = msg.split(ZH_FROM).join(ZH_TO); changed++; }
  else if (!isZH && msg.includes(EN_FROM)) { msg = msg.split(EN_FROM).join(EN_TO); changed++; }
  details[localeId] = { settings_locale_id: entry.settings_locale_id, subject: entry.subject, message: msg };
}
if (changed === 0) { console.log(`  • ${siteId} ${code} (mt=${mtId}): clause not found (already patched?) — skip`); process.exit(0); }
if (!commit) { console.log(`  ~ ${siteId} ${code} (mt=${mtId}): would patch ${changed} locale(s)`); process.exit(0); }

const putBody = { name: tmpl.name, section: tmpl.section, type: tmpl.type, status: tmpl.status, details };
if (isQpro) putBody.code = tmpl.code;   // QP2 omits code (422); QPRO includes it
const pr = await authedFetch(site, `/api/bo/messagetemplate/${mtId}`, { method: 'PUT', body: putBody });
const ok = pr?.success === true || pr?.data != null;
console.log(`  ${ok ? '✓' : '✗'} ${siteId} ${code} (mt=${mtId}): patched ${changed} locale(s)`);
process.exit(ok ? 0 : 1);

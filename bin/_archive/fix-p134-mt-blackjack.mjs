#!/usr/bin/env node
// fix-p134-mt-blackjack.mjs
// One-off: updates the message template bodies for P134 (QP2A + QPRO8)
// to include the "excluding Blackjack" sub-category clause.
//
// Root cause: INSTRUCTION_CAT_MAP was missing 'LIVE CASINO' (space variant)
// so catSubExclusion returned null → no "(excluding Blackjack)" in clause 4.
// Code fix landed in src/igmp-tnc.js + src/message-template-renderer.js.
// This script pushes the corrected MT bodies to the already-saved templates.
//
//   node bin/_archive/fix-p134-mt-blackjack.mjs [--commit]

import { loadAllRequests, resolveDuplicates, resolveHandle } from '../../src/planner.js';
import { loadBoCodeIndex, fetchBoCodeAsRecord } from '../../src/bo-cache.js';
import { getSite } from '../../src/sites.js';
import { BRAND_TO_SITE } from '../../src/ingest.js';
import { buildApiPlan as buildQproPlan } from '../../src/api-mapper-qpro.js';
import { buildApiPlan as buildQp2Plan } from '../../src/api-mapper-qp2.js';
import { authedFetch } from '../../src/api-client.js';
import { parseArgs } from '../_args.js';

const { flags } = parseArgs(process.argv.slice(2));
const commit = flags.commit === true;

const TARGETS = [
  { brand: 'QPRO8', templateId: 639,  builder: buildQproPlan  },
  { brand: 'QP2A',  templateId: 1199, builder: buildQp2Plan   },
];

const { byHandle, byId, byCode } = await loadAllRequests();
const handle = resolveHandle('P134', { byHandle, byId });
if (!handle) { console.error('P134 not found — run ingest first'); process.exit(2); }
const request = byHandle.get(handle);
const bo = await loadBoCodeIndex();
const resolved = await resolveDuplicates(request, byCode, { boIndex: bo.byCode, boFetcher: fetchBoCodeAsRecord });

for (const { brand, templateId, builder } of TARGETS) {
  const siteId = BRAND_TO_SITE[brand]?.siteId;
  const site = getSite(siteId);
  const plan = await builder(resolved, { brand, site });

  if (!plan.messageTemplate) {
    console.log(`[${brand}] no messageTemplate in plan — skip`);
    continue;
  }

  const { name, section, type, status, details, code } = plan.messageTemplate;
  const body = { name, section, type, status, details, code };

  // Spot-check: find the category clause in first locale message
  // MT details keys are numeric locale IDs ('1','3','6','7'); value has .message not .body
  const firstLocaleKey = Object.keys(details)[0];
  const enMsg = (details[firstLocaleKey]?.message || '');
  const hasBlackjack = /Blackjack/i.test(enMsg);
  if (!hasBlackjack) {
    console.warn(`[${brand}] ⚠ locale[${firstLocaleKey}] message still missing Blackjack — check renderer fix`);
  } else {
    console.log(`[${brand}] ✓ locale[${firstLocaleKey}] message includes Blackjack exclusion`);
  }

  if (!commit) {
    console.log(`[${brand}] DRY-RUN — would PUT /api/bo/messagetemplate/${templateId}`);
    const snippet = enMsg.match(/Live Casino[^<]*/i)?.[0] || enMsg.substring(0, 180);
    console.log(`           clause preview: "${snippet}"`);
    continue;
  }

  const r = await authedFetch(site, `/api/bo/messagetemplate/${templateId}`, {
    method: 'PUT',
    body,
  });
  const ok = r?.data?.id === templateId || r?.data?.code === body.code;
  console.log(`[${brand}] PUT /api/bo/messagetemplate/${templateId} → ${ok ? '✓ OK' : '⚠ check response'} (${JSON.stringify(r?.data).slice(0, 80)})`);
}

console.log(commit ? '\nDone.' : '\nDry-run complete. Re-run with --commit to push.');

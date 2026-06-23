// Patch QP2C P165-P168 (promotion ids 1210-1213) with max_per_player=99999
// and daily_max=1. Fixtures had blank col-T values; runner defaulted QP2 to
// 1/1. Aligning to P164's 99999/1 per operator.

import { readFileSync } from 'fs';
import { buildApiPlan } from '../src/api-mapper-qp2.js';
import { updatePromotion, readDialogForPreservation, authedFetch } from '../src/api-client.js';

const SITE = 'ibc22';
const BRAND = 'QP2C';
const TARGETS = [
  { rn: 'P165', file: 'P165-r166.json', promoId: 1210, templateId: 1140, code: 'REL_30PCT_5X_MIN1500' },
  { rn: 'P166', file: 'P166-r167.json', promoId: 1211, templateId: 1141, code: 'REL_30PCT_5X_MIN2000' },
  { rn: 'P167', file: 'P167-r168.json', promoId: 1212, templateId: 1142, code: 'REL_30PCT_5X_MIN2500' },
  { rn: 'P168', file: 'P168-r169.json', promoId: 1213, templateId: 1143, code: 'REL_30PCT_5X_MIN3500' },
];

// Resolve template_id per promo from listing endpoint (defensive — we wrote
// the IDs above from runner output but verify).
async function resolveTemplateId(code) {
  const r = await authedFetch(SITE, '/api/bo/promotion?code=' + code + '&perPage=5');
  const row = (r.data?.rows||[]).find(x => x.code === code);
  return row?.message_template_id;
}

for (const t of TARGETS) {
  console.log(`\n── ${t.rn} #${t.promoId} ──`);
  const fixture = JSON.parse(readFileSync('./captures/requests/' + t.file, 'utf8'));
  fixture.max_per_player = 99999;
  fixture.daily_max = 1;

  const templateId = (await resolveTemplateId(t.code)) || t.templateId;
  const plan = await buildApiPlan(fixture, { brand: BRAND, site: SITE });
  const dialog = await readDialogForPreservation(SITE, t.code);
  const body = plan.buildUpdate(t.promoId, templateId, dialog);

  console.log('  patching: max_per_player=' + body.max_per_player + ', daily_max=' + body.daily_max + ', template=' + templateId + ', dialog_id=' + dialog?.id);
  const res = await updatePromotion(SITE, t.promoId, body);
  console.log('  PUT success:', res.success);

  // Re-read to confirm
  const det = await authedFetch(SITE, '/api/bo/promotion/' + t.promoId);
  const p = det?.data?.rows;
  const mark = (p.max_per_player === 99999 && p.daily_max === 1) ? '✓' : '✗';
  console.log('  ' + mark + ' after: max_per_player=' + p.max_per_player + ', daily_max=' + p.daily_max);
}

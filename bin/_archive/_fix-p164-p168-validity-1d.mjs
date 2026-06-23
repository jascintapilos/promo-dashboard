// Operator change request 2026-05-29: set validity = 1 day and rewards_validity = 1 day
// on every P164-P168 record (QP2C #1209-1213 on ibc22, QPRO4 #425-429).
// Also re-apply max_per_player=99999 / daily_max=1 so the QP2C cap fix
// doesn't regress when we PUT a fresh body.

import { readFileSync } from 'fs';
import { buildApiPlan as buildQp2 } from '../src/api-mapper-qp2.js';
import { buildApiPlan as buildQpro } from '../src/api-mapper-qpro.js';
import { updatePromotion, readDialogForPreservation, authedFetch } from '../src/api-client.js';

const BATCH = [
  { rn: 'P164', file: 'P164-r165.json', code: 'REL_30PCT_5X_MIN1000', qp2c: 1209, qpro4: 425 },
  { rn: 'P165', file: 'P165-r166.json', code: 'REL_30PCT_5X_MIN1500', qp2c: 1210, qpro4: 426 },
  { rn: 'P166', file: 'P166-r167.json', code: 'REL_30PCT_5X_MIN2000', qp2c: 1211, qpro4: 427 },
  { rn: 'P167', file: 'P167-r168.json', code: 'REL_30PCT_5X_MIN2500', qp2c: 1212, qpro4: 428 },
  { rn: 'P168', file: 'P168-r169.json', code: 'REL_30PCT_5X_MIN3500', qp2c: 1213, qpro4: 429 },
];

async function resolveTemplateId(site, code) {
  const r = await authedFetch(site, '/api/bo/promotion?code=' + code + '&perPage=5');
  const row = (r.data?.rows||[]).find(x => x.code === code);
  return row?.message_template_id;
}

async function patchOne(site, brand, promoId, code, fixture, buildPlan) {
  const patched = { ...fixture, validity_days: 1, rewards_validity_days: 1, max_per_player: 99999, daily_max: 1 };
  const templateId = await resolveTemplateId(site, code);
  const plan = await buildPlan(patched, { brand, site });
  const dialog = await readDialogForPreservation(site, code);
  const body = plan.buildUpdate(promoId, templateId, dialog);
  const res = await updatePromotion(site, promoId, body);

  // verify
  const det = await authedFetch(site, '/api/bo/promotion/' + promoId);
  const p = det?.data?.rows;
  const ok = p.validity === 1 && p.reward_validity === 1;
  const mark = ok ? '✓' : '✗';
  console.log(`    ${mark} ${brand} #${promoId}  validity=${p.validity}  reward_validity=${p.reward_validity}  max_per_player=${p.max_per_player}  daily_max=${p.daily_max}  PUT.success=${res.success}`);
  return ok;
}

let pass = 0, fail = 0;
for (const t of BATCH) {
  console.log(`\n── ${t.rn} (${t.code}) ──`);
  const fixture = JSON.parse(readFileSync('./captures/requests/' + t.file, 'utf8'));
  if (await patchOne('ibc22', 'QP2C', t.qp2c, t.code, fixture, buildQp2)) pass++; else fail++;
  if (await patchOne('qpro4', 'QPRO4', t.qpro4, t.code, fixture, buildQpro)) pass++; else fail++;
}
console.log(`\n══ DONE: ${pass} ok, ${fail} fail ══`);
process.exit(fail > 0 ? 1 : 0);

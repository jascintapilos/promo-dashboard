import { authedFetch } from '../../src/api-client.js';
import { getSite } from '../../src/sites.js';

const site = getSite('ibc22');

const checks = [
  { id: 1345, label: 'P026 (was 9-cat+LOTTERY+TABLE → 7-cat, 31→49 gp)' },
  { id: 1346, label: 'P027 (was SLOTS=[3], 31→49 gp)' },
  { id: 1352, label: 'P039 (was 9-cat+LOTTERY+TABLE → 7-cat, 12→49 gp)' },
  { id: 1363, label: 'P034 (was LC=[2], 12→49 gp)' },
  { id: 1368, label: 'P030 (was 7-cat OK, 52→49 gp)' },
  { id: 1354, label: 'P041 (was 9-cat+LOTTERY+TABLE → 7-cat, 31→49 gp)' },
];

const EXCLUDED = new Set(['PNG', 'PP', 'SBO', 'YL']);

let allOK = true;
for (const c of checks) {
  const det = (await authedFetch(site, `/api/bo/promotion/${c.id}`)).data.rows;
  const cats = (det.promotion_category_ids || []).map(Number).sort((a,b)=>a-b);
  const gpCodes = det.game_provider_codes || [];
  const gp = gpCodes.length;
  const hasLottery = cats.includes(6);
  const hasTable   = cats.includes(10);
  const leakedExcluded = gpCodes.filter(code => EXCLUDED.has(code));
  const catOK = !hasLottery && !hasTable;
  const gpExclusionOK = leakedExcluded.length === 0;
  const ok = catOK && gpExclusionOK;
  if (!ok) allOK = false;
  console.log(`${ok ? '✓' : '✗'} ${c.label}`);
  console.log(`  cats=[${cats.join(',')}]  gp=${gp}${hasLottery ? ' HAS_LOTTERY' : ''}${hasTable ? ' HAS_TABLE' : ''}${leakedExcluded.length ? ` LEAKED:[${leakedExcluded.join(',')}]` : ' exclusions_OK'}`);
}
console.log(`\n${allOK ? 'All spot-checks PASS' : 'Some checks FAILED'}`);

// One-off: fix category_id on QPRO1 (BP9) 3.3 Promotion Content id=181 (code=EVEJ2PWLBMMD).
// The main "Mid-Year Spend & Win" promo was saved with category_id = [11] (WIN=WINNER only)
// because "Winners List" in the campaign title triggered the WIN category selector.
// This is wrong for the live promo — correct to SHOW ALL (id=18).

import { authedFetch, getAllCategories } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const SITE_ID = 'qpro1';
const PC_ID = 181;
const DRY_RUN = process.argv.includes('--dry-run');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const SERVER_FIELDS = new Set(['id', 'promotion_content_id', 'settings_locale_code', 'created_at', 'updated_at']);

async function main() {
  const site = getSite(SITE_ID);
  console.log(`[fix-categories] site=${SITE_ID} pc_id=${PC_ID} dry=${DRY_RUN}`);

  // 1. Fetch current record
  const getRes = await authedFetch(site, `/api/bo/promotioncontent/${PC_ID}`);
  const content = getRes?.data?.content;
  const details = JSON.parse(JSON.stringify(getRes?.data?.details || {}));

  if (!content) throw new Error(`Failed to fetch pc ${PC_ID}: ${JSON.stringify(getRes)}`);

  console.log(`[fix-categories] code=${content.code}  status=${content.status}`);
  console.log(`[fix-categories] current category_id: [${content.category_id}]`);
  console.log(`[fix-categories] content_type: [${content.content_type}]`);
  console.log(`[fix-categories] ${Object.keys(details).length} locale detail(s): ${Object.keys(details).join(', ')}`);

  // 2. List all categories and select SHOW ALL
  const allCats = await getAllCategories(site);
  const allCat = allCats.find((c) => c.code === 'ALL' || /show.?all/i.test(c.name));
  if (!allCat) throw new Error('SHOW ALL category not found — available: ' + allCats.map((c) => `${c.code}=${c.id}`).join(', '));

  console.log(`[fix-categories] target: ALL=${allCat.name} (id=${allCat.id})`);

  const newCategoryId = { '0': allCat.id };
  console.log(`[fix-categories] new category_id: ${JSON.stringify(newCategoryId)}`);

  if (DRY_RUN) {
    console.log('[fix-categories] DRY-RUN — would PUT with above category_id');
    return;
  }

  // 3. Build PUT body — strip server-side detail fields, convert arrays to indexed objects
  const categoryObj    = newCategoryId;
  const contentTypeObj = Object.fromEntries((content.content_type || []).map((t) => [String(t), true]));

  const cleanDetails = {};
  for (const [k, d] of Object.entries(details)) {
    if (!d) { cleanDetails[k] = d; continue; }
    cleanDetails[k] = Object.fromEntries(Object.entries(d).filter(([f]) => !SERVER_FIELDS.has(f)));
  }

  const putBody = {
    code:              content.code,
    category_id:       categoryObj,
    content_type:      contentTypeObj,
    member_visibility: content.member_visibility,
    position:          content.position,
    apply_action:      content.apply_action,
    allow_apply:       content.allow_apply,
    status:            content.status,
    max_application:   content.max_application,
    details:           cleanDetails,
    // deliberately omit promotion_currency — QPRO PUT wipes per-locale currency rows if re-sent
  };

  await delay(1500);
  const putRes = await authedFetch(site, `/api/bo/promotioncontent/${PC_ID}`, {
    method: 'PUT',
    body: putBody,
  });

  const ok = putRes?.success !== false && !putRes?.errors;
  console.log(`[fix-categories] PUT ${ok ? '✅ OK' : '❌ FAILED'} — ${JSON.stringify(putRes?.message || putRes?.errors || '')}`);
}

main().catch((e) => { console.error(e); process.exit(1); });

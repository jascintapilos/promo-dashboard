import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';
const site = getSite('ibc22');

async function tryGet(path) {
  try {
    const r = await authedFetch(site, path);
    return r;
  } catch (e) { return { __err: e.message.split('\n')[0] }; }
}

const edit = await tryGet(`/api/bo/promotion/360?edit=1`);
if (edit.__err) { console.log('edit err:', edit.__err); }
else {
  const p = edit?.data?.rows || edit?.data;
  console.log('=== edit payload keys ===');
  console.log(Object.keys(p||{}).join(', '));
  // look for currency / freespin arrays
  for (const k of Object.keys(p||{})) {
    const v = p[k];
    if (Array.isArray(v) && v.length && typeof v[0] === 'object') {
      console.log(`\n--- ${k} (${v.length}) ---`);
      console.log(JSON.stringify(v, null, 2).slice(0, 2500));
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      const s = JSON.stringify(v);
      if (s.length > 2 && /turnover|rollover|min_transfer|spin|round|bet|amount|currency/i.test(s)) {
        console.log(`\n--- ${k} (obj) ---`);
        console.log(JSON.stringify(v, null, 2).slice(0, 2500));
      }
    }
  }
}

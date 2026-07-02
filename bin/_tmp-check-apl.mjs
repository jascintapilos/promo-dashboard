import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const CODES = ['FT_88FS_10X_040_GOO', 'FT_100FS_10X_060_GOO'];
const SITES = ['qpro6', 'qpro8'];

for (const siteId of SITES) {
  const s = getSite(siteId);
  for (const code of CODES) {
    const r = await authedFetch(s, `/api/bo/promotion?code=${code}`);
    const promo = r?.data?.rows?.[0];
    if (!promo) { console.log(`${siteId} ${code}: NOT FOUND`); continue; }
    const cr = await authedFetch(s, `/api/bo/promotioncurrency?promotion_id=${promo.id}`);
    const rows = cr?.data?.rows || [];
    for (const cur of rows) {
      console.log(`${siteId} ${code} [${cur.currency}]: amount_per_line=${cur.amount_per_line}, lines=${cur.lines}`);
    }
  }
}

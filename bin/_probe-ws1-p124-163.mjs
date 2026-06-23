import fs from 'node:fs';
import path from 'node:path';
import { igmpPost } from '../src/igmp-client.js';

const dir = 'captures/requests';
const files = fs.readdirSync(dir).filter(f => /^P1(2[4-9]|[3-5][0-9]|6[0-3])-/.test(f)).sort();
const SKIP = new Set(['P132']);

const WS1_SITES = [
  { id: 'ws1-v3-my', region: 'MY' },
  { id: 'ws1-v3-sg', region: 'SG' },
];

const rows = [];
for (const f of files) {
  const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  if (SKIP.has(r.request_id)) continue;
  rows.push({ rn: r.request_id, code: r.promo_code });
}

console.error(`Probing ${rows.length} × ${WS1_SITES.length} = ${rows.length * WS1_SITES.length} GetPromotionInfoByCode calls`);

const results = [];
let i = 0;
for (const r of rows) {
  i++;
  if (i % 5 === 0) console.error(`  ${i}/${rows.length}`);
  const out = { rn: r.rn, code: r.code };
  for (const site of WS1_SITES) {
    try {
      const res = await igmpPost(site.id, '/PM/GetPromotionInfoByCode', { PromotionCode: r.code });
      const found = res?.data?.PromotionId != null || res?.data?.Promotion?.PromotionId != null;
      out[`WS1_${site.region}`] = found ? `DUP(id=${res?.data?.PromotionId ?? res?.data?.Promotion?.PromotionId})` : '-';
    } catch (e) {
      const msg = String(e.message || '');
      // The IGMP lookup throws on "not found" for some sites — treat as MISSING if message indicates so.
      if (/not found|no promotion|0 row|empty/i.test(msg)) out[`WS1_${site.region}`] = '-';
      else out[`WS1_${site.region}`] = `ERR:${msg.slice(0, 50)}`;
    }
  }
  results.push(out);
}

console.log('rn\tcode\tWS1_MY\tWS1_SG');
for (const r of results) console.log([r.rn, r.code, r.WS1_MY, r.WS1_SG].join('\t'));

import fs from 'node:fs';
import path from 'node:path';
import { findPromotionByCode } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const dir = 'captures/requests';
const files = fs.readdirSync(dir).filter(f => /^P1(2[4-9]|[3-5][0-9]|6[0-3])-/.test(f)).sort();

const TARGET_BRANDS = [
  { id: 'qpro3',  brand: 'QPRO3'  },
  { id: 'qpro4',  brand: 'QPRO4'  },
  { id: 'qpro6',  brand: 'QPRO6'  },
  { id: 'qpro8',  brand: 'QPRO8'  },
  { id: 'qpro10', brand: 'QPRO10' },
];
const QP2D = { id: 'ibc22', brand: 'QP2D', merchantId: 4 };

function extractSourceCode(remark) {
  const m = String(remark || '').match(/Replicate\s+([A-Z0-9_]+)/i);
  return m ? m[1] : null;
}

const rows = [];
for (const f of files) {
  const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  rows.push({
    rn: r.request_id,
    remark: r.remark,
    auto_code: r.promo_code,
    source_code: extractSourceCode(r.remark),
  });
}

console.error(`Probing ${rows.length} rows × ${TARGET_BRANDS.length + 1} probes...`);

const cache = new Map();
async function probe(siteId, code, opts = {}) {
  const key = `${siteId}:${code}:${opts.merchantId ?? ''}`;
  if (cache.has(key)) return cache.get(key);
  try {
    const site = getSite(siteId);
    const hit = await findPromotionByCode(site, code, opts);
    cache.set(key, hit);
    return hit;
  } catch (e) {
    cache.set(key, { __error: e.message });
    return { __error: e.message };
  }
}

const results = [];
let i = 0;
for (const r of rows) {
  i++;
  if (i % 5 === 0) console.error(`  ${i}/${rows.length}`);
  if (!r.source_code) { results.push({ ...r, qp2d: 'NO_SRC' }); continue; }
  const src = await probe(QP2D.id, r.source_code, { merchantId: QP2D.merchantId });
  const out = { rn: r.rn, source: r.source_code, qp2d: src?.__error ? 'ERR' : (src ? 'EXISTS' : 'MISSING') };
  for (const t of TARGET_BRANDS) {
    const hit = await probe(t.id, r.source_code);
    out[t.brand] = hit?.__error ? 'ERR' : (hit ? 'DUP' : '-');
  }
  results.push(out);
}

const cols = ['rn','source','qp2d', ...TARGET_BRANDS.map(t=>t.brand)];
console.log(cols.join('\t'));
for (const r of results) {
  console.log(cols.map(c => r[c] ?? '').join('\t'));
}

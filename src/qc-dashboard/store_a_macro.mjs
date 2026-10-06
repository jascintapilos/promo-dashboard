// store_a_macro.mjs — serve the Brands-overview (macro) for ANY window from the local Store A.
// Pure arithmetic over the nightly (date×brand×currency) rollup: no warehouse, ~tens of ms.
// Mirrors bin/preagg/macro_from_store_a.py (and thus bin/macro_pull.py) exactly, including the four
// gotchas: round the 7 locals AFTER the window sum; HAVING round(d)>100000 after; company USD summed
// raw over the HAVING survivors; ratios from the summed numerator/denominator.
import { readFileSync, writeFileSync } from 'node:fs';

const CURMAP = { MYR:'Malaysia', SGD:'Singapore', THB:'Thailand', IDR:'Indonesia', BDT:'Bangladesh', VND:'Vietnam', USD:'Cambodia' };
const SYM = { MYR:'RM', SGD:'S$', THB:'฿', IDR:'Rp', BDT:'৳', VND:'₫', USD:'US$' };
const LOCAL = ['d','db','fc','fs','bo','rb','ngr'];
const USD = ['du','bou','rbu','ngru'];
const MEAS = [...LOCAL, ...USD];
const r1 = x => Math.round(x * 10) / 10;   // 1-dp ratio (empirically matches python round(x,1) on these values)
// round half to EVEN (banker's) — matches ClickHouse round() + python round(), which the live numbers use.
// JS Math.round rounds half up, which differs by 1 whenever a sum lands exactly on .5 (e.g. 8560.5).
function rhe(x) {
  const f = Math.floor(x), diff = x - f;
  if (diff < 0.5) return f;
  if (diff > 0.5) return f + 1;
  return (f % 2 === 0) ? f : f + 1;   // exactly .5 -> nearest even
}

// store = parsed store_a.json; window is [startISO, endExclISO)
export function macroFromStore(store, startISO, endExclISO) {
  const ci = Object.fromEntries(store.cols.map((n, i) => [n, i]));
  const acc = new Map();   // "c|b" -> raw sums
  for (const row of store.rows) {
    const dt = row[ci.date];
    if (dt >= startISO && dt < endExclISO) {
      const key = row[ci.c] + '|' + row[ci.b];
      let a = acc.get(key);
      if (!a) { a = { _b: row[ci.b], _c: row[ci.c] }; for (const m of MEAS) a[m] = 0; acc.set(key, a); }
      for (const m of MEAS) a[m] += row[ci[m]];
    }
  }
  const surv = [];
  for (const a of acc.values()) {
    const loc = {}; for (const m of LOCAL) loc[m] = rhe(a[m]);   // round locals AFTER summing (banker's, like the warehouse)
    if (loc.d > 100000) surv.push({ b: a._b, c: a._c, loc, usd: { du: a.du, bou: a.bou, rbu: a.rbu, ngru: a.ngru } });
  }
  surv.sort((x, y) => (x.c < y.c ? -1 : x.c > y.c ? 1 : y.loc.d - x.loc.d));   // ORDER BY c, d DESC

  const regs = new Map();
  const comp = { d: 0, bo: 0, rb: 0, ngr: 0 };
  for (const { b, c, loc, usd } of surv) {
    const { d, db, fc, fs, bo, rb, ngr } = loc;
    let r = regs.get(c);
    if (!r) { r = { region: CURMAP[c] || c, cur: c, sym: SYM[c] || (c + ' '), brands: [], d: 0, db: 0, fc: 0, fs: 0, bo: 0, rb: 0, ngr: 0 }; regs.set(c, r); }
    r.brands.push({ b, d, db, fc, fs, bo, rb, ngr, bon_pct: d ? r1(bo / d * 100) : 0, br_pct: d ? r1((bo + rb) / d * 100) : 0, mg: d ? r1(ngr / d * 100) : 0 });
    for (const k of LOCAL) r[k] += loc[k];
    comp.d += usd.du; comp.bo += usd.bou; comp.rb += usd.rbu; comp.ngr += usd.ngru;
  }
  for (const r of regs.values()) {
    r.bon_pct = r.d ? r1(r.bo / r.d * 100) : 0;
    r.br_pct = r.d ? r1((r.bo + r.rb) / r.d * 100) : 0;
    r.mg = r.d ? r1(r.ngr / r.d * 100) : 0;
  }
  const company = { dep_usd: comp.d, bon_pct: comp.d ? r1(comp.bo / comp.d * 100) : 0, br_pct: comp.d ? r1((comp.bo + comp.rb) / comp.d * 100) : 0, mg: comp.d ? r1(comp.ngr / comp.d * 100) : 0 };
  const regions = [...regs.values()].sort((a, b) => b.d - a.d);
  return { window_start: startISO, window_end: endExclISO, company, regions };
}

// ---- serve shape: mirror assemble_explorer_payload.build_macro() so the result drops straight into
// DATA.macro (keep MYR/SGD/IDR in that order, drop raw 'bo', add the asOf month-range label + window). ----
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const KEEP = { MYR: 0, SGD: 1, IDR: 2 };
const TBK = ['b','d','db','fc','fs','rb','ngr','bon_pct','br_pct','mg'];   // note: 'bo' intentionally dropped

function rangeLabel(startISO, endExclISO) {
  const s = startISO.split('-').map(Number), e = endExclISO.split('-').map(Number);
  let [ly, lm] = e[1] > 1 ? [e[0], e[1] - 1] : [e[0] - 1, 12];   // last complete month before the exclusive end
  if (s[0] === ly && s[1] === lm) return `${MON[s[1]-1]} ${ly}`;
  if (s[0] === ly) return `${MON[s[1]-1]}–${MON[lm-1]} ${ly}`;
  return `${MON[s[1]-1]} ${s[0]} – ${MON[lm-1]} ${ly}`;
}

// Full DATA.macro-shaped object for ANY window, straight from Store A. `ytd` true => prefix "YTD ·".
export function macroServe(store, startISO, endExclISO, { ytd = false } = {}) {
  const raw = macroFromStore(store, startISO, endExclISO);
  const regions = raw.regions
    .filter(r => r.cur in KEEP)
    .map(r => {
      const o = { region: r.region, cur: r.cur, sym: r.sym, d: r.d, db: r.db, fc: r.fc, fs: r.fs, rb: r.rb, ngr: r.ngr, bon_pct: r.bon_pct, br_pct: r.br_pct, mg: r.mg };
      o.brands = r.brands.map(x => Object.fromEntries(TBK.map(k => [k, x[k]])));
      return o;
    })
    .sort((a, b) => KEEP[a.cur] - KEEP[b.cur]);
  const rng = rangeLabel(startISO, endExclISO);
  return { asOf: ytd ? `YTD · ${rng}` : rng, window: `${startISO} .. ${endExclISO}`, company: raw.company, regions };
}

// CLI: `node store_a_macro.mjs <storePath> <startISO> <endExclISO> [outPath]`
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('bin/preagg/store_a_macro.mjs')) {
  const [storePath, start, endExcl, outPath] = process.argv.slice(2);
  const store = JSON.parse(readFileSync(storePath, 'utf8'));
  const t0 = Date.now();
  const out = macroFromStore(store, start, endExcl);
  const ms = Date.now() - t0;
  if (outPath) writeFileSync(outPath, JSON.stringify(out, null, 1));
  console.error(`macroFromStore ${start}..${endExcl}: ${ms} ms, ${out.regions.length} regions`);
  if (!outPath) console.log(JSON.stringify(out, null, 1));
}
// NOTE: this file is a deploy copy of promo-automation/bin/preagg/store_a_macro.mjs — keep in sync.

/**
 * Task 8 — build the live acquisition dashboard from real metrics.
 * Reads scratchpad/acq/acq-metrics-MY.json, injects it as PAYLOAD into
 * templates/acq-dashboard.html, writes outputs/acq-dashboard-MY.html.
 * Run: node bin/build_acq_dashboard.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SCR = 'C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad';
const sym = c => c === 'MYR' ? 'RM' : c === 'SGD' ? 'S$' : c;
// drop per-code fields the panels never render (keeps the file under the pane's static-snapshot cap)
const DROP = ['matured_60', 'matured_90', 'active_60', 'active_90', 'persist_8_29', 'dep_lift', 'dep_lift_per_rm',
  'avg_bonus_per_claim', 'tier_top_share', 'implied_tier', 'target_purity', 'redeposit_expected', 'ggr_window',
  't1_dep', 't1_ngr'];
const slimCodes = obj => { if (obj && Array.isArray(obj.codes)) obj.codes.forEach(c => DROP.forEach(k => delete c[k])); };

// --verify: shrink ACQ/RET code lists (VIP stays full) so the file fits the pane's snapshot cap for local screenshots
const VERIFY = process.argv.includes('--verify');
const DEST = VERIFY ? 'outputs/vip-verify.html' : 'outputs/acq-dashboard-MY.html';

// acquisition payload (required)
const metrics = JSON.parse(fs.readFileSync(path.join(SCR, 'acq/acq-metrics-MY.json'), 'utf8'));
metrics.sym = sym(metrics.currency);
if (VERIFY) metrics.codes = metrics.codes.slice(0, 12);

let out = fs.readFileSync(path.join(ROOT, 'templates/acq-dashboard.html'), 'utf8');
const acqMarker = '/*__ACQ_PAYLOAD__*/ null';
if (!out.includes(acqMarker)) throw new Error('acquisition payload marker not found in template');
out = out.replace(acqMarker, JSON.stringify(metrics));

// retention payload (optional — inject when the metrics file exists)
const retMarker = '/*__RET_PAYLOAD__*/ null';
let retNote = 'no RET payload';
const retPath = path.join(SCR, 'ret/ret-metrics-MY.json');
if (out.includes(retMarker) && fs.existsSync(retPath)) {
  const ret = JSON.parse(fs.readFileSync(retPath, 'utf8'));
  ret.sym = sym(ret.currency); slimCodes(ret);
  if (VERIFY) ret.codes = ret.codes.slice(0, 12);
  out = out.replace(retMarker, JSON.stringify(ret));
  retNote = `RET ${ret.codes.length} codes / NGR-Lift/RM ${ret.kpis.ngr_lift_per_rm} / money-to-move RM${ret.money_to_move.stop_reduce.toLocaleString()}`;
}

// VIP payload (optional — inject when the metrics file exists)
const vipMarker = '/*__VIP_PAYLOAD__*/ null';
let vipNote = 'no VIP payload';
const vipPath = path.join(SCR, 'vip/vip-metrics-MY.json');
if (out.includes(vipMarker) && fs.existsSync(vipPath)) {
  const vip = JSON.parse(fs.readFileSync(vipPath, 'utf8'));
  vip.sym = sym(vip.currency); slimCodes(vip);
  out = out.replace(vipMarker, JSON.stringify(vip));
  vipNote = `VIP ${vip.codes.length} codes / 4 lanes / net-neg subsidy RM${(vip.program?.subsidy_rm || 0).toLocaleString()}`;
}

// TREND payload (optional — month-over-month, injected when the file exists)
const trendMarker = '/*__TREND_PAYLOAD__*/ null';
let trendNote = 'no TREND payload';
const trendPath = path.join(SCR, 'trend-MY.json');
if (out.includes(trendMarker) && fs.existsSync(trendPath)) {
  const trend = JSON.parse(fs.readFileSync(trendPath, 'utf8'));
  trend.sym = sym(trend.currency);
  out = out.replace(trendMarker, JSON.stringify(trend));
  trendNote = `TREND ${trend.months.length}mo / ret ${trend.read.ret_dir} · VIP-perf ${trend.read.vip_dir}`;
}

// ATTRIBUTION payload (optional — matched-control strengthening summary, preview)
const attrMarker = '/*__ATTR_PAYLOAD__*/ null';
let attrNote = 'no ATTR payload';
const attrPath = path.join(SCR, 'attribution/attribution-summary-MY.json');
if (out.includes(attrMarker) && fs.existsSync(attrPath)) {
  const attr = JSON.parse(fs.readFileSync(attrPath, 'utf8'));
  out = out.replace(attrMarker, JSON.stringify(attr));
  attrNote = `ATTR ${attr.coverage.n_valid} fair-checked / ${attr.coverage.n_need_holdout} need-holdout / ${attr.flips.length} flips`;
}

// LTV payload (optional — real multi-year cohort lifetime value, whole-book)
const ltvMarker = '/*__LTV_PAYLOAD__*/ null';
let ltvNote = 'no LTV payload';
const ltvPath = path.join(SCR, 'ltv/cohort-ltv-MY.json');
if (out.includes(ltvMarker) && fs.existsSync(ltvPath)) {
  const ltv = JSON.parse(fs.readFileSync(ltvPath, 'utf8'));
  out = out.replace(ltvMarker, JSON.stringify(ltv));
  ltvNote = `LTV ${ltv.cohorts.length} cohorts / mature ${ltv.symbol}${ltv.summary.mature_final}`;
}

fs.mkdirSync(path.join(ROOT, 'outputs'), { recursive: true });
const dest = path.join(ROOT, DEST);
fs.writeFileSync(dest, out, 'utf8');
console.log(`built ${DEST} (${(out.length / 1024).toFixed(0)} KB) — ACQ ${metrics.codes.length} codes RM${metrics.kpis.cost_per_ftd}/FTD | ${retNote} | ${vipNote} | ${trendNote} | ${attrNote} | ${ltvNote}`);

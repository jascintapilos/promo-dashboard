// prebuild-standard-windows.mjs — Phase 2 nightly: build the FULL report for each standard window and
// publish it to report.<key>.live.json on the Hub, so picking that preset loads instantly (all tabs).
// Reuses the refresh build-driver + the report-build relay (adds an x-refresh-window header, no jobId).
//   secret: %USERPROFILE%\.qc-relay\relay-secret (or RELAY_SECRET); hub: QC_HUB_URL; pipeline: PROMO_OUTER_DIR.
// Windows (keys = picker presets): env PREBUILD_WINDOWS, default "ytd,lastmonth,last90".
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readWorkerRelaySecret, buildSignedHeaders, MAX_REPORT_BUILD_BYTES } from '../src/qc-dashboard/relay-auth.js';

const HUB_URL = process.env.QC_HUB_URL || 'http://localhost:4321';
const OUTER = process.env.PROMO_OUTER_DIR || 'C:/Users/vdiuser/Downloads/promo-automation';
const BUILD_ARGS = (process.env.PROMO_BUILD_CMD || 'bin/promo-refresh-build.mjs').split(' ');
const WORKER_ID = process.env.QC_RELAY_WORKER_ID || `vdi-prebuild-${process.pid}`;
const ROUTE = '/api/relay/promo/ws1/report-build';
const WINDOWS = (process.env.PREBUILD_WINDOWS || 'ytd,lastmonth,last90').split(',').map(s => s.trim()).filter(Boolean);

const pad = n => String(n).padStart(2, '0');
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;   // m is 1-based here
// Windows relative to the VDI's local "today" (nightly runs mid-morning MYT, so the date is unambiguous).
// ytd = null -> the pipeline's own auto-YTD (Jan 1 .. first of latest complete month).
function resolveWindow(key) {
  const t = new Date(), Y = t.getFullYear(), M = t.getMonth(), D = t.getDate();   // M 0-based
  const firstOfThis = ymd(Y, M + 1, 1);
  if (key === 'ytd') return null;
  if (key === 'lastmonth') { const p = new Date(Y, M - 1, 1); return { start: ymd(p.getFullYear(), p.getMonth() + 1, 1), endExcl: firstOfThis }; }
  if (key === 'thismonth') { const e = new Date(Y, M, D + 1); return { start: firstOfThis, endExcl: ymd(e.getFullYear(), e.getMonth() + 1, e.getDate()) }; }
  if (key === 'last90') { const s = new Date(Y, M, D - 89), e = new Date(Y, M, D + 1); return { start: ymd(s.getFullYear(), s.getMonth() + 1, s.getDate()), endExcl: ymd(e.getFullYear(), e.getMonth() + 1, e.getDate()) }; }
  throw new Error('unknown window key: ' + key);
}

function build(window, i) {
  return new Promise((resolve) => {
    const out = path.join(os.tmpdir(), `prebuild-${process.pid}-${i}.json`);
    const env = { ...process.env, PROMO_MARKET: 'MY', PROMO_REFRESH_OUT: out };
    delete env.PROMO_START; delete env.PROMO_END; delete env.PROMO_MONTH;
    if (window) { env.PROMO_START = window.start; env.PROMO_END = window.endExcl; }
    const child = spawn(process.execPath, BUILD_ARGS, { cwd: OUTER, env, stdio: ['ignore', 'ignore', 'inherit'] });
    child.on('close', code => resolve({ code, out }));
    child.on('error', e => resolve({ code: -1, out, err: String(e && e.message || e) }));
  });
}

async function publish(key, outFile, secret) {
  const body = await readFile(outFile);
  const { headers } = buildSignedHeaders({ method: 'POST', path: ROUTE, bodyBuffer: body, secret, workerId: WORKER_ID, maxBytes: MAX_REPORT_BUILD_BYTES });
  headers['x-refresh-window'] = key;
  headers['content-type'] = 'application/json';
  const r = await fetch(HUB_URL + ROUTE, { method: 'POST', headers, body });
  return { status: r.status, text: (await r.text()).slice(0, 200) };
}

async function main() {
  const s = readWorkerRelaySecret();
  if (!s.present) { console.error('relay secret unavailable:', s.reason); process.exit(2); }
  let failures = 0;
  for (let i = 0; i < WINDOWS.length; i++) {
    const key = WINDOWS[i];
    const w = resolveWindow(key);
    const label = w ? `${w.start}..${w.endExcl}` : 'auto-YTD';
    console.log(`[${new Date().toISOString()}] build ${key} (${label}) …`);
    const b = await build(w, i);
    if (b.code !== 0) { console.error(`  BUILD FAILED ${key} (exit ${b.code}) ${b.err || ''}`); failures++; continue; }
    const p = await publish(key, b.out, s.secret);
    console.log(`  publish ${key} -> ${p.status} ${p.text}`);
    if (p.status !== 200) failures++;
  }
  console.log(`[${new Date().toISOString()}] prebuild done — ${WINDOWS.length - failures}/${WINDOWS.length} published`);
  process.exit(failures ? 1 : 0);
}
main().catch(e => { console.error('prebuild failed:', e.message); process.exit(1); });

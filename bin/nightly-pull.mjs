#!/usr/bin/env node
// Nightly Ops pull — runs every pull step in its own child process with its own
// timeout, records each step's status, then pushes every Ops sheet tab to the
// dashboard server with the step's real result (bin/push-ops-dataset.mjs).
//
// Replaces the body of nightly-pull.bat. The .bat version died silently for four
// weeks (Sep 2026: `wmic` vanished, the log path broke, the batch aborted after
// step 1 while Task Scheduler still showed success). Here one step cannot stop
// the others, the exit code is non-zero when anything failed, and a Telegram DM
// goes out on failure.
//
//   node bin/nightly-pull.mjs              full run
//   node bin/nightly-pull.mjs --dry-run    print the plan, run nothing
//   node bin/nightly-pull.mjs --only=4,10  run just those steps (push only their datasets)
//   node bin/nightly-pull.mjs --no-push    run steps, skip the server push
//   node bin/nightly-pull.mjs --no-alert   never send Telegram

import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pushOpsDatasets } from './push-ops-dataset.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
process.chdir(ROOT); // sheet/oauth helpers resolve *.local.json from cwd

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const NO_PUSH = args.includes('--no-push');
const NO_ALERT = args.includes('--no-alert') || DRY;
const ONLY = (args.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);

const MIN = 60_000;
const FT_HINT = (i) => ` - try node bin\\pull-ft-via-browser.mjs --instance=${i} --write with AdsPower open`;

// id, title, script args, status instance/label (null = not recorded), timeout,
// datasets this step refreshes, warnOnly (failure is logged but not counted).
const STEPS = [
  { id: '1',  title: 'YTD promo backfill (QPRO+QP2+WS1/WS2, rewrites Promo Code Log)', cmd: ['bin/pull-bo-ytd.mjs', '--write'], status: ['bo-ytd', 'BO Promos (YTD)'], timeout: 20 * MIN, datasets: ['promos'] },
  { id: '2',  title: 'Pulling QPRO/QP2 banners directly into Banner Log', cmd: ['bin/pull-bo-banners-to-sheet.mjs', '--write'], status: ['bo-banners', 'BO Banners (QPRO+QP2)'], timeout: 10 * MIN, datasets: ['banners'] },
  { id: '3',  title: 'Pulling WS1/WS2 CMS banners into Banner Log', cmd: ['bin/pull-cms-banners.mjs', '--write'], status: ['cms-banners', 'CMS Banners (WS1/WS2)'], timeout: 10 * MIN, datasets: ['banners'] },
  { id: '4',  title: 'Syncing New Games from working sheet', cmd: ['bin/pull-new-games.mjs', '--write'], status: ['new-games', 'New Games'], timeout: 5 * MIN, datasets: ['games'] },
  { id: '5',  title: 'Pulling team utilisation into Weekly Report', cmd: ['bin/pull-utilisation.mjs', '--write'], status: ['utilisation', 'Utilisation'], timeout: 10 * MIN, datasets: ['utilisation', 'utilWeekly', 'workLog'] },
  { id: '6',  title: 'Refreshing Smartico session (headless auto-login)', cmd: ['bin/capture-smartico-session.mjs'], status: null, timeout: 5 * MIN, datasets: [], warnOnly: true },
  { id: '6b', title: 'Pulling Smartico CRM segments + activities into CRM Assignment Log', cmd: ['bin/pull-smartico-campaigns.mjs', '--write', '--no-preserve'], status: ['smartico', 'Smartico CRM'], timeout: 10 * MIN, datasets: ['crm'] },
  { id: '7',  title: 'Pulling FastTrack WS1 CRM segments (headless, unattended)', cmd: ['bin/pull-ft-headless.mjs', '--instance=ws1', '--write'], status: ['ft-ws1', 'FT WS1/WS2 CRM'], hint: FT_HINT('ws1'), timeout: 15 * MIN, datasets: ['crm'] },
  { id: '8',  title: 'Pulling FastTrack QPRO1 CRM segments (headless, unattended)', cmd: ['bin/pull-ft-headless.mjs', '--instance=qpro1', '--write'], status: ['ft-qpro1', 'FT QPRO1 CRM'], hint: FT_HINT('qpro1'), timeout: 15 * MIN, datasets: ['crm'] },
  { id: '9',  title: 'Pulling FastTrack QP2 CRM segments (headless, unattended)', cmd: ['bin/pull-ft-headless.mjs', '--instance=qp2', '--write'], status: ['ft-qp2', 'FT QP2A-D CRM'], hint: FT_HINT('qp2'), timeout: 15 * MIN, datasets: ['crm'] },
  { id: '10', title: 'Pulling adhoc tasks from Slack into Adhoc Tasks tab', cmd: ['bin/pull-adhoc-tasks.mjs', '--commit'], status: ['adhoc-tasks', 'Adhoc Tasks'], timeout: 10 * MIN, datasets: ['adhoc'] },
  { id: '11', title: 'Running banner health check (Banner Health tab + dashboard)', cmd: ['bin/banner-health-check.mjs', '--dashboard'], status: ['banner-health', 'Banner Health Check'], timeout: 15 * MIN, datasets: ['bannerHealth', 'homepageBannerStatus'] },
  { id: '12', title: 'Sorting all tabs by date descending (latest on top)', cmd: ['bin/sort-sheet-tabs.mjs'], status: null, timeout: 5 * MIN, datasets: [] },
];
// Typed by people in the sheet, plus the status tab — pushed on every full run.
const ALWAYS_PUSH = ['manualPromo', 'manualBanner', 'manualCrm', 'sysStatus'];

const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
mkdirSync(path.join(ROOT, 'logs'), { recursive: true });
const LOG = path.join(ROOT, 'logs', `nightly-pull-${stamp}.txt`);
const log = (line) => { const s = `${line}\n`; process.stdout.write(s); if (!DRY) appendFileSync(LOG, s); };
const clock = () => new Date().toLocaleTimeString('en-GB');
const fmtDur = (ms) => (ms >= MIN ? `${Math.round(ms / MIN)}m` : `${Math.round(ms / 1000)}s`);

function killTree(pid) {
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
  else try { process.kill(-pid, 'SIGKILL'); } catch {}
}

// Runs one node script; output goes to the log. Resolves { code, timedOut }.
function runNode(scriptArgs, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, scriptArgs, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const sink = (d) => appendFileSync(LOG, d);
    child.stdout.on('data', sink);
    child.stderr.on('data', sink);
    let timedOut = false;
    const t = setTimeout(() => { timedOut = true; killTree(child.pid); }, timeoutMs);
    child.on('error', (e) => { clearTimeout(t); appendFileSync(LOG, `spawn error: ${e.message}\n`); resolve({ code: -1, timedOut }); });
    child.on('close', (code) => { clearTimeout(t); resolve({ code: code ?? -1, timedOut }); });
  });
}

async function recordStatus(step, ok, detail) {
  if (!step.status) return;
  const [instance, label] = step.status;
  await runNode(['bin/record-pull-status.mjs', instance, label, ok ? 'OK' : 'FAILED', ...(ok ? [] : [detail])], 2 * MIN);
}

// ── Telegram DM (Jascinta) ──────────────────────────────────────────────
// Token from tg-bot-token.local.json; DM chat id from ops-alert.local.json
// ({ "chatId": <number> }). Same failure set is re-sent at most once a day.
async function alert(failures, pushErrors) {
  if (NO_ALERT || (!failures.length && !pushErrors.length)) return;
  const statePath = path.join(ROOT, 'logs', 'ops-alert-state.json');
  const sig = JSON.stringify([...failures.map((f) => f.id), ...pushErrors.map((p) => `push:${p.key}`)]);
  let state = {};
  try { state = JSON.parse(readFileSync(statePath, 'utf8')); } catch {}
  if (state.sig === sig && Date.now() - Date.parse(state.at || 0) < 22 * 60 * MIN) { log('  (alert suppressed — same failures already sent today)'); return; }
  let token, chatId;
  try { token = JSON.parse(readFileSync(path.join(ROOT, 'tg-bot-token.local.json'), 'utf8')).token; } catch {}
  try { chatId = JSON.parse(readFileSync(path.join(ROOT, 'ops-alert.local.json'), 'utf8')).chatId; } catch {}
  if (!token || !chatId) { log('  ⚠ alert not sent — tg-bot-token.local.json token or ops-alert.local.json chatId missing'); return; }
  const lines = [
    `⚠️ Ops nightly pull — ${failures.length} step(s) failed${pushErrors.length ? `, ${pushErrors.length} dashboard push(es) failed` : ''}`,
    ...failures.map((f) => `• [${f.id}] ${f.title} — ${f.detail}`),
    ...pushErrors.map((p) => `• push ${p.key} — ${p.error}`),
    `Log: logs\\nightly-pull-${stamp}.txt`,
  ];
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: lines.join('\n').slice(0, 4000), disable_web_page_preview: true }),
    });
    if (!r.ok) { log(`  ⚠ Telegram alert failed (${r.status})`); return; }
    writeFileSync(statePath, JSON.stringify({ sig, at: new Date().toISOString() }));
    log('  ✓ Telegram alert sent');
  } catch (e) { log(`  ⚠ Telegram alert failed: ${e.message}`); }
}

// ── Run ─────────────────────────────────────────────────────────────────
const steps = ONLY.length ? STEPS.filter((s) => ONLY.includes(s.id)) : STEPS;
log(`=== Nightly Ops pull started ${now.toString().slice(0, 24)}${DRY ? ' (DRY RUN)' : ''} ===`);
const results = [];
for (const step of steps) {
  log(`[${step.id}/12] ${step.title}... (${clock()})`);
  if (DRY) { log(`  would run: node ${step.cmd.join(' ')}  (timeout ${fmtDur(step.timeout)}) → datasets: ${step.datasets.join(', ') || '—'}`); continue; }
  const { code, timedOut } = await runNode(step.cmd, step.timeout);
  const ok = code === 0;
  const detail = ok ? '' : `${timedOut ? `timed out after ${fmtDur(step.timeout)}` : `exit ${code}`}${step.hint || ''}`;
  if (!ok) log(`  ✖ ${step.warnOnly ? 'WARNING' : 'FAILED'}: ${detail}`);
  await recordStatus(step, ok, detail);
  results.push({ ...step, ok, detail });
}

// Dataset outcome = its steps' outcomes: all ok → ok; some ok → rows pushed as
// partial; none ok → failure marker (server keeps the last good rows).
const pushPlan = new Map();
for (const r of results) {
  if (r.warnOnly) continue;
  for (const key of r.datasets) {
    const p = pushPlan.get(key) || { ok: [], failed: [] };
    (r.ok ? p.ok : p.failed).push(r.status ? r.status[0] : r.id);
    pushPlan.set(key, p);
  }
}
if (!ONLY.length) for (const key of ALWAYS_PUSH) pushPlan.set(key, { ok: ['sheet'], failed: [] });

const pushErrors = [];
if (!DRY && !NO_PUSH && pushPlan.size) {
  log(`[push] Sending ${pushPlan.size} dataset(s) to the dashboard server... (${clock()})`);
  const pulledAt = new Date().toISOString();
  const good = [...pushPlan].filter(([, p]) => p.ok.length).map(([key, p]) => [key, p.failed.length ? `partial — failed: ${p.failed.join(', ')}` : '']);
  const bad = [...pushPlan].filter(([, p]) => !p.ok.length).map(([key, p]) => [key, `failed: ${p.failed.join(', ')}`]);
  for (const [key, detail] of good) pushErrors.push(...(await pushOpsDatasets([key], { ok: true, detail, pulledAt, log })).filter((x) => !x.ok));
  for (const [key, detail] of bad) pushErrors.push(...(await pushOpsDatasets([key], { ok: false, detail, pulledAt, log })).filter((x) => !x.ok));
}

const failures = results.filter((r) => !r.ok && !r.warnOnly);
await alert(failures, pushErrors);
log(`=== Done ${clock()} — ${results.length - failures.length}/${results.length} steps ok${failures.length ? `, FAILED: ${failures.map((f) => f.id).join(', ')}` : ''}${pushErrors.length ? `, push errors: ${pushErrors.map((p) => p.key).join(', ')}` : ''} ===`);
process.exitCode = failures.length || pushErrors.length ? 1 : 0;

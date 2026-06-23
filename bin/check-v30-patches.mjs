import { getGoogleAuth } from '../src/google-auth.js';
const SCRIPT_ID = '1G8PrjOQ45yafM4lo3dL1AG8HKFSZ8tSlX7ei9EPZgw6bacjHk5CPtTW_';
const { client } = await getGoogleAuth();
const tok = (await client.getAccessToken()).token;

// Pull HEAD content
const r = await fetch(`https://script.googleapis.com/v1/projects/${SCRIPT_ID}/content`, { headers: { Authorization: 'Bearer ' + tok } });
const proj = await r.json();
const dash = proj.files.find(f => f.name === 'Dashboard').source;

const checks = [
  ['1. Task sort fn',          /function sortTasksForDisplay\(tasks\)/.test(dash)],
  ['1. filterTasks uses sort', /taskTable\(sortTasksForDisplay\(filtered\), false\)/.test(dash)],
  ['2. KPI Completed click',   /Completed[^)]*navWithFilter\('tasks', 'Completed'\)/.test(dash)],
  ['2. KPI In Progress click', /In Progress[^)]*navWithFilter\('tasks', 'In Progress'\)/.test(dash)],
  ['2. KPI At Risk click',     /At Risk[^)]*navWithFilter\('tasks', 'At Risk'\)/.test(dash)],
  ['2. Sales Impact click',    /Total Sales Impact[\s\S]{0,200}=> nav\('reports'\)/.test(dash)],
  ['2. navWithFilter defined', /window\.navWithFilter\s*=/.test(dash)],
  ['3. Date popover html',     dash.includes('id="date-pop"')],
  ['3. openDatePop defined',   /window\.openDatePop\s*=/.test(dash)],
  ['3. .hdr-date bound',       /pill\.onclick\s*=\s*openDatePop/.test(dash)],
  ['4. Reports parallel fetch',/serverGetBOStatus\(\);[\s\S]{0,200}serverGetReportData/.test(dash) || /serverGetReportData\(\);[\s\S]{0,300}serverGetBOStatus/.test(dash)],
  ['4. BO renderReportsData',  /injectBOSection/.test(dash)],
  ['4. ORCH_V2 marker',        dash.includes('ORCH_V2_INJECT_BEGIN')],
  ['v29 drawer S lookup',      /pool\.find\(x => String\(x\.Task_ID\)/.test(dash)],
];

console.log('PATCH CHECKS (HEAD source):');
let allOk = true;
for (const [label, ok] of checks) {
  console.log('  ' + (ok ? '✓' : '✗') + ' ' + label);
  if (!ok) allOk = false;
}

// Show what the kpi line for Completed looks like in actual source
const m = dash.match(/kpi\(['"]✅['"][^)]+\)/);
console.log('\nActual Completed kpi() call:');
console.log('  ', m ? m[0] : '(not matched)');

// Deployment check
const dep = await fetch(`https://script.googleapis.com/v1/projects/${SCRIPT_ID}/deployments`, { headers: { Authorization: 'Bearer ' + tok } });
if (dep.ok) {
  const deps = await dep.json();
  const webDep = (deps.deployments || []).find(d => (d.entryPoints || []).some(e => e.entryPointType === 'WEB_APP'));
  if (webDep) console.log('\nActive deployment version:', webDep.deploymentConfig?.versionNumber);
} else {
  console.log('\nDeployments list failed (no script.deployments scope) — that\'s normal.');
}

console.log('\n', allOk ? 'All patches present in HEAD source.' : 'SOME PATCHES MISSING.');

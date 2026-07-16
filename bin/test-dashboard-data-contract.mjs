#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const codePath = path.join(root, 'apps-script', 'control-tower', 'Code.gs');
const dashboardPath = path.join(root, 'apps-script', 'control-tower', 'Dashboard.html');
const code = readFileSync(codePath, 'utf8');
const dashboard = readFileSync(dashboardPath, 'utf8');

function formatDate(date, timeZone, pattern) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(date);
  const p = Object.fromEntries(parts.filter(x => x.type !== 'literal').map(x => [x.type, x.value]));
  if (pattern === 'yyyy') return p.year;
  if (pattern === 'yyyy-MM-dd') return `${p.year}-${p.month}-${p.day}`;
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}

const context = vm.createContext({
  console,
  Date,
  Math,
  JSON,
  String,
  Number,
  Object,
  Array,
  Set,
  RegExp,
  Utilities: { formatDate },
});

// Both server and browser sources must remain syntactically valid.
new vm.Script(code, { filename: codePath }).runInContext(context);
const inlineScripts = [...dashboard.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
assert.ok(inlineScripts.length > 0, 'Dashboard must contain an inline application script');
inlineScripts.forEach((script, i) => new vm.Script(script, { filename: `${dashboardPath}#script-${i + 1}` }));

const run = source => vm.runInContext(source, context);

assert.equal(run(`normaliseStatus_('Done')`), 'Completed');
assert.equal(run(`normaliseStatus_('QC_Required')`), 'In Progress');
assert.equal(run(`normaliseStatus_('Waiting_Approval')`), 'Pending Approval');
assert.equal(run(`normaliseStatus_('Need_Clarification')`), 'Needs Clarification');
assert.equal(run(`normaliseStatus_('unexpected value')`), 'Unmapped');

assert.equal(run(`normalisePriority_('P1')`), 'Urgent');
assert.equal(run(`normalisePriority_('P2')`), 'High');
assert.equal(run(`normalisePriority_('P3')`), 'Normal');
assert.equal(run(`normalisePriority_('P4')`), 'Low');
assert.equal(run(`normalisePriority_('')`), 'Unspecified');

assert.equal(run(`normaliseDueDate_('5/6 EOD', '2026-06-03T09:20:15Z')`), '2026-06-05');
assert.equal(run(`normaliseDueDate_('3pm today', '2026-06-16T05:53:11Z')`), '2026-06-16');
assert.equal(run(`normaliseDueDate_('10 July 2026', '')`), '2026-07-10');
assert.equal(run(`normaliseDueDate_('not a date', '2026-06-01')`), '');
assert.equal(run(`normaliseTimestamp_('2026-05-08 14:22')`), '2026-05-08T14:22:00+08:00');

const fixture = run(`normaliseTaskForDashboard_({
  Task_ID:'T-1', Status:'Done', Priority:'P2', Due_Date:'5/6 EOD',
  Submitted_At:'2026-06-03 09:20', Status_Updated_At:'2026-06-04 10:30',
  Owner:'alex@example.com', Notes:'Verified source note'
}, 2)`);
assert.equal(fixture.Status, 'Completed');
assert.equal(fixture.Priority, 'High');
assert.equal(fixture.Due_Date, '2026-06-05');
assert.equal(fixture.Description, 'Verified source note');
assert.equal(fixture.Progress, 100);
assert.deepEqual([...fixture._Data_Issues], []);

assert.ok(!dashboard.includes('Math.random'), 'Operational charts must not invent values');
assert.ok(!dashboard.includes('Automation Rate (placeholder)'), 'Placeholder automation metrics must not be shown');
assert.ok(!dashboard.includes("S.kpis = mockKPIs(); renderView(S.view); if(cb)cb(); })\n    .serverGetKPIs"), 'Live KPI failures must not fall back to demo data');
assert.ok(code.includes('return { ok:true, tasks:snapshot.tasks, dataHealth:snapshot.health };'), 'Task endpoint must return a health envelope');

console.log('Dashboard data contract: PASS');

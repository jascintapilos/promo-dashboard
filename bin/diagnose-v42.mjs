#!/usr/bin/env node
/**
 * Diagnostic: print context around the patterns V42 needs to patch
 */
import { getGoogleAuth } from '../src/google-auth.js';
const SCRIPT_ID = '1G8PrjOQ45yafM4lo3dL1AG8HKFSZ8tSlX7ei9EPZgw6bacjHk5CPtTW_';
const { client } = await getGoogleAuth();
const tok = (await client.getAccessToken()).token;

async function api(method, url, body) {
  const r = await fetch(`https://script.googleapis.com/v1${url}`, {
    method, headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${method} ${url}: ${r.status} ${await r.text()}`);
  return r.json();
}

const proj = await api('GET', `/projects/${SCRIPT_ID}/content`);
const dashIdx = proj.files.findIndex(f => f.name === 'Dashboard');
const dash = proj.files[dashIdx].source;

function show(label, pattern, before=120, after=180) {
  const i = dash.indexOf(pattern);
  if (i < 0) {
    console.log(`\n❌  "${label}" NOT FOUND`);
    return;
  }
  const snippet = dash.slice(Math.max(0, i - before), i + pattern.length + after);
  console.log(`\n✓  "${label}" found at index ${i}`);
  console.log('─'.repeat(60));
  console.log(JSON.stringify(snippet));
  console.log('─'.repeat(60));
}

// 1. Priority dropdown closing area (where we insert owner select)
show('task-priority closing + showTaskModal button', 'showTaskModal');

// 2. filterTasks() variable declarations
show('filterTasks const q / st / pr area', 'task-priority');

// 3. filterTasks filter body (matchPr / matchSt)
show('filterTasks matchPr', 'matchPr');

// 4. filterTasks return line
show('filterTasks return match', 'return matchQ');

// 5. Progress bar TD in taskRow
show('progress-fill', 'progress-fill');

// 6. Progress bar CSS
show('progress-bar CSS', '.progress-bar{');

// 7. Current badge
show('badge', '>V41 ✓</span>');
show('renderTasks anchor', 'function renderTasks');
show('loadAllTasks+renderTasks', 'S.tasks=t;renderTasks');

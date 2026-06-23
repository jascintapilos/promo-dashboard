#!/usr/bin/env node
/**
 * V38: Three fixes for "2,3,4 not showing"
 * 1. Recent Tasks on Overview now shows SORTED tasks (newest/today first)
 * 2. Custom scroll widget below task table: ◀ slider ▶ + vertical max-height
 * 3. Badge updated to V38
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
let dash = proj.files[dashIdx].source;

// ── FIX 1: Badge V36 → V38 ───────────────────────────────────────────────────
const OLD_BADGE = `>V36 ✓</span>`;
const NEW_BADGE = `>V38 ✓</span>`;
if (dash.includes(OLD_BADGE)) {
  dash = dash.replace(OLD_BADGE, NEW_BADGE);
  console.log('✓ Badge updated to V38');
} else {
  console.error('WARN: V36 badge not found');
}

// ── FIX 2: Overview mini-table → sortTasksForDisplay so newest tasks show ────
const OLD_MINI = `class="tbl-wrap">\${taskTable(S.tasks.slice(0,6), true)}</div>`;
const NEW_MINI = `class="tbl-wrap">\${taskTable(sortTasksForDisplay(S.tasks).slice(0,6), true)}</div>`;
if (dash.includes(OLD_MINI)) {
  dash = dash.replace(OLD_MINI, NEW_MINI);
  console.log('✓ Overview mini-table now sorted (recent tasks first)');
} else {
  console.error('WARN: overview mini-table pattern not found');
}

// ── FIX 3: Add scroll-ctrl CSS after existing tbl-wrap block ─────────────────
const OLD_TBLWRAP_CSS = `.tbl-wrap::-webkit-scrollbar-thumb:hover{background:var(--accent)}`;
const NEW_TBLWRAP_CSS = `.tbl-wrap::-webkit-scrollbar-thumb:hover{background:var(--accent)}
.tbl-wrap::-webkit-scrollbar{height:6px;width:6px}
.scroll-ctrl{display:flex;align-items:center;gap:8px;padding:4px 12px 8px;border-top:1px solid var(--border)}
.scroll-btn{background:var(--card2);border:1px solid var(--border);color:inherit;border-radius:4px;padding:2px 10px;cursor:pointer;font-size:14px;line-height:1.4}
.scroll-btn:hover{background:var(--accent);border-color:var(--accent);color:#fff}`;
if (dash.includes(OLD_TBLWRAP_CSS)) {
  dash = dash.replace(OLD_TBLWRAP_CSS, NEW_TBLWRAP_CSS);
  console.log('✓ scroll-ctrl CSS added');
} else {
  console.error('WARN: tbl-wrap thumb:hover CSS not found');
}

// ── FIX 4: Patch task-table-wrap div: add onscroll + vertical max-height ─────
//           and inject the ◀ slider ▶ widget below it
const OLD_TTWRAP = `      <div id="task-table-wrap" class="tbl-wrap">
        <div class="loading"><div class="spinner"></div>Loading tasks…</div>
      </div>
    </div>
  \`);`;
const NEW_TTWRAP = `      <div id="task-table-wrap" class="tbl-wrap" style="max-height:480px;overflow-y:auto" onscroll="syncScrollSlider_()">
        <div class="loading"><div class="spinner"></div>Loading tasks…</div>
      </div>
      <div class="scroll-ctrl" id="h-scroll-ctrl" style="display:none">
        <button class="scroll-btn" onclick="var w=document.getElementById('task-table-wrap');w.scrollLeft-=150;syncScrollSlider_()">◀</button>
        <input type="range" id="h-scroll-slider" min="0" max="100" value="0" style="flex:1;accent-color:var(--accent)" oninput="var w=document.getElementById('task-table-wrap');var mx=Math.max(0,w.scrollWidth-w.clientWidth);w.scrollLeft=(parseInt(this.value)/100)*mx">
        <button class="scroll-btn" onclick="var w=document.getElementById('task-table-wrap');w.scrollLeft+=150;syncScrollSlider_()">▶</button>
      </div>
    </div>
  \`);`;
if (dash.includes(OLD_TTWRAP)) {
  dash = dash.replace(OLD_TTWRAP, NEW_TTWRAP);
  console.log('✓ Scroll widget injected + max-height set on task-table-wrap');
} else {
  console.error('WARN: task-table-wrap pattern not found');
}

// ── FIX 5: Add syncScrollSlider_ function before filterTasks ─────────────────
const OLD_FILTER_FN = `\nfunction filterTasks() {`;
const NEW_FILTER_FN = `
function syncScrollSlider_() {
  var w = document.getElementById('task-table-wrap');
  var ctrl = document.getElementById('h-scroll-ctrl');
  var s = document.getElementById('h-scroll-slider');
  if (!w || !ctrl || !s) return;
  var mx = Math.max(0, w.scrollWidth - w.clientWidth);
  ctrl.style.display = mx > 0 ? 'flex' : 'none';
  if (mx > 0) s.value = Math.round(w.scrollLeft / mx * 100);
}

function filterTasks() {`;
if (dash.includes(OLD_FILTER_FN)) {
  dash = dash.replace(OLD_FILTER_FN, NEW_FILTER_FN);
  console.log('✓ syncScrollSlider_ function added');
} else {
  console.error('WARN: function filterTasks anchor not found');
}

// ── FIX 6: Call syncScrollSlider_ after filterTasks renders table ─────────────
const OLD_FILTER_BODY = `  if (wrap) wrap.innerHTML = taskTable(sortTasksForDisplay(filtered), false);
}`;
const NEW_FILTER_BODY = `  if (wrap) { wrap.innerHTML = taskTable(sortTasksForDisplay(filtered), false); setTimeout(syncScrollSlider_, 0); }
}`;
if (dash.includes(OLD_FILTER_BODY)) {
  dash = dash.replace(OLD_FILTER_BODY, NEW_FILTER_BODY);
  console.log('✓ filterTasks now calls syncScrollSlider_ after render');
} else {
  console.error('WARN: filterTasks body pattern not found');
}

proj.files[dashIdx].source = dash;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('✓ Pushed');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V38: recent tasks sorted + scroll slider widget + V38 badge — ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);
console.log('');
console.log('═══════════════════════════════════════════════════════');
console.log('DEPLOY V' + v.versionNumber);
console.log('═══════════════════════════════════════════════════════');
console.log('Apps Script → Deploy ▼ → Manage deployments');
console.log('→ Pencil on active → pick Version ' + v.versionNumber + ' → Deploy');
console.log('');
console.log('What to verify:');
console.log('1. Badge shows "V38 ✓" next to title');
console.log('2. Overview → Task Orchestration mini-table shows LATEST tasks');
console.log('3. Task Orchestration page → scroll ◀ slider ▶ appears below table');
console.log('4. Dragging slider scrolls table left/right; ◀▶ buttons jump 150px');
console.log('5. Refresh button: click → shows "Syncing…" → reloads tasks');

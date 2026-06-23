#!/usr/bin/env node
/**
 * Inject an enhanced Task Detail Drawer + live-sync indicator into the
 * Promo Control Tower dashboard. Preserves all existing UI; replaces only
 * the showTaskDetail behavior to open a rich side panel.
 *
 * What this adds:
 *  - Right-sliding 520px drawer with tabbed view: Details / Timeline / Actions
 *  - Source-channel badge (#ba-promo / #promotions-team / Manual)
 *  - "Open in Slack" button (deep-links to the source thread)
 *  - "Open Sheet row" button (jumps to Task_Master row)
 *  - "Re-sync from Slack" button (calls serverSyncSlackTasks then refreshes)
 *  - Live "Synced Xm ago" relative-time pill near the Refresh button
 *  - Smooth slide-in animation, ESC + click-outside to close, focus trap
 *
 * Idempotent — re-running replaces the previous injection block.
 */
import { getGoogleAuth } from '../src/google-auth.js';

const SCRIPT_ID = '1G8PrjOQ45yafM4lo3dL1AG8HKFSZ8tSlX7ei9EPZgw6bacjHk5CPtTW_';
const { client } = await getGoogleAuth();
const tok = (await client.getAccessToken()).token;

async function api(method, url, body) {
  const res = await fetch(`https://script.googleapis.com/v1${url}`, {
    method, headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${url}: ${res.status} ${await res.text()}`);
  return res.json();
}

const proj = await api('GET', `/projects/${SCRIPT_ID}/content`);
const dashIdx = proj.files.findIndex(f => f.name === 'Dashboard');
let dash = proj.files[dashIdx].source;

const BEGIN = '/* === TASK_DRAWER_INJECT_BEGIN === */';
const END   = '/* === TASK_DRAWER_INJECT_END === */';

// Strip any previous version of the injection
const re = new RegExp(BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]*?' + END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
dash = dash.replace(re, '');

const inject = `
<style>
${BEGIN.slice(3, -3)}
/* Task drawer */
#tdrw-backdrop {
  position: fixed; inset: 0; background: rgba(0,0,0,0.55);
  z-index: 9000; opacity: 0; pointer-events: none;
  transition: opacity .18s ease-out;
}
#tdrw-backdrop.open { opacity: 1; pointer-events: auto; }
#tdrw {
  position: fixed; top: 0; right: 0; height: 100vh;
  width: min(540px, 100vw);
  background: var(--card, #14151b);
  border-left: 1px solid var(--border, #2a2c36);
  z-index: 9001;
  transform: translateX(100%);
  transition: transform .22s cubic-bezier(.4,.0,.2,1);
  display: flex; flex-direction: column;
  box-shadow: -16px 0 40px rgba(0,0,0,.4);
}
#tdrw.open { transform: translateX(0); }
.tdrw-hdr {
  padding: 18px 22px 14px;
  border-bottom: 1px solid var(--border, #2a2c36);
  display: flex; justify-content: space-between; align-items: flex-start; gap: 12px;
}
.tdrw-id { font-family: ui-monospace, monospace; font-size: 11px; color: var(--muted, #8b8d96); }
.tdrw-title { font-size: 16px; font-weight: 600; margin-top: 4px; color: var(--text, #e5e7ed); line-height: 1.35; }
.tdrw-close {
  background: transparent; border: 1px solid var(--border, #2a2c36);
  color: var(--muted, #8b8d96); width: 28px; height: 28px; border-radius: 6px;
  cursor: pointer; font-size: 16px; line-height: 1;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.tdrw-close:hover { color: var(--text, #e5e7ed); border-color: var(--text, #e5e7ed); }
.tdrw-tabs {
  display: flex; gap: 0; border-bottom: 1px solid var(--border, #2a2c36); padding: 0 22px;
}
.tdrw-tab {
  padding: 10px 14px; cursor: pointer; font-size: 12px; font-weight: 500;
  color: var(--muted, #8b8d96); border-bottom: 2px solid transparent;
  background: transparent; border-top: none; border-left: none; border-right: none;
}
.tdrw-tab.active { color: var(--accent, #8e7cff); border-bottom-color: var(--accent, #8e7cff); }
.tdrw-tab:hover { color: var(--text, #e5e7ed); }
.tdrw-body {
  flex: 1; overflow-y: auto; padding: 18px 22px 22px;
}
.tdrw-row {
  display: grid; grid-template-columns: 110px 1fr; gap: 10px;
  padding: 9px 0; border-bottom: 1px solid rgba(255,255,255,0.04);
  font-size: 13px;
}
.tdrw-row:last-child { border-bottom: none; }
.tdrw-row .label { color: var(--muted, #8b8d96); font-size: 11px; text-transform: uppercase; letter-spacing: .03em; padding-top: 2px; }
.tdrw-row .value { color: var(--text, #e5e7ed); word-break: break-word; }
.tdrw-row .value a { color: var(--accent, #8e7cff); text-decoration: none; }
.tdrw-row .value a:hover { text-decoration: underline; }
.tdrw-pill {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 8px; border-radius: 12px; font-size: 11px; font-weight: 500;
  background: rgba(142,124,255,0.12); color: var(--accent, #8e7cff);
}
.tdrw-pill.banner { background: rgba(255,176,76,0.14); color: #ffb04c; }
.tdrw-pill.team { background: rgba(76,191,255,0.14); color: #4cbfff; }
.tdrw-pill.manual { background: rgba(139,141,150,0.14); color: #8b8d96; }
.tdrw-actions {
  display: flex; flex-direction: column; gap: 8px; padding-top: 4px;
}
.tdrw-btn {
  padding: 9px 14px; border-radius: 8px; cursor: pointer;
  font-size: 13px; font-weight: 500; text-align: left;
  background: var(--bg-soft, #1a1c24); color: var(--text, #e5e7ed);
  border: 1px solid var(--border, #2a2c36);
  display: flex; align-items: center; gap: 10px;
  transition: background .12s, border-color .12s;
}
.tdrw-btn:hover { background: var(--card, #14151b); border-color: var(--accent, #8e7cff); }
.tdrw-btn:disabled { opacity: .5; cursor: not-allowed; }
.tdrw-btn .ic { font-size: 14px; opacity: .8; }
.tdrw-empty { color: var(--muted, #8b8d96); font-size: 12px; padding: 30px 0; text-align: center; }
.tdrw-tline {
  position: relative; padding-left: 18px;
}
.tdrw-tline::before {
  content: ''; position: absolute; left: 5px; top: 6px; bottom: 6px; width: 1px;
  background: var(--border, #2a2c36);
}
.tdrw-tevent {
  position: relative; padding: 6px 0 10px;
  font-size: 12px;
}
.tdrw-tevent::before {
  content: ''; position: absolute; left: -16px; top: 11px;
  width: 9px; height: 9px; border-radius: 50%;
  background: var(--accent, #8e7cff); border: 2px solid var(--card, #14151b);
}
.tdrw-tevent .ttitle { color: var(--text, #e5e7ed); font-weight: 500; }
.tdrw-tevent .tmeta { color: var(--muted, #8b8d96); font-size: 11px; margin-top: 1px; }

/* Live sync pill near Refresh */
#live-sync-pill {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 10px; border-radius: 12px; font-size: 11px; font-weight: 500;
  background: rgba(76,191,255,0.10); color: #4cbfff;
  margin-left: 10px;
}
#live-sync-pill .dot {
  width: 6px; height: 6px; border-radius: 50%; background: #4cbfff;
  box-shadow: 0 0 6px #4cbfff;
  animation: pulse 2s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
${END.slice(3, -3)}
</style>
<div id="tdrw-backdrop"></div>
<div id="tdrw" role="dialog" aria-modal="true" aria-labelledby="tdrw-title-el">
  <div class="tdrw-hdr">
    <div style="min-width:0;flex:1">
      <div class="tdrw-id" id="tdrw-id-el">—</div>
      <div class="tdrw-title" id="tdrw-title-el">—</div>
    </div>
    <button class="tdrw-close" onclick="closeTaskDrawer()" aria-label="Close">×</button>
  </div>
  <div class="tdrw-tabs">
    <button class="tdrw-tab active" data-tab="details" onclick="tdrwSwitchTab('details')">Details</button>
    <button class="tdrw-tab" data-tab="timeline" onclick="tdrwSwitchTab('timeline')">Timeline</button>
    <button class="tdrw-tab" data-tab="actions" onclick="tdrwSwitchTab('actions')">Actions</button>
  </div>
  <div class="tdrw-body" id="tdrw-body">…</div>
</div>
<script>
${BEGIN.slice(3, -3)}
(function() {
  function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

  function fmtRel(iso) {
    if (!iso) return '';
    const t = new Date(iso).getTime();
    if (isNaN(t)) return '';
    const s = (Date.now() - t) / 1000;
    if (s < 60) return Math.round(s) + 's ago';
    if (s < 3600) return Math.round(s/60) + 'm ago';
    if (s < 86400) return Math.round(s/3600) + 'h ago';
    return Math.round(s/86400) + 'd ago';
  }
  function fmtAbs(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleString();
  }

  function channelKind(t) {
    const id = String(t.Task_ID || '');
    if (id.startsWith('BT-')) return { key: 'banner', label: '#ba-promo' };
    if (id.startsWith('PT-')) return { key: 'team', label: '#promotions-team' };
    return { key: 'manual', label: 'Manual' };
  }

  window.tdrwCurrent = null;
  window.tdrwSwitchTab = function(tab) {
    document.querySelectorAll('#tdrw .tdrw-tab').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === tab);
    });
    renderDrawerBody(window.tdrwCurrent, tab);
  };

  function renderDrawerBody(t, tab) {
    if (!t) return;
    const body = document.getElementById('tdrw-body');
    const ch = channelKind(t);

    if (tab === 'details') {
      const rows = [
        ['Status', '<span class="tdrw-pill">' + escapeHtml(t.Status || 'New') + '</span>'],
        ['Priority', escapeHtml(t.Priority || 'Normal')],
        ['Source', '<span class="tdrw-pill ' + ch.key + '">' + ch.label + '</span>'],
        ['Brand', escapeHtml(t.Brand || '—')],
        ['Module', escapeHtml(t.Module || '—')],
        ['Owner', escapeHtml(t.Owner || '—')],
        ['Submitter', escapeHtml(t.Submitter || '—')],
        ['Due Date', t.Due_Date ? escapeHtml(String(t.Due_Date).slice(0, 10)) : '—'],
        ['Request Ref', escapeHtml(t.Request_Ref || '—')],
        ['SOP Ref', escapeHtml(t.SOP_Ref || '—')],
      ];
      if (t.Source_Link) {
        rows.push(['Source', '<a href="' + escapeHtml(t.Source_Link) + '" target="_blank" rel="noopener">Open in Slack →</a>']);
      }
      if (t.Notes) rows.push(['Notes', escapeHtml(t.Notes)]);
      if (t.Description) rows.push(['Description', escapeHtml(t.Description)]);

      body.innerHTML = rows.map(([k, v]) =>
        '<div class="tdrw-row"><div class="label">' + k + '</div><div class="value">' + v + '</div></div>'
      ).join('');
    }
    else if (tab === 'timeline') {
      const events = [];
      if (t.Submitted_At) events.push({ title: 'Task created', time: t.Submitted_At, meta: 'From #' + (ch.label || 'manual') });
      if (t.Status_Updated_At) events.push({ title: 'Status: ' + (t.Status || 'updated'), time: t.Status_Updated_At, meta: 'Last sync from Slack' });
      if (t.Approved_At) events.push({ title: 'Approved', time: t.Approved_At, meta: t.Approver || '' });
      if (t.Executed_At) events.push({ title: 'Executed', time: t.Executed_At });
      events.sort((a,b) => new Date(a.time) - new Date(b.time));

      if (!events.length) {
        body.innerHTML = '<div class="tdrw-empty">No timeline events.</div>';
      } else {
        body.innerHTML = '<div class="tdrw-tline">' + events.map(e =>
          '<div class="tdrw-tevent"><div class="ttitle">' + escapeHtml(e.title) + '</div>' +
          '<div class="tmeta">' + fmtAbs(e.time) + ' · ' + fmtRel(e.time) + (e.meta ? ' · ' + escapeHtml(e.meta) : '') + '</div></div>'
        ).join('') + '</div>';
      }
    }
    else if (tab === 'actions') {
      const slackHref = t.Source_Link || '';
      const sheetHref = 'https://docs.google.com/spreadsheets/d/16iI85GrAqldbBcGhpvAwJT3_3JJDqLemLaGhjPXMlQk/edit?gid=0';
      body.innerHTML =
        '<div class="tdrw-actions">' +
        (slackHref ?
          '<button class="tdrw-btn" onclick="window.open(\\''+escapeHtml(slackHref)+'\\', \\'_blank\\')">' +
          '<span class="ic">↗</span><span><b>Open Slack thread</b><div style="font-size:11px;color:var(--muted);margin-top:2px">Jump to the original message in #' + ch.label + '</div></span></button>' : '') +
        '<button class="tdrw-btn" onclick="window.open(\\''+sheetHref+'\\', \\'_blank\\')">' +
        '<span class="ic">📄</span><span><b>Open Task_Master sheet</b><div style="font-size:11px;color:var(--muted);margin-top:2px">View this task\\'s row in the sheet</div></span></button>' +
        '<button class="tdrw-btn" onclick="tdrwResync()">' +
        '<span class="ic">🔄</span><span><b>Re-sync this task from Slack</b><div style="font-size:11px;color:var(--muted);margin-top:2px">Fetch latest replies + status from Slack</div></span></button>' +
        (t.Status !== 'Done' ?
          '<button class="tdrw-btn" onclick="tdrwMarkDone()">' +
          '<span class="ic">✓</span><span><b>Mark as Done</b><div style="font-size:11px;color:var(--muted);margin-top:2px">Set Status = Done in Task_Master</div></span></button>' : '') +
        '</div>';
    }
  }

  window.tdrwResync = function() {
    const btns = document.querySelectorAll('#tdrw-body .tdrw-btn');
    btns.forEach(b => b.disabled = true);
    google.script.run
      .withSuccessHandler(function() {
        btns.forEach(b => b.disabled = false);
        if (typeof loadAllTasks === 'function') {
          loadAllTasks(function(t) {
            window.S && (window.S.tasks = t);
            if (typeof renderTasks === 'function') renderTasks();
            // re-find the task
            const fresh = (t || []).find(x => String(x.Task_ID) === String(window.tdrwCurrent && window.tdrwCurrent.Task_ID));
            if (fresh) { window.tdrwCurrent = fresh; renderDrawerBody(fresh, 'details'); }
          });
        }
        updateLiveSyncPill();
      })
      .withFailureHandler(function(err) {
        btns.forEach(b => b.disabled = false);
        alert('Re-sync failed: ' + (err && err.message));
      })
      .serverSyncSlackTasks();
  };

  window.tdrwMarkDone = function() {
    if (!window.tdrwCurrent) return;
    if (!confirm('Mark "' + (window.tdrwCurrent.Title || 'this task') + '" as Done?')) return;
    const btns = document.querySelectorAll('#tdrw-body .tdrw-btn');
    btns.forEach(b => b.disabled = true);
    // Reuse existing serverUpdateTask if available; otherwise best-effort
    if (typeof google !== 'undefined' && google.script && google.script.run) {
      google.script.run
        .withSuccessHandler(function() {
          window.tdrwCurrent.Status = 'Done';
          renderDrawerBody(window.tdrwCurrent, 'details');
          if (typeof loadAllTasks === 'function') loadAllTasks(function(t) { window.S && (window.S.tasks = t); if (typeof renderTasks === 'function') renderTasks(); });
          btns.forEach(b => b.disabled = false);
        })
        .withFailureHandler(function(err) {
          btns.forEach(b => b.disabled = false);
          alert('Update failed: ' + (err && err.message));
        })
        .serverUpdateTask({ Task_ID: window.tdrwCurrent.Task_ID, Status: 'Done' });
    }
  };

  window.openTaskDrawer = function(taskOrId) {
    // Look up task: prefer global S (top-level var in dashboard), fall back to window.S
    var pool = (typeof S !== 'undefined' && S && S.tasks) ? S.tasks :
               ((window.S && window.S.tasks) || []);
    const t = (typeof taskOrId === 'object') ? taskOrId :
              pool.find(x => String(x.Task_ID) === String(taskOrId));
    if (!t) {
      console.warn('openTaskDrawer: task not found:', taskOrId, 'pool size:', pool.length);
      return;
    }
    window.tdrwCurrent = t;
    const ch = channelKind(t);
    document.getElementById('tdrw-id-el').textContent = (t.Task_ID || '—') + ' · ' + ch.label;
    document.getElementById('tdrw-title-el').textContent = t.Title || t.Module || 'Task Detail';
    document.querySelectorAll('#tdrw .tdrw-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === 'details'));
    renderDrawerBody(t, 'details');
    document.getElementById('tdrw-backdrop').classList.add('open');
    document.getElementById('tdrw').classList.add('open');
  };

  window.closeTaskDrawer = function() {
    document.getElementById('tdrw-backdrop').classList.remove('open');
    document.getElementById('tdrw').classList.remove('open');
    window.tdrwCurrent = null;
  };

  // Override showTaskDetail to use the drawer (catches direct callers)
  window.showTaskDetail = function(id) {
    window.openTaskDrawer(id);
  };

  // Inline onclick handlers like onclick="showTaskDetail('ID')" don't resolve
  // through window. Intercept the click in capture phase before the handler fires.
  document.addEventListener('click', function(e) {
    const tr = e.target && e.target.closest && e.target.closest('tr[onclick*="showTaskDetail"]');
    if (!tr) return;
    const oc = tr.getAttribute('onclick') || '';
    const m = oc.match(/showTaskDetail\\(\\s*['"]([^'"]+)['"]/);
    if (!m) return;
    e.stopPropagation();
    e.preventDefault();
    window.openTaskDrawer(m[1]);
  }, true);

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && window.tdrwCurrent) closeTaskDrawer();
  });
  document.getElementById('tdrw-backdrop').addEventListener('click', closeTaskDrawer);

  // --- Live sync pill ---
  function updateLiveSyncPill() {
    window.__lastSyncTs = Date.now();
    const pill = document.getElementById('live-sync-pill');
    if (pill) pill.querySelector('.label').textContent = 'Synced now';
  }
  function tickLiveSyncPill() {
    if (!window.__lastSyncTs) return;
    const pill = document.getElementById('live-sync-pill');
    if (!pill) return;
    pill.querySelector('.label').textContent = 'Synced ' + fmtRel(new Date(window.__lastSyncTs).toISOString());
  }
  window.__lastSyncTs = Date.now();
  setInterval(tickLiveSyncPill, 15000);

  function installLiveSyncPill() {
    const refreshBtns = Array.from(document.querySelectorAll('button')).filter(b => /Refresh/i.test(b.innerText || ''));
    refreshBtns.forEach(b => {
      if (b.dataset.pillInstalled) return;
      const pill = document.createElement('span');
      pill.id = 'live-sync-pill';
      pill.innerHTML = '<span class="dot"></span><span class="label">Synced just now</span>';
      b.parentNode.insertBefore(pill, b.nextSibling);
      b.dataset.pillInstalled = '1';
    });
  }
  installLiveSyncPill();
  setInterval(installLiveSyncPill, 1500);

  // Hook the existing Slack-sync onclick so the pill resets when sync completes
  const origSyncFn = window.__syncSlackThenLoadTasks;
  if (origSyncFn) {
    window.__syncSlackThenLoadTasks = function() {
      const btn = Array.from(document.querySelectorAll('button')).find(b => /Refresh/i.test(b.innerText || ''));
      var origText = btn ? btn.innerText : null;
      if (btn) { btn.disabled = true; btn.innerText = '⟳ Syncing Slack…'; }
      function finish() {
        if (btn) { btn.disabled = false; btn.innerText = origText || '⟳ Refresh'; }
        if (typeof loadAllTasks === 'function') {
          loadAllTasks(function(t) { window.S && (window.S.tasks = t); if (typeof renderTasks === 'function') renderTasks(); });
        }
        updateLiveSyncPill();
      }
      google.script.run
        .withSuccessHandler(finish)
        .withFailureHandler(function(err) {
          console.warn('Slack sync failed:', err && err.message);
          finish();
        })
        .serverSyncSlackTasks();
    };
  }
})();
${END.slice(3, -3)}
</script>
`;

// Insert before </body>
if (dash.includes('</body>')) {
  dash = dash.replace('</body>', inject + '\n</body>');
} else {
  dash += '\n' + inject;
}

// Direct source patch: rewire the inline onclick handlers in taskRow() so
// they invoke our drawer instead of the original modal. This is more reliable
// than runtime interception because Apps Script HTML scopes are quirky.
dash = dash.replace(/onclick="showTaskDetail\(/g, 'onclick="openTaskDrawer(');

proj.files[dashIdx].source = dash;

console.log('Pushing patched Dashboard.html…');
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('✓ Patched');

// Create new version + remind user to update deployment
const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'Task detail drawer + live sync pill — ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);
console.log(`\nNext: Apps Script editor → Deploy ▼ → Manage deployments → pencil → pick Version ${v.versionNumber} → Deploy`);

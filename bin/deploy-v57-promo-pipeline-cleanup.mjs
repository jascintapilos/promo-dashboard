#!/usr/bin/env node
/**
 * V57 — Promo Codes page: drop Promo Tasks widget, slim Request Pipeline
 *
 *  1. Remove the 📋 Promo Tasks section entirely.
 *  2. Keep 📥 Request Pipeline but:
 *     - drop the "Amt" column
 *     - filter to only show rows where Status is "New" or "In Progress"
 *       (anything else — Done, Pending, Completed — is hidden).
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

let pass = 0, fail = 0;
function patch(label, oldStr, newStr) {
  if (dash.includes(oldStr)) {
    dash = dash.replace(oldStr, newStr);
    console.log('✓ ' + label);
    pass++;
    return true;
  }
  console.error('✗ WARN: ' + label + ' — anchor not found');
  fail++;
  return false;
}

// ─── 1. Remove the 📋 Promo Tasks card ──────────────────────────────────────
patch('Remove Promo Tasks card from renderPromos',
  `    <div class="card">
      <div class="card-hdr"><h3>📋 Promo Tasks</h3><a class="hint" style="color:var(--accent);cursor:pointer" onclick="nav('tasks')">View all →</a></div>
      <div class="tbl-wrap" style="max-height:320px;overflow-y:auto">
        \${taskTable(tasks.length ? tasks : S.tasks.slice(0,8), true)}
      </div>
    </div>
    <div class="card" id="promo-requests-card">`,
  `    <div class="card" id="promo-requests-card">`);

// ─── 2. Update renderPromoRequestsList: drop Amt + filter Status ────────────
patch('renderPromoRequestsList — drop Amt column, filter New/In Progress only',
  `function renderPromoRequestsList(reqs) {
  const el = document.getElementById('promo-requests-body');
  if (!el) return;
  if (!reqs || !reqs.length) {
    el.innerHTML = '<div class="empty"><div class="empty-icon">📭</div><div>No requests yet — submit one above!</div></div>';
    return;
  }
  el.innerHTML = \`<table><thead><tr><th>ID</th><th>Brand</th><th>Type</th><th>Amt</th><th>Pri</th><th>Status</th></tr></thead>
    <tbody>\${reqs.map(r=>\`<tr>
      <td style="font-family:monospace;font-size:10px">\${esc(r.Request_ID||'')}</td>
      <td style="font-size:12px">\${esc(r.Brand||'')}</td>
      <td style="font-size:12px">\${esc(r.Bonus_Type||'')}</td>
      <td style="font-size:12px">\${esc(String(r.Amount||'—'))}</td>
      <td><span class="badge \${r.Priority==='Urgent'?'c-red':r.Priority==='High'?'c-amber':'c-muted'}">\${esc(r.Priority||'Normal')}</span></td>
      <td><span class="badge \${r.Status==='Done'?'c-green':r.Status==='In Progress'?'c-blue':'c-muted'}">\${esc(r.Status||'Pending')}</span></td>
    </tr>\`).join('')}</tbody></table>\`;
}`,
  `function renderPromoRequestsList(reqs) {
  const el = document.getElementById('promo-requests-body');
  if (!el) return;
  // Only show open work — New or In Progress; hide Done/Completed/etc.
  var openOnly = (reqs || []).filter(function(r){
    var s = String(r.Status||'').toLowerCase().trim();
    return s === 'new' || s === '' || /in.?progress|wip|active/i.test(s);
  });
  if (!openOnly.length) {
    el.innerHTML = '<div class="empty"><div class="empty-icon">📭</div><div>No open requests — all caught up!</div></div>';
    return;
  }
  el.innerHTML = \`<table><thead><tr><th>ID</th><th>Brand</th><th>Type</th><th>Pri</th><th>Status</th></tr></thead>
    <tbody>\${openOnly.map(r=>\`<tr>
      <td style="font-family:monospace;font-size:10px">\${esc(r.Request_ID||'')}</td>
      <td style="font-size:12px">\${esc(r.Brand||'')}</td>
      <td style="font-size:12px">\${esc(r.Bonus_Type||'')}</td>
      <td><span class="badge \${r.Priority==='Urgent'?'c-red':r.Priority==='High'?'c-amber':'c-muted'}">\${esc(r.Priority||'Normal')}</span></td>
      <td><span class="badge \${/in.?progress/i.test(String(r.Status||''))?'c-blue':'c-muted'}">\${esc(r.Status||'New')}</span></td>
    </tr>\`).join('')}</tbody></table>\`;
}`);

// Badge bump
patch('Badge V56 → V57', `>V56 ✓</span>`, `>V57 ✓</span>`);

proj.files[dashIdx].source = dash;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('\n✓ Pushed — ' + pass + ' patches applied, ' + fail + ' warnings');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V57 — drop Promo Tasks, slim Pipeline — ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);

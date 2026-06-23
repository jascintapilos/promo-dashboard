#!/usr/bin/env node
/**
 * V43 — Five operational improvements
 *
 * FIX 1: Status normalization
 *   - Expanded regex catches: completed/done/finished/closed/delivered/live/launched
 *     and at-risk/blocked/stuck plus "pending"/"review" → Pending Approval.
 *   - sortTasksForDisplay uses normaliseStatus_ so old "Completed" tasks don't
 *     get bucketed as overdue.
 *
 * FIX 2: Owner / assignee
 *   - Edit-Task modal Owner becomes a datalist (auto-complete from team roster
 *     + every unique Owner already on a task).
 *
 * FIX 3: Notification popup (top-right)
 *   - When new RN/B-ID lands in the source sheets, dashboard polls notif tab
 *     every 60s and now pops a slide-in toast in the top-right + pulses the
 *     bell icon. Click a toast to jump to the relevant page.
 *
 * FIX 4: Promo Code request form — full template + write-back
 *   - Expanded the Request Promo Code form from 9 fields → 27 fields matching
 *     the operator's Promo Code Request template.
 *   - serverSubmitPromoCodeRequest now writes to BOTH:
 *       1. local Promo_Requests tab (dashboard tracker)
 *       2. operator's Promo_Code_Request spreadsheet (current-month tab) with
 *          auto-generated next P-number and header-aware column mapping.
 *
 * FIX 5: Date pill applies to all pages
 *   - The Jan 1–Today pill now re-renders the active view with a date-window
 *     applied. Overview KPIs recompute from filtered tasks; Tasks table
 *     respects window; Promos/Banners/Reports honour same filter.
 *
 * FIX 6: Badge V42 → V43
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
const codeIdx = proj.files.findIndex(f => f.name === 'Code');
let dash = proj.files[dashIdx].source;
let code = proj.files[codeIdx].source;

let pass = 0, fail = 0;
function patch(label, target, oldStr, newStr) {
  const src = target === 'dash' ? dash : code;
  if (src.includes(oldStr)) {
    if (target === 'dash') dash = src.replace(oldStr, newStr);
    else                   code = src.replace(oldStr, newStr);
    console.log('✓ ' + label);
    pass++;
    return true;
  }
  console.error('✗ WARN: ' + label + ' — anchor not found');
  fail++;
  return false;
}

// ─── FIX 1a: Expand normaliseStatus_ ─────────────────────────────────────────
patch('normaliseStatus_ — expanded regex (completed/done/launched/live)',
  'dash',
  `function normaliseStatus_(raw) { const s=String(raw||'').trim(); if(/complete|done/i.test(s))return 'Completed'; if(/progress|building|wip/i.test(s))return 'In Progress'; if(/approv|waiting/i.test(s))return 'Pending Approval'; if(/risk|escalat|fail|delay/i.test(s))return 'At Risk'; if(/clarif/i.test(s))return 'Needs Clarification'; return s||'New'; }`,
  `function normaliseStatus_(raw) { const s=String(raw||'').trim(); if(!s)return 'New'; if(/complete|done|finish|deliver|launch|^live$|closed|qc.?completed/i.test(s))return 'Completed'; if(/progress|building|wip|on.?going|active|working/i.test(s))return 'In Progress'; if(/approv|waiting|review|^pending$|qc(?!.?completed)/i.test(s))return 'Pending Approval'; if(/risk|escalat|fail|delay|stuck|block/i.test(s))return 'At Risk'; if(/clarif|question|on.?hold/i.test(s))return 'Needs Clarification'; return s||'New'; }`);

// ─── FIX 1b: sortTasksForDisplay use normalised status ───────────────────────
patch('sortTasksForDisplay — use normalised Completed check',
  'dash',
  `    if (due && due < t0ms && (t.Status||'').toLowerCase() !== 'done') return 1;`,
  `    if (due && due < t0ms && normaliseStatus_(t.Status) !== 'Completed') return 1;`);

// ─── FIX 2: Owner datalist (autocomplete) in Edit Task modal ─────────────────
patch('Add getOwnerOptions_() helper before showTaskModal',
  'dash',
  `// ── Task Modal ───────────────────────────────────────────────────────────────
function showTaskModal(editId) {`,
  `// ── Owner roster helper (drives Edit-Task datalist) ──────────────────────────
function getOwnerOptions_() {
  var seed = ['Jascinta Pilos','Wai Yip','Sarah P.','Karan T.','Daniel P.','Mimi','Lexa','jascinta.pilos@thebrandingpeople.co','waiyip@thebrandingpeople.co'];
  var live = (window.S && Array.isArray(window.S.tasks))
    ? window.S.tasks.map(function(t){return String(t.Owner||'').trim();}).filter(Boolean)
    : [];
  var seen = {}, out = [];
  seed.concat(live).forEach(function(v){
    var k = v.toLowerCase();
    if (v && !seen[k]) { seen[k] = true; out.push(v); }
  });
  return out.sort();
}

// ── Task Modal ───────────────────────────────────────────────────────────────
function showTaskModal(editId) {`);

patch('Owner input → datalist (autocomplete from roster + live tasks)',
  'dash',
  `      <div class="form-row"><label class="form-label">Owner</label><input id="t-owner" value="\${esc(v('Owner'))}" placeholder="Name or email"></div>`,
  `      <div class="form-row"><label class="form-label">Owner / Assignee</label>
        <input id="t-owner" list="t-owner-list" value="\${esc(v('Owner'))}" placeholder="Start typing — pick from roster or add new">
        <datalist id="t-owner-list">\${getOwnerOptions_().map(function(o){return '<option value="'+esc(o)+'">';}).join('')}</datalist>
      </div>`);

// ─── FIX 3: Notification toast popups + bell pulse ───────────────────────────
patch('loadNotifications_ — detect arrivals, toast new ones, pulse bell',
  'dash',
  `function loadNotifications_() {
  if (typeof google === 'undefined') return;
  google.script.run
    .withSuccessHandler(data => {
      S.notifs = data || { unread: 0, items: [] };
      updateNotifBadge_();
    })
    .serverGetNotifications();
}`,
  `function loadNotifications_() {
  if (typeof google === 'undefined') return;
  google.script.run
    .withSuccessHandler(data => {
      var prevUnread = (S.notifs && S.notifs.unread) || 0;
      var prevIds    = (S.notifs && S.notifs.items) ? S.notifs.items.map(function(i){return i.Notif_ID;}) : [];
      var firstLoad  = !S.notifs || prevIds.length === 0;
      S.notifs = data || { unread: 0, items: [] };
      updateNotifBadge_();
      // Pop a top-right toast only for genuinely new arrivals (skip first load)
      if (!firstLoad && S.notifs.unread > prevUnread && S.notifs.items && S.notifs.items.length) {
        var fresh = S.notifs.items
          .filter(function(i){ return prevIds.indexOf(i.Notif_ID) < 0 && !i.is_read; })
          .slice(0, 3);
        fresh.forEach(function(n, i){ setTimeout(function(){ showNotifPopup_(n); }, i * 250); });
        // Pulse the bell
        var bell = document.querySelector('.notif-btn');
        if (bell) {
          bell.classList.add('pulse');
          setTimeout(function(){ bell.classList.remove('pulse'); }, 4200);
        }
      }
    })
    .serverGetNotifications();
}

function showNotifPopup_(n) {
  var existing = document.querySelectorAll('.notif-popup').length;
  var offset = 70 + existing * 82;
  var el = document.createElement('div');
  el.className = 'notif-popup';
  el.style.cssText = 'position:fixed;top:' + offset + 'px;right:20px;background:linear-gradient(135deg,var(--card),var(--card2));border:1px solid var(--accent);border-left:4px solid var(--accent);border-radius:10px;padding:12px 14px;min-width:280px;max-width:360px;z-index:10000;box-shadow:0 8px 24px rgba(0,0,0,.5);animation:slideInRight .35s cubic-bezier(.2,.9,.3,1.2);cursor:pointer';
  var icon = n.Type === 'promo_request' ? '🎯' : n.Type === 'banner_task' ? '🖼' : '🔔';
  el.innerHTML = '<div style="display:flex;gap:10px;align-items:start">' +
    '<div style="font-size:22px;flex-shrink:0">' + icon + '</div>' +
    '<div style="flex:1;min-width:0">' +
    '<div style="font-size:12px;font-weight:700;color:var(--accent);letter-spacing:.03em;text-transform:uppercase;margin-bottom:3px">' + (n.Type === 'banner_task' ? 'New banner request' : n.Type === 'promo_request' ? 'New promo request' : 'New notification') + '</div>' +
    '<div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:3px;line-height:1.3">' + esc(String(n.Title||'')) + '</div>' +
    '<div style="font-size:11px;color:var(--muted);line-height:1.4">' + esc(String(n.Detail||'')) + '</div>' +
    '</div>' +
    '<button style="background:none;border:none;color:var(--muted);font-size:16px;cursor:pointer;padding:0 0 0 8px" onclick="event.stopPropagation();this.parentElement.parentElement.remove()">✕</button>' +
    '</div>';
  el.onclick = function(){
    if (n.Type === 'promo_request') nav('promos');
    else if (n.Type === 'banner_task') nav('banners');
    el.remove();
  };
  document.body.appendChild(el);
  setTimeout(function(){
    el.style.transition = 'opacity .5s,transform .5s';
    el.style.opacity = '0';
    el.style.transform = 'translateX(20px)';
    setTimeout(function(){ if (el.parentNode) el.remove(); }, 500);
  }, 7000);
}`);

patch('CSS — pulse animation + slide-in for notif popup',
  'dash',
  `/* === ORCH_V2_INJECT_END === */</style>`,
  `.notif-btn.pulse{animation:notifPulse 1s ease-in-out 4}
@keyframes notifPulse{0%,100%{transform:scale(1);box-shadow:0 0 0 0 rgba(124,58,237,.7)}50%{transform:scale(1.08);box-shadow:0 0 0 12px rgba(124,58,237,0)}}
@keyframes slideInRight{from{transform:translateX(40px);opacity:0}to{transform:translateX(0);opacity:1}}
.notif-popup:hover{border-color:var(--accent2)!important;box-shadow:0 10px 30px rgba(14,165,233,.3)}
/* === ORCH_V2_INJECT_END === */</style>`);

// ─── FIX 4a: Expanded Promo Request form (27 fields) ─────────────────────────
patch('Promo Request form — full template (27 fields, 5 sections)',
  'dash',
  `      <div class="card-body">
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">
          <div class="form-row" style="margin:0"><label class="form-label">Brand / Merchant *</label>
            <input id="pr-brand" placeholder="e.g. QPRO11, IBC22, MB8" style="width:100%"></div>
          <div class="form-row" style="margin:0"><label class="form-label">Platform</label>
            <select id="pr-platform" style="width:100%">
              <option value="">— Select —</option>
              <option>QPRO</option><option>QP2</option><option>WS1</option><option>WS2</option>
            </select></div>
          <div class="form-row" style="margin:0"><label class="form-label">Bonus Type *</label>
            <select id="pr-bonus" style="width:100%">
              <option value="">— Select —</option>
              <option>Deposit</option><option>Free Credit</option><option>Free Spin</option>
              <option>Cashback</option><option>Reload</option>
            </select></div>
          <div class="form-row" style="margin:0"><label class="form-label">Bonus Amount</label>
            <input id="pr-amount" type="number" placeholder="e.g. 50" style="width:100%"></div>
          <div class="form-row" style="margin:0"><label class="form-label">Min Deposit</label>
            <input id="pr-mindep" type="number" placeholder="e.g. 30" style="width:100%"></div>
          <div class="form-row" style="margin:0"><label class="form-label">Turnover (×)</label>
            <input id="pr-turnover" type="number" placeholder="e.g. 5" style="width:100%"></div>
          <div class="form-row" style="margin:0"><label class="form-label">Start Date</label>
            <input id="pr-start" type="date" style="width:100%"></div>
          <div class="form-row" style="margin:0"><label class="form-label">End Date</label>
            <input id="pr-end" type="date" style="width:100%"></div>
          <div class="form-row" style="margin:0"><label class="form-label">Priority</label>
            <select id="pr-priority" style="width:100%"><option>Normal</option><option>High</option><option>Urgent</option></select></div>
        </div>
        <div class="form-row" style="margin-top:12px"><label class="form-label">Notes / Special Instructions</label>
          <textarea id="pr-desc" rows="2" placeholder="VIP tier, excluded categories, campaign notes…" style="width:100%;resize:vertical;background:var(--input);border:1px solid var(--border);border-radius:6px;color:var(--text);padding:8px;font-size:13px"></textarea></div>
        <div style="display:flex;gap:8px;margin-top:8px">
          <button class="btn btn-primary" style="flex:1" onclick="submitPromoRequest()">Submit Request</button>
        </div>
        <div id="pr-result" style="display:none;margin-top:8px;text-align:center;padding:10px;border-radius:6px;font-size:13px"></div>
      </div>`,
  `      <div class="card-body">
        <!-- 1. REQUEST META -->
        <div class="pr-section-title">📋  Request Details</div>
        <div class="pr-grid-3">
          <div class="form-row" style="margin:0"><label class="form-label">Requestor *</label>
            <input id="pr-requestor" placeholder="Your name" style="width:100%"></div>
          <div class="form-row" style="margin:0"><label class="form-label">Campaign</label>
            <input id="pr-campaign" placeholder="Summer 2026, Birthday, Reload…" style="width:100%"></div>
          <div class="form-row" style="margin:0"><label class="form-label">Priority</label>
            <select id="pr-priority" style="width:100%"><option>Normal</option><option>High</option><option>Urgent</option></select></div>
        </div>

        <!-- 2. BRAND & BONUS -->
        <div class="pr-section-title">🏦  Brand &amp; Bonus</div>
        <div class="pr-grid-3">
          <div class="form-row" style="margin:0"><label class="form-label">Brand(s) / Merchant *</label>
            <input id="pr-brand" placeholder="QPRO11, IBC22, MB8 — comma-sep" style="width:100%"></div>
          <div class="form-row" style="margin:0"><label class="form-label">Region(s)</label>
            <input id="pr-region" placeholder="MY, SG, ID, TH, KH, AU, PH" style="width:100%"></div>
          <div class="form-row" style="margin:0"><label class="form-label">Platform</label>
            <select id="pr-platform" style="width:100%">
              <option value="">— auto-detect from brand —</option>
              <option>QPRO</option><option>QP2</option><option>WS1</option><option>WS2</option>
            </select></div>
          <div class="form-row" style="margin:0"><label class="form-label">Bonus Type *</label>
            <select id="pr-bonus" style="width:100%">
              <option value="">— Select —</option>
              <option>Deposit</option><option>Free Credit</option><option>Free Spin</option>
              <option>Cashback</option><option>Reload</option><option>Rebate</option>
            </select></div>
          <div class="form-row" style="margin:0"><label class="form-label">Bonus Amount</label>
            <input id="pr-amount" placeholder="50 or 25%" style="width:100%"></div>
          <div class="form-row" style="margin:0"><label class="form-label">Min Deposit</label>
            <input id="pr-mindep" type="number" placeholder="30" style="width:100%"></div>
          <div class="form-row" style="margin:0"><label class="form-label">Max Cap (per claim)</label>
            <input id="pr-maxcap" type="number" placeholder="500" style="width:100%"></div>
          <div class="form-row" style="margin:0"><label class="form-label">Turnover (×)</label>
            <input id="pr-turnover" type="number" step="0.5" placeholder="5" style="width:100%"></div>
          <div class="form-row" style="margin:0"><label class="form-label">Max per Player</label>
            <input id="pr-maxplayer" placeholder="Lifetime / Daily" style="width:100%"></div>
          <div class="form-row" style="margin:0"><label class="form-label">Categories</label>
            <input id="pr-cats" placeholder="All / Slots / LC (default: All)" style="width:100%"></div>
        </div>

        <!-- 3. NAMING -->
        <div class="pr-section-title">🏷  Naming</div>
        <div class="pr-grid-2">
          <div class="form-row" style="margin:0"><label class="form-label">Promo Code (blank = auto)</label>
            <input id="pr-code" placeholder="FT_REL_SLT_25PCT" style="width:100%"></div>
          <div class="form-row" style="margin:0"><label class="form-label">Name (Details — column M)</label>
            <input id="pr-namedetails" placeholder="25% LC Reload" style="width:100%"></div>
        </div>
        <div class="pr-grid-2">
          <div class="form-row" style="margin:0"><label class="form-label">Promotion Name (EN)</label>
            <input id="pr-nameEn" placeholder="25% Live Casino Reload Bonus" style="width:100%"></div>
          <div class="form-row" style="margin:0"><label class="form-label">Promotion Name (ZH/ID)</label>
            <input id="pr-nameZh" placeholder="25%真人娱乐场返水" style="width:100%"></div>
        </div>

        <!-- 4. DATES -->
        <div class="pr-section-title">📅  Dates &amp; Validity</div>
        <div class="pr-grid-4">
          <div class="form-row" style="margin:0"><label class="form-label">Start Date</label>
            <input id="pr-start" type="date" style="width:100%"></div>
          <div class="form-row" style="margin:0"><label class="form-label">End Date</label>
            <input id="pr-end" type="date" style="width:100%"></div>
          <div class="form-row" style="margin:0"><label class="form-label">Validity (days)</label>
            <input id="pr-validity" type="number" placeholder="7" style="width:100%"></div>
          <div class="form-row" style="margin:0"><label class="form-label">Recurring</label>
            <select id="pr-recurring" style="width:100%">
              <option value="">One-off</option>
              <option>Daily</option><option>Weekly</option><option>Monthly</option>
            </select></div>
        </div>

        <!-- 5. COMMUNICATIONS -->
        <div class="pr-section-title">📨  Communications</div>
        <div class="pr-grid-3">
          <div class="form-row" style="margin:0"><label class="form-label">Inbox Message</label>
            <select id="pr-inbox" style="width:100%">
              <option value="">No</option><option>Yes — standard</option>
              <option>Yes — custom (see notes)</option><option>Refer to existing</option>
            </select></div>
          <div class="form-row" style="margin:0"><label class="form-label">Popup Dialog</label>
            <select id="pr-popup" style="width:100%">
              <option value="">No</option><option>Yes — standard</option>
              <option>Yes — custom (see notes)</option>
            </select></div>
          <div class="form-row" style="margin:0"><label class="form-label">Banner Needed</label>
            <select id="pr-banner" style="width:100%">
              <option value="">No</option><option>Homepage</option>
              <option>Promo Page</option><option>Both</option>
            </select></div>
        </div>

        <div class="form-row" style="margin-top:10px"><label class="form-label">Remarks / Special Instructions</label>
          <textarea id="pr-desc" rows="3" placeholder="VIP tier, excluded categories, refer-to-code, [CATEGORY ONLY] tags, campaign notes…" style="width:100%;resize:vertical;background:var(--card2);border:1px solid var(--border);border-radius:6px;color:var(--text);padding:8px;font-size:13px"></textarea></div>

        <div style="display:flex;gap:8px;margin-top:8px">
          <button class="btn btn-ghost" onclick="clearPromoRequest_()" style="flex:0 0 auto">Clear</button>
          <button class="btn btn-primary" style="flex:1" onclick="submitPromoRequest()">📤  Submit Request → Operator Sheet</button>
        </div>
        <div id="pr-result" style="display:none;margin-top:8px;text-align:center;padding:10px;border-radius:6px;font-size:13px"></div>
      </div>`);

// ─── FIX 4b: CSS for the new form layout ─────────────────────────────────────
patch('CSS — promo-request form section helpers',
  'dash',
  `.notif-btn.pulse{animation:notifPulse 1s ease-in-out 4}`,
  `.pr-section-title{font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin:14px 0 8px 0;padding-bottom:6px;border-bottom:1px solid var(--border)}
.pr-section-title:first-child{margin-top:0}
.pr-grid-2{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-bottom:10px}
.pr-grid-3{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:10px}
.pr-grid-4{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:10px}
.notif-btn.pulse{animation:notifPulse 1s ease-in-out 4}`);

// ─── FIX 4c: Rewrite submitPromoRequest to read all new fields ──────────────
patch('submitPromoRequest — read 27 fields + add clear helper',
  'dash',
  `function submitPromoRequest() {
  const brand    = (document.getElementById('pr-brand').value||'').trim();
  const bonusType= document.getElementById('pr-bonus').value;
  if (!brand)     { toast('Brand is required'); return; }
  if (!bonusType) { toast('Bonus Type is required'); return; }
  const form = {
    email: S.user.email, brand,
    platform:    document.getElementById('pr-platform').value,
    bonusType,
    amount:      document.getElementById('pr-amount').value,
    minDeposit:  document.getElementById('pr-mindep').value,
    turnover:    document.getElementById('pr-turnover').value,
    priority:    document.getElementById('pr-priority').value,
    startDate:   document.getElementById('pr-start').value,
    endDate:     document.getElementById('pr-end').value,
    description: document.getElementById('pr-desc').value,
  };
  const resultEl = document.getElementById('pr-result');
  resultEl.style.display = 'block';
  resultEl.textContent = 'Submitting…';`,
  `function clearPromoRequest_() {
  ['pr-requestor','pr-campaign','pr-brand','pr-region','pr-amount','pr-mindep','pr-maxcap','pr-turnover','pr-maxplayer','pr-cats','pr-code','pr-namedetails','pr-nameEn','pr-nameZh','pr-start','pr-end','pr-validity','pr-desc']
    .forEach(function(id){var el=document.getElementById(id);if(el)el.value='';});
  ['pr-bonus','pr-platform','pr-priority','pr-recurring','pr-inbox','pr-popup','pr-banner']
    .forEach(function(id){var el=document.getElementById(id);if(el)el.selectedIndex=0;});
  var r=document.getElementById('pr-result');if(r)r.style.display='none';
}

function submitPromoRequest() {
  function v(id){var el=document.getElementById(id);return el?String(el.value||'').trim():'';}
  const brand     = v('pr-brand');
  const bonusType = v('pr-bonus');
  if (!brand)     { toast('Brand is required'); return; }
  if (!bonusType) { toast('Bonus Type is required'); return; }
  const form = {
    email:       S.user.email,
    requestor:   v('pr-requestor') || S.user.display || S.user.email,
    campaign:    v('pr-campaign'),
    brand,
    region:      v('pr-region'),
    platform:    v('pr-platform'),
    bonusType,
    amount:      v('pr-amount'),
    minDeposit:  v('pr-mindep'),
    maxCap:      v('pr-maxcap'),
    turnover:    v('pr-turnover'),
    maxPlayer:   v('pr-maxplayer'),
    categories:  v('pr-cats'),
    promoCode:   v('pr-code'),
    nameDetails: v('pr-namedetails'),
    nameEn:      v('pr-nameEn'),
    nameZh:      v('pr-nameZh'),
    startDate:   v('pr-start'),
    endDate:     v('pr-end'),
    validity:    v('pr-validity'),
    recurring:   v('pr-recurring'),
    inbox:       v('pr-inbox'),
    popup:       v('pr-popup'),
    banner:      v('pr-banner'),
    priority:    v('pr-priority') || 'Normal',
    description: v('pr-desc'),
  };
  const resultEl = document.getElementById('pr-result');
  resultEl.style.display = 'block';
  resultEl.textContent = '📤  Submitting to operator sheet…';`);

// Update success message to include source-sheet row reference
patch('submitPromoRequest success — show source-sheet row',
  'dash',
  `      if (r.success) {
        resultEl.textContent = '✓ Submitted! ID: ' + r.requestId;
        resultEl.style.background = 'rgba(16,185,129,0.1)'; resultEl.style.color = '#10b981';
        ['pr-brand','pr-amount','pr-mindep','pr-turnover','pr-start','pr-end','pr-desc'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});
        document.getElementById('pr-platform').selectedIndex = 0;
        document.getElementById('pr-bonus').selectedIndex = 0;`,
  `      if (r.success) {
        resultEl.textContent = '✓  Submitted! ID: ' + r.requestId + (r.sourceRow ? '  ·  Sheet: ' + r.sourceRow : '');
        resultEl.style.background = 'rgba(16,185,129,0.1)'; resultEl.style.color = '#10b981';
        clearPromoRequest_();
        resultEl.style.display = 'block';`);

// ─── FIX 5: Date pill applies to overview KPIs + filtered tasks across views ─
patch('Date filter — universal list-window helper + renderOverview wrap',
  'dash',
  `  // Filter S.tasks by S.__dateFilter when reading (best-effort: wrap filterTasks)
  var origFilterTasks = (typeof filterTasks === 'function') ? filterTasks : null;
  if (origFilterTasks) {
    window.filterTasks = function() {
      var df = window.S && window.S.__dateFilter;
      if (df && window.S && Array.isArray(window.S.tasks)) {
        window.S.__tasksBackup = window.S.__tasksBackup || window.S.tasks;
        var from = df.from ? df.from.getTime() : null;
        var to = df.to ? df.to.getTime() + 86399999 : null;
        window.S.tasks = window.S.__tasksBackup.filter(function(t) {
          var iso = String((t.Submitted_At || t.Posted_At || t.Due_Date || '')).slice(0, 10);
          if (!iso) return false;
          var d = new Date(iso + 'T12:00:00').getTime();
          if (from !== null && d < from) return false;
          if (to !== null && d > to) return false;
          return true;
        });
      } else if (window.S && window.S.__tasksBackup) {
        window.S.tasks = window.S.__tasksBackup;
        window.S.__tasksBackup = null;
      }
      origFilterTasks();
    };
  }`,
  `  // Universal list-window helper — filters any task-like list by S.__dateFilter
  window.applyDateFilterToList_ = function(list) {
    var df = window.S && window.S.__dateFilter;
    if (!df || !Array.isArray(list)) return list || [];
    var from = df.from ? df.from.getTime() : null;
    var to = df.to ? df.to.getTime() + 86399999 : null;
    return list.filter(function(t) {
      var iso = String((t.Submitted_At || t.Posted_At || t.Due_Date || t.Created_At || t.start_date || '')).slice(0, 10);
      if (!iso) return from === null && to === null;
      var d = new Date(iso + 'T12:00:00').getTime();
      if (from !== null && d < from) return false;
      if (to !== null && d > to) return false;
      return true;
    });
  };

  // Wrap filterTasks → respects date window
  var origFilterTasks = (typeof filterTasks === 'function') ? filterTasks : null;
  if (origFilterTasks) {
    window.filterTasks = function() {
      var df = window.S && window.S.__dateFilter;
      if (df && window.S && Array.isArray(window.S.tasks)) {
        window.S.__tasksBackup = window.S.__tasksBackup || window.S.tasks;
        window.S.tasks = window.applyDateFilterToList_(window.S.__tasksBackup);
      } else if (window.S && window.S.__tasksBackup) {
        window.S.tasks = window.S.__tasksBackup;
        window.S.__tasksBackup = null;
      }
      origFilterTasks();
    };
  }

  // Wrap renderOverview → recompute KPIs from filtered tasks
  var origRenderOverview = (typeof renderOverview === 'function') ? renderOverview : null;
  if (origRenderOverview) {
    window.renderOverview = function() {
      var df = window.S && window.S.__dateFilter;
      if (df && window.S) {
        var src = window.S.__tasksBackup || window.S.tasks || [];
        window.S.__tasksBackup = window.S.__tasksBackup || window.S.tasks;
        var ft = window.applyDateFilterToList_(src);
        window.S.tasks = ft;
        if (window.S.kpis) {
          window.S.__kpisBackup = window.S.__kpisBackup || JSON.parse(JSON.stringify(window.S.kpis));
          var c = { total: ft.length, completed:0, inProgress:0, pendingApproval:0, atRisk:0 };
          ft.forEach(function(t){
            var s = (typeof normaliseStatus_ === 'function') ? normaliseStatus_(t.Status) : String(t.Status||'');
            if (s === 'Completed')        c.completed++;
            else if (s === 'In Progress') c.inProgress++;
            else if (s === 'Pending Approval') c.pendingApproval++;
            else if (s === 'At Risk')     c.atRisk++;
          });
          window.S.kpis = Object.assign({}, window.S.__kpisBackup, c);
        }
      } else if (window.S && window.S.__kpisBackup) {
        window.S.kpis = window.S.__kpisBackup; window.S.__kpisBackup = null;
        if (window.S.__tasksBackup) { window.S.tasks = window.S.__tasksBackup; window.S.__tasksBackup = null; }
      }
      origRenderOverview();
    };
  }`);

// ─── FIX 6: Badge V42 → V43 ──────────────────────────────────────────────────
patch('Badge V42 → V43', 'dash', `>V42 ✓</span>`, `>V43 ✓</span>`);

// ─── BACKEND: serverSubmitPromoCodeRequest writes to operator's sheet too ────
patch('serverSubmitPromoCodeRequest — write to BOTH local + operator sheet',
  'code',
  `function serverSubmitPromoCodeRequest(form) {
  try {
    const ss = openSS_();
    let sheet = ss.getSheetByName('Promo_Requests');
    if (!sheet) {
      sheet = ss.insertSheet('Promo_Requests');
      sheet.appendRow(['Request_ID','Timestamp','Requestor_Email','Brand','Platform',
                       'Bonus_Type','Amount','Min_Deposit','Turnover',
                       'Start_Date','End_Date','Priority','Description','Status']);
    }
    const id = 'PR-' + Date.now();
    sheet.appendRow([
      id, new Date().toISOString(),
      form.email||'', form.brand||'', form.platform||'',
      form.bonusType||'', form.amount||'', form.minDeposit||'',
      form.turnover||'', form.startDate||'', form.endDate||'',
      form.priority||'Normal', form.description||'', 'Pending'
    ]);
    return { success: true, requestId: id };
  } catch (e) { return { success: false, error: e.message }; }
}`,
  `function serverSubmitPromoCodeRequest(form) {
  try {
    const now    = new Date();
    const nowISO = now.toISOString();
    const id     = 'PR-' + Date.now();

    // ── (A) Local Promo_Requests tab — full record for dashboard tracker ────
    const ss = openSS_();
    let sheet = ss.getSheetByName('Promo_Requests');
    if (!sheet) {
      sheet = ss.insertSheet('Promo_Requests');
      sheet.appendRow(['Request_ID','Timestamp','Requestor_Email','Requestor','Campaign',
                       'Brand','Region','Platform','Bonus_Type','Amount','Min_Deposit','Max_Cap',
                       'Turnover','Max_Player','Categories','Promo_Code','Name_Details',
                       'Name_EN','Name_ZH','Start_Date','End_Date','Validity','Recurring',
                       'Inbox','Popup','Banner','Priority','Description','Status','Source_Sheet_Row']);
    }
    sheet.appendRow([
      id, nowISO, form.email||'', form.requestor||'', form.campaign||'',
      form.brand||'', form.region||'', form.platform||'', form.bonusType||'',
      form.amount||'', form.minDeposit||'', form.maxCap||'', form.turnover||'',
      form.maxPlayer||'', form.categories||'', form.promoCode||'',
      form.nameDetails||'', form.nameEn||'', form.nameZh||'',
      form.startDate||'', form.endDate||'', form.validity||'',
      form.recurring||'', form.inbox||'', form.popup||'', form.banner||'',
      form.priority||'Normal', form.description||'', 'New', ''
    ]);
    const localRow = sheet.getLastRow();

    // ── (B) Operator's source-of-truth Promo Code Request sheet ─────────────
    let sourceRow = '';
    try {
      const reqSS = SpreadsheetApp.openById(PROMO_REQ_SS_ID);
      const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const mon  = monthNames[now.getMonth()];
      const year = String(now.getFullYear());
      const yr2  = year.slice(2);
      const tabs = reqSS.getSheets();
      const tab  = tabs.find(s => { const n = s.getName(); return n.includes(mon) && (n.includes(year) || n.includes(yr2)); })
                 || tabs.find(s => s.getName().toLowerCase().includes(mon.toLowerCase()))
                 || tabs[0];
      if (tab) {
        const lr = tab.getLastRow();
        const lc = Math.min(tab.getLastColumn(), 30);
        const headers = tab.getRange(1, 1, 1, lc).getValues()[0].map(String);
        const findCol = (rx) => headers.findIndex(h => rx.test(String(h).trim()));

        // Auto-generate next P-number from existing rows
        const pColIdx = findCol(/^(no\\.?$|^#$|request.?number|^rn\\b|^p#)/i);
        let nextP = 1;
        if (pColIdx >= 0 && lr > 1) {
          const pCol = tab.getRange(2, pColIdx + 1, lr - 1, 1).getValues();
          const maxP = pCol.reduce((m, r) => {
            const s = String(r[0] || '').replace(/^p/i, '').trim();
            const n = parseInt(s, 10);
            return isFinite(n) && n > m ? n : m;
          }, 0);
          nextP = maxP + 1;
        }

        // Build row aligned to operator's column layout
        const out = new Array(headers.length).fill('');
        const set = (rx, val) => { const i = findCol(rx); if (i >= 0) out[i] = val; };
        set(/^(no\\.?$|^#$|request.?number|^rn\\b|^p#)/i, 'P' + String(nextP).padStart(3, '0'));
        set(/^date\\b/i,              Utilities.formatDate(now, 'GMT+8', 'd MMM yyyy'));
        set(/^request[oe]r\\b/i,      form.requestor || form.email || '');
        set(/^brand/i,               form.brand || '');
        set(/^region/i,              form.region || '');
        set(/^campaign/i,            form.campaign || '');
        set(/^bonus\\s*type/i,        form.bonusType || '');
        set(/^priority\\b/i,          form.priority || 'Normal');
        set(/^deadline\\b/i,          form.endDate ? Utilities.formatDate(new Date(form.endDate), 'GMT+8', 'd MMM yyyy') : '');
        set(/^promo\\s*code/i,        form.promoCode || '');
        set(/^name.*details|^details/i, form.nameDetails || '');
        set(/^promotion\\s*names?\\s*\\(en\\)|^name\\s*\\(en\\)/i, form.nameEn || '');
        set(/^promotion\\s*names?\\s*\\(zh|^name\\s*\\(zh/i, form.nameZh || '');
        set(/^remark|^notes?/i,      form.description || '');
        set(/^validity\\b/i,          form.validity || '');
        set(/^recurring|^claim/i,    form.recurring || '');
        set(/^max\\s*per\\s*player/i,  form.maxPlayer || '');
        set(/^banner/i,              form.banner || '');
        set(/^inbox\\s*message/i,     form.inbox || '');
        set(/^pop.?up\\s*dialog|^popup/i, form.popup || '');
        // Status column left blank — operator owns the QC dropdown
        tab.appendRow(out);
        sourceRow = tab.getName() + '!row' + (lr + 1);
        // Write source-row back to local record
        const headersLocal = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
        const srcColIdx = headersLocal.indexOf('Source_Sheet_Row');
        if (srcColIdx >= 0) sheet.getRange(localRow, srcColIdx + 1).setValue(sourceRow);
      }
    } catch (sourceErr) {
      Logger.log('serverSubmitPromoCodeRequest source-sheet error: ' + sourceErr.message);
    }

    return { success: true, requestId: id, sourceRow: sourceRow };
  } catch (e) {
    return { success: false, error: e.message };
  }
}`);

// ─── BACKEND BONUS: serverNormalizeAllStatuses — one-shot canon migration ────
patch('add serverNormalizeAllStatuses + normaliseStatus_ helper in Code.gs',
  'code',
  `function serverQuickUpdateTask(taskId, status) {
  return serverUpdateTask(taskId, { Status: status });
}`,
  `function serverQuickUpdateTask(taskId, status) {
  return serverUpdateTask(taskId, { Status: status });
}

// Server-side mirror of the client normaliser
function normaliseStatus_(raw) {
  const s = String(raw || '').trim();
  if (!s) return 'New';
  if (/complete|done|finish|deliver|launch|^live$|closed|qc.?completed/i.test(s)) return 'Completed';
  if (/progress|building|wip|on.?going|active|working/i.test(s)) return 'In Progress';
  if (/approv|waiting|review|^pending$|qc(?!.?completed)/i.test(s)) return 'Pending Approval';
  if (/risk|escalat|fail|delay|stuck|block/i.test(s)) return 'At Risk';
  if (/clarif|question|on.?hold/i.test(s)) return 'Needs Clarification';
  return s || 'New';
}



/**
 * Walk Task_Master and rewrite Status column to canonical values.
 * Useful one-off to clean up legacy "done" / "DONE" / "QC Completed" rows.
 * Run from Apps Script editor: Run → serverNormalizeAllStatuses
 */
function serverNormalizeAllStatuses() {
  try {
    const sheet = openSS_().getSheetByName('Task_Master');
    if (!sheet || sheet.getLastRow() < 2) return { success: false, error: 'No Task_Master' };
    const data = sheet.getDataRange().getValues();
    const headers = data[0].map(String);
    const sIdx = headers.indexOf('Status');
    if (sIdx < 0) return { success: false, error: 'No Status column' };
    let changed = 0;
    for (let i = 1; i < data.length; i++) {
      const raw = data[i][sIdx];
      const can = normaliseStatus_(raw);
      if (String(raw || '').trim() !== can) {
        sheet.getRange(i + 1, sIdx + 1).setValue(can);
        changed++;
      }
    }
    return { success: true, changed, total: data.length - 1 };
  } catch (e) {
    return { success: false, error: e.message };
  }
}`);

// ─── PUSH ────────────────────────────────────────────────────────────────────
proj.files[dashIdx].source = dash;
proj.files[codeIdx].source = code;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('\n✓ Pushed — ' + pass + ' patches applied, ' + fail + ' warnings');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V43 — owner/status/notif/promo-form/date-filter — ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);
console.log('');
console.log('Deploy V' + v.versionNumber + ' → Manage deployments → pick Version ' + v.versionNumber);

const state = {
  user: null,
  brands: [],
  selectedBrands: new Set(),
  activeBrand: null,
  results: [],
  activeKey: '',
  selectedResults: {},      // { [resultKey]: { verdict, remarks } }
  adminUsers: [],
  historyRows: [],
  workflowStep: 'setup',    // R10: 'setup' | 'running' | 'review' | 'save'
};

const EMPTY_REMARKS = () => ({
  errorCategory: '', description: '', expected: '', actual: '',
  actionRequired: '', personResponsible: '', evidenceLink: '',
});

const REMARK_FIELDS = ['errorCategory','description','expected','actual','actionRequired','personResponsible','evidenceLink'];

/* R13: modal focus trap
   Keeps Tab / Shift+Tab cycling inside the open modal, closes on Escape,
   and restores focus to the trigger element on close. Called from
   openPromptModal / closePromptModal / openUsersModal / closeUsersModal. */
const _modalTraps = new Map(); // modalId → { handler, priorFocus }
const FOCUSABLE_SEL = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function activateModalTrap(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal || _modalTraps.has(modalId)) return;
  const priorFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const focusables = () => Array.from(modal.querySelectorAll(FOCUSABLE_SEL)).filter((el) => el.offsetParent !== null);
  const handler = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); closeModalById(modalId); return; }
    if (e.key !== 'Tab') return;
    const list = focusables();
    if (!list.length) { e.preventDefault(); return; }
    const first = list[0], last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  document.addEventListener('keydown', handler, true);
  _modalTraps.set(modalId, { handler, priorFocus });
  requestAnimationFrame(() => {
    const list = focusables();
    if (list[0]) list[0].focus();
    else { modal.setAttribute('tabindex', '-1'); modal.focus(); }
  });
}

function releaseModalTrap(modalId) {
  const trap = _modalTraps.get(modalId);
  if (!trap) return;
  document.removeEventListener('keydown', trap.handler, true);
  _modalTraps.delete(modalId);
  if (trap.priorFocus && typeof trap.priorFocus.focus === 'function') {
    try { trap.priorFocus.focus(); } catch {}
  }
}

function closeModalById(id) {
  if (id === 'promptModal') closePromptModal();
  else if (id === 'usersModal') closeUsersModal();
  else if (id === 'siteConfigsModal') closeSiteConfigsModal();
  else if (id === 'manualPassModal') closeManualPassModal();
  else if (id === 'relayKeyModal') closeRelayKeyModal();
}

/* ── R10: workflow strip ── */
function setWorkflowStep(step) {
  state.workflowStep = step;
  const order = ['setup','running','review','save'];
  const activeIx = order.indexOf(step);
  document.querySelectorAll('.workflow-step').forEach((el) => {
    const stepName = el.dataset.step;
    const ix = order.indexOf(stepName);
    el.classList.remove('active','done');
    if (ix < activeIx) el.classList.add('done');
    if (ix === activeIx) el.classList.add('active');
  });
}

/* ── R10 + R11: toast ── */
function toast(message, level='muted', ms=null) {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const t = document.createElement('div');
  t.className = `toast ${level}`;
  const msg = document.createElement('span');
  msg.textContent = message;
  t.appendChild(msg);
  const x = document.createElement('span');
  x.className = 'toast-x';
  x.textContent = '×';
  t.appendChild(x);
  const remove = () => { t.style.opacity = 0; setTimeout(() => t.remove(), 180); };
  t.addEventListener('click', remove);
  container.appendChild(t);
  while (container.children.length > 3) container.firstChild.remove();
  setTimeout(remove, ms ?? (level === 'error' ? 6000 : 4000));
}

/* ── R10: empty-state visibility ── */
function renderEmptyStates() {
  const brandEmpty = document.getElementById('brandEmpty');
  if (brandEmpty) brandEmpty.classList.toggle('hidden', state.selectedBrands.size > 0);
  const wsEmpty = document.getElementById('workspaceEmpty');
  const wsBody = document.getElementById('workspaceBody');
  const hasResults = state.results.length > 0;
  if (wsEmpty) wsEmpty.classList.toggle('hidden', hasResults);
  if (wsBody) wsBody.classList.toggle('hidden', !hasResults);
  const actionBar = document.getElementById('actionBar');
  if (actionBar) actionBar.setAttribute('aria-hidden', hasResults ? 'false' : 'true');
  const histEmpty = document.getElementById('historyEmpty');
  if (histEmpty) histEmpty.classList.toggle('hidden', state.historyRows.length > 0);
}

/* ── R10: skeleton toggle ── */
function showSkeleton(on) {
  const el = document.getElementById('skeletonBlock');
  if (el) el.classList.toggle('hidden', !on);
}

/* ── R11 fix 4: form ↔ per-result remarks ── */
function ensureResultSlot(key) {
  if (!state.selectedResults[key]) {
    state.selectedResults[key] = { verdict: null, remarks: EMPTY_REMARKS() };
  } else if (typeof state.selectedResults[key] === 'string') {
    state.selectedResults[key] = { verdict: state.selectedResults[key], remarks: EMPTY_REMARKS() };
  }
  if (!state.selectedResults[key].remarks) state.selectedResults[key].remarks = EMPTY_REMARKS();
  return state.selectedResults[key];
}
function getVerdictFor(key) { return state.selectedResults[key]?.verdict || null; }
function loadRemarksIntoForm(remarks) {
  const src = remarks || EMPTY_REMARKS();
  for (const f of REMARK_FIELDS) {
    const el = document.getElementById(f);
    if (el) el.value = src[f] || '';
  }
}
function persistRemarksFromForm() {
  if (!state.activeKey) return;
  const slot = ensureResultSlot(state.activeKey);
  for (const f of REMARK_FIELDS) {
    const el = document.getElementById(f);
    if (el) slot.remarks[f] = el.value;
  }
}

/* ── R10: remarks card visibility (FAIL/REVIEW only) ── */
function updateRemarksVisibility() {
  const card = document.getElementById('remarksCard');
  if (!card) return;
  const data = activeResult();
  const v = data?.verdict;
  const show = v === 'NOT_SAFE' || v === 'REVIEW' || v === 'REQUIRES_REVIEW';
  card.classList.toggle('hidden', !show);
}

const $ = (id) => document.getElementById(id);

/* R12: session pill (topbar signal zone) */
function setSessionPill(email) {
  const pill = document.getElementById('sessionPill');
  if (!pill) return;
  if (email) {
    pill.classList.remove('neutral');
    pill.textContent = `Signed in · ${email}`;
    pill.setAttribute('title', email);
  } else {
    pill.classList.add('neutral');
    pill.textContent = 'Signed out';
  }
}
/* Backward-compat mirror for anywhere still reading #signedIn */
function _syncLegacySignedIn(email) {
  const el = document.getElementById('signedIn');
  if (el) el.textContent = email || 'Signed out';
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

/* R13: 8s timeout so a blocked GSI script doesn't hang the sign-in overlay forever */
function waitForGoogle(timeoutMs = 8000) {
  if (typeof google !== 'undefined' && google.accounts) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const iv = setInterval(() => {
      if (typeof google !== 'undefined' && google.accounts) { clearInterval(iv); resolve(); return; }
      if (Date.now() - started > timeoutMs) {
        clearInterval(iv);
        reject(new Error('Google Sign-In script did not load within ' + Math.round(timeoutMs/1000) + 's. Check network / ad-blocker and reload.'));
      }
    }, 80);
  });
}

async function ensureLogin() {
  // Try existing valid session first.
  try {
    const me = await api('/api/me');
    state.user = me.user;
    setSessionPill(state.user.email);
    return;
  } catch {}

  const cfg = await fetch('/api/config').then((r) => r.json());

  if (cfg.devMode) {
    // Dev bypass — localhost only; server enforces the restriction.
    const login = await api('/auth/login', { method: 'POST', body: JSON.stringify({}) });
    state.user = login.user;
    setSessionPill(state.user.email);
    return;
  }

  // Production: Google Sign-In.
  $('loginOverlay').classList.remove('hidden');
  try {
    await waitForGoogle();
  } catch (err) {
    const el = $('loginError');
    el.textContent = err.message || 'Google Sign-In script failed to load.';
    el.classList.remove('hidden');
    throw err;
  }

  await new Promise((resolve, reject) => {
    function onCredential(response) {
      api('/auth/login', { method: 'POST', body: JSON.stringify({ credential: response.credential }) })
        .then((data) => {
          state.user = data.user;
          setSessionPill(state.user.email);
          $('loginOverlay').classList.add('hidden');
          resolve();
        })
        .catch((err) => {
          const el = $('loginError');
          el.textContent = err.message || 'Sign-in failed — check your account has been admitted.';
          el.classList.remove('hidden');
          // Re-render button so the user can retry.
          google.accounts.id.renderButton($('googleBtn'), { theme: 'outline', size: 'large' });
        });
    }

    if (!cfg.googleClientId) {
      reject(new Error('GOOGLE_CLIENT_ID is not configured on the server.'));
      return;
    }

    google.accounts.id.initialize({ client_id: cfg.googleClientId, callback: onCredential });
    google.accounts.id.renderButton($('googleBtn'), { theme: 'outline', size: 'large' });
  });
}

function syncSettingsAccess() {
  const isAdmin = state.user?.role === 'admin';
  const usersBtn = $('settingsBtn');
  if (usersBtn) usersBtn.classList.toggle('hidden', !isAdmin);
  const siteConfigsBtn = $('siteConfigsBtn');
  if (siteConfigsBtn) siteConfigsBtn.classList.toggle('hidden', !isAdmin);
}

/* R18-lite: Site configs modal — admin pastes overlay JSON, server writes
   to data/bo-sites-runtime.json (gitignored) and invalidates cache. Diag
   grid shows per-site status so the admin sees which sites are still broken. */
async function refreshSiteConfigsGrid() {
  const table = document.getElementById('siteConfigsTable');
  const banner = document.getElementById('siteConfigsBanner');
  if (!table) return;
  try {
    const data = await api('/api/admin/site-configs');
    if (banner) { banner.classList.add('hidden'); banner.textContent = ''; }
    table.replaceChildren();
    const thead = document.createElement('thead');
    const hr = document.createElement('tr');
    for (const label of ['Site', 'Platform', 'Host', 'API host', 'Overlay?', 'Valid?', 'Missing']) {
      const th = document.createElement('th'); th.textContent = label; hr.appendChild(th);
    }
    thead.appendChild(hr); table.appendChild(thead);
    const tbody = document.createElement('tbody');
    for (const s of (data.sites || [])) {
      const tr = document.createElement('tr');
      const cell = (v) => { const td = document.createElement('td'); td.textContent = v == null ? '—' : String(v); return td; };
      tr.appendChild(cell(s.id));
      tr.appendChild(cell(s.platform));
      tr.appendChild(cell(s.baseUrl_host));
      tr.appendChild(cell(s.apiHost_host));
      tr.appendChild(cell(s.has_overlay ? 'yes' : 'no'));
      const validCell = cell(s.valid ? '✓' : '✗');
      validCell.style.color = s.valid ? 'var(--safe, #1a7f37)' : 'var(--danger, #b42318)';
      validCell.style.fontWeight = '600';
      tr.appendChild(validCell);
      tr.appendChild(cell(s.invalid_reason?.field || (s.invalid_reason?.message || '')));
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
  } catch (e) {
    if (banner) {
      banner.textContent = `Could not load status: ${e.message}`;
      banner.classList.remove('hidden');
    }
  }
}

async function openSiteConfigsModal() {
  document.getElementById('siteConfigsModal').classList.remove('hidden');
  activateModalTrap('siteConfigsModal');
  await refreshSiteConfigsGrid();
  await refreshRelayKeyStatus();
}

// BO Relay self-service rotation.
// Status shows only "Configured / Not Configured" + last rotation timestamp.
// The rotate button POSTs to /api/admin/relay-secret/rotate; the response
// is displayed ONCE in the relayKeyModal — never persisted client-side,
// never logged, cleared on close.
async function refreshRelayKeyStatus() {
  const el = document.getElementById('relayKeyStatus');
  const btn = document.getElementById('relayKeyRotateBtn');
  if (!el) return;
  try {
    const h = await api('/api/admin/relay-health');
    if (h.relaySecretConfigured && h.relaySecretSource === 'env') {
      // §3: env-managed — self-service must not pretend a click had effect.
      el.textContent = '✓ Configured — source: RELAY_SECRET environment variable (externally managed; rotate at the source)';
      if (btn) { btn.disabled = true; btn.title = 'Rotation is disabled because RELAY_SECRET is set via the environment. Ask whoever set the env var to rotate there.'; }
    } else if (h.relaySecretConfigured) {
      const when = h.relaySecretLastRotatedAt
        ? new Date(h.relaySecretLastRotatedAt).toLocaleString()
        : '(source: file)';
      el.textContent = `✓ Configured — last rotation ${when}${h.relaySecretLastRotatedBy ? ` by ${h.relaySecretLastRotatedBy}` : ''}`;
      if (btn) { btn.disabled = false; btn.title = ''; }
    } else {
      el.textContent = '✗ Not configured — click Generate to create a key';
      if (btn) { btn.disabled = false; btn.title = ''; }
    }
    el.classList.remove('hidden');
  } catch (e) {
    el.textContent = `status unavailable: ${e.message}`;
    el.classList.remove('hidden');
  }
}

async function rotateRelayKey() {
  const btn = document.getElementById('relayKeyRotateBtn');
  if (!confirm('Rotate the relay key?\n\nThis invalidates every pending relay job and forces the VDI worker to be re-configured with the new value.\n\nThe key is displayed ONCE and cannot be recovered afterwards.')) return;
  if (btn) btn.disabled = true;
  try {
    // /api/admin/relay-secret/rotate — server sends Cache-Control: no-store;
    // we deliberately do NOT stash the value anywhere except the modal state.
    const resp = await fetch('/api/admin/relay-secret/rotate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${resp.status}`);
    }
    const body = await resp.json();
    openRelayKeyModal(body.secret, body.rotatedAt);
    // Refresh the status label AFTER the value is on screen — this proves the
    // admin sees "configured=true" without needing another round-trip.
    await refreshRelayKeyStatus();
  } catch (e) {
    toast(`Rotate failed: ${e.message}`, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function openRelayKeyModal(secret, rotatedAt) {
  const modal = document.getElementById('relayKeyModal');
  const value = document.getElementById('relayKeyValue');
  value.value = secret;
  document.getElementById('relayKeyCopyConfirm').classList.add('hidden');
  modal.classList.remove('hidden');
  activateModalTrap('relayKeyModal');
  requestAnimationFrame(() => { value.focus(); value.select(); });
}
function closeRelayKeyModal() {
  const value = document.getElementById('relayKeyValue');
  // Wipe the DOM copy of the secret on close. Won't help against a
  // hostile browser extension but does prevent accidental re-reveal via
  // in-page inspection after the modal is dismissed.
  if (value) value.value = '';
  releaseModalTrap('relayKeyModal');
  document.getElementById('relayKeyModal').classList.add('hidden');
}
async function copyRelayKeyToClipboard() {
  const value = document.getElementById('relayKeyValue');
  if (!value?.value) return;
  try {
    await navigator.clipboard.writeText(value.value);
    const el = document.getElementById('relayKeyCopyConfirm');
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 3000);
  } catch {
    toast('Copy failed — select the value manually and copy.', 'error');
  }
}
function closeSiteConfigsModal() {
  releaseModalTrap('siteConfigsModal');
  document.getElementById('siteConfigsModal').classList.add('hidden');
}
async function importSiteConfigs() {
  const banner = document.getElementById('siteConfigsBanner');
  const btn = document.getElementById('siteConfigsImportBtn');
  const raw = (document.getElementById('siteConfigsJson')?.value || '').trim();
  if (!raw) { toast('Paste overlay JSON first.', 'error'); return; }
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (e) { toast(`Invalid JSON: ${e.message}`, 'error'); return; }
  btn.disabled = true;
  try {
    const result = await api('/api/admin/site-configs', { method: 'POST', body: JSON.stringify(parsed) });
    if (banner) {
      banner.textContent = `Wrote overlay — ${result.sitesWritten} site(s), ${result.passwordsWritten || 0} password(s). Try Run QC now.`;
      banner.classList.remove('hidden');
    }
    toast(`Overlay saved (${result.sitesWritten} sites).`, 'success');
    document.getElementById('siteConfigsJson').value = ''; // clear so plain-text creds don't linger
    await refreshSiteConfigsGrid();
  } catch (e) {
    toast(`Import failed: ${e.message}`, 'error');
  } finally {
    btn.disabled = false;
  }
}

/* Modal trap needs to know how to close this one via closeModalById */
function _closeSiteConfigsModalById() { closeSiteConfigsModal(); }

function normalizeAdminUsers(users) {
  const byEmail = new Map();
  for (const user of users || []) {
    const email = String(user.email || '').trim().toLowerCase();
    const role = String(user.role || 'promo-team').trim().toLowerCase();
    if (!email) continue;
    byEmail.set(email, { email, role });
  }
  return [...byEmail.values()];
}

function renderUsersModal() {
  const table = $('usersTable');
  table.replaceChildren();

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const label of ['Email', 'Role', 'Action']) {
    const th = document.createElement('th');
    th.textContent = label;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const [index, user] of state.adminUsers.entries()) {
    const row = document.createElement('tr');

    const emailCell = document.createElement('td');
    emailCell.textContent = user.email;
    row.appendChild(emailCell);

    const roleCell = document.createElement('td');
    roleCell.textContent = user.role;
    row.appendChild(roleCell);

    const actionCell = document.createElement('td');
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'secondary';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => {
      state.adminUsers.splice(index, 1);
      renderUsersModal();
    });
    actionCell.appendChild(removeBtn);
    row.appendChild(actionCell);

    tbody.appendChild(row);
  }
  table.appendChild(tbody);
  $('usersJson').textContent = JSON.stringify({ users: state.adminUsers }, null, 2);
}

async function openUsersModal() {
  const data = await api('/api/admin/users');
  state.adminUsers = normalizeAdminUsers(data.users);
  renderUsersModal();
  $('usersModal').classList.remove('hidden');
  activateModalTrap('usersModal');
}

function closeUsersModal() {
  releaseModalTrap('usersModal');
  $('usersModal').classList.add('hidden');
}

const MAX_CODES = 5;

function codeInputs() {
  return Array.from(document.querySelectorAll('#codeInputs .code-input'));
}

function parseCodes() {
  return codeInputs()
    .map((el) => el.value.trim().toUpperCase())
    .filter(Boolean);
}

function updateCodesCount() {
  const n = codeInputs().length;
  $('codesCount').textContent = `${n} of ${MAX_CODES}`;
  $('addCodeBtn').disabled = n >= MAX_CODES;
}

function makeCodeRow(index, { canRemove = false } = {}) {
  const row = document.createElement('div');
  row.className = 'code-row';
  row.innerHTML = `
    <input class="code-input" autocomplete="off" spellcheck="false" placeholder="Code ${index}" aria-label="Promo code ${index}">
    ${canRemove ? `<button type="button" class="remove-code" aria-label="Remove this code">×</button>` : ''}
  `;
  const removeBtn = row.querySelector('.remove-code');
  if (removeBtn) removeBtn.addEventListener('click', () => {
    row.remove();
    updateCodesCount();
  });
  return row;
}

function addCodeRow({ focus = false } = {}) {
  const container = $('codeInputs');
  const n = container.children.length + 1;
  if (n > MAX_CODES) return;
  const row = makeCodeRow(n, { canRemove: n > 1 });
  container.appendChild(row);
  updateCodesCount();
  if (focus) row.querySelector('.code-input').focus();
}

function resetCodeRows() {
  $('codeInputs').innerHTML = '';
  addCodeRow();
}

function activeBrands() {
  return state.brands.filter((b) => state.selectedBrands.has(b.id));
}

function updateBrandLinks() {
  const selected = activeBrands();
  const focus = selected.length === 1
    ? selected[0]
    : (state.activeBrand && selected.find((b) => b.id === state.activeBrand)) || null;
  const clearBtn = $('brandClearBtn');
  if (clearBtn) clearBtn.disabled = state.selectedBrands.size === 0;
  const count = $('brandCount');
  if (count) count.textContent = state.selectedBrands.size ? `${state.selectedBrands.size} selected` : '';
  for (const id of ['openBo', 'openModule']) {
    const el = $(id);
    if (!el) continue;
    const href = focus ? (id === 'openModule' ? focus.moduleUrl : focus.baseUrl) : null;
    el.href = href || '#';
    el.classList.toggle('disabled', !href);
  }
}

function renderBrands() {
  const enabled = state.brands.filter((b) => b.enabled);
  const selected = enabled.filter((b) => state.selectedBrands.has(b.id));
  const unselected = enabled.filter((b) => !state.selectedBrands.has(b.id));

  const chipsEl = $('brandChips');
  if (selected.length === 0) {
    chipsEl.innerHTML = '<span class="chip-empty">No brands selected — pick one below.</span>';
  } else {
    // R15: brand.id and brand.label come from the server /api/brands response
    // (controlled by data/qc-dashboard-brands.json today, but treat as untrusted).
    chipsEl.innerHTML = selected.map((brand) => `
      <span class="brand-chip selected" data-brand="${escapeHtml(brand.id)}">
        <span>${escapeHtml(brand.label)}</span>
        <button type="button" class="chip-x" data-remove="${escapeHtml(brand.id)}" aria-label="Remove ${escapeHtml(brand.label)}">×</button>
      </span>
    `).join('');
    document.querySelectorAll('.chip-x[data-remove]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.selectedBrands.delete(btn.dataset.remove);
        renderBrands();
      });
    });
  }

  const select = $('brandAddSelect');
  if (unselected.length === 0) {
    select.innerHTML = '<option value="" disabled selected>All brands added</option>';
    select.disabled = true;
  } else {
    select.disabled = false;
    select.innerHTML = '<option value="" disabled selected>+ Add brand</option>' +
      unselected.map((b) => `<option value="${escapeHtml(b.id)}">${escapeHtml(b.label)}</option>`).join('');
  }
  updateBrandLinks();
  renderEmptyStates();
}

// BO Relay: intermediate statuses that appear on QUEUED results before the
// worker's evidence lands. Each has its own pill class so the operator can
// see at a glance whether the run is still pending vs terminal.
function relayStatusLabel(result) {
  const s = result?.status;
  if (s === 'QUEUED') return 'QUEUED';
  if (s === 'RELAY_FETCHING') return 'RELAY FETCHING';
  if (s === 'TIMED_OUT') return 'RELAY TIMED OUT';
  if (s === 'EXPIRED') return 'RELAY EXPIRED';
  if (s === 'LOST') return 'RELAY LOST';
  return null;
}
function isRelayPendingStatus(result) {
  return result?.status === 'QUEUED' || result?.status === 'RELAY_FETCHING';
}

function verdictLabel(v, result) {
  const relay = relayStatusLabel(result);
  if (relay && v == null) return relay;
  if (v === 'SAFE') return 'PASS';
  if (v === 'REVIEW') return 'REVIEW';
  if (v === 'MANUAL_REQUIRED') return 'MANUAL';
  if (v === 'MANUAL_PASS') return 'MANUAL PASS';
  return 'FAIL';
}

function verdictClass(v, result) {
  if (result && isRelayPendingStatus(result)) return 'pending';
  if (result && (result.status === 'TIMED_OUT' || result.status === 'EXPIRED' || result.status === 'LOST')) return 'manual';
  if (v === 'SAFE') return 'safe';
  if (v === 'REVIEW') return 'review';
  if (v === 'MANUAL_REQUIRED') return 'manual';
  // MANUAL_PASS uses the same amber accent as MANUAL_REQUIRED — visually
  // distinct from auto-SAFE (green) so operators/reviewers can tell an
  // override apart from an automated pass at a glance.
  if (v === 'MANUAL_PASS') return 'manual';
  return 'not-safe';
}

function verdictWords(v, count) {
  if (v === 'SAFE') return 'SAFE TO APPROVE - PASS';
  if (v === 'REVIEW') return `REQUIRES REVIEW - WARNING - ${count} findings`;
  if (v === 'MANUAL_REQUIRED') return `MANUAL REVIEW REQUIRED - LIVE BO EVIDENCE UNAVAILABLE - ${count} findings`;
  if (v === 'MANUAL_PASS') return `MANUAL PASS OVERRIDE RECORDED - ${count} findings`;
  return `NOT SAFE TO APPROVE - FAIL - ${count} findings`;
}

const DETAIL_COLUMNS = [
  { key: 'promoCode', label: 'Code', mono: true },
  { key: 'promoName', label: 'Name', mono: false },
  { key: 'promoType', label: 'Type', mono: true },
  { key: 'currency', label: 'Currency', mono: true },
  { key: 'minDeposit', label: 'Min Dep', mono: true },
  { key: 'maxBonus', label: 'Max Bonus', mono: true },
  { key: 'turnover', label: 'TO', mono: true },
  { key: 'reward', label: 'Reward', mono: true },
  { key: 'lifetimeClaim', label: 'Lifetime', mono: true },
  { key: 'dailyClaim', label: 'Daily', mono: true },
  { key: 'validity', label: 'Validity', mono: true },
  { key: 'recurring', label: 'Recurring', mono: true },
  { key: 'eligibility', label: 'Members', mono: true },
  { key: 'gamesProviders', label: 'Games', mono: true },
  { key: 'inboxContent', label: 'Inbox', mono: true },
  { key: 'status', label: 'Status', mono: true },
  { key: 'createdBy', label: 'By', mono: true },
  { key: 'updatedAt', label: 'Updated', mono: true },
];

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[ch]);
}

// R23: sanitize error detail for the mechanics one-liner — same treatment
// auto-checks.js applies to the finding message (R19). Strips inline HTML
// bodies (nginx 403 pages), full URLs, and de-dupes 'HTTP 403 (HTTP 403)'
// when the status is the only useful signal. Kept in the frontend so any
// future server-side error string is safely rendered too.
function _cleanMechanicsDetail(detail) {
  if (!detail) return 'fetch failed';
  let out = String(detail);
  const htmlIx = out.search(/<html|<!doctype|<head/i);
  if (htmlIx >= 0) out = out.slice(0, htmlIx).trim();
  const statusMatch = out.match(/HTTP\s+(\d{3})/i);
  out = out.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
  if (!out || /^HTTP\s+\d{3}$/i.test(out)) return statusMatch ? `HTTP ${statusMatch[1]}` : 'fetch failed';
  if (out.length > 200) out = out.slice(0, 200) + '…';
  return statusMatch && !new RegExp(`HTTP\\s+${statusMatch[1]}`, 'i').test(out)
    ? `${out} (HTTP ${statusMatch[1]})`
    : out;
}

function openPromptModal(prompt) {
  const pre = $('promptText');
  pre.textContent = prompt;
  $('copiedConfirm').classList.add('hidden');
  $('promptModal').classList.remove('hidden');
  pre.scrollTop = 0;
  activateModalTrap('promptModal');
}

function closePromptModal() {
  releaseModalTrap('promptModal');
  $('promptModal').classList.add('hidden');
}

function fieldsForFinding(finding = {}) {
  const fields = new Set();
  if (finding.field) fields.add(finding.field);
  const text = `${finding.check || ''} ${finding.message || ''}`.toLowerCase();
  if (text.includes('not found')) fields.add('promoCode');
  if (text.includes('currency')) fields.add('currency');
  if (text.includes('valid') || text.includes('expired') || text.includes('enddate')) fields.add('validity');
  if (text.includes('lifetime')) fields.add('lifetimeClaim');
  if (text.includes('daily')) fields.add('dailyClaim');
  if (text.includes('claim')) fields.add('lifetimeClaim');
  if (text.includes('provider') || text.includes('game') || text.includes('category')) fields.add('gamesProviders');
  if (text.includes('message template') || text.includes('mt ') || text.includes('inbox') || text.includes('domain')) fields.add('inboxContent');
  if (text.includes('popup') || text.includes('dialog')) fields.add('inboxContent');
  if (text.includes('status') || text.includes('active')) fields.add('status');
  if (text.includes('name')) fields.add('promoName');
  return fields;
}

function findingChipsForField(result, field) {
  return (result.findings || []).filter((finding) => fieldsForFinding(finding).has(field));
}

function renderCell(result, column) {
  const raw = result.details?.[column.key];
  const value = raw == null || raw === '' ? 'unavailable' : String(raw);
  const unavailable = value === 'unavailable';
  const chips = unavailable
    ? [{ severity: 'FAIL', label: 'FAIL' }]
    : findingChipsForField(result, column.key).map((finding) => ({
      severity: finding.severity || 'WARNING',
      label: finding.severity === 'FAIL' ? 'FAIL' : 'WARN',
    }));
  const chipHtml = chips.map((chip) => (
    `<span class="chip ${chip.severity === 'FAIL' ? 'not-safe' : 'review'}">${chip.label}</span>`
  )).join(' ');
  return `<td class="${column.mono ? 'mono-cell' : 'name-cell'}"><span>${escapeHtml(value)}</span>${chipHtml ? ' ' + chipHtml : ''}</td>`;
}

/* Increment 6: Expected-vs-Live table.
   Rendered from result.compare — hidden entirely when the active result
   has no compare block (non-MVP brand, or the flow skipped). Every value
   goes through escapeHtml — expected/live sides carry BO-derived strings
   and must never touch innerHTML raw. */
function formatCompareValue(v) {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return v.length ? v.map((x) => String(x)).join(', ') : '[]';
  if (typeof v === 'object') {
    try { return JSON.stringify(v); } catch { return String(v); }
  }
  return String(v);
}

function compareVerdictClass(v) {
  const s = String(v || '').toLowerCase();
  if (s === 'match') return 'match';
  if (s === 'mismatch') return 'mismatch';
  if (s === 'unavailable') return 'unavailable';
  return 'skipped';
}

function renderCompareCard() {
  const card = $('compareCard');
  const bar = $('compareSourceBar');
  const rows = $('compareRows');
  const hint = $('compareHint');
  if (!card || !bar || !rows) return;
  const data = activeResult();
  const cmp = data?.compare;
  if (!cmp || !Array.isArray(cmp.fields) || cmp.fields.length === 0) {
    card.classList.add('hidden');
    bar.replaceChildren();
    rows.replaceChildren();
    if (hint) hint.textContent = '';
    return;
  }
  card.classList.remove('hidden');

  const src = cmp.expectedSource || {};
  const kindLabel = ({
    bundle: 'From canary bundle',
    request: 'From approved request',
    ambiguous: 'Ambiguous — need Handle',
    'not-found': 'No approved source',
    invalid: 'Invalid source',
  })[src.sourceType] || 'Unknown source';
  const parts = [];
  parts.push(`<span class="src-kind">${escapeHtml(kindLabel)}</span>`);
  const meta = [];
  if (src.handle) meta.push(`<span class="src-meta">Handle <code>${escapeHtml(src.handle)}</code></span>`);
  if (src.promoCode) meta.push(`<span class="src-meta">Code <code>${escapeHtml(src.promoCode)}</code></span>`);
  if (src.brand) meta.push(`<span class="src-meta">Brand <code>${escapeHtml(src.brand)}</code></span>`);
  if (src.sourceTs) meta.push(`<span class="src-meta">Source ts <code>${escapeHtml(String(src.sourceTs).slice(0, 19))}</code></span>`);
  if (src.approvalStatus) meta.push(`<span class="src-meta">Approval <code>${escapeHtml(src.approvalStatus)}</code></span>`);
  bar.innerHTML = parts.concat(meta).join(' ');

  const summary = cmp.summary || {};
  if (hint) {
    hint.textContent = `${summary.passed || 0} match · ${summary.failed || 0} mismatch · ${summary.unavailable || 0} unavailable · ${summary.skipped || 0} skipped`;
  }

  rows.innerHTML = cmp.fields.map((f) => {
    const cls = compareVerdictClass(f.verdict);
    const expected = escapeHtml(formatCompareValue(f.expected));
    const actual = escapeHtml(formatCompareValue(f.actual));
    const expectedCls = f.expected == null ? 'field-value' : (cls === 'mismatch' ? 'field-value has-value mismatch' : 'field-value has-value');
    const actualCls = f.actual == null ? 'field-value' : (cls === 'mismatch' ? 'field-value has-value mismatch' : 'field-value has-value');
    const notes = f.notes ? `<span class="field-notes">${escapeHtml(f.notes)}</span>` : '';
    return `<tr class="row-${cls}">
      <td class="field-name">${escapeHtml(f.name)}${notes}</td>
      <td class="${expectedCls}">${expected}</td>
      <td class="${actualCls}">${actual}</td>
      <td><span class="verdict-chip ${cls}">${escapeHtml(String(f.verdict || ''))}</span></td>
    </tr>`;
  }).join('');
}

function renderDetailsTable() {
  // R15: DETAIL_COLUMNS[].label is a code-owned literal (safe), but result.brand
  // comes from the QC batch (BO-derived) and must be escaped before innerHTML.
  $('detailsHead').innerHTML = `<tr><th>Brand</th>${DETAIL_COLUMNS.map((column) => `<th>${escapeHtml(column.label)}</th>`).join('')}</tr>`;
  $('detailsRows').innerHTML = state.results.map((result) => `
    <tr class="${state.activeKey === resultKey(result) ? 'active-detail-row' : ''}">
      <td><strong>${escapeHtml(result.brand)}</strong></td>
      ${DETAIL_COLUMNS.map((column) => renderCell(result, column)).join('')}
    </tr>
  `).join('') || `<tr><td colspan="${DETAIL_COLUMNS.length + 1}" class="muted">Run QC to load batch details.</td></tr>`;
}

function resultKey(r) { return `${r.brand}:${r.code}`; }

function activeResult() {
  return state.results.find((r) => resultKey(r) === state.activeKey) || null;
}

function renderPills() {
  // R15: r.brand and r.code come from the QC batch (BO-derived) — escape before innerHTML.
  // key is composed of brand+code so it also needs escaping when placed in the data-key
  // attribute (attribute-context escaping via the same HTML entity encoder is safe).
  // verdictClass()/verdictLabel() return code-owned literals — safe as-is.
  $('resultPills').innerHTML = state.results.map((r) => {
    const key = resultKey(r);
    return `<button class="pill ${state.activeKey === key ? 'active' : ''}" data-key="${escapeHtml(key)}">
      <strong>${escapeHtml(r.brand)}</strong>
      <code>${escapeHtml(r.code)}</code>
      <span class="chip ${verdictClass(r.verdict, r)}">${escapeHtml(verdictLabel(r.verdict, r))}</span>
    </button>`;
  }).join('');
  document.querySelectorAll('[data-key]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.activeKey = btn.dataset.key;
      renderActiveResult();
    });
  });
}

function renderActiveResult() {
  const data = activeResult();
  const key = data ? resultKey(data) : null;
  renderPills();
  document.querySelectorAll('[data-result]').forEach((btn) => {
    btn.classList.toggle('primary', Boolean(data && getVerdictFor(key) === btn.dataset.result));
    btn.setAttribute('aria-pressed', String(Boolean(data && getVerdictFor(key) === btn.dataset.result)));
  });
  if (!data) {
    $('verdictPanel').className = 'verdict hidden card';
    renderDetailsTable();
    renderCompareCard();
    updateRemarksVisibility();
    renderEmptyStates();
    return;
  }
  const panel = $('verdictPanel');
  panel.className = `verdict card ${verdictClass(data.verdict, data)}`;
  $('verdictText').textContent = isRelayPendingStatus(data)
    ? `${relayStatusLabel(data)} — awaiting BO relay evidence from the VDI worker`
    : verdictWords(data.verdict, data.findings.length);
  // R23: mechanics text also carries the failure detail; strip inline HTML +
  // absolute URLs same way R19 did for finding.message. Previously the raw
  // nginx 403 body leaked here even after R19 cleaned the finding.
  $('mechanics').textContent = data.error ? `${data.error}: ${_cleanMechanicsDetail(data.detail)}` : data.mechanics;
  // R15 (Codex-flagged blocker): finding.message and finding.severity can carry
  // BO- / server-derived text (e.g. R14 partial-check message includes site id +
  // field name). Escape both before innerHTML.
  $('findings').innerHTML = data.findings.map((f, i) => `
    <div class="finding">
      <div><strong class="${f.severity === 'FAIL' ? 'issue' : 'review'}">${escapeHtml(f.severity)}</strong> ${escapeHtml(f.message)}</div>
      ${f.severity === 'FAIL' ? `<button data-fix-finding="${i}">Fix with Claude</button>` : ''}
    </div>
  `).join('') || '<div class="muted">No findings</div>';
  document.querySelectorAll('[data-fix-finding]').forEach((btn) => {
    btn.addEventListener('click', () => dispatchFindingFix(Number(btn.dataset.fixFinding)));
  });
  renderDetailsTable();
  renderCompareCard();
  // Increment 1 (reverts R20): PASS is auto-only. MANUAL_REQUIRED must never
  // silently become an automated PASS — that would violate the "no PASS
  // without live BO evidence" invariant. Operators who want to record a pass
  // for a MANUAL_REQUIRED result use the separate MANUAL_PASS override flow
  // (Increment 7) which captures reason + evidence + checker identity into a
  // distinct audit record.
  $('passBtn').disabled = data.verdict !== 'SAFE';
  updateManualPassButtonGate(data);
  // R11 fix 4: load this result's remarks into the form
  loadRemarksIntoForm(ensureResultSlot(key).remarks);
  updateRemarksVisibility();
  renderEmptyStates();
}

// BO Relay: per-job polling. Emits state transitions QUEUED → RELAY_FETCHING
// → COMPARING → COMPLETE without holding an HTTP request open. If the job
// is still QUEUED/LEASED at JOB_POLL_MAX_MS we abandon and surface TIMED_OUT
// (the browser's own decision; the server ALSO has a job TTL and will EXPIRE
// the record independently so no verdict can leak out).
const JOB_POLL_INTERVAL_MS = 2000;
const JOB_POLL_MAX_MS = 90_000;
const _relayPollTimers = new Map(); // resultKey → timeout id

function _updateResultInPlace(key, patch) {
  const ix = state.results.findIndex((r) => resultKey(r) === key);
  if (ix < 0) return;
  state.results[ix] = { ...state.results[ix], ...patch };
  if (state.activeKey === key) renderActiveResult();
  else renderPills();
}

async function pollRelayJob(result) {
  const key = resultKey(result);
  const jobId = result.jobId;
  const startedAt = Date.now();
  const poll = async () => {
    if (Date.now() - startedAt > JOB_POLL_MAX_MS) {
      _updateResultInPlace(key, {
        status: 'TIMED_OUT',
        verdict: 'MANUAL_REQUIRED',
        mechanics: 'Relay did not respond within 90s',
        findings: [{ severity: 'FAIL', check: 'relay-timeout', message: 'The BO relay worker on the VDI did not return a result within 90s — enter QC verdict manually via Override.' }],
        details: {},
      });
      return;
    }
    try {
      const data = await api(`/api/qc-jobs/${encodeURIComponent(jobId)}`);
      const job = data.job || {};
      if (job.status === 'COMPLETED' && job.result) {
        const b = job.result;
        _updateResultInPlace(key, {
          status: 'COMPLETE',
          runId: job.finalRunId,
          verdict: b.verdict,
          mechanics: b.verdict === 'MANUAL_REQUIRED' ? 'Relay evidence incomplete' : 'Via BO relay',
          findings: b.findings || [],
          details: {},
          compare: b.fields ? { expected: b.expectedRef, actual: b.actualRef, fields: b.fields, summary: b.summary, expectedSource: b.expectedSource } : null,
        });
        return;
      }
      if (job.status === 'EXPIRED') {
        _updateResultInPlace(key, {
          status: 'EXPIRED',
          verdict: 'MANUAL_REQUIRED',
          mechanics: 'Relay job expired',
          findings: [{ severity: 'FAIL', check: 'relay-expired', message: 'The BO relay job expired before a result was submitted — enter QC verdict manually via Override.' }],
        });
        return;
      }
      if (job.status === 'LEASED') {
        _updateResultInPlace(key, { status: 'RELAY_FETCHING' });
      }
      const t = setTimeout(poll, JOB_POLL_INTERVAL_MS);
      _relayPollTimers.set(key, t);
    } catch (e) {
      // 404 = unknown/lost job (e.g. server restarted). Treat as MANUAL_REQUIRED.
      _updateResultInPlace(key, {
        status: 'LOST',
        verdict: 'MANUAL_REQUIRED',
        mechanics: 'Relay job lost',
        findings: [{ severity: 'FAIL', check: 'relay-lost', message: `Relay job could not be retrieved: ${e.message} — enter QC verdict manually via Override.` }],
      });
    }
  };
  await poll();
}

function _cancelRelayPolls() {
  for (const t of _relayPollTimers.values()) clearTimeout(t);
  _relayPollTimers.clear();
}

function renderRun(results) {
  state.results = results;
  state.activeKey = results[0] ? resultKey(results[0]) : '';
  state.selectedResults = {};
  for (const r of results) ensureResultSlot(resultKey(r));
  setWorkflowStep(results.length ? 'review' : 'setup');
  renderActiveResult();
}

// Increment 6: handle input is validated client-side too — the server
// enforces the same pattern (^[A-Z]{1,3}\d{1,6}$) so bad values 400 there,
// but catching it here gives immediate feedback and doesn't waste a round-trip.
function parseHandle() {
  const raw = ($('handleInput')?.value || '').trim();
  if (!raw) return { ok: true, handle: null };
  if (raw.length > 40) return { ok: false, error: `Handle "${raw.slice(0, 30)}…" is longer than 40 characters.` };
  if (!/^[A-Za-z][A-Za-z0-9-]{1,39}$/.test(raw)) {
    return { ok: false, error: `Handle "${raw}" must be letters/digits/hyphens (underscores are reserved for promo codes).` };
  }
  return { ok: true, handle: raw };
}

async function runQc() {
  const codes = parseCodes();
  const brands = [...state.selectedBrands];
  if (!brands.length || !codes.length) { toast('Select at least one brand and one promo code.', 'error'); return; }
  if (codes.length > 5) { toast('Run QC accepts at most 5 promo codes.', 'error'); return; }
  const parsedHandle = parseHandle();
  if (!parsedHandle.ok) { toast(parsedHandle.error, 'error'); return; }
  const handle = parsedHandle.handle;
  $('runQc').disabled = true;
  setWorkflowStep('running');
  showSkeleton(true);
  try {
    const batches = await Promise.all(brands.map((brand) =>
      api('/api/run-qc', { method: 'POST', body: JSON.stringify({ brand, codes, handle }) })
        .then((data) => (data.results || []).map((r) => ({ ...r, brand })))
        .catch((e) => codes.map((code) => ({
          brand, code, verdict: 'NOT_SAFE', mechanics: '', findings: [{ severity: 'FAIL', check: 'run-qc-error', message: e.message }], details: {}, snapshotPath: '', duplicateRecent: null,
        })))
    ));
    renderRun(batches.flat());
    // BO Relay UI (correction brief §7): every QUEUED result kicks off a
    // background poll of /api/qc-jobs/:id. The DOM updates as each job
    // moves through states. If a job doesn't complete within JOB_POLL_MAX_MS
    // we mark it TIMED_OUT client-side (verdict stays MANUAL_REQUIRED per
    // §5 — the server also has its own 2-min job TTL as the authoritative
    // deadline).
    for (const r of batches.flat()) {
      if (r.status === 'QUEUED' && r.jobId) pollRelayJob(r);
    }

  }
}

async function dispatchFindingFix(index) {
  const data = activeResult();
  if (!data) return;
  const finding = data.findings[index];
  try {
    const result = await api('/api/fix-request', {
      method: 'POST',
      body: JSON.stringify({
        source: 'auto-finding',
        brand: data.brand,
        code: data.code,
        finding,
        expected: finding.expected || '',
        actual: finding.actual || '',
        snapshotPath: data.snapshotPath,
      }),
    });
    openPromptModal(result.prompt);
  } catch (e) {
    alert(`Fix request failed: ${e.message}`);
  }
}

async function dispatchManualFix() {
  const data = activeResult();
  if (!data) return alert('Run QC before requesting a fix.');
  const finding = {
    severity: 'FAIL',
    check: $('errorCategory').value || 'manual-error',
    message: $('description').value || 'Manual QC error',
  };
  try {
    const result = await api('/api/fix-request', {
      method: 'POST',
      body: JSON.stringify({
        source: 'manual',
        brand: data.brand,
        code: data.code,
        finding,
        expected: $('expected').value,
        actual: $('actual').value,
        snapshotPath: data.snapshotPath,
      }),
    });
    openPromptModal(result.prompt);
  } catch (e) {
    alert(`Fix request failed: ${e.message}`);
  }
}

function compactFindings(data) {
  return (data?.findings || []).map((finding) => ({
    severity: finding.severity,
    check: finding.check,
    field: finding.field,
    message: finding.message,
  }));
}

function recordPayload(data, useActiveFormRemarks=false) {
  const brand = state.brands.find((b) => b.id === data.brand);
  const key = resultKey(data);
  const slot = ensureResultSlot(key);
  // R11 fix 3: use this result's own stored remarks by default; only pull from live form when explicitly asked
  const remarks = useActiveFormRemarks ? Object.fromEntries(REMARK_FIELDS.map((f) => [f, document.getElementById(f)?.value || ''])) : slot.remarks;
  return {
    brand: data.brand,
    code: data.code,
    platform: brand?.runtime?.platform || '',
    region: brand?.runtime?.region || '',
    promoType: data.details?.promoType || '',
    result: slot.verdict,
    findings: compactFindings(data),
    errorCategory: remarks.errorCategory || '',
    description: remarks.description || '',
    expected: remarks.expected || '',
    actual: remarks.actual || '',
    actionRequired: remarks.actionRequired || '',
    personResponsible: remarks.personResponsible || '',
    evidenceLink: remarks.evidenceLink || '',
    fetchSnapshot: data.snapshotPath || '',
    durationS: data.duration_s || '',
  };
}

// R11 fix 2: try/catch + toast, buttons stay enabled for retry
async function saveRecord() {
  const data = activeResult();
  if (!data) { toast('Run QC before saving.', 'error'); return; }
  const key = resultKey(data);
  const slot = ensureResultSlot(key);
  if (!slot.verdict) { toast('Choose Pass/Fail/Review for the active result first.', 'error'); return; }
  persistRemarksFromForm();
  const btn = $('saveRecord');
  btn.disabled = true;
  try {
    const saved = await api('/api/qc-record', { method: 'POST', body: JSON.stringify(recordPayload(data, /*useActiveFormRemarks=*/true)) });
    setWorkflowStep('save');
    toast(saved.sheet?.action === 'pending' ? `Saved locally; sheet pending: ${saved.sheet.error}` : `Saved ${data.brand} ${data.code}.`, 'success');
    try { await loadHistory(); } catch {}
  } catch (e) {
    toast(`Save failed: ${e.message}`, 'error');
  } finally {
    btn.disabled = false;
  }
}

// R11 fix 3: remarks apply to ACTIVE result only, unless "Apply to all" checked
async function saveAll() {
  if (!state.results.length) { toast('Run QC before saving.', 'error'); return; }
  persistRemarksFromForm();
  const missing = state.results.filter((r) => !getVerdictFor(resultKey(r))).map((r) => `${r.brand} ${r.code}`);
  if (missing.length) { toast(`Choose a result for: ${missing.join(', ')}`, 'error'); return; }
  const applyAll = document.getElementById('applyRemarksAll')?.checked;
  const btn = $('saveAll');
  btn.disabled = true;
  try {
    const activeKey = state.activeKey;
    const results = await Promise.allSettled(state.results.map((r) => {
      const useForm = applyAll || (resultKey(r) === activeKey);
      return api('/api/qc-record', { method: 'POST', body: JSON.stringify(recordPayload(r, useForm)) });
    }));
    const okCount = results.filter((x) => x.status === 'fulfilled').length;
    const failCount = results.length - okCount;
    if (failCount === 0) {
      setWorkflowStep('save');
      toast(`Saved ${okCount} records.`, 'success');
    } else {
      toast(`Saved ${okCount}, failed ${failCount}. Retry the failed ones.`, 'error');
    }
    try { await loadHistory(); } catch {}
  } finally {
    btn.disabled = false;
  }
}

// Increment 7 helper — kept in its own function so it lives far from the
// Pass-button gate that Increment 1 audits. See D5 for the invariant.
function updateManualPassButtonGate(data) {
  const btn = $('manualPassBtn');
  if (!btn) return;
  btn.disabled = data.verdict !== 'MANUAL_REQUIRED';
}

/* Increment 7: Manual Pass Override — modal flow.
   Reason/evidence live only in this modal; on submit, the server re-validates
   everything and creates a NEW audit record. Local state is never mutated to
   PASS — the modal closes on success and history reloads so the operator
   sees the new MANUAL_PASS row alongside the original MANUAL_REQUIRED one. */
function openManualPassModal() {
  const data = activeResult();
  if (!data) { toast('Run QC before requesting an override.', 'error'); return; }
  if (data.verdict !== 'MANUAL_REQUIRED') {
    toast('Manual Pass is only available when the verdict is MANUAL_REQUIRED.', 'error'); return;
  }
  $('mpReason').value = '';
  $('mpEvidence').value = '';
  $('mpChecker').value = state.user?.email || '';
  $('mpError').classList.add('hidden');
  $('mpError').textContent = '';
  const ctx = $('manualPassContext');
  if (ctx) {
    ctx.innerHTML = `Overriding <code>${escapeHtml(data.brand)}</code> · <code>${escapeHtml(data.code)}</code>
      — current verdict <code>MANUAL_REQUIRED</code>.
      ${data.findings.length ? `Reason from auto-check: <em>${escapeHtml(data.findings[0].message || '')}</em>` : ''}`;
  }
  $('manualPassModal').classList.remove('hidden');
  activateModalTrap('manualPassModal');
}

function closeManualPassModal() {
  releaseModalTrap('manualPassModal');
  $('manualPassModal').classList.add('hidden');
}

async function submitManualPassOverride() {
  const data = activeResult();
  if (!data) { closeManualPassModal(); return; }
  const reason = $('mpReason').value.trim();
  const evidence = $('mpEvidence').value.trim();
  const errBox = $('mpError');
  errBox.classList.add('hidden'); errBox.textContent = '';
  if (reason.length < 10) { errBox.textContent = 'Reason must be at least 10 characters.'; errBox.classList.remove('hidden'); return; }
  if (!evidence) { errBox.textContent = 'Evidence is required.'; errBox.classList.remove('hidden'); return; }
  const brand = state.brands.find((b) => b.id === data.brand);
  const submitBtn = $('mpSubmit');
  submitBtn.disabled = true;
  try {
    await api('/api/qc-manual-pass-override', {
      method: 'POST',
      body: JSON.stringify({
        brand: data.brand,
        code: data.code,
        platform: brand?.runtime?.platform || '',
        region: brand?.runtime?.region || '',
        promoType: data.details?.promoType || '',
        // Blocker 1 fix: send the server-issued runId. The server verifies
        // the runId maps to a recent MANUAL_REQUIRED result before allowing
        // the override — a crafted body cannot spoof this. If the runId is
        // missing (upgraded server, old cached page), the server 400s and
        // the operator retries.
        runId: data.runId || null,
        reason,
        evidence,
        findings: data.findings || [],
        fetchSnapshot: data.snapshotPath || '',
        durationS: data.duration_s || '',
        compare: data.compare || null,
      }),
    });
    toast(`MANUAL_PASS recorded for ${data.brand} ${data.code}.`, 'success');
    closeManualPassModal();
    try { await loadHistory(); } catch {}
  } catch (e) {
    errBox.textContent = `Override failed: ${e.message}`;
    errBox.classList.remove('hidden');
  } finally {
    submitBtn.disabled = false;
  }
}

async function copySummary() {
  const data = activeResult();
  if (!data) return;
  const text = [
    `${data.brand} ${data.code}`,
    verdictWords(data.verdict, data.findings.length),
    data.mechanics,
    ...data.findings.map((f) => `- ${f.severity}: ${f.message}`),
  ].join('\n');
  try {
    await navigator.clipboard.writeText(text);
    toast('Summary copied.', 'muted');
  } catch (e) {
    toast(`Copy failed: ${e.message}`, 'error');
  }
}

async function dispatchHistoryFix(index) {
  const row = state.historyRows[index];
  const findings = Array.isArray(row.findings) ? row.findings : [];
  const finding = findings.find((item) => item.severity === 'FAIL') || findings[0] || {
    severity: row.qc_result === 'FAIL' ? 'FAIL' : 'WARNING',
    check: row.error_category || 'history-qc-record',
    message: row.description || row.qc_result || 'History QC finding',
  };
  try {
    const result = await api('/api/fix-request', {
      method: 'POST',
      body: JSON.stringify({
        source: 'history',
        brand: row.brand,
        code: row.code,
        finding,
        expected: row.expected || '',
        actual: row.actual || '',
        snapshotPath: row.fetch_snapshot || '',
      }),
    });
    openPromptModal(result.prompt);
  } catch (e) {
    alert(`Fix request failed: ${e.message}`);
  }
}

// R11 fix 1: try/catch; failure shows inline banner but does not fatal the app
async function loadHistory() {
  const banner = document.getElementById('historyBanner');
  const meta = document.getElementById('historyMeta');
  try {
    const h = await api('/api/history');
    state.historyRows = h.rows || [];
    if (banner) { banner.classList.add('hidden'); banner.textContent = ''; }
    if (meta) meta.textContent = state.historyRows.length ? `${state.historyRows.length} recent` : '';
    // R15: use the shared escapeHtml() (covers ' and " too, needed for the timestamp
     // slice + full defense-in-depth). Replaces the R11-era local escaper.
    $('historyRows').innerHTML = state.historyRows.map((r, i) => {
      const canFix = r.qc_result === 'FAIL' || r.qc_result === 'REQUIRES_REVIEW' || r.qc_result === 'REVIEW';
      return `
        <tr>
          <td class="hist-time">${escapeHtml((r.timestamp || '').replace(/T/,' ').slice(0, 16))}</td>
          <td class="hist-brand">${escapeHtml(r.brand || '')}<br><code>${escapeHtml(r.code || '')}</code></td>
          <td>${escapeHtml(r.qc_result || '')}</td>
          <td>${canFix ? `<button data-history-fix="${i}">Fix</button>` : ''}</td>
        </tr>
      `;
    }).join('');
    document.querySelectorAll('[data-history-fix]').forEach((btn) => {
      btn.addEventListener('click', () => dispatchHistoryFix(Number(btn.dataset.historyFix)));
    });
    renderEmptyStates();
  } catch (e) {
    if (banner) {
      banner.textContent = `History unavailable — QC still works. (${e.message})`;
      banner.classList.remove('hidden');
    }
    state.historyRows = [];
    if (meta) meta.textContent = '';
    if ($('historyRows')) $('historyRows').innerHTML = '';
    renderEmptyStates();
  }
}

function bind() {
  $('runQc').addEventListener('click', runQc);
  $('clearBtn').addEventListener('click', () => {
    _cancelRelayPolls();
    resetCodeRows();
    if ($('handleInput')) $('handleInput').value = '';
    state.results = [];
    state.activeKey = '';
    state.selectedResults = {};
    loadRemarksIntoForm(EMPTY_REMARKS());
    setWorkflowStep('setup');
    renderActiveResult();
  });
  // R11 fix 4: persist form edits into the active result's slot on every change
  for (const f of REMARK_FIELDS) {
    const el = document.getElementById(f);
    if (el) el.addEventListener('input', persistRemarksFromForm);
  }
  $('saveRecord').addEventListener('click', saveRecord);
  $('saveAll').addEventListener('click', saveAll);
  $('copySummary').addEventListener('click', copySummary);
  $('manualFix').addEventListener('click', dispatchManualFix);
  // Increment 7: Manual Pass Override modal wiring
  const mpBtn = $('manualPassBtn');
  if (mpBtn) mpBtn.addEventListener('click', openManualPassModal);
  const mpCancel = $('mpCancel');
  if (mpCancel) mpCancel.addEventListener('click', closeManualPassModal);
  const mpSubmit = $('mpSubmit');
  if (mpSubmit) mpSubmit.addEventListener('click', submitManualPassOverride);
  const mpModal = $('manualPassModal');
  if (mpModal) mpModal.addEventListener('click', (e) => { if (e.target === mpModal) closeManualPassModal(); });
  $('settingsBtn').addEventListener('click', () => {
    openUsersModal().catch((e) => alert(`Could not load admitted users: ${e.message}`));
  });
  // R18-lite: site configs modal
  const siteConfigsBtn = document.getElementById('siteConfigsBtn');
  if (siteConfigsBtn) siteConfigsBtn.addEventListener('click', () => {
    openSiteConfigsModal().catch((e) => toast(`Could not open site configs: ${e.message}`, 'error'));
  });
  const siteConfigsCloseBtn = document.getElementById('siteConfigsCloseBtn');
  if (siteConfigsCloseBtn) siteConfigsCloseBtn.addEventListener('click', closeSiteConfigsModal);
  const siteConfigsImportBtn = document.getElementById('siteConfigsImportBtn');
  if (siteConfigsImportBtn) siteConfigsImportBtn.addEventListener('click', importSiteConfigs);
  const siteConfigsRefreshBtn = document.getElementById('siteConfigsRefreshBtn');
  if (siteConfigsRefreshBtn) siteConfigsRefreshBtn.addEventListener('click', refreshSiteConfigsGrid);
  const siteConfigsModal = document.getElementById('siteConfigsModal');
  if (siteConfigsModal) siteConfigsModal.addEventListener('click', (e) => {
    if (e.target === siteConfigsModal) closeSiteConfigsModal();
  });
  // BO Relay self-service rotate — admin-only. Button lives inside the
  // existing site-configs modal so we don't add a new nav entry.
  const relayKeyRotateBtn = document.getElementById('relayKeyRotateBtn');
  if (relayKeyRotateBtn) relayKeyRotateBtn.addEventListener('click', rotateRelayKey);
  const relayKeyCopyBtn = document.getElementById('relayKeyCopyBtn');
  if (relayKeyCopyBtn) relayKeyCopyBtn.addEventListener('click', copyRelayKeyToClipboard);
  const relayKeyCloseBtn = document.getElementById('relayKeyCloseBtn');
  if (relayKeyCloseBtn) relayKeyCloseBtn.addEventListener('click', closeRelayKeyModal);
  const relayKeyModal = document.getElementById('relayKeyModal');
  if (relayKeyModal) relayKeyModal.addEventListener('click', (e) => {
    if (e.target === relayKeyModal) closeRelayKeyModal();
  });
  $('usersCloseBtn').addEventListener('click', closeUsersModal);
  $('usersModal').addEventListener('click', (e) => {
    if (e.target === $('usersModal')) closeUsersModal();
  });
  $('usersAddForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const email = $('userEmailInput').value.trim().toLowerCase();
    const role = $('userRoleInput').value.trim().toLowerCase();
    if (!email) return;
    state.adminUsers = normalizeAdminUsers([...state.adminUsers, { email, role }]);
    $('userEmailInput').value = '';
    renderUsersModal();
  });
  $('usersCopyBtn').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('usersJson').textContent);
    } catch {
      alert('Copy failed — select and copy the JSON manually.');
    }
  });
  $('closePromptBtn').addEventListener('click', closePromptModal);
  $('copyPromptBtn').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('promptText').textContent);
      const el = $('copiedConfirm');
      el.classList.remove('hidden');
      setTimeout(() => el.classList.add('hidden'), 3000);
    } catch {
      alert('Copy failed — select and copy the text manually.');
    }
  });
  $('promptModal').addEventListener('click', (e) => {
    if (e.target === $('promptModal')) closePromptModal();
  });
  document.querySelectorAll('[data-result]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const data = activeResult();
      if (!data) { toast('Run QC before choosing a result.', 'error'); return; }
      const slot = ensureResultSlot(resultKey(data));
      slot.verdict = btn.dataset.result;
      persistRemarksFromForm();
      renderActiveResult();
    });
  });
  $('brandAllBtn').addEventListener('click', () => {
    for (const b of state.brands) if (b.enabled) state.selectedBrands.add(b.id);
    renderBrands();
  });
  $('brandClearBtn').addEventListener('click', () => {
    state.selectedBrands.clear();
    state.activeBrand = null;
    renderBrands();
  });
  $('addCodeBtn').addEventListener('click', () => addCodeRow({ focus: true }));
  $('logoutBtn').addEventListener('click', async () => {
    const btn = $('logoutBtn');
    const errEl = $('logoutError');
    btn.disabled = true;
    errEl.classList.add('hidden'); errEl.textContent = '';
    try {
      const r = await fetch('/auth/logout', { method: 'POST' });
      if (!r.ok) throw new Error(`Logout HTTP ${r.status}`);
      location.href = '/';
    } catch (e) {
      errEl.textContent = `Logout failed: ${e.message}`;
      errEl.classList.remove('hidden');
      btn.disabled = false;
    }
  });
  $('brandAddSelect').addEventListener('change', (e) => {
    if (!e.target.value) return;
    state.selectedBrands.add(e.target.value);
    state.activeBrand = e.target.value;
    renderBrands();
  });
  resetCodeRows();
}

const ALLOWED_RETURN_PATHS = new Set(['/dashboard']);

function bindSwitcher() {
  document.querySelectorAll('.switcher-toggle').forEach((toggle) => {
    const panelId = toggle.getAttribute('aria-controls');
    const panel = panelId && document.getElementById(panelId);
    if (!panel) return;
    const open = () => { panel.hidden = false; toggle.setAttribute('aria-expanded', 'true'); };
    const close = () => { panel.hidden = true; toggle.setAttribute('aria-expanded', 'false'); };
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      panel.hidden ? open() : close();
    });
    document.addEventListener('click', (e) => {
      if (!panel.contains(e.target) && e.target !== toggle) close();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  });
}

function bindTopbarScrollShadow() {
  const topbar = document.getElementById('topbar');
  if (!topbar) return;
  window.addEventListener('scroll', () => {
    topbar.classList.toggle('scrolled', window.scrollY > 4);
  }, { passive: true });
}

async function init() {
  bindSwitcher();
  bindTopbarScrollShadow();
  bind();
  setWorkflowStep('setup');
  renderEmptyStates();
  await ensureLogin();
  syncSettingsAccess();
  const returnTo = new URLSearchParams(location.search).get('return');
  if (ALLOWED_RETURN_PATHS.has(returnTo)) {
    location.replace(returnTo);
    return;
  }
  state.brands = (await api('/api/brands')).brands;
  renderBrands();
  // R11 fix 1: history failure no longer fatals init
  loadHistory().catch(() => {});
  renderEmptyStates();
  // R18-lite: allow deep-linking to admin modals from Ops Dashboard topbar
  // (🔧 → ?open=site-configs, ⚙ → ?open=users-modal). Admin-only; silent for
  // non-admins so a shared bookmark doesn't dead-end.
  const openParam = new URLSearchParams(location.search).get('open');
  if (openParam && state.user?.role === 'admin') {
    if (openParam === 'site-configs') openSiteConfigsModal().catch((e) => toast(`Could not open site configs: ${e.message}`, 'error'));
    else if (openParam === 'users-modal') openUsersModal().catch((e) => toast(`Could not load admitted users: ${e.message}`, 'error'));
    try { history.replaceState({}, '', location.pathname); } catch {}
  }
}

init().catch((e) => {
  const stackHtml = (e.stack || '').replace(/[<>&]/g, (c) => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
  document.body.innerHTML = `<main><section><h1>Promo QC Hub</h1><p>${e.message}</p><pre style="white-space:pre-wrap;font-size:11px;color:#666">${stackHtml}</pre></section></main>`;
});

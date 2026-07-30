const state = {
  user: null,
  brands: [],
  selectedBrands: new Set(),
  activeBrand: null,
  results: [],
  activeKey: '',
  selectedResults: {},
  adminUsers: [],
};

const $ = (id) => document.getElementById(id);

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function waitForGoogle() {
  if (typeof google !== 'undefined' && google.accounts) return Promise.resolve();
  return new Promise((resolve) => {
    const iv = setInterval(() => {
      if (typeof google !== 'undefined' && google.accounts) { clearInterval(iv); resolve(); }
    }, 80);
  });
}

async function ensureLogin() {
  // Try existing valid session first.
  try {
    const me = await api('/api/me');
    state.user = me.user;
    $('signedIn').textContent = state.user.email;
    return;
  } catch {}

  const cfg = await fetch('/api/config').then((r) => r.json());

  if (cfg.devMode) {
    // Dev bypass — localhost only; server enforces the restriction.
    const login = await api('/auth/login', { method: 'POST', body: JSON.stringify({}) });
    state.user = login.user;
    $('signedIn').textContent = state.user.email;
    return;
  }

  // Production: Google Sign-In.
  $('loginOverlay').classList.remove('hidden');
  await waitForGoogle();

  await new Promise((resolve, reject) => {
    function onCredential(response) {
      api('/auth/login', { method: 'POST', body: JSON.stringify({ credential: response.credential }) })
        .then((data) => {
          state.user = data.user;
          $('signedIn').textContent = state.user.email;
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
  const btn = $('settingsBtn');
  if (!btn) return;
  btn.classList.toggle('hidden', state.user?.role !== 'admin');
}

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
}

function closeUsersModal() {
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
    chipsEl.innerHTML = selected.map((brand) => `
      <span class="brand-chip selected" data-brand="${brand.id}">
        <span>${brand.label}</span>
        <button type="button" class="chip-x" data-remove="${brand.id}" aria-label="Remove ${brand.label}">×</button>
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
      unselected.map((b) => `<option value="${b.id}">${b.label}</option>`).join('');
  }
  updateBrandLinks();
}

function verdictLabel(v) {
  if (v === 'SAFE') return 'PASS';
  if (v === 'REVIEW') return 'REVIEW';
  return 'FAIL';
}

function verdictClass(v) {
  if (v === 'SAFE') return 'safe';
  if (v === 'REVIEW') return 'review';
  return 'not-safe';
}

function verdictWords(v, count) {
  if (v === 'SAFE') return 'SAFE TO APPROVE - PASS';
  if (v === 'REVIEW') return `REQUIRES REVIEW - WARNING - ${count} findings`;
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

function openPromptModal(prompt) {
  const pre = $('promptText');
  pre.textContent = prompt;
  $('copiedConfirm').classList.add('hidden');
  $('promptModal').classList.remove('hidden');
  pre.scrollTop = 0;
}

function closePromptModal() {
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

function renderDetailsTable() {
  $('detailsHead').innerHTML = `<tr><th>Brand</th>${DETAIL_COLUMNS.map((column) => `<th>${column.label}</th>`).join('')}</tr>`;
  $('detailsRows').innerHTML = state.results.map((result) => `
    <tr class="${state.activeKey === resultKey(result) ? 'active-detail-row' : ''}">
      <td><strong>${result.brand}</strong></td>
      ${DETAIL_COLUMNS.map((column) => renderCell(result, column)).join('')}
    </tr>
  `).join('') || `<tr><td colspan="${DETAIL_COLUMNS.length + 1}" class="muted">Run QC to load batch details.</td></tr>`;
}

function resultKey(r) { return `${r.brand}:${r.code}`; }

function activeResult() {
  return state.results.find((r) => resultKey(r) === state.activeKey) || null;
}

function renderPills() {
  $('resultPills').innerHTML = state.results.map((r) => {
    const key = resultKey(r);
    return `<button class="pill ${state.activeKey === key ? 'active' : ''}" data-key="${key}">
      <strong>${r.brand}</strong>
      <code>${r.code}</code>
      <span class="chip ${verdictClass(r.verdict)}">${verdictLabel(r.verdict)}</span>
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
    btn.classList.toggle('primary', Boolean(data && state.selectedResults[key] === btn.dataset.result));
  });
  if (!data) {
    $('verdictPanel').className = 'verdict hidden';
    renderDetailsTable();
    return;
  }
  const panel = $('verdictPanel');
  panel.className = `verdict ${verdictClass(data.verdict)}`;
  $('verdictText').textContent = verdictWords(data.verdict, data.findings.length);
  $('mechanics').textContent = data.error ? `${data.error}: ${data.detail}` : data.mechanics;
  $('findings').innerHTML = data.findings.map((f, i) => `
    <div class="finding">
      <div><strong class="${f.severity === 'FAIL' ? 'issue' : 'review'}">${f.severity}</strong> ${f.message}</div>
      ${f.severity === 'FAIL' ? `<button data-fix-finding="${i}">Fix with Claude</button>` : ''}
    </div>
  `).join('') || '<div class="muted">No findings</div>';
  document.querySelectorAll('[data-fix-finding]').forEach((btn) => {
    btn.addEventListener('click', () => dispatchFindingFix(Number(btn.dataset.fixFinding)));
  });
  renderDetailsTable();
  $('passBtn').disabled = data.verdict !== 'SAFE';
}

function renderRun(results) {
  state.results = results;
  state.activeKey = results[0] ? resultKey(results[0]) : '';
  state.selectedResults = {};
  renderActiveResult();
}

async function runQc() {
  const codes = parseCodes();
  const brands = [...state.selectedBrands];
  if (!brands.length || !codes.length) return alert('Select at least one brand and enter one to five promo codes.');
  if (codes.length > 5) return alert('Run QC accepts at most 5 promo codes.');
  $('runQc').disabled = true;
  try {
    const batches = await Promise.all(brands.map((brand) =>
      api('/api/run-qc', { method: 'POST', body: JSON.stringify({ brand, codes }) })
        .then((data) => (data.results || []).map((r) => ({ ...r, brand })))
        .catch((e) => codes.map((code) => ({
          brand, code, verdict: 'NOT_SAFE', mechanics: '', findings: [{ severity: 'FAIL', check: 'run-qc-error', message: e.message }], details: {}, snapshotPath: '', duplicateRecent: null,
        })))
    ));
    renderRun(batches.flat());
  } finally {
    $('runQc').disabled = false;
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

function recordPayload(data) {
  const brand = state.brands.find((b) => b.id === data.brand);
  return {
    brand: data.brand,
    code: data.code,
    platform: brand?.runtime?.platform || '',
    region: brand?.runtime?.region || '',
    promoType: data.details?.promoType || '',
    result: state.selectedResults[resultKey(data)],
    findings: compactFindings(data),
    errorCategory: $('errorCategory').value,
    description: $('description').value,
    expected: $('expected').value,
    actual: $('actual').value,
    actionRequired: $('actionRequired').value,
    personResponsible: $('personResponsible').value,
    evidenceLink: $('evidenceLink').value,
    fetchSnapshot: data.snapshotPath || '',
    durationS: data.duration_s || '',
  };
}

async function saveRecord() {
  const data = activeResult();
  if (!data) return alert('Run QC before saving.');
  const key = resultKey(data);
  if (!state.selectedResults[key]) return alert('Choose a QC result for the active code first.');
  if (!confirm(`Save ${state.selectedResults[key]} for ${data.brand} ${data.code}?`)) return;
  const saved = await api('/api/qc-record', { method: 'POST', body: JSON.stringify(recordPayload(data)) });
  alert(saved.sheet.action === 'pending' ? `Saved locally; sheet pending: ${saved.sheet.error}` : 'Saved.');
  await loadHistory();
}

async function saveAll() {
  if (!state.results.length) return alert('Run QC before saving.');
  const missing = state.results.filter((r) => !state.selectedResults[resultKey(r)]).map((r) => `${r.brand} ${r.code}`);
  if (missing.length) return alert(`Choose a QC result for: ${missing.join(', ')}`);
  if (!confirm(`Save ${state.results.length} QC records?`)) return;
  const saved = await Promise.all(state.results.map((result) => (
    api('/api/qc-record', { method: 'POST', body: JSON.stringify(recordPayload(result)) })
  )));
  const pending = saved.filter((item) => item.sheet.action === 'pending').length;
  alert(pending ? `Saved ${saved.length} locally; ${pending} sheet writes pending.` : `Saved ${saved.length} records.`);
  await loadHistory();
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
  await navigator.clipboard.writeText(text);
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

async function loadHistory() {
  const h = await api('/api/history');
  state.historyRows = h.rows || [];
  $('historyRows').innerHTML = state.historyRows.map((r, i) => {
    const canFix = r.qc_result === 'FAIL' || r.qc_result === 'REQUIRES_REVIEW' || r.qc_result === 'REVIEW';
    return `
      <tr>
        <td>${r.timestamp || ''}</td>
        <td>${r.brand || ''}</td>
        <td><code>${r.code || ''}</code></td>
        <td>${r.qc_result || ''}</td>
        <td>${r.checked_by || ''}</td>
        <td>${canFix ? `<button data-history-fix="${i}">Fix with Claude</button>` : ''}</td>
      </tr>
    `;
  }).join('');
  document.querySelectorAll('[data-history-fix]').forEach((btn) => {
    btn.addEventListener('click', () => dispatchHistoryFix(Number(btn.dataset.historyFix)));
  });
}

function bind() {
  $('runQc').addEventListener('click', runQc);
  $('searchBtn').addEventListener('click', runQc);
  $('clearBtn').addEventListener('click', () => { resetCodeRows(); state.results = []; state.activeKey = ''; renderActiveResult(); });
  $('saveRecord').addEventListener('click', saveRecord);
  $('saveAll').addEventListener('click', saveAll);
  $('copySummary').addEventListener('click', copySummary);
  $('manualFix').addEventListener('click', dispatchManualFix);
  $('settingsBtn').addEventListener('click', () => {
    openUsersModal().catch((e) => alert(`Could not load admitted users: ${e.message}`));
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
      if (!data) return alert('Run QC before choosing a result.');
      state.selectedResults[resultKey(data)] = btn.dataset.result;
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

async function init() {
  bindSwitcher();
  bind();
  await ensureLogin();
  syncSettingsAccess();
  const returnTo = new URLSearchParams(location.search).get('return');
  if (ALLOWED_RETURN_PATHS.has(returnTo)) {
    location.replace(returnTo);
    return;
  }
  state.brands = (await api('/api/brands')).brands;
  renderBrands();
  await loadHistory();
}

init().catch((e) => {
  document.body.innerHTML = `<main><section><h1>Promo QC Hub</h1><p>${e.message}</p></section></main>`;
});

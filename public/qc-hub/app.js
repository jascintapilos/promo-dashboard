const state = {
  user: null,
  brands: [],
  selectedBrand: null,
  results: [],
  activeCode: '',
  selectedResults: {},
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

const CODE_BOX_IDS = ['promoCode1', 'promoCode2', 'promoCode3', 'promoCode4', 'promoCode5'];

function parseCodes() {
  return CODE_BOX_IDS
    .map((id) => $(id).value.trim().toUpperCase())
    .filter(Boolean);
}

function renderBrands() {
  $('brandGrid').innerHTML = state.brands.map((brand) => `
    <button class="brand ${state.selectedBrand === brand.id ? 'selected' : ''}" data-brand="${brand.id}" ${brand.enabled ? '' : 'disabled'}>
      <strong>${brand.label}</strong>
      <span>${brand.enabled ? brand.displayGroup : 'coming soon'}</span>
    </button>
  `).join('');
  document.querySelectorAll('.brand').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.selectedBrand = btn.dataset.brand;
      const brand = state.brands.find((b) => b.id === state.selectedBrand);
      for (const id of ['openBo', 'openModule']) {
        const el = $(id);
        const href = id === 'openModule' ? brand.moduleUrl : brand.baseUrl;
        el.href = href || '#';
        el.classList.toggle('disabled', !href);
      }
      renderBrands();
    });
  });
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
  $('detailsHead').innerHTML = `<tr>${DETAIL_COLUMNS.map((column) => `<th>${column.label}</th>`).join('')}</tr>`;
  $('detailsRows').innerHTML = state.results.map((result) => `
    <tr class="${state.activeCode === result.code ? 'active-detail-row' : ''}">
      ${DETAIL_COLUMNS.map((column) => renderCell(result, column)).join('')}
    </tr>
  `).join('') || `<tr><td colspan="${DETAIL_COLUMNS.length}" class="muted">Run QC to load batch details.</td></tr>`;
}

function activeResult() {
  return state.results.find((result) => result.code === state.activeCode) || null;
}

function renderPills() {
  $('resultPills').innerHTML = state.results.map((result) => `
    <button class="pill ${state.activeCode === result.code ? 'active' : ''}" data-code="${result.code}">
      <code>${result.code}</code>
      <span class="chip ${verdictClass(result.verdict)}">${verdictLabel(result.verdict)}</span>
    </button>
  `).join('');
  document.querySelectorAll('[data-code]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.activeCode = btn.dataset.code;
      renderActiveResult();
    });
  });
}

function renderActiveResult() {
  const data = activeResult();
  renderPills();
  document.querySelectorAll('[data-result]').forEach((btn) => {
    btn.classList.toggle('primary', Boolean(data && state.selectedResults[data.code] === btn.dataset.result));
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

function renderRun(data) {
  state.results = data.results || [];
  state.activeCode = state.results[0]?.code || '';
  state.selectedResults = {};
  renderActiveResult();
}

async function runQc() {
  const codes = parseCodes();
  CODE_BOX_IDS.forEach((id, i) => { $(id).value = codes[i] || ''; });
  if (!state.selectedBrand || !codes.length) return alert('Select a brand and enter one to five promo codes.');
  if (codes.length > 5) return alert('Run QC accepts at most 5 promo codes.');
  $('runQc').disabled = true;
  try {
    renderRun(await api('/api/run-qc', {
      method: 'POST',
      body: JSON.stringify({ brand: state.selectedBrand, codes }),
    }));
  } catch (e) {
    alert(e.message);
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
        brand: state.selectedBrand,
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
        brand: state.selectedBrand,
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
  const brand = state.brands.find((b) => b.id === state.selectedBrand);
  return {
    brand: state.selectedBrand,
    code: data.code,
    platform: brand?.runtime?.platform || '',
    region: brand?.runtime?.region || '',
    promoType: data.details?.promoType || '',
    result: state.selectedResults[data.code],
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
  if (!state.selectedResults[data.code]) return alert('Choose a QC result for the active code first.');
  if (!confirm(`Save ${state.selectedResults[data.code]} for ${state.selectedBrand} ${data.code}?`)) return;
  const saved = await api('/api/qc-record', { method: 'POST', body: JSON.stringify(recordPayload(data)) });
  alert(saved.sheet.action === 'pending' ? `Saved locally; sheet pending: ${saved.sheet.error}` : 'Saved.');
  await loadHistory();
}

async function saveAll() {
  if (!state.results.length) return alert('Run QC before saving.');
  const missing = state.results.filter((result) => !state.selectedResults[result.code]).map((result) => result.code);
  if (missing.length) return alert(`Choose a QC result for: ${missing.join(', ')}`);
  if (!confirm(`Save ${state.results.length} QC records for ${state.selectedBrand}?`)) return;
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
    `${state.selectedBrand} ${data.code}`,
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
  $('clearBtn').addEventListener('click', () => location.reload());
  $('saveRecord').addEventListener('click', saveRecord);
  $('saveAll').addEventListener('click', saveAll);
  $('copySummary').addEventListener('click', copySummary);
  $('manualFix').addEventListener('click', dispatchManualFix);
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
      state.selectedResults[data.code] = btn.dataset.result;
      renderActiveResult();
    });
  });
}

async function init() {
  bind();
  await ensureLogin();
  state.brands = (await api('/api/brands')).brands;
  renderBrands();
  await loadHistory();
}

init().catch((e) => {
  document.body.innerHTML = `<main><section><h1>Promo QC Hub</h1><p>${e.message}</p></section></main>`;
});

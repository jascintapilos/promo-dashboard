// Optional dashboard registration. POSTs a record of a canary run to the
// Apps Script web app so it shows up in the team's Promo Ops dashboard.
// Registration only — not approval-gated. The web app's doPost treats the
// payload as a guest submission and assigns a G-YYYY-NNNN ID.
//
// Configure via env var DASHBOARD_URL (the /exec URL of the deployed
// Apps Script web app). If not set, registration is silently skipped.

const DEFAULT_URL = process.env.DASHBOARD_URL || '';

export async function registerCanaryRun(payload, { url = DEFAULT_URL, timeoutMs = 10000 } = {}) {
  if (!url) {
    return { skipped: true, reason: 'DASHBOARD_URL not set' };
  }

  // The Apps Script doPost expects a JSON body with these fields. Shape it
  // up to look like a "guest submission" but tag the request_type so it's
  // distinguishable from real customer requests.
  const body = {
    requestor_name: 'Promo Ops Bot (canary)',
    requestor_email: payload.operator_email || 'bot@promo-ops.local',
    requestor_org: 'Promo Ops Automation',
    request_type: 'bo_write_canary',
    brand: payload.brand,
    title: `Canary write: ${payload.promo_code} on ${payload.brand}`,
    description: [
      `Request handle:  ${payload.handle}`,
      `Bonus type:      ${payload.bonus_type}${payload.bonus_sub_type ? ' - ' + payload.bonus_sub_type : ''}`,
      `Currencies:      ${(payload.currencies || []).join(', ')}`,
      `Locales:         ${(payload.locales || []).join(', ')}`,
      `Site:            ${payload.site_id}`,
      `Inherited from:  ${payload.inherited_from || '(none)'}`,
      '',
      'Fields the bot typed:',
      ...payload.typed_fields.map((f) => `  ${f.label}: ${f.value}`),
      '',
      'This is a CANARY RUN. The bot typed text/number fields only; an',
      'operator handled all dropdowns/checkboxes and clicked Save manually.',
    ].join('\n'),
    priority_hint: 'Medium',
    deadline_hint: '',
  };

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
      redirect: 'follow',
    });
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = { ok: res.ok, raw: text.slice(0, 500) }; }
    return { skipped: false, status: res.status, response: parsed };
  } catch (e) {
    return { skipped: false, error: e.message };
  } finally {
    clearTimeout(t);
  }
}

// Set a task's status on the Promo Ops dashboard.
//
// Uses the bo_status route added by APPS-SCRIPT-PATCH.md. Accepts either a
// task_id (T-…) or a request_ref (P###-r###) — handler resolves both.
// `status` may be a short name like "QC" or the full "QC_Required" value.
export async function setTaskStatus({ taskId, requestRef, status, notes }, { url = DEFAULT_URL, timeoutMs = 10000 } = {}) {
  if (!url) {
    return { skipped: true, reason: 'DASHBOARD_URL not set' };
  }
  if (!status) {
    return { skipped: false, error: 'status is required' };
  }
  if (!taskId && !requestRef) {
    return { skipped: false, error: 'taskId or requestRef is required' };
  }

  // The endpoint requires ?source=bo_status as a URL param.
  const target = url.includes('?') ? `${url}&source=bo_status` : `${url}?source=bo_status`;
  const body = {
    task_id: taskId || '',
    request_ref: requestRef || '',
    status,
    notes: notes || '',
  };

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(target, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
      redirect: 'follow',
    });
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = { ok: res.ok, raw: text.slice(0, 500) }; }
    return { skipped: false, status: res.status, response: parsed };
  } catch (e) {
    return { skipped: false, error: e.message };
  } finally {
    clearTimeout(t);
  }
}

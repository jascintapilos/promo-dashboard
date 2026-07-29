# R6 — Logout button on QC Hub and Ops Dashboard

**Status:** awaiting Codex review before implementation
**Context:** after R4 (BUILD_ID cache-busting) closed a CDN cache incident, the team asked for a logout control on both dashboards served by `bin/qc-dashboard.mjs`.

---

## Scope

Add a **Log out** button to both:
- **QC Hub** (`/`, served from `public/qc-hub/index.html`)
- **Ops Dashboard** (`/dashboard`, served from `public/dashboard.html`)

Clicking it must:
1. Invalidate the session cookie (browser-side) via `POST /auth/logout`
2. Redirect the user to `/` (which shows the login overlay again in production mode)
3. Leave both `/` and `/dashboard` requiring a fresh login afterward

**Server-side `/auth/logout` already exists in `bin/qc-dashboard.mjs`** (line ~168):
```js
if (req.method === 'POST' && url.pathname === '/auth/logout') {
  return send(res, 200, { ok: true }, { 'set-cookie': 'qc_hub_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
}
```
No server code change needed.

---

## Affected files (4 modified, 0 new)

### 1. `public/qc-hub/index.html`
Inside the existing `.topbar-actions` div (right side of header), append after `<span id="signedIn">`:
```html
<button id="logoutBtn" class="logout-btn" type="button">Log out</button>
<span id="logoutError" class="logout-error hidden" role="alert"></span>
```

### 2. `public/dashboard.html`
Inside the existing `.head-right` div, append the button + inline error span:
```html
<button id="logoutBtn" class="logout-btn" type="button">Log out</button>
<span id="logoutError" class="logout-error hidden" role="alert"></span>
```

Also append to the existing inline `<script>` block (which already holds the switcher toggle handler):
```js
(function bindLogout(){
  const btn = document.getElementById('logoutBtn');
  const errEl = document.getElementById('logoutError');
  btn.addEventListener('click', async () => {
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
})();
```

### 3. `public/dashboard-switcher.css`
Shared file — add styling matching the existing switcher aesthetic (same 34px height, same neutral palette, same focus treatment):
```css
.logout-btn {
  height: 34px;
  padding: 0 12px;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 12.5px;
  font-weight: 500;
  color: #5b6472;
  background: #ffffff;
  border: 1px solid #d9dee7;
  border-radius: 8px;
  cursor: pointer;
}
.logout-btn:hover:not(:disabled) { color: #171821; background: #f0f2f5; }
.logout-btn:focus-visible { outline: 2px solid #171821; outline-offset: 2px; }
.logout-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.logout-error { font-size: 11.5px; color: #b42318; padding: 0 4px; align-self: center; }
.logout-error.hidden { display: none; }
```

### 4. `public/qc-hub/app.js`
In `function bind()`, add the shared handler pattern (button/error refs, try/catch, inline error state):
```js
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
```

---

## Tests to add

Extend the existing `logout clears cookie` test in `test/qc-dashboard-routes.test.mjs` with ONE additional assertion (avoid duplicating what's already covered):

- After the logout response clears the cookie, a subsequent `GET /dashboard` without the cookie must return **302 to `/?return=%2Fdashboard`**.

This closes the loop from "cookie is cleared" → "gate blocks re-entry."

Route test assertion count increases; full test suite (`npm test`) still passes.

---

## Acceptance criteria

- [ ] Both dashboards show a visible `Log out` button in the top header area
- [ ] Click triggers `POST /auth/logout`. Success → redirect to `/`. Failure → button re-enables, inline error span (`#logoutError`) surfaces `Logout failed: <reason>` — no `alert()`.
- [ ] Session cookie is cleared in the browser (verify DevTools → Application → Cookies)
- [ ] After logout, `GET /api/me` returns 401 and `/` renders the SPA shell (production mode shows login overlay)
- [ ] After logout, `GET /dashboard` returns 302 → `/?return=%2Fdashboard`
- [ ] Focus-visible outline on keyboard tab
- [ ] Full test suite passes with the new assertion
- [ ] No new files. Only 4 modifications.
- [ ] Nothing staged or committed until user reviews the diff

---

## Verification commands

```bash
# Local test suite
npm test

# Live smoke after deploy
curl -sSI https://qc-dashboard.zoom66.xyz/api/me                # 401 before login
# (login via UI, get cookie)
curl -sSI -H "cookie: qc_hub_session=..." https://qc-dashboard.zoom66.xyz/api/me   # 200
curl -sSI -X POST -H "cookie: qc_hub_session=..." https://qc-dashboard.zoom66.xyz/auth/logout   # 200 + clear cookie
curl -sSI https://qc-dashboard.zoom66.xyz/dashboard             # 302 → /?return=%2Fdashboard
```

---

## Safety constraints (no negotiation)

- No changes to `admitted-users.json` or the auth allowlist model
- No server-side session revocation store (out of scope — cookie stays cryptographically valid until 8-hour expiry, but the browser deletes it on `Max-Age=0`)
- No CSS changes to individual dashboard styling — only the shared `dashboard-switcher.css` gains the `.logout-btn` block
- No dependency additions
- No new npm scripts or environment variables
- No changes to routing, session gate, or the /dashboard 302 flow
- Do not commit or push until user approves the diff

---

## Known limitation (documented, not fixed here)

The HMAC-signed cookie remains cryptographically valid on the server until its 8-hour `SESSION_MAX_AGE_MS` expiry, because we have no server-side revocation list. In practice this is not a problem because:
- Cookies are `HttpOnly` — client JS cannot read the value
- `Max-Age=0` tells the browser to delete the cookie immediately
- Nobody has a copy to replay it

If true server-side revocation is ever needed (e.g. compromised session), that's a separate feature and would require adding a session ID blocklist. Out of scope for R6.

---

## Release order reminder

- **R6** = this doc (logout only). Small, low risk.
- **R5** (Ops Dashboard restructure — Escalations→SOP, Utilization tab, more viz) — on hold, requirements pending.
- **R7** (QC Hub admin settings UI to manage `admitted-users.json`) — on hold, requirements pending.

Each release commits and deploys independently.

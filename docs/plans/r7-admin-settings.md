# R7 — Admin settings for allowlist management

**Status:** plan for review
**Context:** currently every allowlist change requires Jascinta to edit `admitted-users.json` in her local checkout, commit, and push. R7 puts that action inside the QC Hub UI so a designated admin can add or remove users from the web app.

---

## Two design options — pick one

### Option A — Fully self-serve (server writes to Bitbucket via API)

**Flow:** Admin opens Settings → adds an email → clicks Save → server commits `admitted-users.json` to Bitbucket via REST API → pipeline auto-deploys → new user can log in ~30s later.

**Pros:**
- Zero manual git steps for admin
- One click, one wait, done

**Cons:**
- Requires a Bitbucket **App Password** with `repository:write` scope on `aiodintech/qc-dashboard`
- Password stored as secured deployment variable `BITBUCKET_TOKEN`
- New attack surface: if the server is compromised, an attacker could push arbitrary code to `main`. Not trivial — server itself would need to be breached first — but broader blast radius than R6
- ~150 lines of new backend code + tests

**One-time setup Jascinta must do in Bitbucket:**
1. Personal settings → App passwords → Create app password
2. Label: "QC Dashboard allowlist writer"
3. Permissions: **Repositories → Write** only (no admin, no pipeline, no wiki)
4. Copy generated password
5. Repository settings → Deployments → `production` → Variables → Add secured variable `BITBUCKET_TOKEN` = the password
6. Also update `bitbucket-pipelines.yml` to forward `BITBUCKET_TOKEN` to the server via the SSH command (similar edit to the existing `ADMITTED_USERS_JSON` plan Tommy has already implemented, if that landed)

### Option B — Managed manual (no Bitbucket API — safer)

**Flow:** Admin opens Settings → edits allowlist in the modal → clicks "Get commit command" → modal shows the exact `admitted-users.json` contents + a shell command block to run. Admin pastes the file in her local checkout, commits via her existing workflow, pushes.

**Pros:**
- Zero new server capabilities, zero secrets, zero attack surface
- ~40 lines of new code
- Admin still uses the workflow she already knows (git commit + push → pipeline auto-deploys)

**Cons:**
- Not "fully self-serve" — admin has to do the commit step outside the UI
- Only saves her from remembering the exact JSON schema

**Recommendation:** **B** for MVP. If Jascinta wants A, it can layer on top of B later.

The rest of this plan describes Option B unless we explicitly switch. **Option A can be re-planned later once Bitbucket token / pipeline plumbing is confirmed with Tommy.**

---

## Schema change (both options)

Current `admitted-users.json`:
```json
{ "emails": ["...", "..."] }
```

Extended `admitted-users.json`:
```json
{
  "users": [
    { "email": "waiyip@thebrandingpeople.co", "role": "admin" },
    { "email": "jascinta.pilos@thebrandingpeople.co", "role": "admin" },
    { "email": "booninn.wang@thebrandingpeople.co", "role": "promo-team" }
  ]
}
```

Roles: `admin` | `promo-team` | `hod-view` | `guest` (unused for now; only `admin` and `promo-team` matter until R5).

**Backward compatibility:** `src/qc-dashboard/auth.js` keeps supporting the old `{"emails":[...]}` shape — reads either form, defaults role to `promo-team` if only email is present. This means the migration is non-breaking: `admitted-users.json` can be replaced in-place at any time.

**Validation adjusted:** `validateAllowlist()` accepts either shape; asserts at least one entry with a valid email; roles default to `promo-team` when absent. Continues fail-closed startup if the file is missing/malformed.

---

## Server changes

### `src/qc-dashboard/auth.js`

- **Export** `loadAdmittedUsers()` — new helper. Reads `admitted-users.json` and normalises to `[{email, role}]` regardless of file shape (either `{"emails":[...]}` or `{"users":[{email,role},...]}`). For each entry:
  - `email = String(rawEmail).trim().toLowerCase()`
  - `role = String(rawRole || 'promo-team').trim().toLowerCase()`
  - If `role` is not one of `admin`, `promo-team`, `hod-view`, `guest` → **default to `promo-team`** and log a `console.warn` with the offending role. Never keep arbitrary role strings.
  - Skip entries with empty email (fail-safe filter)
- Old shape (`{"emails":[]}`) → every entry gets `role: 'promo-team'`.
- Deduplicate on email; last entry wins if roles differ.
- `validateTokenData()` returns `{email, name, role}` — resolve role by looking up the matched email in the loaded allowlist.
- `validateAllowlist()` — calls `loadAdmittedUsers()` and asserts result is non-empty; still fail-closed on missing/malformed/empty.
- Dev-mode identity: `email = process.env.DEV_USER_EMAIL || 'dev@localhost'`, `role = process.env.DEV_USER_ROLE || 'admin'` (default admin so dev sessions can exercise the admin UI without extra env vars). **`DEV_USER_ROLE` is a dev/test-only convenience; never referenced in production paths and never set on prod deploys.**

### `bin/qc-dashboard.mjs`

- `/api/me` response gains a `role` field: server returns `{ user: { email, name, role } }`.
- **New endpoint** `GET /api/admin/users` — sits **after** `requireSession()`, then explicit role check: if `user.role !== 'admin'` → 403. Returns `{ users: [{email, role}, ...] }` from the currently-loaded allowlist. Read-only. No POST/PUT/DELETE — the modal only generates a copy-paste JSON for the admin's manual git commit.
- No changes to `/api/config` — it stays public and unchanged. **Do not expose the users list via /api/config under any condition.**

### Tests — hit the real parser via the exported helper

Existing auth tests currently simulate normalization locally (`test/qc-dashboard-auth.test.mjs:16-20` — `normalizeAllowlist(raw)`). Replace those with tests that import and call `loadAdmittedUsers()` against temp files (same subprocess-tempdir pattern as `validateAllowlist` tests in `test/qc-dashboard-hardening.test.mjs`).

**In `test/qc-dashboard-auth.test.mjs`:**
- `loadAdmittedUsers()` parses `{"emails":[...]}` → every entry `role: 'promo-team'`
- Parses `{"users":[{email,role},...]}` → roles preserved
- Missing role → defaults to `promo-team`
- Invalid role (e.g. `"superuser"`, `"ROOT"`) → coerced to `promo-team` with warning
- Trim + lowercase applied on both email and role
- Duplicate emails collapse; last entry's role wins
- Empty-after-normalization list still throws

**In `test/qc-dashboard-hardening.test.mjs`:**
- `validateAllowlist()` accepts `{"users":[{email,role}]}` shape (add subprocess-tempdir case)
- Empty `users` array → fails startup same way as empty `emails`
- Malformed entry (non-object, missing email) → filtered or fails cleanly

**In `test/qc-dashboard-routes.test.mjs`:**
- `GET /api/me` returns `role` field
- `GET /api/admin/users` unauthenticated → 401
- `GET /api/admin/users` as promo-team (dev mode with `DEV_USER_ROLE=promo-team`) → 403 with clear message
- `GET /api/admin/users` as admin (default dev-mode role) → 200 with `{users: [...]}`

---

## Frontend changes (Option B)

### `public/qc-hub/index.html`
Add settings gear button + modal near the existing prompt modal (bottom of `<body>`):

```html
<!-- topbar (only admins see this) -->
<button id="settingsBtn" class="settings-btn hidden" type="button" aria-label="Manage users">⚙</button>

<!-- modal -->
<div id="usersModal" class="modal-overlay hidden" role="dialog" aria-modal="true" aria-labelledby="usersTitle">
  <div class="modal-box modal-box-lg">
    <h2 id="usersTitle">Admitted users</h2>
    <p class="muted">Manage who can sign in. Edits here generate a commit-ready snippet — you push it as usual.</p>
    <table id="usersTable"></table>
    <form id="usersAddForm">
      <input id="userEmailInput" placeholder="email@thebrandingpeople.co" required>
      <select id="userRoleInput">
        <option value="promo-team">Promo team</option>
        <option value="admin">Admin</option>
        <option value="hod-view">HOD view</option>
        <option value="guest">Guest</option>
      </select>
      <button type="submit">Add</button>
    </form>
    <pre id="usersJson" class="prompt-text"></pre>
    <div class="modal-actions">
      <button id="usersCopyBtn" class="primary" type="button">Copy JSON</button>
      <button id="usersCloseBtn" class="secondary" type="button">Close</button>
    </div>
  </div>
</div>
```

### `public/qc-hub/app.js`
- After `ensureLogin()` sets `state.user` with `role`, un-hide `#settingsBtn` iff `state.user.role === 'admin'`
- Bind `#settingsBtn` click → fetch `/api/admin/users` → populate modal → open
- **Table rows built via DOM APIs, not `innerHTML`.** Use `document.createElement('tr')`, `.textContent = email`, `.textContent = role` for cells. This avoids any XSS risk from allowlist content.
- Add form appends to a local mutable array; remove buttons splice from it; both re-render the table (using DOM APIs) and update `#usersJson.textContent = JSON.stringify({users: [...]}, null, 2)`. Never `innerHTML` on user-supplied data.
- Copy button uses `navigator.clipboard.writeText(document.getElementById('usersJson').textContent)`.

**XSS rule:** the modal must never use `innerHTML` for any value derived from the allowlist (email, role). Only static labels, buttons, and the `<pre>` JSON preview (via `textContent`) are permitted. This is stricter than the rest of `app.js` (which uses `innerHTML` for verdict tables via `escapeHtml()`) because the admin modal handles auth-sensitive data.

### `public/qc-hub/styles.css`
- `.settings-btn` — matches switcher aesthetic (34px, neutral, hidden by default)
- `.modal-box-lg` — wider modal for the user table

---

## Access control matrix

| Role | QC Hub | Ops Dashboard | `/api/admin/users` | Settings gear visible |
|---|---|---|---|---|
| `admin` | ✅ | ✅ | ✅ | ✅ |
| `promo-team` | ✅ | ✅ | ❌ 403 | ❌ |
| `hod-view` | ✅ (read-only later) | ✅ | ❌ 403 | ❌ |
| `guest` | ❌ 403 (later) | ✅ | ❌ 403 | ❌ |

**In R7, only `admin` vs `not-admin` *authorization* matters.** Roles are always **preserved as stored** — both in `admitted-users.json` and in the `role` field returned by `/api/me`. What R7 does not add is any authorization *difference* between `promo-team`, `hod-view`, and `guest` — every non-admin sees the same routes and endpoints. R5 later enforces the guest/hod-view distinction without needing a data migration.

(Full test coverage is specified in the Server changes section above under **Tests — hit the real parser via the exported helper**. That subsection is authoritative; there is deliberately no separate "Tests to add" block here to keep in sync.)

---

## Acceptance criteria

- [ ] `admitted-users.json` supports both old and new shape (migration not forced)
- [ ] Server exposes user role on `/api/me`
- [ ] `GET /api/admin/users` returns 401/403 for non-admins, 200 for admins
- [ ] Settings gear appears only for admins in QC Hub topbar
- [ ] Modal shows current allowlist + add/remove UI
- [ ] Copy button produces valid JSON matching the extended schema
- [ ] Admin's manual commit + push of that JSON survives auto-deploy
- [ ] Full test suite passes (currently 145 files; adds internal assertions)
- [ ] No changes to `bitbucket-pipelines.yml`
- [ ] No new secrets or production env vars (`DEV_USER_ROLE` is dev-mode-only and documented as such — see Safety constraints)
- [ ] Never expose users list via `/api/config` or any other unauthenticated route
- [ ] Admin modal renders emails and roles via `textContent` / DOM APIs — no `innerHTML` on allowlist data
- [ ] Invalid roles in `admitted-users.json` coerce to `promo-team` with a `console.warn`, never persisted as-is

---

## What R7 does NOT do

- **Does not write back to Bitbucket.** (Would be Option A.)
- **Does not enforce `guest` / `hod-view` in the app.** Roles are recorded but only `admin` vs not is actioned.
- **Does not add nav gating** — `/dashboard` still accessible to any authenticated user regardless of role.
- **Does not migrate the current `admitted-users.json` file.** It stays in the old shape until Jascinta chooses to update it.

R5 later can enforce guest/hod-view.

---

## Safety constraints (no negotiation)

- No new npm dependencies
- No new secrets, tokens, or **production** env vars. `DEV_USER_ROLE` is a dev-mode-only convenience for running the admin UI locally without a real Google session; not read outside `AUTH_MODE=dev` code paths; never surfaced in deploy or pipeline docs
- No changes to the deploy pipeline (`bitbucket-pipelines.yml`)
- No auto-commit to Bitbucket from the server. Admin modal generates a JSON snippet the admin copy-pastes into their local `admitted-users.json` and pushes via their existing git workflow
- Modal renders emails/roles via `textContent` and DOM APIs only — no `innerHTML` on allowlist data (XSS defense in depth)
- No changes to `/api/config`, `/auth/logout`, session cookie shape, or existing route gates
- Users list only reachable via authenticated + admin-gated `GET /api/admin/users`
- Invalid roles in the file coerce to `promo-team` with `console.warn`; never preserved as-is (defense against silent privilege escalation via typos)
- Startup validation still fails closed on missing / malformed / empty allowlist
- Full test suite must pass before commit; nothing pushed until user approves the diff

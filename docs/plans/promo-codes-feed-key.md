# Promo Codes — dedicated upload key (replaces use of the QC relay secret)

**Drafted:** 2026-10-16 · **Branch:** `feat/promo-codes-feed-key` · **Status:** SUPERSEDED 2026-10-19 — built and merged, then removed. The upload no longer needs any key: the VDI writes the list to the Ops sheet and the server reads it (see `docs/plans/promo-codes-tab.md`, "Data path (current)").
**Context:** `docs/plans/promo-codes-tab.md` (tab is live, showing "No data yet"). Its daily upload was
designed to sign with the QC relay secret over `/api/relay/promo-codes/dataset`. That is withdrawn:
the relay secret can also lease QC jobs and submit QC verdicts, is shared, and can't be revoked per machine.
The relay secret was never requested, copied or used — no upload has ever run.

## Goal

The Promo Codes daily upload gets its **own** key that can do exactly one thing — replace the Promo Codes
snapshot — and nothing else. Rotating it cuts off the uploader without touching the QC relay.

## Design

### 1. Feed key store (new) — `src/qc-dashboard/promo-codes-feed-secret.js`
Clone of `relay-secret-store.js`'s shape, fully separate:
- File: `data/promo-codes-feed-secret.local.json` (gitignored by `*.local.json`), override `PROMO_CODES_FEED_SECRET_FILE`.
- Optional IT override env `PROMO_CODES_FEED_SECRET` (env wins, rotate → `EXTERNALLY_MANAGED` 409), same as relay.
- `rotateFeedSecret({ actorEmail })`: `crypto.randomBytes(32)` hex, atomic tmp+rename, mode 0600, returns value **once**.
  Records `rotatedAt` / `rotatedBy`. Read fresh per request → the old key stops working the instant it is rotated.
- `readFeedStatus()`: `{ configured, source, lastRotatedAt, lastRotatedBy }` — never the value.
- **Separation guard:** if the feed key ever equals the QC relay secret, the feed is treated as *not configured*
  (fail closed) and rotate regenerates. (Astronomically unlikely; makes the "keys are distinct" rule enforced, not assumed.)
- No invalidation hooks into the relay job store / heartbeats — rotating the feed key touches nothing QC.

### 2. Admin routes (new, in `bin/qc-dashboard.mjs`, cloned from the relay-secret rotate handler)
- `POST /api/admin/promo-codes-key/rotate` — admin role + `_verifySameOrigin`, body-less, `cache-control: no-store`,
  logs only "rotated by X at T". Returns the value once.
- `GET /api/admin/promo-codes-key` — admin-only status (configured / last rotated / last upload received / last upload ok) — never the value.

### 3. Ingest route (new) — `POST /api/promo-codes/snapshot`
- Dispatched before the session gate; **no session, no cookie** — HMAC only.
- Reuses `readRawBodyBounded` (8 MB cap) + `verifySignedRequest` + the `x-relay-*` header scheme from `relay-auth.js`
  (timestamp ±60 s, single-use nonce, signature over method + path + raw-body hash), with `secret = feed key`.
- Write-only: response is `{ ok, status }` (row count, timestamps) — never returns code data.
- Same validator/store as today (`validatePromoCodesPush` / `applyPromoCodesPush`).
- Generic 401 on any auth failure (no reason leaked), 503 when no feed key is configured.

### 4. Remove the relay-signed route
- Delete `POST /api/relay/promo-codes/dataset` and its body-cap entry. After this, the QC relay secret has
  **no** path to write Promo Codes data.

### 5. Strict separation (tested both ways)
- Feed-key-signed request to `/api/relay/jobs/lease`, `/api/relay/jobs/:id/result`, `/api/relay/ops/dataset/*` → 401.
- Relay-secret-signed request to `/api/promo-codes/snapshot` → 401.
- `/api/relay/promo-codes/dataset` → no longer exists (relay-signed → 404/400, never stored).

### 6. VDI uploader — `bin/push-promo-codes.mjs`
- Reads the key from env `PROMO_CODES_FEED_SECRET` or `%USERPROFILE%\.qc-relay\promo-codes-secret` (new, own reader in the
  feed-secret module). **Never** imports `readWorkerRelaySecret` or reads `relay-secret` (enforced by a test that checks the source).
- Posts to `/api/promo-codes/snapshot`. Failure marker (`ok:false`) unchanged.

### 7. Provisioning (no chat, ever)
New admin-only page **`/admin/promo-codes-key`** (linked from Manage Users): shows status and a **Generate new key** button.
On generate it shows the key once and offers **Download key file** (saves a file named `promo-codes-secret`).
The admin does this **in a browser on the VDI** (at the desk or via remote session) and saves the file to
`C:\Users\vdiuser\.qc-relay\promo-codes-secret`. The value never goes through Slack/email/chat or to Claude.
**Revoke:** press Generate again (or delete `data/promo-codes-feed-secret.local.json` on the server) → Gaby's uploader is cut off; QC relay unaffected.

## Files

New: `src/qc-dashboard/promo-codes-feed-secret.js`, `public/admin-promo-codes-key.html`,
`test/qc-dashboard-promo-codes-feed-secret.test.mjs`, `test/qc-dashboard-promo-codes-feed-routes.test.mjs`.
Edited: `bin/qc-dashboard.mjs` (add 3 routes, remove the relay-signed one), `bin/push-promo-codes.mjs` (key source + URL),
`public/admin-users.html` (one link), `test/qc-dashboard-promo-codes-routes.test.mjs` (push via new route),
`docs/plans/promo-codes-tab.md` (point here).

**Not touched:** `relay-auth.js`, `relay-secret-store.js`, the QC relay worker, `/api/relay/*` QC/ops routes, the relay
secret itself, any QC or promo logic. (Note: the feed route shares `relay-auth.js`'s in-memory nonce cache by calling
`verifySignedRequest` as-is; nonces are 128-bit random so this is harmless, and it avoids editing `relay-auth.js`.)

## Acceptance criteria

1. Feed-key-signed snapshot → 200 and the tab shows data; tampered body / stale timestamp / replayed nonce → 401.
2. Feed key rejected on every `/api/relay/*` route; relay secret rejected on `/api/promo-codes/snapshot`.
3. Rotate returns the key once (no-store); status never contains it; old key → 401 immediately after rotate; relay routes unaffected.
4. Rotate/status are admin-only and same-origin-checked; non-admins → 403.
5. Uploader source contains no reference to `relay-secret` / `readWorkerRelaySecret`.
6. No feed-key file or value in git; full `npm test` passes.

## Verification

```
node --check bin/qc-dashboard.mjs bin/push-promo-codes.mjs src/qc-dashboard/promo-codes-feed-secret.js
node --test test/qc-dashboard-promo-codes-feed-secret.test.mjs test/qc-dashboard-promo-codes-feed-routes.test.mjs test/qc-dashboard-promo-codes-routes.test.mjs
npm test
```

## Rollout (each step on Gaby's go)

1. Build + test on `feat/promo-codes-feed-key`, show diff, push branch + PR (no deploy).
2. Merge → deploys.
3. An admin (Jascinta) opens `/admin/promo-codes-key` in a browser **on Gaby's VDI**, generates the key, saves the file.
4. First upload: `node bin/push-promo-codes.mjs`; check the tab; then enable the 9 AM scheduled task.

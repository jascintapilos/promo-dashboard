# BO Relay — VDI outbound polling for company Hub

**Status**: implemented (Increments 1-5), UI polling still to land. Nothing deployed.

## Why this exists
The company-hosted QC Hub (`qc-dashboard.zoom66.xyz`) sits behind Cloudflare + a WAF that blocks outbound BO probes with HTTP 403. The whitelisted VDI has working BO credentials + working readonly clients + local `captures/` bundles. The relay lets the Hub run automatic live comparisons **without any WAF / firewall change** by having the VDI poll the Hub for pending jobs over HTTPS.

The Hub itself never opens an inbound connection to the VDI.

## Architecture (implemented)
```
Browser (operator)                Company Server (qc-dashboard)                 VDI (this workstation)
──────────────────                ───────────────────────────                    ─────────────────────
POST /api/run-qc  ─────────────►  preflight brand                                     │
                                    ├─ READY   → direct-fetch, no relay              │
                                    ├─ BO_UNREACHABLE / AUTH_EXPIRED /               │
                                    │  CONFIG_MISSING + MVP brand + relay-secret     │
                                    │    → createJob({brand,code,handle,requestedBy})│
                                    └─ else    → MANUAL_REQUIRED (no relay)          │
                                                                                     │
                                  ◄──── HMAC POST /api/relay/jobs/lease  ────────────┤
                                  ────► [{jobId,brand,code,handle,leaseExpiresAt}]  │
                                                                                     │  fetchPromoSnapshot(brand,code)   ← existing readonly-client + credentials
                                                                                     │  resolveExpectedSource(brand,code,handle)  ← existing, reads local captures
                                                                                     │  expectedFromSource + liveFromPlatform      ← existing adapters
                                                                                     │
                                  ◄──── HMAC POST /api/relay/jobs/:id/result ─{sanitized payload}
                                                                                     │
                                    run runComparisonFromRelay()  (re-derives verdict, never trusts worker)
                                    recordRun() → finalRunId
                                    attachFinalRunId(jobId, finalRunId)

GET /api/qc-jobs/:id  ────────►  ownership check (owner or admin)
                              ◄── safeJobForClient(job)          ← never leaks requestedBy, leasedBy, sourcePath
```

**Trust boundary**: the VDI is the only host with BO credentials and captures. The Hub sees ONLY canonical-shaped fields + safe source metadata + hashes. The Hub re-derives the verdict from that payload — the worker's own claim is discarded.

## Files added / modified

| Kind | File | Purpose |
|---|---|---|
| new src | `src/qc-dashboard/relay-auth.js` | HMAC-SHA256 raw-body signer + verifier, timing-safe, replay guard, secret readers |
| new src | `src/qc-dashboard/relay-job-store.js` | in-memory job store with ownership binding + safe projection |
| new src | `src/qc-dashboard/relay-result.js` | sanitizer allowlist for the worker payload |
| new src | (extended) `src/qc-dashboard/compare-flow.js` | `runComparisonFromRelay()` — server-side verdict re-derivation |
| new bin | `bin/qc-bo-relay-worker.mjs` | polling worker: signed lease + submit, structured logs, bounded backoff, graceful shutdown |
| new bin | `bin/qc-bo-relay-worker.bat` | Windows startup wrapper (contains **no** secret) |
| new tests | `test/qc-dashboard-relay-auth.test.mjs` | 21 tests — HMAC + replay + secret validation |
| new tests | `test/qc-dashboard-relay-job-store.test.mjs` | 25 tests — leasing, ownership, restart-safe |
| new tests | `test/qc-dashboard-relay-result.test.mjs` | 21 tests — sanitizer + server-re-derives-verdict |
| new tests | `test/qc-dashboard-relay-routes.test.mjs` | 13 route tests — attack matrix + mixed-batch |
| new tests | `test/qc-dashboard-relay-worker.test.mjs` | 14 worker tests — error paths, backoff, log scrubbing |
| modified | `bin/qc-dashboard.mjs` | relay routes + enqueue in `/api/run-qc`, `/api/admin/relay-health`, preflight-cache invalidation on overlay write |

**Route surface**:
- `POST /api/run-qc` — retains existing shape. Queued codes have `{jobId, status: 'QUEUED', verdict: null}`; direct-fetch codes retain full verdict. Response is a mixed batch of up to 5.
- `POST /api/relay/jobs/lease` — HMAC. Returns up to 5 leased jobs. Worker never sees `requestedBy`.
- `POST /api/relay/jobs/:jobId/result` — HMAC. Idempotent. Server re-derives the verdict.
- `GET /api/qc-jobs/:jobId` — session-gated. 404 for non-owner (no id-guess enumeration). Admin sees any job.
- `GET /api/admin/relay-health` — session-gated admin. Shows `{relaySecretConfigured, jobs:{counts}, workers:[{workerId,lastSeenAt,ageSeconds,offline}]}`. No PII.

## Wire protocol — HMAC on raw bytes
Canonical string:
```
METHOD\nPATH\nTIMESTAMP\nNONCE\nSHA256(rawBody)_hex
```
Required headers:
```
X-Relay-Timestamp   unix ms integer, ±60 000 ms skew
X-Relay-Nonce       ≥ 16 hex chars (32-byte random hex recommended)
X-Relay-Signature   HMAC-SHA256 hex (64 chars, timing-safe compare)
X-Relay-Worker      opaque worker id (heartbeat / logs only — non-authoritative)
```
Verification happens **before** JSON parse. Body size cap is **64 KB**. Result payload size cap is **32 KB**.

## Verdict decision matrix (correction brief §1, §5)
| Preflight status | Brand valid + enabled? | Relay configured? | Outcome |
|---|---|---|---|
| READY | — | — | direct fetch (unchanged) |
| BO_UNREACHABLE | ✓ | ✓ | enqueue relay job |
| AUTH_EXPIRED | ✓ | ✓ | enqueue relay job |
| CONFIG_MISSING | ✓ | ✓ | enqueue relay job |
| PARTIAL_DATA (or any other non-relayable state) | ✓ | ✓ | MANUAL_REQUIRED (relay wouldn't help) |
| Any relayable state | ✓ | ✗ (no secret) | MANUAL_REQUIRED with "relay not configured" note |
| Any | ✗ (NOT_ENABLED / unknown brand) | — | 400 at entry — never relayed |
| Direct fetch → `snapshot.notFound` | — | — | NOT_SAFE (never fall back to relay to overwrite a confirmed not-found) |
| Direct fetch → genuine FAIL verdict | — | — | NOT_SAFE (never fall back to relay to erase a real FAIL) |
| Relay result → incomplete evidence | — | — | MANUAL_REQUIRED |
| Relay result → BO_UNREACHABLE from VDI | — | — | MANUAL_REQUIRED |
| Relay result → CODE_NOT_FOUND on VDI | — | — | MANUAL_REQUIRED |
| Relay result → EXPECTED_SOURCE_MISSING / _AMBIGUOUS | — | — | MANUAL_REQUIRED |
| Relay job timeout (2 min) | — | — | MANUAL_REQUIRED (client-side timeout) |
| Server restart mid-flight | — | — | jobId resolves NOT_FOUND on next poll → MANUAL_REQUIRED |

Automatic PASS is impossible from any of these paths.

## Secret provisioning — self-service (no tech-team required)

**Company server** reads the secret from, in order:
1. `RELAY_SECRET` environment variable (only if IT explicitly sets one), then
2. `data/relay-secret.local.json` — admin-managed, matches the `*.local.json`
   gitignore pattern, never in the repo.

The admin manages the file **entirely through the QC Hub UI**:

1. Sign in as an admin, open the topbar `🔧 Site configs` modal.
2. Scroll to the **BO Relay key** section.
3. Click **Generate / Rotate Relay Key**. Confirm the prompt.
4. The one-time reveal modal opens with the value. Click **Copy to Clipboard**.
5. On the VDI, open Notepad and paste the value into
   `%USERPROFILE%\.qc-relay\relay-secret` (one line, no trailing newline, no extension).
   Save.
6. On the VDI, run (or restart) `bin\qc-bo-relay-worker.bat`.
7. Back in the admin modal, the status line shows `✓ Configured — last rotation <time> by <admin email>`.

**Server-side guarantees** (all test-locked):
- POST `/api/admin/relay-secret/rotate` requires admin role + same-origin (Origin/Referer must match Host) + valid session — no CSRF path.
- Generation uses `crypto.randomBytes(32)` (32 bytes of OS-random hex → 64 chars).
- Response carries `Cache-Control: no-store` + `Pragma: no-cache`.
- Secret is returned exactly once. No other endpoint (`/api/config`, `/api/me`, `/api/admin/relay-health`) ever returns it.
- Log line on rotate: `[relay-secret] rotated by <email> at <timestamp>` — no value, no shape.
- Rotation clears all pending relay jobs + worker heartbeats — old worker HMACs fail with `BAD_SIGNATURE` on the next request.
- Persistence survives server restart. Old key never survives rotation.
- If neither env nor file is present, `/api/run-qc` codes that would relay resolve to MANUAL_REQUIRED with a note pointing the admin to the panel.

**Nothing outside the QC Hub UI + Notepad + the batch script is required.** No SSH, no sudo, no systemd editing, no Ansible edit, no IT ticket.

### Production persistence (§2 of pre-deploy checks)

The `data/relay-secret.local.json` file follows the exact same pattern the R18-lite admin overlay uses today (`data/bo-sites-runtime.json`) — that's already proven in production because admins have been writing site overlays through the UI since R18. Specifics that match the corrected checklist:

- **Survives git pull / deploy / restart** — the file is in `data/`, gitignored by both the general `*.local.json` rule and an explicit `data/relay-secret.local.json` line. The Bitbucket → Ansible deploy on `build.sgrts.com` runs `git pull` in-place (proven by R18: `data/bo-sites-runtime.json` survives every deploy).
- **Writable by the service account** — same directory, same 0600 mode, same `writeFileSync` path as `writeRuntimeOverlay`. Whatever user runs `node bin/qc-dashboard.mjs` writes it and reads it.
- **Never in build artifacts / Git** — the `.gitignore` has two lines guarding it (`*.local.json` + `data/relay-secret.local.json`) plus a `data/relay-secret.local.json.tmp-*` line for atomic-write leftovers. `git check-ignore data/relay-secret.local.json` returns the pattern.
- **Restrictive permissions** — `writeFileSync(..., {mode: 0o600})` + explicit `chmodSync(file, 0o600)` after `renameSync`. POSIX honours mode; Windows ignores it but the equivalent NTFS ACL is inherited from the parent (`data/`) which is already restricted to the service user.
- **Atomic write** — `writeFileSync(tmp, ...)` then `renameSync(tmp, file)`. If Node crashes mid-write, the original file (or absence) is preserved — never a truncated JSON.

If Ansible ever switches to a fresh-clone pattern in the future, this file would be wiped alongside `data/bo-sites-runtime.json`, and admins would notice both (site overlay + relay key). The two share the same fate by design.

### Environment-variable precedence (§3)

`RELAY_SECRET` env-var, when set on the server, still takes precedence for the *effective* secret used by HMAC verification. That's for IT's benefit when they want an operational override. But the admin UI must not pretend a Rotate click had effect in that state:

- `readStatus()` returns `source: 'env'` and no rotation metadata.
- `POST /api/admin/relay-secret/rotate` returns **`409 EXTERNALLY_MANAGED`** without writing the file.
- The admin panel status line reads: `✓ Configured — source: RELAY_SECRET environment variable (externally managed; rotate at the source)`.
- The **Generate / Rotate** button is disabled with a tooltip explaining why.

Regression test: `test/qc-dashboard-relay-secret-store.test.mjs` "rotate: refuses when RELAY_SECRET env is set" + `test/qc-dashboard-relay-rotate-route.test.mjs` "env-precedence: rotate returns 409 EXTERNALLY_MANAGED".

### Rotation invalidation (§4)

Every rotate:
1. Clears pending / leased jobs in the in-memory job store.
2. Clears worker heartbeats (health shows `workers: 0` until the worker re-signs).
3. Clears the replay-nonce cache.
4. Old worker HMAC signed with the previous key → 401 on the very next request.
5. Persisted new key survives a server restart (proven by the `persistence:` route test).

## Post-deployment acceptance + rollback checklist

**Acceptance (after deploy, before scheduling the VDI task):**
1. Admin signs in to production QC Hub → 🔧 Site configs → BO Relay key section shows `✗ Not configured`.
2. Click **Generate / Rotate Relay Key** → one-time modal displays a 64-char hex value.
3. Copy → paste into VDI `%USERPROFILE%\.qc-relay\relay-secret`.
4. Run `bin\qc-bo-relay-worker.bat` in a VDI terminal for smoke.
5. Admin panel status flips to `✓ Configured — last rotation <time> by <email>`.
6. Admin health page shows `workers: 1, offline: false, ageSeconds < 15`.
7. Operator runs QC on a known-good WS1_MY promo (`FT_RET_CRM_CHURN_68FS_10X_040_GOO_GLD`, handle `P133-r135`):
   - Expect verdict **SAFE** with a `finalRunId` that came from the relay path.
   - Verify same verdict against the direct-VDI baseline from earlier acceptance.
8. Operator runs one known-mismatch code (any QPRO5 promo where source and live diverge on `valuePerSpin` or `minDeposit`):
   - Expect verdict **NOT_SAFE** with a `compare` block populated by the relay.
9. Stop the VDI worker via Task Manager. Wait ~2 min.
10. Rerun the same QC on QP2A → expect verdict **MANUAL_REQUIRED** with `check: relay-timeout`.
11. Restart the worker via `bin\qc-bo-relay-worker.bat` (or Task Scheduler action → Run).
12. Verify a subsequent QC completes normally again.
13. Only after these 12 steps pass, register the Task Scheduler entry (`General → Run only when user is logged on`; `Triggers → At log on, delay 30s`; `Actions → bin\qc-bo-relay-worker.bat`).

**Rollback (if anything above misbehaves):**
1. Stop the VDI worker (Task Scheduler → End). Automatic QC reverts to the pre-relay MANUAL_REQUIRED behavior for BO_UNREACHABLE codes; direct-fetch for reachable codes.
2. On the server, revert this feature's single commit — do **not** revert a range:
   ```bash
   # find the commit hash by title
   git log --oneline --grep='feat: add secure BO relay for QC Hub'
   # then revert exactly one commit
   git revert <that-hash>
   ```
   The relay routes disappear; the direct-fetch / MANUAL_REQUIRED paths are untouched.
3. Delete `data/relay-secret.local.json` on the server if you want to force `Not Configured` in the UI even before a revert.
4. In either case, the Manual Pass Override flow continues to work exactly as it does today.


## Task Scheduler setup (Windows, run at login)
1. Save the ≥ 32-byte secret to `%USERPROFILE%\.qc-relay\relay-secret` (no extension). Do **not** paste it anywhere else.
2. Open Task Scheduler → Create Task…
   - **General** — Name: `QC BO Relay`. Run only when user is logged on. Do not check "Run with highest privileges".
   - **Triggers** — New… At log on → the current user. Delay 30 seconds.
   - **Actions** — New… Start a program → `<repo>\bin\qc-bo-relay-worker.bat`. Start-in: `<repo>`.
   - **Conditions** — uncheck "Start the task only if the computer is on AC power".
   - **Settings** — Allow task to be run on demand; If the task fails, restart every 1 minute up to 3 times; If the running task does not end when requested, force it to stop.
3. Save. The worker logs to stdout — pipe it through the Task Scheduler's own history for auditing.

When the VDI is logged out or the worker is stopped, `/api/admin/relay-health` shows the worker `offline: true`, and every new BO_UNREACHABLE-triggered QC run resolves to **MANUAL_REQUIRED** after the 2-min job TTL. Automatic QC is unavailable during that window — this is by design.

## Live acceptance plan (pending explicit approval to run)
1. Start Hub in production-compatible mode (`AUTH_MODE=dev` locally for the smoke, real cookie in prod).
2. Start the worker on this VDI.
3. Run QC on one known-good promo per platform (QPRO, QP2, WS1_MY) via the browser. Verify the verdict matches what a direct VDI-side QC run produces for the same code.
4. Stop the worker. Confirm the Hub eventually reports the same code as MANUAL_REQUIRED with `check: relay-timeout` and no BO write happened anywhere.
5. Verify `/api/admin/relay-health` toggles between `offline: false` and `offline: true` inside the same session.

## Ops runbook (short version)
- **Worker offline** — check Task Scheduler run history + `/api/admin/relay-health`. If offline, restart from the batch file. Users get MANUAL_REQUIRED in the meantime — Manual Pass Override still available.
- **Secret rotation** — generate new hex, set on server env AND `%USERPROFILE%\.qc-relay\relay-secret`, restart both processes. In-flight jobs die cleanly.
- **Debug** — worker prints one JSON log line per event (`startup`, `job-start`, `job-submit`, `poll-error`, `shutdown`) with `jobId + brand + code + status` — never with promo values or secrets.

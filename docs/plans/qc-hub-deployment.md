# QC Hub — Private Team Deployment Plan

Status: **DRAFT — deployment blocked pending IT decisions (§ Deployment blockers)**
Last updated: 2026-07-20

---

## 1. Environment audit summary

| Item | Finding |
|---|---|
| VDI IP | 192.168.14.142 (RFC 1918, private subnet) |
| OS | Windows 11 Pro 10.0.26200 |
| Node | v24 (hub requires ≥ 20) |
| Current port | 4321 |
| HTTPS | None configured |
| Reverse proxy | None installed (no cloudflared, ngrok, nginx, pm2) |
| Tunnel software | None installed |
| Google OAuth client (existing) | `installed` type — used by googleapis for Sheets/Calendar only. **Not usable** for GIS web sign-in. A separate **Web application** client is needed. |
| IGMP keepalive | `IGMP-Session-Keepalive` scheduled task — every 30 min, `igmp-keepalive.mjs`, currently runs **Interactive only** (user must be logged in) |
| Session storage | `igmp-sessions.local.json`, updated automatically by keepalive |
| Credentials on VDI | `igmp-creds.local.json`, `bo-sites.local.json`, `bo-sites.json`, all `*.local.json` — gitignored, stay local |

---

## 2. Recommended hosting: Cloudflare Tunnel + Access

**Prerequisite: org must have a domain managed on Cloudflare (or be willing to add one).**
See IT question at the end of this document.

### Why Cloudflare Tunnel

- **No public IP** required — the tunnel dials out from the VDI, no inbound firewall rules
- **HTTPS automatic** — Cloudflare terminates TLS, valid browser cert, no self-signing
- **Stable custom subdomain** — e.g., `qc-hub.thebrandingpeople.co` — URL doesn't change across restarts
- **Google OAuth compatible** — HTTPS origin can be registered in GCP console
- **Free** for small teams (Cloudflare Zero Trust free tier, up to 50 users)
- **Single additional scheduled task** — `cloudflared.exe tunnel run qc-hub` alongside existing keepalive tasks
- **BO credentials stay local** — data never leaves the VDI; Cloudflare only proxies HTTP responses

### Cloudflare Access — REQUIRED

**Access must be enabled in front of the tunnel.** The tunnel alone provides HTTPS and routing but does not restrict who can reach the URL. Without Access, anyone who learns the hostname can attempt to use the hub.

Access configuration (in Cloudflare Zero Trust dashboard):
- Create Application → Self-hosted → hostname: `<qc-hub-subdomain>.<your-domain>`
- Policy: **Default Deny**
- Add one allow rule: **Emails ending in `@thebrandingpeople.co`** (or an explicit per-email allowlist)
- Session duration: 8 hours (matches the hub's own session lifetime)
- Do NOT enable bypass for any path

This creates two independent authentication gates:

| Gate | Enforced by | Check |
|---|---|---|
| 1 | Cloudflare Access | `@thebrandingpeople.co` Google account |
| 2 | QC Hub app | Same Google account + `admitted-users.json` allowlist |

A user who is not in `admitted-users.json` is blocked at gate 2 even if they pass gate 1.

### Alternative considered: Tailscale

If no Cloudflare domain is available, Tailscale gives a private mesh VPN (`100.x.x.x`). Each team member installs the Tailscale client. This still needs HTTPS for Google OAuth — would require Caddy or mkcert for local TLS termination. More moving parts than Cloudflare Tunnel.

### Alternative considered: ngrok

Works, but free tier generates random URLs on each restart. Paid tier required for a stable subdomain. Not recommended for an always-on internal tool.

---

## 3. Google OAuth setup requirements

**Key distinction:** the existing `google-oauth-client.local.json` is an `installed`-type client (for CLI googleapis Sheets/Calendar access). The QC Hub needs a separate **Web application** client for Google Identity Services (GIS).

### What to create in GCP Console

Project: `promo-bot-496510` (the existing Promo Bot project — confirm with Wai Yip if a separate project is preferred)

| Setting | Value |
|---|---|
| OAuth 2.0 client type | **Web application** |
| Name | `QC Hub` (or similar) |
| Authorized JavaScript origins | `https://<hub-url>` ← **pending hosting decision** |
| Authorized redirect URIs | **None** — GIS uses a popup/inline flow; no server-side redirect required |
| Workspace domain restriction | Handled application-side via domain check (`@thebrandingpeople.co`) + `admitted-users.json` allowlist |

### After creating the client

1. Copy the **Client ID** (ends in `.apps.googleusercontent.com`) — do not copy the client secret, it is not needed here
2. Set it as a Windows environment variable: `GOOGLE_CLIENT_ID=<value>`
3. Do NOT put it in any committed file

### GCP Console steps (for Wai Yip to perform)

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → project `promo-bot-496510`
2. APIs & Services → Credentials → **+ CREATE CREDENTIALS** → OAuth client ID
3. Application type: **Web application**
4. Name: `QC Hub`
5. Authorized JavaScript origins: add `https://<the-hub-URL-once-decided>`
6. Leave Authorized redirect URIs **empty**
7. Click Create → copy the **Client ID**
8. Set `GOOGLE_CLIENT_ID` env var on the VDI (see startup script below)

**One pending decision:** the JavaScript origin must be set to the final URL before users can sign in. This URL comes from the hosting decision (§ Decisions needed below).

---

## 4. Production startup configuration

### Environment variables required

| Variable | Required? | Value source |
|---|---|---|
| `GOOGLE_CLIENT_ID` | **Yes** (production) | GCP console — Web application client ID |
| `SESSION_SECRET` | Optional | If omitted, falls back to `qc-dashboard-session-secret.local.json` |
| `PORT` | Optional | Defaults to 4321 |
| `AUTH_MODE` | Must NOT be set (or be empty) in production | Dev override only |

### Set GOOGLE_CLIENT_ID as a persistent Windows env var (Wai Yip to run, not Claude)

```bat
:: Run once in an elevated cmd prompt — replace <client_id> with the real value
setx GOOGLE_CLIENT_ID "<client_id>.apps.googleusercontent.com" /M
```

`setx /M` applies to new processes. Open a new terminal after running it, then start the hub.

### Startup script (bin/qc-hub-prod.bat — safe, no secrets)

The file `bin/qc-hub-prod.bat` contains only environment checks and the start command. No credentials are in the file. It:
- Defaults `PORT` to 4321 if not set
- Refuses to start if `GOOGLE_CLIENT_ID` is empty
- Refuses to start if `AUTH_MODE=dev` is set
- Exits with a nonzero code and descriptive message if `node` exits nonzero

### Cloudflare Tunnel (see docs/qc-hub-tunnel-config.yml.template)

Install cloudflared:
```bat
:: Download from https://github.com/cloudflare/cloudflared/releases/latest
:: Place cloudflared.exe in C:\tools\ or any folder on PATH
cloudflared tunnel login           :: opens browser to authorize
cloudflared tunnel create qc-hub   :: creates tunnel, note the UUID
```

Then fill in the template with the real UUID and hostname. **Keep the filled copy local — do not commit it.**

The credential JSON saved at `C:\Users\vdiuser\.cloudflared\<tunnel-uuid>.json` also **must not be committed**.

### Proposed Task Scheduler entries

Two tasks are needed in addition to the existing `IGMP-Session-Keepalive`. Document these for IT/Wai Yip to create — do not create them without approval.

#### Task A — QC Hub server

| Property | Value |
|---|---|
| Name | `QC-Hub-Server` |
| Program/script | `C:\Windows\System32\cmd.exe` |
| Arguments | `/c "C:\Users\vdiuser\Downloads\promo-automation\promo-automation\bin\qc-hub-prod.bat"` |
| Start in | `C:\Users\vdiuser\Downloads\promo-automation\promo-automation` |
| Trigger | At startup (or At log on of `vdiuser`) |
| If task fails | Restart every 5 min, up to 3 times |
| Run as | `vdiuser` (see note on interactive vs stored-password below) |

#### Task B — Cloudflare Tunnel

| Property | Value |
|---|---|
| Name | `QC-Hub-Tunnel` |
| Program/script | `C:\tools\cloudflared.exe` |
| Arguments | `tunnel --config C:\path\to\filled-config.yml run` |
| Start in | (leave blank — cloudflared is self-contained) |
| Trigger | At startup (or At log on of `vdiuser`) |
| If task fails | Restart every 1 min, up to 10 times |
| Run as | `vdiuser` |

#### Interactive vs non-interactive

The existing `IGMP-Session-Keepalive` task is set to **"Run only when user is logged on"** in Task Scheduler.

**What this means in practice:**
- Tasks **continue to fire** while the VDI screen is locked — a locked screen does not end the Windows logon session.
- Tasks **stop** only when `vdiuser` fully logs off, the session is terminated by the remote-desktop host, or the VDI is rebooted before login.

Changing to "Run whether user is logged on or not" allows tasks to fire even after a full logoff or reboot, but requires Task Scheduler to store `vdiuser`'s Windows password — a security trade-off. **This requires Wai Yip's approval and potentially IT sign-off before changing any task's run context.**

#### Task C — Health monitor

A separate task polls the hub every 5 minutes and records failures in a local log and in Task Scheduler's Last Run Result. It must **not** be part of the blocking startup script — that script stays alive while the hub runs.

| Property | Value |
|---|---|
| Name | `QC-Hub-Health` |
| Program/script | `C:\Windows\System32\cmd.exe` |
| Arguments | `/c "node bin/qc-hub-health.mjs >> logs\qc-hub-health.log 2>&1"` |
| Start in | `C:\Users\vdiuser\Downloads\promo-automation\promo-automation` |
| Trigger | Repeat every 5 minutes, indefinitely |
| If task fails | Do not restart (it runs every 5 minutes anyway) |
| Run as | `vdiuser` |

The health-check script (`bin/qc-hub-health.mjs`) confirms:
- `/api/config` responds with HTTP 200 within 5 seconds
- `devMode` is `false`
- `googleClientId` is non-empty

It prints no configuration values. Exit 0 = healthy, exit nonzero = unhealthy.

No external notification service is used. Check Task Scheduler's Last Run Result and `logs/qc-hub-health.log` when diagnosing failures.

### Health check (manual, from VDI)

```bat
node bin/qc-hub-health.mjs
:: Healthy: prints "QC Hub is healthy." and exits 0
:: Unhealthy: prints a coded error line and exits 1
```

### Restart procedure

```bat
:: Find and stop the hub
for /f "tokens=5" %a in ('netstat -aon ^| findstr :4321') do taskkill /PID %a /F
:: Start it again
bin\qc-hub-prod.bat
```

Or, if run as a scheduled task: right-click → End Task → right-click → Run.

---

## 5. IGMP session refresh plan

### Current state (confirmed)

| Property | Value |
|---|---|
| Task name | `IGMP-Session-Keepalive` |
| Command | `cmd.exe /c "...bin\igmp-keepalive.cmd"` |
| Schedule | Every 30 minutes |
| Run context | **"Run only when user is logged on"** — fires while the session exists (including locked screen); stops on full logoff or reboot before login |
| Coverage | ws1-v3-my, ws1-v3-sg, ws1-v3-id, ws1-v3-th, ws1-v3-kh, ws2 |
| Session file | `igmp-sessions.local.json` (updated automatically) |
| Mechanism | Lightweight PM API ping; Playwright browser re-login only if stale |
| On failure | Exits code 1; no alert currently wired |

### Observed session lifetime

The keepalive log (`logs/igmp-keepalive.log`) shows sessions reporting `alive (session OK)` at ages of **3,930, 4,890, 8,339, and 8,399 minutes** (roughly 65–140 hours). The comment in `igmp-keepalive.mjs` that says `~1-2h` reflects a documentation estimate, not observed behavior. In practice, IGMP sessions on these sites have remained valid far longer than 2 hours.

The 30-minute ping schedule is appropriate regardless of actual session lifetime — it catches any unexpected early expiry and re-logs in automatically.

### Recommendation (no changes yet — pending approval)

**1. Improve run context:** Change from "Interactive only" to "Run whether user is logged on or not." This requires storing `vdiuser`'s Windows password in Task Scheduler. **Requires Wai Yip's approval before any change.**

**2. Keep local failure records:** Continue writing failures to `logs/igmp-keepalive.log` and use Task Scheduler's Last Run Result for operational checks. No Telegram or other external notifier is required.

**3. Schedule stays at 30 min.** The 30-minute interval is correct — it provides a safety margin even if session lifetime varies.

---

## 6. Files this plan proposes changing (none committed yet)

Six deployment and health-monitoring files are included in this change (no secrets, no credentials):

| File | Change | Status |
|---|---|---|
| `bin/qc-hub-health.mjs` | New — standalone health check CLI | Draft on disk, not staged |
| `bin/qc-hub-prod.bat` | New — startup script, no secrets | Draft on disk, not staged |
| `docs/plans/qc-hub-deployment.md` | New — this deployment plan | Draft on disk, not staged |
| `docs/qc-hub-tunnel-config.yml.template` | New — Cloudflare Tunnel config with Access documentation | Draft on disk, not staged |
| `src/qc-hub-health.js` | New — testable health-check module | Draft on disk, not staged |
| `test/qc-hub-health.test.mjs` | New — 9 health-check tests (all pass) | Draft on disk, not staged |
| Task Scheduler: `IGMP-Session-Keepalive` | Change run context to non-interactive | **Awaiting IT approval** |
| Task Scheduler: `QC-Hub-Server` | New task (see § 4) | **Awaiting IT approval** |
| Task Scheduler: `QC-Hub-Tunnel` | New task (see § 4) | **Awaiting IT approval** |
| Task Scheduler: `QC-Hub-Health` | New task (see § 4) | **Awaiting IT approval** |

**NOT changing:**
- `admitted-users.json` — gitignored, stays local, edit manually to add team members
- `qc-dashboard-session-secret.local.json` — gitignored, stays local
- Any `*.local.json` — never committed
- Filled tunnel config — never committed
- `C:\Users\vdiuser\.cloudflared\<tunnel-uuid>.json` — credential file, never committed

---

## 7. Security checklist

- [x] `validateProductionConfig()` — server refuses to start without `GOOGLE_CLIENT_ID` outside dev mode
- [x] Token audience (`aud`) always verified against `GOOGLE_CLIENT_ID`
- [x] `admitted-users.json` allowlist — email must be in list AND end with `@thebrandingpeople.co`
- [x] Session HMAC signed — tamper-proof cookies
- [x] `Secure; SameSite=Strict` cookie flags on non-localhost
- [x] 8-hour session expiry enforced server-side
- [x] CSRF: Origin vs Host check on all POST `/api/*`
- [x] Read-only transport — hub cannot write to BO, ever
- [x] IGMP endpoint allowlist — only `GET`-equivalent IGMP read paths allowed
- [x] No credentials in any committed file
- [x] `src/qc-hub-health.js` — prints no client IDs or config values; 9 unit tests cover all failure modes
- [ ] HTTPS — **pending hosting setup (blocker B1)**
- [ ] Cloudflare Access — **required; pending hosting setup**
- [ ] Google OAuth client registered with correct origin — **pending GCP step**
- [ ] `admitted-users.json` populated with all team members — **edit manually**
- [ ] Session keepalive non-interactive — **awaiting approval**

---

## 8. Deployment blockers

Deployment cannot proceed until all four items below are confirmed by IT or Wai Yip. None require code changes — they are external approvals.

| # | Blocker | Blocked by |
|---|---|---|
| B1 | **Cloudflare-managed domain** — does the org have one, and which domain/subdomain is approved for the hub? | IT |
| B2 | **Cloudflare Zero Trust / Access** — is it available on the org's plan? If not, what tunneling option does IT recommend instead? | IT |
| B3 | **Permission to run persistent services on the VDI** — does IT approve leaving `cloudflared.exe` and `node` as always-on background processes on `vdiuser`'s VDI session? | IT |
| B4 | **Google OAuth origin** — until B1 is resolved, the JavaScript origin for the GCP Web application client cannot be registered, so users cannot sign in. | B1 |

Code is ready. Tests pass. No deployment steps can be taken until these blockers clear.

---

## 9. Decisions needed from Wai Yip

| # | Decision | Why it's blocking |
|---|---|---|
| D1 | **Cloudflare domain + subdomain** — see B1/B2 above | Determines hosting; blocks OAuth origin registration |
| D2 | **GCP project for the web OAuth client** — use existing `promo-bot-496510` or a new one? | Low-stakes; clarifies where to look in GCP console |
| D3 | **Approve IGMP keepalive non-interactive mode** — run even when VDI user isn't logged in? | Requires stored Windows password in Task Scheduler; IT sign-off recommended |
| D4 | **Approve all four Task Scheduler entries** (`QC-Hub-Server`, `QC-Hub-Tunnel`, `QC-Hub-Health`, and updated `IGMP-Session-Keepalive`) | Persistent services need IT/Wai Yip authorisation |
| D5 | **Team members for `admitted-users.json`** — who beyond Wai Yip and Jascinta should have hub access? | Managed locally; not committed |

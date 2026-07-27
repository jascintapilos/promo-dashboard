# QC Dashboard

Two tools served from a single Node.js server.

---

## What's included

**QC Hub** — web app for running QC checks on promo codes, logging results, and generating fix prompts for Claude.

**Ops Dashboard** — read-only reporting page showing team utilisation, coverage, and weekly promo stats. Pulls live data from Google Sheets.

---

## Server setup

Requirements: Node.js 22+

```bash
git clone https://bitbucket.org/aiodintech/qc-dashboard.git
cd qc-dashboard
npm install
node bin/qc-dashboard.mjs
```

Server runs on port 4321 by default. To use a different port:

```bash
PORT=8080 node bin/qc-dashboard.mjs
```

---

## URLs once running

| Page | URL |
|---|---|
| QC Hub | `http://yourserver:4321/` |
| Ops Dashboard | `http://yourserver:4321/dashboard` |

---

## What's pre-configured

- Google login — any Google account; access is controlled by `admitted-users.json`
- Allowed users — see `admitted-users.json` (add email addresses here to grant access)
- Brand list — see `data/qc-dashboard-brands.json`
- Session secret — auto-generated on first run

---

## What's needed from Jascinta before QC checks work

`bo-sites.local.json` — get this file directly from Jascinta (via Telegram or any secure channel). It is not in the repo and will never be — it contains BO passwords. Drop it in the project root, then restart the server. Everything else works without it — only the Run QC button requires it.

---

## File structure

```
bin/qc-dashboard.mjs       server entry point
src/qc-dashboard/          QC engine (checks, verdict, auth, history)
public/qc-hub/             QC Hub frontend
public/dashboard.html      Ops Dashboard
data/                      brand config and directory
admitted-users.json        Google login allowlist
qc-hub-config.json         Google Client ID
bo-sites.json              BO URLs and signing keys (no passwords)
bo-sites.local.json        BO passwords — not in repo, get from Jascinta
```

---

## Table of contents

1. [Installation](#installation)
2. [Configuration](#configuration)
3. [Project structure](#project-structure)
4. [CLI reference](#cli-reference)
5. [Development methodology — manual → API → skill](#development-methodology--manual--api--skill)
6. [How sessions work (concurrency model)](#how-sessions-work-concurrency-model)
7. [Claude Code integration](#claude-code-integration)
8. [Troubleshooting](#troubleshooting)

---

## Installation

### Prerequisites

| | macOS / Linux | Windows |
|---|---|---|
| **Node.js ≥ 20** | `brew install node` or [nodejs.org](https://nodejs.org/) | [nodejs.org](https://nodejs.org/) installer |
| **Git** | usually preinstalled, else `brew install git` | [git-scm.com](https://git-scm.com/) |
| **Claude Code** (optional) | [claude.com/code](https://claude.com/code) | same |
| **Chromium for Playwright** (optional, only for Phase 1) | `npx playwright install chromium` | `npx playwright install chromium` |

### First-time setup

The same four commands run on every OS. Open a terminal — cmd, PowerShell, Terminal.app, or any POSIX shell — and:

```bash
git clone <this-repo>
cd promo-automation
npm install
npm run setup
```

`npm run setup` is a Node script (no bash, no shell builtins), so it behaves identically everywhere. It copies `bo-sites.example.json` → `bo-sites.json` and tightens file permissions where the OS supports it.

Then **edit `bo-sites.json`** — replace the `REPLACE_ME` placeholders with a real `username` / `password` for at least one site. Sanity-check:

```bash
node bin/sessions.js list
node bin/promo-contents.js <BRAND>
```

If both succeed, you're done. The cached session lands in `.session/<site-id>.json` and is reused on every subsequent call.

### Windows: setting environment variables for CLI flags

Some commands accept env-var inputs (e.g. `HEADLESS=false` for the Playwright flow). POSIX inline syntax doesn't work in Windows shells — use the native equivalent:

| Goal | POSIX (bash, zsh, WSL) | Windows cmd | Windows PowerShell |
|---|---|---|---|
| Run with `HEADLESS=false` once | `HEADLESS=false node …` | `set HEADLESS=false && node …` | `$env:HEADLESS="false"; node …` |
| Permanent (current session) | `export HEADLESS=false` | `set HEADLESS=false` | `$env:HEADLESS="false"` |

Every other command is shell-agnostic because they're all `node bin/…`.

### Windows: hardening `bo-sites.json` permissions (optional)

POSIX setup runs `chmod 600 bo-sites.json` automatically. Windows ignores Unix mode bits — if the machine is shared, restrict the file to your account:

```powershell
icacls .\bo-sites.json /inheritance:r /grant:r "$env:USERNAME:(R,W)"
```

This removes inherited permissions and grants only your user read/write.

---

## Configuration

Everything user-editable lives in **one file**: `bo-sites.json` (gitignored).

```jsonc
{
  "defaultSite": "ibc22",
  "sites": {
    "ibc22": {
      "label": "IBC22 BO (qtp777)",
      "baseUrl": "https://ibc22.qtp777.com",
      "apiHost": "https://54505721qp2api.960806.com",
      "reqSignKey": "kbXbAEotZ64nueRXt0+fWKBndGADLrQiaL6VrhM+mSw=",
      "loginMerchantCode": "I22",
      "username": "...",
      "password": "..."
    }
  }
}
```

| Field | What it is | How to find it |
|---|---|---|
| `id` (the key in `sites`) | Short stable handle used with `--site=<id>` | You pick it. |
| `label` | Human-readable name shown in CLI headers | You pick it. |
| `baseUrl` | The login URL you visit in a browser | Self-evident. |
| `apiHost` | The XHR host the SPA actually talks to | DevTools → Network → look for `/api/bo/login`; copy the origin. |
| `reqSignKey` | **Public** AES key the SPA uses to encrypt the password (shipped in every page load) | View the SPA's `main.<hash>.js` and grep for `reqSignKey:"…"`. |
| `loginMerchantCode` | Merchant prefix used at login (3 letters, e.g. `I22`) | Visible in the `/api/bo/login` POST body in DevTools. |
| `username`, `password` | Your BO account on this site | Your team's credential store. |

> `reqSignKey` is per-site (each deployment ships a different one) but **not a secret** — anyone visiting the BO downloads it. Treat it like a config constant, not a credential.

### Adding more sites

Add another entry under `sites`. Pick a short `id`. Then:

```bash
node bin/promo-contents.js --site=acme-prod <BRAND> --all
```

No code changes — the API client is fully driven by `bo-sites.json`.

### Where credentials and sessions live

| Thing | Location | Why |
|---|---|---|
| Credentials (URL/user/pass) | `bo-sites.json` (gitignored, `0600` on POSIX) | One persistent file, owned by you. |
| Session tokens | `.session/<site-id>.json` (gitignored, `0600`) | Runtime artifact, auto-written by the client. |
| API keys | _N/A_ | This BO has none; auth is user/pass → derived session. |
| Public `reqSignKey` | `bo-sites.json` | Not secret, but lives with the site definition since it's per-deploy. |

**Sessions are never persisted by hand.** Don't paste a token into config; let the client write it. If a session is wrong, `node bin/sessions.js clear --site=<id>` wipes it and the next call re-logs in.

---

## Project structure

```
promo-automation/
├── .claude/
│   └── skills/
│       └── list-active-promo-content/
│           └── SKILL.md              ← Claude Code skill (committed; team picks it up on clone)
├── bin/                              ← CLI entrypoints (Node, cross-platform)
│   ├── setup.js                        first-run setup (copies example config)
│   ├── promo-contents.js               3.3 Promotion Contents
│   ├── promotions.js                   3.2 Promotion Codes
│   ├── sessions.js                     list / clear / refresh cached sessions
│   └── _args.js                        zero-dep CLI arg parser
├── src/
│   ├── sites.js                      loads + validates bo-sites.json
│   ├── api-client.js                 AES-CBC login, authedFetch, domain helpers
│   ├── session-cache.js              per-site cache + file lock + atomic write
│   └── browser/
│       └── phase1-browser.js         Playwright UI flow (optional, multi-site)
├── bo-sites.example.json             template (committed; placeholders only)
├── bo-sites.json                     real config (gitignored, 0600)
├── .session/                         runtime cache (gitignored, 0700)
├── captures/                         screenshots & ad-hoc JSON dumps (gitignored)
├── package.json
└── README.md
```

The repo ships exactly three things a teammate needs after `npm install`:

1. **The CLIs** in `bin/`.
2. **The library** in `src/` (importable from any Node script).
3. **The skill** in `.claude/skills/` (auto-loads in Claude Code).

Everything else is either generated at runtime (`.session/`, `captures/`, `node_modules/`) or per-user secrets (`bo-sites.json`).

---

## CLI reference

```bash
# 3.3 Promotion Contents (per-brand)
node bin/promo-contents.js SPADE66 --all
node bin/promo-contents.js --site=ibc22 KING333 --limit=20 --json > out.json

# 3.2 Promotion Codes
node bin/promotions.js SPADE66 --all
node bin/promotions.js --site=acme-prod IBC22 --limit=5

# Session management
node bin/sessions.js list                  # who's configured, who's cached, when each expires
node bin/sessions.js refresh --site=ibc22  # force re-login one site
node bin/sessions.js clear --site=ibc22    # wipe just one cached session
node bin/sessions.js clear                 # wipe every cached session

# Phase 1 (browser-driven, optional — requires `npx playwright install chromium`)
node src/browser/phase1-browser.js --site=ibc22 KING333 --limit=5
```

Common flags across `promo-contents.js` / `promotions.js`:

| Flag | Effect |
|---|---|
| `--site=<id>` | Pick a BO site. Defaults to `bo-sites.json → defaultSite`. |
| `--all` | Fetch every page in parallel. Without it, only page 1 is returned. |
| `--limit=N` | Truncate the result list to N rows after fetching. |
| `--json` | Emit JSON instead of a tab-separated table. Pipe into `jq` or a file. |

---

## Development methodology — manual → API → skill

This is the **recipe for adding a new automation** (a new BO page or workflow). The existing `promo-contents` was built this way; follow the same path for anything new.

The core insight: **you don't need API docs.** Modern SPAs reveal their own contract — every click triggers HTTP calls you can observe. The job is to capture, distill, and codify what the UI is already doing.

```
┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│ 1. Manual (UI)   │ →  │ 2. API (HTTP)    │ →  │ 3. Skill (LLM)   │
│ Playwright drives│    │ Direct fetch     │    │ Trigger phrase   │
│ the page,        │    │ replays what the │    │ wraps the CLI    │
│ captures XHR     │    │ UI was doing     │    │ for chat/CC use  │
└──────────────────┘    └──────────────────┘    └──────────────────┘
```

### Step 1 — Manual exploration (the spy phase)

Goal: figure out which API the page actually calls, what params it needs, and what headers carry auth.

Write a one-shot Playwright script that logs in, navigates to the target page, performs the action (click a filter, submit a search), and **records every XHR**. Drop it under `src/browser/` next to `phase1-browser.js` and run it.

A minimal template:

```js
// src/browser/probe-<feature>.js
import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { getSite } from '../sites.js';

const site = getSite();              // uses defaultSite from bo-sites.json
const OUT = path.resolve('captures');
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ headless: false });   // headed = easier to debug
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const hits = [];
page.on('request', (r) => {
  if (r.url().includes(new URL(site.apiHost).host)) {
    hits.push({ kind: 'req', method: r.method(), url: r.url(), body: r.postData() });
  }
});
page.on('response', async (r) => {
  if (r.url().includes(new URL(site.apiHost).host)) {
    try { hits.push({ kind: 'res', status: r.status(), url: r.url(), body: (await r.text()).slice(0, 4000) }); } catch {}
  }
});

await page.goto(site.baseUrl);
await page.fill('input[placeholder*="user" i]', site.username);
await page.fill('input[type="password"]', site.password);
await page.keyboard.press('Enter');
await page.waitForLoadState('networkidle');

// ── Drive the UI to the action you want to automate ──
// Click your menu item, fill filters, press Search, etc.
// Example: navigate to "3.3 Promotion Contents":
await page.locator('text=/3\\.3 Promotion Contents/').first().click();
await page.waitForLoadState('networkidle');
await page.locator('select[formcontrolname="site_id"]').selectOption({ label: 'SPADE66' });
await page.locator('button:has-text("Search")').first().click();
await page.waitForTimeout(2000);

await page.screenshot({ path: path.join(OUT, 'probe.png'), fullPage: true });
await writeFile(path.join(OUT, 'probe-hits.json'), JSON.stringify(hits, null, 2));
console.log('captured', hits.length, 'requests — see captures/probe-hits.json');
await browser.close();
```

Run it (use headed mode the first time, so you can see what the page does):

```bash
# macOS / Linux / WSL
HEADLESS=false node src/browser/probe-<feature>.js

# Windows cmd
set HEADLESS=false && node src/browser/probe-<feature>.js

# Windows PowerShell
$env:HEADLESS="false"; node src/browser/probe-<feature>.js
```

The output lives in `captures/probe-hits.json`. Inspect it:

```bash
node -e "JSON.parse(require('fs').readFileSync('captures/probe-hits.json','utf8')).filter(c=>c.url.includes('/api/bo/')).forEach(c=>console.log(c.method||c.status,c.url))"
```

You're looking for **one or two interesting endpoints** — usually the one called right after your Search click. Read the URL params and the response shape carefully.

### Step 2 — Extract the API call

Goal: replace the Playwright script with direct HTTP that produces the same data.

1. **Add a domain helper to `src/api-client.js`.** Use `authedFetch(site, path)` — it handles login caching and the auto-retry on 401 transparently. Pattern:

   ```js
   export async function getThings(site, { merchantId, status = 1, ... } = {}) {
     const params = new URLSearchParams({ /* what you saw in step 1 */ });
     return authedFetch(site, `/api/bo/things?${params}`);
   }
   ```

2. **Add a CLI in `bin/`** that wraps the helper. Copy `bin/promo-contents.js` as a template — it's 60 lines and already handles `--site`, `--all`, `--limit`, `--json`.

3. **Test against the real BO.** Compare the count and a few row IDs against what the UI shows. If they match, your extraction is faithful. If not, you're missing a param.

#### Gotchas this codebase has hit

- Param naming can shift between pages (Promotion Codes uses `merchant_id`, Promotion Contents uses `site_id`). Don't assume parity across endpoints.
- Some endpoints require parameters that the UI defaults to without showing (`type=0` for `/promotioncontent`). If you get `HTTP 500`, re-inspect the captured request — you probably dropped a hidden param.
- Per-site `reqSignKey` rotation: if a previously-working site starts returning 401 on login, re-grep `main.<hash>.js` for the new key and update `bo-sites.json`.

### Step 3 — Wrap it as a Claude Code skill

Goal: make the workflow conversationally invokable, so a teammate using Claude Code can just say _"give me X for brand Y"_ and the model picks the right CLI.

Create `.claude/skills/<short-name>/SKILL.md`:

```markdown
---
name: list-things
description: Use when the user asks for <…> of a brand on the BO. Phrasings like "show me X for SPADE66", "list active X on KING333". Supports --site=<id>.
---

# List things for a brand

## Trigger
User asks for <…>.

## Run it
```bash
node bin/things.js [--site=<id>] <BRAND> [--all] [--limit=N] [--json]
```

…etc — keep it short. The skill body is a recipe, not a tutorial.
```

The `description` is the **trigger phrase** the model matches against the user's request. Phrase it like _"Use when the user asks for X"_ — concrete examples beat abstract descriptions.

Commit the skill. Every team member gets it on next `git pull`. No per-user setup.

### When to skip a phase

- **Skip Phase 1** if you can read the captured request from someone else's session or another teammate already documented the endpoint.
- **Skip Phase 3** if it's a one-off task with no recurring users. Skills exist to make repeated workflows trivial to invoke; don't write one for a script you'll run once.

---

## How sessions work (concurrency model)

`getSession(site)` returns a usable session for the given BO. It:

1. Reads `.session/<site-id>.json`. If fresh (>30 s before its expiry), uses it.
2. Otherwise acquires `.session/<site-id>.lock` via `O_CREAT|O_EXCL`. Stale locks (>60 s) auto-clear.
3. Re-reads inside the lock — another concurrent process may have just refreshed.
4. If still stale, performs `POST /api/bo/login` and atomically writes the new session.

**Three workers launched simultaneously against the same site perform exactly one login**, not three. Different sites cache independently — running site A never disturbs site B's cache.

On `401` / `419` mid-call, `authedFetch` clears the cache, forces one fresh login, and retries the original request once. A second auth failure surfaces the real error.

---

## Claude Code integration

The skill at `.claude/skills/list-active-promo-content/SKILL.md` is committed. When a teammate opens the project in Claude Code, it's auto-discovered — no per-user setup. Triggered by phrasings like _"active promo content for SPADE66"_ or explicitly via `/list-active-promo-content`.

To add a new skill: see [Step 3 — Wrap it as a Claude Code skill](#step-3--wrap-it-as-a-claude-code-skill) above.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Missing bo-sites.json` | Run `npm run setup`, then fill in the file. |
| `site … has a placeholder for "password"` | You left `REPLACE_ME` in `bo-sites.json`. Edit it. |
| `HTTP 500 — (I22-xxxx)` on `/api/bo/promotioncontent` | You passed `merchant_id` instead of `site_id`, or omitted `type=0`. Use the library helpers, not raw URLs. |
| Repeating `auth required (401)` | Credentials in `bo-sites.json` are wrong. Client retries once, then surfaces this. |
| Login returns 401 immediately on a previously-working site | The SPA shipped a new bundle with a rotated `reqSignKey`. Re-grep `main.<hash>.js` and update the site's `reqSignKey`. |
| `session lock timeout` | A previous run died holding the lock. Stale locks auto-clear after 60 s; or delete `.session/<site>.lock` manually. |
| Need a clean slate | `node bin/sessions.js clear` wipes all cached sessions; the next call re-logs in. |
| Windows: `HEADLESS=false node …` does nothing | Inline env-var syntax is POSIX-only. Use `set HEADLESS=false &&` (cmd) or `$env:HEADLESS="false";` (PowerShell). See the [Windows env-var table](#windows-setting-environment-variables-for-cli-flags) above. |

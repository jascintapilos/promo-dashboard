# Teammate onboarding — Claude Code prompt for migrating BO automation

Share this file with a teammate who has an existing automation project (currently driven via `claude-in-chrome` MCP) and wants to migrate it onto our reference pattern: **Playwright UI → direct API → Claude Code skill**, with shared session caching and concurrency-safe auth handling.

## How your teammate uses this

1. **Open Claude Code in the root of their existing project** (the one with their current automation + agent skills).
2. **Copy the prompt below** (everything inside the `--- PROMPT START ---` / `--- PROMPT END ---` markers) and paste it as a single message.
3. Answer Claude Code's follow-up questions about their current automation. Claude will plan, then execute the migration in three phases.

The reference implementation Claude should pattern from is the `promo-automation` project. Make sure your teammate has a copy or read-access to it before starting — Claude Code can clone it locally for reference, or you can share the relevant files (`src/api-client.js`, `src/session-cache.js`, `src/sites.js`, `bin/setup.js`, `.claude/skills/list-active-promo-content/SKILL.md`) ahead of time.

---

## --- PROMPT START ---

# Migrate this project from `claude-in-chrome` to Playwright + direct API + Claude Code skill

You're going to refactor my existing Claude Code project so it follows the same architecture as the **`promo-automation` reference project** (I have a copy at `<USER: fill in path or share>`; please `Read` its README and `src/` before doing anything else).

> Naming note: the reference was previously called `qpro-bo-auto` — its `package.json` may still carry the old name, and the directory I cloned it into may be named anything. Trust the path I give you above, not the project/package name.

The current state of this project: it uses **`claude-in-chrome` MCP tools** (every `mcp__claude-in-chrome__*` call) to drive a Back Office UI for some automation workflow. There are existing **Claude Code agent skills** under `.claude/skills/` that I want to preserve.

The end state I want, in order of phases:

1. **Phase 1** — Same automation runs via `playwright` (npm package) instead of `claude-in-chrome`. Browser still in the loop, but the project is reproducible without an MCP server.
2. **Phase 2** — Where possible, replace the browser-driven steps with **direct HTTP calls** to the BO's API (extracted by observing what the SPA does under Playwright).
3. **Phase 3** — The existing agent skills are updated to invoke the new CLIs/library, and they support **multiple BO sites** with shared, concurrency-safe session caching.

Work cross-platform — every command and script must run identically on macOS, Linux, and Windows (cmd, PowerShell, WSL). No shell-specific syntax in any script. Use Node-based equivalents where shell tools differ.

---

## Step 0 — Discover the existing state (before changing anything)

Before writing any code, do this:

1. **Read the reference project's README** so you understand its architecture. Pay attention to:
   - `src/api-client.js` (encryption, `authedFetch`, transparent re-auth on 401)
   - `src/session-cache.js` (per-site `.session/<id>.json` + `O_CREAT|O_EXCL` lock)
   - `src/sites.js` (single `bo-sites.json` source-of-truth for multiple sites/creds)
   - `bin/*.js` (CLI entry points)
   - `.claude/skills/list-active-promo-content/SKILL.md` (skill structure)

2. **Survey my project** (use cross-platform tools — prefer your `Glob` / `Grep` tools over shell `find`, since `find` syntax differs across macOS / Linux / Windows):
   - List every `.md` / `.js` / `.ts` / `.json` file outside `node_modules/` and `.git/`. If you must shell out, use a Node one-liner like `node -e "const fs=require('fs'),p=require('path');(function w(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){if(['node_modules','.git'].includes(e.name))continue;const f=p.join(d,e.name);e.isDirectory()?w(f):/\.(md|js|ts|json)$/.test(e.name)&&console.log(f);}})('.')"` — works identically on every OS.
   - List `.claude/skills/` if it exists. Read every `SKILL.md`.
   - Grep for `mcp__claude-in-chrome` usages so you know what browser actions I'm currently performing.
   - Identify any hardcoded credentials (`.env`, config files, secrets in code).

3. **Ask me** before writing code:
   - What BO sites/URLs does my automation talk to?
   - Are there multiple credentials (e.g. dev/staging/prod or different brands)?
   - Which agent skills are load-bearing vs experimental?
   - Am I OK with you reorganizing the directory tree to match the reference, or do I need to keep certain paths stable?

Wait for my answers before proceeding. Don't guess.

---

## Step 1 — Project bootstrap (cross-platform)

Once I've confirmed scope:

1. **`npm install --save playwright`** (and `npm install` general).
2. **`npx playwright install chromium`** — the only optional step the teammate must run themselves. Note in the README that it's only required for Phase-1 browser flows.
3. Create the reference directory layout if it doesn't already exist:
   ```
   bin/         CLI entry points (Node, cross-platform)
   src/         library code
     sites.js
     api-client.js
     session-cache.js
     browser/   Playwright scripts (the spy phase)
   .claude/skills/<name>/SKILL.md
   bo-sites.example.json
   bo-sites.json            (gitignored)
   .session/                (gitignored)
   captures/                (gitignored)
   ```
4. **Adopt these patterns verbatim from the reference**:
   - `src/sites.js` — loads + validates `bo-sites.json`, supports `defaultSite`, resolves by id with friendly errors.
   - `src/session-cache.js` — per-site files (`<id>.json` + `<id>.lock`), atomic write via `tmp + rename`, exclusive lock via `fs.open(lockPath, 'wx')`, stale-lock auto-clear after 60 s.
   - `src/api-client.js` — `rawLogin(site)`, `getSession(site)` (cache-aware), `authedFetch(site, path, opts)` (transparent retry on 401/419/“unauthorized” messages, exactly **once** per call), domain helpers like `getThings(site, opts)`.
   - `bin/setup.js` — Node script that copies `bo-sites.example.json` → `bo-sites.json` if missing and `chmod 600` it (try/catch so Windows doesn't fail). Wired up as `npm run setup`.
   - `bin/_args.js` — tiny zero-dep CLI parser.

   **Important**: do not invent your own variant. The reference solves real concurrency + auth-recovery bugs that you should not re-derive.

5. Cross-platform reminders that often get missed:
   - No `chmod` in bash one-liners — call `fs.chmodSync` with a try/catch.
   - No inline `KEY=value node …` syntax. Either set env in code (`process.env.KEY = '…'` in the script when appropriate) or document the per-shell equivalents in the README (POSIX: `KEY=v node …`, cmd: `set KEY=v && node …`, PowerShell: `$env:KEY="v"; node …`).
   - No `cp` / `rm` in scripts — use `fs.copyFileSync` / `fs.unlinkSync`.
   - Use `path.join` and `path.resolve` everywhere; never literal `/` separators in code.
   - Don't rely on `&&` chaining in npm scripts when separate scripts work fine.

---

## Step 2 — Migrate `claude-in-chrome` calls to Playwright

For every `mcp__claude-in-chrome__*` invocation in my codebase (and inside any agent skills), produce a Playwright equivalent. Conversion map:

| `mcp__claude-in-chrome__*` | Playwright equivalent |
|---|---|
| `tabs_context_mcp`, `tabs_create_mcp`, `tabs_close_mcp` | `chromium.launch()` → `browser.newContext()` → `context.newPage()` / `page.close()` |
| `navigate({ url })` | `await page.goto(url, { waitUntil: 'domcontentloaded' })` |
| `read_page` / `get_page_text` | `await page.content()` (HTML) or `await page.locator(sel).textContent()` (specific element) |
| `find({ selector })` | `await page.locator(sel)` (use `.first()`, `.nth(n)`, `.waitFor()` as needed) |
| `form_input({ selector, value })` | `await page.fill(sel, value)` |
| `javascript_tool({ script })` | `await page.evaluate(() => { … })` |
| `read_console_messages` | `page.on('console', msg => …)` — attach **before** the action that produces logs |
| `read_network_requests` | `page.on('request', …)` and `page.on('response', …)` — used heavily in Phase 2 |
| `gif_creator` / `screenshot` | `await page.screenshot({ path, fullPage: true })` |
| `shortcuts_execute` | `await page.keyboard.press('Control+S')` etc. |
| `computer` (mouse/keyboard) | `page.mouse.*`, `page.keyboard.*` |

For each migration target file:

1. Open the file. Identify each MCP call and its purpose.
2. Replace with the Playwright equivalent.
3. Keep the **same outer function signature** so existing callers still work.
4. Wrap the script in a launch/close lifecycle:
   ```js
   import { chromium } from 'playwright';
   import { getSite } from '../src/sites.js';
   const site = getSite();
   const browser = await chromium.launch({ headless: process.env.HEADLESS !== 'false' });
   const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
   const page = await ctx.newPage();
   try {
     /* … the migrated automation … */
   } finally {
     await ctx.close();
     await browser.close();
   }
   ```
5. **Test against my real BO** after each non-trivial migration. Don't batch all conversions then run once — iterate.

While migrating, also update the agent skills under `.claude/skills/<name>/SKILL.md`:

- Anywhere a skill says "use the claude-in-chrome MCP tool to …" → replace with "run `node src/browser/<script>.js …`" or "import and call `<function>` from `src/…`".
- Tighten the frontmatter `description` to the user-facing trigger phrasing (it's what the LLM matches against). Examples beat prose: _"Use when the user asks for X for brand Y"_.
- Body should be a recipe (3–6 short sections: Trigger / Run it / Underneath / Gotchas / Library form), not a project overview.

---

## Step 3 — Extract direct API calls (Phase 1 → Phase 2)

This is the "spy → script" optimization the reference project demonstrates. For each browser-driven workflow worth optimizing (anything called often, or anything that takes >3 seconds because of UI rendering):

1. **Capture XHR while the Playwright script runs** the workflow. Use this pattern (the `try/catch` around `r.text()` is required — Playwright throws "body has been used" if the page consumed the body first, or if the response was redirected/aborted):
   ```js
   const hits = [];
   page.on('request', (r) => {
     if (r.url().includes(new URL(site.apiHost).host)) {
       hits.push({ method: r.method(), url: r.url(), postData: r.postData(), headers: r.headers() });
     }
   });
   page.on('response', async (r) => {
     if (r.url().includes(new URL(site.apiHost).host)) {
       try { hits.push({ status: r.status(), url: r.url(), body: (await r.text()).slice(0, 4000) }); } catch {}
     }
   });
   /* … perform the action you want to optimize … */
   await fs.promises.writeFile('captures/probe.json', JSON.stringify(hits, null, 2));
   ```
2. **Find the interesting endpoint** in `captures/probe.json` — usually the one called right after the trigger action (a Search click, a navigation, etc.). Read its URL params and response shape carefully.
3. **Figure out the auth scheme** (don't assume parity with the reference — confirm what *this* BO does):
   - Inspect the login response. Look for `access-token`, `token-selector`, JWT, bearer token, set-cookie, or session id.
   - Look at what headers the authenticated calls send. The reference uses `access-token` + `token-selector` (two custom headers), but other BOs use `Authorization: Bearer …`, a session cookie, or a mix. Whatever you observe is what `authedFetch` must send — extend its signature if needed (e.g. accept a per-site `authMode: 'headers' | 'bearer' | 'cookie'`).
   - If the password is encrypted in the login POST body (very common in BO SPAs), find the encryption in `main.<hash>.js`. Grep for `encrypt`, `AES`, `cipher`. The reference's scheme is: `key = SHA256(reqSignKey)`, `iv = random 16 bytes`, `out = base64(iv || AES-256-CBC(plaintext, key, iv, PKCS7))` — other BOs may use a different cipher, different key derivation, or no encryption at all.
4. **Add a helper to `src/api-client.js`** that uses `authedFetch(site, path)`:
   ```js
   export async function getThings(site, { merchantId, status = 1, ... } = {}) {
     const params = new URLSearchParams({ /* whatever you saw */ });
     return authedFetch(site, `/api/bo/things?${params}`);
   }
   ```
5. **Add a CLI in `bin/`** that wraps the helper. Copy the structure of `bin/promo-contents.js` (or `bin/promotions.js` for a paginated-list variant) from the reference.
6. **Compare output to the UI**: same row count, same first few IDs. If it matches, your extraction is faithful. If not, you missed a hidden default param — re-inspect the captured request.

Common gotchas this project should expect:

- Param naming can differ across pages (e.g. `merchant_id` on one endpoint, `site_id` on a sibling endpoint). Don't assume parity.
- Some endpoints require parameters that the UI defaults to without showing them in the form (e.g. `type=0`). Missing them returns `HTTP 500` with an internal error id.
- Per-site encryption keys (`reqSignKey` or similar) rotate when the BO ships a new bundle. If a previously working site starts returning 401 on login, regrep `main.<hash>.js` for the new key.

Once a workflow runs reliably via the API path, deprecate the Playwright version (keep it under `src/browser/` as a fallback + debugging tool, but don't ship it as the default).

---

## Hard requirements (don't skip these)

These two requirements must be satisfied or the migration is incomplete:

### Requirement A — One login per BO account, regardless of concurrency

Multiple concurrent CLI invocations or library callers against the same BO **must share a single login**. Mechanism (copy from the reference):

- Cache the session on disk at `.session/<site-id>.json` (`0600`).
- Before any auth'd call, check the cache. If fresh (expiry > now + 30 s), reuse.
- If stale, acquire `.session/<site-id>.lock` with `fs.open(lockPath, 'wx')` (the `'wx'` flag is `O_CREAT|O_EXCL` — it fails if the lock already exists, so only one process can hold it).
- Inside the lock, re-read the cache (another process may have just refreshed). If still stale, log in and atomically write the new session (`tmp + rename`).
- Release the lock by `unlink`ing it. Stale locks > 60 s old can be ignored/cleared.

Verify it properly (counting cached files is **not** enough — three racing processes would overwrite the same file and look the same as one): add a one-line counter to `rawLogin` such as `console.error('[login] hit network for', site.id)`, then run three concurrent invocations and confirm exactly **one** `[login]` line appears in stderr. Remove or downgrade the log once verified.

### Requirement B — Auth handling when the session becomes invalid

When the server rejects the cached session mid-call:

- The client must detect rejection via `HTTP 401`, `HTTP 419`, or `HTTP 200` with `success:false` + a message matching `/unauth|token|expired/i`.
- On rejection, clear the session file, force one fresh login (via the same lock mechanism — concurrent rejections must not stampede), and **retry the original request once**.
- A second failure surfaces the real error to the caller. Do not retry indefinitely.

Verify it: corrupt `.session/<site-id>.json` with a fake token, then run any auth'd CLI. It should succeed (one transparent re-login + retry), and the file should be replaced with a real session.

---

## When you're done

Produce:

1. An updated **`README.md`** with: cross-platform install instructions (the same 4-command flow works on Mac/Linux/Windows), `bo-sites.json` schema, project structure tree, CLI reference, supported env vars (e.g. `BO_SITES_FILE` to point at a non-default config path, `QPRO_SESSION_DIR` to relocate the session cache, `HEADLESS=false` for headed browser runs), and the 3-phase development methodology (Manual → API → Skill).
2. **`bo-sites.example.json`** committed; **`bo-sites.json`** gitignored.
3. **All agent skills migrated** under `.claude/skills/<name>/SKILL.md` with up-to-date triggers and bodies pointing at the new CLIs.
4. At least **one Phase-2 (API) workflow** end-to-end, including a smoke test you can show me.
5. A `.gitignore` that excludes `bo-sites.json`, `.session/`, `captures/`, `node_modules/`, and OS junk.

After all of that, run a final verification. **All commands must be cross-platform** — no shell backgrounding (`&`, `wait`) or subshells, since those don't exist in Windows cmd/PowerShell. Drive concurrency from Node instead:

```bash
node bin/sessions.js list            # configured sites + cache state
node bin/<one-cli>.js <args>          # functional check
```

Concurrent-login test (works identically on macOS / Linux / Windows):

```bash
node -e "const {spawn}=require('child_process');const p=()=>new Promise(r=>{const c=spawn(process.execPath,['bin/<one-cli>.js','<args>'],{stdio:'inherit'});c.on('exit',r);});Promise.all([p(),p(),p()]);"
```

Before running the concurrent test, delete `.session/<site>.json` so the cache is cold, and (per Requirement A above) make sure `rawLogin` has a temporary `console.error('[login] hit network for', site.id)` so you can count network logins. Expect exactly one `[login]` line in the combined stderr.

Report back with what changed, what's still pending, and any places where my project deviates from the reference and why.

## --- PROMPT END ---

---

## Notes for you (the person sharing this)

- Replace `<USER: fill in path or share>` in the prompt with either:
  - A local path to the `promo-automation` reference project (e.g. `/Users/you/promo-automation`), or
  - A git URL so your teammate can clone it: `git clone <url> /tmp/promo-automation-ref`.
- If the teammate's project has more than one auth scheme (e.g. one BO uses cookies, another uses bearer tokens), Claude Code will need to extend the `authedFetch` signature. That's a reasonable Phase-2 extension — leave it to Claude to surface.
- The prompt assumes Claude Code has `Read`, `Write`, `Edit`, `Bash`, and `Grep` tools available (the defaults). No other MCP servers required after migration.
- Encourage your teammate to use **headed mode** during the initial Playwright migration (`HEADLESS=false`) so they can see what's happening. Switch to headless once it's reliable.

## Reference checklist (what "good" looks like after migration)

- [ ] `npm install` + `npm run setup` works on Mac, Linux, and Windows.
- [ ] No `mcp__claude-in-chrome__*` references remain in code or skills.
- [ ] `bo-sites.json` is gitignored, holds all credentials, and is the only file the user edits.
- [ ] `.session/<site>.json` exists after the first call; survives subsequent calls.
- [ ] Three concurrent CLI invocations produce one cached session, not three.
- [ ] Corrupting the session file and re-running any CLI succeeds (auto-recovery proves out).
- [ ] At least one workflow that previously needed a browser now runs in <2 s via direct API.
- [ ] At least one agent skill triggers the new CLI conversationally (no manual command needed).

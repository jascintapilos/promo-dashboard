# QC Hub Dashboard — Repo Split: Feasibility & Handoff Brief

**Prepared:** 2026-08-13
**For:** the infrastructure / tech team that owns `build.sgrts.com`, the Ansible deploy playbook, and the `aiodintech` Bitbucket workspace (Tommy / infra), plus Jascinta as requester.
**Question answered:** Can the QC Hub dashboard be cleanly split out of the `promo-automation` monorepo into its own repository, and if so, how — safely?

**How this was produced:** a read-only analysis of the actual import graph, deploy pipeline, shared-code overlap, secrets/git-history surface, and the reporting scanner, followed by an adversarial review pass that verified every claim against source. Nothing in the repo or on any live system was modified.

**One-line answer:** A *truly clean* split is not possible as the code stands, because the dashboard shares its most safety-critical, most-frequently-changed code with the promo tools it exists to check. It is **feasible via a staged shared-core extraction**, and the recommended first move is an in-place de-risking refactor — not an immediate physical git split.

---

## 1. FEASIBILITY VERDICT

**Not cleanly separable today; feasible via shared-core extraction preceded by one small-but-real refactor.** The dashboard is superficially separable at the edges and deeply coupled at the core.

- The **static frontend** (`public/qc-hub/*`, `public/dashboard.html`, `public/dashboard-switcher.css` — ~6,469 LOC, zero JS imports) lifts out cleanly. It talks to the server only over HTTP.
- The **dashboard backend** (`bin/qc-dashboard.mjs` + `src/qc-dashboard/` ≈ 6,800 LOC) **cannot**. Its import closure reaches **25 `src/` modules (~8,165 LOC) outside `src/qc-dashboard/`, and every one of those 25 is also used by the promo-automation (canary/ingest) side.** There is no dashboard-only shared module.
- This shared code is the **hottest code in the repo** (`api-mapper-qp2` 47 commits, `api-client` 33, `ingest` 33, `message-template-renderer`/`promo-namer` 15 each; ~25 commits to `api-mapper-qp2` in the last 90 days). The dashboard is a **QC tool** whose PASS/FAIL verdicts are only correct if this logic stays **byte-for-byte in lockstep** with the promo write-path it validates.

**Consequence:** copying or duplicating the shared core would drift within days and produce **silently-wrong QC verdicts** — the worst failure for a QC tool. So a physical split *forces* either a shared-library extraction or a "split-in-effect-not-in-git" arrangement.

**The nuance that changes the cost.** The 25 shared modules split into two tiers:

- **Tier 1 — irreducible core (~2,600 LOC):** called *directly* by dashboard QC code — `api-client`, `sites`, `google-auth`, `sheets-client`, `igmp-client`, `ops-sheet`, `structural-checks`, `mt-content-checks`, `campaign-checks`, `fs-lines-resolver`, `session-cache`, `qp2-popup-registry`, and 4 brand constants currently sourced from `live-codes`.
- **Tier 2 — transitive baggage (~5,400 LOC):** the heavy promo modules (`api-mapper-qp2`, `ingest`, `ingest-xlsx`, `message-template-renderer`, `copy-generator`, `promo-namer`, `blacklist-template`, `campaign-prefix-rules`, `request-requirements`, `game-provider-exclusions`, `free-spin-bet`, and runtime-only `sheets-ingest`) that no dashboard file imports directly.

**There is exactly ONE static drag edge pulling the whole Tier-2 mass into the boot graph: `src/qc-dashboard/brand-config.js` → `src/live-codes.js`.** `live-codes.js` then statically imports both heavy chains:
- `live-codes.js:9` → `api-mapper-qp2.js` → `message-template-renderer` (→ `ingest`, `copy-generator`) + `blacklist-template`, `promo-namer`, `game-provider-exclusions`, `request-requirements`, `free-spin-bet`; and
- `live-codes.js:11` → `sheets-client.js`, which at `sheets-client.js:33` imports `ingest-xlsx.js`.

So: **not clean today, but severing that single edge shrinks the dashboard's static boot surface from ~8,165 to ~2,600 LOC in one cut.** The catch: that one cut is **not** a trivial data move — it requires editing the hottest write-path file, `api-mapper-qp2.js` (see §2, §4).

---

## 2. RECOMMENDED STRATEGY

**Recommended: keep ONE git repo; give the dashboard a scoped deploy identity, fresh-history hygiene, and clear internal boundaries. Do NOT physically separate the code yet.** A "split in effect, not in git," staged:

1. **Now:** treat `aiodintech/qc-dashboard` (the Bitbucket deploy repo) as the dashboard's home; the promo tooling rides along unused on the server. Nothing physically moves. The pipeline already ships/serves only the dashboard.
2. **First refactor (low-to-moderate risk):** sever the single Tier-2 drag edge so the dashboard's boot surface drops to the ~2,600-LOC Tier-1 core. This is the prerequisite that makes any future physical split cheap.
3. **Only if a hard separation is later mandated:** extract the Tier-1 core into a **shared npm package** both repos depend on.

**The refactor's real cost.** Severing `brand-config → live-codes` means giving `brand-config.js` its 4 constants (`brandToSite`, `QPRO_BRANDS`, `QP2_MERCHANTS`, `IGMP_SITES`) from a data-only module instead. Three are static. **`QP2_MERCHANTS` is not:** `live-codes.js:19` computes it from `QP2_BRAND_TO_IDS`, which is **defined inside the hot write-path file `api-mapper-qp2.js:339` and used there at 5 sites (lines 250, 668, 957, 1057, 1272).** To lift `QP2_MERCHANTS` out, `QP2_BRAND_TO_IDS` must be relocated into the shared data module and re-imported back into `api-mapper-qp2.js`. **This edits the very write-path module that must stay stable** — so the refactor's verification must include the promo canary/write-path suite, not only the dashboard suite. Worth doing, but it is a real change to shared code, not a free data extraction.

**Why keep one repo now:**
- The shared core is the repo's most-churned code and QC correctness demands parity with the write-path. Physically separating by copying buys drift risk immediately with no operational gain — the server already deploys only the dashboard.
- The deploy story is *already* dashboard-scoped: `bitbucket-pipelines.yml` on `main` SSHes to `build.sgrts.com` and runs the Ansible playbook for `qc-dashboard`. The remaining pain is naming/scanner clarity — config, not code.
- Git history on both remotes still contains **unrotated leaked credentials** (§6), so *any* physical split must start from **fresh history** — there is no history-preservation prize to rush toward.

**Runner-up: shared npm package.** The only *sound* way to physically separate the two products, and the right end-state **if** the org genuinely needs two repos. It loses now because: (i) the shared package would effectively *be* the promo core (~2,600 LOC), version-locked and re-released on nearly every promo change (weekly); (ii) little practical benefit while both products share one deploy host and one team; (iii) it must not precede the Tier-2 severance or it drags ~8k LOC of promo internals the dashboard never calls.

**Rejected: copy shared subset into a new dashboard repo.** The Tier-1 core changes ~weekly; a divergent copy silently drifts into wrong QC verdicts. Non-starter for a QC tool.

---

## 3. WHAT MOVES vs WHAT STAYS / IS-SHARED

*(Under the recommended approach nothing physically moves yet — this is the boundary map any physical split must honor, and the set the scanner/deploy should be scoped to.)*

### Dashboard-owned (safe to isolate)
- **Server + worker entrypoints:** `bin/qc-dashboard.mjs`, `bin/qc-bo-relay-worker.mjs`, `bin/qc-hub-prod.bat`, `bin/qc-bo-relay-worker.bat`
- **Dashboard backend logic:** all of `src/qc-dashboard/` (22 modules + the 12-file `canonical/` subtree). `src/qc-dashboard/health.js` is the one folder member the running server never imports (used only by `bin/qc-acceptance-run.mjs`).
- **Static frontend (zero imports):** `public/qc-hub/{index.html, app.js, styles.css}`, `public/dashboard.html`, `public/dashboard-switcher.css`
- **Dashboard-owned data/config (in-repo):** `data/qc-dashboard-brands.json`; `admitted-users.json` (git-tracked, NOT a secret, read-only at runtime — auth allowlist with real staff emails = PII; must STAY tracked or the allowlist auto-deploy breaks); `qc-hub-config.json` (committed `googleClientId`; not secret); `admitted-users.example.json`, `bo-sites.example.json`
- **Dashboard-owned tests:** ~40 `test/qc-dashboard-*.test.mjs` + `qc-hub-health.test.mjs`
- **Pipeline:** `bitbucket-pipelines.yml`

### Shared core — used by BOTH sides (must NOT be forked/copied)
- **Tier 1 (~2,600 LOC, called directly):** `src/api-client.js`, `src/sites.js`, `src/google-auth.js`, `src/sheets-client.js`, `src/igmp-client.js`, `src/ops-sheet.js`, `src/structural-checks.js`, `src/mt-content-checks.js`, `src/campaign-checks.js`, `src/fs-lines-resolver.js`, `src/session-cache.js`, `src/qp2-popup-registry.js`, + 4 brand constants from `src/live-codes.js`.
  - Note: `sheets-client.js` (Tier 1) statically imports `ingest-xlsx.js` (`sheets-client.js:33`). So even after severing `brand-config → live-codes`, keeping `sheets-client` keeps `ingest-xlsx` in the closure. Full removal is out of scope for the one-cut refactor — the ~2,600-LOC figure is "Tier-1 core + `ingest-xlsx` tail," not a hard floor.
- **Tier 2 (refactor target, dragged in transitively):** `src/api-mapper-qp2.js`, `src/ingest.js`, `src/message-template-renderer.js`, `src/copy-generator.js`, `src/promo-namer.js`, `src/campaign-prefix-rules.js`, `src/blacklist-template.js`, `src/request-requirements.js`, `src/game-provider-exclusions.js`, `src/free-spin-bet.js`, and (runtime-only, via the dynamic `sheets-fallback`) `src/sheets-ingest.js`.
- **Shared data/config:** `bo-sites.json` (+ `bo-sites.local.json` passwords, `data/bo-sites-runtime.json` overlay), `data/brand-directory.json`, `data/fs-games-lines.json`, `data/deposit-withdrawal-limits.json`, `data/campaign-calendar.json`.

### Runtime state written by the server (gitignored — must persist across deploys)
- `data/bo-sites-runtime.json` (admin site-config overlay)
- `data/relay-secret.local.json` (relay HMAC secret)
- `qc-dashboard-session-secret.local.json` (auto-generated on first boot)

### Required gitignored config the server READS at runtime (must be provisioned on any new checkout)
- **`ops-sheet-id.local.json` — at REPO ROOT (not under `data/`).** Read by `src/ops-sheet.js` (`getOpsSheetId()` resolves `path.resolve('ops-sheet-id.local.json')` and **throws if missing**); called from `src/qc-dashboard/qc-log.js:98` on **every** QC-record save and history query. If absent on a new server checkout, QC logging and history break. Must be provisioned on deploy AND included in the rollback snapshot set.
- `google-*.local.json` (OAuth token/client for Sheets logging + read-only fallback)
- `bo-sites.local.json` (BO passwords — relay-worker side; server needs it only if it runs live BO fetches locally, which in production it does not — the relay does)
- `igmp-sessions.local.json` (IGMP session)

### npm dependencies
- **Dashboard needs:** `googleapis` (dynamic import) + Node built-ins. `playwright` is optional (dynamic import guarded inside admin `/api/diag/playwright`; core QC never needs it).
- **Promo-only:** `playwright`/`playwright-extra`/`puppeteer-extra-plugin-stealth`, `telegram`, `otplib`, `jsqr`, `sharp`, `@modelcontextprotocol/sdk`.

### Explicitly external (not in any repo — tech-team owned)
- Ansible playbook `/script/ansible/deploy/production/qc-dashboard.yml` on `build.sgrts.com`
- The self-hosted Bitbucket runner + `build.sgrts.com` deploy host
- Cloudflare/WAF in front of `https://qc-dashboard.zoom66.xyz`
- The external status/finding **scanner** emitting "QC Dashboard (qc-dashboard) — owner: @aethera01" (named nowhere in the repo; `@aethera01` is a real person/promo lead, not a bot)

---

## 4. EXECUTION STEPS

Staged. Stage A + B deliver most value at low risk; Stages C/D only if a physical repo separation is later required.

### Stage A — De-risk in place (no physical move)
1. **[Claude-doable — but touches the write-path]** Sever the single static drag edge (`brand-config.js → live-codes.js`) in one cut:
   - **1a.** Relocate `QP2_BRAND_TO_IDS` out of `src/api-mapper-qp2.js:339` into a new **data-only** module (e.g. `src/brand-ids.js`), and re-import it back into `api-mapper-qp2.js` at its 5 use sites (250, 668, 957, 1057, 1272). *Treat as a write-path change.*
   - **1b.** Move the 4 brand constants into the data-only module; `QP2_MERCHANTS` now derives from the relocated `QP2_BRAND_TO_IDS` there.
   - **1c.** Repoint `src/qc-dashboard/brand-config.js:2` at the data-only module instead of `../live-codes.js`.
2. **[Claude-doable — optional, near-no-op]** Optionally make `sheets-fallback.js`'s `sheets-ingest` import lazy for tidiness. Does NOT change the boot closure (`sheets-fallback` is already dynamically imported at `compare-flow.js:328`). Skip if it adds churn.
3. **[Claude-doable] Verify — both suites:** run the promo canary/write-path tests (they exercise `api-mapper-qp2`, edited in 1a) AND the dashboard suite; confirm via a boot smoke test that the `api-mapper-qp2` subtree is no longer in the dashboard boot graph.

> **Stage A DONE (2026-08-13).** Committed as an isolated write-path-touching change: new `src/brand-ids.js` (pure-data leaf) holds `QP2_BRAND_TO_IDS` + the 4 brand constants; `api-mapper-qp2.js` and `live-codes.js` import and re-export them (all ~24 downstream callers untouched); `brand-config.js` repointed. Verified: 644/644 tests pass; boot-graph trace confirms all 11 write-path modules gone from the dashboard graph (~5,070 LOC no longer loaded); `QP2_MERCHANTS.siteId` confirmed a pure move (`HEAD` was already `'ibc22'`, so no hidden bug-fix). Reviewed by Codex (SAFE TO COMMIT) + strategic-design-advisor (APPROVE WITH IMPROVEMENTS).
>
> **Backlog (separate `chore`, NOT part of this cut):** seven bin scripts still each re-derive `QP2_MERCHANTS` locally from `QP2_BRAND_TO_IDS` (`count-promos-ytd`, `backfill-banner-uploaded-*`, `pull-bo-*`, `pull-metrics`). Converge them onto `src/brand-ids.js` in a later low-risk pass to remove the drift-prone duplication the handover notes already flag.

### Stage B — Clarify the deploy/scanner identity (config only)
4. **[Tech-team-only]** Decide the naming end-state: keep `aiodintech/qc-dashboard` as the dashboard's repo and optionally give promo-automation its own slug later — OR keep one repo and accept the name covers both. Org decision.
5. **[Tech-team-only]** Re-point / confirm the external **scanner** scope. Keyed to the whole Bitbucket repo today; reassigning the `owner` tag involves `@aethera01` (a person) and the `aiodintech` Bitbucket admins. Nothing in-repo controls it.
6. **[Claude-doable]** Keep `admitted-users.json` and `qc-hub-config.json` tracked at root; keep all `*.local.json` gitignored.

### Stage C — ONLY if physically creating a new dashboard repo
7. **[Tech-team-only + Jascinta]** Decide new repo vs repurpose `aiodintech/qc-dashboard`. Because git history on *both* current remotes still contains **unrotated leaked credentials** (§6), the new repo MUST start from **fresh history** (`git init` from the scrubbed working tree), NOT a history-preserving clone/push. **Do NOT rewrite history on the live-deploy remote** — stand up the fresh-history repo under a **new slug** first and keep the original intact and deployable until cutover is confirmed (see §5).
8. **[Claude-doable]** In the fresh tree include: the dashboard-owned set (§3) **plus** the Tier-1 core (post-Stage-A, ~2,600 LOC + the `ingest-xlsx` tail). Author a README and a trimmed `package.json` (`googleapis` + optional `playwright`).
9. **[Claude-doable]** Copy `bitbucket-pipelines.yml` byte-for-byte (forwards no secrets; SSH + Ansible only).
10. **[Tech-team-only]** In the new repo's Bitbucket settings, create the **`production` deployment environment** and re-create its **secured variables** (a fresh repo has none). Recreate only what the playbook actually reads.
11. **[Tech-team-only]** **Register/bind the self-hosted runner** (`self.hosted, linux`) to the new repo (or workspace). Until bound, the pipeline queues forever.
12. **[Tech-team-only]** **Ansible playbook change on `build.sgrts.com`:** re-point the in-place checkout's git remote to the new repo (or re-clone). The playbook does an in-place `git pull` and relies on runtime state persisting across deploys — preserve **`data/relay-secret.local.json`, `data/bo-sites-runtime.json`, `qc-dashboard-session-secret.local.json`, AND `ops-sheet-id.local.json` (repo ROOT, not `data/`)**, plus `google-*.local.json`, or the relay key, site overlays, session secret, and QC logging/history break.
13. **[Tech-team-only]** Provision/confirm server-process env + required root config: `GOOGLE_CLIENT_ID` (or leave to `qc-hub-config.json`), `AUTH_MODE` unset (never `dev` in prod), `SESSION_SECRET` (or auto-generate), `RELAY_SECRET` only if env-managed, `PORT`, `BUILD_ID`. **Confirm `ops-sheet-id.local.json` exists at the checkout root** or `qc-log.js` throws on the first QC record.

### Stage D — Admin write-back, relay, cutover (physical-split path)
14. **[Claude-doable]** Admin write-back: the shipped flow commits nothing server-side — the admin edits the allowlist in the browser modal, copies the generated JSON, and pushes `admitted-users.json` via their own git. On a move, only the admin's local clone + the server checkout need re-pointing. (The unshipped R7.1 hard-codes the `aiodintech/qc-dashboard` slug + a repo-scoped token — do NOT ship it before/around a move.)
15. **[Jascinta/Tech-team]** Relay worker: `data/` must persist across deploys and the VDI worker's `QC_HUB_URL` must resolve to the server. The shared relay secret lives in `%USERPROFILE%\.qc-relay\relay-secret` on the VDI (outside the repo) — unaffected by a code move. Decide whether `bin/qc-bo-relay-worker.mjs` ships in the dashboard repo or stays in the monorepo.
16. **[Tech-team-only]** Cloudflare/WAF: if hostname/routing for `qc-dashboard.zoom66.xyz` changes, reconfigure it.
17. **[Tech-team-only + Jascinta]** Cutover: **a working staging deploy is a hard prerequisite, not "if possible"** (see §5, §7). Deploy from the new repo to staging, verify login (Google OAuth), a live QC run through the relay (also exercises `qc-log` → `ops-sheet-id.local.json`), and the admin users modal. Only then flip production and confirm a green deploy ships new code (not a stale pull).

---

## 5. ROLLBACK

- **Stage A (refactor):** pure code change on a branch. Because 1a edits `api-mapper-qp2.js`, abort criteria include a failing **promo write-path/canary** test, not just dashboard tests. Abort = don't merge / `git revert`.
- **Stage B (naming/scanner):** config-only in Bitbucket + external tool. Abort = restore the scanner's previous scope/owner; no code impact.
- **Stage C steps 7–9 (fresh repo build):** the new repo is inert until the server checkout is re-pointed. Abort = don't proceed; the live server keeps pulling the existing repo.
- **Stage C step 12 (server remote re-point) — the point of no easy return:**
  - Before changing the remote, record the current remote URL + deployed commit SHA, and snapshot the persistent state files: `data/relay-secret.local.json`, `data/bo-sites-runtime.json`, `qc-dashboard-session-secret.local.json`, **and `ops-sheet-id.local.json` (repo ROOT — a `data/`-only snapshot MISSES it)**, plus `google-*.local.json`.
  - The reset target must be a remote whose history was NOT rewritten. `git reset --hard <SHA>` only works if that SHA still exists on the remote. So keep the original `aiodintech/qc-dashboard` intact (no force-push) until cutover is confirmed green. Abort = re-point the server remote back to the original repo, `git reset --hard <recorded SHA>`, restore the snapshot, re-run the playbook.
  - Do NOT rely on the GitHub `origin` as the primary rollback target unless it's explicitly confirmed that (a) `build.sgrts.com` can authenticate and pull from GitHub, and (b) GitHub holds the identical deployed commit. Neither is verified today (§7).
- **Stage D cutover:** keep the old repo's pipeline intact and the runner able to deploy it. A confirmed-working staging deploy is required before flipping production. If the new deploy fails health checks, re-point remote to old repo, redeploy, restore snapshot.
- **Universal safety net:** never force-push rewritten history over the only clean copy of a remote until the fresh-init repo is confirmed deploying.

---

## 6. RISKS / WHAT COULD BREAK

1. **Silently-wrong QC verdicts from code drift (highest risk).** If the Tier-1 core is ever copied/forked and diverges from the promo write-path, the dashboard reports false PASS/FAIL. This is why copying is rejected and one-repo recommended.
2. **Stage-A refactor touches the hottest write-path file.** Relocating `QP2_BRAND_TO_IDS` out of `api-mapper-qp2.js` (5 call sites) changes a module with ~25 commits in 90 days that promo *saves* depend on. A mistake breaks promo creation, not just the dashboard. Mitigation: run the promo canary/write-path suite in Stage-A verification; land it as an isolated, reviewed change.
3. **Missing `ops-sheet-id.local.json` on the new checkout.** Gitignored, untracked, at repo **root**; `ops-sheet.js` throws if absent and `qc-log.js:98` calls it on every QC save/history query. A fresh checkout without it breaks QC logging — and a `data/`-only rollback snapshot silently misses it.
4. **Live secrets in git history.** Both remotes' history still contains **unrotated** credentials (QP2 `reqSignKey`, Gabrielle's GM01 password) plus already-changed ones. Any history-preserving clone/push re-exposes them. Fresh init is mandatory.
5. **Fragile rollback if history is rewritten on the deploy remote.** If the live-deploy repo's history is force-rewritten, the recorded deploy SHA no longer exists and `git reset --hard <SHA>` fails; falling back to GitHub assumes unverified server-side GitHub pull auth. Mitigation: keep the original Bitbucket repo intact until cutover; verify GitHub pull access before depending on it.
6. **No confirmed staging environment.** Both safe cutover and safe rollback assume a place to deploy-and-verify before flipping production; the pipeline shows only a single `production` environment. If none exists, cutover is a blind flip.
7. **Stale-code green deploys.** If the server checkout's remote isn't re-pointed, the playbook runs and reports success while pulling the OLD repo — green deploys that ship nothing new.
8. **Wiped runtime state on deploy.** If the playbook does a fresh clone instead of in-place pull, `data/relay-secret.local.json`, `data/bo-sites-runtime.json`, and root `ops-sheet-id.local.json` are lost.
9. **Broken allowlist auto-deploy.** If `admitted-users.json` becomes gitignored or the admin's/server's clone isn't re-pointed, allowlist edits silently never reach the server.
10. **Runner never picks up.** A new repo with no bound self-hosted runner queues the pipeline forever.
11. **Missing `production` environment / secured vars.** Fresh repo has none; the `deployment: production` step fails until recreated.
12. **R7.1 landmine.** If the server-side Bitbucket auto-commit feature ships before/around the move, its hard-coded `aiodintech/qc-dashboard` slug + repo-scoped token break on any rename/move.
13. **Scanner reports misattributed.** If the dashboard moves but the scanner stays scoped to the old repo, promo-automation findings keep appearing under a misleading "QC Dashboard" label, and `@aethera01` (a real person) stays wrongly tagged as owner.
14. **Cloudflare/WAF gate.** Hostname/routing changes for `qc-dashboard.zoom66.xyz` are outside the repo; miss it and the hub is unreachable.
15. **PII travel.** `admitted-users.json` carries real staff emails; if the new repo's read access differs, allowlist visibility changes with it.

---

## 7. OPEN QUESTIONS FOR THE TECH TEAM

*(Server-side unknowns not answerable from the repo. Items marked **[BLOCKS SAFE CUTOVER]** cannot be closed by any in-repo work.)*

1. **Playbook contents** `/script/ansible/deploy/production/qc-dashboard.yml`: in-place `git pull` or fresh clone? Deployed checkout path? Process supervisor (systemd/pm2/other) for `node bin/qc-dashboard.mjs` on PORT 4321? Which env vars injected vs read from committed files?
2. **Persistent root file provisioning:** confirm `ops-sheet-id.local.json` exists at the deployed checkout root and survives the deploy step (it is at root, not `data/`, so any `data/`-scoped persistence rule misses it).
3. **Staging environment:** does a staging port/host exist to deploy-and-verify the new repo before flipping production? **[BLOCKS SAFE CUTOVER]**
4. **GitHub pull access from the server:** can `build.sgrts.com` authenticate and pull from `github.com/jascintapilos/promo-automation`, and does GitHub hold the identical deployed commit? (Rollback leans on this.)
5. **Secured variables:** do `ADMITTED_USERS_JSON` / `BITBUCKET_REPO_TOKEN` exist as Bitbucket `production` secured variables today, and does the playbook read them? Are `GOOGLE_CLIENT_ID` / `RELAY_SECRET` injected by Ansible or taken from committed files?
6. **Self-hosted runner scope:** registered at **workspace** scope (reusable) or **repo** scope (must be re-registered)?
7. **SSH credential:** which key does the `atlassian/ssh-run` pipe use to reach `build.sgrts.com` (SSH user `bitbucket`), and where configured?
8. **Repo intent:** new dashboard repo, or repurpose the existing one? Does promo-automation get its own new Bitbucket slug + scanner registration?
9. **The scanner itself:** what tool emits "QC Dashboard (qc-dashboard) — owner: @aethera01"? Where configured? How is `owner` set, and where are reports delivered? None of this is in the repo.
10. **Hosting source of truth:** production runs on `build.sgrts.com` per the pipeline, but `docs/plans/qc-hub-deployment.md` describes an alternative VDI + Cloudflare-Tunnel hosting (marked DRAFT/blocked). Which is authoritative?
11. **Cloudflare/WAF:** what routing/Access rules front `qc-dashboard.zoom66.xyz`, and what changes if hostname/origin moves?
12. **Relay worker home:** should `bin/qc-bo-relay-worker.mjs` ship in the dashboard repo or stay with the monorepo, given it (not the server) holds the BO credentials?

---

**Bottom line.** The frontend is easy; the backend is not, because the dashboard shares its most safety-critical, most-frequently-changed code with the promo tools it exists to check. The split is **feasible but only via a shared-core extraction**, and the enabling refactor is not free — cutting the dashboard's one boot-time drag edge (`brand-config → live-codes`) requires relocating `QP2_BRAND_TO_IDS` out of the hottest write-path file, so it must be verified against the promo canary suite too. Safe sequence: (1) do that one in-place cut and shrink the dashboard's boot surface to the ~2,600-LOC core; (2) treat the existing Bitbucket `qc-dashboard` repo as the dashboard's home with a clarified scanner/deploy identity. A truly separate repo is worth doing **only** if the org later needs it, via a shared npm package built from **fresh git history**, never by copying shared code — and only after the tech team closes the cutover blockers (staging environment, playbook behavior, `ops-sheet-id.local.json` provisioning, GitHub pull access).

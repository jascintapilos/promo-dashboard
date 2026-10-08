# Plan: QC Hub — "Seamless for daily use" · Phase 1

> **Handoff contract for Codex.** Written per the CLAUDE.md "Codex implementation handoff" workflow: Claude plans → Codex implements each workstream via `codex exec` → Claude reviews against acceptance criteria. Codex has zero context beyond this file + the repo + `memory/MEMORY.md`.

**Status:** IN_PROGRESS
**Created:** 2026-10-07
**Goal:** The promo team can open the live QC Hub every day and get a trustworthy *automatic* verdict on the highest-volume brands — the whole QP2 family (QP2A/B/C/D) plus the proven QPRO1 & QPRO5 — with no babysitting and no surprise "manual" when the data exists.
**Architecture:** Five small, independently-deployable workstreams against the live hub server (`bin/qc-dashboard.mjs` + `src/qc-dashboard/*` + `public/qc-hub/*`). Each is built and verified inside an isolated git worktree cut from the deploy branch, boot-tested in prod mode, then pushed to `bitbucket/main` (which auto-deploys) **only on explicit owner approval**.
**Tech/Tools:** Node 18+ (ESM, `node:test`, `node --check`), PowerShell 5.1 + Task Scheduler (VDI relay), git worktrees, curl. No new npm deps.
**Design:** [docs/plans/2026-10-07-qc-hub-seamless-phase1-design.md](2026-10-07-qc-hub-seamless-phase1-design.md)

---

## ⚠ CRITICAL DEPLOY RULES (read before any task)

These apply to **every** workstream. Violating them has already caused a live 502 outage once.

1. **The deploy target is `bitbucket/main`** (remote `git@bitbucket.org:aiodintech/qc-dashboard.git`). A push there auto-deploys to the live hub `https://qc-dashboard.zoom66.xyz`. Also mirror to `origin` (GitHub) per the two-remote convention, because the VDI working copy auto-pulls `origin/main`.
2. **This checkout is a diverged feature branch** (`fix/promo-category-fs-namer-parity`, ~36 ahead / 67 behind main) with ~230 untracked files and uncommitted edits. **Do NOT commit, push, or copy this branch's files onto main.** Specifically, on this branch these files are STALE/WRONG vs the deployed version and must never ride to prod:
   - `bin/qc-dashboard.mjs` — branch is 791 lines; **main is 1024 lines** (has the promo-report gate, admin-users, relay routes the branch lacks).
   - `src/qc-dashboard/relay-auth.js` — branch **dropped** the `MAX_REPORT_BUILD_BYTES` export that main's `bin/qc-dashboard.mjs` imports → copying it to main crashes startup → 502.
   - `public/qc-hub/app.js`, `public/promo/login.html` — differ from main.
3. **ALWAYS edit inside a worktree cut from `bitbucket/main`:**
   ```bash
   git fetch bitbucket
   git worktree add -b feat/qc-<ws> .deploy-wt/<ws> bitbucket/main
   ```
   Make all edits, run all tests, and boot-test **inside `.deploy-wt/<ws>`**. All line numbers in this plan refer to the **main** version of each file (confirm with `wc -l` where noted).
4. **502 landmine guard — boot-test the exact committed tree in prod mode before every push.** A worktree contains only tracked files, so a clean prod-mode boot proves no untracked file rides along:
   ```bash
   cd .deploy-wt/<ws>
   GOOGLE_CLIENT_ID="$(node -e "console.log(require('./qc-hub-config.json').googleClientId)")" PORT=4399 node bin/qc-dashboard.mjs
   # expect: "QC Hub listening on http://localhost:4399" within ~3s, no stack trace. Then stop.
   ```
   (`qc-hub-config.json` and `admitted-users.json` are **tracked** on main, so prod boot has what it needs. `AUTH_MODE=dev` is the fallback if the client id isn't handy — it still loads the full module graph.)
5. **Stage only named files.** Never `git add -A`. Before commit run the secret guard:
   ```bash
   git diff --cached --name-only | grep -Ei '\.local\.json$|^bo-sites\.json$|secret|token' && echo "ABORT: secret staged" && exit 3 || true
   ```
6. **Never push without explicit owner approval** (CLAUDE.md/AGENTS.md). Each workstream ends at a CHECKPOINT; the live push is a separate, owner-gated action.
7. **Commit trailer:** end every commit message with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

### Deploy Gate `G` (referenced by every workstream — do NOT repeat inline)
Inside the workstream's worktree, after local tests pass: (a) stage only the named files; (b) run the secret guard; (c) prod-mode boot-test (rule 4); (d) `git commit`; (e) **CHECKPOINT — owner approves**; (f) `git fetch bitbucket main` (must fast-forward; if main advanced, re-boot-test); (g) `git push bitbucket HEAD:main` then `git push origin HEAD:main`; (h) verify live via the `deploy-check` marker (see WS0-T3); (i) `git worktree remove .deploy-wt/<ws>`.

---

## File Map

**A1 — Sheet fallback**
- Create: `src/qc-dashboard/sheets-fallback.js` — cached read-only Promo Request Sheet resolver (verbatim, already proven 15/15).
- Create: `test/qc-dashboard-sheets-fallback.test.mjs` — the regression test (local-bundle wins / sheet used when local not-found).
- Modify: `src/qc-dashboard/compare-flow.js` — append `runComparisonWithSheetsFallback` (async, lazy-imports the resolver).
- Modify: `bin/qc-dashboard.mjs` — `/api/run-qc` calls the async wrapper instead of `runComparison` (main line 18 import, line 527 call).
- Modify: `test/qc-dashboard-mvp-gate.test.mjs` — source-text token `runComparison(` → `runComparisonWithSheetsFallback(`.

**B+C — Enable QP2B/C/D + data-driven onboarding + usage guide** (merged: both scouts edit `brand-config.js`)
- Modify: `data/qc-dashboard-brands.json` — flip `qcRules.mvp` false→true for QP2B/C/D.
- Modify: `src/qc-dashboard/brand-config.js` — delete hardcoded `MVP_BRANDS`; derive `enabled` from `brand.enabled === true || qcRules.mvp === true`.
- Modify: `test/qc-dashboard-mvp-gate.test.mjs` — expected sets → 7 brands (shared file with A1; sequence B+C after A1 or combine the edit).
- Create: `docs/qc-hub-usage.md` — one-page team guide.

**A3 — Friction fixes**
- Modify: `public/qc-hub/app.js` — localStorage persist/restore + code-not-found labelling.
- Modify: `src/qc-dashboard/qc-log.js` — `dedupeByUuid` + apply in `queryHistory`.
- Modify: `public/qc-hub/styles.css` — `.verdict.not-found` + `.chip.not-found`.
- Create: `test/qc-dashboard-qc-log-dedup.test.mjs` — dedupe unit test.

**A2 — Relay auto-recovery (VDI)**
- Modify: `bin/qc-bo-relay-worker.mjs` — file logging + secret auto-reload on repeated 401/403.
- Create: `bin/qc-bo-relay-worker.ps1` — keep-awake + crash-relaunch launcher.
- Create: `bin/qc-bo-relay-setup.ps1` — one-shot Task Scheduler registrar.
- Modify: `docs/plans/qc-bo-relay.md` — runbook update.

**WS0 — Shared tooling (do first)**
- Create: `bin/deploy-hub-worktree.sh` — optional convenience wrapper for Gate `G` (boot-test + guarded push).

---

## Suggested week schedule
- **Day 1:** WS0 (deploy tooling) → **A1** (sheet fallback — biggest lever, clean port) → deploy on approval.
- **Day 2:** **B+C** (enable QP2B/C/D — the volume headline; verify the gameprovider-500 blocker live first) → deploy on approval.
- **Day 3:** **A3** (friction fixes) → deploy on approval.
- **Day 4:** **A2** (relay worker hardening + VDI Task Scheduler registration) → deploy + one-time VDI setup.
- **Day 5:** Full end-to-end verification across QP2A–D + QPRO1/5, finalize usage guide, team handoff.

---

## Tasks

### WS0 — Shared deploy tooling

#### Task WS0-1: Create the reusable boot-test + guarded-push script

- [ ] **WS0-1**

**Files:** Create `bin/deploy-hub-worktree.sh`

**Step 1:** Create the script with this content (DRY wrapper for Gate `G`; a LOCAL tool, never itself deployed):
```bash
#!/usr/bin/env bash
# bin/deploy-hub-worktree.sh — SHARED safe boot-test + guarded push for the QC Hub.
# Boot-tests the CURRENT worktree tree in prod mode, then pushes to bitbucket/main + origin/main only with --push.
# Run from inside a worktree cut from bitbucket/main (the edits already committed or staged there).
# Usage: DEPLOY_MSG="feat: ..." bin/deploy-hub-worktree.sh [--push] [--marker <token>] <file1> [file2 ...]
set -euo pipefail
PUSH=0; MARKER=""; FILES=()
while [ $# -gt 0 ]; do case "$1" in
  --push) PUSH=1; shift;;
  --marker) MARKER="$2"; shift 2;;
  *) FILES+=("$1"); shift;; esac; done
[ ${#FILES[@]} -gt 0 ] || { echo "no files given"; exit 2; }
PORT=4399
GCID="$(node -e "console.log(require('./qc-hub-config.json').googleClientId)")"
if [ -n "$MARKER" ] && [ -f public/promo/login.html ]; then
  sed -i "2s|.*|<!-- deploy-check: $MARKER -->|" public/promo/login.html; FILES+=("public/promo/login.html"); fi
git add -- "${FILES[@]}"
if git diff --cached --name-only | grep -Ei '\.local\.json$|^bo-sites\.json$|secret|token'; then echo "ABORT: secret-like file staged"; exit 3; fi
echo "Staged:"; git diff --cached --name-only
PORT=$PORT GOOGLE_CLIENT_ID="$GCID" node bin/qc-dashboard.mjs > /tmp/hub-deploy-boot.log 2>&1 &
for i in $(seq 1 20); do c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://localhost:$PORT/api/config" || true); [ "$c" = "200" ] && break; sleep 0.5; done
cfg=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT/api/config" || true)
root=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT/" || true)
promo=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT/promo/ws1" || true)
echo "boot: /api/config=$cfg /=$root /promo/ws1=$promo"
WPID=$(netstat -ano 2>/dev/null | grep ":$PORT" | grep LISTENING | awk '{print $5}' | head -1 || true)
[ -n "${WPID:-}" ] && taskkill //PID "$WPID" //F >/dev/null 2>&1 || true
if [ "$cfg" != "200" ] || [ "$root" != "200" ] || [ "$promo" != "200" ]; then echo "ABORT: boot-test failed"; cat /tmp/hub-deploy-boot.log; exit 4; fi
if [ "$PUSH" = "1" ]; then
  [ -n "$(git diff --cached --name-only)" ] && git commit -m "${DEPLOY_MSG:?set DEPLOY_MSG}"
  git push bitbucket HEAD:main && git push origin HEAD:main && echo "PUSHED to bitbucket/main + origin/main"
else
  echo "DRY-RUN OK — boot-test PASSED (3x200). Re-run with --push to deploy."
fi
```

**Step 2:** `chmod +x bin/deploy-hub-worktree.sh`

**Verify:** `bash -n bin/deploy-hub-worktree.sh && echo SYNTAX_OK` prints `SYNTAX_OK`.

> **Note:** Using this script is optional — the explicit Gate `G` steps work too. Either way, the boot-test (3× 200) is **mandatory** before any push.

---

### WS A1 — Wire the live Promo Request Sheet fallback into Run QC

> **Why first:** biggest lever (kills most "manual" results) and it's a clean PORT — the code already exists and passed 15/15 on this branch; it's just absent from main. Create the two new files from the verbatim content below (do **not** copy this branch's `compare-flow.js` — it carries out-of-scope changes).

#### Task A1-1: Cut the worktree

- [ ] **A1-1**

**Step 1:** `git fetch bitbucket && git worktree add -b feat/qc-hub-sheets-fallback .deploy-wt/sheets-fallback bitbucket/main`
**Verify:** `git -C .deploy-wt/sheets-fallback rev-parse --abbrev-ref HEAD` → `feat/qc-hub-sheets-fallback`; `wc -l < .deploy-wt/sheets-fallback/bin/qc-dashboard.mjs` → `1024` (confirms it's the main version). If it's not 1024, abort and recut.

#### Task A1-2: Add `sheets-fallback.js`

- [ ] **A1-2** — Depends: A1-1

**Files:** Create `.deploy-wt/sheets-fallback/src/qc-dashboard/sheets-fallback.js`

**Step 1:** Copy the proven file from the reference checkout (it is byte-identical to the verified original and self-contained):
`cp src/qc-dashboard/sheets-fallback.js .deploy-wt/sheets-fallback/src/qc-dashboard/sheets-fallback.js`
(It imports only `../sheets-ingest.js` + `../sheets-client.js`, both byte-identical on main. Every failure is caught internally → returns not-found, never throws.)

**Verify:** `node --check .deploy-wt/sheets-fallback/src/qc-dashboard/sheets-fallback.js` exits 0; a module import prints `_clearSheetsFallbackCache,resolveExpectedSourceFromSheet`.

#### Task A1-3: Append the async wrapper to `compare-flow.js`

- [ ] **A1-3** — Depends: A1-2

**Files:** Modify `.deploy-wt/sheets-fallback/src/qc-dashboard/compare-flow.js`

**Step 1:** Confirm the file ends with `_safeMessage` (main has no sheets fallback). Append at end-of-file, verbatim:
```js
export async function runComparisonWithSheetsFallback({ brand, code, handle = null, snapshot, brandConfig, deps = {} } = {}) {
  const resolveExpectedSource = deps.resolveExpectedSource || _defaultResolve;
  const primary = resolveExpectedSource({ brand, code, handle });
  // Local file already resolved it, or local ambiguity is itself authoritative — don't let the sheet override.
  if (primary && (primary.source || primary.sourceType === 'ambiguous')) {
    return runComparison({ brand, code, handle, snapshot, brandConfig, deps: { ...deps, resolveExpectedSource: () => primary } });
  }
  let sheetResult = null;
  try {
    const resolveFromSheet = deps.resolveExpectedSourceFromSheet
      || (await import('./sheets-fallback.js')).resolveExpectedSourceFromSheet;
    sheetResult = await resolveFromSheet({ brand, code, handle });
  } catch {
    sheetResult = null; // Sheets unavailable (no OAuth token etc.) — fall through to the local not-found result, never throw.
  }
  const finalSrc = (sheetResult && (sheetResult.source || sheetResult.sourceType === 'ambiguous')) ? sheetResult : primary;
  return runComparison({ brand, code, handle, snapshot, brandConfig, deps: { ...deps, resolveExpectedSource: () => finalSrc } });
}
```

**Step 2:** Keep the import **lazy** (`await import(...)`). Do NOT add a top-level import of `sheets-fallback.js` — the relay path (`runComparisonFromRelay`) also loads this module and a static import would pull googleapis into startup for a path that never uses it.

**Verify:** `node --check` exits 0; module import prints `function function` for `typeof runComparisonWithSheetsFallback, typeof runComparison`.

#### Task A1-4: Point `/api/run-qc` at the wrapper

- [ ] **A1-4** — Depends: A1-3

**Files:** Modify `.deploy-wt/sheets-fallback/bin/qc-dashboard.mjs`

**Step 1:** Line 18: `import { runComparison } from '../src/qc-dashboard/compare-flow.js';` → `import { runComparisonWithSheetsFallback } from '../src/qc-dashboard/compare-flow.js';` (the separate `runComparisonFromRelay` import at line 24 stays).
**Step 2:** Line 527 (inside `codes.map(async (code) => {` at 507, inside a `try{` at 526, gated by `if (isMvpBrand)` at 525): `const cmp = runComparison({ brand, code, handle, snapshot, brandConfig: selected });` → `const cmp = await runComparisonWithSheetsFallback({ brand, code, handle, snapshot, brandConfig: selected });`
**Step 3:** Do not touch the relay-path `runComparisonFromRelay` call (~line 900).

**Verify:** `node --check` exits 0; `grep -c 'await runComparisonWithSheetsFallback(' bin/qc-dashboard.mjs` → `1`; `grep -c 'runComparison(' bin/qc-dashboard.mjs` → `0` (bare token gone; the `FromRelay`/`WithSheetsFallback` names don't contain the literal `runComparison(`).

#### Task A1-5: Port the regression test + fix the mvp-gate token

- [ ] **A1-5** — Depends: A1-4

**Files:** Create `.deploy-wt/sheets-fallback/test/qc-dashboard-sheets-fallback.test.mjs`; Modify `.deploy-wt/sheets-fallback/test/qc-dashboard-mvp-gate.test.mjs`

**Step 1:** `cp test/qc-dashboard-sheets-fallback.test.mjs .deploy-wt/sheets-fallback/test/qc-dashboard-sheets-fallback.test.mjs` (228 lines, all Sheets access dependency-injected → no network/OAuth; this IS the required regression proof: local-bundle resolves locally with no sheet call; local not-found uses the sheet).
**Step 2:** In `test/qc-dashboard-mvp-gate.test.mjs` line 42, `indexOf('runComparison(')` → `indexOf('runComparisonWithSheetsFallback(')`; update the two human strings (comment line 11, assert message ~line 48) to match.

**Verify:** `cd .deploy-wt/sheets-fallback && node --test test/qc-dashboard-sheets-fallback.test.mjs test/qc-dashboard-compare-flow.test.mjs test/qc-dashboard-mvp-gate.test.mjs` → `fail 0` (≈32 tests: 15 fallback + ~15 compare-flow unchanged + 2 gate).

#### Task A1-6: Boot-test + Deploy Gate G

- [ ] **A1-6** — Depends: A1-5

**Step 1:** Stage exactly the 5 paths: `git add src/qc-dashboard/sheets-fallback.js src/qc-dashboard/compare-flow.js bin/qc-dashboard.mjs test/qc-dashboard-sheets-fallback.test.mjs test/qc-dashboard-mvp-gate.test.mjs`
**Step 2:** Secret guard (CRITICAL rule 5). Confirm the lazily-imported module resolves on the tree: `node --input-type=module -e "import('file://$(pwd)/src/qc-dashboard/sheets-fallback.js')"` exits 0.
**Step 3:** Prod-mode boot-test (CRITICAL rule 4) — expect `QC Hub listening`.
**Step 4:** `git commit -m "feat(qc-hub): resolve expected-source from live Promo Request Sheet when no local bundle exists"` (+ Co-Authored-By trailer).

**Verify:** `git status --porcelain` empty (no `??` ride-alongs); `git show --stat --oneline HEAD` lists exactly those 5 files; dev boot logs `QC Hub listening`.

**→ CHECKPOINT:** Show the owner the 5-file diff + green tests + boot log. On approval, finish Gate `G` (push to bitbucket + origin, verify live). **Blocker to flag:** the fallback only helps on the hub host if Google creds exist there (`google-oauth-token.local.json` + `google-oauth-client.local.json`, or `google-credentials.local.json`). Check on the hub host: `node bin/sheets-test.mjs` exits 0. If absent, A1 is a safe no-op (same MANUAL_REQUIRED as today) until creds are provisioned — raise with whoever owns the server.

---

### WS B+C — Enable QP2B/C/D + data-driven onboarding + usage guide

> Volume headline. All four QP2 merchants share one back office (`ibc22`, user `promo_testbot`), differing only by `merchant_id` (already forwarded by the read path) — so **no new site or credentials**, just flip flags. Merged with C's `brand-config.js` refactor so the change is made once.

#### Task BC-1: Cut the worktree + verify the gameprovider-500 blocker LIVE (do this before flipping anything)

- [ ] **BC-1**

**Step 1:** `git fetch bitbucket && git worktree add -b feat/qc-hub-enable-qp2bcd .deploy-wt/qp2bcd bitbucket/main`; `cd .deploy-wt/qp2bcd`.
**Step 2:** Confirm shared creds resolve (do NOT print the value): `node -e "import('./src/sites.js').then(m=>{const s=m.getSite('ibc22');console.log('hasPw=',!!s.password)})"` → `hasPw= true`.
**Step 3:** Probe the known-flaky endpoint for all four QP2 merchants (health uses `bypassMvpGate`, so it works pre-flip):
`node -e "import('./src/qc-dashboard/health.js').then(async m=>{for(const b of ['QP2A','QP2B','QP2C','QP2D']){const h=await m.getBrandHealth(b,{skipCache:true});console.log(b,h.connectivity,'prov.err=',h.evidence&&h.evidence.providers.error)}})"`

**Verify:** each line → `READY prov.err= null`. **If any shows HTTP 500: STOP and escalate** before enabling. (Per `health.js:91-118` the provider catalogue is non-load-bearing — QC still produces verdicts — but don't roll out degraded without a decision.)

#### Task BC-2: Flip QP2B/C/D to `mvp:true`

- [ ] **BC-2** — Depends: BC-1

**Files:** Modify `data/qc-dashboard-brands.json`

**Step 1:** Set `"qcRules": { "mvp": true, ... }` on the QP2B, QP2C, QP2D rows (lines 4/5/6). Leave QP2A and all others untouched. Keep valid JSON.

**Verify:** `node -e "const j=require('./data/qc-dashboard-brands.json'); console.log(j.brands.filter(b=>b.qcRules&&b.qcRules.mvp).map(b=>b.id).sort().join(','))"` → `QP2A,QP2B,QP2C,QP2D,QPRO1,QPRO5,WS1_MY`.

#### Task BC-3: Make `enabled` data-driven (remove hardcoded `MVP_BRANDS`)

- [ ] **BC-3** — Depends: BC-2

**Files:** Modify `src/qc-dashboard/brand-config.js`

**Step 1:** Delete line 6: `const MVP_BRANDS = new Set(['QP2A', 'QPRO1', 'QPRO5', 'WS1_MY']);`
**Step 2:** Change the map (line 30) `enabled: MVP_BRANDS.has(brand.id)` → `enabled: brand.enabled === true || (brand.qcRules && brand.qcRules.mvp === true)`. Leave validation + sort + `buildBrandList` unchanged.
**Step 3:** `grep -rn MVP_BRANDS src/ bin/` → zero hits.

**Verify:** `node --input-type=module -e "import('./src/qc-dashboard/brand-config.js').then(m=>console.log(m.loadQcBrandConfig().filter(b=>b.enabled).map(b=>b.id).sort().join(',')))"` → `QP2A,QP2B,QP2C,QP2D,QPRO1,QPRO5,WS1_MY`. (This also closes a latent drift bug: `isMvpBrand` and `preflight.js` already read `qcRules.mvp`; `enabled` now shares that single source of truth.)

#### Task BC-4: Update the mvp-gate test to the 7-brand set

- [ ] **BC-4** — Depends: BC-3

**Files:** Modify `test/qc-dashboard-mvp-gate.test.mjs`

**Step 1:** Lines 27 and 35: expected arrays → `['QP2A','QP2B','QP2C','QP2D','QPRO1','QPRO5','WS1_MY']`. Update the header comment (lines 6-11) to the 7-brand reality.
> If A1 already landed, its token edit (line 42) is on main; keep it.

**Verify:** `node --test test/qc-dashboard-mvp-gate.test.mjs` → `pass 4 / fail 0`. Then the suite: `node --test test/qc-dashboard-*.test.mjs` → `fail 0`.

#### Task BC-5: Write the one-page usage guide

- [ ] **BC-5**

**Files:** Create `docs/qc-hub-usage.md` (audience: non-engineer promo team; one screen, plain words, no code). Sections: **Sign in** (open hub URL → Sign in with Google → work account; ask admin if refused); **Run a code** (pick enabled brand, paste code(s), Run); **The three states** — PASS = live promo matches the request, nothing to do; FAIL = live promo differs, open findings → fix in BO → re-run; MANUAL = hub couldn't auto-verify (BO unreachable or brand not on the automated path) → check the BO yourself; **What "manual" means** (not a failure — asks a human to look); **When to use Manual Pass** (only after checking the BO; on a MANUAL result, enter reason ≥10 chars + evidence; recorded under your name, kept separate from an automated PASS; you cannot Manual-Pass a FAIL). End: "If a brand you need is missing it may not be enabled yet — ask the admin to flip it on in `data/qc-dashboard-brands.json`."

**Verify:** `test -f docs/qc-hub-usage.md && grep -qi 'sign in' docs/qc-hub-usage.md && grep -qi 'Manual Pass' docs/qc-hub-usage.md && echo GUIDE_OK` → `GUIDE_OK`.

#### Task BC-6: Live-verify the opened gate (local dev server)

- [ ] **BC-6** — Depends: BC-4

**Step 1:** `AUTH_MODE=dev PORT=4399 node bin/qc-dashboard.mjs &` → wait for listening.
**Step 2:** `curl -s 'http://localhost:4399/api/preflight?brand=QP2B'` (then QP2C, QP2D) → each `status:"READY"` (was `NOT_ENABLED`).
**Step 3:** Sample auto-QC on the shared host — QP2C: `curl -s -X POST http://localhost:4399/api/run-qc -H 'content-type: application/json' -d '{"brand":"QP2C","codes":["RET_CRM_REL_88PCT_12X"]}'` → HTTP 200 JSON with `results` + `preflight.status:"READY"` (promo 1682 exists on QP2C). Repeat QP2D with `FT_RET_CRM_SIL_150PCT_12X_MIN200` (1519). For QP2B (no local code) reuse the QP2C code — a "promotion not found on this merchant" verdict still PASSES this task (proves the `coming soon` 400 gate is gone). Stop the server.

**Verify:** each `/api/run-qc` → HTTP 200 with `"results"` + `"preflight"`, NOT `{"error":"QP2C is not enabled — coming soon"}`.

#### Task BC-7: Deploy Gate G

- [ ] **BC-7** — Depends: BC-6, BC-5

**Step 1:** Stage only: `data/qc-dashboard-brands.json src/qc-dashboard/brand-config.js test/qc-dashboard-mvp-gate.test.mjs docs/qc-hub-usage.md`. Secret guard. Prod-mode boot-test.
**Step 2:** Commit `feat(qc-hub): enable QP2B/C/D auto-QC + data-driven brand onboarding + usage guide`.

**Verify:** `git show --stat --oneline HEAD` lists exactly those 4 files; boot logs `QC Hub listening`.

**→ CHECKPOINT:** owner approves → push (bitbucket + origin) → verify live. **Watch the first live QP2 run** for the expected ripple: `probeDuplicateAcrossMvp` now fires 3 extra concurrent reads on the shared `ibc22` session and emits a WARNING "Same code also found on MVP brand(s): QP2B/C/D" (by-design, WARNING not FAIL) — confirm no `Session-Expired`/401 in the server log.

---

### WS A3 — Friction fixes (persistence, duplicate row, three states)

> Three independent low-risk fixes. `qc-log.js`, `verdict-engine.js`, `styles.css` are byte-identical on main; `app.js` differs from main only at two spots **outside** the edit regions — so edit **main's** `app.js` in the worktree (do not copy this branch's).

#### Task A3-1: Cut the worktree

- [ ] **A3-1**
**Step 1:** `git fetch bitbucket && git worktree add -b feat/qc-hub-friction .deploy-wt/friction bitbucket/main`; `cd .deploy-wt/friction`.
**Verify:** `wc -l < bin/qc-dashboard.mjs` → `1024`.

#### Task A3-2: Dedupe History by uuid (latest-wins)

- [ ] **A3-2** — Depends: A3-1

**Files:** Modify `src/qc-dashboard/qc-log.js`

**Step 1:** After `readQcLog` (ends line 65) insert exported helper:
```js
export function dedupeByUuid(records) {
  // Append-only JSONL: a failed sheet write appends a SECOND line with the same uuid.
  // Collapse to the most-recent line per uuid for VIEW purposes; the raw log stays intact.
  const byUuid = new Map();
  const noUuid = [];
  for (const r of records) {
    if (r && r.uuid) byUuid.set(r.uuid, r); // later entries overwrite earlier → latest wins
    else if (r) noUuid.push(r);
  }
  return [...byUuid.values(), ...noUuid];
}
```
**Step 2:** In `queryHistory` (line 148): `const rows = await readQcLog();` → `const rows = dedupeByUuid(await readQcLog());` (dedupe before filter so aggregate counts stop double-counting). Do NOT change `readQcLog`, `saveQcRecord`, or `findDuplicateRecent` — keeping the double-append preserves append-only/log-first-durability; dedupe-on-read mirrors the Sheet's own uuid upsert.

**Verify:** `node -e "import('./src/qc-dashboard/qc-log.js').then(m=>{const mk=(u,s)=>({uuid:u,timestamp:new Date().toISOString(),qc_result:'NOT_SAFE',sheet_pending:s});const out=m.dedupeByUuid([mk('A',false),mk('A',true),mk('B',false)]);console.log(out.length, out.find(r=>r.uuid==='A').sheet_pending);})"` → `2 true`.

#### Task A3-3: Dedupe unit test

- [ ] **A3-3** — Depends: A3-2

**Files:** Create `test/qc-dashboard-qc-log-dedup.test.mjs` — import `{ dedupeByUuid, normalizeQcRecord }`; assert two same-uuid lines collapse to one (pending wins), distinct uuids preserved, uuid-less legacy records kept (3 tests; offline).

**Verify:** `node --test test/qc-dashboard-qc-log-dedup.test.mjs` → `pass 3 / fail 0`.

#### Task A3-4: Three distinct result states (client labelling only)

- [ ] **A3-4** — Depends: A3-1

**Files:** Modify `public/qc-hub/app.js` (main version)

**Step 1:** Before `function verdictLabel` (line 636) add:
```js
function isCodeNotFound(result) {
  return Array.isArray(result?.findings) && result.findings.some((f) => f && f.check === 'code-not-found');
}
```
**Step 2:** `verdictLabel` (636-644): before `return 'FAIL';` add `if (v === 'NOT_SAFE' && isCodeNotFound(result)) return 'NOT FOUND';`
**Step 3:** `verdictClass` (646-657): before `return 'not-safe';` add `if (v === 'NOT_SAFE' && isCodeNotFound(result)) return 'not-found';`
**Step 4:** `verdictWords` — change signature to `function verdictWords(v, count, result) {`; before the final FAIL return add `if (v === 'NOT_SAFE' && isCodeNotFound(result)) return \`CODE NOT FOUND - this promo code does not exist on the back office (check the code, or it may not be created yet)\`;`. (Optional) sharpen the MANUAL_REQUIRED copy to lead with "COULDN'T REACH THE BACK OFFICE".
**Step 5:** Update the two `verdictWords` call sites (line 907 and line 1303) to pass `data` as the 3rd arg.
**Step 6:** Do NOT touch `src/qc-dashboard/verdict-engine.js` — code-not-found must stay `NOT_SAFE` in the engine (terminal-state test + no-false-pass invariant). This is client labelling only, keyed off the `code-not-found` finding the server already sends.

**Verify:** `node --check public/qc-hub/app.js` exits 0; `grep -c "isCodeNotFound" public/qc-hub/app.js` → `4`; `grep -c "verdictWords(data.verdict, data.findings.length, data)" public/qc-hub/app.js` → `2`.

#### Task A3-5: `.not-found` badge CSS

- [ ] **A3-5** — Depends: A3-4

**Files:** Modify `public/qc-hub/styles.css`

**Step 1:** After line 341 (`.verdict.not-safe {...}`) add `.verdict.not-found { border-left: 3px solid var(--accent); }`. After line 373 (`.chip.not-safe {...}`) add `.chip.not-found { color: var(--accent); background: var(--accent-soft); }`. (`--accent` is blue — distinct from safe-green/review-pink/manual-amber/not-safe-red/pending-muted.)

**Verify:** `grep -c "not-found" public/qc-hub/styles.css` → `2`.

#### Task A3-6: Persist results across refresh (localStorage, per-user)

- [ ] **A3-6** — Depends: A3-4

**Files:** Modify `public/qc-hub/app.js`

**Step 1:** After the `state` block (closing `};` at line 12) insert the persist/restore helpers (per-user key, 8h TTL, demote in-flight relay jobs to a terminal `LOST`/MANUAL_REQUIRED state on restore, all wrapped in try/catch so a disabled localStorage is a silent no-op). Use the verbatim block from the design scout (RESULTS_CACHE_PREFIX / persistResults / restoreResults).
**Step 2:** Hook `persistResults();` as the last statement of `renderPills` (line 885 — the single choke point both render paths funnel through, and it self-clears the cache when results go empty) and the last line of `persistRemarksFromForm` (line 149).
**Step 3:** In `init()` insert `restoreResults();` immediately before `renderEmptyStates();` (line 1566) — `state.user` is already set by `ensureLogin()` at 1554.

**Verify:** `node --check public/qc-hub/app.js` exits 0; `node --test test/qc-dashboard-client-syntax.test.mjs` → `pass 1`; `grep -n "persistResults();" public/qc-hub/app.js` shows it in `renderPills` + `persistRemarksFromForm`; `grep -n "restoreResults();" public/qc-hub/app.js` shows it in `init`. **Manual (browser) check at Gate:** run a QC, press F5 → results + chosen verdicts survive; a non-existent code shows a blue **NOT FOUND** badge (not red FAIL); a real FAIL stays red; a BO-unreachable brand stays amber MANUAL.

#### Task A3-7: Boot-test + Deploy Gate G

- [ ] **A3-7** — Depends: A3-3, A3-5, A3-6

**Step 1:** Stage only: `src/qc-dashboard/qc-log.js public/qc-hub/app.js public/qc-hub/styles.css test/qc-dashboard-qc-log-dedup.test.mjs`. Secret guard.
**Step 2:** `node --test test/*.test.mjs` → `fail 0` (terminal-state + verdict-engine tests prove code-not-found still = NOT_SAFE, no MANUAL_PASS leak). Prod-mode boot-test.
**Step 3:** Commit `fix(qc-hub): persist results across refresh, dedupe History rows, distinct NOT-FOUND state`.

**Verify:** `git show --stat --oneline HEAD` lists exactly those 4 files; full suite `fail 0`; boot logs listening.

**→ CHECKPOINT:** owner approves → push → verify live (incl. the browser checks above on the live hub).

---

### WS A2 — Relay worker auto-recovery on the office VDI

> QPRO1/5 reliability. The office VDI is the only host, so "always-on" = self-heal within VDI uptime (logon trigger + hourly watchdog + crash-relaunch + keep-awake). Worker already has backoff/5xx-tolerance/graceful-shutdown — only add file-logging + secret-reload. **A2 touches NO hub files** (worker + launchers + doc only), which keeps it off the 502-risk path — but still base it on a main worktree and never let this branch's `relay-auth.js` ride along.

#### Task A2-1: Cut the worktree

- [ ] **A2-1**
**Step 1:** `git fetch bitbucket && git worktree add -b feat/qc-relay-autorecover .deploy-wt/relay bitbucket/main`; `cd .deploy-wt/relay`.
**Verify:** `git show bitbucket/main:src/qc-dashboard/relay-auth.js | grep -c MAX_REPORT_BUILD_BYTES` → `1` (confirms you're on the good base; never commit a version lacking it).

#### Task A2-2: Worker — tee JSON logs to a file

- [ ] **A2-2** — Depends: A2-1

**Files:** Modify `bin/qc-bo-relay-worker.mjs`

**Step 1:** After the last import (line 22) add `import { appendFileSync } from 'node:fs'; import os from 'node:os'; import path from 'node:path';`. After line 29 add `const LOG_FILE = process.env.QC_RELAY_LOG_FILE || path.join(os.homedir(), '.qc-relay', 'qc-bo-relay-worker.log');`.
**Step 2:** In `log()` (32-38) replace the `console.log(JSON.stringify(safe))` line with a capture-once-then-append-best-effort form (console + `appendFileSync(LOG_FILE, line + '\n')`, each in its own try/catch so it never throws).

**Verify:** `node --check bin/qc-bo-relay-worker.mjs` exits 0; `node --test test/qc-dashboard-relay-worker.test.mjs` → `pass 14 / fail 0`.

#### Task A2-3: Worker — auto-reload relay secret on repeated auth failure

- [ ] **A2-3** — Depends: A2-2

**Files:** Modify `bin/qc-bo-relay-worker.mjs`

**Step 1:** After `let currentDelay = POLL_MIN_MS;` (~line 44) add `let authFailStreak = 0; const AUTH_FAIL_RELOAD_THRESHOLD = 3;`.
**Step 2:** In `defaultDeps.leaseJobs` (174-179): on `r.status === 200` reset `authFailStreak = 0`; in the non-200 branch, on 401/403 increment the streak and once it hits the threshold re-read `readWorkerRelaySecret()` (already imported line 17) and, if present and changed, swap `RELAY_SECRET` and `log('info','secret-reloaded',{status:'rotated'})`, then reset the streak. Still return `[]` on non-200 so the idle-backoff path is unchanged.

**Verify:** `node --check` exits 0; `node --test test/qc-dashboard-relay-worker.test.mjs` → `pass 14`; `grep -n "secret-reloaded" bin/qc-bo-relay-worker.mjs` → 1 line.

#### Task A2-4: Keep-awake + crash-relaunch launcher

- [ ] **A2-4** — Depends: A2-1

**Files:** Create `bin/qc-bo-relay-worker.ps1` (mirror `bin/gm01-keepalive.ps1`). Resolves `$Root`, sets `QC_HUB_URL` default `https://qc-dashboard.zoom66.xyz` + `QC_RELAY_WORKER_ID`, arms `SetThreadExecutionState(0x80000001)` (ES_CONTINUOUS|ES_SYSTEM_REQUIRED — system awake, monitor may sleep), then runs node in an infinite relaunch loop with capped backoff, logging lifecycle to `%USERPROFILE%\.qc-relay\qc-bo-relay-worker.log`. Use the verbatim script from the scout output.

**Verify:** `powershell -NoProfile -Command "$e=$null; [void][System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path 'bin\qc-bo-relay-worker.ps1'),[ref]$null,[ref]$e); if($e){$e;exit 1}else{'PARSE OK'}"` → `PARSE OK`; `grep SetThreadExecutionState bin/qc-bo-relay-worker.ps1` matches.

#### Task A2-5: Task Scheduler registrar

- [ ] **A2-5** — Depends: A2-4

**Files:** Create `bin/qc-bo-relay-setup.ps1` (clone `bin/gm01-keepalive-setup.ps1`). Registers task `QC BO Relay`: `-AtLogOn` (+PT30S delay) + hourly watchdog, `RestartCount 10`, `MultipleInstances IgnoreNew`, `StartWhenAvailable`, battery flags on, Interactive/Limited principal, action runs the wrapper `-WindowStyle Hidden -ExecutionPolicy Bypass`. No admin rights. Use the verbatim script from the scout output.

**Verify:** PowerShell parse check → `PARSE OK`. (Do NOT run it in verify — registering is the one-time infra step A2-7.)

#### Task A2-6: Update the relay runbook

- [ ] **A2-6** — Depends: A2-5

**Files:** Modify `docs/plans/qc-bo-relay.md` — replace the manual Task-Scheduler GUI section (195-203) with the one-command `bin\qc-bo-relay-setup.ps1` flow; document logon+watchdog+RestartCount, keep-awake, the log path, and add a `### VDI auto-recovery runbook (A2)` subsection (prereqs: secret at `%USERPROFILE%\.qc-relay\relay-secret`, `QC_HUB_URL` default, node path; health check: admin `GET /api/admin/relay-health` shows `offline:false` within ~35s of logon). Note it's best-effort within VDI uptime.

**Verify:** `grep -n "qc-bo-relay-setup.ps1" docs/plans/qc-bo-relay.md` and `grep -n "VDI auto-recovery runbook" docs/plans/qc-bo-relay.md` each return a line.

#### Task A2-7: Boot-test + Deploy Gate G, then one-time VDI registration

- [ ] **A2-7** — Depends: A2-3, A2-6

**Step 1:** Stage only: `bin/qc-bo-relay-worker.mjs bin/qc-bo-relay-worker.ps1 bin/qc-bo-relay-setup.ps1 docs/plans/qc-bo-relay.md`. Secret guard. Prod-mode hub boot-test (proves the worktree still starts — A2 doesn't touch hub files, but the boot-test is mandatory). Commit `feat(qc-hub): auto-recovering BO relay worker (keep-awake + logon task + self-heal)`.
**Step 2:** **→ CHECKPOINT** → owner approves → push (bitbucket + origin).
**Step 3 (INFRA, one-time on the VDI, after the VDI pulls origin/main):** from the repo root on the VDI: confirm `Test-Path 'C:\Program Files\nodejs\node.exe'` and the relay secret exists (≥32 bytes); `powershell -ExecutionPolicy Bypass -File bin\qc-bo-relay-setup.ps1`; `Start-ScheduledTask -TaskName 'QC BO Relay'`; tail `%USERPROFILE%\.qc-relay\qc-bo-relay-worker.log` for `launching worker` + a worker startup line.

**Verify:** `Get-ScheduledTask -TaskName 'QC BO Relay' | Select State` → Ready/Running; log tail shows a recent `launching worker`. **Human acceptance (admin hub session):** `GET /api/admin/relay-health` lists this worker `offline:false`; then run a QPRO1 code in the hub and confirm it auto-QCs (not MANUAL) with the VDI worker up.

---

## Acceptance criteria (maps to the design's success criteria)

- [ ] **A1:** a requested code present in the Promo Request Sheet but with no local bundle produces an automatic verdict (not MANUAL) for all four QP2 merchants; a code WITH a local bundle still resolves locally (regression test green).
- [ ] **B+C:** `/api/preflight?brand=QP2B|QP2C|QP2D` → READY; a sample `/api/run-qc` on each → HTTP 200 with a real verdict (not the `coming soon` 400); enabled set = the 7 brands; adding a future brand is a `brands.json` edit (+ the mvp-gate expected array) with no `src/`/`bin/` change.
- [ ] **A3:** refresh no longer blanks results; History shows no duplicate rows; a not-found code shows a distinct blue NOT FOUND badge, unreachable shows amber MANUAL, a real failure shows red FAIL — verdict engine semantics unchanged (no false pass).
- [ ] **A2:** after a VDI logon the relay worker is back online automatically (relay-health `offline:false`) with no manual steps; a QPRO1/5 code auto-QCs; worker self-heals on crash; VDI kept awake.
- [ ] **Overall:** full `node --test test/*.test.mjs` → `fail 0`; every deploy boot-tested in prod mode before push; usage guide published; team access confirmed.

## Consolidated risks / blockers

1. **Google creds on the hub host (A1)** — fallback is a no-op without them. Check `node bin/sheets-test.mjs` on the server; provision if missing.
2. **QP2 `/api/bo/gameprovider` HTTP 500 (B)** — verify live in BC-1 before flipping; non-load-bearing but don't roll out degraded silently.
3. **Shared `ibc22` session contention (B)** — enabling B/C/D adds 3 concurrent reads to the duplicate-probe; watch the first live run for `Session-Expired`.
4. **Branch-vs-main divergence / 502 landmine (ALL)** — enforced by the worktree-from-main rule + prod-mode boot-test + stage-by-name + secret guard. Never copy this branch's `bin/qc-dashboard.mjs` or `relay-auth.js` to main.
5. **VDI uptime (A2)** — no always-on box; QPRO reliability is bounded by VDI uptime (QP2 is unaffected — server-readable). Self-heal re-arms on logon.
6. **Live pushes are owner-gated (ALL)** — each CHECKPOINT stops before the push; never auto-push.

---
> **Execution note:** Per CLAUDE.md, implement each workstream via `codex exec --sandbox workspace-write` pointed at this plan, one workstream at a time; Claude reviews `git status`/`git diff` against the acceptance criteria after each, and drives the owner-gated Deploy Gate `G` (Codex does not push or do live BO writes). Workstreams A1, B+C, A3, A2 are independent and can be done in that priority order.

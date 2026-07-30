# Promo Automation — Codex Guide

Working directory: `C:\Users\vdiuser\Downloads\promo-automation\promo-automation`

---

## Team memory (shared rules — read every session)

Read [`memory/MEMORY.md`](memory/MEMORY.md) at the start of every session. It indexes shared feedback rules, QC patterns, platform quirks, and project context that apply to all operators. When you save a new memory during a session, also commit the file to `memory/` so teammates get it on next pull.

---

## Auto-flow rules (MUST follow)

When the user prompts a promo request — phrasings like **"canary P172"**, **"fire P172"**, **"go P172"**, **"canary P175-P180"**, or a pasted Slack delegation with P### / B### — Codex **MUST** execute this sequence automatically without asking for permission step-by-step:

> **AVOID "process P###" and "run P###"** — both trigger the Anthropic built-in `promo-batch-runner` skill and bypass this flow. Use **"canary P###"** or **"fire P###"** as the primary triggers.

1. **`node bin/ingest-requests.js`** — refresh from sheet
1.5. **⚠ MANDATORY — Show summary table immediately** — Read `captures/requests/<handle>.json` and output the summary table as the **very first thing in your reply**, before running any QC or canary commands. Do NOT skip this step. Do NOT defer it. The user must see the resolved fields before anything else. Fields by bonus type:
   - **Deposit/Reload:** `Code` | `Name EN` | `Name ZH` | `Name ID` | `Bonus %` | `Min Deposit` | `Max Bonus` | `TO` | `Validity` | `Reward Validity` | `Campaign` | `Brands` | `Regions`
   - **Free Credit:** `Code` | `Name EN` | `Name ZH` | `Name ID` | `FC Amount` | `Max Transfer Out` | `TO` | `Validity` | `Reward Validity` | `Campaign` | `Brands` | `Regions`
   - **Free Spin:** `Code` | `Name EN` | `Name ZH` | `Name ID` | `Spins` | `Spin Value` | `Game` | `Min Deposit` | `TO` | `Validity` | `Reward Validity` | `Campaign` | `Brands` | `Regions`
   - Show one row per currency when `per_currency_overrides` has different values — never collapse differing amounts into one row.
   - Skip columns that are not applicable for the bonus type (e.g. no Spins column on a Deposit promo).
   - For batch requests (P### range), show one row per handle.
1.6. **WS1/WS2 FT prefix decision — mandatory:** If any target is WS1 or WS2 and the source does not explicitly say whether `FT_` is required, ask the operator: **“Does this WS1/WS2 promo need the `FT_` prefix?”** Stop before validation/dry-run until answered. Pass a chat answer through as `--ft-prefix` or `--no-ft-prefix`. Source phrases such as “Add FT to code” and “No FT prefix” count as explicit answers and do not require another question.
2. **`node bin/canary-validate.js <handle>`** — deterministic source/intent gate. If RETURN, STOP and surface what to fix.
3. **`node bin/canary-multi-brand.js <handle> --parallel`** — dry-run (writes plan bundles and automatically runs deterministic plan validation)
4. **Agent QC fallback only when requested or unusual** — use `/qc-engine` or `/pre-qc` for ambiguous copy/business review, not for mechanical checks already covered by `canary-validate`.
5. **WAIT for user direction.** Do NOT auto-commit. User says "commit it" or "fix X first".
6. **`node bin/canary-multi-brand.js <handle> --commit --parallel --parallel-qc`** — live save (only after user confirms)
6.5. **WS1/WS2 Welcome Bonus — Rewards tab (automated):** The canary auto-assigns Welcome Bonus promos to the WELCOME BONUS Promotion Suite (Id=1) immediately after activation. Check canary output for `✓ Added to WELCOME BONUS suite`. If a `→ Manual` fallback line appears instead, go to BO → Promotion Suite → WELCOME BONUS → Rewards tab → add the PromotionId shown.
7. **Deterministic post-save QC is built into the canary runners** — Level 1/2/3 must pass or the runner output is not clean.
8. **`/deep-qc <handle>` is optional/adversarial** — run Sentinel for unusual promos, audits, or when the user asks for independent deep QC.
9. **`node bin/sheets-writeback.mjs <handle> --field=status --value="QC Completed" --commit`** — write QC Completed back to sheet after deterministic post-save QC has no FAIL. If Sentinel was explicitly run and returns FAIL, do not write QC Completed.

**Skip conditions:**
- User says "skip qc" or "no qc" in their message → run only the canary commands, no skill invocations — **but still log the skip** (see QC Results Log persistence below): after the commit, write `{"code","brand","handle","stage":"skip"}` entries per brand and run `node bin/log-qc-results-batch.mjs --input=tmp/qc-log-<handle>-skip.json --commit` so the log shows `Not Evaluated` instead of a silently missing row.
- Idempotency fails (code already on BO for ALL brands) → no plan bundles get written; surface the idempotency block and stop
- Deterministic validation returns RETURN/FAIL → STOP. Tell the user what to fix; do not attempt dry-run or commit.

**QC Results Log persistence (MANDATORY):** every QC gate persists its verdicts to the 'QC Results Log' tab via `node bin/log-qc-results-batch.mjs --input=<entries.json> --commit` — this is step 5 inside each of the three skills (/qc-engine, /pre-qc, /deep-qc). Never end a QC gate without the log write: RETURN/FAIL/INCONCLUSIVE and skips are all logged explicitly. This feeds the per-brand monitoring system (see docs/promo-monitoring-system-proposal.md Phase 1) — a missing row silently biases every downstream pass-rate metric.

**Each QC skill spawns its sub-agent with EXACTLY this prompt** — keep it short, no exploration:

```
# /qc-engine
subagent_type: "promo-qc-engine"
prompt: |
  Triage — validate the promo request at: captures/requests/<handle>.json
  Read ONLY that file. Do not Glob or Grep other files. Return only the JSON within 30 seconds.

# /pre-qc
subagent_type: "promo-qc"
prompt: |
  Pre-QC — review the planned promotion at: captures/qc-plans/<handle>__<brand>.json
  Read ONLY that file. Do not Glob or Grep other files. Return only the JSON within 30 seconds.

# /deep-qc
subagent_type: "sentinel"
prompt: |
  Sentinel — validate the saved promo at: captures/qc-bundles/<handle>__<brand>.json
  Read ONLY that file. Do not Glob or Grep other files. Return only the JSON within 60 seconds.
```

Send all sub-agents for one skill in **a single Agent-tool message** so they run in parallel. Total wall-clock per skill should be ~5-15s, never minutes. If a sub-agent exceeds 60s, cancel and report INCONCLUSIVE — do not wait.

---

## WS1/WS2 workbook clone flow (MUST follow)

When the operator asks to probe an OLD Promo Code from a workbook and create a
NEW Promo Code with the same persisted mechanics, this is a BO clone/migration
request — it is **not** a Promo Request `P###` canary.

Use only:

```bash
# Read-only planning; explicit rows/numbers are mandatory
node bin/clone-igmp-from-workbook.mjs --rows=<sheet-row-selector>
node bin/clone-igmp-from-workbook.mjs --numbers=<manifest-number-selector> --tab=WS1

# Create exactly one approved destination inactive
node bin/clone-igmp-from-workbook.mjs --commit --plan=<plan-file> --approve=<exact-plan-hash>

# Separate approved activation after persisted verification
node bin/clone-igmp-from-workbook.mjs --activate --plan=<plan-file> --approve=<exact-plan-hash>
```

Mandatory rules:

1. Never route workbook clones through `ingest-requests.js` or synthesize a
   `P###` request.
2. Never issue improvised raw `/PM/Add*` calls for a workbook clone.
3. The workbook's NEW Promo Code is exact. Do not infer, add, remove, or rewrite
   a prefix.
4. Source and destination region/site must be explicit for every row. Never
   fill down a visually grouped blank Region cell.
5. Planning is read-only and must retrieve the complete source promotion,
   type-specific detail, RewardId, and all reward-content locales.
6. Stop if the source is incomplete, the destination exists, the source changes
   after approval, or any lookup is inconclusive.
7. Live creation starts inactive. Missing reward, missing content, or any
   persisted diff is a hard failure and the partial destination is quarantined.
8. Activation is a separate approval. Never deactivate the old promotion as a
   side effect of cloning.
9. Do not mark the workbook row Done/QC Completed from a create response.

Full runbook: `docs/igmp-workbook-clone-workflow.md`.

---

## Git workflow

### Branch strategy
This project uses **trunk-based development** — all work goes directly to `main`.
Feature branches are optional for large changes or when collaborating on the same files simultaneously.

### Commit message format
```
<type>: <short description>

Types:
  feat    — new capability (new promo type, new brand, new skill)
  fix     — bug fix in canary/mapper/ingest/QC
  chore   — dependency update, .gitignore, config, rename
  data    — brand-directory.json or limit data changes
  skill   — Codex skill updates (.Codex/skills/ or user-skills/)
  docs    — documentation changes only
```

Examples:
```
feat: add WS2 deposit bonus mapper
fix: QP2 auto_reward_activation not set after save
chore: archive 218 one-off migration scripts to bin/_archive/
data: add THB currency limits for QP2
skill: update pre-qc to check FS spin count against 88-spin rule
```

### When to commit and push

**Codex must NEVER commit or push automatically.** Only commit and/or push when the user explicitly asks (e.g. "commit this", "push it") — never as a routine end-of-session or end-of-task step, and never as a side effect of an unrelated request.

When the user does explicitly ask, Codex must:

1. Check what changed — `git status` and `git diff --stat`
2. Verify no secrets are staged — confirm no `*.local.json` appears in `git status`
3. Stage only the files relevant to the requested change — never use `git add -A` blindly, and never stage other, unrelated pre-existing modifications sitting in the working tree even if they're convenient to include; prefer `git add bin/ src/ data/ docs/ .Codex/ user-skills/` scoped to the actual changed files
4. Commit with a clear message
5. Push only if the user's request included pushing, or after confirming with the user — `git push origin main`

**Do NOT commit:**
- `captures/` — API run logs (gitignored, stays local)
- `*.local.json` — credentials and sessions (gitignored)
- `logs/`, `tmp/`, `tmp-plans/`, `tmp-runs/` — runtime artifacts (gitignored)
- `node_modules/` — dependencies (gitignored)

### Auto-sync hook (partially configured)
The project `.codex/hooks.json` pre-wires ONE non-destructive hook — **do not tell the user to run this manually**:
- **Auto-pull + memory sync**: fires on prompt submit → silently runs `git pull origin main --ff-only` and copies `memory/*.md` into the local memory directory, so the user always has the latest code and shared memory.

There is **no automatic commit or push**. Codex only commits/pushes when the user explicitly asks — see "When to commit and push" above.

**History (2026-07-16):** this file previously also documented an "Auto-push: fires when the session ends → auto-commits and pushes any changed files" hook, and `.codex/hooks.json` had a matching `Stop` hook that did exactly that. Both were removed after a review found this created a real risk of silently overriding an explicit user "do not commit/push yet" instruction the moment a session ended. Users still never need to run `git pull` manually — only `git push`/`git commit` now require an explicit ask.

### Quick reference (pull is automatic; commit/push require an explicit user ask)
```bash
# Manual pull if needed outside a Codex session
git pull origin main

# After making changes
git status                        # see what changed
git diff --stat                   # summary of changes
git add bin/ src/ data/ docs/     # stage source files
git add .Codex/ user-skills/     # stage skill changes
git commit -m "fix: description"
git push origin main

# Check remote is in sync
git log --oneline -5
git log --oneline origin/main -5
```

### Collaborator setup (new teammate)
1. Clone: `git clone https://github.com/jascintapilos/promo-automation.git`
2. **Open the cloned `promo-automation` folder directly in Codex** — do NOT open a parent folder that contains it. The QC agents (`promo-qc-engine`, `promo-qc`, `sentinel`) only load when Codex is launched from this folder.
3. Install deps: `npm install`
4. Install Codex skills (Windows): `install-skills.bat`
5. Get credentials from Jascinta: `bo-sites.local.json` + `google-oauth-token.local.json`
6. Verify: `node bin/sheets-test.mjs`

Full guide: `docs/TEAM-QUICKSTART.md`

---

## Protected files — never commit
| Pattern | What it contains |
|---|---|
| `*.local.json` | BO passwords, OAuth tokens, TOTP secrets, session cookies |
| `bo-sites.json` | Live BO site config with internal URLs |
| `captures/` | API run logs, QC bundles, screenshots |
| `logs/` | Keepalive and nightly pull logs |
| `ft-api-calls-ws1.json` | API shape dev file (large, local only) |

---

## Promo automation — daily commands (for reference; auto-flow rules above handle these)

```bash
# Step 1: Pull latest requests from sheet
node bin/ingest-requests.js

# Step 2: Deterministic source validation
node bin/canary-validate.js P###

# Step 3: Dry-run (no BO writes)
node bin/canary-multi-brand.js P###

# Step 4: Deterministic plan validation (also auto-runs after dry-run)
node bin/canary-validate.js P### --plan

# Step 5: Commit to BO (live)
node bin/canary-multi-brand.js P### --commit
node bin/canary-multi-brand.js P### --commit --parallel --parallel-qc   # multi-brand

# Step 6: Optional adversarial audit (Sentinel)
/deep-qc P###
```

---

## Project structure

| Path | Purpose |
|---|---|
| `bin/` | CLI runners — canary, ingest, sheets, banner, health-check |
| `bin/_archive/` | One-off migration/fix scripts (historical reference) |
| `src/` | Core modules — mappers, API client, ingest, namer |
| `data/` | Brand directory + deposit/withdrawal limits |
| `docs/` | Setup guides, quickstart, API notes |
| `.Codex/skills/` | Project-level Codex skills (auto-loaded in this dir) |
| `user-skills/` | User-level skills (install via `install-skills.bat`) |
| `apps-script/` | Google Apps Script code for dashboard + control tower |
| `Banner/` | Banner source images |
| `captures/` | (gitignored) API run logs, QC bundles |

---

## GitHub repo
`https://github.com/jascintapilos/promo-automation` (private)

Add collaborators: Settings → Collaborators on GitHub.

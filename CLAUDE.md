# Promo Automation — Claude Code Guide

Working directory: `C:\Users\vdiuser\Downloads\promo-automation\promo-automation`

---

## Team memory (shared rules — read every session)

Read [`memory/MEMORY.md`](memory/MEMORY.md) at the start of every session. It indexes shared feedback rules, QC patterns, platform quirks, and project context that apply to all operators. When you save a new memory during a session, also commit the file to `memory/` so teammates get it on next pull.

---

## Auto-flow rules (MUST follow)

When the user prompts a promo request — phrasings like **"canary P172"**, **"fire P172"**, **"go P172"**, **"canary P175-P180"**, or a pasted Slack delegation with P### / B### — Claude **MUST** execute this sequence automatically without asking for permission step-by-step:

> **AVOID "process P###" and "run P###"** — both trigger the Anthropic built-in `promo-batch-runner` skill and bypass this flow. Use **"canary P###"** or **"fire P###"** as the primary triggers.

1. **`node bin/ingest-requests.js`** — refresh from sheet
1.5. **⚠ MANDATORY — Show summary table immediately** — Read `captures/requests/<handle>.json` and output the summary table as the **very first thing in your reply**, before running any QC or canary commands. Do NOT skip this step. Do NOT defer it. The user must see the resolved fields before anything else. Fields by bonus type:
   - **Deposit/Reload:** `Code` | `Name EN` | `Name ZH` | `Name ID` | `Bonus %` | `Min Deposit` | `Max Bonus` | `TO` | `Validity` | `Reward Validity` | `Campaign` | `Brands` | `Regions`
   - **Free Credit:** `Code` | `Name EN` | `Name ZH` | `Name ID` | `FC Amount` | `Max Transfer Out` | `TO` | `Validity` | `Reward Validity` | `Campaign` | `Brands` | `Regions`
   - **Free Spin:** `Code` | `Name EN` | `Name ZH` | `Name ID` | `Spins` | `Spin Value` | `Game` | `Min Deposit` | `TO` | `Validity` | `Reward Validity` | `Campaign` | `Brands` | `Regions`
   - Show one row per currency when `per_currency_overrides` has different values — never collapse differing amounts into one row.
   - Skip columns that are not applicable for the bonus type (e.g. no Spins column on a Deposit promo).
   - For batch requests (P### range), show one row per handle.
2. **`/qc-engine <handle>`** — Triage Officer (READY / NOTE / RETURN). If RETURN, STOP and surface what to fix.
3. **`node bin/canary-multi-brand.js <handle> --parallel`** — dry-run (writes plan bundles)
4. **`/pre-qc <handle>`** — Pre-QC Agent (PASS / WARNING / FAIL). Present the table.
5. **WAIT for user direction.** Do NOT auto-commit. User says "commit it" or "fix X first".
6. **`node bin/canary-multi-brand.js <handle> --commit --parallel --parallel-qc`** — live save (only after user confirms)
6.5. **WS1/WS2 Welcome Bonus — Rewards tab (automated):** The canary auto-assigns Welcome Bonus promos to the WELCOME BONUS Promotion Suite (Id=1) immediately after activation. Check canary output for `✓ Added to WELCOME BONUS suite`. If a `→ Manual` fallback line appears instead, go to BO → Promotion Suite → WELCOME BONUS → Rewards tab → add the PromotionId shown.
7. **`/deep-qc <handle>`** — Sentinel (PASS / WARNING / FAIL / INCONCLUSIVE). Present the verdict.
8. **`node bin/sheets-writeback.mjs <handle> --field=status --value="QC Completed" --commit`** — write QC Completed back to sheet. Run this after every deep-qc, regardless of WARNING or INCONCLUSIVE, as long as there is no FAIL.

**Skip conditions:**
- User says "skip qc" or "no qc" in their message → run only the canary commands, no skill invocations — **but still log the skip** (see QC Results Log persistence below): after the commit, write `{"code","brand","handle","stage":"skip"}` entries per brand and run `node bin/log-qc-results-batch.mjs --input=tmp/qc-log-<handle>-skip.json --commit` so the log shows `Not Evaluated` instead of a silently missing row.
- Idempotency fails (code already on BO for ALL brands) → no plan bundles get written; surface the idempotency block and stop
- Triage returns RETURN → STOP. Tell the user what to fix; do not attempt dry-run. The RETURN verdict still gets logged (skill step 5).

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
  skill   — Claude Code skill updates (.claude/skills/ or user-skills/)
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

**After every session that modifies project files**, Claude must:

1. Check what changed — `git status` and `git diff --stat`
2. Verify no secrets are staged — confirm no `*.local.json` appears in `git status`
3. Stage only source files — never use `git add -A` blindly; prefer `git add bin/ src/ data/ docs/ .claude/ user-skills/`
4. Commit with a clear message
5. Push — `git push origin main`

**Do NOT commit:**
- `captures/` — API run logs (gitignored, stays local)
- `*.local.json` — credentials and sessions (gitignored)
- `logs/`, `tmp/`, `tmp-plans/`, `tmp-runs/` — runtime artifacts (gitignored)
- `node_modules/` — dependencies (gitignored)

### Auto-sync hooks (already configured)
The project `.claude/settings.json` has two hooks pre-wired — **do not tell the user to run these manually**:
- **Auto-pull**: fires on every message → silently runs `git pull origin main --ff-only` so the user always has the latest code
- **Auto-push**: fires when the session ends → auto-commits and pushes any changed files

Users never need to run `git pull` or `git push` manually. The hooks handle it.

### Quick reference (for reference only — hooks handle pull/push automatically)
```bash
# Manual pull if needed outside a Claude session
git pull origin main

# After making changes
git status                        # see what changed
git diff --stat                   # summary of changes
git add bin/ src/ data/ docs/     # stage source files
git add .claude/ user-skills/     # stage skill changes
git commit -m "fix: description"
git push origin main

# Check remote is in sync
git log --oneline -5
git log --oneline origin/main -5
```

### Collaborator setup (new teammate)
1. Clone: `git clone https://github.com/jascintapilos/promo-automation.git`
2. **Open the cloned `promo-automation` folder directly in Claude Code** — do NOT open a parent folder that contains it. The QC agents (`promo-qc-engine`, `promo-qc`, `sentinel`) only load when Claude Code is launched from this folder.
3. Install deps: `npm install`
4. Install Claude Code skills (Windows): `install-skills.bat`
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

# Step 2: Triage source row (Triage Officer)
/qc-engine P###

# Step 3: Dry-run (no BO writes)
node bin/canary-multi-brand.js P###

# Step 4: Pre-QC the plan (Pre-QC Agent)
/pre-qc P###

# Step 5: Commit to BO (live)
node bin/canary-multi-brand.js P### --commit
node bin/canary-multi-brand.js P### --commit --parallel --parallel-qc   # multi-brand

# Step 6: Post-save adversarial audit (Sentinel)
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
| `.claude/skills/` | Project-level Claude Code skills (auto-loaded in this dir) |
| `user-skills/` | User-level skills (install via `install-skills.bat`) |
| `apps-script/` | Google Apps Script code for dashboard + control tower |
| `Banner/` | Banner source images |
| `captures/` | (gitignored) API run logs, QC bundles |

---

## GitHub repo
`https://github.com/jascintapilos/promo-automation` (private)

Add collaborators: Settings → Collaborators on GitHub.

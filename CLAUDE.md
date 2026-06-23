# Promo Automation — Claude Code Guide

Working directory: `C:\Users\vdiuser\Downloads\promo-automation\promo-automation`

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

### Quick reference
```bash
# Start of session — pull latest
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
2. Install deps: `npm install`
3. Install Claude Code skills (Windows): `install-skills.bat`
4. Get credentials from Jascinta: `bo-sites.local.json` + `google-oauth-token.local.json`
5. Verify: `node bin/sheets-test.mjs`

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

## Promo automation — daily commands

```bash
# Step 1: Pull latest requests from sheet
node bin/ingest-requests.js

# Step 2: Dry-run (no BO writes)
node bin/canary-multi-brand.js P###

# Step 3: Pre-QC before committing
/pre-qc P###

# Step 4: Commit to BO (live)
node bin/canary-multi-brand.js P### --commit
node bin/canary-multi-brand.js P### --commit --parallel   # multi-brand

# Step 5: Post-save QC
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

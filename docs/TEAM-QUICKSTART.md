# Promo Automation — Team Quickstart

A 5-minute guide for operators handling promo requests. The bot pulls a row from the live spreadsheet, fills any missing names, creates the promo code + message template + dialog popup on the target BO(s) via API, and writes the result (`status="Created"` + `promo_code` + names) back to the sheet. **~5 seconds per brand, vs ~3–5 minutes manually.**

---

## TL;DR — daily workflow

The operator drops a request row into the Promo Code Request Details Template spreadsheet (Status, Brand, Region, Bonus Type, etc.). `promo_code` and the `Promotion Name` columns can be left blank — the bot will fill them. Then:

```bash
node bin/canary-multi-brand.js P### --commit
```

You can pass the bare `P###` (the CLI auto-resolves to the current-month row) or the full handle (`P###-r<row>`). For multi-brand requests, add `--parallel` to run all brands at once.

---

## Prerequisites (one-time setup)

### 1. Software
- **Node 20+** — `node --version` to verify
- **Git** — `git --version` to verify
- **Claude Code** — download at claude.ai/code

### 2. Clone the repo
```bash
git clone https://github.com/jascintapilos/promo-automation.git
cd promo-automation
npm install
```

### 3. Install Claude Code skills
```bash
install-skills.bat        # Windows
# or
bash install-skills.sh    # Mac/Linux
```
This copies skills to `~/.claude/skills/`. Restart Claude Code after running.

### 4. BO credentials — your own account

You need your own Back Office login. Ask Jascinta or your BO admin to provision one.

**`bo-sites.json`** — copy the example and fill in your username:
```bash
cp bo-sites.example.json bo-sites.json
```
Then open `bo-sites.json` and replace every `"REPLACE_ME"` with your BO username.

**`bo-sites.local.json`** — create this file in the project root with your password:
```json
{
  "passwords": {
    "your_bo_username": "your_bo_password"
  }
}
```

### 5. Google Sheets access — your own Google account

**Step A** — Ask Jascinta for `google-oauth-client.local.json` and drop it in the project root.
_(This is the app credential, not personal — same file for everyone.)_

**Step B** — Connect your own Google account:
```bash
node bin/sheets-oauth.mjs
```
A browser opens → log in with your Google account → approve access → your personal token is saved as `google-oauth-token.local.json`.

### 6. Verify setup
```bash
node bin/sheets-test.mjs
```
Should print the current month's sheet name with no errors.

That's it. No Playwright, no Chrome profile needed.

---

## Step-by-step

### 1. Pull the latest sheet state

```bash
node bin/ingest-requests.js
```

Reads the live current-month tab via Sheets API, auto-names any row whose `promo_code` column is blank, writes per-RN fixture files to `captures/requests/`. ~150ms per run. Reports namer stats:

```
Auto-namer: 66 already named, 2 derived, 0 operator-override, 0 incomplete, 0 unsupported
```

### 2. Dry-run a request (no BO writes)

```bash
node bin/canary-multi-brand.js P042
```

Prints the planned API calls per brand + body sizes + checks idempotency. No `--commit` = no BO writes.

```
▶ [QPRO11] launching canary-api.js …
Calls:
  1. POST /api/bo/promotion           body=2364 bytes
  2. POST /api/bo/messagetemplate     body=2842 bytes (locales: 1, 3)
  3. POST /api/bo/popups              body=3391 bytes (locales: 1, 3)
  4. POST /api/bo/promotionname × 2 (locales: 1, 3)
  5. PUT  /api/bo/promotion/{id}      (link message_template_id + dialog_popup_list)

✓ Idempotency (live): no existing "REL_30PCT_3X" on qpro11/MSB66
```

### 3. Commit live

```bash
node bin/canary-multi-brand.js P042 --commit
node bin/canary-multi-brand.js P042 --commit --parallel   # 2+ brands, run together
```

Per brand: `POST` promotion → optional `POST` message template (only when `inbox_message: true`) → optional `POST` popup (only when `popup_dialog: true`) → `POST` promotion_name × N locales → final `PUT` to link MT + popup. After all brands finish, one `spreadsheets.values.batchUpdate` writes the row's `status="Created"`, `promo_code`, and both `promotion_name_*` columns back to the sheet.

---

## What gets created per brand

1. Promotion code (Section 3.2) — every field filled including currency block, member groups, KYC, multiplier, dynamically-resolved game providers + categories
2. Message template (Section 6.6) — per-locale Subject + body HTML (EN / ZH / ID; TH skipped if no body authored)
3. Dialog popup (Section 14.1.2 QPRO / 15.1.2 QP2) — localised CTAs, deposit/reward link branches on `min_deposit`
4. Promotion Names rows — one per (currency × locale)
5. PUT links message template + dialog popup to the promo

---

## CLI reference

### Main entry

```bash
node bin/canary-multi-brand.js <handle> [flags]
```

| Flag | Effect |
|---|---|
| (none) | Dry-run — print planned calls, no BO writes |
| `--commit` | Live mode — actually call the BO |
| `--parallel` | Run all brands concurrently (default: sequential) |
| `--playwright` | Legacy Playwright runner (fallback, rarely needed) |

### Single-brand runners

```bash
# QPRO brand
node bin/canary-api.js     P042 --commit --brand=QPRO11

# QP2 brand
node bin/canary-api-qp2.js P042 --commit --brand=QP2A
```

### Sheet operations

```bash
# Re-ingest from live sheet (auto-name empty rows, write fixtures)
node bin/ingest-requests.js
node bin/ingest-requests.js --tab="Apr 2026"     # override current-month default
node bin/ingest-requests.js --qc-only            # only status=QC Completed rows

# Write a value back to a specific row by hand
node bin/sheets-writeback.mjs P042 --field=promo_code --value=REL_30PCT_3X --commit
node bin/sheets-writeback.mjs P042 --from-fixture --commit   # push fixture's code+names back

# Probe Sheets API auth (one-off setup verification)
node bin/sheets-test.mjs
node bin/sheets-test.mjs --write-test
```

### Cleanup

```bash
# Read-only list of TEST_* promos + popups across both BOs
node bin/cleanup-test-promos.js
```

Manual archive via the BO UI is more reliable than the script's PUT path.

---

## Coverage — what's supported today

**Brands (21):** QPRO1–17 + QP2A/B/C/D
*(QPRO18 Pokies Palace + QPRO19 OzPokies77 dropped — AUD cluster, `promo_testbot` not provisioned.)*

**Bonus types (all 21 brands):** Deposit / Reload • Welcome • Free Credit • Free Spin

**Locales authored:** EN / ZH / ID (TH skipped silently)

**Free Spin provider default:** `PP2 - Pragmatic Play`. If a different provider is needed, the operator names it in `name_details` (e.g. `Game: <game>, Provider: <provider>`).

---

## Auto-namer

If the operator leaves `promo_code` blank, the namer derives it from `bonus_type` + `parsed.*` + remark instructions:

| Bonus | Pattern |
|---|---|
| Reload Deposit | `REL_<pct>PCT_<TO>X` |
| VIP Reload | `VIP_REL_<pct>PCT_<TO>X` (campaign/remark contains `VIP`) |
| Welcome Deposit | `WELC_<pct>PCT_<TO>X` |
| Free Credit | `<amt>FC_<TO>X` |
| VIP Free Credit | `VIP_<amt>FC_<TO>X` |
| Free Spin | `<spins>FS_<provider>_<TO>X` (provider defaults to PP2) |

Modifiers (appended):
- `[SLOTS ONLY]` in remark → `_SLT`; `[LC ONLY]` → `_LC`; `[SPORTS ONLY]` → `_SPT`; etc.
- `Bronze` / `Silver` / `Gold` in remark → `_BR` / `_SIL` / `_GLD`

Override: `Create the code name as below: CUSTOM_CODE` in remark → operator-typed value wins.

Names are derived in parallel: `30% Reload Bonus` / `30% 充值奖励`, `Exclusive Offer - 30 Free Credit` / `独家优惠 - 30 免费体验金`, etc.

---

## Common errors

### `REFUSED: plan has 1 gap(s): promo_code`
The operator hasn't named the row AND the namer can't derive it (e.g. FS row missing `spin_count` or `to_multiplier`). Add the missing field to `name_details` or `promo_code` directly.

### `IDEMPOTENCY: code "..." already exists`
Code is already saved on that brand. Change `promo_code` (sheet col W) and re-ingest. **QP2 codes are globally unique across QP2A/B/C/D on the same BO** — if you see the message on QP2A, the code might be on a sibling merchant.

### `auth required (401)`
BO session expired (rare with cached `.session/<site>.json`). Delete the stale session file under `.session/` and re-run. For Sheets API: re-run `node bin/sheets-oauth.mjs`.

### `HTTP 422: target.0.game_provider_ids.N is invalid`
Shouldn't happen — the bot now resolves providers per-brand via `GET /api/bo/gameprovider`. If it does, the brand's catalog changed mid-run. Re-run the canary; the next attempt re-fetches the live catalog.

---

## Debugging a failed run

Every run writes a log at `captures/api-runs/<timestamp>-<handle>-<brand>-api[-qp2].json` containing every API call's request + response body. Open the latest file for the failing brand.

For QP2 dialog popup link issues, query the BO directly:
```bash
node -e "import('./src/api-client.js').then(({authedFetch}) => authedFetch('ibc22', '/api/bo/promotion?code=<your_code>').then(r => console.log(JSON.stringify(r.data.rows[0].dialog_popup_list, null, 2))))"
```

---

## Performance

| Path | Time / brand | Notes |
|---|---|---|
| Manual operator (BO UI clicks) | ~3–5 min | error-prone, no automation |
| Playwright canary (`--playwright`) | ~90 s | legacy fallback |
| **API-direct (default)** | **~5–8 s** | catalogs resolved per-brand |

Multi-brand request, 4 brands, parallel:
- Manual: ~12–20 min
- API-direct: **~10 s**

---

## File reference

| File | Purpose |
|---|---|
| `bin/canary-multi-brand.js` | Top-level orchestrator — dispatches per brand, fires sheet write-back |
| `bin/canary-api.js` | QPRO single-brand API runner |
| `bin/canary-api-qp2.js` | QP2 single-brand API runner |
| `bin/ingest-requests.js` | Pull live sheet → fixtures (auto-names blank rows) |
| `bin/sheets-writeback.mjs` | Manual sheet writes by handle + field |
| `bin/sheets-test.mjs` | One-off Sheets API auth verification |
| `bin/sheets-oauth.mjs` | One-time OAuth consent flow |
| `bin/canary-write.js` | Legacy Playwright canary (`--playwright` fallback) |
| `bin/cleanup-test-promos.js` | List TEST_* promos (manual archive in BO UI) |
| `src/promo-namer.js` | Auto-name `promo_code` + `promotion_name_*` |
| `src/sheets-ingest.js` | Live-sheet reader, calls namer |
| `src/sheets-client.js` | Sheets API auth + read/write helpers |
| `src/api-mapper-qpro.js` | QPRO body builder; dynamic game providers + categories |
| `src/api-mapper-qp2.js` | QP2 body builder; same per-brand resolution |
| `src/api-client.js` | Auth, low-level fetch, `findPromotionByCode`, `getAllGameProviders`, `getAllCategories` |
| `bo-sites.json` | Public BO config |
| `bo-sites.local.json` | BO passwords (gitignored) |
| `google-oauth-client.local.json` | OAuth client secret (gitignored) |
| `google-oauth-token.local.json` | Cached refresh token (gitignored) |

---

## Asking for help

Pass the request handle + any log path to Claude:

> "Run P042 across all listed brands"
> "Why did P042 fail on QPRO5? log: `captures/api-runs/2026-05-16T13-…-QPRO5-api.json`"

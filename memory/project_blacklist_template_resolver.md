---
name: project-blacklist-template-resolver
description: "Blacklist Template resolver — QPRO endpoint, exact category-set match rule, FS shortcut, and the default-7-cat blocker that will trip every non-FS QPRO promo without explicit categories_only."
metadata: 
  node_type: memory
  type: project
  originSessionId: 1392af18-ff06-41e3-a002-f151fae7185b
---

# Blacklist Template resolver (QPRO, verified 2026-05-26)

**Endpoint (QPRO):** `GET /api/bo/blacklist?perPage=200&page=1` — returns rows under `data.rows`, each carrying `{ id, name, status, settings: [{ settings_currency_id, game_provider_sub_category_id }] }`. The template's `name` literally encodes which categories it covers.

**Endpoint (QP2):** DISCOVERED 2026-06-08 (was TBD). QP2 nests blacklist templates under `/gameprovider/`, NOT `/blacklist` (that's why every `/api/bo/blacklist*` guess 404'd):
- `GET /api/bo/gameprovider/getAllBlacklistTemplate?paginate=false` — listing (params: `name`, `status`, `paginate`). Returns `data.rows` with `{id, name, status, updated_at}`.
- `GET /api/bo/gameprovider/getBlacklistTemplate/{id}` — single; returns `black_list_sub_categories` (the EXCLUDED subcats).
- `GET /api/bo/gameprovider/getBlacklistTemplateUsage/{id}` — linked-promo count.
- `GET /api/bo/gameprovider/duplicateBlacklistTemplate/{id}` — clone.
Found by grepping the QP2 SPA bundle (`bin/_discover-qp2-blacklist2.mjs`). Probe: `bin/_probe-qp2-templates.mjs`. Snapshots at `captures/blacklist-templates/2026-06-08/{qpro1..17,ibc22}.json`.

**Wire shape — QPRO uses `blacklist_id`; QP2 uses `blacklist_template_id`. They diverge.**
- QPRO POST/PUT body field: `blacklist_id: <int>` — verified live 2026-05-26 by PUT on TEST_22FS_GOO_20X (id=936 on QPRO1). PUT with `blacklist_id: 6` stuck; GET returns the same `blacklist_id: 6`.
- QP2 POST/PUT body field: `blacklist_template_id: <int>` — confirmed from production capture of FT_DOUDLEDATE_JUNE_250FS_FOO on ibc22.
- Earlier mapper sent the QP2 name on QPRO (silently ignored by validator) → BO defaulted to NULL → blacklist not enforced. Fixed in [src/api-mapper-qpro.js](src/api-mapper-qpro.js); QP2 mapper will use its own name when wired.

**Selection rule (operator, 2026-05-26):** exact category-set match.
- FS shortcut: every FS promo → `"Slots Only"` template (QPRO11 id=8).
- Non-FS: build a Set from the canary's resolved category names; find the template whose name parses to the same set. Reject if no match — operator must create the template.

**QPRO11 templates (9, snapshot 2026-05-26):**

| id | name | parse → categories |
|----|------|--------------------|
| 1 | Live Casino Only | {LIVE CASINO} |
| 2 | Live Casino and Slots | {LIVE CASINO, SLOTS} |
| 3 | All games | sentinel: ALL (wildcard — skipped under exact-match) |
| 4 | Sports and Esports only | {SPORT, E-SPORTS} |
| 5 | Sports only | {SPORT} |
| 6 | Crash only | {CRASH} |
| 7 | Fishing only | {FISHING} |
| 8 | Slots Only | {SLOTS} |
| 9 | Slots, Live Casino, Sports | {SLOTS, LIVE CASINO, SPORT} |

**QPRO1 templates (10, snapshot 2026-05-26 — IDs differ from QPRO11, hence per-brand cache):**

| id | name | curr (MYR=1, USD=2, SGD=3, IDR=4) | parse |
|----|------|-----------------------------------|-------|
| 1 | All games | [1,2,3,4] | ALL |
| 2 | Fishing only | [] | {FISHING} |
| 3 | Sports only | [1,3,4] | {SPORT} |
| 4 | Sports and Esports only | [1,2,3,4] | {SPORT, E-SPORTS} |
| 5 | Crash only | [1,2,3,4] | {CRASH} |
| 6 | Slots Only | [1,3,4] | {SLOTS} |
| 7 | Slots, Live Casino, Sports | [1,3,4] | {SLOTS, LIVE CASINO, SPORT} |
| 8 | Live Casino Only | [1,2,3,4] | {LIVE CASINO} |
| 9 | Live Casino and Slot | [1,2,3,4] | {LIVE CASINO, SLOTS} (singular "Slot" — alias handles it) |
| 10 | Esports Only | [1] | {E-SPORTS} |

**UI confirmation (operator screenshot 2026-05-26):** QPRO1 3.2 Promotion Codes → BlackList button opens "Game Provider Blacklist" popup. Top row: `Template: [Please select ▼]` + `[+ Blacklist Templates]` button to manage. Below: per-currency tabs (MYR | SGD | IDR), provider search, "Apply to other currencies" dropdown. The Template dropdown is populated by `/api/bo/blacklist` — selecting an option writes `blacklist_template_id` on the form. The API-direct path bypasses the UI entirely by setting the field on the POST body.

**Code:** [src/blacklist-template.js](src/blacklist-template.js) — `resolveBlacklistTemplateId(site, { categoryNames, isFs })`. Module-level cache keyed by site.id.

## Default 7-category set — resolved via "All games" fallback (2026-05-28)

QPRO mapper's `ALLOWED_WALLET_CATEGORY_NAMES` is `['SPORT', 'LIVE CASINO', 'SLOTS', 'E-SPORTS', 'FISHING', 'CRASH', 'CRICKET']` — 7 categories. No QPRO brand has a template covering exactly those 7. Under a strict exact-match rule this would block every non-FS non-`categories_only` promo.

**Chosen fix (2026-05-28):** Two-tier resolution in `src/blacklist-template.js`:
1. Exact category-set match (unchanged for specific-category promos)
2. **"All games" fallback** — if no exact match found, use the brand's "All games" template

Semantically correct: a promo that allows all categories maps naturally to "All games" blacklist template. The "Slots Only" FS shortcut is unaffected.

**Result:** FS → "Slots Only" shortcut; specific `categories_only` → exact match; default full-allow-list → "All games" fallback. No template creation required in BO.

Only throws now when: (a) no exact match AND (b) no "All games" template exists on that brand. That case is extremely unlikely given every brand snapshot shows "All games" as id=1 or id=3.

**Empty categoryNames fix (2026-05-28):** Removed early throw for `want.size === 0`. Promos with no categories configured now fall directly to "All games" fallback (semantically correct — no restriction = allow all).

## Batch patch — `bin/patch-blacklist-all-qpro.mjs`
Applies blacklist templates to all active QPRO promos without one. Usage:
```
node bin/patch-blacklist-all-qpro.mjs              # dry-run
node bin/patch-blacklist-all-qpro.mjs --commit      # apply
node bin/patch-blacklist-all-qpro.mjs --site=qpro1  # single brand
```
Note: list endpoint (`/api/bo/promotion`) does NOT return `blacklist_id`. Script fetches detail per promo to detect already-patched ones; skips if `det.blacklist_id` is set.

## QP2 catalog (ibc22 — shared QP2A/B/C/D, snapshot 2026-06-08)

9 active templates. `bl#` = count of excluded subcats on the template detail.

| id | name | parse → coverage | bl# |
|----|------|------------------|-----|
| 1 | All games | ALL | 54 (upd 2026-06-02) |
| 2 | Sports Only | {SPORT} | 10 |
| 3 | Live Casino Only | {LIVE CASINO} | 15 |
| 4 | Live Casino and Slots | {LIVE CASINO, SLOTS} | 45 |
| 5 | Slots Only | {SLOTS} | 30 |
| 6 | Slots, Live Casino, Sports | {LIVE CASINO, SLOTS, SPORT} | 54 |
| 7 | Fishing only | {FISHING} | 0 (empty) |
| 8 | Crash game only | {CRASH} * | 0 (empty) |
| 9 | Sports & Esports Only | {SPORT, E-SPORTS} * | 9 |
| 10 | Sports and Slots (added by 2026-06-16) | {SPORT, SLOTS} | — |
| 11 | Live Casino and Sports Only (added by 2026-07-16) | {LIVE CASINO, SPORT} | 42 pairs |

Genuinely missing on QP2: **Esports Only** (standalone), **Cricket Only**.

## ⚠ parseTemplateName divergence on QP2 names (found 2026-06-08)

`parseTemplateName` in [src/blacklist-template.js](src/blacklist-template.js) mis-parses two QP2-style names (marked * above):
- `"Sports & Esports Only"` → `{SPORTS & ESPORTS}` (should be {SPORT, E-SPORTS}) — the splitter handles `,` and ` and ` but NOT `&`.
- `"Crash game only"` → `{CRASH GAME}` (should be {CRASH}) — no alias for "crash game".

QPRO names use " and " / "Crash only", so QPRO parses fine. This is LATENT: the QP2 mapper still omits `blacklist_template_id` (BO defaults NULL), so the resolver isn't called on QP2 yet. If/when QP2 blacklist resolution is wired, fix the splitter (add `&`) + aliases ("CRASH GAME"→CRASH) FIRST, or it will mis-resolve id=8/id=9 and wrongly fall through to "All games".

## How to apply
- Diff-aware probe (preserves baseline): `node bin/probe-blacklist-diff.mjs` — QPRO live vs last snapshot + gap flags; writes to `captures/blacklist-templates/<date>/`.
- Probe new brand: `node bin/probe-blacklist-template.mjs --site=qpro<N>` snapshots templates (OVERWRITES baseline — use the diff script instead when you need the comparison).
- If resolver throws on a P### that should work, the error names the templates and shows the wanted set — operator either matches one of them with `categories_only` or creates a new template in BO and re-runs.
- See [[feedback_blacklist_template_before_create]] for the operator rule.

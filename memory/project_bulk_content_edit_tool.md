---
name: Bulk content T&C edit tool template
description: bin/add-qqpoker-to-rebate-tnc.mjs is the canonical template for cross-platform bulk content edits (QPRO + QP2 + WS1/WS2). Reuse it as a starting point for future bulk T&C / content changes.
type: project
originSessionId: faab1c01-8818-4987-850e-487dd5658e99
---
`bin/add-qqpoker-to-rebate-tnc.mjs` is the reference template for any future bulk content edit (T&C exclusions, copy tweaks, hyperlink updates) that spans QPRO + QP2 + WS1/WS2 records.

## Architecture

Single script with three platform handlers:

| Platform | Handler | Endpoint | PUT body extras |
|---|---|---|---|
| QPRO (15 brands) | `runQpro` | `PUT /api/bo/promotioncontent/<id>` | Standard |
| QP2 (4 merchants) | `runQp2` | `PUT /api/bo/promotioncontent/<id>` | **`site_id` = merchant id required** |
| WS1/WS2 (Directus) | `runBia` | `PATCH /items/promotions_translations/<row_id>` | Per-locale row, not per-record |

Each handler:
1. Reads the current content
2. Calls a platform-specific patch function (handles HTML format differences)
3. Idempotency-checks via `if (/<new-token>/i.test(content)) skip`
4. Builds PUT body (QPRO/QP2) or PATCH body (BIA)
5. Writes only on `--commit`; otherwise prints "[DRY-RUN]"

## Key design points

- **Idempotency check first** — every patch fn starts with `if (/<token>/i.test(content)) return {skipped: 'already-has-<token>'}`. Re-runs are safe.
- **Prefix detection** — for indented bullet lists, capture the prefix used by the EXISTING anchor (e.g. `&nbsp; &nbsp; &nbsp;- ` or bare `-`) and mirror it for the new line, so spacing stays consistent per-locale.
- **Platform-specific anchor regex** — see `feedback_qp2_tnc_li_wrapping.md` for the EN/ZH list-wrap difference.
- **CLI flags**: `--commit`, `--only=qpro|qp2|ws|bia|all` for partial runs.
- **BIA auth via env**: `BIA_PASSWORD` env var, never hardcoded. Email defaults to `promo_testbot@client.com`.
- **BIA cache lag**: Directus list endpoint may return stale data after PATCH. Verify via single-record `GET /items/.../<id>` reads (not list filter).

## Reuse pattern

For a new bulk edit (e.g. add a new excluded provider, change a clause):
1. Copy the script, rename.
2. Update the three `*_JOBS` arrays with the target record IDs.
3. Replace the patch fns' anchor regex + replacement text.
4. Update the idempotency token to the new text.
5. Dry-run, eyeball one or two diffs, commit.

## When to use this vs other approaches

Use this script template when:
- You need to touch the same field on 10+ records across multiple platforms.
- The change is mechanical (regex-safe text insertion / replacement).
- Idempotency matters (operators may re-run).

Don't use it for:
- Single-record one-off edits — write a small `fix-*.mjs` instead.
- Complex content restructuring — that needs the full fetchDocHtml pipeline.

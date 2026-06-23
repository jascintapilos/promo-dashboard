---
name: pre-qc
description: Pre-commit deep QC for a promo request using sub-agent fan-out. Runs BEFORE `--commit` to catch plan-level issues (naming convention, brand placeholder, FS provider restriction, mechanics within platform limits, stale clone references) so the user can fix before saving. Pairs with /deep-qc (post-save). Trigger on `/pre-qc P###`, "pre qc this plan", "check plan before commit", "review before saving", or any pre-commit verification request.
---

# Pre-QC — sub-agent fan-out for pre-commit plan review

This skill provides **independent pre-commit verification** of the canary's planned API bodies before the user adds `--commit`. The dry-run already prints the plan to the terminal; this skill adds a layer of **fresh-context sub-agent review** that catches plan-level issues the canary's mapper doesn't validate.

| Inline canary catches | Pre-QC adds |
|---|---|
| Idempotency (code already on BO) | promo_code convention matches bonus_type / campaign |
| Required fields present (validatePlan) | MT body uses correct brand placeholder (`:brandname` QPRO / `:merchantname` QP2) |
| Currency/locale shape valid | MT body contains actual amount values (not orphan placeholders) |
| | FS plan restricts `game_provider_codes` to FS provider only (PP2 etc.) |
| | Categories restriction matches `[CATEGORY ONLY]` remark |
| | Mechanics within platform limits (FS ≤88 spins, ≥0.50/spin, TO range, min dep) |
| | Tier prefix in code only, not in `promotion_name_*` |
| | MT/dialog body free of stale clone references (other brand names) |
| | promotion_currency rows match `regions` |
| | Tier constraint values match `eligible_tiers` array |

**Pre-QC is read-only.** It cannot break a save (no save has happened yet). It surfaces issues; the user decides whether to fix-and-re-dry-run or accept and commit.

## Trigger

User says:
- `/pre-qc P073` or `/pre-qc P073-r1502`
- "pre qc this plan"
- "check P073 before commit"
- "review before saving"
- "fan out QC on the plan"

## Pre-requisite

The canary runner must have produced **plan bundles** for the handle. These are auto-written by `bin/canary-api.js` and `bin/canary-api-qp2.js` on every dry-run (no `--commit`), under `captures/qc-plans/<handle>__<brand>.json`. Each bundle contains:
- Source request fields (parsed.*, names, categories, regions, instructions, remark, requestor)
- The structured plan (`promotion`, `messageTemplate`, `dialogPopup`, `names`, `update`, `tierConstraint`, `categoriesOnly`, `currencyFilter`)
- Promo code + bonus type + brand + platform + site

Stale bundles are overwritten on the next dry-run, so always re-dry-run after editing the source or re-ingesting.

## Steps

### 1. Resolve the handle and list plan bundles

```sh
node bin/pre-qc-fanout.mjs <handle> --pretty
```

Validates each bundle and shows: `▸ <BRAND> (<platform>)  code=...  bonus=...`. If it errors with "No plan bundles found", stop and tell the user to run the canary dry-run first.

### 2. Read each plan bundle into memory

Load each `captures/qc-plans/<handle>__<brand>.json` via Read. Pass relevant fields into each sub-agent's prompt.

### 3. Spawn one Explore sub-agent per bundle

For each plan bundle, spawn an `Explore` sub-agent with `subagent_type: Explore`. Each agent is **fully isolated** — it does not see the main conversation. Its prompt must include:

- The bundle's `source` block (what was requested)
- The bundle's `plan` block (what would be POSTed if committed)
- The brand + platform + site + bonus_type
- A **plan-level check list** tailored to the bonus type
- **Known false-positive patterns** to skip (see below)
- A required return shape (JSON)

Send all sub-agent invocations in **a single message** so they run concurrently.

### 4. Aggregate results into a pass/fail table

Each sub-agent returns a structured finding list. Aggregate into:

```
Pre-QC results — <handle>
| Brand | Status | Findings |
|---|---|---|
| QPRO5 | ✓ PASS | — |
| QPRO11 | ✗ FAIL | promo_code missing FT_ prefix (1 issue); MT body has stale "BP9" reference (1 issue) |
| QP2A | ⚠ WARN | FS spins=92 — exceeds 88 limit per FS general rules (1 issue) |
```

Then expand FAIL/WARN brands with the specific findings. Recommend next steps:
- For FAIL: tell the user what to fix in the source sheet, re-ingest, re-dry-run, re-/pre-qc
- For WARN: explain the rule, let user decide

## Sub-agent prompt template

For each brand bundle, use this template (fill in `<…>` from the bundle):

```
You are doing PRE-COMMIT plan review for an iGaming promo code on a Back Office.
You are isolated — you do NOT see the main conversation. Return only a JSON object matching the schema at the end.

THIS IS PRE-SAVE: the BO has NOT been changed yet. We are reviewing the planned API bodies before the user commits. Your job is to surface plan-level issues so they can be fixed in the source request.

PROMO HANDLE: <handle>
BRAND:        <brand> (platform: <platform>, site: <site>)
BONUS TYPE:   <bonus_type><bonus_sub_type ? '/' + bonus_sub_type : ''>
PROMO CODE:   <promo_code>

SOURCE REQUEST (what operator asked for):
<JSON.stringify(bundle.source, null, 2)>

PLANNED API BODIES (what WOULD be POSTed if user commits):
<JSON.stringify(bundle.plan, null, 2)>

CHECK LIST — run all that apply to this bonus_type:

NAMING:
1. promo_code should follow the convention for bonus_type:
   - Deposit Reload: REL_ or FT_REL_ prefix (or operator override)
   - Deposit Welcome: WELC_ prefix
   - Free Credit: FC_ or NODEP_ prefix
   - Free Spin: FS_ prefix
   Flag if missing / wrong / mixed.
2. Tier prefix (BR_/SIL_/GLD_/PLT_/DMD_/NRM_) belongs in promo_code only — flag if it appears in any promotion_name_* string.
3. If source.instructions has code_prefixes (TEST_/VIP_/...), confirm prefix is applied.
4. promotion_name_zh / promotion_name_id should differ from promotion_name_en (no lazy duplicates).

MESSAGE TEMPLATE (when plan.messageTemplate is set):
5. MT body should use brand placeholder: `:merchantname` for platform=qp2, `:brandname` for platform=qpro. Flag if wrong one appears OR if a literal brand name (BP9 / KING333 / IBC22 etc.) is hardcoded.
6. For Free Credit bonus_type, MT body should contain the actual source.parsed.free_credit_amount value, not a stale placeholder like {{free_credit_amount}}.
7. For Deposit bonus_type, MT body should reference rate (source.parsed.bonus_rate_pct) and turnover (source.parsed.to_multiplier).
8. T&C hyperlink should be on sentence 11 ("General :brandname terms and conditions apply.") only — not on other clauses.

DIALOG POPUP (when plan.dialogPopup is set):
9. Dialog body uses correct brand placeholder (same as MT).
10. Dialog content per locale matches the rendered MT body theme.

PER-BONUS-TYPE PLAN CHECKS:
- bonus_type=freespin:
  * plan.promotion.game_provider_codes must be restricted to FS provider only (typically ['PP2']). Flag if it has Layer-1 inversion list (53+ entries).
  * spin_count ≤ 88 per FS general rules
  * value_per_spin ≥ 0.50
  * to_multiplier between 10-15 (12-15 for QP2/AU, 10-12 for QPRO/WS1)
  * REL_/RET_ codes only; WELC exempt
- bonus_type=deposit:
  * min_deposit ≥ 100
  * On QP2: max_total_* on promotion_currency stays null (=Unlimited) unless source explicitly sets cap
- bonus_type=freecredit:
  * Plan promo's free_credit_amount must match source.parsed.free_credit_amount

CURRENCY / REGION:
11. plan.promotion.promotion_currency_list (or per-currency overrides) should have one row per source.regions entry — flag missing.
12. plan.names should have one row per source.locales entry.
13. If source.regions includes ID/TH, confirm locale rows for ID/TH locales exist in plan.names.

CATEGORY RESTRICTION:
14. If source.remark contains "[LIVE CASINO ONLY]" or "[SLOTS ONLY]" or similar, plan.categoriesOnly should match.
15. If plan.categoriesOnly is set, plan.promotion.game_category_ids should reflect that restriction.

KNOWN FALSE-POSITIVES (DO NOT FLAG THESE):
- On QPRO, plan.promotion.member_group_ids being empty `[]` is INTENTIONAL — never flag.
- On QP2, plan.promotion.allow_deposit being false is INTENTIONAL — never flag.
- max_total_* fields being null on QP2 means "Unlimited" by design — never flag.
- ZH name containing brand prefix like "BP9 ..." is correct — don't flag as English contamination.
- WS1/WS2 codes auto-prepend FT_ — don't flag FT_ as wrong when source remark doesn't mention it.
- Default game categories = All games when no category remark — don't flag missing restriction.

RETURN ONLY this JSON schema (no prose):
{
  "brand": "<brand>",
  "status": "pass" | "fail" | "warn",
  "findings": [
    { "severity": "fail" | "warn" | "info",
      "field": "promo_code" | "messageTemplate.body" | "dialogPopup.body" | "game_provider_codes" | ... ,
      "message": "short description",
      "fix": "what to change in source sheet",
      "evidence": "snippet from plan showing the issue" }
  ],
  "summary": "one-line summary"
}

Set status="pass" if findings is empty. Set status="warn" if all findings are severity=warn. Set status="fail" if any finding is severity=fail.
```

## Notes

- Sub-agents run in **parallel** when invoked in a single message — total wall-clock = slowest single brand check (~10-15s) regardless of brand count.
- Sub-agents are read-only — they cannot break a save (no save has happened).
- If pre-QC reports FAIL findings, the typical next step is:
  1. Fix the source sheet (col W/M/N/etc.)
  2. Re-ingest: `node bin/ingest-requests.js`
  3. Re-dry-run the canary (overwrites plan bundle)
  4. Re-invoke `/pre-qc P###`
- After aggregation, **always** present the summary table even if all brands pass.
- Plan bundles are stale until the next dry-run. If the user invokes `/pre-qc` long after the dry-run, remind them the bundle may be outdated.

## Pairs with

- `/deep-qc P###` — runs AFTER `--commit` (saved-state verification).
- The two skills together: `/pre-qc` (review plan) → user commits → `/deep-qc` (verify saved state).

## Out of scope

- This skill does NOT modify the BO or the source sheet. It is read-only verification.
- It does NOT auto-fix findings. The user decides whether to fix the source, accept warnings, or override.
- It does NOT cover WS1/IGMP brands yet — plan bundles are only written by QPRO/QP2 runners. WS1 pre-QC can be added once `canary-api-igmp.js` writes plan bundles.

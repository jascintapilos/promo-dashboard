---
name: deep-qc
description: Post-save deep QC for a promo request using sub-agent fan-out. Independent of the inline canary QC — spawns one Explore sub-agent per saved brand, each reading the live BO state captured in the deep-QC bundle (no auth needed) and surfacing semantic/textual issues the numeric QC misses. Trigger on `/deep-qc P###`, "deep qc this", "verify save independently", or any post-save verification request that wants a second opinion across multiple brands.
---

# Deep QC — sub-agent fan-out for post-save verification

This skill provides **independent post-save verification** for promo saves. The inline canary QC (Levels 1/2/3) confirms the save's *numeric* and *id-linkage* correctness on the same thread that did the save. Deep QC adds a layer of **fresh-context, brand-isolated semantic checks** that catch issues the inline QC can't:

| Inline QC catches | Deep QC adds |
|---|---|
| code exists, id match, name set | MT body uses correct brand placeholder (`:brandname` QPRO / `:merchantname` QP2) |
| numeric mechanics match | MT free_credit_amount placeholder filled with actual value |
| MT linked, T&C hyperlink present | T&C clauses match bonus type + max_withdraw rule |
| dialog popup linked | Dialog body has the right per-locale promo name |
| | ZH/ID/TH names non-empty and not EN duplicates |
| | FS game codes resolved to the intended games |
| | promotion_currency rows exist per region |
| | Known false-positives skipped (empty member_group_ids on QPRO, etc.) |

## Trigger

User says:
- `/deep-qc P073` or `/deep-qc P073-r1502`
- "deep qc this save"
- "verify P073 independently"
- "fan out QC for the last save"

## Pre-requisite

The canary runner must have written **deep-QC bundles** for the handle. These are auto-written by `bin/canary-api.js` and `bin/canary-api-qp2.js` after each save, under `captures/qc-bundles/<handle>__<brand>.json`. Each bundle contains:
- Source request fields (parsed.*, names, categories, regions, instructions, remark)
- Saved IDs (promotion_id, template_id, dialog_popup_id)
- **Inlined live BO state** (list row, full detail, T&C check result) — so sub-agents need no BO auth

If no bundle exists, the skill prompts the user to re-run the canary or check what saved.

## Steps

### 1. Resolve the handle and list bundles

Run the fanout script to find all bundles for the request:

```sh
node bin/qc-fanout.mjs <handle> --pretty
```

This validates each bundle and shows: `▸ <BRAND> (<platform>)  promo_id=...  template_id=...  dialog_id=...`. If it errors with "No bundles found", stop and tell the user to run the canary save first.

### 2. Read each bundle into memory

Load each `captures/qc-bundles/<handle>__<brand>.json` via the Read tool. You only need to read them once — then pass relevant fields into each sub-agent's prompt.

### 3. Spawn one Explore sub-agent per bundle

For each bundle, spawn an `Explore` sub-agent with `subagent_type: Explore`. Each agent is **fully isolated** — it does not see the main conversation. Its prompt must include:

- The bundle's `source` block (what was requested)
- The bundle's `live_state` block (what was actually saved on BO)
- The brand + platform + site
- A **specific check list** tailored to the bonus type (deposit / FC / FS)
- **Known false-positive patterns** to skip (see below)
- A required return shape (JSON)

Send all sub-agent invocations in **a single message** so they run concurrently.

### 4. Aggregate results into a pass/fail table

Each sub-agent returns a structured finding list. Aggregate into:

```
Deep-QC results — <handle>
| Brand | Status | Findings |
|---|---|---|
| QPRO5 | ✓ PASS | — |
| QPRO11 | ✗ FAIL | MT body missing free_credit value (2 issues) |
| QP2A | ⚠ WARN | ZH name appears to be EN duplicate (1 issue) |
```

Then expand FAIL/WARN brands with the specific findings. Recommend next steps (re-run save, fix specific field, escalate).

## Sub-agent prompt template

For each brand bundle, use this template (fill in the `<…>` placeholders from the bundle):

```
You are doing post-save deep QC for an iGaming promo code on a Back Office.
You are isolated — you do NOT see the main conversation. Return only a JSON object matching the schema at the end.

PROMO HANDLE: <handle>
BRAND:        <brand> (platform: <platform>, site: <site>)
PROMO CODE:   <promo_code>
SAVED IDS:    promotion_id=<promotion_id>, template_id=<template_id>, dialog_popup_id=<dialog_popup_id>

SOURCE REQUEST (what operator asked for):
<JSON.stringify(bundle.source, null, 2)>

LIVE BO STATE (what was actually saved — captured during QC fetch):
<JSON.stringify(bundle.live_state, null, 2)>

CHECK LIST — run all that apply to this bonus_type:

UNIVERSAL:
1. promo_code on live_state.list_row matches the requested code (already checked by inline QC, confirm).
2. live_state.list_row.name is non-empty and matches one of source.promotion_name_* values.
3. live_state.list_row.status is set (0=draft / 1=active — flag if unexpected for this brand).
4. If source.regions has multiple entries, live_state.detail.promotion_currency_list (or per_currency_overrides) must have one row per region.
5. promotion_name_zh / promotion_name_id (if set) are non-empty AND differ from promotion_name_en (catch "lazy duplicate" bugs).

MESSAGE TEMPLATE (when template_id is set):
6. live_state.tnc.messages should report ✓ on hyperlink presence for sentence 11 only.
7. MT body should use the correct brand placeholder: ":merchantname" for platform=qp2, ":brandname" for platform=qpro. Flag if the wrong one appears, or if a literal brand name is hardcoded.
8. For FC bonus_type, MT body should contain the actual source.parsed.free_credit_amount value (not a placeholder).
9. For Deposit bonus_type, MT body should reference the rate (source.parsed.bonus_rate_pct) and turnover (source.parsed.to_multiplier).

DIALOG POPUP (when dialog_popup_id is set):
10. Dialog content body uses correct brand placeholder (same rule as MT — :merchantname for QP2, :brandname for QPRO).
11. For multi-merchant QP2 brands, confirm live_state.list_row.dialog_popup_list contains the expected dialog_popup_id.

PER-BONUS-TYPE:
- bonus_type=freespin: live_state.detail.game_provider_ids should be restricted to the FS provider only (typically PP2). Flag if it has the broad Layer-1 inversion list.
- bonus_type=deposit: max_total_* fields on QP2 promotion_currency should be NULL (= Unlimited) unless source explicitly sets a cap.
- bonus_type=freecredit: live_state.detail.free_credit_amount must equal source.parsed.free_credit_amount.

KNOWN FALSE-POSITIVES (DO NOT FLAG THESE):
- On QPRO brands, live_state.list_row.member_group_ids being empty `[]` is INTENTIONAL — never flag.
- On QP2 brands, live_state.list_row.allow_deposit being false is INTENTIONAL — never flag.
- max_total_* fields being null on QP2 means "Unlimited" by design — never flag.
- ZH name containing brand prefix like "BP9 ..." is correct — don't flag as English contamination.

RETURN ONLY this JSON schema (no prose):
{
  "brand": "<brand>",
  "status": "pass" | "fail" | "warn",
  "findings": [
    { "severity": "fail" | "warn" | "info",
      "field": "MT.body" | "dialog.body" | "promotion_name_zh" | ... ,
      "message": "short description",
      "evidence": "snippet from live_state showing the issue" }
  ],
  "summary": "one-line summary"
}

Set status="pass" if findings is empty. Set status="warn" if all findings are severity=warn. Set status="fail" if any finding is severity=fail.
```

## Notes

- Sub-agents run in **parallel** when invoked in a single message — total wall-clock = slowest single brand check (~10-15s) regardless of how many brands.
- Sub-agents are read-only — they cannot break a save. Worst case: false alarm.
- If a bundle is missing `live_state` (older bundle before the inline-state field was added), the sub-agent should mark status=warn with a finding about insufficient data — do not auto-pass.
- After aggregation, **always** present the summary table even if all brands pass. Confidence on a clean run is itself a signal.
- For batch saves (P063-P070), run /deep-qc once per request — do not bundle multiple requests into one sub-agent call.

## Out of scope

- This skill does NOT modify the BO. It is read-only verification.
- It does NOT re-run the save if findings are reported. The user decides whether to fix manually, re-run the canary, or accept warnings.
- It does NOT cover WS1/IGMP brands yet — bundles are only written by QPRO/QP2 runners. WS1 deep-QC can be added once `canary-api-igmp.js` writes bundles.

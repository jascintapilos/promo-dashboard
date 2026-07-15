---
name: deep-qc
description: Post-save deep QC for a promo request using sub-agent fan-out. Spawns one Sentinel sub-agent per saved brand — the strictest inspector in the chain — to validate persisted BO state against the source request. Returns PASS only when every critical field has evidence; INCONCLUSIVE when evidence is missing. Catches MT body brand placeholder, free_credit fill, dialog linkage, multi-merchant mistakes, BO persistence anomalies. Pairs with /pre-qc (pre-commit, plan review). Trigger on `/deep-qc P###`, "deep qc this", "verify save independently", or any post-save verification request.
---

# Deep-QC — Sentinel fan-out for post-save adversarial verification

This skill orchestrates **independent post-save verification** using **Sentinel** — an adversarial, evidence-only QA auditor. The Sentinel sub-agent already knows the rules and persona — see [`.Codex/agents/sentinel.md`](../../agents/sentinel.md) — so this skill stays thin.

**Why Sentinel and not promo-qc here:** post-save verification needs maximum skepticism. Sentinel assumes the creator agent may be wrong, BO may not persist correctly, and successful saves do not guarantee successful configuration. Missing evidence = `INCONCLUSIVE`, never silently `PASS`. This is the final gate before a promo is considered production-ready.

`/pre-qc` still uses `promo-qc` because plan review has different requirements — there's no persisted state yet; the plan IS the source of truth.

## Trigger

User says:
- `/deep-qc P073` or `/deep-qc P073-r1502`
- "deep qc this save"
- "verify P073 independently"
- "Sentinel-check the save"

## Pre-requisite

Saved bundles must exist for the handle. The canary runners auto-write `captures/qc-bundles/<handle>__<brand>.json` after each save, containing source + saved IDs + inlined live BO state. If no bundle exists, tell the user to run the canary save first (with `--commit`).

## Steps

### 1. List saved bundles

```sh
node bin/qc-fanout.mjs <handle> --pretty
```

Shows: `▸ <BRAND> (<platform>)  promo_id=...  template_id=...  dialog_id=...`. If it errors with "No bundles found", stop and tell the user to run the canary save first.

**For forensic / older saves**, add `--refresh` to re-fetch live BO state before listing:

```sh
node bin/qc-fanout.mjs <handle> --refresh --pretty
```

This re-calls `findPromotionByCode` + `getPromotionDetail` + `qcMtTncHyperlink` for each brand (Node-side, no auth touches the sub-agent) and rewrites each bundle's `live_state` block on disk. Use whenever:
- The save happened more than a few hours ago
- Someone may have edited the BO record manually since the save
- You want compliance/audit-level certainty

Skip `--refresh` for normal post-save QC within a few minutes of commit — the embedded snapshot is fresh enough.

### 2. Spawn one Sentinel sub-agent per bundle

For each bundle, invoke the Agent tool with:

```
subagent_type: "sentinel"
prompt: |
  Sentinel — validate the saved promo at: captures/qc-bundles/<handle>__<brand>.json
  Read the bundle and validate per your operating rules. Compare source vs live_state field-by-field.
  Return only the JSON object.
```

Send all invocations in **a single message** so they run concurrently. Sentinel's system prompt has the field-level criteria, suppression list, and return shape — keep the orchestrator prompt short.

### 3. Aggregate verdicts into a table

Each Sentinel returns:

```json
{
  "brand": "QPRO5",
  "verdict": "PASS" | "WARNING" | "FAIL" | "INCONCLUSIVE",
  "fields_checked": [...],
  "fields_inconclusive": [...],
  "findings": [...],
  "summary": "..."
}
```

Aggregate into:

```
Sentinel verdict — <handle>
| Brand | Verdict | Findings |
|---|---|---|
| QPRO5 | ✓ PASS | — |
| QPRO11 | ✗ FAIL | auto_reward_activation=false (will not auto-grant) |
| QP2A | ⚠ INCONCLUSIVE | dialog_popup_list not in bundle — re-run with --refresh |
| QP2B | ⚠ WARNING | ZH name unusual but valid |
```

For FAIL/WARNING/INCONCLUSIVE brands, expand each finding with:
- `field`, `expected`, `actual`
- `impact` (production risk)
- `recommended_action` (specific BO step)
- `evidence` snippet

### 4. Recommend next steps

- **All PASS** → save is production-ready. State this explicitly.
- **Any FAIL** → list each FAIL with its `recommended_action`. For high-risk fields (auto_reward_activation, dialog linkage, currency_id), provide the exact BO modal/path. Do NOT mark anything as resolved until the user confirms the fix.
- **Any INCONCLUSIVE** → tell the user `node bin/qc-fanout.mjs <handle> --refresh` to re-fetch, then re-invoke `/deep-qc`. Sentinel does not pass on missing evidence.
- **WARNINGS only** → user decides whether to act. Explain the unusual pattern Sentinel observed.

**Critical: never override Sentinel.** If Sentinel returns INCONCLUSIVE or FAIL, do not soften the verdict in the table. The whole point of Sentinel is to be harder to convince than a human reviewer.

### 5. Persist verdicts to the QC Results Log (MANDATORY — never skip, even on FAIL/INCONCLUSIVE)

Bot verdicts must not evaporate with the session (monitoring proposal Phase 1: "never omit silently"). After presenting the table, write one entry per brand to a temp file and commit in ONE batch call:

```sh
node bin/log-qc-results-batch.mjs --input=tmp/qc-log-<handle>-sentinel.json --commit
```

Entry shape — `code` from each bundle's `promo_code`:

```json
[
  { "code": "<promo_code>", "brand": "QPRO5", "handle": "P073", "stage": "sentinel", "verdict": "PASS", "trigger": "post-creation", "depth": "full" },
  { "code": "<promo_code>", "brand": "QP2A", "handle": "P073", "stage": "sentinel", "verdict": "FAIL", "trigger": "post-creation", "depth": "full", "reason": "auto_reward_activation=false" }
]
```

- `trigger`: `post-creation` when /deep-qc runs as part of the save auto-flow; `manual` for ad-hoc re-runs on older saves. `depth` is always `full` here (bundle-backed).
- `reason` is required for WARNING/FAIL/INCONCLUSIVE (one-line finding summary).
- If a Sentinel sub-agent timed out and you reported INCONCLUSIVE, log that INCONCLUSIVE — a timeout is a verdict, not a blank.
- Do this in the same turn as the table, before the sheets-writeback step.

## Notes

- Sub-agents run **in parallel** within a single Agent-tool message. Wall-clock ~10-15s per batch regardless of brand count.
- Sentinel is **read-only** (Read/Glob/Grep). It cannot modify the save.
- Bundles persist on disk. `/deep-qc` can be re-invoked on any handle whose save happened with the current code.
- Sentinel's `sentinel.md` system prompt is the source of truth for verdict logic and suppressions.

## Pairs with

- `/qc-engine P###` — source-row validation, runs post-ingest. Uses `promo-qc-engine`.
- `/pre-qc P###` — plan review, runs post-dry-run. Uses `promo-qc`.

## Out of scope

- Does NOT modify the BO, source sheet, or bundle. Read-only verification.
- Does NOT auto-rollback or re-save. User decides what to fix manually based on Sentinel's findings.

**WS1/IGMP coverage is live.** `qc-fanout.mjs` ingests IGMP bundles written by `canary-api-igmp.js`, and `sentinel.md` has a complete IGMP platform overrides table. Run `/deep-qc` for WS1 saves the same way as QPRO/QP2.

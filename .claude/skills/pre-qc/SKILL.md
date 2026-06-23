---
name: pre-qc
description: Pre-commit deep QC for a promo request using sub-agent fan-out. Spawns one promo-qc sub-agent per brand to review the planned API bodies BEFORE the user commits. Catches plan-level issues (naming convention, brand placeholder, FS provider restriction, mechanics within platform limits, stale clone references). Pairs with /deep-qc (post-save). Trigger on `/pre-qc P###`, "pre qc this plan", "check plan before commit", "review before saving", or any pre-commit verification request.
---

# Pre-QC — sub-agent fan-out for pre-commit plan review

This skill orchestrates **independent pre-commit verification** of the canary's planned API bodies before the user adds `--commit`. It spawns one `promo-qc` sub-agent per brand. The sub-agent already knows the QC rules and false-positive list — see [`.claude/agents/promo-qc.md`](../../agents/promo-qc.md) — so this skill stays thin.

## Trigger

User says:
- `/pre-qc P073` or `/pre-qc P073-r1502`
- "pre qc this plan"
- "check P073 before commit"
- "review before saving"
- "fan out QC on the plan"

## Pre-requisite

Plan bundles must exist for the handle. The canary runners (`bin/canary-api.js`, `bin/canary-api-qp2.js`) auto-write `captures/qc-plans/<handle>__<brand>.json` on every dry-run. If no bundle exists, tell the user to run the canary dry-run first (without `--commit`).

**Important:** the idempotency check fires before the dry-run branch — if the promo_code already exists on BO, no plan bundle gets written for that brand.

## Steps

### 1. List plan bundles

```sh
node bin/pre-qc-fanout.mjs <handle> --pretty
```

Shows: `▸ <BRAND> (<platform>)  code=...  bonus=...`. If it errors with "No plan bundles found", stop and tell the user to run the canary dry-run first.

### 2. Spawn one promo-qc sub-agent per bundle

For each bundle, invoke the Agent tool with:

```
subagent_type: "promo-qc"
prompt: |
  Phase: pre
  Bundle: captures/qc-plans/<handle>__<brand>.json
  Read the bundle and run all applicable plan-level checks per your system prompt.
  Return only the JSON object.
```

Send all invocations in **a single message** so they run concurrently. Pass each bundle's absolute file path so the sub-agent can Read it.

The promo-qc sub-agent already has the check list and known false-positives baked into its system prompt — you do NOT need to re-state them here. Keep the prompt short and focused on the bundle path + phase.

### 3. Aggregate results into a pass/fail table

Each sub-agent returns:

```json
{
  "brand": "QPRO5",
  "phase": "pre",
  "status": "pass" | "warn" | "fail",
  "findings": [...],
  "summary": "..."
}
```

Aggregate into:

```
Pre-QC results — <handle>
| Brand | Status | Findings |
|---|---|---|
| QPRO5 | ✓ PASS | — |
| QPRO11 | ✗ FAIL | promo_code missing FT_ prefix; MT body has stale "BP9" reference |
| QP2A | ⚠ WARN | FS spins=92 exceeds 88-spin limit |
```

For FAIL/WARN brands, expand each finding with:
- The `field` and `message`
- The recommended `fix`
- A short `evidence` snippet

### 4. Recommend next steps

- **All PASS** → tell the user they're clear to commit:
  ```
  node bin/canary-multi-brand.js <handle> --commit --parallel --parallel-qc
  ```
- **Any FAIL** → list what to fix in the source sheet, then:
  1. Re-ingest: `node bin/ingest-requests.js`
  2. Re-dry-run: `node bin/canary-multi-brand.js <handle>`
  3. Re-invoke `/pre-qc <handle>`
- **All WARN, no FAIL** → user decides whether to proceed or fix. Explain the rule each warning cites.

## Notes

- Sub-agents run **in parallel** when invoked in one message. Wall-clock = slowest single check (~10-15s) regardless of brand count.
- Sub-agents are **read-only** — they cannot break a save (no save has happened yet).
- Plan bundles are stale until the next dry-run. If `/pre-qc` is invoked long after the dry-run, remind the user the bundle may be outdated.
- The sub-agent's `promo-qc.md` system prompt is the source of truth for what gets checked and what gets suppressed. To change check rules or add false-positives, edit that file — not this skill.

## Pairs with

- `/deep-qc P###` — runs AFTER `--commit`. Uses the same `promo-qc` sub-agent with `phase: post`.

## Out of scope

- Does NOT modify the BO, source sheet, or bundle. Read-only verification.
- Does NOT auto-fix findings. User decides.
- Does NOT cover WS1/IGMP brands yet — plan bundles only written by QPRO/QP2 runners.

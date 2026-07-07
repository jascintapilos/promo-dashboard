---
name: pre-qc
description: Fast pre-execution promo plan review using sub-agent fan-out. Spawns the Pre-QC Agent (promo-qc) per brand to check the canary's planned API bodies for completeness — required fields, naming standards, brand/currency/validity/reward/dialog/provider/promotion linkage presence. Defers deep business-rule validation to Sentinel (post-save). Pairs with /qc-engine (source-row) and /deep-qc (post-save Sentinel). Trigger on `/pre-qc P###`, "pre qc this plan", "check plan before commit", "review before saving", or auto-fired by the assistant after dry-run.
---

# Pre-QC — completeness gate before execution

This skill orchestrates **fast pre-execution completeness review** of the canary's planned API bodies. It spawns one **Pre-QC Agent** (`promo-qc`) per brand. The agent already knows what completeness means in this pipeline — see [`.claude/agents/promo-qc.md`](../../agents/promo-qc.md) — so this skill stays thin.

**Position in the QC chain:**

```
ingest → [/qc-engine]  → dry-run → [/pre-qc]   → commit → [/deep-qc Sentinel]
         ↑ source row             ↑ THIS skill            ↑ post-save audit
         (promo-qc-engine)        (promo-qc)              (sentinel)
```

**Why this is the fast gate:** Pre-QC's job is "is everything present?" — not "is every business rule correct?" Deep business-rule validation is reserved for **Sentinel** (post-save), which runs adversarial audits against persisted BO state. Pre-QC is the cheap, fast check before commit. Catches the obvious blockers without slowing down good saves.

## Trigger

User says:
- `/pre-qc P073` or `/pre-qc P073-r1502`
- "pre qc this plan"
- "check P073 before commit"
- "review before saving"

Also **auto-fired by the assistant** after the canary dry-run for any P### request — see `feedback_auto_pre_qc_on_request`.

## Pre-requisite

Plan bundles must exist for the handle. The canary runners (`bin/canary-api.js`, `bin/canary-api-qp2.js`) auto-write `captures/qc-plans/<handle>__<brand>.json` on every dry-run. If no bundle exists, tell the user to run the canary dry-run first.

**Important:** the canary's idempotency check fires BEFORE the dry-run branch — if the promo_code already exists on BO, no plan bundle gets written for that brand.

## Steps

### 1. List plan bundles

```sh
node bin/pre-qc-fanout.mjs <handle> --pretty
```

Shows: `▸ <BRAND> (<platform>)  code=...  bonus=...`. If "No plan bundles found", stop and tell the user to run the canary dry-run first.

### 2. Spawn one Pre-QC Agent per bundle

For each bundle, invoke the Agent tool with:

```
subagent_type: "promo-qc"
prompt: |
  Pre-QC — review the planned promotion at: captures/qc-plans/<handle>__<brand>.json
  Return only the JSON.
```

Send all invocations in **a single message** so they run concurrently. The agent's system prompt has the completeness check list + suppression list — keep the orchestrator prompt short.

### 3. Aggregate verdicts into a table

Each Pre-QC Agent returns:

```json
{
  "brand": "QPRO5",
  "status": "PASS" | "WARNING" | "FAIL",
  "issues": [...],
  "recommendation": "Proceed to Sentinel (deep-qc)" | "Return to Creator (fix source sheet, re-ingest, re-dry-run)",
  "summary": "..."
}
```

Aggregate into:

```
PRE-QC RESULT — <handle>

| Brand | Status | Issues | Recommendation |
|---|---|---|---|
| QPRO5 | ✓ PASS | — | Proceed to Sentinel |
| QPRO11 | ✗ FAIL | promo_code missing for FS request; no provider scoping | Return to Creator |
| QP2A | ⚠ WARNING | unusual TO multiplier (16x — outside 12-15 range) | Proceed to Sentinel |
```

For FAIL/WARNING brands, expand each issue with:
- `field` and `message`
- `evidence` snippet

### 4. Recommend next steps

- **All PASS** → tell the user to proceed:
  ```
  node bin/canary-multi-brand.js <handle> --commit --parallel --parallel-qc
  ```
  Note: Sentinel will perform the deep audit post-save via `/deep-qc`.
- **Any FAIL** → list each FAIL's `recommended_action`. Typical recovery:
  1. Fix the source sheet (col W/M/N/etc.) per the issue evidence
  2. `node bin/ingest-requests.js`
  3. `node bin/canary-multi-brand.js <handle> --parallel` (re-dry-run; overwrites plan bundle)
  4. Re-invoke `/pre-qc <handle>`
- **WARNINGS only, no FAIL** → user decides. WARNING means "complete but unusual" — often safe to proceed; Sentinel will catch any actual business-rule violations after save.

### 5. Persist verdicts to the QC Results Log (MANDATORY — never skip, even on FAIL)

Bot verdicts must not evaporate with the session (monitoring proposal Phase 1: "never omit silently"). After presenting the table, write one entry per brand to a temp file and commit in ONE batch call:

```sh
node bin/log-qc-results-batch.mjs --input=tmp/qc-log-<handle>-preqc.json --commit
```

Entry shape — `code` from each plan bundle's `promo_code`, verdict per brand from the agent's `status`:

```json
[
  { "code": "<promo_code>", "brand": "QPRO5", "handle": "P073", "stage": "pre-qc", "verdict": "PASS" },
  { "code": "<promo_code>", "brand": "QP2A",  "handle": "P073", "stage": "pre-qc", "verdict": "WARNING", "reason": "unusual TO multiplier (16x)" }
]
```

- `reason` is required for WARNING/FAIL (one-line issue summary).
- FAIL rows still get logged — a Blocked verdict in the log is data, not noise.
- Do this in the same turn as the table, before waiting for commit direction.

## Auto-flow integration

When auto-fired (per `feedback_auto_pre_qc_on_request.md`):
- Show ONLY the table + expanded FAIL/WARNING findings (no verbose JSON in chat)
- If any FAIL: wait for user direction; do NOT auto-commit
- If all PASS or WARNING-only: say "plan validated — ready to commit when you are" and wait for explicit user confirmation

## Notes

- Sub-agents run **in parallel** within a single Agent-tool message. Wall-clock ~5-10s per batch.
- Sub-agent is **read-only** (Read/Glob/Grep). Cannot modify plan, source, or BO.
- The Pre-QC Agent intentionally does NOT do deep business-rule checks (FS spin count math, brand placeholder semantics, T&C hyperlink verification, etc.). That depth happens post-save in Sentinel where persisted state can be verified against intent.
- Plan bundles are stale until the next dry-run. If `/pre-qc` is invoked long after the dry-run and source has changed, remind the user to re-dry-run.

## Pairs with

- `/qc-engine P###` — runs BEFORE dry-run (source-row validation). Uses `promo-qc-engine`.
- `/deep-qc P###` — runs AFTER `--commit` (Sentinel adversarial audit). Uses `sentinel`.

## Out of scope

- Does NOT modify the BO, source sheet, plan bundle, or canary run logs. Read-only.
- Does NOT auto-fix issues. User confirms before changes.

**WS1/IGMP coverage is live.** `canary-api-igmp.js` writes `captures/qc-plans/<handle>__WS1_*.json` and `pre-qc-fanout.mjs` picks them up. The IGMP check table in `promo-qc.md` is fully populated. Run `/pre-qc` for WS1 saves the same way as QPRO/QP2.

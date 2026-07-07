---
name: qc-engine
description: Source-row triage for a promo request using sub-agent fan-out. Spawns the Triage Officer (promo-qc-engine) to confirm an incoming request is structurally processable — required fields present, currencies align with regions, parsed.* has the right keys per bonus_type. Returns READY / RETURN / NOTE. First checkpoint in the QC chain (qc-engine → pre-qc → save → deep-qc). Trigger on `/qc-engine P###`, "triage this request", "check source row", or auto-fired by the assistant after ingest.
---

# QC Engine — source-row triage via sub-agent fan-out

This skill orchestrates **source-row triage** before the canary builds its plan. It spawns the **Triage Officer** (`promo-qc-engine`) for one or more handles. The Triage Officer's job is *processability*, not correctness — see [`.claude/agents/promo-qc-engine.md`](../../agents/promo-qc-engine.md) — so this skill stays thin.

**Position in the QC chain:**

```
ingest → [/qc-engine]   → dry-run → [/pre-qc]   → commit → [/deep-qc Sentinel]
         ↑ THIS skill              ↑ Pre-QC Agent       ↑ Sentinel audit
         (Triage Officer)         (promo-qc)            (sentinel)
```

The Triage Officer answers one question: **"Can this request enter the pipeline?"** If yes → READY (or NOTE if structurally unusual). If no → RETURN (operator fixes the source sheet and re-ingests).

Deeper checks belong downstream: plan completeness → Pre-QC Agent; persisted-state audit → Sentinel.

## Trigger

User says:
- `/qc-engine P172` or `/qc-engine P172-r173`
- "triage this request"
- "check source row for P172"
- "validate before canary"

Also **auto-fired by the assistant** after `node bin/ingest-requests.js` for any P### request — see `feedback_auto_pre_qc_on_request`.

## Pre-requisite

The handle must be ingested — `captures/requests/<handle>.json` must exist. If not, the Triage Officer itself will return RETURN with `recommended_action: run node bin/ingest-requests.js`.

## Steps

### 1. Resolve the handle

For a bare `P###`, the request path is `captures/requests/<handle>.json`. Same resolution as the canary scripts.

### 2. Spawn one Triage Officer per handle

For each handle, invoke the Agent tool with:

```
subagent_type: "promo-qc-engine"
prompt: |
  Triage — validate the promo request at: captures/requests/<handle>.json
  Return only the JSON.
```

For batch ranges (e.g. P060-P073), spawn one sub-agent per handle in **a single message** so they run concurrently.

The Triage Officer's system prompt has the responsibility list, decision rules, and suppressions — keep the orchestrator prompt short.

### 3. Aggregate verdicts into a table

Each Triage Officer returns:

```json
{
  "handle": "P172-r173",
  "verdict": "READY" | "RETURN" | "NOTE",
  "missing_or_unusual": [...],
  "downstream_handoff": "Proceed to canary dry-run" | "Return to operator (fix source, re-ingest)",
  "summary": "..."
}
```

Aggregate into:

```
TRIAGE RESULT

| Handle | Verdict | Missing / Unusual | Handoff |
|---|---|---|---|
| P170 | ✓ READY | — | Proceed to canary dry-run |
| P171 | ⚠ NOTE | SG region but no SG_ZH locale | Proceed to canary dry-run |
| P172 | ✗ RETURN | parsed.spin_count missing for FS request | Return to operator |
```

For RETURN/NOTE handles, expand each entry with:
- `field` and `message`
- `recommended_action` (specific source-sheet step)

### 4. Recommend next steps

- **All READY** → proceed to canary dry-run.
- **Any NOTE, no RETURN** → proceed to canary, mention what's unusual; downstream gates (Pre-QC Agent and Sentinel) will inspect deeper.
- **Any RETURN** → STOP. List each RETURN's `recommended_action`. Operator must:
  1. Fix the source sheet (specific column per evidence)
  2. `node bin/ingest-requests.js`
  3. Re-invoke `/qc-engine <handle>`

**Critical: never override RETURN.** The Triage Officer's job is to reject malformed requests at the gate. Pushing past RETURN guarantees a wasted canary cycle and possibly a corrupt save.

### 5. Persist verdicts to the QC Results Log (MANDATORY — never skip, even on RETURN)

Bot verdicts must not evaporate with the session (monitoring proposal Phase 1: "never omit silently"). After presenting the table, write one entry per (handle × brand) to a temp file and commit in ONE batch call:

```sh
node bin/log-qc-results-batch.mjs --input=tmp/qc-log-<handle>-triage.json --commit
```

Entry shape — `code` from `captures/requests/<handle>.json` `promo_code`, one entry per brand in the request's `brands` list, same triage verdict for all:

```json
[
  { "code": "<promo_code>", "brand": "QPRO5", "handle": "P172", "stage": "triage", "verdict": "READY" },
  { "code": "<promo_code>", "brand": "QP2A",  "handle": "P172", "stage": "triage", "verdict": "RETURN", "reason": "parsed.spin_count missing" }
]
```

- `reason` is required for NOTE/RETURN (use the `missing_or_unusual` summary).
- RETURN rows still get logged — a Blocked verdict in the log is data, not noise.
- Do this in the same turn as the table; don't wait for user direction.

## Auto-flow integration

When this skill auto-fires (per `feedback_auto_pre_qc_on_request.md`):
- Show ONLY the table + expanded RETURN/NOTE entries (no verbose JSON in chat)
- If any RETURN: stop the auto-flow. Wait for user to fix the source sheet and reply.
- If all READY (or NOTE only): say "request triaged — proceeding to dry-run" and continue automatically.

## Notes

- Sub-agents run **in parallel** within a single Agent-tool message. Wall-clock ~5-10s per batch.
- Triage Officer is **read-only** (Read/Glob/Grep). Cannot modify the source sheet or request file.
- For a single complete request, the Triage Officer typically returns READY in <5s.
- The Triage Officer intentionally does NOT do business-logic validation (FS spins ≤88, brand placeholder, etc.). That depth is for downstream gates.

## Pairs with

- `/pre-qc P###` — runs AFTER the dry-run (plan completeness). Uses Pre-QC Agent (`promo-qc`).
- `/deep-qc P###` — runs AFTER `--commit` (persisted-state audit). Uses Sentinel.

Three gates, three personas, three increasing levels of scrutiny:

| Gate | Persona | Scrutiny level | Verdicts |
|---|---|---|---|
| `/qc-engine` | Triage Officer | "Is this processable?" | READY / NOTE / RETURN |
| `/pre-qc` | Pre-QC Agent | "Is everything present in the plan?" | PASS / WARNING / FAIL |
| `/deep-qc` | Sentinel | "Is the persisted state correct? Show evidence." | PASS / WARNING / FAIL / INCONCLUSIVE |

## Out of scope

- Does NOT modify the source sheet or request file. Read-only.
- Does NOT auto-apply suggested fixes.
- Does NOT cover B### (banner) requests — banners have a separate workflow.

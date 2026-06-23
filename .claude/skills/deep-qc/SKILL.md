---
name: deep-qc
description: Post-save deep QC for a promo request using sub-agent fan-out. Spawns one promo-qc sub-agent per saved brand to verify the live BO state against the source request. Catches semantic/textual issues the inline canary QC misses (MT body brand placeholder, free_credit fill, ZH/ID name dup, FS provider restriction, dialog body, multi-merchant linkage). Pairs with /pre-qc (pre-commit). Trigger on `/deep-qc P###`, "deep qc this", "verify save independently", or any post-save verification request that wants a second opinion across multiple brands.
---

# Deep-QC — sub-agent fan-out for post-save verification

This skill orchestrates **independent post-save verification** for promo saves. It spawns one `promo-qc` sub-agent per brand. The sub-agent already knows the QC rules and false-positive list — see [`.claude/agents/promo-qc.md`](../../agents/promo-qc.md) — so this skill stays thin.

The inline canary QC (Levels 1/2/3) confirms numeric and id-linkage correctness on the same thread that did the save. Deep QC adds **fresh-context, brand-isolated semantic checks** that catch:
- MT body using wrong brand placeholder (`:brandname` vs `:merchantname`)
- Free credit amount placeholder not filled
- ZH/ID names duplicating EN
- FS provider restriction not applied
- Dialog body issues, multi-merchant linkage mistakes
- Anything else operator rules dictate (see [`.claude/agents/promo-qc.md`](../../agents/promo-qc.md))

## Trigger

User says:
- `/deep-qc P073` or `/deep-qc P073-r1502`
- "deep qc this save"
- "verify P073 independently"
- "fan out QC for the last save"

## Pre-requisite

Saved bundles must exist for the handle. The canary runners auto-write `captures/qc-bundles/<handle>__<brand>.json` after each save (containing source + saved IDs + inlined live BO state — no auth needed downstream). If no bundle exists, tell the user to run the canary save first (with `--commit`).

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
- You want to confirm the state is still correct (compliance, audit, follow-up)

Skip `--refresh` for normal post-save QC within a few minutes of commit — the embedded snapshot is fresh enough.

### 2. Spawn one promo-qc sub-agent per bundle

For each bundle, invoke the Agent tool with:

```
subagent_type: "promo-qc"
prompt: |
  Phase: post
  Bundle: captures/qc-bundles/<handle>__<brand>.json
  Read the bundle and run all applicable saved-state checks per your system prompt.
  Return only the JSON object.
```

Send all invocations in **a single message** so they run concurrently. Pass each bundle's absolute file path so the sub-agent can Read it.

The promo-qc sub-agent already has the check list and known false-positives baked into its system prompt — you do NOT need to re-state them here. Keep the prompt short and focused on the bundle path + phase.

### 3. Aggregate results into a pass/fail table

Each sub-agent returns:

```json
{
  "brand": "QPRO5",
  "phase": "post",
  "status": "pass" | "warn" | "fail",
  "findings": [...],
  "summary": "..."
}
```

Aggregate into:

```
Deep-QC results — <handle>
| Brand | Status | Findings |
|---|---|---|
| QPRO5 | ✓ PASS | — |
| QPRO11 | ✗ FAIL | MT body missing free_credit value (2 issues) |
| QP2A | ⚠ WARN | ZH name appears to be EN duplicate |
```

For FAIL/WARN brands, expand each finding with:
- The `field` and `message`
- The recommended `fix` (manual BO adjustment, since save has already happened)
- A short `evidence` snippet

### 4. Recommend next steps

- **All PASS** → confirm the save is clean. Move on.
- **Any FAIL** → list what needs to be manually fixed in the BO. For high-risk fields (MT body, dialog body), provide the exact BO path (`/api/bo/messagetemplate/<id>` etc.).
- **All WARN, no FAIL** → user decides whether to fix or accept. Explain each warning's rule.

## Notes

- Sub-agents run **in parallel** when invoked in one message. Wall-clock = slowest single check (~10-15s) regardless of brand count.
- Sub-agents are **read-only** — they cannot modify the save (save has already happened).
- Bundles persist on disk. `/deep-qc` can be re-invoked on any handle whose save happened with the current code (after 2026-06-22).
- The sub-agent's `promo-qc.md` system prompt is the source of truth for what gets checked and what gets suppressed.

## Pairs with

- `/pre-qc P###` — runs BEFORE `--commit`. Uses the same `promo-qc` sub-agent with `phase: pre`.

## Out of scope

- Does NOT modify the BO, source sheet, or bundle. Read-only verification.
- Does NOT auto-rollback or re-save. User decides what to fix manually.
- Does NOT cover WS1/IGMP brands yet — bundles only written by QPRO/QP2 runners.

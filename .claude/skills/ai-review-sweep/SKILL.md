---
name: ai-review-sweep
description: Wave 5 of the promo monitoring system — the capped AI review layer. Selects at most 20 candidates/day across two lanes (bundle-backed Sentinel re-audit, content-judgment review of brand-watch WARNING findings), spawns the reviewers, logs results, records the heartbeat. Runs daily right after brand-watch (5pm). Trigger on `/ai-review-sweep`, "run the AI review sweep", or the scheduled brand-watch follow-up.
---

# AI Review Sweep — capped judgment layer over the daily watch

This skill is Wave 5 of the per-brand monitoring system (see `docs/promo-monitoring-system-proposal.md` + advisor reviews 2026-07-07). Brand-watch (Waves 1–4) finds everything a deterministic rule can catch. This skill spends a small, fixed daily budget of LLM judgment on the two things rules can't resolve:

1. **Bundle-backed re-audit** — codes with a captured original request that are due for a periodic Sentinel check (the `hasBundle` rotation from `find-qc-sweep-candidates.mjs` has existed since Phase 1 with no caller until now).
2. **Content-judgment review** — no-bundle codes carrying an open WARNING that needs a human-like read (seasonal-copy leak: real or look-alike? empty reward T&C: wipe bug or never populated?).

**Budget: ≤20 spawns/day total, split ~evenly across the two lanes.** This is a deliberate cap — do not raise it without updating this doc and re-confirming with the user; the point is a bounded, predictable daily cost, not exhaustive coverage.

## Trigger

- `/ai-review-sweep`
- Scheduled: fires daily right after `brand-watch` via `run-ai-review-sweep.bat`

## Steps

### 1. Select candidates

```sh
node bin/find-ai-review-candidates.mjs --cap=20
```

Writes `captures/ai-review-candidates.json` with `bundleAudits[]` and `contentReviews[]`. If both arrays are empty, skip straight to step 5 (heartbeat only — nothing to review today).

### 2. Spawn Sentinel per bundle-lane candidate

For each entry in `bundleAudits`, invoke the Agent tool with:

```
subagent_type: "sentinel"
prompt: |
  Sentinel — validate the saved promo at: captures/qc-bundles/<bundleFile>
  Read the bundle and validate per your operating rules. Compare source vs live_state field-by-field.
  Return only the JSON object.
```

Send all bundle-lane invocations in **one message** so they run concurrently (same pattern as `/deep-qc`).

### 3. Spawn brand-watch-reviewer per content-lane candidate

For each entry in `contentReviews`, invoke the Agent tool with `subagent_type: "brand-watch-reviewer"`. Build the prompt from the candidate's fields — do not make the sub-agent fetch anything itself:

```
Review this brand-watch finding:

Key: <key>
Brand / Code: <brand> / <code>
Promo name: <name>
Valid: <validFrom> to <validTo>
Flagged because: <findingReasons joined with "; ">

Message templates (per locale):
<for each entry in messageTemplates: "Locale <locale> — Subject: <subject>\nBody: <message stripped of HTML tags if long>">

Return only the JSON object per your instructions.
```

Send all content-lane invocations in **one message**, concurrent with (or immediately after) the bundle-lane batch.

### 4. Aggregate and log results

Build one QC Results Log entry per candidate and write them in a single batch:

**Bundle lane** — map Sentinel's verdict directly:
```json
{ "code": "<code>", "brand": "<brand>", "handle": "<handle>", "stage": "sentinel", "verdict": "<Sentinel PASS|WARNING|FAIL|INCONCLUSIVE>", "trigger": "daily-watch", "depth": "full", "reason": "<Sentinel summary, only if not PASS>" }
```

**Content lane** — map the reviewer's verdict to a log verdict + reason prefix so a human scanning the log immediately knows this was AI-triaged, not a fresh finding:
| Reviewer verdict | Log verdict | Reason |
|---|---|---|
| CONFIRMED | WARNING | `AI-confirmed: <reasoning>` |
| FALSE_POSITIVE | PASS | `AI-reviewed, false positive: <reasoning>` |
| NEEDS_HUMAN | WARNING | `AI: needs human — <reasoning>` |

```sh
node bin/log-qc-results-batch.mjs --input=tmp/ai-review-log-<date>.json --commit
```

Then advance the content-lane rotation cursor for every content-lane candidate **regardless of verdict** (being reviewed, not the outcome, is what should stop it from being re-picked tomorrow):

```sh
node bin/mark-ai-reviewed.mjs "<key1>" "<key2>" ...
```

### 5. Record the heartbeat

```sh
node bin/record-pull-status.mjs ai-review-sweep "AI Review Sweep (5pm)" OK "<n> bundle + <n> content reviewed — <x> confirmed, <y> false-positive, <z> needs-human"
```

Always run this, even when step 1 found nothing to review (`OK — nothing to review today`). A missing heartbeat should mean the sweep crashed, never "there was nothing to do."

### 6. Summarize for the user (if run interactively)

Present a short table: candidate, lane, verdict, one-line reason. Call out any CONFIRMED findings clearly — those are the ones worth acting on.

## Notes

- Sentinel and brand-watch-reviewer are both **read-only**. This skill makes no BO writes.
- If `bin/find-ai-review-candidates.mjs` fails outright (e.g. all sites unreachable), record a `FAILED` heartbeat with the error and stop — do not fabricate a review.
- FALSE_POSITIVE content-lane findings close out the WARNING as a PASS row, but do NOT delete brand-watch's own held state — brand-watch will naturally stop re-flagging it once the underlying check condition changes; this skill's job is only to annotate the log, not to suppress future structural checks.

## Pairs with

- `brand-watch` (Waves 1–4) — produces the WARNING pool this skill samples from, via `captures/brand-watch-state.json`.
- `/deep-qc` — same Sentinel persona, but for fresh saves at creation time rather than periodic re-audit.

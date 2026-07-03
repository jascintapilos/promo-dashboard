---
name: parallel-qc-and-deep-qc
description: "Promo canary QC has four sub-agent upgrades — --parallel-qc (mechanical), /qc-engine (source-row), /pre-qc (plan review), /deep-qc Sentinel (post-save adversarial)."
metadata:
  node_type: memory
  type: project
  originSessionId: d1eb0e77-230d-47b2-80c0-6e8850271078
---

Added 2026-06-22, expanded 2026-06-23. Layered QC across the full canary lifecycle: source → plan → save → persisted. Three dedicated sub-agents, three orchestrator skills.

**Layer A — `--parallel-qc` flag (Node-level, mechanical):**
- Wired into `bin/canary-api.js` (QPRO), `bin/canary-api-qp2.js` (QP2), forwarded by `bin/canary-multi-brand.js`.
- Fires L1/L2/L3 fetches concurrently via Promise.all (~3-5s → ~1-2s per brand).
- Output format identical to sequential mode. Opt-in only.

**Three custom sub-agents** under `.claude/agents/`:

| Agent | Role | Used by | Persona |
|---|---|---|---|
| `promo-qc-engine` | Validate the ingested source row (completeness, naming, parsed.* per bonus_type, mechanics within limits, region/currency match) | `/qc-engine` | Structured validator |
| `promo-qc` | Review planned API bodies pre-commit (FS provider restriction, brand placeholder, stale clone refs) | `/pre-qc` | Methodical reviewer |
| `sentinel` | Adversarially verify persisted BO state post-commit. **Final gate before production.** Returns INCONCLUSIVE on missing evidence; never silently PASS. | `/deep-qc` | Skeptical auditor |

All three: read-only (Read/Glob/Grep). Return strict JSON. Cannot modify state.

**Three orchestrator skills** under `.claude/skills/`:

| Skill | When | Inputs read |
|---|---|---|
| `/qc-engine P###` | After ingest, before dry-run | `captures/requests/<handle>.json` |
| `/pre-qc P###` | After dry-run, before --commit | `captures/qc-plans/<handle>__<brand>.json` |
| `/deep-qc P###` | After --commit | `captures/qc-bundles/<handle>__<brand>.json` |

Bundles are auto-written by the canary runners. `qc-fanout.mjs <handle> --refresh` re-fetches live BO state when the embedded snapshot is stale (forensic / older saves) — auth stays in Node, agent stays read-only.

**Why three different agents (not one):**
- `promo-qc-engine` validates intent vs convention — there's no BO state to check yet.
- `promo-qc` validates plan vs intent — there's no persisted state to check yet.
- `sentinel` validates persisted state vs intent — the only stage where "trust nothing, verify everything" makes literal sense. Sentinel is intentionally stricter than the other two (introduces INCONCLUSIVE verdict, refuses to pass on missing evidence).

**Auto-flow:** when user prompts a P### request, the assistant runs ingest → /qc-engine → dry-run → /pre-qc → wait for commit → --commit → /deep-qc, automatically. See [[feedback_auto_pre_qc_on_request]].

**Why:** Operator concerned that sub-agents in isolation might botch judgment calls — design isolates them to read-only fact-finding only. Saves stay on main thread. Sentinel adds maximum strictness for the production gate.

Related: [[feedback_always_qc_after_save]], [[feedback_auto_pre_qc_on_request]], [[feedback_subagent_design_principles]], [[feedback_simplify_workflows]].

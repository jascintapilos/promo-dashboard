---
name: Prefer focused agent skills over orchestration platforms
description: How to interpret "build a system" requests — translate to a skill + CLI, not infra.
type: feedback
originSessionId: 44de9df1-3765-407d-9cbf-e86e09b6aeb8
---
When Jascinta asks for a "system" or "workflow", her actual intent is a focused agent skill that mirrors existing patterns: trigger phrase (e.g. `upload B01-B03`) → read a sheet → fetch user-supplied assets → drive a browser via the existing `promo-automation` CLI. Do NOT propose Apps Script orchestration, webhooks, dashboards, live link monitors, or Kanban boards unless she explicitly names them.

**Why:** When designing the Banner Operations Workflow (May 2026), the first response laid out Apps Script + dashboards + 18-module orchestration. She corrected: *"The flow needs to be 'upload B01-B03', you access the promo draft folder, user provides compressed banners, you open browser and upload."* Each subsequent simplification was accepted; each piece of orchestration infrastructure I'd proposed was dropped.

**How to apply:** For any new workflow request:
1. Default to a **range-based trigger phrase** as the entry point (`B01-B03`, `P060-P062`).
2. Implement as a **skill** in `.claude/skills/` that wraps a **CLI** in `promo-automation/bin/`.
3. Use the existing `manual → API → skill` methodology (probe Playwright → extract API → wrap as skill).
4. Drive the BO via existing per-brand banner/promo-page upload skills (`qpro-homepage-banner-upload`, `qp2-promo-page-upload`, etc.); add new per-platform uploaders only when probing reveals a new BO family.
5. Add Apps Script, dashboards, live monitors only if she names them directly. The Banner Schedule sheet stays the source of truth — no replacement, no shadow table.

---
name: project-automation-tab
description: Automation tab in dashboard.html — static management/stakeholder view of all automation programs
metadata: 
  node_type: memory
  type: project
  originSessionId: 648c60e5-e96e-4acd-850a-6de4e5d37482
---

Dashboard Automation tab added 2026-06-25. Static/curated data (not sheet reads) — describes the automation programs themselves, not BO records.

**Why:** Management visibility into how much is automated, what's live vs in-dev vs blocked, and impact delivered.

**How to apply:** Never add BO record data (promo codes, banners) to this tab — that's the Ops tab. This tab covers the automation portfolio itself.

7 sections:
1. Exec banner (gradient, headline stats)
2. KPI cards (Total/Live/Dev/Planned/Blocked/Hours Saved/Manual%)
3. Portfolio table — 15 rows, filterable by status/category/owner
4. Roadmap (5 stages: Planning → Dev → Testing → Production → Optimisation)
5. Business impact (hours-saved bars + 6 metric tiles)
6. Upcoming improvements (Next / Future two-column)
7. Risks & Blockers table + Automation Health traffic-light (Stable / Needs Improvement / Blocked)

Data lives in `AUTO_DATA` const in dashboard.html (search for "Automation Tab" comment, ~line 2697).

**TDZ bug fixed 2026-06-25:** Hash-routing IIFE must come AFTER the `const AUTO_DATA`/`STATUS_META`/`IMPACT_META`/`let _atInit` declarations — if placed before, those consts are in TDZ when `switchView('at')` is called on page load. Current order: switchView fn → AUTO_DATA block → hash-routing IIFE.

Deploy: run `bin/deploy-dashboard.bat` from the `promo-automation` dir, then Ctrl+Shift+R on the dashboard.

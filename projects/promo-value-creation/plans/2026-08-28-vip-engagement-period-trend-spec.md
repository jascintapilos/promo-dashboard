# Spec: add code validity dates to the VIP pull → engagement period trend

**Status:** PROPOSED
**Created:** 2026-08-28
**Goal:** Give each VIP code a `start_date` / `end_date` so the Engagement lane (and the rest of VIP) can be analysed **over time** and can tell an **active** code from an **expired** one — instead of treating renewed campaign codes as permanent.

## Why (the problem)
The Engagement lane is renewed campaign codes that expire — mini-games (Lucky Wheel / Scratch Card / Mystery Ang Pow, re-issued each period) and the time-boxed **World Cup daily check-in**. The current VIP metrics rows carry **no date/expiry field** (only spend/claims/claimers/coverage). Consequences:
- We can't show whether a program is **growing or fading** period-over-period (question 1 for engagement).
- We can't distinguish an **active** code from an **expired** one, so per-code keep/trim verdicts were dropped (correctly) — but with dates we could keep verdicts on the *live* issue only.
- The "what worked" view (already built) is a **static** roll-up; with dates it becomes a trend ("is Free Spins' reach rising each month?").

## What to add (per code)
| Field | Meaning | Source |
|---|---|---|
| `start_date` | code goes live | BO promo config (`ValidFrom` / start) |
| `end_date` | code expires | BO promo config (`ValidTo` / end) |
| `period` (derived) | `YYYY-MM` of `start_date` | computed |
| `active` (derived) | `end_date >= data_as_of` | computed (`data_as_of` = 2026-08-26) |

## Where to add it
- **Pull:** `bin/vip_report/pull_tl_vip_codes.mjs` / `bin/vip_report/00_vip_codes.py` — the code-metadata fetch. The BO promotion object already returns start/end dates; capture them onto each code row alongside name/mechanic/sub_type.
- **Compute:** `bin/vip_report/02_compute_metrics.py` — pass `start_date`/`end_date` through to each `codes[]` entry, and derive `period` + `active`.
- No other pull changes; dates are already in BO, just not carried through.

## What it unlocks (report changes, `templates/acq-dashboard.html`)
1. **"Engagement over time"** — a small trend (claims / players / cost-coverage per `period`, per program), so Lane D shows the shape (World Cup spikes then falls; mini-games stable). Feeds the "growing or fading?" question.
2. **Active vs expired badge** — mark live codes; only the live issue can carry a keep/trim call, expired ones stay register-only.
3. The **"what worked"** card gains a trend column (is the winning reward type's reach rising or falling).

## Out of scope (flagged, needs more than dates)
- **Habit lift** — does an engager deposit *more often* than a comparable non-engager? Needs a **member-level** engagement→deposit-frequency join (not just code dates). That's the real strategic KPI for engagement; spec it separately if wanted.

## Acceptance
- Every VIP code row has `start_date`/`end_date` (or explicit null with a logged count of how many lack dates in BO).
- `period` and `active` derive correctly; `active` count reconciles with a manual BO spot-check.
- Lane D can render at least one period-trend series without new pulls beyond the date fields.

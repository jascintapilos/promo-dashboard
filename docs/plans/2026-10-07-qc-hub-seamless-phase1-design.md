# QC Hub — "Seamless for daily use" · Phase-1 Design

**Date:** 2026-10-07
**Owner:** Wai Yip (TL) · built by Claude Code
**Status:** Design — awaiting approval before planning

---

## Goal

By next week the promo team can open the QC Hub **every day** and get a **trustworthy automatic verdict** on the brands that carry the most promo volume, with **no babysitting** and **no surprise "manual needed"** when the data actually exists.

This is scoped for *reliance*, not for lighting up 27 logos. Depth on the brands they touch beats breadth that's flaky.

## Why phased (and not "all 27 this week")

All-27-automatic is a ~3-phase program because the brands run on three platform families with genuinely different blockers:

- **QP2** (ACE66 / IBC22 / SPADE66 / KING333) — server-readable, easiest, and **the 4 highest-volume brands.**
- **QPRO** (1–17) — back office blocks server reads (403); every one must go through the relay/browser path.
- **WS1/WS2 (IGMP)** — need per-region session files **and** have a real code gap (the reader never pulls promo content, so locale checks always fall to manual). Didn't even register in the volume data.

**The data decided Phase 1.** Promo volume by brand (BO code-listing size) ranks ACE66 (11.9k), IBC22 (10.5k), BP9/QPRO1 (10.2k), SPADE66 (9.4k), KING333 (9.4k) on top. The top 4 are the QP2 family — which is also the cheapest to enable. Volume and ease align. Actual hub usage today: 46 runs, 100% QP2A — the team only trusts the one brand that's already seamless.

## Phase-1 scope (this week)

### Workstream A — Reliability enablers (make auto-QC hands-off; benefits every brand)

1. **Wire the live Promo Request Sheet fallback into Run QC.** *Biggest single lever.* Today `/api/run-qc` calls the synchronous compare that resolves the "expected answer" from **local files only**; `runComparisonWithSheetsFallback` exists but is only called by the offline acceptance script. Result: any requested code without a local bundle falls to MANUAL. Wiring the sheet fallback fixes this for all brands at once.
2. **Turn the relay into an auto-recovering service.** Keyed once; worker auto-starts on VDI login; machine kept awake; worker auto-relaunches on crash; relay-health visible in the admin panel. (Bounded by VDI uptime — see constraint below.)
3. **Friction fixes:**
   - Results survive a page refresh (persist/auto-save instead of browser-memory-only).
   - Fix the duplicate-history-row bug (a failed sheet write appends a second JSONL line with the same uuid; History doesn't dedupe).
   - Make three outcomes visually distinct: **"couldn't reach the back office"** vs **"found a real problem"** vs **"code not found."**

### Workstream B — Coverage (the volume win)

4. **Light up QP2B / QP2C / QP2D (KING333 / ACE66 / SPADE66).** Same engine as the proven QP2A, server-readable, no relay. Needs: their site logins/config + a confirm that the game-provider API HTTP 500 (seen ~2 months ago) is healthy again. **All three in this week.**
5. **Confirm QPRO1 & QPRO5 are genuinely seamless** on the hardened relay.

### Workstream C — Adoptable (because they're relying on it)

6. **Brand onboarding = config, not code** (at least for the QP2 additions), so coverage keeps growing after this week without a dev cycle. Today the 4 brands are hardcoded in `brand-config.js` (`MVP_BRANDS`).
7. **One-page "how to use it"** + confirm everyone who needs access has it (roles/allowlist).

## Key constraint: office VDI is the only relay host

There is no dedicated always-on machine. The relay worker runs on the office VDI, which may sleep/log off.

**Implication & honest expectation:**
- **QP2 family = fully hands-off, 24/7** (no relay dependency — server reads directly).
- **QPRO1/5 = hands-off while the VDI is on; auto-recovers when it's back.** When the VDI is asleep, QPRO codes fall to a safe "manual" fallback (never a false pass) and resume automatically once the VDI is up.
- Mitigation: scheduled-task auto-start on login + keep-awake + auto-relaunch (reuse the existing hidden-wscript scheduled-task pattern already in the repo).

## Success criteria (how we'll know it's done)

- [ ] A requested code **present in the Promo Request Sheet** produces an automatic verdict (SAFE / REVIEW / NOT-SAFE) end-to-end for **all four QP2 merchants** — not MANUAL — with no local bundle required.
- [ ] A code with **no local bundle** resolves its expected source automatically from the sheet.
- [ ] After a VDI reboot + login, the relay worker is back **online automatically** (admin relay-health shows it) with no manual steps; a QPRO1/5 code auto-QCs.
- [ ] A page refresh **no longer wipes results**; History shows **no duplicate rows**; the three outcome states are clearly different on screen.
- [ ] Adding a QP2 merchant is a **config edit, not a code deploy**.
- [ ] A one-page usage guide exists and the team's brands are enabled & accessible.

## Out of scope (named, so it's not a silent cut)

- The 15 remaining QPRO brands — **Phase 2**, in volume order: BX99 → YE55 → WILD33 → MBS66 → 12HUAT → UO8 → E688 → WYN8 → ED98 → MINT33 → SBO18 → MSB66 → XE38 → SBO28 → IBC7.
- WS1/WS2 (IGMP) + the content-gap fix — **Phase 3.**
- A pass-rate / monitoring dashboard inside the hub (separate pipeline already exists).
- "Fix with Claude" becoming a true auto-fixer (stays a copy-paste prompt helper).

## Risks / unknowns to resolve in planning

1. **QP2 B/C/D site credentials** — do we have logins for KING333 / ACE66 / SPADE66? (Gates Workstream B.)
2. **QP2 game-provider 500** — confirm live before relying on it.
3. **Sheet fallback needs Google OAuth creds on the deployed server** — may be an infra/secret step, not just code.
4. **VDI uptime policy** — when does it sleep/log off? Determines real QPRO availability.
5. **Deploy discipline.** Changes land on `bitbucket/main` (auto-deploys to the live hub). The current working branch is diverged (36 ahead / 67 behind main). Phase 1 must be landed onto `main` via the isolated-worktree method **and boot-tested in prod mode before every push** — there is a known 502 class of bug where an untracked file (e.g. a half-finished import) rides along and crashes startup. This discipline is mandatory for each push.

## Deliverable shape

Incremental, each independently deployable to the live hub:
1. Sheet-fallback wired (enabler) → deploy → verify QP2A still green.
2. QP2B/C/D enabled (config + creds) → deploy → verify all four auto-QC.
3. Relay auto-recovery (VDI scheduled task + worker hardening) → verify QPRO1/5.
4. Friction fixes (persistence, dedupe, state clarity) → verify.
5. Onboarding-as-config + usage guide.

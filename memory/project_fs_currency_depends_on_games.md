---
name: FS Currency popup gated by Free Spin Games selection
description: On QPRO Create form, the "+ Promotion Currency" button only enables after BOTH Free Spin Games dropdowns (Provider + Game) commit to the form. Past "Currency popup blocker" runs may actually be a Games-commit failure surfacing downstream.
type: project
originSessionId: 661564a2-cb3f-4d09-8302-db01d7387b43
---
On the QPRO Create Promotion Code form with Promo Type = Free Spin, the "+ Promotion Currency" button does NOT appear (or stays disabled) until the two cascading Free Spin Games dropdowns (Provider + Game) have both committed values to the Angular form.

**Why:** Operator observation (Jascinta, 2026-05-13). Confirmed against the ~12 prior failed FS canary runs — all used operator handoff for Games and timed out at Currency. The runs that "failed at Currency" likely failed because Games never properly committed, so Currency never enabled, so the popup_fill_currency handler's 5s wait for the inner form timed out.

**How to apply:**
- Fix Games auto-pick FIRST. The kt_dropdown_pick rewrite (commit-verify via trigger text readback + native-DOM-click fallback) lives in `bin/canary-write.js`.
- Only after a successful FS run with Games committed should we treat Currency-inner-Submit as a separate problem worth probing.
- The memory note `session_2026-05-13_part2_qpro_fc_works_qp2_fs_blocked.md` line 54 ("DO NOT RE-ATTEMPT WITHOUT THIS PROBE") was written before this dependency was known and may be overcautious. The Currency inner-form probe may still be valuable, but it is NOT a blocker for the next FS canary attempt — Games auto-pick is.

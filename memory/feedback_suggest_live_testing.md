---
name: feedback-suggest-live-testing
description: "Always proactively suggest live testing when building or modifying a skill/runner — don't wait for the user to ask."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 98902d81-8b64-40ba-84cb-6eac991c35b2
---

When a new skill, runner, or QC check is built or modified, always proactively suggest a live test before marking it done.

**Why:** Jascinta wants to verify things work in production before relying on them. Code that looks correct can still fail against live BO APIs (date format mismatches, session issues, etc.). The V12 date-format bug proved this — it only surfaced during live commit.

**How to apply:** After any code change to a runner/skill/QC, say "This needs a live test — here's the command to run it" with the exact steps. Don't present the work as complete until tested or explicitly say it's untested.

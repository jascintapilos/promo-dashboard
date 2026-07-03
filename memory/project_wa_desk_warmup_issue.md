---
name: wa_desk_warmup_bottleneck
description: WhatsApp number warm-up required before sales outreach; recurring blocker affecting agent productivity
metadata: 
  node_type: memory
  type: project
  originSessionId: b851b2ae-5dd8-41af-a72c-31fb88c60cb5
---

## WA Desk Number Warm-Up Issue

**Status:** Recurring operational blocker (confirmed via [Sales] Leaders Telegram discussion)

**What it is:** New WhatsApp numbers must be "warmed up" (activated/initialized) before agents can use them for active outreach. Without proper warm-up, accounts face rate-limiting, bans, or message send failures on first contact.

**Why it happens:**
- Numbers assigned to agents in cold state (uninitialized)
- No pre-staging or pre-validation step in workflow
- Manual warm-up process not documented or enforced
- Team doesn't understand WADesk account initialization requirements

**Impact on Sales:**
- Agents can't send messages immediately after receiving numbers
- Customer contact delays (first outreach fails)
- Performance metrics tanked (timeouts vs poor response rates)
- Team blames "system" when root cause is cold-start account state

**What "warming up" means:**
1. Register number with WhatsApp's servers
2. Send initial test messages OR receive incoming activity
3. Validate account status in WADesk dashboard  
4. Confirm dynamic account switching enabled
5. Only THEN assign to active agents

**Root Cause:** Missing pre-assignment QA step; numbers handed off untested.

**Solution (proposed):**
Implement pre-staging validation: test each number's send/receive capability before distribution to sales. Est. 70% reduction in activation failures.

**Reference:** WADesk Preferences document (forwarded by Liu Xinye in [Sales] Leaders TG) shows Dynamic Sorting + Contact Card + Media Backup settings tied to warm-up state.

**When to revisit:** Next sales ops planning cycle; validate warm-up process baseline before scaling numbers.

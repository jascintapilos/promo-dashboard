---
name: feedback-browser-identity
description: "How to identify Jascinta's Chrome browser when multiple browsers are connected"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 648c60e5-e96e-4acd-850a-6de4e5d37482
---

At the start of any browser automation session, call `list_connected_browsers`. There will typically be 2 connected browsers (both Windows, both local). Neither has been persistently named yet.

**To identify Jascinta's browser:** call `switch_browser` at the very start of a new session — it sends a pairing request to all connected browsers and lets Jascinta click "Connect" in her own Chrome, where she can also type a name. Once she names it (e.g. "Jascinta's browser"), that name persists and `list_connected_browsers` will show it.

**Do NOT use switch_browser mid-session** — it disconnects the current session and would kill any in-progress work (e.g. GAS auth flows, open tabs).

**Why:** Two Chrome instances are connected, Menhua's and Jascinta's. Using the wrong one caused problems in previous sessions (GAS deployed under wrong account). Always confirm identity before opening any tabs.

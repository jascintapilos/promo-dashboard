---
name: feedback-dashboard-hard-refresh
description: "After deploying dashboard.html changes, instruct user to hard refresh (Ctrl+Shift+R) — the Refresh button only re-fetches sheet data, not JS code."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 648c60e5-e96e-4acd-850a-6de4e5d37482
---

After any deploy of `dashboard.html` to GitHub Pages via `bin/deploy-dashboard.bat`, always tell the user to **hard refresh** (Ctrl+Shift+R / Cmd+Shift+R) to pick up the new JS.

**Why:** The dashboard's in-page "Refresh" button only calls `loadData()` which re-fetches Sheets API data. It does NOT reload the HTML/JS. GitHub Pages serves HTML with `Cache-Control: max-age=600` (10 min), so the browser keeps using stale JS until the user hard-refreshes or 10 minutes pass. Meta `Cache-Control` tags in the HTML don't override the HTTP header.

**How to apply:**
- After every deploy: "Hard refresh the dashboard (Ctrl+Shift+R) to pick up the new code."
- If user says fix doesn't work, verify they did a HARD refresh (not just F5 or Refresh button). Offer incognito as final test.
- For really stuck cache: append `?v=<n>` to URL to force fresh fetch.

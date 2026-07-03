---
name: project_dashboard_auth_rootcause
description: "Promo Control Tower dashboard login is dead — root cause is the Apps Script web-app access mode, diagnosed 2026-06-12."
metadata: 
  node_type: memory
  type: project
  originSessionId: 4cd7577f-0935-4618-b1e0-f88ce03b054b
---

**Promo Control Tower** = Apps Script web app. SCRIPT_ID `1G8PrjOQ45yafM4lo3dL1AG8HKFSZ8tSlX7ei9EPZgw6bacjHk5CPtTW_`, live deployment `AKfycbx-Hy_OFd55Fbwdsf29LQxh0NxSLWwXWbVsEQ6AFoecWGgANAtsohO88pSJoCHCuHawzQ`, exec URL `https://script.google.com/a/macros/thebrandingpeople.co/s/AKfycbx.../exec`. Pull live source via `script.googleapis.com/v1/projects/{SCRIPT_ID}/content` with a Google OAuth token (see bin/fetch-served.mjs / deploy-v74).

**SYMPTOM (2026-06-12)**: "Sign in with Google" button not clickable — login screen never lets anyone in. Console shows a SyntaxError in Google's `userCodeAppPanel?...AuthDialog=true` panel (that error is Google-side noise, NOT the cause).

**ROOT CAUSE (verified)**: deployed `appsscript.json` webapp config is `executeAs: USER_DEPLOYING` + `access: ANYONE`. In ANYONE mode Google returns `Session.getActiveUser().getEmail()` = '' (privacy) → `serverGetCurrentUser()` (Code.gs ~L58, the v69 version with NO try/catch) returns role=guest, approved=false → login screen. `doGoogleLogin()` just `location.reload()`s → same empty identity → same screen. Dashboard's static JS is fine (6/6 script blocks parse; repeated TASK_DRAWER injects are IIFE-wrapped, no redeclaration). The v72–74 patches that worked around this were REVERTED by hard-reset-to-v69.mjs.

**FIX (needs a decision + a redeploy — NOT a content-only edit)**: To recognize staff, change `access: ANYONE` → `DOMAIN` (hard-gate to @thebrandingpeople.co; then getEmail() returns the visitor's email and resolveRole_ works off the Users sheet). `executeAs`/`access` are DEPLOYMENT-baked — a manifest edit alone won't take effect; needs a new deployment version, and an access-mode change may require the owner to re-authorize in the Apps Script editor. Alt: restore v74's resilient serverGetCurrentUser (treat reachable users as admin) — content-only, but keeps access:ANYONE = anyone with the link gets in (security soften). Access model = Jascinta's call. She has previously preferred AVOIDING Apps Script complexity ([[feedback_simplify_workflows]]) — consider whether the dashboard is worth maintaining vs a lighter view over the Control Layer sheet.

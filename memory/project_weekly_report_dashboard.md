---
name: project_weekly_report_dashboard
description: "Live HTML dashboard for the Weekly Report sheet, fed by a deployed Apps Script JSONP endpoint."
metadata: 
  node_type: memory
  type: project
  originSessionId: 648c60e5-e96e-4acd-850a-6de4e5d37482
---

Built a live dashboard for the "Weekly Report" Google Sheet (id `1iGOcxKr9S9WFlrHihDfti_RsoUPgazDqnNKAPWMcPkI`), requested 2026-06-15.

**LIVE (public):** https://jascintapilos.github.io/promo-dashboard/dashboard.html (GitHub Pages — migrated from Netlify 2026-06-16). Title = "Promo Team Operations". GitHub username: `jascintapilos`, repo: `promo-dashboard`, git repo at `C:\Users\vdiuser\Downloads\promo-automation\dist\`.

**Files** (in `C:\Users\vdiuser\Downloads\promo-automation\`):
- `dashboard.html` — self-contained executive/BI dashboard (redesigned 2026-06-15 for stakeholders: Sales Leads/HOD/Mgmt). Structure: Row1 exec KPIs (Total deliverables 171, Brands 21, Regions 5, Platforms 6, Team util 56%, Last updated); Row2 **Coverage by brand** + **by region** (clickable bar drill-downs); Row3 Workload distribution + Team capacity (risk callout); Row4 collapsible detailed logs. Fetches live via JSONP. Brand names normalized (strip spaces, "QPRO 5"→"QPRO5", exclude "ALL BRANDS"); regions split on +/, ("MY + SG"→MY,SG). NOTE: bar/fill spans MUST be `display:block` or width/height collapse to 0.
- `index.html` — deploy copy (must mirror dashboard.html). `dist/` holds both for CLI deploy.
- `bin/dashboard-data.gs` — Apps Script source (mirror of deployed code).

**Endpoint**: standalone Apps Script project (owner jascinta.pilos@thebrandingpeople.co), deployed as Web App, execute-as-Me, access=Anyone. Reads ALL tabs, detects tables by header signature (promo/banner/game/utilisation/crm). Web app URL = `https://script.google.com/macros/s/AKfycbxXYSn6VSTL2Y5pZPRUDuisI8EIw0XiKjSr_3DoUKgZEcEcxkpQHzfJUyD1UVF4VBWBNw/exec` (hardcoded in dashboard.html as `APPS_SCRIPT_URL`). Project edit URL: `script.google.com/home/projects/15mYzwwZdX3XIlJVJcs1ts7nbhmb_nLM3b8Ib8OZTGeWw9gB_VgCe3TNw/edit`.

**Redeploy after editing .gs**: paste into Monaco via `window.monaco.editor.getEditors()[0].setValue(...)`, Ctrl+S, Deploy → Manage deployments → pencil → Version: New version → Deploy (keeps same /exec URL). First-ever deploy required interactive OAuth consent (user approved).

**Sheet tabs**: Promo Code Log (20 rows, not 7!), Banner Log (75), CRM Assignment Log (73), New Games (3), Utilisation (6 staff + total). Dates come back as Date objects → formatted dd/MM/yyyy server-side.

**GitHub Pages deploy:** Run `bin\deploy-dashboard.bat` from `C:\Users\vdiuser\Downloads\promo-automation\dist\`. Credentials stored via git credential store at `~/.git-credentials`. To redeploy after editing: update `dashboard.html` (and `index.html` if needed), then run the bat. The bat pushes `dist/` branch to `jascintapilos/promo-dashboard` and GitHub Pages serves it.

**Netlify (superseded):** Site "promooperations" id `6d606c83-34aa-451b-962e-b92385b07e8d` was the previous host. Netlify CLI token still saved locally but the live URL has moved to GitHub Pages.

**PRIVACY (deferred, low priority per user 2026-06-15):** live site is fully PUBLIC — exposes staff utilisation + Elyssa maternity-leave note. Free fix = set Apps Script access to "Anyone within The Branding People" (viewers need TBP Google login; test JSONP still loads). Paid fix = Netlify Pro password protection.

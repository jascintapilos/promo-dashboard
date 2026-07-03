---
name: reference-gdoc-creation-on-vdi
description: How to produce a Google Doc from generated content on this VDI — no local converters; Drive MCP conversion limits.
metadata: 
  node_type: memory
  type: reference
  originSessionId: d7233562-e789-4471-affd-20b1b17070db
---

Producing a Google Doc from generated content on Jascinta's VDI:

- **No local conversion tooling**: no Python, pandoc, LibreOffice, or MS Word (Word COM also unavailable). Can't build a `.docx` locally.
- **Drive MCP `create_file` only auto-converts** `text/plain` → Google Doc and `text/csv` → Sheet. An HTML upload stays as `text/html` (NOT a native Doc). `.docx` is not auto-converted via this path either. (Note: a `.md` uploaded earlier did land as a Doc — extension-based, untested deliberately.)
- **MCP has NO permission/share tool and NO delete tool** — created files are private to `jascinta.pilos@thebrandingpeople.co`; sharing + cleanup are manual in Drive.
- **Best path for FORMATTED output (tables/bold/headings):** upload as `text/html`, then user opens it via **"Open with → Google Docs"** (one click) to get an editable native Doc with tables preserved. Link form: `https://drive.google.com/file/d/<id>/view`. Confirmed with Jascinta 2026-06-05 — she chose this over plain-text.
- **For a one-step NATIVE editable Doc with no manual step:** use `text/plain` — but it's unstyled (no tables/bold). Trade-off only; rejected for management docs.

Related: [[project_sheets_api_oauth]] (separate OAuth path for live Sheets read/write).

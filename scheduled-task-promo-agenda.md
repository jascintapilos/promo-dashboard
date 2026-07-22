# Scheduled Task — Promo Team Weekly Agenda

## How to install

In a fresh Claude Code session (interactive mode), paste this single message:

```
Create a scheduled task with:
- taskId: promo-team-weekly-agenda
- description: Friday 9:27 AM MYT — auto-build Promo Team Weekly Meeting Agenda as a Google Doc
- cronExpression: 27 9 * * 5
- notifyOnCompletion: true
- prompt: <paste the full PROMPT block below>
```

Claude will then call `mcp__scheduled-tasks__create_scheduled_task` and show an approval dialog. Click **Approve**. Done.

---

## Schedule

- **Cron:** `27 9 * * 5` (Friday 9:27 AM local time / MYT)
- **Why 9:27:** ~1.5 hours buffer before 11 AM circulation deadline. Avoid :00 / :30 minute clustering. Bot run takes ~5–10 min, review/edit takes ~20–30 min.
- **Persistence:** stored in `C:\Users\vdiuser\.claude\scheduled-tasks\promo-team-weekly-agenda\SKILL.md`. Survives app restarts. **Only fires while Claude Code app is open** — runs on next launch if app was closed.

---

## PROMPT (paste this verbatim as the `prompt` field)

```
You are generating the Promo Team Weekly Meeting Agenda for Jascinta Pilos (jascinta.pilos@thebrandingpeople.co), a Promo Specialist at The Branding People. This task runs every Friday 9:27 AM MYT. Goal: produce a polished Google Doc Jascinta can review and circulate by 11:00 AM the same day.

═══════════════════════════════════════
STEP 0 — CONTEXT
═══════════════════════════════════════
- "This week" = the past Monday 00:00 MYT through the moment you run (today, Friday).
- "Next week" = the upcoming Mon–Fri.
- Today's date is the system date; compute Monday-of-this-week and Mon-Fri-of-next-week from that.
- Read memory file C:\Users\vdiuser\.claude\projects\C--Users-vdiuser-Downloads-promo-automation\memory\MEMORY.md for project context (brand ecosystem, IGMP platform, Directory pointer, etc.) — only the index entries; don't load every linked file.

═══════════════════════════════════════
STEP 1 — GATHER (run probes in parallel where possible)
═══════════════════════════════════════

A) SLACK (mcp__e927637e-... tools — search_public_and_private + read_thread + read_channel):
- Channel #ba-promo (C07KKVD1GTE): all messages since Monday 00:00 MYT
- Channel #promotions-team (C09LT8W2D70): all messages since Monday 00:00 MYT
- DM with Wai Yip (user U03PNM6HZ5F): pull only team-related topics (skip personal/HR-confidential unless flagged for action)
- Use search syntax: `after:YYYY-MM-DD in:#channel-name`, sort=timestamp, sort_dir=desc

B) GOOGLE DRIVE (mcp__d9e74fd6-... tools):
- list_recent_files (orderBy=lastModified, pageSize=30) → filter for files modified since Monday
- search_files with `modifiedTime > 'YYYY-MM-DDT00:00:00Z'` (this past Monday in UTC) — focus on the Promotions (The Branding People) shared drive and related folders

C) GMAIL (mcp__583835c0-... tools):
- search_threads with `after:YYYY/MM/DD (promo OR promotion OR BO OR brand OR IT OR migration OR meeting)` since Monday

D) CALENDAR (mcp__cb578a17-... tools):
- list_events for next Mon 00:00 → next Fri 23:59 MYT, orderBy=startTime
- Calendar timezone: Asia/Kuala_Lumpur

E) TELEGRAM (via Claude in Chrome — mcp__Claude_in_Chrome__ tools):
- IMPORTANT: there are multiple browsers connected. The one named "Telegram" (deviceId 63dfc9c7-788d-4272-9fd4-b67f083c397f) is the right one. Call list_connected_browsers first; if a browser is named "Telegram", use select_browser with that deviceId. Otherwise ask the user via AskUserQuestion which browser to use.
- Open https://web.telegram.org/a/ if not already
- Read these chats (find by name, click, screenshot, scroll up to capture this-week's messages):
  • Promotion Team
  • BA x PROMO
  • IB9 - 24hours Technical Support (IT updates affecting promo)
  • PP Game & Promo - Skyez - Mybet88
  • PP Game & Promo - Alphaiota
  • Promo - Ai (AI promo automation initiative with Tommy Yeap/Aiodin)
  • BA - Innoewave x Alpha Iota
  • Wai Yip DM (team-related only)
- Telegram Web's DOM is opaque to most selectors — use screenshots + scroll + read_page rather than complex JS. Use browser_batch for click→wait→screenshot sequences.
- If Claude in Chrome is unavailable or browser not connected, skip Telegram and note that in the agenda.

═══════════════════════════════════════
STEP 2 — STRUCTURE (5 sections, EXACT order)
═══════════════════════════════════════

Section 1 — OPERATION ISSUES TO BE ADDRESSED
- Current open blockers, problems, in-flight fixes
- Include carryovers from last week if still unresolved
- Flag any URGENT/today items at the top with 🚨

Section 2 — NEW INITIATIVES / CHANGES
- New tools, dashboards, processes, naming conventions
- New games, campaigns, brand setups
- IT/platform changes affecting promo (e.g., domain migrations)
- AI / automation initiatives (esp. Promo-Ai Playwright→API work with Tommy/Aiodin)

Section 3 — SUMMARY OF THIS WEEK — JASCINTA + TEAM
- Break out per person: Jascinta (me) first, then Wen, Alysa, Elyssa, Gaby (Gabrielle Tiffany), Bangun, Mimi (FT)
- 3-7 bullets per person; specific dates within the week
- IMPORTANT NAMING: "Diandra" and "Bangun" are the SAME PERSON. Always use "Bangun" in the agenda. If you see Diandra in Slack, attribute the activity to Bangun.

Section 4 — LEARNING POINTS / INSIGHTS
- Lessons surfaced this week (e.g., platform stack confusion, naming convention gaps, catalog inconsistencies, process gaps)
- 4-7 items; each with a brief "Lesson:" takeaway

Section 5 — NEXT PLAN (Mon → Fri next week)
- 5.1 Scheduled Meetings (table-like list with day, time MYT, title, notes)
- 5.2 Hard Deadlines next week
- 5.3 Action Items / Workstreams (numbered list, 10-15 items)
- 5.4 Process / Team (PromoOps_Control_Layer adoption, onboarding, tagging, prefix hygiene)

End with REFERENCE LINKS section: Promo Code Request Tracker, PromoOps_Control_Layer, Banner Schedule, Team Ops & QC Dashboard, Directory, plus any campaign-specific drafts referenced in body.

═══════════════════════════════════════
STEP 3 — DELIVER AS GOOGLE DOC
═══════════════════════════════════════

Use mcp__d9e74fd6-...-create_file with:
- title: "Promo Team Weekly Meeting Agenda — Week of YYYY-MM-DD" (Monday of this week)
- contentMimeType: "text/plain" (auto-converts to Google Doc — verified working)
- textContent: the full agenda as plain text with === dividers between sections, • for bullets

The response will include the file ID. Construct the doc URL: https://docs.google.com/document/d/{id}/edit

═══════════════════════════════════════
STEP 4 — RETURN OUTPUT
═══════════════════════════════════════

Output a concise message:
1. The Google Doc link
2. A 5-bullet "TL;DR" highlight (one bullet per section)
3. Any items that need Jascinta's manual judgment before circulation (e.g., HR-confidential items, ambiguous owner assignments)

═══════════════════════════════════════
STYLE & PREFERENCES
═══════════════════════════════════════
- Plain-text body; NO markdown headings inside the doc (Google Docs from text/plain won't render them). Use === banners and CAPS for headers.
- Specific over vague: "Wen 5/19: WS1/2 cleared SMG_* games" not "Wen did some Microgaming work"
- Owner-named action items, not passive voice
- Tone: direct, terse, no fluff
- If a section has nothing for the week, write "(no items this week)" — don't pad

═══════════════════════════════════════
GOTCHAS
═══════════════════════════════════════
- Don't probe HR-confidential Slack DMs unless flagged for action
- Telegram message dates: "today" / "yesterday" / "Thu" labels are relative — verify the actual day before assuming
- V3 vs V4 of WS1/WS2 platforms: different — flag if updates touched only one
- "Diandra = Bangun" — never list both as separate people
- Cite source for each non-obvious claim (e.g., "Source: Slack #ba-promo 5/21" or "Source: Telegram IB9 ...")

If anything blocks the run (tool unavailable, auth expired, browser disconnected): produce a partial agenda with the data you have and flag the gap explicitly at the top.
```

---

## Quick checklist after installing

- [ ] Verify task appears in `mcp__scheduled-tasks__list_scheduled_tasks`
- [ ] Confirm `nextRunAt` is the upcoming Friday at 9:27 AM MYT
- [ ] First run will fire next Friday — keep Claude Code open on the VDI by Thursday night
- [ ] If first run fails, check `C:\Users\vdiuser\.claude\scheduled-tasks\promo-team-weekly-agenda\SKILL.md` exists
- [ ] After first successful run, share Doc link to #promotions-team manually (or extend prompt to auto-post)

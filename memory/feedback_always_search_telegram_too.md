---
name: feedback_always_search_telegram_too
description: "For catch-up / activity / action-item sweeps, always search Telegram in addition to Slack."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 3e387f30-7b37-4437-aec0-25ab8ca3729c
---

When asked to summarize team activities / updates / action items (e.g. "since last Friday"), search **Telegram as well as Slack** — the team runs a lot of promo coordination on Telegram, not just Slack channels.

**Why:** Key promo specs, banner coordination, and manager asks land in Telegram first (e.g. "You Lose We Pay" promo spec, World Cup banners, CK's weekly "Promo Team Updates" roll-up all came via Telegram, not Slack).

**How to apply:**
- Telegram is accessed via **Claude-in-Chrome**, browser device named **"Telegram"** (deviceId `63dfc9c7-788d-4272-9fd4-b67f083c397f`) → `web.telegram.org/a/` (already logged in). Create an MCP tab, navigate, then `get_page_text` per chat (works well; faster than screenshots).
- Jascinta's Telegram handle = **@jascinta01**.
- Promo-relevant chats, priority order: **BA x PROMO**, **Promotion Team**, **Wai Yip DM**, **BA & Sales** (cross-sell leads + weekly updates). Broader/noisier: BA - QPLY x Alpha Iota, MEDIA BUYER GROUP, OPS-Escalations, WA Blasting.
- Slack side stays the same: #ba-promo, #promotions-team, DM with Wai Yip. See [[feedback_directory_first]] for brand→BO resolution.

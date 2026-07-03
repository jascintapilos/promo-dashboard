---
name: feedback-qp2-mt-tnc-anchor-renderer-bug
description: "Fixed 2026-06-23 — message-template-renderer.js skipped hyperlinkQproTnc on QP2 platform, leaving sentence-11 T&C as plain :url/terms-conditions text instead of wrapped anchor. Patch landed; renamed to hyperlinkTnc and called for both QPRO and QP2."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: eb8eeb8c-9666-4ae3-af1a-64ef5a8e562a
---

Fixed bug in `src/message-template-renderer.js`: the `hyperlinkQproTnc` helper that wraps the sentence-11 T&C term inside an `<a href=":url/terms-conditions">` anchor was only called on the QPRO codepath (`else { template = hyperlinkQproTnc(...) }`). The QP2 branch did `:brandname` → `:merchantname` swap then returned, never adding the anchor — so every QP2 MT body shipped sentence 11 as plain text `General :merchantname Terms and Conditions apply. :url/terms-conditions`.

**Why:** Sentinel deep-qc on P122-P127 (2026-06-23) flagged `MT_TnC_SG_EN=false` and `MT_TnC_SG_ZH=false` on all 6 saves. Bundle inspection showed plain-text URL instead of wrapped anchor. Root cause traced to QP2 branch skipping the helper.

**How to apply:**
- Renamed helper to `hyperlinkTnc(html, docKey, platform)` and now called in both QPRO and QP2 branches.
- QP2 anchor uses `target="_blank"` (matching `buildTncLinkHtml`); QPRO uses no target.
- Backfill: `bin/fix-p122-p127-mt-tnc-anchor.mjs` patches MTs 1193-1198 surgically via regex on existing message bodies (idempotent). For any older QP2 MT shipped before this fix, surgical regex backfill is safer than full re-render.
- New QP2 MT saves from the canary after 2026-06-23 will already include the anchor (renderer fixed at source).

---
name: feedback_qp2_dialog_relink_stale_popups
description: QP2 multi-merchant dialog popups mis-link to stale popups sharing a site_id; fixed via deterministic registry + relink-all PUT wired into the orchestrator.
metadata: 
  node_type: memory
  type: feedback
  originSessionId: e8cf9e51-b075-4665-98f4-d4120d149bd7
---

**Bug (found 2026-06-15):** On the shared IBC22 BO, `dialog_popup_list` links popups by `site_id`. When the canary attaches QP2 merchants incrementally (QP2A creates, QP2B/C/D extend), the BO mis-links the non-last merchants to STALE popups from a prior campaign that share the same site_id — only the LAST merchant (whose site_id has no stale popup) links correctly. Symptom: a Free Credit promo's dialog showed a prior "30% Reload Bonus" popup for sites 1/2/3.

**Root validated:** PUTting all N correct popup full-rows together in ONE `dialog_popup_list` makes the BO honor them (no need to delete stale popups). Incremental single/partial PUTs trigger the site_id mis-match.

**Why heuristic matching alone fails:** popups carry no promo_code, and sibling promos reuse the same `promotion_name_en` (all 6 WCF deposits = "World Cup Reload Bonus"), so title+recency is ambiguous; and re-running a partial promo creates popups far outside the original time window.

**Fix shipped:**
- `src/qp2-popup-registry.js` — JSONL append-only registry at `captures/qp2-dialog-links.jsonl`. `recordPopup(code, site, popup)` written by `canary-api-qp2.js` at BOTH popup-create sites (QP2A create path + QP2B/C/D extend path). `getPopups(code)` → `{site: popupId}` (last write per site wins → re-run safe).
- `bin/relink-qp2-dialogs.mjs <P###> [--commit]` — rebuilds the complete dialog_popup_list: registry first, heuristic (title + promo-created-at window, newest-per-site) fills any gap. Builds the full PUT via `buildApiPlan(resolved).buildUpdate(promoId, mtId, null)` then overrides `merchant_ids` + `dialog_popup_list`.
- `bin/canary-multi-brand.js` — after all jobs, if any QP2 brand involved + commit, spawns the relink (self-heal). Verified: re-running a partial promo (QP2C/D added later) relinks all 4 correctly via registry+heuristic merge.

**How to apply:** QP2 dialog correctness is now automatic via the orchestrator. For promos created BEFORE the registry existed, the heuristic path still relinks them (run `node bin/relink-qp2-dialogs.mjs P### --commit`). Always QC `dialog_popup_list` after QP2 saves: each site_id must map to a popup created in THIS run. See [[feedback_qp2_multi_merchant_share_code]], [[feedback_dialog_popup_defaults]], [[feedback_always_qc_after_save]].

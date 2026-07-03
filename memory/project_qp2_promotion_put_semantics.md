---
name: project_qp2_promotion_put_semantics
description: "QP2 PUT /api/bo/promotion/{id} in-place-edit gotchas — flip one field without wiping blacklist/dialog/currency."
metadata: 
  node_type: memory
  type: project
  originSessionId: 7c4b314d-e8db-4e19-a1e4-b998916c7946
---

How to change a single field (e.g. `auto_reward_activation`) on EXISTING QP2 promos in bulk without corrupting them. Verified 2026-06-02 flipping Auto Reward Activation ON for 34 `promo_testbot` codes on the ibc22 BO (QP2A+QP2C). See [[project_igmp_api_shapes]], [[feedback_blacklist_template_before_create]], [[feedback_always_qc_after_save]].

**You cannot PUT the GET-detail body raw** → 422. The PUT validator needs: `valid_from`/`valid_to` as `Y-m-d H:i:s` (GET returns ISO); `deposit_status` present as int (GET has none — derive: `last_deposit`→4, `first_deposit||ftd`→3, `before_ftd`→2, else 1); OMIT `free_spin_game_code` when null; OMIT `deposit_count_reset_frequency` (GET null → validator complains). The proven transform is `buildQp2DeactivateBody` in `bin/deactivate-test-promos.mjs` — but it WIPES the three sub-resources below.

**`black_list_sub_categories` (note PUT field name underscore差): OMIT it.** Sending the GET `blacklist_sub_categories` array OR an index-keyed object-map both silently wipe it to 0. Omitting the field → server re-derives from `blacklist_template_id`. It recomputes ASYNC after save (reads right after PUT show partial counts e.g. 19/25 then settle to the template's current set e.g. 30 — wait a few seconds before QC).

**`dialog_popup_list`: GET detail OMITS it; BOTH a raw API PUT and the BO UI Edit→Submit DROP the popup link.** Re-assert explicitly as `{ "0": { ...fullPopupRow, promotion_id } }` where fullPopupRow = the row from `/api/bo/popups` matched by popup_id (use `readDialogForPreservation`, or look up the original popup_id).

**`promotion_currency`: OMIT on PUT** — existing per-currency rows (separate sub-resource) are preserved. Confirmed: currency values (rate/min/max/deposit_options) unchanged after PUT without it.

**Winning recipe to flip one field + keep everything:** echo detail (validator-valid transform) + your field change + `dialog_popup_list` re-asserted + `black_list_sub_categories` OMITTED. Scripts built this session: `bin/set-auto-reward-api.mjs` (flip + QC), `bin/relink-dialog.mjs` (repair dropped dialogs, omit-blacklist), `bin/tick-auto-reward.js` (Playwright UI fallback). UI Edit→Submit preserves blacklist+member-groups+currency but DROPS dialog links — so prefer the API recipe, or re-pick the dialog in the kt-dropdown.

Enumerate active promos across all 4 QP2 merchants via `getAllPromotions(site,{status:1,merchantId})` then dedupe by id (one shared record spans merchants). The listing row carries `auto_reward_activation`, `deposit_status`, `dialog_popup_list`, `created_by` — enough to scope a bulk edit without per-id GETs.

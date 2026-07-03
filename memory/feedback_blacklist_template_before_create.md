---
name: feedback-blacklist-template-before-create
description: "On both QPRO and QP2 BO Create Promotion Code, the Blacklist Template must be selected BEFORE saving — placed right after Game Categories in the field-fill order."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 1392af18-ff06-41e3-a002-f151fae7185b
---

**Blacklist Template selection is a required step in promo code configuration.** On both QPRO and QP2 BO `Create Promotion Code` flows, the **Blacklist Template** dropdown must be selected before the code is saved. Slot it into the field-fill sequence **immediately after Game Categories** — that's not optional, it's the next step after categories commit.

**Selection rule (operator, 2026-05-26): the template choice follows the game categories selected.** Template names spell out which categories they cover — match the template whose category set equals the promo's category set.

Examples:
- Categories: Slots → template `"Slots Only"`
- Categories: Live Casino → template `"Live Casino Only"`
- Categories: Live Casino + Slots → template `"Live Casino and Slot"` (QPRO1, singular) / `"Live Casino and Slots"` (QPRO11)
- Categories: Slots + Live Casino + Sports → template `"Slots, Live Casino, Sports"`
- Categories: Sports + E-Sports → template `"Sports and Esports only"`
- Free Spin promos (Slots only by rule) → template `"Slots Only"`

If no template matches the category set exactly, the operator must create a matching template via the `+ Blacklist Templates` button next to the dropdown before saving the promo code. Template IDs are per-brand — `"Slots Only"` is id=8 on QPRO11 but id=6 on QPRO1 — so the resolver runs per-brand against that brand's `/api/bo/blacklist` listing.

**Why:** Operator workflow requires blacklist enforcement on every new promo code. Skipping it (or selecting after Save) leaves the promo open to blacklisted users for the window between create and edit, which defeats the purpose. Jascinta flagged this as a hard rule for both platforms.

**How to apply:**
- API-direct path (QPRO): set `blacklist_template_id: <int>` on the POST body to `/api/bo/promotion`, right next to `black_list_sub_categories: []`. Also re-emit on PUT (uses `promo.blacklist_template_id`). Mapper wires this from [[project_blacklist_template_resolver]].
- API-direct path (QP2): endpoint TBD — `/api/bo/blacklist` 404s on QP2; `/api/bo/promotion/blacklist*` returns 500 with every guessed param shape. Needs a Claude-in-Chrome session on QP2A Create Promotion to capture the dropdown's XHR. Until then, QP2 mapper omits the field (BO defaults to NULL, same as before).
- UI path (fallback): click the Blacklist Template dropdown right after committing Game Categories, before Member Group / Eligible Types / Currency / Save.
- Applies to all three bonus types: Deposit, FC, FS.
- Applies on every QPRO brand (QPRO1–QPRO19) and every QP2 merchant (QP2A/B/C/D).
- See [[project_handover_state_2026-05-20]] for the current field-fill order — insert blacklist step there before next canary run.
